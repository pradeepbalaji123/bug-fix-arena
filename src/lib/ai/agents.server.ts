import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, NoObjectGeneratedError, Output, streamText, type ModelMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayRunIdFetch } from "./run-id.server";

export const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export type AgentRole =
  | "triager"
  | "reproducer"
  | "patcher_a"
  | "patcher_b"
  | "adversary"
  | "reviewer"
  | "arbiter"
  | "baseline";

const testItem = z.object({ name: z.string(), body: z.string() });

const patchSchema = z.object({
  patched_code: z.string(),
  explanation: z.string(),
  changed_lines: z.number(),
});

export const SCHEMAS = {
  triager: z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    bug_type: z.string(),
    entry_function: z.string(),
    suspected_lines: z.array(z.object({ line: z.number(), reason: z.string() })),
    summary: z.string(),
    expected_behavior: z.string(),
  }),
  reproducer: z.object({ reference_implementation: z.string(), tests: z.array(testItem) }),
  patcher_a: patchSchema,
  patcher_b: patchSchema,
  baseline: patchSchema,
  adversary: z.object({
    attacks: z.array(z.object({ name: z.string(), body: z.string(), rationale: z.string() })),
  }),
  reviewer: z.object({
    risk: z.number(),
    readability: z.number(),
    side_effects: z.array(z.string()),
    verdict: z.string(),
  }),
  arbiter: z.object({ verdict_markdown: z.string() }),
} satisfies Record<AgentRole, z.ZodTypeAny>;

const TEST_RULES =
  "Test bodies are the BODY of a JavaScript function `function(fn, assert) { <body> }`. `fn` is the entry function under test; call it directly. `assert(condition, message)` throws when condition is falsy. For deep equality compare with JSON.stringify. No network, no randomness (never Math.random), no timers, no imports, no async.";

const PROMPTS: Record<AgentRole, string> = {
  triager:
    'You are the Triager of a code repair team. Given JavaScript code and a bug report, output: severity (low|medium|high|critical), bug_type, entry_function, suspected_lines [{line, reason}] (1-based line numbers), summary, expected_behavior. `entry_function` must be a top-level function name that exists in the code (if a user-provided entry function is given and exists, use it). Be precise and concise.',
  reproducer:
    "You write reproduction tests and a reference implementation. Output reference_implementation and tests [{name, body}]. The reference implementation is a simple, obviously-correct, self-contained version of the entry function (performance does not matter) with the SAME name and signature, including any helper classes it needs, written as plain JavaScript that declares the function at top level. " +
    TEST_RULES +
    " Write 3 to 5 tests, at least 2 of which must FAIL on the original buggy code and ALL of which must PASS on your reference implementation. Only test behaviour explicitly stated or clearly implied by the bug report. If feedback about a previous attempt is provided, fix those problems.",
  patcher_a:
    "You fix bugs with the smallest possible change. Output patched_code, explanation, changed_lines. Return the COMPLETE file, keep the entry function name and signature, change as few lines as possible, do not refactor, do not add dependencies. If a previous patch, failing tests or successful attacks are provided, fix those failures too.",
  patcher_b:
    "You fix bugs by addressing the root cause and hardening nearby logic (input validation, boundary handling). Output patched_code, explanation, changed_lines. Return the COMPLETE file, keep the entry function name and signature, you may restructure internals, do not add dependencies. If a previous patch, failing tests or successful attacks are provided, fix those failures too.",
  baseline:
    "Fix this bug. Output patched_code (the COMPLETE corrected file, same entry function name and signature), explanation, changed_lines.",
  adversary:
    "You are a red-team tester. Given the original bug report, the reference implementation, and a candidate patch, write up to 5 tests that try to break the patch: empty inputs, boundaries, type edge cases, large inputs, duplicates, negative numbers, unicode, property-style checks over many generated inputs (use a deterministic loop, never Math.random). Output attacks [{name, body, rationale}]. " +
    TEST_RULES +
    " Every attack must be a VALID expectation consistent with the bug report's intended behaviour and the reference implementation; invalid attacks are discarded and penalised. Do not test behaviour the bug report leaves unspecified.",
  reviewer:
    "You review code patches. Output risk (integer 1-5, 1 is safest), readability (integer 1-5, 5 is most readable), side_effects (list of strings, may be empty), verdict (one or two sentences). Judge only what the code and diff show.",
  arbiter:
    "You write a clear, honest verdict explaining why the winning patch won, using only the provided numeric scores and evidence. Output verdict_markdown (GitHub markdown, under 250 words, with a short heading, bullet points of the decisive evidence, and a one-line conclusion). Do not change or recompute the numbers. If there is no winner, explain what went wrong.",
};

function renderInput(input: Record<string, unknown>) {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `## ${k}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n\n");
}

export type AgentError = { code: string; message: string; status: number };
export type AgentResult =
  | {
      ok: true;
      output: unknown;
      usage: { promptTokens: number; completionTokens: number };
      latencyMs: number;
      model: string;
      gatewayRunId: string | null;
      timestamp: string;
      attempts: number;
    }
  | { ok: false; error: AgentError; latencyMs: number };

function mapError(err: unknown): AgentError {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 500;
    let message = err.message;
    try {
      const body = JSON.parse(err.responseBody ?? "{}");
      message = body?.error?.message ?? body?.message ?? message;
    } catch {
      /* ignore */
    }
    const code =
      status === 429 ? "rate_limited" : status === 402 ? "credits_exhausted" : status === 403 ? "forbidden" : status === 401 ? "auth" : status === 400 ? "bad_request" : "upstream_error";
    return { code, message, status };
  }
  if (err instanceof Error && err.name === "AbortError") return { code: "aborted", message: "Cancelled", status: 499 };
  return { code: "unexpected", message: err instanceof Error ? err.message : String(err), status: 500 };
}

export async function runAgentCall(role: AgentRole, input: Record<string, unknown>, signal?: AbortSignal): Promise<AgentResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const started = Date.now();
  if (!apiKey) return { ok: false, error: { code: "config", message: "AI is not configured", status: 500 }, latencyMs: 0 };

  const schema = SCHEMAS[role];
  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const messages: ModelMessage[] = [{ role: "user", content: renderInput(input) }];
  let promptTokens = 0;
  let completionTokens = 0;
  const timeout = AbortSignal.timeout(60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let rawText = "";
    try {
      const result = streamText({
        model: provider.responses(MODEL),
        system: PROMPTS[role],
        messages,
        maxRetries: 0,
        abortSignal: combined,
        output: Output.object({ schema }),
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      let output: unknown;
      try {
        output = await result.output;
      } catch (e) {
        if (NoObjectGeneratedError.isInstance(e)) {
          rawText = e.text ?? "";
          const parsed = schema.safeParse(safeJson(rawText));
          if (!parsed.success) throw e;
          output = parsed.data;
        } else throw e;
      }
      const usage = await result.totalUsage;
      promptTokens += usage.inputTokens ?? 0;
      completionTokens += usage.outputTokens ?? 0;
      return {
        ok: true,
        output,
        usage: { promptTokens, completionTokens },
        latencyMs: Date.now() - started,
        model: MODEL,
        gatewayRunId: runIdFetch.getRunId() ?? null,
        timestamp: new Date().toISOString(),
        attempts: attempt,
      };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e) && attempt === 1) {
        messages.push({ role: "assistant", content: rawText || e.text || "(invalid output)" });
        messages.push({ role: "user", content: "Your previous output did not match the required JSON schema. Fix your JSON and return only a valid object with every required field." });
        continue;
      }
      if (NoObjectGeneratedError.isInstance(e)) {
        return { ok: false, error: { code: "invalid_json", message: "Model returned invalid structured output twice", status: 502 }, latencyMs: Date.now() - started };
      }
      if (timeout.aborted && !signal?.aborted) {
        return { ok: false, error: { code: "timeout", message: "Model call exceeded 60s", status: 504 }, latencyMs: Date.now() - started };
      }
      return { ok: false, error: mapError(e), latencyMs: Date.now() - started };
    }
  }
  return { ok: false, error: { code: "unexpected", message: "Unreachable", status: 500 }, latencyMs: Date.now() - started };
}

function safeJson(text: string) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
