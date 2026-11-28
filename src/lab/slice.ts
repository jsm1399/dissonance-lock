import { DEPTH_MAX, SIZE, emitterPos } from "./lab.js";
import type { Lab } from "./lab.js";
import { hiddenAxes } from "./world.js";
import type { Vec } from "../core/strata/index.js";

/**
 * Slice view: a 2D window onto the N-dimensional world. Pick two of the axes (x, y, z, w); every other
 * coordinate is HELD at the probe's value. Domains are balls, so their cross-section here is a disc of
 * radius sqrt(R^2 - offset^2) (nothing at all if the held coordinates are outside the ball). Emitters are
 * dots; how far each sits off the slice (in the held axes) is reported, because an emitter that is off
 * the slice is exactly what a plane-bound observer cannot place.
 */
export type Axis = "x" | "y" | "z" | "w";
export const AXES: readonly Axis[] = ["x", "y", "z", "w"];
export type Plane = readonly [Axis, Axis];

const idx = (a: Axis): number => AXES.indexOf(a);

/** Every pair of axes the world actually has: 1 in the plane, 3 with one hidden axis, 6 with two. */
export function planesOf(dim: number): Plane[] {
  const out: Plane[] = [];
  for (let i = 0; i < dim; i++) for (let j = i + 1; j < dim; j++) out.push([AXES[i], AXES[j]]);
  return out;
}

/** The inclusive range an axis is drawn over: the map for x and y, the hidden-axis limit for z and w. */
export const rangeOf = (a: Axis): [number, number] => (a === "x" || a === "y" ? [0, SIZE] : [-DEPTH_MAX, DEPTH_MAX]);

export interface SliceEmitter { id: string; hue: number; a: number; b: number; off: number; onSlice: boolean }
export interface SliceDomain { id: string; a: number; b: number; r: number; shear: boolean }
export interface Slice {
  plane: Plane;
  probe: { a: number; b: number };
  /** the held coordinates, by axis name */
  held: Partial<Record<Axis, number>>;
  emitters: SliceEmitter[];
  domains: SliceDomain[];
}

/** The probe's full position vector in the world's dimension. */
export function probeVec(lab: Lab): Vec {
  const h = hiddenAxes(lab.spec);
  return [lab.probe[0], lab.probe[1], ...(h >= 1 ? [lab.probeZ] : []), ...(h >= 2 ? [lab.probeW] : [])];
}

export const ON_SLICE = 0.5;

export function sliceOf(lab: Lab, plane: Plane): Slice {
  const dim = 2 + hiddenAxes(lab.spec);
  const ia = idx(plane[0]), ib = idx(plane[1]);
  if (ia < 0 || ib < 0 || ia === ib || ia >= dim || ib >= dim) throw new RangeError(`plane ${plane.join("")} does not exist in ${dim}D`);
  const P = probeVec(lab);
  const heldIdx = Array.from({ length: dim }, (_, i) => i).filter((i) => i !== ia && i !== ib);
  const held: Partial<Record<Axis, number>> = {};
  for (const i of heldIdx) held[AXES[i]] = P[i];
  const offOf = (p: Vec): number => Math.hypot(...heldIdx.map((i) => (p[i] ?? 0) - P[i]));
  const emitters = lab.spec.emitters.map((e): SliceEmitter => {
    const p = lab.tree.toRootPos(e.domain, emitterPos(lab, e));
    const off = offOf(p);
    return { id: e.id, hue: e.hue, a: p[ia], b: p[ib], off, onSlice: off <= ON_SLICE };
  });
  const domains: SliceDomain[] = [];
  for (const d of lab.tree.domains()) {
    const off = offOf(d.centerRoot);
    if (off >= d.radiusRoot) continue;
    domains.push({ id: d.id, a: d.centerRoot[ia], b: d.centerRoot[ib], r: Math.sqrt(d.radiusRoot * d.radiusRoot - off * off), shear: !!d.shear });
  }
  return { plane, probe: { a: P[ia], b: P[ib] }, held, emitters, domains };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Put the probe at (va, vb) on the two axes of a plane; the held coordinates do not move. Clamped to each axis' range. */
export function setProbeOn(lab: Lab, plane: Plane, va: number, vb: number): void {
  const h = hiddenAxes(lab.spec);
  const apply = (a: Axis, v: number): void => {
    const i = idx(a);
    if (i >= 2 + h) return;
    const [lo, hi] = rangeOf(a);
    const c = clamp(v, lo, hi);
    if (a === "x") lab.probe = [c, lab.probe[1]];
    else if (a === "y") lab.probe = [lab.probe[0], c];
    else if (a === "z") lab.probeZ = c;
    else lab.probeW = c;
  };
  apply(plane[0], va); apply(plane[1], vb);
  lab.arrivals.clear(); lab.rays.clear(); lab.bent.clear(); lab.tri = null;
}
