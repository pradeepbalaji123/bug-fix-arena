import { toast } from "sonner";
import { createTwoFilesPatch } from "diff";
import { supabase } from "@/integrations/supabase/client";
import { runAgent } from "@/lib/agents.functions";
import { preflight, runTests, type SandboxTest, type TestStatus } from "@/lib/sandbox";
import { clamp, computeScore, countChangedLines, rank, totalLines } from "@/lib/scoring";
import { AGENTS, REPUTATION_AGENTS, type AgentKey } from "@/lib/agents-meta";
import type { Candidate, Run, Step } from "@/lib/arena-db";

class PauseError extends Error {}
class CancelError extends Error {}

const active = new Map<string, AbortController>();
const listeners = new Set<() => void>();
export const isRunActive = (id: string) => active.has(id);
export function subscribeActive(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((l) => l());

export function stopRun(id: string) {
  active.get(id)?.abort();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new CancelError("Cancelled"));
    });
  });

interface Ctx {
  run: Run;
  runId: string;
  userId: string;
  code: string;
  bug: string;
  entry: string;
  timeout: number;
  steps: Step[];
  signal: AbortSignal;
  tokens: number;
  rep: Record<string, number>;
}

async function updateRun(ctx: Ctx, patch: Partial<Run>) {
  Object.assign(ctx.run, patch);
  await supabase.from("runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", ctx.runId);
}

function checkCancel(ctx: Ctx) {
  if (ctx.signal.aborted) throw new CancelError("Cancelled");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callAgent(ctx: Ctx, agent: AgentKey, round: number, label: string, input: Record<string, unknown>): Promise<any | null> {
  checkCancel(ctx);
  const existing = ctx.steps.find((s) => s.agent === agent && s.round === round && s.label === label);
  if (existing?.status === "done") return existing.output;
  let stepId = existing?.id;
  if (!stepId) {
    const { data, error } = await supabase
      .from("agent_steps")
      .insert({ run_id: ctx.runId, round, agent, label, status: "thinking", input: input as never })
      .select()
      .single();
    if (error) throw error;
    stepId = data.id;
    ctx.steps.push(data);
  } else {
    await supabase.from("agent_steps").update({ status: "thinking", error: null }).eq("id", stepId);
  }
  let retries = 0;
  while (true) {
    checkCancel(ctx);
    let res: Awaited<ReturnType<typeof runAgent>>;
    try {
      res = await runAgent({ data: { role: agent, input, runId: ctx.runId } });
    } catch (e) {
      res = { ok: false, error: { code: "network", message: e instanceof Error ? e.message : String(e), status: 500 }, latencyMs: 0 };
    }
    if (ctx.signal.aborted) {
      await supabase.from("agent_steps").update({ status: "failed", error: "Cancelled" }).eq("id", stepId);
      throw new CancelError("Cancelled");
    }
    if (res.ok) {
      const tokens = res.usage.promptTokens + res.usage.completionTokens;
      ctx.tokens += tokens;
      const patch = {
        status: "done",
        output: res.output as never,
        model: res.model,
        gateway_run_id: res.gatewayRunId,
        prompt_tokens: res.usage.promptTokens,
        completion_tokens: res.usage.completionTokens,
        latency_ms: res.latencyMs,
        attempts: res.attempts + retries,
        error: null,
        created_at: existing ? undefined : undefined,
      };
      await supabase.from("agent_steps").update(patch).eq("id", stepId);
      const local = ctx.steps.find((s) => s.id === stepId);
      if (local) Object.assign(local, patch);
      await updateRun(ctx, { total_tokens: ctx.tokens });
      return res.output;
    }
    const { status, message } = res.error;
    if ((status === 429 || status >= 500) && status !== 502 && status !== 504 && retries < 3) {
      retries++;
      const wait = 2 ** retries * 1000 + Math.random() * 500;
      await supabase.from("agent_steps").update({ status: "retrying", error: `${message} — retry ${retries}/3`, attempts: retries + 1 }).eq("id", stepId);
      if (status === 429) toast.warning("Rate limited — retrying", { description: `Waiting ${Math.round(wait / 1000)}s before retry ${retries}/3` });
      await sleep(wait, ctx.signal);
      continue;
    }
    await supabase.from("agent_steps").update({ status: "failed", error: message, latency_ms: res.latencyMs }).eq("id", stepId);
    if (status === 402 || status === 403 || status === 429) {
      throw new PauseError(status === 429 ? "Rate limit persisted after 3 retries. Resume when ready." : message);
    }
    toast.error(`${AGENTS[agent].name} failed`, { description: message });
    return null;
  }
}

type ResMap = Map<string, Map<string, TestStatus>>; // candidateId -> testId -> status

async function insertResults(ctx: Ctx, rows: { test_id: string; candidate_id: string | null; target: string; r: { status: string; message: string; console: string[]; durationMs: number } }[]) {
  if (!rows.length) return;
  await supabase.from("test_results").insert(
    rows.map((x) => ({
      run_id: ctx.runId,
      test_id: x.test_id,
      candidate_id: x.candidate_id,
      target: x.target,
      status: x.r.status,
      message: x.r.message,
      console: x.r.console as never,
      duration_ms: Math.round(x.r.durationMs * 100) / 100,
    })),
  );
}

async function runAndStore(ctx: Ctx, code: string, tests: SandboxTest[], candidateId: string | null, target: string, map?: ResMap) {
  const res = await runTests(code, ctx.entry, tests, ctx.timeout);
  await insertResults(ctx, res.map((r) => ({ test_id: r.id, candidate_id: candidateId, target, r })));
  if (map && candidateId) {
    const m = map.get(candidateId) ?? new Map();
    res.forEach((r) => m.set(r.id, r.status));
    map.set(candidateId, m);
  }
  return res;
}

export async function startOrchestration(runId: string) {
  if (active.has(runId)) return;
  const controller = new AbortController();
  active.set(runId, controller);
  emit();
  const sessionStart = Date.now();
  let ctx: Ctx | null = null;
  try {
    const { data: run, error } = await supabase.from("runs").select("*").eq("id", runId).single();
    if (error) throw error;
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error("Not signed in");
    const { data: steps } = await supabase.from("agent_steps").select("*").eq("run_id", runId).order("created_at");
    const { data: repRows } = await supabase.from("reputation").select("agent,value").eq("user_id", user.user.id);
    const rep: Record<string, number> = {};
    REPUTATION_AGENTS.forEach((a) => (rep[a] = 1));
    repRows?.forEach((r) => (rep[r.agent] = Number(r.value)));
    ctx = {
      run,
      runId,
      userId: user.user.id,
      code: run.code,
      bug: run.bug_report,
      entry: run.entry_function ?? "",
      timeout: run.timeout_ms,
      steps: steps ?? [],
      signal: controller.signal,
      tokens: (steps ?? []).filter((s) => s.status === "done").reduce((a, s) => a + (s.prompt_tokens ?? 0) + (s.completion_tokens ?? 0), 0),
      rep,
    };
    await waitForSlot(ctx);
    await engine(ctx);
  } catch (e) {
    if (ctx) {
      if (e instanceof CancelError) {
        await updateRun(ctx, { status: "cancelled", phase: "Cancelled by user" });
        toast.info("Run cancelled");
      } else if (e instanceof PauseError) {
        await updateRun(ctx, { status: "paused", error: e.message, phase: "Paused" });
        toast.error("Run paused", { description: e.message });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await updateRun(ctx, { status: "failed", error: msg, phase: "Failed" });
        toast.error("Run failed", { description: msg });
      }
    } else toast.error("Could not start run", { description: e instanceof Error ? e.message : String(e) });
  } finally {
    if (ctx) await updateRun(ctx, { duration_ms: (ctx.run.duration_ms ?? 0) + (Date.now() - sessionStart) });
    active.delete(runId);
    emit();
  }
}

async function waitForSlot(ctx: Ctx) {
  let notified = false;
  while (true) {
    checkCancel(ctx);
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabase
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "running")
      .neq("id", ctx.runId)
      .gt("updated_at", since);
    if ((count ?? 0) < 2) return;
    if (!notified) {
      notified = true;
      toast.info("Queued", { description: "You already have 2 runs in progress. This one starts when a slot frees up." });
      await updateRun(ctx, { status: "queued", phase: "Waiting for a free slot (max 2 concurrent runs)" });
    }
    await sleep(5000, ctx.signal);
  }
}

async function engine(ctx: Ctx) {
  const run = ctx.run;
  await updateRun(ctx, { status: "running", error: null, phase: "Triage" });
  // Derived data is recomputed deterministically from memoised agent outputs on every (re)start.
  await supabase.from("test_results").delete().eq("run_id", ctx.runId);
  await supabase.from("tests").delete().eq("run_id", ctx.runId);
  await supabase.from("candidates").delete().eq("run_id", ctx.runId);

  // 1. Triage
  const triage = await callAgent(ctx, "triager", 0, "triage", {
    code: ctx.code,
    bug_report: ctx.bug,
    user_provided_entry_function: run.entry_function || null,
  });
  if (!triage) throw new Error("Triager failed — cannot continue");
  let entry = "";
  for (const c of [run.entry_function, triage.entry_function].filter(Boolean) as string[]) {
    const pf = await preflight(ctx.code, c, ctx.timeout);
    if (pf.ok) {
      entry = c;
      break;
    }
  }
  if (!entry) throw new Error(`Entry function "${triage.entry_function}" could not be loaded from the original code`);
  ctx.entry = entry;
  await updateRun(ctx, { triage, entry_function: entry, phase: "Reproduce" });

  // 2. Reproduce
  let feedback: string | null = null;
  let accepted: { ref: string; tests: { name: string; body: string; valid: boolean; onRef: ReturnType<typeof Object>; onOrig: ReturnType<typeof Object> }[] } | null = null;
  let retries = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await callAgent(ctx, "reproducer", 0, `attempt ${attempt}`, {
      code: ctx.code,
      bug_report: ctx.bug,
      triage,
      entry_function: entry,
      feedback_from_previous_attempt: feedback,
    });
    retries = attempt - 1;
    if (!out) {
      feedback = "The previous call failed. Try again.";
      continue;
    }
    const ref: string = out.reference_implementation;
    const pf = await preflight(ref, entry, ctx.timeout);
    if (!pf.ok) {
      feedback = `Your reference implementation failed to load: ${pf.message}. It must define a top-level "${entry}".`;
      continue;
    }
    const tests: SandboxTest[] = (out.tests as { name: string; body: string }[]).slice(0, 5).map((t, i) => ({ id: `t${i}`, name: t.name, body: t.body }));
    const onRef = await runTests(ref, entry, tests, ctx.timeout);
    const onOrig = await runTests(ctx.code, entry, tests, ctx.timeout);
    const valid = tests.map((_, i) => onRef[i].status === "pass");
    const failing = tests.filter((_, i) => valid[i] && onOrig[i].status !== "pass");
    if (failing.length >= 1) {
      accepted = { ref, tests: tests.map((t, i) => ({ name: t.name, body: t.body, valid: valid[i], onRef: onRef[i], onOrig: onOrig[i] })) };
      break;
    }
    feedback = [
      "Your tests were rejected:",
      ...tests.map((t, i) => `- "${t.name}": reference=${onRef[i].status}${onRef[i].message ? ` (${onRef[i].message})` : ""}, original=${onOrig[i].status}`),
      "At least one test must PASS on the reference and FAIL on the original buggy code.",
    ].join("\n");
  }
  if (!accepted) {
    await updateRun(ctx, {
      status: "needs_input",
      reproducer_retries: retries,
      phase: "Needs input",
      error:
        "The Reproducer could not write a test that fails on your code but passes on a correct version. Please clarify the bug report with a concrete input, the actual output and the expected output.",
    });
    toast.warning("Needs more detail", { description: "Clarify the bug report with a concrete failing example." });
    return;
  }
  await updateRun(ctx, { reference_implementation: accepted.ref, reproducer_retries: retries });
  const { data: testRows } = await supabase
    .from("tests")
    .insert(accepted.tests.map((t) => ({ run_id: ctx.runId, round_created: 0, source: "reproducer", name: t.name, body: t.body, valid_on_reference: t.valid })))
    .select();
  const rows = testRows ?? [];
  await insertResults(
    ctx,
    rows.flatMap((row, i) => [
      { test_id: row.id, candidate_id: null, target: "reference", r: accepted!.tests[i].onRef as never },
      { test_id: row.id, candidate_id: null, target: "original", r: accepted!.tests[i].onOrig as never },
    ]),
  );
  const reproTests: SandboxTest[] = rows.filter((r) => r.valid_on_reference).map((r) => ({ id: r.id, name: r.name, body: r.body }));
  const attacks: SandboxTest[] = [];
  let invalidAttacks = 0;
  const brokeBy = new Set<string>(); // attack ids that broke a team patch
  const resMap: ResMap = new Map();
  const cands: Candidate[] = [];
  const patchers = ((run.patchers as string[]) ?? ["patcher_a", "patcher_b"]).filter((p) => p === "patcher_a" || p === "patcher_b") as AgentKey[];
  const prev: Record<string, { code: string; failing: string[]; attacks: string[] }> = {};
  const originalLines = totalLines(ctx.code);

  const passedAll = (c: Candidate) => {
    if (c.disqualified) return false;
    const m = resMap.get(c.id);
    return [...reproTests, ...attacks].every((t) => m?.get(t.id) === "pass");
  };

  const scoreAll = async () => {
    const totalAttacks = attacks.length;
    for (const c of cands) {
      const m = resMap.get(c.id) ?? new Map();
      const reproPassed = reproTests.filter((t) => m.get(t.id) === "pass").length;
      const survived = attacks.filter((t) => m.get(t.id) === "pass").length;
      const reviewer = c.reviewer as { risk?: number } | null;
      const repVal = c.agent === "baseline" ? 1 : ctx.rep[c.agent] ?? 1;
      const s = computeScore({
        reproPassed,
        reproTotal: reproTests.length,
        attacksSurvived: survived,
        attacksTotal: totalAttacks,
        changedLines: c.changed_lines,
        originalLines,
        reviewerRisk: reviewer?.risk ?? null,
        reputation: repVal,
        disqualified: c.disqualified,
      });
      const prevScores = (c.scores as Record<string, unknown>) ?? {};
      c.scores = { ...prevScores, ...s } as never;
      c.final_score = s.final_score;
      await supabase.from("candidates").update({ scores: c.scores, final_score: s.final_score }).eq("id", c.id);
    }
  };

  // 3+. Rounds
  let lastRound = 1;
  for (let r = 1; r <= run.max_rounds; r++) {
    lastRound = r;
    await updateRun(ctx, { current_round: r, phase: `Round ${r} · Patch` });
    const jobs: Promise<{ agent: AgentKey; out: { patched_code: string; explanation: string } | null }>[] = patchers.map((p) =>
      callAgent(ctx, p, r, "patch", {
        code: ctx.code,
        bug_report: ctx.bug,
        triage_summary: triage.summary,
        expected_behavior: triage.expected_behavior,
        suspected_lines: triage.suspected_lines,
        entry_function: entry,
        reproduction_tests: reproTests.map((t) => ({ name: t.name, body: t.body })),
        your_previous_patch: prev[p]?.code ?? null,
        tests_your_previous_patch_failed: prev[p]?.failing ?? null,
        attacks_that_broke_your_previous_patch: prev[p]?.attacks ?? null,
      }).then((out) => ({ agent: p, out })),
    );
    if (r === 1 && run.baseline_enabled) {
      jobs.push(callAgent(ctx, "baseline", 1, "baseline", { code: ctx.code, bug_report: ctx.bug }).then((out) => ({ agent: "baseline" as AgentKey, out })));
    }
    const outs = await Promise.all(jobs);
    const roundCands: Candidate[] = [];
    for (const { agent, out } of outs) {
      if (!out?.patched_code) continue;
      const changed = countChangedLines(ctx.code, out.patched_code);
      const pf = await preflight(out.patched_code, entry, ctx.timeout);
      let dqReason: string | null = null;
      if (!pf.ok) {
        dqReason =
          pf.reason === "missing_entry"
            ? `Entry function "${entry}" missing or renamed`
            : pf.reason === "timeout"
              ? "Patch timed out while loading"
              : `Patch failed to parse/load: ${pf.message}`;
      }
      const { data: cand, error } = await supabase
        .from("candidates")
        .insert({
          run_id: ctx.runId,
          round: r,
          agent,
          code: out.patched_code,
          explanation: out.explanation,
          changed_lines: changed,
          disqualified: !!dqReason,
          disqualify_reason: dqReason,
          final_score: 0,
        })
        .select()
        .single();
      if (error) throw error;
      roundCands.push(cand);
      cands.push(cand);
    }
    const team = roundCands.filter((c) => c.agent !== "baseline");
    if (team.length === 2 && team[0].code.trim() === team[1].code.trim()) {
      toast.info("Patchers converged on the same fix");
      for (const c of team) {
        c.scores = { converged: true } as never;
        await supabase.from("candidates").update({ scores: c.scores }).eq("id", c.id);
      }
    }
    if (!roundCands.length) {
      if (r < run.max_rounds) continue;
      break;
    }

    // Verify
    await updateRun(ctx, { phase: `Round ${r} · Verify` });
    for (const c of roundCands.filter((c) => !c.disqualified)) await runAndStore(ctx, c.code, reproTests, c.id, "candidate", resMap);

    // Attack
    await updateRun(ctx, { phase: `Round ${r} · Attack` });
    const targets = roundCands.filter((c) => !c.disqualified && c.agent !== "baseline");
    const attackOuts = await Promise.all(
      targets.map((c) =>
        callAgent(ctx, "adversary", r, `vs ${AGENTS[c.agent as AgentKey].short}`, {
          bug_report: ctx.bug,
          entry_function: entry,
          reference_implementation: accepted!.ref,
          candidate_patch: c.code,
          existing_test_names: [...reproTests, ...attacks].map((t) => t.name),
        }).then((out) => ({ c, out })),
      ),
    );
    for (const { c, out } of attackOuts) {
      if (!out?.attacks) continue;
      const list = (out.attacks as { name: string; body: string; rationale: string }[]).slice(0, 5);
      const tmp = list.map((a, i) => ({ id: `a${i}`, name: a.name, body: a.body }));
      const onRef = await runTests(accepted.ref, entry, tmp, ctx.timeout);
      const { data: inserted } = await supabase
        .from("tests")
        .insert(
          list.map((a, i) => ({
            run_id: ctx!.runId,
            round_created: r,
            source: "adversary",
            target_candidate_id: c.id,
            name: a.name,
            body: a.body,
            rationale: a.rationale,
            valid_on_reference: onRef[i].status === "pass",
          })),
        )
        .select();
      const ins = inserted ?? [];
      await insertResults(ctx, ins.map((row, i) => ({ test_id: row.id, candidate_id: null, target: "reference", r: onRef[i] })));
      ins.forEach((row) => {
        if (row.valid_on_reference) attacks.push({ id: row.id, name: row.name, body: row.body });
        else invalidAttacks++;
      });
    }
    // Run every accumulated valid attack against this round's candidates
    for (const c of roundCands.filter((c) => !c.disqualified)) {
      const done = resMap.get(c.id);
      const missing = attacks.filter((a) => !done?.has(a.id));
      await runAndStore(ctx, c.code, missing, c.id, "candidate", resMap);
    }

    // Review
    await updateRun(ctx, { phase: `Round ${r} · Review` });
    const ok = roundCands.filter((c) => !c.disqualified);
    const passingRepro = ok.filter((c) => reproTests.every((t) => resMap.get(c.id)?.get(t.id) === "pass"));
    const toReview = passingRepro.length ? passingRepro : ok;
    await Promise.all(
      toReview.map(async (c) => {
        const out = await callAgent(ctx!, "reviewer", r, `review ${AGENTS[c.agent as AgentKey].short}`, {
          bug_report: ctx!.bug,
          original_code: ctx!.code,
          patched_code: c.code,
          diff: createTwoFilesPatch("original.js", "patched.js", ctx!.code, c.code),
        });
        if (out) {
          const reviewer = { ...out, risk: clamp(Math.round(out.risk), 1, 5), readability: clamp(Math.round(out.readability), 1, 5) };
          c.reviewer = reviewer as never;
          await supabase.from("candidates").update({ reviewer: reviewer as never }).eq("id", c.id);
        }
      }),
    );

    await updateRun(ctx, { phase: `Round ${r} · Score` });
    await scoreAll();
    const perfect = roundCands.some((c) => c.agent !== "baseline" && passedAll(c));
    if (perfect) break;
    for (const c of roundCands.filter((c) => c.agent !== "baseline")) {
      const m = resMap.get(c.id);
      prev[c.agent] = {
        code: c.code,
        failing: c.disqualified ? [`DISQUALIFIED: ${c.disqualify_reason}`] : reproTests.filter((t) => m?.get(t.id) !== "pass").map((t) => `${t.name}\n${t.body}`),
        attacks: attacks.filter((t) => m?.get(t.id) !== "pass").map((t) => `${t.name}\n${t.body}`),
      };
    }
  }

  // Finalise: rerun earlier candidates against later attacks, then score.
  await updateRun(ctx, { phase: "Arbitrate" });
  for (const c of cands.filter((c) => !c.disqualified)) {
    const done = resMap.get(c.id);
    const missing = [...reproTests, ...attacks].filter((a) => !done?.has(a.id));
    if (missing.length) await runAndStore(ctx, c.code, missing, c.id, "candidate", resMap);
  }
  for (const a of attacks) {
    if (cands.some((c) => c.agent !== "baseline" && !c.disqualified && resMap.get(c.id)?.get(a.id) !== "pass")) brokeBy.add(a.id);
  }
  await scoreAll();
  const ranked = rank(
    cands
      .filter((c) => c.agent !== "baseline" && !c.disqualified && (c.final_score ?? 0) > 0)
      .map((c) => ({ ...c, id: c.id, final_score: Number(c.final_score ?? 0), changed_lines: c.changed_lines, risk: (c.reviewer as { risk?: number } | null)?.risk ?? 3 })),
  );
  const winner = ranked[0] ?? null;
  const winnerPerfect = winner ? passedAll(winner) : false;
  const status = winner ? (winnerPerfect ? "completed" : "partial") : "failed";
  if (winner) await supabase.from("candidates").update({ is_winner: true }).eq("id", winner.id);

  const scoreTable = cands.map((c) => {
    const s = c.scores as Record<string, number | string> | null;
    return {
      contender: `${AGENTS[c.agent as AgentKey].name} (round ${c.round})`,
      disqualified: c.disqualified ? c.disqualify_reason : false,
      repro_passed: s?.repro,
      attacks_survived: s?.attacks,
      changed_lines: c.changed_lines,
      reviewer_risk: (c.reviewer as { risk?: number } | null)?.risk ?? null,
      final_score: Number(c.final_score ?? 0).toFixed(4),
    };
  });
  const verdict = await callAgent(ctx, "arbiter", lastRound, "verdict", {
    bug_report: ctx.bug,
    outcome: status,
    winner: winner ? `${AGENTS[winner.agent as AgentKey].name} (round ${winner.round})` : "none",
    winner_explanation: winner?.explanation ?? null,
    scores: scoreTable,
    valid_attacks: attacks.length,
    invalid_attacks_discarded: invalidAttacks,
    rounds_used: lastRound,
  });

  if (!run.reputation_applied) await applyReputation(ctx, { cands, winner, passedAll, resMap, reproTests, attacks, brokeBy: brokeBy.size, invalidAttacks, retries, patchers });

  await updateRun(ctx, {
    status,
    winner_candidate_id: winner?.id ?? null,
    best_score: winner ? Number(winner.final_score) : 0,
    verdict_markdown: verdict?.verdict_markdown ?? null,
    phase: "Done",
    error: verdict ? null : "Arbiter narrative failed; scores are still valid.",
  });
  if (status === "completed") toast.success("Fixed! A patch passed every test and attack.");
  else if (status === "partial") toast.warning("Partial fix — best patch passes only some tests.");
  else toast.error("No patch survived.");
}

async function applyReputation(
  ctx: Ctx,
  d: {
    cands: Candidate[];
    winner: Candidate | null;
    passedAll: (c: Candidate) => boolean;
    resMap: ResMap;
    reproTests: SandboxTest[];
    attacks: SandboxTest[];
    brokeBy: number;
    invalidAttacks: number;
    retries: number;
    patchers: AgentKey[];
  },
) {
  type Delta = { agent: string; delta: number; reason: string; win?: number; loss?: number; landed?: number };
  const deltas: Delta[] = [];
  const all = [...d.reproTests, ...d.attacks];
  for (const p of d.patchers) {
    const mine = d.cands.filter((c) => c.agent === p);
    if (!mine.length) continue;
    if (d.winner?.agent === p) {
      deltas.push({ agent: p, delta: 0.05, reason: "Patch won the arena", win: 1 });
      continue;
    }
    if (mine.some(d.passedAll)) {
      deltas.push({ agent: p, delta: 0.02, reason: "Patch passed everything but lost", loss: 1 });
      continue;
    }
    const best = [...mine].sort((a, b) => Number(b.final_score) - Number(a.final_score))[0];
    const passRatio = best.disqualified ? 0 : all.filter((t) => d.resMap.get(best.id)?.get(t.id) === "pass").length / Math.max(1, all.length);
    if (best.disqualified || passRatio < 0.5) deltas.push({ agent: p, delta: -0.04, reason: best.disqualified ? `Disqualified: ${best.disqualify_reason}` : "Patch failed most tests", loss: 1 });
    else deltas.push({ agent: p, delta: 0, reason: "Patch lost", loss: 1 });
  }
  if (d.brokeBy) deltas.push({ agent: "adversary", delta: Math.min(0.09, 0.03 * d.brokeBy), reason: `${d.brokeBy} valid attack(s) broke a patch`, landed: d.brokeBy });
  if (d.invalidAttacks) deltas.push({ agent: "adversary", delta: -Math.min(0.06, 0.02 * d.invalidAttacks), reason: `${d.invalidAttacks} invalid attack(s) discarded` });
  deltas.push(
    d.retries === 0
      ? { agent: "reproducer", delta: 0.04, reason: "Valid tests on first try" }
      : { agent: "reproducer", delta: -0.03 * d.retries, reason: `${d.retries} retr${d.retries === 1 ? "y" : "ies"} needed` },
  );
  let good = 0;
  let bad = 0;
  for (const c of d.cands) {
    const risk = (c.reviewer as { risk?: number } | null)?.risk;
    if (risk == null || c.disqualified) continue;
    const survived = d.attacks.every((t) => d.resMap.get(c.id)?.get(t.id) === "pass");
    if ((risk <= 2 && survived) || (risk >= 4 && !survived)) good++;
    else bad++;
  }
  if (good + bad > 0) deltas.push(good >= bad ? { agent: "reviewer", delta: 0.03, reason: `Risk ratings matched outcomes (${good}/${good + bad})` } : { agent: "reviewer", delta: -0.03, reason: `Risk ratings missed outcomes (${bad}/${good + bad})` });

  const { data: rows } = await supabase.from("reputation").select("*").eq("user_id", ctx.userId);
  const byAgent = new Map((rows ?? []).map((r) => [r.agent, r]));
  const history: { agent: string; run_id: string; delta: number; reason: string; value_after: number }[] = [];
  for (const agent of new Set(deltas.map((x) => x.agent))) {
    const row = byAgent.get(agent);
    let value = Number(row?.value ?? 1);
    let wins = row?.wins ?? 0;
    let losses = row?.losses ?? 0;
    let landed = row?.attacks_landed ?? 0;
    for (const x of deltas.filter((x) => x.agent === agent)) {
      value = Math.round(clamp(value + x.delta, 0.5, 1.5) * 1000) / 1000;
      wins += x.win ?? 0;
      losses += x.loss ?? 0;
      landed += x.landed ?? 0;
      if (x.delta !== 0) history.push({ agent, run_id: ctx.runId, delta: x.delta, reason: x.reason, value_after: value });
    }
    await supabase.from("reputation").upsert({ user_id: ctx.userId, agent, value, wins, losses, attacks_landed: landed, updated_at: new Date().toISOString() }, { onConflict: "user_id,agent" });
  }
  if (history.length) await supabase.from("reputation_history").insert(history);
  await updateRun(ctx, { reputation_applied: true });
}
