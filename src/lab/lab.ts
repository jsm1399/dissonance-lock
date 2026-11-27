import { FB_BASE, analyzeFeedback, arrivalField, countInversions, calibrateBeacon, fermatField, lagSpread, locateND, locateSource, march, runFeedback, sampleField, zeroCountUpTo, zetaZero } from "../core/strata/index.js";
import type { Arrival, ArrivalField, BeaconFix, LocateFix, FbAudit, FbEdge, FbNode, FbPulse, FbResult, FbSeed, StrataTree, Vec } from "../core/strata/index.js";
import { DIM_MAX, DIM_MIN, LAWFUL, LOSS_STEPS, NOISE_STEPS, auditRay, consistentLaws, fitDelay, fitNoise, fitSpreading } from "../core/laws/index.js";
import type { DelayFit, LawGuess, Laws, RayAudit, SpreadFit } from "../core/laws/index.js";
import { LIMITS, buildTree, defaultWorld, lawsOf, wellIds } from "./world.js";
import { isLawful } from "../core/laws/index.js";
import type { DomainDef, EmitterDef, WorldSpec } from "./world.js";

export const SIZE = 100;
export const TMAX = 240;
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const MARCH = { maxStep: 1 };

export type Tool = "select" | "fast" | "well" | "micro" | "emit" | "relay" | "loop" | "erase";
export interface Sel { kind: "domain" | "emitter" | "probe"; id: string }

export interface Emission {
  emitter: string;
  hue: number;
  k: number;
  domain: string;
  /** emitter position in its own domain coords */
  pos: Vec;
  launchLocal: number;
  launchRoot: number;
  /** strength relative to an independent pulse (feedback echoes only) */
  amp?: number;
  /** "emitter|k" of the pulse that caused this echo (feedback echoes only) */
  cause?: string;
}

export interface Perceived { emission: Emission; arrival: number; lag: number }

export interface Lab {
  spec: WorldSpec;
  tree: StrataTree;
  t: number;
  playing: boolean;
  speedIdx: number;
  probe: Vec;
  /** probe height off the plane (bulk worlds only) */
  probeZ: number;
  sel: Sel | null;
  tool: Tool;
  seq: number;
  heat: { emitter: string; k: number; launchLocal: number; field: ArrivalField } | null;
  /** bumps on every structural change (caches key off it) */
  rev: number;
  arrivals: Map<string, number>;
  /** full marches (with per-domain path segments) for the current probe */
  rays: Map<string, Arrival>;
  /** bent-path (Fermat) arrival fields per emission, valid for the current rev */
  fields: Map<string, ArrivalField>;
  /** bent arrival at the current probe, per emission */
  bent: Map<string, number>;
  /** bent fields still being solved (0 = all ready) */
  pending: number;
  /** launch times per pulse ("emitter|k"), null = never happens (cut or caused by a cut); valid for the current rev */
  launches: Map<string, Launch | null>;
  /** feedback cascade of the current rev (null = not computed yet) */
  fb: FbCache | null;
  /** stability audit of the feedback graph, keyed by rev and scrub time */
  fbAudit: { key: string; value: FbAudit } | null;
  /** law inference for one emitter, keyed by rev and emitter */
  lawFit: { key: string; value: LawFitResult | null } | null;
  /** array triangulation, keyed by rev, emitter, probe and scrub time */
  tri: { key: string; value: TriResult | null } | null;
}

export interface FbCache { result: FbResult; byNode: Map<string, FbEcho[]>; byKey: Map<string, FbEcho> }
export type FbEcho = FbPulse;

export interface Launch { launchLocal: number; launchRoot: number }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampPt = (p: Vec): Vec => [clamp(p[0], 0, SIZE), clamp(p[1], 0, SIZE)];

export function newLab(spec: WorldSpec = defaultWorld()): Lab {
  let seq = 1;
  for (const id of [...spec.domains.map((d) => d.id), ...spec.emitters.map((e) => e.id)]) {
    const n = Number(id.replace(/\D/g, ""));
    if (Number.isFinite(n)) seq = Math.max(seq, n + 1);
  }
  return {
    spec, tree: buildTree(spec), t: 0, playing: false, speedIdx: 2, probe: [50, 50], probeZ: 0, sel: null, tool: "select",
    seq, heat: null, rev: 0, arrivals: new Map(), rays: new Map(), fields: new Map(), bent: new Map(), pending: 0, launches: new Map(), fb: null, fbAudit: null, lawFit: null, tri: null,
  };
}

// ---------- bulk (hidden third dimension) ----------
/** A point of the plane, lifted into the tree's dimension. */
export const at3 = (lab: Lab, p: Vec): Vec => (lab.spec.bulk ? [p[0], p[1], 0] : [p[0], p[1]]);
/** Emitter site in its domain's own coordinates (3D when the world is bulk). */
export const emitterPos = (lab: Lab, e: EmitterDef): Vec => (lab.spec.bulk ? [e.pos[0], e.pos[1], e.z ?? 0] : e.pos);
export const probeSite = (lab: Lab): Vec => (lab.spec.bulk ? [lab.probe[0], lab.probe[1], lab.probeZ] : lab.probe);
/** Straight-line root distance between two root-frame points of the tree's dimension. */
export const dist = (a: Vec, b: Vec): number => Math.hypot(...a.map((x, i) => x - (b[i] ?? 0)));

export const DEPTH_MAX = 40;

/** Lift the world into / out of the hidden dimension. Keeps the laws honest: space of 3 wants flux ~ r^-2. */
export function toggleBulk(lab: Lab): boolean {
  if (lab.spec.bulk) {
    delete lab.spec.bulk;
    for (const e of lab.spec.emitters) delete e.z;
    lab.probeZ = 0;
    if (lab.spec.laws && lab.spec.laws.dim === 3) lab.spec.laws = { ...lab.spec.laws, dim: 2 };
  } else {
    lab.spec.bulk = true;
    const cur = lawsOf(lab.spec);
    if (cur.dim === 2) lab.spec.laws = { ...cur, dim: 3 };
  }
  if (lab.spec.laws && isLawful(lab.spec.laws)) delete lab.spec.laws;
  rebuild(lab);
  return lab.spec.bulk === true;
}

/** Move the selection along the hidden axis by `dz` (emitters and the probe). False if not allowed. */
export function setDepth(lab: Lab, sel: Sel, dz: number): boolean {
  if (!lab.spec.bulk) return false;
  if (sel.kind === "probe") {
    lab.probeZ = clamp(lab.probeZ + dz, -DEPTH_MAX, DEPTH_MAX);
    lab.arrivals.clear(); lab.rays.clear(); lab.bent.clear();
    return true;
  }
  if (sel.kind !== "emitter") return false;
  const e = lab.spec.emitters.find((x) => x.id === sel.id);
  if (!e) return false;
  const z = clamp((e.z ?? 0) + dz, -DEPTH_MAX, DEPTH_MAX);
  if (z === 0) delete e.z; else e.z = z;
  rebuild(lab);
  return true;
}

export function rebuild(lab: Lab): void {
  lab.tree = buildTree(lab.spec);
  lab.heat = null;
  lab.arrivals.clear();
  lab.rays.clear();
  lab.fields.clear();
  lab.bent.clear();
  lab.launches.clear();
  lab.fb = null;
  lab.fbAudit = null;
  lab.lawFit = null;
  lab.tri = null;
  lab.rev++;
}

export function addDomain(lab: Lab, kind: "fast" | "well" | "micro", at: Vec): string | null {
  if (lab.spec.domains.length >= LIMITS.domains) return null;
  const parent = lab.tree.domainAt(at3(lab, at));
  if (kind === "micro" && !parent.parent) return null;
  const rpl = parent.rootPerLocal;
  const scale = kind === "micro" ? 8 : 1;
  let extentRoot = kind === "micro" ? 5 : 14;
  if (parent.parent) extentRoot = Math.min(extentRoot, parent.radiusRoot * 0.6);
  const o = lab.tree.toLocalPos(parent.id, at3(lab, at));
  const def: DomainDef = {
    id: `d${lab.seq++}`, parent: parent.id, origin: [o[0], o[1]], scale,
    extent: extentRoot / rpl, echoSpeed: (lab.spec.rootSpeed * scale) / rpl,
    rate: kind === "fast" ? 3 : kind === "micro" ? 2 : 1,
    shearMin: kind === "well" ? 0.2 : null, changes: [],
  };
  lab.spec.domains.push(def);
  rebuild(lab);
  return def.id;
}

export function addEmitter(lab: Lab, at: Vec): string | null {
  if (lab.spec.emitters.length >= LIMITS.emitters) return null;
  const dom = lab.tree.domainAt(at3(lab, at));
  const o = lab.tree.toLocalPos(dom.id, at3(lab, at));
  const period = 4 * lab.tree.rateToRoot(dom, 0);
  const n = lab.spec.emitters.length;
  const def: EmitterDef = {
    id: `e${lab.seq++}`, domain: dom.id, pos: [o[0], o[1]], period, phase: (n * 0.7) % period,
    hue: (190 + n * 67) % 360,
  };
  lab.spec.emitters.push(def);
  rebuild(lab);
  return def.id;
}

export function hitTest(lab: Lab, at: Vec): Sel | null {
  if (Math.hypot(at[0] - lab.probe[0], at[1] - lab.probe[1]) < 3) return { kind: "probe", id: "probe" };
  let best: Sel | null = null, bd = 3;
  for (const e of lab.spec.emitters) {
    const p = lab.tree.toRootPos(e.domain, emitterPos(lab, e));
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < bd) { bd = d; best = { kind: "emitter", id: e.id }; }
  }
  if (best) return best;
  const dom = lab.tree.domainAt(at3(lab, at));
  return dom.parent ? { kind: "domain", id: dom.id } : null;
}

export function moveSel(lab: Lab, sel: Sel, to: Vec): void {
  const at = clampPt(to);
  if (sel.kind === "probe") { lab.probe = at; lab.arrivals.clear(); lab.rays.clear(); lab.bent.clear(); return; }
  if (sel.kind === "emitter") {
    const e = lab.spec.emitters.find((x) => x.id === sel.id);
    if (!e) return;
    const o = lab.tree.toLocalPos(e.domain, at3(lab, at));
    e.pos = [o[0], o[1]];
  } else {
    const d = lab.spec.domains.find((x) => x.id === sel.id);
    if (!d) return;
    const o = lab.tree.toLocalPos(d.parent, at3(lab, at));
    d.origin = [o[0], o[1]];
  }
  rebuild(lab);
}

export function removeSel(lab: Lab, sel: Sel): void {
  if (sel.kind === "emitter") {
    pruneEmitters(lab, new Set([sel.id]));
  } else if (sel.kind === "domain") {
    const dead = new Set<string>([sel.id]);
    for (const d of lab.spec.domains) if (dead.has(d.parent)) dead.add(d.id); // parents precede children
    lab.spec.domains = lab.spec.domains.filter((d) => !dead.has(d.id));
    pruneEmitters(lab, new Set(lab.spec.emitters.filter((e) => dead.has(e.domain)).map((e) => e.id)));
  } else return;
  if (lab.sel && lab.sel.id === sel.id) lab.sel = null;
  rebuild(lab);
}

/** Remove emitters, everything that relays them (transitively), and their cuts. */
function pruneEmitters(lab: Lab, dead: Set<string>): void {
  for (let grew = true; grew;) {
    grew = false;
    for (const e of lab.spec.emitters) if (!dead.has(e.id) && e.relay && dead.has(e.relay.from)) { dead.add(e.id); grew = true; }
  }
  lab.spec.emitters = lab.spec.emitters.filter((e) => !dead.has(e.id));
  for (const e of lab.spec.emitters) if (e.fb && dead.has(e.fb.from)) delete e.fb;
  if (lab.spec.cuts) {
    lab.spec.cuts = lab.spec.cuts.filter((c) => !dead.has(c.emitter));
    if (lab.spec.cuts.length === 0) delete lab.spec.cuts;
  }
  if (lab.sel && dead.has(lab.sel.id)) lab.sel = null;
}

export type Knob = "size" | "rate" | "period";
export function adjust(lab: Lab, sel: Sel, what: Knob, dir: 1 | -1): void {
  if (sel.kind === "domain") {
    const d = lab.spec.domains.find((x) => x.id === sel.id);
    if (!d) return;
    if (what === "size") d.extent = clamp(d.extent * Math.pow(1.12, dir), 1, 60);
    else if (what === "rate") d.rate = clamp(d.rate * Math.pow(1.25, dir), 0.2, 8);
    else return;
  } else if (sel.kind === "emitter" && what === "period") {
    const e = lab.spec.emitters.find((x) => x.id === sel.id);
    if (!e) return;
    if (e.relay) e.relay.delay = clamp(Math.max(0.1, e.relay.delay) * Math.pow(1.25, -dir), 0, 30);
    else if (e.zeta !== undefined) e.zeta = clamp(Math.round(e.zeta * Math.pow(1.15, dir) * 1000) / 1000, LIMITS.zetaMin, LIMITS.zetaMax);
    else e.period = clamp(e.period * Math.pow(1.15, dir), 0.8, 60);
  } else return;
  rebuild(lab);
}

/** Schedule a clock-drift event for a domain at the current scrub time. False if it would predate an earlier drift. */
export function driftRate(lab: Lab, sel: Sel, factor: number): boolean {
  if (sel.kind !== "domain") return false;
  const d = lab.spec.domains.find((x) => x.id === sel.id);
  const dom = lab.tree.get(sel.id);
  if (!d || !dom.parent) return false;
  const pt = lab.tree.toLocalTime(dom.parent.id, lab.t);
  const last = d.changes[d.changes.length - 1];
  if (last && pt < last[0]) return false;
  const next = clamp(dom.clock.rateAt(pt) * factor, 0.2, 8);
  if (last && pt === last[0]) last[1] = next;
  else {
    if (d.changes.length >= LIMITS.changes) return false;
    d.changes.push([pt, next]);
  }
  rebuild(lab);
  return true;
}

const cutKey = (id: string, k: number) => `${id}|${k}`;
export const isCut = (lab: Lab, id: string, k: number): boolean => !!lab.spec.cuts?.some((c) => c.emitter === id && c.k === k);

/**
 * When pulse k of an emitter really launches. Free-running emitters follow their own clock; a relay launches
 * `delay` (its own local time) after the source's pulse k reaches it. Cut pulses, and pulses a cut would have
 * caused, never happen (null). `ignoreOwnCut` gives the nominal time of a cut pulse (for drawing the cut).
 */
export function launchOf(lab: Lab, id: string, k: number, ignoreOwnCut = false): Launch | null {
  if (k >= FB_BASE) {
    const p = feedbackOf(lab).byKey.get(cutKey(id, k));
    return p ? { launchLocal: p.launchLocal, launchRoot: p.launchRoot } : null;
  }
  const key = cutKey(id, k);
  if (!ignoreOwnCut) {
    const hit = lab.launches.get(key);
    if (hit !== undefined) return hit;
  }
  const e = lab.spec.emitters.find((x) => x.id === id);
  let out: Launch | null = null;
  if (e && (ignoreOwnCut || !isCut(lab, id, k))) {
    if (!e.relay) {
      const launchLocal = pulseLocal(e, k);
      if (Number.isFinite(launchLocal)) out = { launchLocal, launchRoot: lab.tree.toRootTime(e.domain, launchLocal) };
    } else {
      const src = lab.spec.emitters.find((x) => x.id === e.relay?.from);
      const sl = src ? launchOf(lab, src.id, k) : null;
      if (src && sl) {
        const heardAt = march(lab.tree, { domain: src.domain, pos: emitterPos(lab, src) }, sl.launchLocal, { domain: e.domain, pos: emitterPos(lab, e) }, MARCH).rootTime;
        const launchLocal = lab.tree.toLocalTime(e.domain, heardAt) + e.relay.delay;
        out = { launchLocal, launchRoot: lab.tree.toRootTime(e.domain, launchLocal) };
      }
    }
  }
  if (!ignoreOwnCut) lab.launches.set(key, out);
  return out;
}

// ---------- schedules: a metronome or the zeta zeros ----------
/** Local launch time of independent pulse k (1-based) of a free-running emitter. Infinity past the zero table. */
export function pulseLocal(e: EmitterDef, k: number): number {
  return e.zeta !== undefined ? e.phase + e.zeta * zetaZero(k) : e.phase + k * e.period;
}
/** Index of the newest independent pulse launched by local time tl (0 = none yet). */
export function pulseCount(e: EmitterDef, tl: number): number {
  if (e.zeta !== undefined) return zeroCountUpTo((tl - e.phase) / e.zeta);
  return Math.floor((tl - e.phase) / e.period);
}

/** Root of a relay chain: the free-running emitter that ultimately drives it. */
function driver(lab: Lab, e: EmitterDef): EmitterDef {
  let x = e;
  for (let n = 0; x.relay && n <= lab.spec.emitters.length; n++) {
    const up = lab.spec.emitters.find((q) => q.id === x.relay?.from);
    if (!up) break;
    x = up;
  }
  return x;
}

/** The latest `per` emissions of every emitter that have launched by root time `tRoot`. */
export function emissionsUpTo(lab: Lab, tRoot: number, per: number): Emission[] {
  const out: Emission[] = [];
  for (const e of lab.spec.emitters) {
    const d = driver(lab, e);
    const tl = lab.tree.toLocalTime(d.domain, tRoot);
    const kmax = pulseCount(d, tl);
    // a relay lags its driver by flight time + delay: scan back until `per` pulses have actually launched
    const kmin = e.relay ? Math.max(1, kmax - 400) : Math.max(1, kmax - per + 1);
    let n = 0;
    for (let k = kmax; k >= kmin && n < per; k--) {
      const L = launchOf(lab, e.id, k);
      if (!L || (e.relay && L.launchRoot > tRoot)) continue;
      n++;
      out.push({ emitter: e.id, hue: e.hue, k, domain: e.domain, pos: emitterPos(lab, e), launchLocal: L.launchLocal, launchRoot: L.launchRoot });
    }
  }
  // feedback echoes: the newest `per` of each emitter that have launched by tRoot
  const fb = feedbackOf(lab);
  if (fb.result.pulses.length > 0) {
    for (const e of lab.spec.emitters) {
      const list = fb.byNode.get(e.id);
      if (!list) continue;
      let n = 0;
      for (let i = list.length - 1; i >= 0 && n < per; i--) {
        const p = list[i];
        if (p.launchRoot > tRoot) continue;
        n++;
        out.push({ emitter: e.id, hue: e.hue, k: p.k, domain: e.domain, pos: emitterPos(lab, e), launchLocal: p.launchLocal, launchRoot: p.launchRoot, amp: p.amp, cause: p.cause });
      }
    }
  }
  return out;
}

/** Flatten a domain's clock: remove every scheduled drift (its rate stays at the initial value). */
export function clearDrifts(lab: Lab, id: string): boolean {
  const d = lab.spec.domains.find((x) => x.id === id);
  if (!d || d.changes.length === 0) return false;
  d.changes = [];
  rebuild(lab);
  return true;
}

// ---------- arithmetic reference (zeta beacons) ----------
export const hasZeta = (lab: Lab): boolean => lab.spec.emitters.some((e) => e.zeta !== undefined);

/** Switch a free-running emitter between a metronome and the zeta zeros. Relays follow their source and cannot. */
export function toggleZeta(lab: Lab, id: string): boolean | null {
  const e = lab.spec.emitters.find((x) => x.id === id);
  if (!e || e.relay) return null;
  if (e.zeta !== undefined) delete e.zeta; else e.zeta = 1;
  rebuild(lab);
  return e.zeta !== undefined;
}

export interface ZetaFix {
  emitter: string;
  /** consecutive pulses heard, and the true index of the first */
  heard: number;
  firstK: number;
  fix: BeaconFix | null;
  /** did the blind identification name the right zeros? */
  identified: boolean;
  /** sender clock rate estimated from the heard times alone, and the real one (local s per root s) */
  rateEst: number;
  rateTrue: number;
  /** residual as a fraction of the mean gap between heard pulses */
  deviation: number;
  verdict: "listening" | "ambiguous" | "baseline" | "bent" | "broken";
}

/** Blind calibration of a zeta beacon from what the probe has actually heard (default: selected, else first). */
export function zetaFix(lab: Lab, emitterId?: string): ZetaFix | null {
  const id = emitterId ?? (lab.sel?.kind === "emitter" && lab.spec.emitters.find((e) => e.id === lab.sel?.id)?.zeta !== undefined
    ? lab.sel.id : lab.spec.emitters.find((e) => e.zeta !== undefined)?.id);
  const e = lab.spec.emitters.find((x) => x.id === id);
  if (!e || e.zeta === undefined) return null;
  const heard = emissionsUpTo(lab, lab.t, 14).filter((m) => m.emitter === e.id && m.k < FB_BASE)
    .map((m) => ({ m, a: arrivalAt(lab, m) })).filter((x) => x.a <= lab.t).sort((x, y) => x.m.k - y.m.k);
  // the longest run of consecutive indices ending at the newest heard pulse
  const run: typeof heard = [];
  for (let i = heard.length - 1; i >= 0; i--) {
    if (run.length > 0 && heard[i].m.k !== run[0].m.k - 1) break;
    run.unshift(heard[i]);
  }
  const dom = lab.tree.get(e.domain);
  const base: ZetaFix = { emitter: e.id, heard: run.length, firstK: run[0]?.m.k ?? 0, fix: null, identified: false, rateEst: NaN, rateTrue: NaN, deviation: NaN, verdict: "listening" };
  if (run.length < 5) return base;
  const fix = calibrateBeacon(run.map((x) => x.a));
  if (!fix) return base;
  const mid = run[Math.floor(run.length / 2)].m.launchRoot;
  const gap = (run[run.length - 1].a - run[0].a) / (run.length - 1);
  const deviation = fix.residual / gap;
  // a badly misfitting beacon is simply broken; "ambiguous" is only for a clean fit that several zeros explain equally well
  const verdict: ZetaFix["verdict"] = deviation >= 0.03 ? "broken" : deviation >= 0.003 ? "bent" : fix.confidence < 1.5 ? "ambiguous" : "baseline";
  return {
    ...base, fix, identified: fix.offset === base.firstK, rateEst: e.zeta / fix.slope, rateTrue: lab.tree.rateToRoot(dom, mid), deviation, verdict,
  };
}

// ---------- feedback (cycles of cause and effect) ----------
const EMPTY_FB: FbResult = { pulses: [], injected: 0, emitted: 0, peak: 0, faded: 0, saturated: false, truncated: false };

export const hasFeedback = (lab: Lab): boolean => lab.spec.emitters.some((e) => e.fb !== undefined);
/** Pulses that are not echoes (clock pulses, relay pulses) can be cut; echoes are effects, so cut their cause. */
export const isEcho = (k: number): boolean => k >= FB_BASE;

function fbGraph(lab: Lab): { nodes: FbNode[]; edges: FbEdge[] } {
  const nodes: FbNode[] = lab.spec.emitters.map((e) => ({ id: e.id, site: { domain: e.domain, pos: emitterPos(lab, e) } }));
  const edges: FbEdge[] = [];
  for (const e of lab.spec.emitters) if (e.fb) edges.push({ from: e.fb.from, to: e.id, delay: e.fb.delay, gain: e.fb.gain });
  return { nodes, edges };
}

/** Every independent (clock or relay) pulse of `e` that launches by TMAX, cuts honoured. */
function seedsOf(lab: Lab, e: EmitterDef): FbSeed[] {
  const d = driver(lab, e);
  const kmax = pulseCount(d, lab.tree.toLocalTime(d.domain, TMAX));
  const out: FbSeed[] = [];
  for (let k = 1; k <= kmax; k++) {
    const L = launchOf(lab, e.id, k);
    if (L && L.launchRoot <= TMAX) out.push({ node: e.id, key: cutKey(e.id, k), launchLocal: L.launchLocal, launchRoot: L.launchRoot });
  }
  return out;
}

/** The full echo cascade of the world (event-driven, deterministic), cached per rev. */
export function feedbackOf(lab: Lab): FbCache {
  if (lab.fb) return lab.fb;
  let cache: FbCache = { result: EMPTY_FB, byNode: new Map(), byKey: new Map() };
  if (hasFeedback(lab)) {
    const { nodes, edges } = fbGraph(lab);
    const from = new Set(edges.map((x) => x.from));
    const seeds = lab.spec.emitters.filter((e) => from.has(e.id)).flatMap((e) => seedsOf(lab, e));
    const result = runFeedback(lab.tree, nodes, edges, seeds, { horizon: TMAX, loss: lawsOf(lab.spec).loss, march: MARCH });
    const byNode = new Map<string, FbEcho[]>(), byKey = new Map<string, FbEcho>();
    for (const p of result.pulses) {
      byKey.set(p.key, p);
      const l = byNode.get(p.node);
      if (l) l.push(p); else byNode.set(p.node, [p]);
    }
    cache = { result, byNode, byKey };
  }
  lab.fb = cache;
  return cache;
}

/** Stability of the feedback graph at the current scrub time (clock drift makes timing a snapshot). */
export function feedbackAudit(lab: Lab): FbAudit {
  const key = `${lab.rev}|${Math.round(lab.t * 2)}`;
  if (lab.fbAudit && lab.fbAudit.key === key) return lab.fbAudit.value;
  const { nodes, edges } = fbGraph(lab);
  const value = analyzeFeedback(lab.tree, nodes, edges, lab.t, lawsOf(lab.spec).loss, MARCH);
  lab.fbAudit = { key, value };
  return value;
}

/** Give emitter `toId` a feedback tap on `fromId` (replacing any it had). `toId` may equal `fromId`. */
export function addFeedback(lab: Lab, fromId: string, toId: string, delay = 1.5, gain = 0.8): boolean {
  const from = lab.spec.emitters.find((e) => e.id === fromId), to = lab.spec.emitters.find((e) => e.id === toId);
  if (!from || !to) return false;
  to.fb = { from: fromId, delay: clamp(delay, 0, LIMITS.fbDelay), gain: clamp(gain, 0.05, LIMITS.fbGain) };
  rebuild(lab);
  return true;
}

export function removeFeedback(lab: Lab, toId: string): boolean {
  const to = lab.spec.emitters.find((e) => e.id === toId);
  if (!to || !to.fb) return false;
  delete to.fb;
  rebuild(lab);
  return true;
}

export function adjustFeedback(lab: Lab, toId: string, what: "gain" | "delay", dir: 1 | -1): boolean {
  const to = lab.spec.emitters.find((e) => e.id === toId);
  if (!to || !to.fb) return false;
  if (what === "gain") to.fb.gain = clamp(Math.round(to.fb.gain * Math.pow(1.08, dir) * 1000) / 1000, 0.05, LIMITS.fbGain);
  else to.fb.delay = clamp(Math.round(Math.max(0.1, to.fb.delay) * Math.pow(1.2, dir) * 1000) / 1000, 0, LIMITS.fbDelay);
  rebuild(lab);
  return true;
}

/** The newest pulse of an emitter that has launched by lab.t (or its first pulse if none yet). */
function latestPulse(lab: Lab, e: EmitterDef): Emission | null {
  const got = emissionsUpTo(lab, lab.t, 1).find((x) => x.emitter === e.id);
  if (got) return got;
  if (e.relay) return null;
  const tl = lab.tree.toLocalTime(e.domain, lab.t);
  const k = Math.max(1, pulseCount(e, tl));
  const L = launchOf(lab, e.id, k);
  return L ? { emitter: e.id, hue: e.hue, k, domain: e.domain, pos: emitterPos(lab, e), launchLocal: L.launchLocal, launchRoot: L.launchRoot } : null;
}

/** Toggle a causal intervention: pulse k of `emitterId` never happens. Returns true if it is now cut. */
export function toggleCut(lab: Lab, emitterId: string, k: number): boolean {
  const cuts = lab.spec.cuts ?? (lab.spec.cuts = []);
  const i = cuts.findIndex((c) => c.emitter === emitterId && c.k === k);
  let now = false;
  if (i >= 0) cuts.splice(i, 1);
  else if (cuts.length < LIMITS.cuts) { cuts.push({ emitter: emitterId, k }); now = true; }
  if (cuts.length === 0) delete lab.spec.cuts;
  rebuild(lab);
  return now;
}

export function clearCuts(lab: Lab): void {
  delete lab.spec.cuts;
  rebuild(lab);
}

/** A relay of `fromId` at `at`: it re-emits every pulse it hears, `delay` of its own time later. */
export function addRelay(lab: Lab, at: Vec, fromId: string, delay = 1): string | null {
  const src = lab.spec.emitters.find((e) => e.id === fromId);
  if (!src || lab.spec.emitters.length >= LIMITS.emitters) return null;
  const dom = lab.tree.domainAt(at3(lab, at));
  const o = lab.tree.toLocalPos(dom.id, at3(lab, at));
  const def: EmitterDef = {
    id: `e${lab.seq++}`, domain: dom.id, pos: [o[0], o[1]], period: src.period, phase: 0,
    hue: (src.hue + 47) % 360, relay: { from: fromId, delay },
  };
  lab.spec.emitters.push(def);
  rebuild(lab);
  return def.id;
}

export function rayAt(lab: Lab, em: Emission): Arrival {
  const key = `${em.emitter}|${em.k}`;
  let r = lab.rays.get(key);
  if (!r || !lab.arrivals.has(key)) { // arrivals is the cache's authority: cleared => recompute
    r = march(lab.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, { domain: "root", pos: probeSite(lab) }, MARCH);
    lab.rays.set(key, r);
    lab.arrivals.set(key, r.rootTime);
  }
  return r;
}

export const BENT_N = 40;
const BOX_MIN: Vec = [0, 0], BOX_MAX: Vec = [SIZE, SIZE];
/** Bent (Fermat) paths are solved on a flat grid; a bulk world uses straight chords. */
export const isBent = (lab: Lab): boolean => lawsOf(lab.spec).path === "bent" && !lab.spec.bulk;

/** Bent-path arrival field of one emission; null until solved (see `pumpFields`). */
export function fieldOf(lab: Lab, em: Emission, build = false): ArrivalField | null {
  const key = `${em.emitter}|${em.k}`;
  let f = lab.fields.get(key);
  if (!f && build) {
    f = fermatField(lab.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, BOX_MIN, BOX_MAX, BENT_N);
    lab.fields.set(key, f);
  }
  return f ?? null;
}

/**
 * Arrival of an emission at the probe. Under the bent law: the Fermat field sampled at the probe
 * (never later than the straight chord, which is also a valid path); the chord until the field is solved.
 */
export function arrivalAt(lab: Lab, em: Emission): number {
  const key = `${em.emitter}|${em.k}`;
  if (isBent(lab)) {
    const f = fieldOf(lab, em);
    if (!f) return rayAt(lab, em).rootTime;
    let a = lab.bent.get(key);
    if (a === undefined) {
      a = Math.min(rayAt(lab, em).rootTime, sampleField(f, BOX_MIN, BOX_MAX, lab.probe));
      lab.bent.set(key, a);
    }
    return a;
  }
  const a = lab.arrivals.get(key);
  return a !== undefined ? a : rayAt(lab, em).rootTime;
}

/** Solve missing bent fields, newest first, until the time budget is spent. Returns how many remain. */
export function pumpFields(lab: Lab, budgetMs = 10): number {
  if (!isBent(lab)) { lab.pending = 0; return 0; }
  const want = emissionsUpTo(lab, lab.t, 6).filter((e) => lab.t - e.launchRoot < 60).sort((a, b) => b.launchRoot - a.launchRoot);
  const t0 = performance.now();
  let left = 0;
  for (const em of want) {
    if (fieldOf(lab, em)) continue;
    if (performance.now() - t0 < budgetMs) fieldOf(lab, em, true); else left++;
  }
  lab.pending = left;
  return left;
}

/** Everything the probe has perceived by lab.t, in perceived order. */
export function perceived(lab: Lab, per = 6): Perceived[] {
  const out: Perceived[] = [];
  for (const em of emissionsUpTo(lab, lab.t, per)) {
    const arrival = arrivalAt(lab, em);
    if (arrival <= lab.t) out.push({ emission: em, arrival, lag: arrival - em.launchRoot });
  }
  return out.sort((a, b) => a.arrival - b.arrival);
}

export interface Metrics { spread: number; inversions: number; heard: number }

export function metrics(lab: Lab, window = 12): Metrics {
  const ps = perceived(lab).filter((p) => p.arrival >= lab.t - window);
  const latest = new Map<string, Perceived>();
  for (const p of ps) {
    const q = latest.get(p.emission.emitter);
    if (!q || p.arrival > q.arrival) latest.set(p.emission.emitter, p);
  }
  return {
    spread: lagSpread([...latest.values()].map((p) => p.lag)),
    inversions: countInversions(ps.map((p) => ({ emitRoot: p.emission.launchRoot, perceivedAt: p.arrival })), 0.25),
    heard: ps.length,
  };
}

/** Causal landscape of one emitter's latest (or first) emission at lab.t. */
export function computeHeat(lab: Lab, emitterId: string, n = 40): boolean {
  const e = lab.spec.emitters.find((x) => x.id === emitterId);
  if (!e) return false;
  const pulse = latestPulse(lab, e);
  if (!pulse) return false;
  const k = pulse.k;
  const from = { domain: e.domain, pos: emitterPos(lab, e) }, tEmit = pulse.launchLocal;
  const field = isBent(lab)
    ? fermatField(lab.tree, from, tEmit, BOX_MIN, BOX_MAX, n)
    : arrivalField(lab.tree, from, tEmit, [0, 0], [SIZE, SIZE], n, { maxStep: 1.5 });
  lab.heat = { emitter: emitterId, k, launchLocal: tEmit, field };
  return true;
}

// ---------- Lawbook ----------
export type LawKey = "time" | "medium" | "dim" | "loss" | "noise" | "gauss" | "path";
export const LAW_KEYS: LawKey[] = ["time", "medium", "dim", "loss", "noise", "gauss", "path"];

const nextIn = (steps: number[], v: number): number => {
  const i = steps.indexOf(v);
  return steps[(i + 1) % steps.length];
};

/** Cycle one law to its next value and rebuild the world under it. */
export function cycleLaw(lab: Lab, key: LawKey): Laws {
  const next = nextLaw(lawsOf(lab.spec), key);
  lab.spec.laws = next;
  rebuild(lab);
  return next;
}

/** The laws after one click of a knob (pure: the Which-Universe trial turns knobs on a guess, not on the world). */
export function nextLaw(cur: Laws, key: LawKey): Laws {
  const next: Laws = { ...cur };
  if (key === "time") next.time = cur.time === "local" ? "global" : "local";
  else if (key === "medium") next.medium = cur.medium === "strata" ? "uniform" : "strata";
  else if (key === "dim") next.dim = cur.dim >= DIM_MAX ? DIM_MIN : cur.dim + 1;
  else if (key === "loss") next.loss = nextIn(LOSS_STEPS, cur.loss);
  else if (key === "noise") next.noise = nextIn(NOISE_STEPS, cur.noise);
  else if (key === "path") next.path = cur.path === "straight" ? "bent" : "straight";
  else next.gauss = cur.gauss === "holds" ? "leaky" : cur.gauss === "leaky" ? "runaway" : "holds";
  return next;
}

export function resetLaws(lab: Lab): void {
  lab.spec.laws = { ...LAWFUL };
  rebuild(lab);
}

/** Conservation audit of the latest emission of an emitter (default: selected, else first) along the chord to the probe. */
export function auditEmitter(lab: Lab, emitterId?: string): { emitter: string; audit: RayAudit } | null {
  const id = emitterId ?? (lab.sel?.kind === "emitter" ? lab.sel.id : lab.spec.emitters[0]?.id);
  const e = lab.spec.emitters.find((x) => x.id === id);
  if (!e) return null;
  const em = latestPulse(lab, e);
  if (!em) return null;
  const ray = rayAt(lab, em);
  const from = lab.tree.toRootPos(e.domain, emitterPos(lab, e));
  const r = dist(from, probeSite(lab));
  return { emitter: e.id, audit: auditRay(lawsOf(lab.spec), ray.segments, wellIds(lab.spec), ENERGY, r) };
}

export const ENERGY = 100;

export interface LawFitResult {
  emitter: string;
  fit: SpreadFit;
  /** every (dimension, Gauss law) that spreads the same way: intensity alone cannot choose */
  guesses: LawGuess[];
  declared: { dim: number; gauss: string; loss: number };
  /** information loss per unit length inside shear wells (null: no path crossed a well) */
  noise: number | null;
  /** echo-speed map: speed inside each domain relative to the open medium */
  delay: DelayFit | null;
  /** is the declared pair among the guesses? (it must be: a check that the instrument reads the world honestly) */
  consistent: boolean;
}

/**
 * Law inference: measure the flux of one emitter's latest pulse at ring of virtual probes (6 radii x 8 bearings),
 * fit intensity ~ r^-n exp(-loss x length inside domains), and list every pair of laws that spreads that way.
 */
export function lawFit(lab: Lab, emitterId?: string): LawFitResult | null {
  const id = emitterId ?? (lab.sel?.kind === "emitter" ? lab.sel.id : lab.spec.emitters[0]?.id);
  const e = lab.spec.emitters.find((x) => x.id === id);
  if (!e) return null;
  const key = `${lab.rev}|${e.id}`;
  if (lab.lawFit && lab.lawFit.key === key) return lab.lawFit.value;
  const laws = lawsOf(lab.spec), wells = wellIds(lab.spec);
  const here = emitterPos(lab, e), from = lab.tree.toRootPos(e.domain, here);
  const samples: { r: number; intensity: number; inside: number }[] = [];
  const noiseS: { fidelity: number; well: number }[] = [], delayS: { D: number; lag: number; per: Record<string, number> }[] = [];
  const t0 = lab.tree.toRootTime(e.domain, 0);
  for (let b = 0; b < 8; b++) {
    const th = (b * Math.PI) / 4;
    for (const r of [4, 8, 14, 22, 32, 44]) {
      const x = from[0] + r * Math.cos(th), y = from[1] + r * Math.sin(th);
      if (x < 0 || x > SIZE || y < 0 || y > SIZE) continue;
      const site: Vec = lab.spec.bulk ? [x, y, lab.probeZ] : [x, y];
      const ray = march(lab.tree, { domain: e.domain, pos: here }, 0, { domain: "root", pos: site }, MARCH);
      const rr = dist(from, site);
      const a = auditRay(laws, ray.segments, wells, ENERGY, rr);
      let inside = 0, well = 0;
      const per: Record<string, number> = {};
      for (const s of ray.segments) if (s.domain !== "root") { inside += s.length; per[s.domain] = (per[s.domain] ?? 0) + s.length; if (wells.has(s.domain)) well += s.length; }
      samples.push({ r: rr, intensity: a.intensity, inside });
      noiseS.push({ fidelity: a.fidelity, well });
      delayS.push({ D: rr, lag: ray.rootTime - t0, per });
    }
  }
  const fit = fitSpreading(samples);
  const value: LawFitResult | null = fit ? {
    emitter: e.id, fit, guesses: consistentLaws(fit.n, 0.08),
    declared: { dim: laws.dim, gauss: laws.gauss, loss: laws.loss },
    noise: fitNoise(noiseS), delay: fitDelay(delayS),
    consistent: consistentLaws(fit.n, 0.08).some((g) => g.dim === laws.dim && g.gauss === laws.gauss),
  } : null;
  lab.lawFit = { key, value };
  return value;
}

// ---------- array triangulation (several probes) ----------
export const TRI_R = 16;
/** Residual below this (seconds, RMS) means the arrivals are consistent with a flat uniform medium. */
export const TRI_FLAT = 1e-4;
/** How far the second array is lifted along the hidden axis. */
export const TRI_LIFT = 8;

export interface TriResult {
  emitter: string;
  /** the five array sites (root plane coordinates): the probe and four around it */
  sites: [number, number][];
  /** the latest pulse heard by every site, and its predecessor */
  k: number;
  fix: LocateFix;
  /** truth, for the Observatory's own scoreboard */
  truth: { x: number; y: number; depth: number; t0: number };
  /** in-plane position error, depth error (both root units), emission-time error (s) */
  errPos: number;
  errDepth: number;
  errT0: number;
  /** emitter clock rate (local s per root s) recovered from two consecutive solved emission times, and the real one */
  rateEst: number;
  rateTrue: number;
  /** flat: the uniform-medium model explains the arrivals; warped: it does not, so the numbers above are unreliable */
  verdict: "flat" | "warped";
  /** bulk worlds: a second array lifted TRI_LIFT along the hidden axis removes the mirror ambiguity (signed height) */
  lift: { z: number; errZ: number; residual: number } | null;
}

/** The probe plus four neighbours at distance TRI_R, kept inside the world. */
export function triSites(lab: Lab): [number, number][] {
  const cx = clamp(lab.probe[0], TRI_R, SIZE - TRI_R), cy = clamp(lab.probe[1], TRI_R, SIZE - TRI_R);
  return [[cx, cy], [cx + TRI_R, cy], [cx - TRI_R, cy], [cx, cy + TRI_R], [cx, cy - TRI_R]];
}

/**
 * Locate an emitter with an ARRAY of five probes: from the arrival times of two consecutive pulses alone (assuming a
 * flat uniform medium at the root speed) recover its position, its distance from the plane (never its sign), the
 * moment it fired, and, from the two firing times, the rate of its clock. The misfit says whether to trust it.
 */
export function triangulate(lab: Lab, emitterId?: string): TriResult | null {
  const id = emitterId ?? (lab.sel?.kind === "emitter" ? lab.sel.id : undefined);
  const e = lab.spec.emitters.find((x) => x.id === id);
  if (!e) return null;
  const key = `${lab.rev}|${e.id}|${lab.probe[0]}|${lab.probe[1]}|${lab.probeZ}|${Math.round(lab.t * 2)}`;
  if (lab.tri && lab.tri.key === key) return lab.tri.value;
  const sites = triSites(lab), z = lab.spec.bulk ? lab.probeZ : 0;
  const from = { domain: e.domain, pos: emitterPos(lab, e) };
  const arrive = (em: Emission): number[] => sites.map((s) => march(lab.tree, from, em.launchLocal, { domain: "root", pos: lab.spec.bulk ? [s[0], s[1], z] : s }, MARCH).rootTime);
  const ems = emissionsUpTo(lab, lab.t, 14).filter((m) => m.emitter === e.id && m.k < FB_BASE).sort((a, b) => b.k - a.k);
  let value: TriResult | null = null;
  for (let i = 0; i + 1 < ems.length && !value; i++) {
    const a = ems[i], b = ems[i + 1];
    if (b.k !== a.k - 1) continue;
    const ta = arrive(a), tb = arrive(b);
    if (ta.some((x) => x > lab.t) || tb.some((x) => x > lab.t)) continue;
    const fa = locateSource(sites, ta, lab.spec.rootSpeed), fb = locateSource(sites, tb, lab.spec.rootSpeed);
    if (!fa || !fb) continue;
    const p = lab.tree.toRootPos(e.domain, emitterPos(lab, e));
    const truth = { x: p[0], y: p[1], depth: Math.abs((p[2] ?? 0) - z), t0: a.launchRoot };
    const dom = lab.tree.get(e.domain);
    let lift: TriResult["lift"] = null;
    if (lab.spec.bulk) {
      const sites3: number[][] = [...sites.map((q) => [q[0], q[1], z]), ...sites.map((q) => [q[0], q[1], z + TRI_LIFT])];
      const up = sites.map((q) => march(lab.tree, from, a.launchLocal, { domain: "root", pos: [q[0], q[1], z + TRI_LIFT] }, MARCH).rootTime);
      const arr = [...ta, ...up];
      const f3 = up.every((x) => x <= lab.t) ? locateND(sites3, arr, lab.spec.rootSpeed) : null;
      if (f3) lift = { z: f3.pos[2], errZ: Math.abs(f3.pos[2] - (p[2] ?? 0)), residual: f3.residual };
    }
    const dRoot = fa.t0 - fb.t0, dLocal = a.launchLocal - b.launchLocal;
    value = {
      emitter: e.id, sites, k: a.k, fix: fa, truth,
      errPos: Math.hypot(fa.x - truth.x, fa.y - truth.y), errDepth: Math.abs(fa.depth - truth.depth), errT0: Math.abs(fa.t0 - truth.t0),
      rateEst: dRoot > 1e-9 ? dLocal / dRoot : NaN, rateTrue: lab.tree.rateToRoot(dom, (a.launchRoot + b.launchRoot) / 2),
      verdict: fa.converged && fb.converged && Math.max(fa.residual, fb.residual, lift?.residual ?? 0) <= TRI_FLAT ? "flat" : "warped",
      lift,
    };
  }
  lab.tri = { key, value };
  return value;
}
