import { diffLines } from "diff";

export function countChangedLines(original: string, patched: string): number {
  const parts = diffLines(original.replace(/\r\n/g, "\n"), patched.replace(/\r\n/g, "\n"));
  let total = 0;
  let removed = 0;
  let added = 0;
  const flush = () => {
    total += Math.max(removed, added);
    removed = 0;
    added = 0;
  };
  for (const p of parts) {
    const n = p.count ?? p.value.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "").length;
    if (p.removed) removed += n;
    else if (p.added) added += n;
    else flush();
  }
  flush();
  return total;
}

export function totalLines(code: string) {
  return code.replace(/\n+$/, "").split("\n").length;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface ScoreInput {
  reproPassed: number;
  reproTotal: number;
  attacksSurvived: number;
  attacksTotal: number;
  changedLines: number;
  originalLines: number;
  reviewerRisk: number | null;
  reputation: number;
  disqualified: boolean;
}

export interface ScoreBreakdown {
  repro_ratio: number;
  attack_ratio: number;
  size_score: number;
  risk_score: number;
  base_score: number;
  reputation: number;
  reputation_multiplier: number;
  final_score: number;
  weighted: { repro: number; attack: number; size: number; risk: number };
  repro: string;
  attacks: string;
  risk_used: number;
}

export function computeScore(s: ScoreInput): ScoreBreakdown {
  const repro_ratio = s.reproTotal > 0 ? s.reproPassed / s.reproTotal : 0;
  const attack_ratio = s.attacksTotal > 0 ? s.attacksSurvived / s.attacksTotal : 1;
  const size_score = 1 - Math.min(1, s.changedLines / Math.max(1, s.originalLines));
  const risk = clamp(Math.round(s.reviewerRisk ?? 3), 1, 5);
  const risk_score = 1 - (risk - 1) / 4;
  const weighted = { repro: 0.4 * repro_ratio, attack: 0.3 * attack_ratio, size: 0.15 * size_score, risk: 0.15 * risk_score };
  const base_score = weighted.repro + weighted.attack + weighted.size + weighted.risk;
  const reputation_multiplier = 0.9 + 0.1 * clamp(s.reputation, 0.5, 1.5);
  const final_score = s.disqualified ? 0 : base_score * reputation_multiplier;
  return {
    repro_ratio,
    attack_ratio,
    size_score,
    risk_score,
    base_score: s.disqualified ? 0 : base_score,
    reputation: s.reputation,
    reputation_multiplier,
    final_score,
    weighted,
    repro: `${s.reproPassed}/${s.reproTotal}`,
    attacks: `${s.attacksSurvived}/${s.attacksTotal}`,
    risk_used: risk,
  };
}

export interface Rankable {
  id: string;
  final_score: number;
  changed_lines: number;
  risk: number;
}
/** Sort descending by score; ties by smaller diff, then lower reviewer risk. */
export function rank<T extends Rankable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const d = b.final_score - a.final_score;
    if (Math.abs(d) > 1e-9) return d;
    if (a.changed_lines !== b.changed_lines) return a.changed_lines - b.changed_lines;
    return a.risk - b.risk;
  });
}

export const SCORE_TERMS = {
  repro_ratio: "Reproduction tests passed ÷ valid reproduction tests (weight 0.40)",
  attack_ratio: "Valid adversary attacks survived ÷ valid attacks; 1.0 if none (weight 0.30)",
  size_score: "1 − min(1, changed lines from the real diff ÷ original line count) (weight 0.15)",
  risk_score: "1 − (reviewer risk − 1) ÷ 4 (weight 0.15)",
  reputation_multiplier: "0.9 + 0.1 × clamp(patcher reputation, 0.5, 1.5)",
} as const;
