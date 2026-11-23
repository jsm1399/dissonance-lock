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
      emitter: em.emitter, hue: em.hue, k: em.k, dist: dist.get(em.emitter) ?? 0,
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
