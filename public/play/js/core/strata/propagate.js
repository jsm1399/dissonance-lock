import { vadd, vsub, vscale, vdist } from "./vec.js";
/**
 * Straight-chord causal march. Adaptive: steps bisect at domain boundaries (error <= minStep),
 * midpoint (RK2) speed sampling in time. Straight chord => upper bound on true (Fermat) arrival.
 * Domains smaller than maxStep can be skipped; default maxStep = min(D/256, finestRadius/4).
 */
export function march(tree, from, tEmitLocal, to, opts = {}) {
    const a = tree.toRootPos(from.domain, from.pos);
    const b = tree.toRootPos(to.domain, to.pos);
    let t = tree.toRootTime(from.domain, tEmitLocal);
    const D = vdist(a, b);
    const dir = vscale(vsub(b, a), D > 0 ? 1 / D : 0);
    const at = (s) => vadd(a, vscale(dir, s));
    const maxStep = opts.maxStep ?? Math.min(D / 256, tree.finestRadius() / 4);
    const minStep = opts.minStep ?? maxStep / 4096;
    const maxSteps = opts.maxSteps ?? 1_000_000;
    const crossed = [tree.domainAt(a).id];
    const segments = [];
    let s = 0, h = maxStep, steps = 0;
    while (D - s > 1e-12 * D) {
        if (++steps > maxSteps)
            throw new Error("march: maxSteps exceeded (scale ratio too extreme for fixed maxStep)");
        const ds = Math.min(h, D - s);
        const p0 = at(s);
        const d0 = tree.domainAt(p0);
        if (tree.domainAt(at(s + ds)) !== d0 && ds > minStep) {
            h = ds / 2;
            continue;
        }
        const v0 = tree.speedAt(p0, t);
        const vm = tree.speedAt(at(s + ds / 2), t + ds / (2 * v0));
        t += ds / vm;
        s += ds;
        h = maxStep;
        const lastSeg = segments[segments.length - 1];
        if (lastSeg && lastSeg.domain === d0.id)
            lastSeg.length += ds;
        else
            segments.push({ domain: d0.id, length: ds });
        const id = tree.domainAt(at(s)).id;
        if (crossed[crossed.length - 1] !== id)
            crossed.push(id);
    }
    return { rootTime: t, localTime: tree.toLocalTime(to.domain, t), crossed, steps, segments };
}
/**
 * Distance a wavefront has reached along unit root-direction `dir` by root time tNow,
 * emitted from root position a at root time t0. Fixed-step midpoint march (visual/analytic use).
 */
export function reach(tree, a, dir, t0, tNow, maxDist, step) {
    if (tNow <= t0)
        return 0;
    let s = 0, t = t0;
    while (s < maxDist) {
        const v0 = tree.speedAt(vadd(a, vscale(dir, s)), t);
        const vm = tree.speedAt(vadd(a, vscale(dir, s + step / 2)), t + step / (2 * v0));
        const dt = step / vm;
        if (t + dt >= tNow)
            return s + (step * (tNow - t)) / dt;
        t += dt;
        s += step;
    }
    return maxDist;
}
/** 2D wavefront polygon (root coords): n rays from the emission point. */
export function wavefront(tree, from, tEmitLocal, tNowRoot, n, maxDist, step = 1) {
    const a = tree.toRootPos(from.domain, from.pos);
    const t0 = tree.toRootTime(from.domain, tEmitLocal);
    const out = [];
    for (let i = 0; i < n; i++) {
        const th = (2 * Math.PI * i) / n;
        const dir = [Math.cos(th), Math.sin(th)];
        out.push(vadd(a, vscale(dir, reach(tree, a, dir, t0, tNowRoot, maxDist, step))));
    }
    return out;
}
/**
 * Arrival-time field of one emission over a 2D root-coordinate box (the "causal landscape").
 * Straight-chord march per cell, so it is an upper bound on true arrival (see `march`).
 */
export function arrivalField(tree, from, tEmitLocal, min, max, n, opts = {}) {
    const values = new Float64Array(n * n);
    let tmin = Infinity, tmax = -Infinity;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = [min[0] + ((i + 0.5) * (max[0] - min[0])) / n, min[1] + ((j + 0.5) * (max[1] - min[1])) / n];
            const t = march(tree, from, tEmitLocal, { domain: "root", pos: p }, opts).rootTime;
            values[j * n + i] = t;
            if (t < tmin)
                tmin = t;
            if (t > tmax)
                tmax = t;
        }
    }
    return { n, values, tmin, tmax };
}
