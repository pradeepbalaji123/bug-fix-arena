import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLES = ["triager", "reproducer", "patcher_a", "patcher_b", "adversary", "reviewer", "arbiter", "baseline"] as const;

const inputSchema = z.object({
  role: z.enum(ROLES),
  input: z.record(z.unknown()),
  runId: z.string().uuid(),
});

export const runAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const parsed = inputSchema.parse(data);
    if (JSON.stringify(parsed.input).length > 120_000) throw new Error("Agent input too large");
    return parsed;
  })
  .handler(async ({ data, context }) => {
    // Ensure the run belongs to the caller (RLS-scoped read).
    const { data: run } = await context.supabase.from("runs").select("id").eq("id", data.runId).maybeSingle();
    if (!run) return { ok: false as const, error: { code: "not_found", message: "Run not found", status: 404 }, latencyMs: 0 };
    const { runAgentCall } = await import("./ai/agents.server");
    return runAgentCall(data.role, data.input);
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    for (const t of ["test_results", "tests", "candidates", "agent_steps", "reputation_history", "reputation", "runs", "profiles"] as const) {
      await supabaseAdmin.from(t).delete().eq("user_id", uid);
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
