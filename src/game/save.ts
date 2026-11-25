import { hashSeed } from "./rng.js";

export const SAVE_KEY = "dissonance-lock.save.v2";

export interface SaveData {
  /** tutorial completed */
  tutorial: boolean;
  /** best clear time per campaign level (seconds) */
  best: (number | null)[];
  /** best star rating per campaign level (0 = not cleared) */
  stars: number[];
  /** deepest Drift level cleared in free runs */
  driftBest: number;
  /** deepest Drift level cleared in today's daily run */
  daily: { key: string; depth: number };
  /** Observatory Calibration Trials cleared (ids) */
  trials: string[];
}

export const emptySave = (levels: number): SaveData => ({
  tutorial: false,
  best: Array.from({ length: levels }, () => null),
  stars: Array.from({ length: levels }, () => 0),
  driftBest: 0,
  daily: { key: "", depth: 0 },
  trials: [],
});

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Tolerant parser: any malformed input yields a usable save. */
export function parseSave(raw: string | null, levels: number): SaveData {
  const out = emptySave(levels);
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as Partial<SaveData> | null;
    if (!j || typeof j !== "object") return out;
    for (let i = 0; i < levels; i++) {
      out.best[i] = Array.isArray(j.best) ? num(j.best[i]) : null;
      out.stars[i] = Array.isArray(j.stars) ? Math.max(0, Math.min(3, num(j.stars[i]) ?? 0)) : 0;
    }
    out.tutorial = j.tutorial === true;
    out.driftBest = Math.max(0, num(j.driftBest) ?? 0);
    if (j.daily && typeof j.daily.key === "string") {
      out.daily = { key: j.daily.key, depth: Math.max(0, num(j.daily.depth) ?? 0) };
    }
    if (Array.isArray(j.trials)) out.trials = [...new Set(j.trials.filter((x): x is string => typeof x === "string"))].slice(0, 64);
  } catch { /* corrupt save: start fresh */ }
  return out;
}

export const dailyKey = (d: Date): string => d.toISOString().slice(0, 10);
export const dailySeed = (key: string): number => hashSeed("daily", key);

/** Plain-text result for sharing a Drift run. */
export function shareText(label: string, cleared: number, url: string): string {
  return `Dissonance-Lock · ${label}\nDepth ${cleared} cleared\n${url}`;
}
