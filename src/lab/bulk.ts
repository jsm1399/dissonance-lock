import { emissionsUpTo, emitterPos, arrivalAt } from "./lab.js";
import type { Lab } from "./lab.js";

export interface Depth {
  emitter: string;
  /** hidden-axis offset between emitter and probe the timing implies, assuming a flat uniform medium */
  apparent: number;
  /** the true offset along the hidden axis (root units) */
  actual: number;
  /** in-plane separation, root units */
  planar: number;
  lag: number;
}

/**
 * Can a creature confined to the plane tell there is a hidden dimension? A signal that takes longer than
 * (in-plane distance / speed) has "extra" path: apparent depth = sqrt((speed*lag)^2 - planar^2).
 * Exact for uniform media. Clock drift and wells fake it, which is the point of the experiment.
 */
export function apparentDepth(lab: Lab, emitterId: string): Depth | null {
  if (!lab.spec.bulk) return null;
  const e = lab.spec.emitters.find((x) => x.id === emitterId);
  if (!e) return null;
  const heard = emissionsUpTo(lab, lab.t, 12)
    .filter((m) => m.emitter === emitterId)
    .map((m) => ({ m, arrival: arrivalAt(lab, m) }))
    .filter((x) => x.arrival <= lab.t)
    .sort((a, b) => b.m.launchRoot - a.m.launchRoot)[0];
  if (!heard) return null;
  const p = lab.tree.toRootPos(e.domain, emitterPos(lab, e));
  const planar = Math.hypot(p[0] - lab.probe[0], p[1] - lab.probe[1]);
  const lag = heard.arrival - heard.m.launchRoot;
  const v = lab.spec.rootSpeed;
  const apparent = Math.sqrt(Math.max(0, (v * lag) ** 2 - planar ** 2));
  const actual = Math.abs(p[2] - lab.probeZ);
  return { emitter: emitterId, apparent, actual, planar, lag };
}
