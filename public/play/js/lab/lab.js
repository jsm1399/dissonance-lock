import { arrivalField, countInversions, fermatField, lagSpread, march, sampleField } from "../core/strata/index.js";
import { DIM_MAX, DIM_MIN, LAWFUL, LOSS_STEPS, NOISE_STEPS, auditRay } from "../core/laws/index.js";
import { LIMITS, buildTree, defaultWorld, lawsOf, wellIds } from "./world.js";
export const SIZE = 100;
export const TMAX = 240;
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const MARCH = { maxStep: 1 };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clampPt = (p) => [clamp(p[0], 0, SIZE), clamp(p[1], 0, SIZE)];
export function newLab(spec = defaultWorld()) {
    let seq = 1;
    for (const id of [...spec.domains.map((d) => d.id), ...spec.emitters.map((e) => e.id)]) {
        const n = Number(id.replace(/\D/g, ""));
        if (Number.isFinite(n))
            seq = Math.max(seq, n + 1);
    }
    return {
        spec, tree: buildTree(spec), t: 0, playing: false, speedIdx: 2, probe: [50, 50], sel: null, tool: "select",
        seq, heat: null, rev: 0, arrivals: new Map(), rays: new Map(), fields: new Map(), bent: new Map(), pending: 0, launches: new Map(),
    };
}
export function rebuild(lab) {
    lab.tree = buildTree(lab.spec);
    lab.heat = null;
    lab.arrivals.clear();
    lab.rays.clear();
    lab.fields.clear();
    lab.bent.clear();
    lab.launches.clear();
    lab.rev++;
}
export function addDomain(lab, kind, at) {
    if (lab.spec.domains.length >= LIMITS.domains)
        return null;
    const parent = lab.tree.domainAt(at);
    if (kind === "micro" && !parent.parent)
        return null;
    const rpl = parent.rootPerLocal;
    const scale = kind === "micro" ? 8 : 1;
    let extentRoot = kind === "micro" ? 5 : 14;
    if (parent.parent)
        extentRoot = Math.min(extentRoot, parent.radiusRoot * 0.6);
    const o = lab.tree.toLocalPos(parent.id, at);
    const def = {
        id: `d${lab.seq++}`, parent: parent.id, origin: [o[0], o[1]], scale,
        extent: extentRoot / rpl, echoSpeed: (lab.spec.rootSpeed * scale) / rpl,
        rate: kind === "fast" ? 3 : kind === "micro" ? 2 : 1,
        shearMin: kind === "well" ? 0.2 : null, changes: [],
    };
    lab.spec.domains.push(def);
    rebuild(lab);
    return def.id;
}
export function addEmitter(lab, at) {
    if (lab.spec.emitters.length >= LIMITS.emitters)
        return null;
    const dom = lab.tree.domainAt(at);
    const o = lab.tree.toLocalPos(dom.id, at);
    const period = 4 * lab.tree.rateToRoot(dom, 0);
    const n = lab.spec.emitters.length;
    const def = {
        id: `e${lab.seq++}`, domain: dom.id, pos: [o[0], o[1]], period, phase: (n * 0.7) % period,
        hue: (190 + n * 67) % 360,
    };
    lab.spec.emitters.push(def);
    rebuild(lab);
    return def.id;
}
export function hitTest(lab, at) {
    if (Math.hypot(at[0] - lab.probe[0], at[1] - lab.probe[1]) < 3)
        return { kind: "probe", id: "probe" };
    let best = null, bd = 3;
    for (const e of lab.spec.emitters) {
        const p = lab.tree.toRootPos(e.domain, e.pos);
        const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
        if (d < bd) {
            bd = d;
            best = { kind: "emitter", id: e.id };
        }
    }
    if (best)
        return best;
    const dom = lab.tree.domainAt(at);
    return dom.parent ? { kind: "domain", id: dom.id } : null;
}
export function moveSel(lab, sel, to) {
    const at = clampPt(to);
    if (sel.kind === "probe") {
        lab.probe = at;
        lab.arrivals.clear();
        lab.rays.clear();
        lab.bent.clear();
        return;
    }
    if (sel.kind === "emitter") {
        const e = lab.spec.emitters.find((x) => x.id === sel.id);
        if (!e)
            return;
        const o = lab.tree.toLocalPos(e.domain, at);
        e.pos = [o[0], o[1]];
    }
    else {
        const d = lab.spec.domains.find((x) => x.id === sel.id);
        if (!d)
            return;
        const o = lab.tree.toLocalPos(d.parent, at);
        d.origin = [o[0], o[1]];
    }
    rebuild(lab);
}
export function removeSel(lab, sel) {
    if (sel.kind === "emitter") {
        pruneEmitters(lab, new Set([sel.id]));
    }
    else if (sel.kind === "domain") {
        const dead = new Set([sel.id]);
        for (const d of lab.spec.domains)
            if (dead.has(d.parent))
                dead.add(d.id); // parents precede children
        lab.spec.domains = lab.spec.domains.filter((d) => !dead.has(d.id));
        pruneEmitters(lab, new Set(lab.spec.emitters.filter((e) => dead.has(e.domain)).map((e) => e.id)));
    }
    else
        return;
    if (lab.sel && lab.sel.id === sel.id)
        lab.sel = null;
    rebuild(lab);
}
/** Remove emitters, everything that relays them (transitively), and their cuts. */
function pruneEmitters(lab, dead) {
    for (let grew = true; grew;) {
        grew = false;
        for (const e of lab.spec.emitters)
            if (!dead.has(e.id) && e.relay && dead.has(e.relay.from)) {
                dead.add(e.id);
                grew = true;
            }
    }
    lab.spec.emitters = lab.spec.emitters.filter((e) => !dead.has(e.id));
    if (lab.spec.cuts) {
        lab.spec.cuts = lab.spec.cuts.filter((c) => !dead.has(c.emitter));
        if (lab.spec.cuts.length === 0)
            delete lab.spec.cuts;
    }
    if (lab.sel && dead.has(lab.sel.id))
        lab.sel = null;
}
export function adjust(lab, sel, what, dir) {
    if (sel.kind === "domain") {
        const d = lab.spec.domains.find((x) => x.id === sel.id);
        if (!d)
            return;
        if (what === "size")
            d.extent = clamp(d.extent * Math.pow(1.12, dir), 1, 60);
        else if (what === "rate")
            d.rate = clamp(d.rate * Math.pow(1.25, dir), 0.2, 8);
        else
            return;
    }
    else if (sel.kind === "emitter" && what === "period") {
        const e = lab.spec.emitters.find((x) => x.id === sel.id);
        if (!e)
            return;
        if (e.relay)
            e.relay.delay = clamp(Math.max(0.1, e.relay.delay) * Math.pow(1.25, -dir), 0, 30);
        else
            e.period = clamp(e.period * Math.pow(1.15, dir), 0.8, 60);
    }
    else
        return;
    rebuild(lab);
}
/** Schedule a clock-drift event for a domain at the current scrub time. False if it would predate an earlier drift. */
export function driftRate(lab, sel, factor) {
    if (sel.kind !== "domain")
        return false;
    const d = lab.spec.domains.find((x) => x.id === sel.id);
    const dom = lab.tree.get(sel.id);
    if (!d || !dom.parent)
        return false;
    const pt = lab.tree.toLocalTime(dom.parent.id, lab.t);
    const last = d.changes[d.changes.length - 1];
    if (last && pt < last[0])
        return false;
    const next = clamp(dom.clock.rateAt(pt) * factor, 0.2, 8);
    if (last && pt === last[0])
        last[1] = next;
    else {
        if (d.changes.length >= LIMITS.changes)
            return false;
        d.changes.push([pt, next]);
    }
    rebuild(lab);
    return true;
}
const cutKey = (id, k) => `${id}|${k}`;
export const isCut = (lab, id, k) => !!lab.spec.cuts?.some((c) => c.emitter === id && c.k === k);
/**
 * When pulse k of an emitter really launches. Free-running emitters follow their own clock; a relay launches
 * `delay` (its own local time) after the source's pulse k reaches it. Cut pulses, and pulses a cut would have
 * caused, never happen (null). `ignoreOwnCut` gives the nominal time of a cut pulse (for drawing the cut).
 */
export function launchOf(lab, id, k, ignoreOwnCut = false) {
    const key = cutKey(id, k);
    if (!ignoreOwnCut) {
        const hit = lab.launches.get(key);
        if (hit !== undefined)
            return hit;
    }
    const e = lab.spec.emitters.find((x) => x.id === id);
    let out = null;
    if (e && (ignoreOwnCut || !isCut(lab, id, k))) {
        if (!e.relay) {
            const launchLocal = e.phase + k * e.period;
            out = { launchLocal, launchRoot: lab.tree.toRootTime(e.domain, launchLocal) };
        }
        else {
            const src = lab.spec.emitters.find((x) => x.id === e.relay?.from);
            const sl = src ? launchOf(lab, src.id, k) : null;
            if (src && sl) {
                const heardAt = march(lab.tree, { domain: src.domain, pos: src.pos }, sl.launchLocal, { domain: e.domain, pos: e.pos }, MARCH).rootTime;
                const launchLocal = lab.tree.toLocalTime(e.domain, heardAt) + e.relay.delay;
                out = { launchLocal, launchRoot: lab.tree.toRootTime(e.domain, launchLocal) };
            }
        }
    }
    if (!ignoreOwnCut)
        lab.launches.set(key, out);
    return out;
}
/** Root of a relay chain: the free-running emitter that ultimately drives it. */
function driver(lab, e) {
    let x = e;
    for (let n = 0; x.relay && n <= lab.spec.emitters.length; n++) {
        const up = lab.spec.emitters.find((q) => q.id === x.relay?.from);
        if (!up)
            break;
        x = up;
    }
    return x;
}
/** The latest `per` emissions of every emitter that have launched by root time `tRoot`. */
export function emissionsUpTo(lab, tRoot, per) {
    const out = [];
    for (const e of lab.spec.emitters) {
        const d = driver(lab, e);
        const tl = lab.tree.toLocalTime(d.domain, tRoot);
        const kmax = Math.floor((tl - d.phase) / d.period);
        // a relay lags its driver by flight time + delay: scan back until `per` pulses have actually launched
        const kmin = e.relay ? Math.max(1, kmax - 400) : Math.max(1, kmax - per + 1);
        let n = 0;
        for (let k = kmax; k >= kmin && n < per; k--) {
            const L = launchOf(lab, e.id, k);
            if (!L || (e.relay && L.launchRoot > tRoot))
                continue;
            n++;
            out.push({ emitter: e.id, hue: e.hue, k, domain: e.domain, pos: e.pos, launchLocal: L.launchLocal, launchRoot: L.launchRoot });
        }
    }
    return out;
}
/** The newest pulse of an emitter that has launched by lab.t (or its first pulse if none yet). */
function latestPulse(lab, e) {
    const got = emissionsUpTo(lab, lab.t, 1).find((x) => x.emitter === e.id);
    if (got)
        return got;
    if (e.relay)
        return null;
    const tl = lab.tree.toLocalTime(e.domain, lab.t);
    const k = Math.max(1, Math.floor((tl - e.phase) / e.period));
    const L = launchOf(lab, e.id, k);
    return L ? { emitter: e.id, hue: e.hue, k, domain: e.domain, pos: e.pos, launchLocal: L.launchLocal, launchRoot: L.launchRoot } : null;
}
/** Toggle a causal intervention: pulse k of `emitterId` never happens. Returns true if it is now cut. */
export function toggleCut(lab, emitterId, k) {
    const cuts = lab.spec.cuts ?? (lab.spec.cuts = []);
    const i = cuts.findIndex((c) => c.emitter === emitterId && c.k === k);
    let now = false;
    if (i >= 0)
        cuts.splice(i, 1);
    else if (cuts.length < LIMITS.cuts) {
        cuts.push({ emitter: emitterId, k });
        now = true;
    }
    if (cuts.length === 0)
        delete lab.spec.cuts;
    rebuild(lab);
    return now;
}
export function clearCuts(lab) {
    delete lab.spec.cuts;
    rebuild(lab);
}
/** A relay of `fromId` at `at`: it re-emits every pulse it hears, `delay` of its own time later. */
export function addRelay(lab, at, fromId, delay = 1) {
    const src = lab.spec.emitters.find((e) => e.id === fromId);
    if (!src || lab.spec.emitters.length >= LIMITS.emitters)
        return null;
    const dom = lab.tree.domainAt(at);
    const o = lab.tree.toLocalPos(dom.id, at);
    const def = {
        id: `e${lab.seq++}`, domain: dom.id, pos: [o[0], o[1]], period: src.period, phase: 0,
        hue: (src.hue + 47) % 360, relay: { from: fromId, delay },
    };
    lab.spec.emitters.push(def);
    rebuild(lab);
    return def.id;
}
export function rayAt(lab, em) {
    const key = `${em.emitter}|${em.k}`;
    let r = lab.rays.get(key);
    if (!r || !lab.arrivals.has(key)) { // arrivals is the cache's authority: cleared => recompute
        r = march(lab.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, { domain: "root", pos: lab.probe }, MARCH);
        lab.rays.set(key, r);
        lab.arrivals.set(key, r.rootTime);
    }
    return r;
}
export const BENT_N = 40;
const BOX_MIN = [0, 0], BOX_MAX = [SIZE, SIZE];
export const isBent = (lab) => lawsOf(lab.spec).path === "bent";
/** Bent-path arrival field of one emission; null until solved (see `pumpFields`). */
export function fieldOf(lab, em, build = false) {
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
export function arrivalAt(lab, em) {
    const key = `${em.emitter}|${em.k}`;
    if (isBent(lab)) {
        const f = fieldOf(lab, em);
        if (!f)
            return rayAt(lab, em).rootTime;
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
export function pumpFields(lab, budgetMs = 10) {
    if (!isBent(lab)) {
        lab.pending = 0;
        return 0;
    }
    const want = emissionsUpTo(lab, lab.t, 6).filter((e) => lab.t - e.launchRoot < 60).sort((a, b) => b.launchRoot - a.launchRoot);
    const t0 = performance.now();
    let left = 0;
    for (const em of want) {
        if (fieldOf(lab, em))
            continue;
        if (performance.now() - t0 < budgetMs)
            fieldOf(lab, em, true);
        else
            left++;
    }
    lab.pending = left;
    return left;
}
/** Everything the probe has perceived by lab.t, in perceived order. */
export function perceived(lab, per = 6) {
    const out = [];
    for (const em of emissionsUpTo(lab, lab.t, per)) {
        const arrival = arrivalAt(lab, em);
        if (arrival <= lab.t)
            out.push({ emission: em, arrival, lag: arrival - em.launchRoot });
    }
    return out.sort((a, b) => a.arrival - b.arrival);
}
export function metrics(lab, window = 12) {
    const ps = perceived(lab).filter((p) => p.arrival >= lab.t - window);
    const latest = new Map();
    for (const p of ps) {
        const q = latest.get(p.emission.emitter);
        if (!q || p.arrival > q.arrival)
            latest.set(p.emission.emitter, p);
    }
    return {
        spread: lagSpread([...latest.values()].map((p) => p.lag)),
        inversions: countInversions(ps.map((p) => ({ emitRoot: p.emission.launchRoot, perceivedAt: p.arrival })), 0.25),
        heard: ps.length,
    };
}
/** Causal landscape of one emitter's latest (or first) emission at lab.t. */
export function computeHeat(lab, emitterId, n = 40) {
    const e = lab.spec.emitters.find((x) => x.id === emitterId);
    if (!e)
        return false;
    const pulse = latestPulse(lab, e);
    if (!pulse)
        return false;
    const k = pulse.k;
    const from = { domain: e.domain, pos: e.pos }, tEmit = pulse.launchLocal;
    const field = isBent(lab)
        ? fermatField(lab.tree, from, tEmit, BOX_MIN, BOX_MAX, n)
        : arrivalField(lab.tree, from, tEmit, [0, 0], [SIZE, SIZE], n, { maxStep: 1.5 });
    lab.heat = { emitter: emitterId, k, launchLocal: tEmit, field };
    return true;
}
export const LAW_KEYS = ["time", "medium", "dim", "loss", "noise", "gauss", "path"];
const nextIn = (steps, v) => {
    const i = steps.indexOf(v);
    return steps[(i + 1) % steps.length];
};
/** Cycle one law to its next value and rebuild the world under it. */
export function cycleLaw(lab, key) {
    const cur = lawsOf(lab.spec);
    const next = { ...cur };
    if (key === "time")
        next.time = cur.time === "local" ? "global" : "local";
    else if (key === "medium")
        next.medium = cur.medium === "strata" ? "uniform" : "strata";
    else if (key === "dim")
        next.dim = cur.dim >= DIM_MAX ? DIM_MIN : cur.dim + 1;
    else if (key === "loss")
        next.loss = nextIn(LOSS_STEPS, cur.loss);
    else if (key === "noise")
        next.noise = nextIn(NOISE_STEPS, cur.noise);
    else if (key === "path")
        next.path = cur.path === "straight" ? "bent" : "straight";
    else
        next.gauss = cur.gauss === "holds" ? "leaky" : cur.gauss === "leaky" ? "runaway" : "holds";
    lab.spec.laws = next;
    rebuild(lab);
    return next;
}
export function resetLaws(lab) {
    lab.spec.laws = { ...LAWFUL };
    rebuild(lab);
}
/** Conservation audit of the latest emission of an emitter (default: selected, else first) along the chord to the probe. */
export function auditEmitter(lab, emitterId) {
    const id = emitterId ?? (lab.sel?.kind === "emitter" ? lab.sel.id : lab.spec.emitters[0]?.id);
    const e = lab.spec.emitters.find((x) => x.id === id);
    if (!e)
        return null;
    const em = latestPulse(lab, e);
    if (!em)
        return null;
    const ray = rayAt(lab, em);
    const from = lab.tree.toRootPos(e.domain, e.pos);
    const r = Math.hypot(from[0] - lab.probe[0], from[1] - lab.probe[1]);
    return { emitter: e.id, audit: auditRay(lawsOf(lab.spec), ray.segments, wellIds(lab.spec), ENERGY, r) };
}
export const ENERGY = 100;
