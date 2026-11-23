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
            emitter: em.emitter, hue: em.hue, k: em.k, dist: dist.get(em.emitter) ?? 0,
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
