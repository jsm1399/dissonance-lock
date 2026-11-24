import { CausalLedger } from "../core/strata/index.js";
import { arrivalAt, dist as dist3, emissionsUpTo, emitterPos, launchOf, probeSite } from "./lab.js";
export const PER = 8;
export const MARGIN = 0.25;
export const WINDOW = 12;
export function spacetime(lab, per = PER, margin = MARGIN, window = WINDOW) {
    const dist = new Map();
    let dmax = 1;
    for (const e of lab.spec.emitters) {
        const d = dist3(lab.tree.toRootPos(e.domain, emitterPos(lab, e)), probeSite(lab));
        dist.set(e.id, d);
        dmax = Math.max(dmax, d);
    }
    const lines = emissionsUpTo(lab, lab.t, per).map((em) => {
        const arrival = arrivalAt(lab, em);
        return {
            emitter: em.emitter, hue: em.hue, k: em.k, domain: em.domain, pos: em.pos, launchLocal: em.launchLocal,
            dist: dist.get(em.emitter) ?? 0,
            launch: em.launchRoot, arrival, heard: arrival <= lab.t, inverted: false,
            cause: lab.spec.emitters.find((e) => e.id === em.emitter)?.relay ? `${lab.spec.emitters.find((e) => e.id === em.emitter)?.relay?.from}|${em.k}` : null,
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
    const newest = new Map();
    for (const l of lines) {
        if (!l.heard)
            continue;
        const q = newest.get(l.emitter);
        if (!q || l.launch > q.launch)
            newest.set(l.emitter, l);
    }
    const horizon = [...newest.values()]
        .map((l) => ({ emitter: l.emitter, dist: l.dist, launch: l.launch }))
        .sort((a, b) => a.dist - b.dist);
    const cuts = [];
    for (const c of lab.spec.cuts ?? []) {
        const L = launchOf(lab, c.emitter, c.k, true);
        const e = lab.spec.emitters.find((x) => x.id === c.emitter);
        if (L && e)
            cuts.push({ emitter: c.emitter, k: c.k, hue: e.hue, dist: dist.get(c.emitter) ?? 0, launch: L.launchRoot });
    }
    return { lines, horizon, inversions, dmax: dmax * 1.06, cuts };
}
const ledgers = new WeakMap();
function eventOf(lab, w) {
    let c = ledgers.get(lab);
    if (!c || c.rev !== lab.rev) {
        c = { rev: lab.rev, ledger: new CausalLedger(lab.tree, { maxStep: 1 }), ev: new Map() };
        ledgers.set(lab, c);
    }
    const key = `${w.emitter}|${w.k}`;
    let e = c.ev.get(key);
    if (!e) {
        e = c.ledger.emit({ domain: w.domain, pos: w.pos }, w.launchLocal, key);
        c.ev.set(key, e);
    }
    return e;
}
/**
 * Can the pulse of `emitterId` (newest, or the one launched nearest `aroundLaunch`) have influenced / been influenced by every other pulse in view?
 * future = its signal reaches that pulse's emitter before that pulse is launched; past = the reverse;
 * independent = neither (spacelike). Uses straight chords, i.e. an upper bound on arrival (see `march`).
 */
export function causalCone(lab, st, emitterId, aroundLaunch) {
    let origin = null;
    const score = (l) => (aroundLaunch === undefined ? l.k : -Math.abs(l.launch - aroundLaunch));
    for (const l of st.lines)
        if (l.emitter === emitterId && (!origin || score(l) > score(origin)))
            origin = l;
    if (!origin)
        return null;
    const a = eventOf(lab, origin);
    const rel = new Map();
    let past = 0, future = 0, independent = 0;
    for (const l of st.lines) {
        if (l === origin)
            continue;
        const x = ledgerOf(lab).relation(a, eventOf(lab, l));
        const v = x === "before" ? "future" : x === "after" ? "past" : x === "same" ? "future" : "independent";
        rel.set(l, v);
        if (v === "past")
            past++;
        else if (v === "future")
            future++;
        else
            independent++;
    }
    const caused = new Set();
    const frontier = [`${origin.emitter}|${origin.k}`];
    while (frontier.length > 0) {
        const key = frontier.pop();
        for (const l of st.lines) {
            if (l.cause === key && !caused.has(l)) {
                caused.add(l);
                frontier.push(`${l.emitter}|${l.k}`);
            }
        }
    }
    return { origin, rel, past, future, independent, caused };
}
const ledgerOf = (lab) => ledgers.get(lab).ledger;
