import type { StrataTree } from "./tree.js";
import type { Vec } from "./vec.js";
import { vadd, vsub, vscale, vdist } from "./vec.js";

export interface Site { domain: string; pos: Vec }
export interface MarchOptions { maxStep?: number; minStep?: number; maxSteps?: number }
export interface Arrival { rootTime: number; localTime: number; crossed: string[]; steps: number }

/**
 * Straight-chord causal march. Adaptive: steps bisect at domain boundaries (error <= minStep),
 * midpoint (RK2) speed sampling in time. Straight chord => upper bound on true (Fermat) arrival.
 * Domains smaller than maxStep can be skipped; default maxStep = min(D/256, finestRadius/4).
 */
export function march(
  tree: StrataTree, from: Site, tEmitLocal: number, to: Site, opts: MarchOptions = {},
): Arrival {
  const a = tree.toRootPos(from.domain, from.pos);
  const b = tree.toRootPos(to.domain, to.pos);
  let t = tree.toRootTime(from.domain, tEmitLocal);
  const D = vdist(a, b);
  const dir = vscale(vsub(b, a), D > 0 ? 1 / D : 0);
  const at = (s: number): Vec => vadd(a, vscale(dir, s));

  const maxStep = opts.maxStep ?? Math.min(D / 256, tree.finestRadius() / 4);
  const minStep = opts.minStep ?? maxStep / 4096;
  const maxSteps = opts.maxSteps ?? 1_000_000;

  const crossed: string[] = [tree.domainAt(a).id];
  let s = 0, h = maxStep, steps = 0;

  while (D - s > 1e-12 * D) {
    if (++steps > maxSteps) throw new Error("march: maxSteps exceeded (scale ratio too extreme for fixed maxStep)");
    const ds = Math.min(h, D - s);
    const p0 = at(s);
    const d0 = tree.domainAt(p0);
    if (tree.domainAt(at(s + ds)) !== d0 && ds > minStep) { h = ds / 2; continue; }
    const v0 = tree.speedAt(p0, t);
    const vm = tree.speedAt(at(s + ds / 2), t + ds / (2 * v0));
    t += ds / vm;
    s += ds;
    h = maxStep;
    const id = tree.domainAt(at(s)).id;
    if (crossed[crossed.length - 1] !== id) crossed.push(id);
  }
  return { rootTime: t, localTime: tree.toLocalTime(to.domain, t), crossed, steps };
}

/**
 * Distance a wavefront has reached along unit root-direction `dir` by root time tNow,
 * emitted from root position a at root time t0. Fixed-step midpoint march (visual/analytic use).
 */
export function reach(
  tree: StrataTree, a: Vec, dir: Vec, t0: number, tNow: number, maxDist: number, step: number,
): number {
  if (tNow <= t0) return 0;
  let s = 0, t = t0;
  while (s < maxDist) {
    const v0 = tree.speedAt(vadd(a, vscale(dir, s)), t);
    const vm = tree.speedAt(vadd(a, vscale(dir, s + step / 2)), t + step / (2 * v0));
    const dt = step / vm;
    if (t + dt >= tNow) return s + (step * (tNow - t)) / dt;
    t += dt;
    s += step;
  }
  return maxDist;
}

/** 2D wavefront polygon (root coords): n rays from the emission point. */
export function wavefront(
  tree: StrataTree, from: Site, tEmitLocal: number, tNowRoot: number,
  n: number, maxDist: number, step = 1,
): Vec[] {
  const a = tree.toRootPos(from.domain, from.pos);
  const t0 = tree.toRootTime(from.domain, tEmitLocal);
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const dir: Vec = [Math.cos(th), Math.sin(th)];
    out.push(vadd(a, vscale(dir, reach(tree, a, dir, t0, tNowRoot, maxDist, step))));
  }
  return out;
}
