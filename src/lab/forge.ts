import { TMAX, auditEmitter, feedbackAudit, hasFeedback, newLab, triangulate, zetaFix } from "./lab.js";
import type { Lab } from "./lab.js";
import { lawsOf, packJson, parseWorld, roundWorld, unpackJson } from "./world.js";
import type { WorldSpec } from "./world.js";
import type { Trial, TrialState } from "./trials.js";

/**
 * Trial Forge: turn ANY Observatory world into a shareable Calibration Trial.
 * The goal is never a number the author types in; it is a verdict of an instrument the Observatory already
 * trusts (loop stability audit, energy account, zeta clock fix). A trial can therefore only be passed by
 * making the world actually satisfy that audit, and it can only be published if its author has shown a world
 * that passes while the start state fails (a solvability witness checked at seal time).
 */
export type GoalKind = "damped" | "marginal" | "passive" | "conserved" | "baseline" | "flat";
export const GOAL_KINDS: GoalKind[] = ["damped", "marginal", "passive", "conserved", "baseline", "flat"];

export interface Goal { kind: GoalKind; /** emitter the audit reads (conserved, baseline) */ target?: string }

/**
 * Structure the solver must not simply delete: derived from the start world, never typed by the author.
 * `sky` (flat goals only) is the whole start world: the player may move the probe, not rewrite the universe.
 */
export interface Keep { taps: number; dim: number; sky?: string }

/** Where the probe sits (root plane coordinates, plus hidden coordinates in bulk worlds). */
export interface ProbePos { x: number; y: number; z?: number; w?: number }
export const DEFAULT_PROBE: ProbePos = { x: 50, y: 50 };
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
/** The lab's probe as a link-safe position (rounded; hidden coordinates only when non-zero). */
export const probeOf = (l: Lab): ProbePos => ({
  x: r3(l.probe[0]), y: r3(l.probe[1]),
  ...(l.spec.bulk && l.probeZ !== 0 ? { z: r3(l.probeZ) } : {}), ...(l.spec.bulk2 && l.probeW !== 0 ? { w: r3(l.probeW) } : {}),
});
const isDefaultProbe = (p: ProbePos): boolean => p.x === DEFAULT_PROBE.x && p.y === DEFAULT_PROBE.y && !p.z && !p.w;
function putProbe(l: Lab, p: ProbePos): void {
  l.probe = [p.x, p.y]; l.probeZ = l.spec.bulk ? p.z ?? 0 : 0; l.probeW = l.spec.bulk2 ? p.w ?? 0 : 0;
  l.arrivals.clear(); l.rays.clear(); l.bent.clear(); l.tri = null;
}
/** Applies a trial's starting probe position to a fresh lab. */
export const placeProbe = putProbe;

export interface CustomTrial {
  v: 1; name: string; goal: Goal; /** scrub time the trial is set at */ t: number; world: WorldSpec;
  /** where the probe starts (flat goals; absent = the default probe) */
  probe?: ProbePos;
}

export const MIN_TAP_GAIN = 0.25;
export const DAMPED_RATE = -0.01;
const NAME_MAX = 28;

const GOAL_TITLE: Record<GoalKind, string> = {
  damped: "Damp the loop", marginal: "Ring forever", passive: "Make it passive", conserved: "Conserve energy", baseline: "Quiet the clock", flat: "Clear the sightline",
};
export const goalTitle = (k: GoalKind): string => GOAL_TITLE[k];

export const keepOf = (spec: WorldSpec, goal?: Goal): Keep => ({
  taps: spec.emitters.filter((e) => e.fb).length, dim: lawsOf(spec).dim,
  ...(goal?.kind === "flat" ? { sky: packJson(roundWorld(spec)) } : {}),
});

/** Why a goal cannot be set on this world (empty = it can). */
export function goalProblems(spec: WorldSpec, g: Goal): string[] {
  const taps = spec.emitters.filter((e) => e.fb).length;
  const target = g.target === undefined ? undefined : spec.emitters.find((e) => e.id === g.target);
  switch (g.kind) {
    case "damped": case "marginal": return taps > 0 ? [] : ["needs a feedback loop (LOOP tool)"];
    case "passive": return taps > 0 ? [] : ["needs at least one feedback tap (LOOP tool)"];
    case "conserved": return target ? [] : ["select the emitter whose energy is audited"];
    case "baseline": return target && target.zeta !== undefined ? [] : ["select a zeta beacon (ZETA)"];
    case "flat": return target ? [] : ["select the emitter the array locates"];
    default: return ["unknown goal"];
  }
}

const rate = (r: number): string => `${r >= 0 ? "+" : ""}${r.toFixed(3)}/s`;

/** Judge a lab against a goal. Pure: reads only the Observatory's own audits. */
export function checkGoal(lab: Lab, goal: Goal, keep: Keep): TrialState {
  const taps = lab.spec.emitters.filter((e) => e.fb);
  switch (goal.kind) {
    case "damped": case "marginal": {
      if (!hasFeedback(lab) || taps.length < keep.taps) return { ok: false, status: "a tap was removed: keep the loop, tame it" };
      const w = feedbackAudit(lab).worst;
      if (!w) return { ok: false, status: "no loop left: keep it" };
      const ok = goal.kind === "damped" ? w.verdict === "damped" && w.rate <= DAMPED_RATE : w.verdict === "marginal";
      const need = goal.kind === "damped" ? "need damped, faster than -0.010/s" : "need marginal, within ±0.002/s";
      return { ok, status: `${w.verdict.toUpperCase()} ${rate(w.rate)} · ${need}` };
    }
    case "passive": {
      if (taps.length < keep.taps) return { ok: false, status: "a tap was removed: keep them all" };
      const weak = taps.some((e) => (e.fb?.gain ?? 0) < MIN_TAP_GAIN);
      const a = feedbackAudit(lab);
      const sum = taps.reduce((s, e) => s + (e.fb?.gain ?? 0), 0);
      return { ok: !a.amplifier && !weak, status: `${a.amplifier ? "✗ energy created" : "✓ passive"} · fan-out ${sum.toFixed(2)} · need passive, each tap ≥ ${MIN_TAP_GAIN.toFixed(2)}` };
    }
    case "conserved": {
      const au = goal.target ? auditEmitter(lab, goal.target) : null;
      if (!au) return { ok: false, status: "no pulse heard from the audited emitter yet" };
      const L = lawsOf(lab.spec);
      const v = au.audit.verdict;
      return { ok: v === "conserved" && L.dim === keep.dim, status: `energy ${v.toUpperCase()} · DIM ${L.dim} · need conserved at DIM ${keep.dim}` };
    }
    case "baseline": {
      const f = goal.target ? zetaFix(lab, goal.target) : null;
      if (!f || !f.fix) return { ok: false, status: "probe is still listening…" };
      return { ok: f.verdict === "baseline" && f.identified, status: `${f.verdict.toUpperCase()} · deviation ${(f.deviation * 100).toFixed(2)}% · need baseline (< 0.30%)` };
    }
    case "flat": {
      if (keep.sky !== undefined && packJson(roundWorld(lab.spec)) !== keep.sky) return { ok: false, status: "the sky was changed: only the probe may move" };
      const tr = goal.target ? triangulate(lab, goal.target) : null;
      if (!tr) return { ok: false, status: "array listening…" };
      return { ok: tr.verdict === "flat", status: `${tr.verdict.toUpperCase()} · misfit ${tr.fix.residual.toFixed(4)}s · need flat (≤ 0.0001s)` };
    }
    default: return { ok: false, status: "unknown goal" };
  }
}

/** Strict probe parse: undefined = absent, null = malformed. Hidden coordinates need the matching hidden axis. */
function parseProbe(raw: unknown, world: WorldSpec): ProbePos | undefined | null {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const q = raw as Record<string, unknown>;
  const fin = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!fin(q.x, 0, 100) || !fin(q.y, 0, 100)) return null;
  const p: ProbePos = { x: r3(q.x), y: r3(q.y) };
  if (q.z !== undefined) { if (!world.bulk || !fin(q.z, -40, 40)) return null; p.z = r3(q.z); }
  if (q.w !== undefined) { if (!world.bulk2 || !fin(q.w, -40, 40)) return null; p.w = r3(q.w); }
  return Object.keys(q).every((k) => k === "x" || k === "y" || k === "z" || k === "w") ? p : null;
}

const clean = (s: string): string => s.replace(/[^A-Za-z0-9 ·\-]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

export function briefOf(goal: Goal, keep: Keep): string {
  const taps = keep.taps === 1 ? "the tap" : `all ${keep.taps} taps`;
  switch (goal.kind) {
    case "damped": return `Make this loop die out, faster than -0.010/s. Keep ${taps}; do not delete the loop.`;
    case "marginal": return `Tune this loop so it rings forever: neither fading nor growing. Keep ${taps}.`;
    case "passive": return `Together the taps send out more energy than they hear. Make the world passive; keep ${taps}, each at gain 0.25 or more.`;
    case "conserved": return `The audit of ${goal.target} does not conserve energy. Make it read conserved and keep DIM at ${keep.dim}.`;
    case "baseline": return `${goal.target} is a zeta beacon whose timing is not arithmetic. Make the probe's FIX read baseline.`;
    case "flat": return `The sky bends the echoes of ${goal.target}, so the probe array misreads it. Move the probe until TRI reads FLAT. Leave the sky alone.`;
    default: return "";
  }
}

export type ForgeResult = { ok: true; trial: CustomTrial } | { ok: false; why: string };

/**
 * Seal a trial. `start` is the broken world as the author left it, `solved` the lab the author then repaired.
 * Refuses unless the goal is settable, the start FAILS it and the solved world PASSES it (the witness).
 */
export function forge(name: string, goal: Goal, t: number, start: WorldSpec, solved: WorldSpec, startProbe?: ProbePos, solvedProbe?: ProbePos): ForgeResult {
  // judge both worlds exactly as a player will meet them: rounded for the link, default probe, the trial's scrub time
  const world = parseWorld(roundWorld(start)), fixed = parseWorld(roundWorld(solved));
  if (!world || !fixed) return { ok: false, why: "that world is not shareable" };
  const problems = goalProblems(world, goal);
  if (problems.length > 0) return { ok: false, why: problems[0] };
  const tt = Math.min(TMAX, Math.max(0, Math.round(t * 10) / 10));
  const keep = keepOf(world, goal);
  const flat = goal.kind === "flat";
  const sp = flat ? roundProbe(startProbe ?? DEFAULT_PROBE) : undefined;
  if (judge(world, goal, keep, tt, sp).ok) return { ok: false, why: "the start already passes: break it first" };
  const w = judge(fixed, goal, keep, tt, flat ? roundProbe(solvedProbe ?? sp ?? DEFAULT_PROBE) : undefined);
  if (!w.ok) return { ok: false, why: `not solved yet · ${w.status}` };
  return { ok: true, trial: { v: 1, name: clean(name) || `Custom ${goalTitle(goal.kind)}`, goal: { ...goal }, t: tt, world, ...(sp && !isDefaultProbe(sp) ? { probe: sp } : {}) } };
}

const roundProbe = (p: ProbePos): ProbePos => ({ x: r3(p.x), y: r3(p.y), ...(p.z ? { z: r3(p.z) } : {}), ...(p.w ? { w: r3(p.w) } : {}) });

/**
 * Judge a bare world with a fresh lab, as every player of a shared trial sees it: the default probe, except for
 * flat goals, whose whole point is where the probe stands.
 */
export function judge(world: WorldSpec, goal: Goal, keep: Keep, t: number, probe?: ProbePos): TrialState {
  const l = newLab(world);
  l.t = t;
  if (goal.kind === "flat" && probe) putProbe(l, probe);
  return checkGoal(l, goal, keep);
}

/** Does this world already satisfy the goal at scrub time t (a trial must start broken)? */
export const startsSolved = (world: WorldSpec, goal: Goal, t: number, probe?: ProbePos): boolean => judge(world, goal, keepOf(world, goal), t, probe).ok;

/** The runnable Trial for a custom spec (same shape as the built-in ones). */
export function asTrial(ct: CustomTrial): Trial {
  const keep = keepOf(ct.world, ct.goal);
  return {
    id: "custom", name: ct.name, brief: briefOf(ct.goal, keep), t: ct.t, ...(ct.probe ? { probe: ct.probe } : {}),
    world: () => parseWorld(JSON.parse(JSON.stringify(ct.world))) as WorldSpec,
    check: (lab) => checkGoal(lab, ct.goal, keep),
  };
}

export const encodeTrial = (ct: CustomTrial): string =>
  packJson({ v: 1, n: ct.name, g: ct.goal.kind, e: ct.goal.target, t: ct.t, w: roundWorld(ct.world), ...(ct.probe ? { p: ct.probe } : {}) });

/** Strict parse of an untrusted link. Null on any problem, including a trial that is already solved on arrival. */
export function decodeTrial(s: string): CustomTrial | null {
  try {
    const j = unpackJson(s) as { v?: unknown; n?: unknown; g?: unknown; e?: unknown; t?: unknown; w?: unknown; p?: unknown } | undefined;
    if (!j || typeof j !== "object" || j.v !== 1) return null;
    if (typeof j.g !== "string" || !GOAL_KINDS.includes(j.g as GoalKind)) return null;
    if (typeof j.t !== "number" || !Number.isFinite(j.t) || j.t < 0 || j.t > TMAX) return null;
    if (j.e !== undefined && typeof j.e !== "string") return null;
    const world = parseWorld(j.w);
    if (!world) return null;
    const goal: Goal = { kind: j.g as GoalKind, ...(j.e === undefined ? {} : { target: j.e }) };
    if (goalProblems(world, goal).length > 0) return null;
    const probe = parseProbe(j.p, world);
    if (probe === null || (probe !== undefined && goal.kind !== "flat")) return null;
    if (startsSolved(world, goal, j.t, probe)) return null;
    return { v: 1, name: clean(typeof j.n === "string" ? j.n : "") || `Custom ${goalTitle(goal.kind)}`, goal, t: j.t, world, ...(probe ? { probe } : {}) };
  } catch {
    return null;
  }
}
