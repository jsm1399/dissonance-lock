import { StrataTree } from "../core/strata/index.js";
import { LAWFUL, cloneLaws, isLawful, parseLaws, validateLaws } from "../core/laws/index.js";
export const lawsOf = (spec) => spec.laws ?? LAWFUL;
export const LIMITS = { domains: 24, emitters: 24, changes: 8, cuts: 24, fbDelay: 30, fbGain: 4, zetaMin: 0.2, zetaMax: 5 };
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const pair = (x) => Array.isArray(x) && x.length === 2 && fin(x[0]) && fin(x[1]);
/** Human-readable problems; empty array = valid. Parents must precede children. */
export function validate(spec) {
    const errs = [];
    if (spec.v !== 1)
        errs.push("unsupported version");
    if (!fin(spec.rootSpeed) || spec.rootSpeed <= 0)
        errs.push("rootSpeed must be > 0");
    if (spec.domains.length > LIMITS.domains)
        errs.push("too many domains");
    if (spec.emitters.length > LIMITS.emitters)
        errs.push("too many emitters");
    if (spec.laws)
        errs.push(...validateLaws(spec.laws));
    const ids = new Set(["root"]);
    for (const d of spec.domains) {
        if (!d.id || ids.has(d.id))
            errs.push(`bad/duplicate domain id ${d.id}`);
        if (!ids.has(d.parent))
            errs.push(`domain ${d.id}: unknown or later parent ${d.parent}`);
        if (!pair(d.origin))
            errs.push(`domain ${d.id}: bad origin`);
        for (const [k, v] of [["scale", d.scale], ["extent", d.extent], ["echoSpeed", d.echoSpeed], ["rate", d.rate]]) {
            if (!fin(v) || v <= 0)
                errs.push(`domain ${d.id}: ${k} must be > 0`);
        }
        if (d.shearMin !== null && (!fin(d.shearMin) || d.shearMin <= 0 || d.shearMin > 1))
            errs.push(`domain ${d.id}: shearMin in (0,1]`);
        if (d.changes.length > LIMITS.changes)
            errs.push(`domain ${d.id}: too many clock changes`);
        let prev = -Infinity;
        for (const c of d.changes) {
            if (!pair(c) || c[0] < prev || c[1] <= 0)
                errs.push(`domain ${d.id}: bad clock change`);
            else
                prev = c[0];
        }
        ids.add(d.id);
    }
    const eids = new Set();
    for (const e of spec.emitters) {
        if (!e.id || eids.has(e.id))
            errs.push(`bad/duplicate emitter id ${e.id}`);
        eids.add(e.id);
        if (!ids.has(e.domain))
            errs.push(`emitter ${e.id}: unknown domain ${e.domain}`);
        if (!pair(e.pos))
            errs.push(`emitter ${e.id}: bad pos`);
        if (!fin(e.period) || e.period <= 0)
            errs.push(`emitter ${e.id}: period must be > 0`);
        if (!fin(e.phase) || e.phase < 0)
            errs.push(`emitter ${e.id}: phase must be >= 0`);
        if (!fin(e.hue))
            errs.push(`emitter ${e.id}: bad hue`);
        if (e.z !== undefined && (!fin(e.z) || Math.abs(e.z) > 200 || (!spec.bulk && e.z !== 0)))
            errs.push(`emitter ${e.id}: bad depth`);
    }
    if (spec.bulk !== undefined && spec.bulk !== true)
        errs.push("bulk must be true or absent");
    const byId = new Map(spec.emitters.map((e) => [e.id, e]));
    for (const e of spec.emitters) {
        if (e.relay === undefined)
            continue;
        const r = e.relay;
        if (!r || typeof r !== "object" || typeof r.from !== "string" || !fin(r.delay) || r.delay < 0) {
            errs.push(`emitter ${e.id}: bad relay`);
            continue;
        }
        if (!byId.has(r.from)) {
            errs.push(`emitter ${e.id}: relay source ${r.from} unknown`);
            continue;
        }
        let x = e, n = 0;
        while (x && x.relay && n++ <= spec.emitters.length)
            x = byId.get(x.relay.from);
        if (n > spec.emitters.length)
            errs.push(`emitter ${e.id}: relay cycle`);
    }
    for (const e of spec.emitters) {
        if (e.zeta === undefined)
            continue;
        if (!fin(e.zeta) || e.zeta < LIMITS.zetaMin || e.zeta > LIMITS.zetaMax)
            errs.push(`emitter ${e.id}: bad zeta scale`);
        else if (e.relay)
            errs.push(`emitter ${e.id}: a relay follows its source, it cannot keep zeta time`);
    }
    for (const e of spec.emitters) {
        if (e.fb === undefined)
            continue;
        const f = e.fb;
        if (!f || typeof f !== "object" || typeof f.from !== "string" || !fin(f.delay) || f.delay < 0 || f.delay > LIMITS.fbDelay
            || !fin(f.gain) || f.gain <= 0 || f.gain > LIMITS.fbGain)
            errs.push(`emitter ${e.id}: bad feedback`);
        else if (!byId.has(f.from))
            errs.push(`emitter ${e.id}: feedback source ${f.from} unknown`);
    }
    if (spec.cuts !== undefined) {
        if (!Array.isArray(spec.cuts) || spec.cuts.length > LIMITS.cuts)
            errs.push("bad or too many cuts");
        else
            for (const c of spec.cuts) {
                if (!c || !byId.has(c.emitter) || !Number.isInteger(c.k) || c.k < 1)
                    errs.push("bad cut");
            }
    }
    return errs;
}
/** Build the strata under the world's laws: same data, different physics. */
export function buildTree(spec) {
    const laws = lawsOf(spec);
    const bulk = spec.bulk === true;
    const t = new StrataTree(bulk ? 3 : 2, spec.rootSpeed);
    const globalTime = laws.time === "global", uniform = laws.medium === "uniform";
    for (const d of spec.domains) {
        const radLocal = d.extent * d.scale;
        const sm = uniform ? null : d.shearMin;
        // uniform medium: pick the local echo speed that makes the ROOT speed equal rootSpeed everywhere
        const rplChild = t.get(d.parent).rootPerLocal / d.scale;
        t.add({
            id: d.id, parent: d.parent, origin: bulk ? [d.origin[0], d.origin[1], 0] : d.origin, scale: d.scale, extent: d.extent,
            echoSpeed: uniform ? spec.rootSpeed / rplChild : d.echoSpeed, rate: globalTime ? 1 : d.rate,
            shear: sm === null ? undefined : (p) => sm + (1 - sm) * Math.min(1, Math.hypot(...p) / radLocal),
        });
    }
    if (!globalTime)
        for (const d of spec.domains)
            for (const [tm, rt] of d.changes)
                t.setRate(d.id, tm, rt);
    return t;
}
/** Ids of domains that are shear wells (information noise lives there). */
export const wellIds = (spec) => new Set(spec.domains.filter((d) => d.shearMin !== null).map((d) => d.id));
export function defaultWorld() {
    return {
        v: 1, rootSpeed: 6,
        domains: [
            { id: "d1", parent: "root", origin: [30, 58], scale: 1, extent: 18, echoSpeed: 6, rate: 3, shearMin: null, changes: [[30, 1.5]] },
            { id: "d2", parent: "root", origin: [72, 34], scale: 1, extent: 15, echoSpeed: 6, rate: 1, shearMin: 0.2, changes: [] },
        ],
        emitters: [
            { id: "e1", domain: "root", pos: [12, 12], period: 4, phase: 0, hue: 190 },
            { id: "e2", domain: "d1", pos: [-6, 8], period: 12, phase: 2, hue: 40 },
            { id: "e3", domain: "d2", pos: [5, -4], period: 4.4, phase: 0.6, hue: 300 },
            { id: "e4", domain: "root", pos: [88, 88], period: 5.2, phase: 1.2, hue: 130 },
        ],
    };
}
/** Strict structural parse + validate; null on any problem. */
export function parseWorld(raw) {
    try {
        const j = (typeof raw === "string" ? JSON.parse(raw) : raw);
        if (!j || typeof j !== "object" || !Array.isArray(j.domains) || !Array.isArray(j.emitters))
            return null;
        const laws = parseLaws(j.laws);
        if (!laws)
            return null;
        const spec = {
            v: j.v, rootSpeed: j.rootSpeed,
            domains: j.domains.map((d) => ({
                id: String(d.id), parent: String(d.parent), origin: d.origin, scale: d.scale, extent: d.extent,
                echoSpeed: d.echoSpeed, rate: d.rate, shearMin: d.shearMin === undefined ? null : d.shearMin,
                changes: Array.isArray(d.changes) ? d.changes : [],
            })),
            emitters: j.emitters.map((e) => ({
                id: String(e.id), domain: String(e.domain), pos: e.pos, period: e.period, phase: e.phase, hue: e.hue,
                ...(e.z === undefined ? {} : { z: e.z }),
                ...(e.zeta === undefined ? {} : { zeta: e.zeta }),
                ...(e.fb === undefined ? {} : { fb: e.fb && typeof e.fb === "object" ? { from: String(e.fb.from), delay: e.fb.delay, gain: e.fb.gain } : e.fb }),
                ...(e.relay === undefined ? {} : { relay: e.relay && typeof e.relay === "object" ? { from: String(e.relay.from), delay: e.relay.delay } : e.relay }),
            })),
            ...(isLawful(laws) ? {} : { laws }),
            ...(j.bulk === undefined ? {} : { bulk: j.bulk }),
            ...(Array.isArray(j.cuts) && j.cuts.length > 0 ? { cuts: j.cuts.map((c) => ({ emitter: String(c?.emitter), k: c?.k })) } : {}),
        };
        if (validate(spec).length > 0)
            return null;
        buildTree(spec);
        return spec;
    }
    catch {
        return null;
    }
}
// ---- compact link encoding (base64url of UTF-8 JSON) ----
const b64 = (bytes) => {
    let s = "";
    for (const b of bytes)
        s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (str) => {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++)
        out[i] = s.charCodeAt(i);
    return out;
};
const r2 = (x) => Math.round(x * 1000) / 1000;
/** The spec with every number rounded for a compact, stable link. */
export function roundWorld(spec) {
    return {
        v: spec.v, rootSpeed: r2(spec.rootSpeed),
        ...(spec.laws && !isLawful(spec.laws) ? { laws: cloneLaws(spec.laws) } : {}),
        domains: spec.domains.map((d) => ({
            ...d, origin: [r2(d.origin[0]), r2(d.origin[1])], scale: r2(d.scale), extent: r2(d.extent),
            echoSpeed: r2(d.echoSpeed), rate: r2(d.rate), shearMin: d.shearMin === null ? null : r2(d.shearMin),
            changes: d.changes.map(([t, r]) => [r2(t), r2(r)]),
        })),
        emitters: spec.emitters.map((e) => ({
            ...e, pos: [r2(e.pos[0]), r2(e.pos[1])], period: r2(e.period), phase: r2(e.phase), hue: Math.round(e.hue),
            ...(e.relay ? { relay: { from: e.relay.from, delay: r2(e.relay.delay) } } : {}),
            ...(e.z !== undefined ? { z: r2(e.z) } : {}),
            ...(e.zeta !== undefined ? { zeta: r2(e.zeta) } : {}),
            ...(e.fb ? { fb: { from: e.fb.from, delay: r2(e.fb.delay), gain: r2(e.fb.gain) } } : {}),
        })),
        ...(spec.bulk ? { bulk: true } : {}),
        ...(spec.cuts && spec.cuts.length > 0 ? { cuts: spec.cuts.map((c) => ({ emitter: c.emitter, k: c.k })) } : {}),
    };
}
export function encodeWorld(spec) {
    return b64(new TextEncoder().encode(JSON.stringify(roundWorld(spec))));
}
/** Any JSON value <-> base64url (shared by world and trial links). */
export const packJson = (o) => b64(new TextEncoder().encode(JSON.stringify(o)));
export function unpackJson(s) {
    try {
        return JSON.parse(new TextDecoder().decode(unb64(s)));
    }
    catch {
        return undefined;
    }
}
export function decodeWorld(s) {
    try {
        return parseWorld(new TextDecoder().decode(unb64(s)));
    }
    catch {
        return null;
    }
}
