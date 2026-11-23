import { fluxDensity, shellEnergy } from "./laws.js";
export const TOL = 1e-9;
/**
 * Audit one emission along one path. Two independent accounts must agree:
 *  - the PATH account: walk the segments, energy decays exp(-loss*len) inside domains, the
 *    difference is booked as absorbed per domain;
 *  - the SHELL account: the law's flux density times the area of the shell at r.
 * With Gauss's law holding, delivered + absorbed == emitted. Laws that dilute wrongly break it.
 */
export function auditRay(laws, segments, wells, emitted, r) {
    let e = emitted, fid = 1;
    const absorbed = {};
    const noiseBy = {};
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
