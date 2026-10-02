import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type T = Database["public"]["Tables"];
export type Run = T["runs"]["Row"];
export type Step = T["agent_steps"]["Row"];
export type Candidate = T["candidates"]["Row"];
export type ArenaTest = T["tests"]["Row"];
export type TestResultRow = T["test_results"]["Row"];
export type Demo = T["demos"]["Row"];

export interface RunBundle {
  run: Run;
  steps: Step[];
  candidates: Candidate[];
  tests: ArenaTest[];
  results: TestResultRow[];
}

export async function fetchBundle(runId: string): Promise<RunBundle | null> {
  const [run, steps, candidates, tests, results] = await Promise.all([
    supabase.from("runs").select("*").eq("id", runId).maybeSingle(),
    supabase.from("agent_steps").select("*").eq("run_id", runId).order("created_at"),
    supabase.from("candidates").select("*").eq("run_id", runId).order("created_at"),
    supabase.from("tests").select("*").eq("run_id", runId).order("created_at"),
    supabase.from("test_results").select("*").eq("run_id", runId).limit(5000),
  ]);
  if (run.error) throw run.error;
  if (!run.data) return null;
  return {
    run: run.data,
    steps: steps.data ?? [],
    candidates: candidates.data ?? [],
    tests: tests.data ?? [],
    results: results.data ?? [],
  };
}

export async function fetchShared(token: string): Promise<RunBundle | null> {
  const { data, error } = await supabase.rpc("get_shared_run", { _token: token });
  if (error) throw error;
  if (!data) return null;
  return data as unknown as RunBundle;
}

export function resultFor(results: TestResultRow[], testId: string, candidateId: string | null, target = "candidate") {
  return results.find((r) => r.test_id === testId && (candidateId ? r.candidate_id === candidateId : r.target === target));
}

export async function ensureProfile(userId: string) {
  const { data } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data;
  const { data: created } = await supabase.from("profiles").insert({ user_id: userId }).select().single();
  return created;
}
