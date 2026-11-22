import { arrivalField, countInversions, lagSpread, march } from "../core/strata/index.js";
import type { ArrivalField, StrataTree, Vec } from "../core/strata/index.js";
import { LIMITS, buildTree, defaultWorld } from "./world.js";
import type { DomainDef, EmitterDef, WorldSpec } from "./world.js";

export const SIZE = 100;
export const TMAX = 240;
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const MARCH = { maxStep: 1 };

export type Tool = "select" | "fast" | "well" | "micro" | "emit" | "erase";
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
}

export interface Perceived { emission: Emission; arrival: number; lag: number }

export interface Lab {
  spec: WorldSpec;
  tree: StrataTree;
  t: number;
  playing: boolean;
  speedIdx: number;
  probe: Vec;
  sel: Sel | null;
  tool: Tool;
  seq: number;
  heat: { emitter: string; k: number; field: ArrivalField } | null;
  /** bumps on every structural change (caches key off it) */
  rev: number;
  arrivals: Map<string, number>;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampPt = (p: Vec): Vec => [clamp(p[0], 0, SIZE), clamp(p[1], 0, SIZE)];

export function newLab(spec: WorldSpec = defaultWorld()): Lab {
  let seq = 1;
  for (const id of [...spec.domains.map((d) => d.id), ...spec.emitters.map((e) => e.id)]) {
    const n = Number(id.replace(/\D/g, ""));
    if (Number.isFinite(n)) seq = Math.max(seq, n + 1);
  }
  return {
    spec, tree: buildTree(spec), t: 0, playing: false, speedIdx: 2, probe: [50, 50], sel: null, tool: "select",
    seq, heat: null, rev: 0, arrivals: new Map(),
  };
}

export function rebuild(lab: Lab): void {
  lab.tree = buildTree(lab.spec);
  lab.heat = null;
  lab.arrivals.clear();
  lab.rev++;
}

export function addDomain(lab: Lab, kind: "fast" | "well" | "micro", at: Vec): string | null {
  if (lab.spec.domains.length >= LIMITS.domains) return null;
  const parent = lab.tree.domainAt(at);
  if (kind === "micro" && !parent.parent) return null;
  const rpl = parent.rootPerLocal;
  const scale = kind === "micro" ? 8 : 1;
  let extentRoot = kind === "micro" ? 5 : 14;
  if (parent.parent) extentRoot = Math.min(extentRoot, parent.radiusRoot * 0.6);
  const o = lab.tree.toLocalPos(parent.id, at);
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
  const dom = lab.tree.domainAt(at);
  const o = lab.tree.toLocalPos(dom.id, at);
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
    const p = lab.tree.toRootPos(e.domain, e.pos);
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < bd) { bd = d; best = { kind: "emitter", id: e.id }; }
  }
  if (best) return best;
  const dom = lab.tree.domainAt(at);
  return dom.parent ? { kind: "domain", id: dom.id } : null;
}

export function moveSel(lab: Lab, sel: Sel, to: Vec): void {
  const at = clampPt(to);
  if (sel.kind === "probe") { lab.probe = at; lab.arrivals.clear(); return; }
  if (sel.kind === "emitter") {
    const e = lab.spec.emitters.find((x) => x.id === sel.id);
    if (!e) return;
    const o = lab.tree.toLocalPos(e.domain, at);
    e.pos = [o[0], o[1]];
  } else {
    const d = lab.spec.domains.find((x) => x.id === sel.id);
    if (!d) return;
    const o = lab.tree.toLocalPos(d.parent, at);
    d.origin = [o[0], o[1]];
  }
  rebuild(lab);
}

export function removeSel(lab: Lab, sel: Sel): void {
  if (sel.kind === "emitter") {
    lab.spec.emitters = lab.spec.emitters.filter((e) => e.id !== sel.id);
  } else if (sel.kind === "domain") {
    const dead = new Set<string>([sel.id]);
    for (const d of lab.spec.domains) if (dead.has(d.parent)) dead.add(d.id); // parents precede children
    lab.spec.domains = lab.spec.domains.filter((d) => !dead.has(d.id));
    lab.spec.emitters = lab.spec.emitters.filter((e) => !dead.has(e.domain));
  } else return;
  if (lab.sel && lab.sel.id === sel.id) lab.sel = null;
  rebuild(lab);
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
    e.period = clamp(e.period * Math.pow(1.15, dir), 0.8, 60);
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

/** The latest `per` emissions of every emitter that have launched by root time `tRoot`. */
export function emissionsUpTo(lab: Lab, tRoot: number, per: number): Emission[] {
  const out: Emission[] = [];
  for (const e of lab.spec.emitters) {
    const tl = lab.tree.toLocalTime(e.domain, tRoot);
    const kmax = Math.floor((tl - e.phase) / e.period);
    for (let k = kmax; k >= Math.max(1, kmax - per + 1); k--) {
      const launchLocal = e.phase + k * e.period;
      out.push({
        emitter: e.id, hue: e.hue, k, domain: e.domain, pos: e.pos, launchLocal,
        launchRoot: lab.tree.toRootTime(e.domain, launchLocal),
      });
    }
  }
  return out;
}

export function arrivalAt(lab: Lab, em: Emission): number {
  const key = `${em.emitter}|${em.k}`;
  let a = lab.arrivals.get(key);
  if (a === undefined) {
    a = march(lab.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, { domain: "root", pos: lab.probe }, MARCH).rootTime;
    lab.arrivals.set(key, a);
  }
  return a;
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
  const tl = lab.tree.toLocalTime(e.domain, lab.t);
  const k = Math.max(1, Math.floor((tl - e.phase) / e.period));
  const field = arrivalField(lab.tree, { domain: e.domain, pos: e.pos }, e.phase + k * e.period, [0, 0], [SIZE, SIZE], n, { maxStep: 1.5 });
  lab.heat = { emitter: emitterId, k, field };
  return true;
}
