import { Bug, FlaskConical, Scissors, Wrench, Swords, Eye, Scale, User, type LucideIcon } from "lucide-react";

export type AgentKey = "triager" | "reproducer" | "patcher_a" | "patcher_b" | "adversary" | "reviewer" | "arbiter" | "baseline";
export type Team = "blue" | "red" | "neutral" | "solo";

export const AGENTS: Record<AgentKey, { name: string; short: string; team: Team; icon: LucideIcon; job: string }> = {
  triager: { name: "Triager", short: "Triage", team: "blue", icon: Bug, job: "Classifies severity and pinpoints suspect lines." },
  reproducer: { name: "Reproducer", short: "Repro", team: "blue", icon: FlaskConical, job: "Writes failing tests and a trusted reference implementation." },
  patcher_a: { name: "Patcher A · Minimalist", short: "Patcher A", team: "blue", icon: Scissors, job: "Ships the smallest possible fix." },
  patcher_b: { name: "Patcher B · Root-Cause", short: "Patcher B", team: "blue", icon: Wrench, job: "Fixes the root cause and hardens nearby logic." },
  adversary: { name: "Adversary", short: "Adversary", team: "red", icon: Swords, job: "Writes edge-case attacks to break every patch." },
  reviewer: { name: "Reviewer", short: "Reviewer", team: "neutral", icon: Eye, job: "Rates risk, readability and side effects." },
  arbiter: { name: "Arbiter", short: "Arbiter", team: "neutral", icon: Scale, job: "Scores executed evidence and writes the verdict." },
  baseline: { name: "Solo Agent (Baseline)", short: "Solo", team: "solo", icon: User, job: "One plain LLM call with no team." },
};

export const REPUTATION_AGENTS: AgentKey[] = ["patcher_a", "patcher_b", "adversary", "reproducer", "reviewer"];

export const teamClasses: Record<Team, { chip: string; ring: string; text: string; bg: string }> = {
  blue: { chip: "bg-team-blue/15 text-team-blue border-team-blue/30", ring: "ring-team-blue/50", text: "text-team-blue", bg: "bg-team-blue" },
  red: { chip: "bg-team-red/15 text-team-red border-team-red/30", ring: "ring-team-red/50", text: "text-team-red", bg: "bg-team-red" },
  neutral: { chip: "bg-arbiter/15 text-arbiter border-arbiter/30", ring: "ring-arbiter/50", text: "text-arbiter", bg: "bg-arbiter" },
  solo: { chip: "bg-muted text-muted-foreground border-border", ring: "ring-border", text: "text-muted-foreground", bg: "bg-muted-foreground" },
};

export function agentTeamClass(agent: string) {
  return teamClasses[AGENTS[agent as AgentKey]?.team ?? "solo"];
}
