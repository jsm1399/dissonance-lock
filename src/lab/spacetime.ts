import { CausalLedger } from "../core/strata/index.js";
import type { CausalEvent, Vec } from "../core/strata/index.js";
import { arrivalAt, emissionsUpTo } from "./lab.js";
import type { Lab } from "./lab.js";

/**
 * Probe-frame spacetime: every emission is a segment from (distance-to-probe, launch time)
 * to (0, arrival time). Pure geometry over the lab's own causal data; nothing here simulates.
 */
export interface Worldline {
  emitter: string;
  hue: number;
  k: number;
  /** emitter site: domain + position in that domain's coordinates, and launch in its own clock */
  domain: string;
  pos: Vec;
  launchLocal: number;
  /** root distance emitter -> probe */
  dist: number;
  launch: number;
  arrival: number;
  /** already perceived by the probe at lab.t */
  heard: boolean;
  /** takes part in at least one causal inversion (emitted earlier, perceived later) */
  inverted: boolean;
}

export interface HorizonPoint { emitter: string; dist: number; launch: number }

export interface Spacetime {
  lines: Worldline[];
  /** newest already-heard emission of each emitter, nearest first: the probe's causal horizon */
  horizon: HorizonPoint[];
  /** reversed pairs among lines heard in the last `window` seconds (the probe's dissonance definition) */
  inversions: number;
  /** farthest emitter distance (>= 1) */
  dmax: number;
}

export const PER = 8;
export const MARGIN = 0.25;
export const WINDOW = 12;

export function spacetime(lab: Lab, per = PER, margin = MARGIN, window = WINDOW): Spacetime {
  const dist = new Map<string, number>();
  let dmax = 1;
  for (const e of lab.spec.emitters) {
    const p = lab.tree.toRootPos(e.domain, e.pos);
    const d = Math.hypot(p[0] - lab.probe[0], p[1] - lab.probe[1]);
    dist.set(e.id, d);
    dmax = Math.max(dmax, d);
  }
  const lines: Worldline[] = emissionsUpTo(lab, lab.t, per).map((em) => {
    const arrival = arrivalAt(lab, em);
    return {
      emitter: em.emitter, hue: em.hue, k: em.k, domain: em.domain, pos: em.pos, launchLocal: em.launchLocal,
      dist: dist.get(em.emitter) ?? 0,
      launch: em.launchRoot, arrival, heard: arrival <= lab.t, inverted: false,
    };
  });
  const live = lines.filter((l) => l.heard && l.arrival >= lab.t - window);
  let inversions = 0;
  for (const a of live) {
    for (const b of live) {
      if (a !== b && a.launch + margin < b.launch && a.arrival > b.arrival + margin) {
        inversions++;
        a.inverted = true;
        b.inverted = true;
      }
    }
  }
  const newest = new Map<string, Worldline>();
  for (const l of lines) {
    if (!l.heard) continue;
    const q = newest.get(l.emitter);
    if (!q || l.launch > q.launch) newest.set(l.emitter, l);
  }
  const horizon = [...newest.values()]
    .map((l) => ({ emitter: l.emitter, dist: l.dist, launch: l.launch }))
    .sort((a, b) => a.dist - b.dist);
  return { lines, horizon, inversions, dmax: dmax * 1.06 };
}

// ---------- causal cone of one emission (uses the core CausalLedger) ----------
export type Rel = "past" | "future" | "independent";

export interface Cone {
  origin: Worldline;
  rel: Map<Worldline, Rel>;
  past: number;
  future: number;
  independent: number;
}

const ledgers = new WeakMap<Lab, { rev: number; ledger: CausalLedger<string>; ev: Map<string, CausalEvent<string>> }>();

function eventOf(lab: Lab, w: Worldline): CausalEvent<string> {
  let c = ledgers.get(lab);
  if (!c || c.rev !== lab.rev) {
    c = { rev: lab.rev, ledger: new CausalLedger<string>(lab.tree, { maxStep: 1 }), ev: new Map() };
    ledgers.set(lab, c);
  }
  const key = `${w.emitter}|${w.k}`;
  let e = c.ev.get(key);
  if (!e) { e = c.ledger.emit({ domain: w.domain, pos: w.pos }, w.launchLocal, key); c.ev.set(key, e); }
  return e;
}

/**
 * Can the pulse of `emitterId` (newest, or the one launched nearest `aroundLaunch`) have influenced / been influenced by every other pulse in view?
 * future = its signal reaches that pulse's emitter before that pulse is launched; past = the reverse;
 * independent = neither (spacelike). Uses straight chords, i.e. an upper bound on arrival (see `march`).
 */
export function causalCone(lab: Lab, st: Spacetime, emitterId: string, aroundLaunch?: number): Cone | null {
  let origin: Worldline | null = null;
  const score = (l: Worldline) => (aroundLaunch === undefined ? l.k : -Math.abs(l.launch - aroundLaunch));
  for (const l of st.lines) if (l.emitter === emitterId && (!origin || score(l) > score(origin))) origin = l;
  if (!origin) return null;
  const a = eventOf(lab, origin);
  const rel = new Map<Worldline, Rel>();
  let past = 0, future = 0, independent = 0;
  for (const l of st.lines) {
    if (l === origin) continue;
    const x = ledgerOf(lab).relation(a, eventOf(lab, l));
    const v: Rel = x === "before" ? "future" : x === "after" ? "past" : x === "same" ? "future" : "independent";
    rel.set(l, v);
    if (v === "past") past++; else if (v === "future") future++; else independent++;
  }
  return { origin, rel, past, future, independent };
}

const ledgerOf = (lab: Lab): CausalLedger<string> => (ledgers.get(lab) as { ledger: CausalLedger<string> }).ledger;
