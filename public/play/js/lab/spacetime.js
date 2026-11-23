import { CausalLedger } from "../core/strata/index.js";
import { arrivalAt, emissionsUpTo } from "./lab.js";
export const PER = 8;
export const MARGIN = 0.25;
export const WINDOW = 12;
export function spacetime(lab, per = PER, margin = MARGIN, window = WINDOW) {
    const dist = new Map();
    let dmax = 1;
    for (const e of lab.spec.emitters) {
        const p = lab.tree.toRootPos(e.domain, e.pos);
        const d = Math.hypot(p[0] - lab.probe[0], p[1] - lab.probe[1]);
        dist.set(e.id, d);
        dmax = Math.max(dmax, d);
    }
    const lines = emissionsUpTo(lab, lab.t, per).map((em) => {
        const arrival = arrivalAt(lab, em);
        return {
            emitter: em.emitter, hue: em.hue, k: em.k, domain: em.domain, pos: em.pos, launchLocal: em.launchLocal,
            dist: dist.get(em.emitter) ?? 0,
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
    return { lines, horizon, inversions, dmax: dmax * 1.06 };
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
    return { origin, rel, past, future, independent };
}
const ledgerOf = (lab) => ledgers.get(lab).ledger;
