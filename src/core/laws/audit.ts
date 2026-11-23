import type { Segment } from "../strata/index.js";
import { fluxDensity, shellEnergy } from "./laws.js";
import type { Laws } from "./laws.js";

export type Verdict = "conserved" | "created" | "destroyed";

export interface RayAudit {
  /** distance from the emission to the receiver (root length) */
  r: number;
  emitted: number;
  /** energy crossing the shell at r, from the law's flux density */
  delivered: number;
  /** energy absorbed per domain, from walking the path */
  absorbed: Record<string, number>;
  absorbedTotal: number;
  /** delivered + absorbed - emitted: > 0 means the laws created energy, < 0 destroyed it */
  residual: number;
  relResidual: number;
  verdict: Verdict;
  /** flux density at the receiver */
  intensity: number;
  /** information fidelity at the receiver, in (0,1] */
  fidelity: number;
  /** fidelity lost per well, for the ledger */
  noiseBy: Record<string, number>;
}

export const TOL = 1e-9;

/**
 * Audit one emission along one path. Two independent accounts must agree:
 *  - the PATH account: walk the segments, energy decays exp(-loss*len) inside domains, the
 *    difference is booked as absorbed per domain;
 *  - the SHELL account: the law's flux density times the area of the shell at r.
 * With Gauss's law holding, delivered + absorbed == emitted. Laws that dilute wrongly break it.
 */
export function auditRay(laws: Laws, segments: readonly Segment[], wells: ReadonlySet<string>, emitted: number, r: number): RayAudit {
  let e = emitted, fid = 1;
  const absorbed: Record<string, number> = {};
  const noiseBy: Record<string, number> = {};
  for (const seg of segments) {
    if (seg.domain !== "root") {
      const after = e * Math.exp(-laws.loss * seg.length);
      absorbed[seg.domain] = (absorbed[seg.domain] ?? 0) + (e - after);
      e = after;
    }
    if (wells.has(seg.domain)) {
      const keep = Math.exp(-laws.noise * seg.length);
      noiseBy[seg.domain] = (noiseBy[seg.domain] ?? 0) + fid * (1 - keep);
      fid *= keep;
    }
  }
  const absorbedTotal = emitted - e;
  const survive = emitted > 0 ? e / emitted : 0;
  const flux = fluxDensity(laws, emitted, r) * survive;
  const delivered = shellEnergy(laws, flux, r);
  const residual = delivered + absorbedTotal - emitted;
  const rel = emitted > 0 ? residual / emitted : 0;
  return {
    r, emitted, delivered, absorbed, absorbedTotal, residual, relResidual: rel,
    verdict: Math.abs(rel) <= TOL ? "conserved" : rel > 0 ? "created" : "destroyed",
    intensity: flux, fidelity: fid, noiseBy,
  };
}
