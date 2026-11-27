import { StrataTree } from "../core/strata/index.js";
import { LAWFUL, cloneLaws, isLawful, parseLaws, validateLaws } from "../core/laws/index.js";
import type { Laws } from "../core/laws/index.js";

export interface DomainDef {
  id: string;
  parent: string;
  origin: [number, number];
  scale: number;
  extent: number;
  echoSpeed: number;
  rate: number;
  /** null = no shear; otherwise rate multiplier at the centre (rises linearly to 1 at the rim) */
  shearMin: number | null;
  /** [parentTime, rate] clock-drift events, ascending */
  changes: [number, number][];
}

export interface EmitterDef {
  id: string;
  domain: string;
  /** position in the emitter's own domain coordinates */
  pos: [number, number];
  /** period in the emitter's own local time */
  period: number;
  phase: number;
  hue: number;
  /** Relay: instead of its own clock it re-emits (after `delay` of its own local time) each pulse it hears from `from`. */
  relay?: { from: string; delay: number };
  /**
   * Feedback tap: whatever this emitter does, it ALSO re-emits every pulse it hears from `from` (any emitter,
   * itself included) after `delay` of its own local time, amplitude x `gain`. Taps may form cycles.
   */
  fb?: { from: string; delay: number; gain: number };
  /**
   * Arithmetic beacon: instead of a metronome, pulse k launches at phase + zeta x gamma_k (gamma_k = the k-th
   * non-trivial zero of the Riemann zeta function, 14.13, 21.02, 25.01, ...). Free-running emitters only.
   */
  zeta?: number;
  /** Height off the plane in the hidden third dimension (domain-local units). Only meaningful when the world is bulk. */
  z?: number;
  /** Position along the SECOND hidden axis (a 4-dimensional world). Only meaningful when the world is bulk2. */
  w?: number;
}

/** A suppressed pulse: emitter's k-th pulse never happens (and nothing it would have caused does). */
export interface Cut { emitter: string; k: number }

export interface WorldSpec {
  v: 1;
  rootSpeed: number;
  domains: DomainDef[];
  emitters: EmitterDef[];
  /** The rules this world runs under. Absent = LAWFUL (older links). */
  laws?: Laws;
  /** Pulses removed from history (causal interventions). Absent = none. */
  cuts?: Cut[];
  /** A 3-dimensional world whose plane the picture is a slice of: emitters/probe may sit off it. Absent = flat. */
  bulk?: boolean;
  /** A 4-dimensional world: a second hidden axis on top of `bulk`. Absent = at most one hidden axis. */
  bulk2?: boolean;
}

/** Number of hidden axes (0, 1 or 2): the world has 2 + this many dimensions. */
export const hiddenAxes = (spec: { bulk?: boolean; bulk2?: boolean }): number => (spec.bulk ? 1 : 0) + (spec.bulk && spec.bulk2 ? 1 : 0);

export const lawsOf = (spec: WorldSpec): Laws => spec.laws ?? LAWFUL;

export const LIMITS = { domains: 24, emitters: 24, changes: 8, cuts: 24, fbDelay: 30, fbGain: 4, zetaMin: 0.2, zetaMax: 5 };

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && fin(x[0]) && fin(x[1]);

/** Human-readable problems; empty array = valid. Parents must precede children. */
export function validate(spec: WorldSpec): string[] {
  const errs: string[] = [];
  if (spec.v !== 1) errs.push("unsupported version");
  if (!fin(spec.rootSpeed) || spec.rootSpeed <= 0) errs.push("rootSpeed must be > 0");
  if (spec.domains.length > LIMITS.domains) errs.push("too many domains");
  if (spec.emitters.length > LIMITS.emitters) errs.push("too many emitters");
  if (spec.laws) errs.push(...validateLaws(spec.laws));
  const ids = new Set<string>(["root"]);
  for (const d of spec.domains) {
    if (!d.id || ids.has(d.id)) errs.push(`bad/duplicate domain id ${d.id}`);
    if (!ids.has(d.parent)) errs.push(`domain ${d.id}: unknown or later parent ${d.parent}`);
    if (!pair(d.origin)) errs.push(`domain ${d.id}: bad origin`);
    for (const [k, v] of [["scale", d.scale], ["extent", d.extent], ["echoSpeed", d.echoSpeed], ["rate", d.rate]] as const) {
      if (!fin(v) || v <= 0) errs.push(`domain ${d.id}: ${k} must be > 0`);
    }
    if (d.shearMin !== null && (!fin(d.shearMin) || d.shearMin <= 0 || d.shearMin > 1)) errs.push(`domain ${d.id}: shearMin in (0,1]`);
    if (d.changes.length > LIMITS.changes) errs.push(`domain ${d.id}: too many clock changes`);
    let prev = -Infinity;
    for (const c of d.changes) {
      if (!pair(c) || c[0] < prev || c[1] <= 0) errs.push(`domain ${d.id}: bad clock change`);
      else prev = c[0];
    }
    ids.add(d.id);
  }
  const eids = new Set<string>();
  for (const e of spec.emitters) {
    if (!e.id || eids.has(e.id)) errs.push(`bad/duplicate emitter id ${e.id}`);
    eids.add(e.id);
    if (!ids.has(e.domain)) errs.push(`emitter ${e.id}: unknown domain ${e.domain}`);
    if (!pair(e.pos)) errs.push(`emitter ${e.id}: bad pos`);
    if (!fin(e.period) || e.period <= 0) errs.push(`emitter ${e.id}: period must be > 0`);
    if (!fin(e.phase) || e.phase < 0) errs.push(`emitter ${e.id}: phase must be >= 0`);
    if (!fin(e.hue)) errs.push(`emitter ${e.id}: bad hue`);
    if (e.z !== undefined && (!fin(e.z) || Math.abs(e.z) > 200 || (!spec.bulk && e.z !== 0))) errs.push(`emitter ${e.id}: bad depth`);
    if (e.w !== undefined && (!fin(e.w) || Math.abs(e.w) > 200 || (!spec.bulk2 && e.w !== 0))) errs.push(`emitter ${e.id}: bad second depth`);
  }
  if (spec.bulk !== undefined && spec.bulk !== true) errs.push("bulk must be true or absent");
  if (spec.bulk2 !== undefined && spec.bulk2 !== true) errs.push("bulk2 must be true or absent");
  if (spec.bulk2 && !spec.bulk) errs.push("bulk2 needs bulk");
  const byId = new Map(spec.emitters.map((e) => [e.id, e]));
  for (const e of spec.emitters) {
    if (e.relay === undefined) continue;
    const r = e.relay;
    if (!r || typeof r !== "object" || typeof r.from !== "string" || !fin(r.delay) || r.delay < 0) {
      errs.push(`emitter ${e.id}: bad relay`);
      continue;
    }
    if (!byId.has(r.from)) { errs.push(`emitter ${e.id}: relay source ${r.from} unknown`); continue; }
    let x: EmitterDef | undefined = e, n = 0;
    while (x && x.relay && n++ <= spec.emitters.length) x = byId.get(x.relay.from);
    if (n > spec.emitters.length) errs.push(`emitter ${e.id}: relay cycle`);
  }
  for (const e of spec.emitters) {
    if (e.zeta === undefined) continue;
    if (!fin(e.zeta) || e.zeta < LIMITS.zetaMin || e.zeta > LIMITS.zetaMax) errs.push(`emitter ${e.id}: bad zeta scale`);
    else if (e.relay) errs.push(`emitter ${e.id}: a relay follows its source, it cannot keep zeta time`);
  }
  for (const e of spec.emitters) {
    if (e.fb === undefined) continue;
    const f = e.fb;
    if (!f || typeof f !== "object" || typeof f.from !== "string" || !fin(f.delay) || f.delay < 0 || f.delay > LIMITS.fbDelay
      || !fin(f.gain) || f.gain <= 0 || f.gain > LIMITS.fbGain) errs.push(`emitter ${e.id}: bad feedback`);
    else if (!byId.has(f.from)) errs.push(`emitter ${e.id}: feedback source ${f.from} unknown`);
  }
  if (spec.cuts !== undefined) {
    if (!Array.isArray(spec.cuts) || spec.cuts.length > LIMITS.cuts) errs.push("bad or too many cuts");
    else for (const c of spec.cuts) {
      if (!c || !byId.has(c.emitter) || !Number.isInteger(c.k) || c.k < 1) errs.push("bad cut");
    }
  }
  return errs;
}

/** Build the strata under the world's laws: same data, different physics. */
export function buildTree(spec: WorldSpec): StrataTree {
  const laws = lawsOf(spec);
  const hid = hiddenAxes(spec), pad = Array.from({ length: hid }, () => 0);
  const t = new StrataTree(2 + hid, spec.rootSpeed);
  const globalTime = laws.time === "global", uniform = laws.medium === "uniform";
  for (const d of spec.domains) {
    const radLocal = d.extent * d.scale;
    const sm = uniform ? null : d.shearMin;
    // uniform medium: pick the local echo speed that makes the ROOT speed equal rootSpeed everywhere
    const rplChild = t.get(d.parent).rootPerLocal / d.scale;
    t.add({
      id: d.id, parent: d.parent, origin: hid > 0 ? [d.origin[0], d.origin[1], ...pad] : d.origin, scale: d.scale, extent: d.extent,
      echoSpeed: uniform ? spec.rootSpeed / rplChild : d.echoSpeed, rate: globalTime ? 1 : d.rate,
      shear: sm === null ? undefined : (p) => sm + (1 - sm) * Math.min(1, Math.hypot(...p) / radLocal),
    });
  }
  if (!globalTime) for (const d of spec.domains) for (const [tm, rt] of d.changes) t.setRate(d.id, tm, rt);
  return t;
}

/** Ids of domains that are shear wells (information noise lives there). */
export const wellIds = (spec: WorldSpec): Set<string> => new Set(spec.domains.filter((d) => d.shearMin !== null).map((d) => d.id));

export function defaultWorld(): WorldSpec {
  return {
    v: 1, rootSpeed: 6,
    domains: [
      { id: "d1", parent: "root", origin: [30, 58], scale: 1, extent: 18, echoSpeed: 6, rate: 3, shearMin: null, changes: [[30, 1.5]] },
      { id: "d2", parent: "root", origin: [72, 34], scale: 1, extent: 15, echoSpeed: 6, rate: 1, shearMin: 0.2, changes: [] },
    ],
    emitters: [
      { id: "e1", domain: "root", pos: [12, 12], period: 4, phase: 0, hue: 190 },
      { id: "e2", domain: "d1", pos: [-6, 8], period: 12, phase: 2, hue: 40 },
      { id: "e3", domain: "d2", pos: [5, -4], period: 4.4, phase: 0.6, hue: 300 },
      { id: "e4", domain: "root", pos: [88, 88], period: 5.2, phase: 1.2, hue: 130 },
    ],
  };
}

/** Strict structural parse + validate; null on any problem. */
export function parseWorld(raw: unknown): WorldSpec | null {
  try {
    const j = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<WorldSpec> | null;
    if (!j || typeof j !== "object" || !Array.isArray(j.domains) || !Array.isArray(j.emitters)) return null;
    const laws = parseLaws(j.laws);
    if (!laws) return null;
    const spec: WorldSpec = {
      v: j.v as 1, rootSpeed: j.rootSpeed as number,
      domains: j.domains.map((d) => ({
        id: String(d.id), parent: String(d.parent), origin: d.origin, scale: d.scale, extent: d.extent,
        echoSpeed: d.echoSpeed, rate: d.rate, shearMin: d.shearMin === undefined ? null : d.shearMin,
        changes: Array.isArray(d.changes) ? d.changes : [],
      })),
      emitters: j.emitters.map((e) => ({
        id: String(e.id), domain: String(e.domain), pos: e.pos, period: e.period, phase: e.phase, hue: e.hue,
        ...(e.z === undefined ? {} : { z: e.z }),
        ...(e.w === undefined ? {} : { w: e.w }),
        ...(e.zeta === undefined ? {} : { zeta: e.zeta }),
        ...(e.fb === undefined ? {} : { fb: e.fb && typeof e.fb === "object" ? { from: String((e.fb as { from: unknown }).from), delay: (e.fb as { delay: number }).delay, gain: (e.fb as { gain: number }).gain } : (e.fb as never) }),
        ...(e.relay === undefined ? {} : { relay: e.relay && typeof e.relay === "object" ? { from: String((e.relay as { from: unknown }).from), delay: (e.relay as { delay: number }).delay } : (e.relay as never) }),
      })),
      ...(isLawful(laws) ? {} : { laws }),
      ...(j.bulk === undefined ? {} : { bulk: j.bulk as true }),
      ...(j.bulk2 === undefined ? {} : { bulk2: j.bulk2 as true }),
      ...(Array.isArray(j.cuts) && j.cuts.length > 0 ? { cuts: j.cuts.map((c) => ({ emitter: String(c?.emitter), k: c?.k as number })) } : {}),
    };
    if (validate(spec).length > 0) return null;
    buildTree(spec);
    return spec;
  } catch {
    return null;
  }
}

// ---- compact link encoding (base64url of UTF-8 JSON) ----
const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (str: string): Uint8Array => {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const r2 = (x: number) => Math.round(x * 1000) / 1000;

/** The spec with every number rounded for a compact, stable link. */
export function roundWorld(spec: WorldSpec): WorldSpec {
  return {
    v: spec.v, rootSpeed: r2(spec.rootSpeed),
    ...(spec.laws && !isLawful(spec.laws) ? { laws: cloneLaws(spec.laws) } : {}),
    domains: spec.domains.map((d) => ({
      ...d, origin: [r2(d.origin[0]), r2(d.origin[1])], scale: r2(d.scale), extent: r2(d.extent),
      echoSpeed: r2(d.echoSpeed), rate: r2(d.rate), shearMin: d.shearMin === null ? null : r2(d.shearMin),
      changes: d.changes.map(([t, r]) => [r2(t), r2(r)] as [number, number]),
    })),
    emitters: spec.emitters.map((e) => ({
      ...e, pos: [r2(e.pos[0]), r2(e.pos[1])], period: r2(e.period), phase: r2(e.phase), hue: Math.round(e.hue),
      ...(e.relay ? { relay: { from: e.relay.from, delay: r2(e.relay.delay) } } : {}),
      ...(e.z !== undefined ? { z: r2(e.z) } : {}),
      ...(e.w !== undefined ? { w: r2(e.w) } : {}),
      ...(e.zeta !== undefined ? { zeta: r2(e.zeta) } : {}),
      ...(e.fb ? { fb: { from: e.fb.from, delay: r2(e.fb.delay), gain: r2(e.fb.gain) } } : {}),
    })),
    ...(spec.bulk ? { bulk: true as const } : {}),
    ...(spec.bulk && spec.bulk2 ? { bulk2: true as const } : {}),
    ...(spec.cuts && spec.cuts.length > 0 ? { cuts: spec.cuts.map((c) => ({ emitter: c.emitter, k: c.k })) } : {}),
  };
}

export function encodeWorld(spec: WorldSpec): string {
  return b64(new TextEncoder().encode(JSON.stringify(roundWorld(spec))));
}

/** Any JSON value <-> base64url (shared by world and trial links). */
export const packJson = (o: unknown): string => b64(new TextEncoder().encode(JSON.stringify(o)));
export function unpackJson(s: string): unknown {
  try { return JSON.parse(new TextDecoder().decode(unb64(s))); } catch { return undefined; }
}

export function decodeWorld(s: string): WorldSpec | null {
  try {
    return parseWorld(new TextDecoder().decode(unb64(s)));
  } catch {
    return null;
  }
}
