import { auditEmitter, feedbackAudit, hasFeedback, triangulate, zetaFix } from "./lab.js";
import { LAWFUL, LOSS_STEPS, NOISE_STEPS } from "../core/laws/index.js";
import { rng } from "../game/rng.js";
import { lawsOf } from "./world.js";
const em = (o) => ({ domain: "root", period: 40, phase: 0, hue: 190, ...o });
const rate = (r) => `${r >= 0 ? "+" : ""}${r.toFixed(3)}/s`;
export const TRIALS = [
    {
        id: "runaway", name: "Runaway",
        brief: "A and B re-emit each other and every round trip is louder. Make the loop die out; do not remove it.",
        t: 0,
        world: () => ({
            v: 1, rootSpeed: 6, domains: [],
            emitters: [
                em({ id: "A", pos: [10, 50], hue: 190, fb: { from: "B", delay: 1, gain: 1.3 } }),
                em({ id: "B", pos: [40, 50], hue: 40, fb: { from: "A", delay: 1, gain: 1.3 } }),
            ],
        }),
        check(lab) {
            if (!hasFeedback(lab))
                return { ok: false, status: "the loop is gone: keep it, tame it" };
            const a = feedbackAudit(lab), w = a.worst;
            if (!w)
                return { ok: false, status: "no loop left: keep it, tame it" };
            const ok = w.verdict === "damped" && w.rate <= -0.01;
            return { ok, status: `${w.verdict.toUpperCase()} ${rate(w.rate)} · need damped, faster than -0.010/s` };
        },
    },
    {
        id: "ring", name: "Ring Forever",
        brief: "This loop fades away. Tune it so it rings forever: neither fading nor growing.",
        t: 0,
        world: () => ({
            v: 1, rootSpeed: 6, domains: [],
            emitters: [
                em({ id: "A", pos: [10, 50], hue: 190, fb: { from: "B", delay: 1, gain: 0.8 } }),
                em({ id: "B", pos: [40, 50], hue: 40, fb: { from: "A", delay: 1, gain: 1 } }),
            ],
        }),
        check(lab) {
            if (!hasFeedback(lab))
                return { ok: false, status: "the loop is gone: keep it" };
            const w = feedbackAudit(lab).worst;
            if (!w)
                return { ok: false, status: "no loop left: keep it" };
            return { ok: w.verdict === "marginal", status: `${w.verdict.toUpperCase()} ${rate(w.rate)} · need within ±0.002/s` };
        },
    },
    {
        id: "clock", name: "Quiet the Clock",
        brief: "Z is a zeta beacon whose clock drifts. Make the probe's calibration read as arithmetic time again.",
        t: 110,
        world: () => ({
            v: 1, rootSpeed: 6,
            domains: [{ id: "f", parent: "root", origin: [20, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 3, shearMin: null, changes: [[90, 2], [96, 3.5]] }],
            emitters: [em({ id: "Z", domain: "f", pos: [0, 0], zeta: 3 })],
        }),
        check(lab) {
            const f = zetaFix(lab);
            if (!f || !f.fix)
                return { ok: false, status: "probe is still listening…" };
            const dev = `${(f.deviation * 100).toFixed(2)}%`;
            return { ok: f.verdict === "baseline" && f.identified, status: `${f.verdict.toUpperCase()} · deviation ${dev} · need baseline (< 0.30%)` };
        },
    },
    {
        id: "fanout", name: "Fan-Out",
        brief: "S feeds two re-emitters and together they send out more energy than S gave. Make the world passive, keep both taps.",
        t: 0,
        world: () => ({
            v: 1, rootSpeed: 6, domains: [],
            emitters: [
                em({ id: "S", pos: [50, 10], period: 6, hue: 130 }),
                em({ id: "A", pos: [20, 70], hue: 190, fb: { from: "S", delay: 1, gain: 0.7 } }),
                em({ id: "B", pos: [80, 70], hue: 40, fb: { from: "S", delay: 1, gain: 0.7 } }),
            ],
        }),
        check(lab) {
            const taps = lab.spec.emitters.filter((e) => e.fb);
            if (taps.length < 2)
                return { ok: false, status: "both taps must stay" };
            const sum = taps.reduce((s, e) => s + (e.fb?.gain ?? 0), 0);
            const strong = taps.every((e) => (e.fb?.gain ?? 0) >= 0.25);
            const a = feedbackAudit(lab);
            return { ok: !a.amplifier && strong, status: `${a.amplifier ? "✗ energy created" : "✓ passive"} · fan-out ${sum.toFixed(2)} · need ≤ 1.00, each tap ≥ 0.25` };
        },
    },
    {
        id: "heavy", name: "Heavy Space",
        brief: "Space here has 4 dimensions, but the flux law runs away and the audit says energy is CREATED. Keep DIM at 4 and make the audit read conserved.",
        t: 20,
        world: () => ({
            v: 1, rootSpeed: 6, domains: [],
            emitters: [em({ id: "E", pos: [20, 50], period: 4 })],
            laws: { ...LAWFUL, dim: 4, gauss: "runaway" },
        }),
        check(lab) {
            const au = auditEmitter(lab, "E");
            const L = lawsOf(lab.spec);
            if (!au)
                return { ok: false, status: "no pulse yet" };
            const v = au.audit.verdict;
            return { ok: v === "conserved" && L.dim === 4, status: `energy ${v.toUpperCase()} · DIM ${L.dim} · need conserved at DIM 4` };
        },
    },
    {
        id: "universe", name: "Which Universe?",
        brief: "Six laws are hidden. Select E: read LAWS, ECHO and AUDIT. Set TIME, MEDIUM, DIM, LOSS, NOISE, GAUSS to match. RESET draws a new universe.",
        t: 100,
        hidden: (seed) => hiddenLaws(seed),
        world: (seed = 1) => ({
            v: 1, rootSpeed: 6,
            domains: [
                { id: "m", parent: "root", origin: [30, 62], scale: 1, extent: 18, echoSpeed: 6, rate: 1, shearMin: null, changes: [] },
                { id: "w", parent: "root", origin: [60, 64], scale: 1, extent: 9, echoSpeed: 6, rate: 1, shearMin: 0.2, changes: [] },
                { id: "f", parent: "root", origin: [60, 40], scale: 1, extent: 12, echoSpeed: 6, rate: 3, shearMin: null, changes: [] },
            ],
            emitters: [
                em({ id: "E", domain: "m", pos: [0, 0], period: 4, hue: 190 }),
                em({ id: "Z", domain: "f", pos: [0, 0], zeta: 2, hue: 40 }),
            ],
            laws: hiddenLaws(seed),
        }),
        check(lab, ctx) {
            const g = ctx?.guess, h = lawsOf(lab.spec);
            if (!g)
                return { ok: false, status: "no guess yet" };
            const ok = g.time === h.time && g.medium === h.medium && g.dim === h.dim && g.loss === h.loss && g.noise === h.noise && g.gauss === h.gauss;
            return { ok, status: `guess ${g.time} · ${g.medium} · D${g.dim} · loss ${g.loss} · noise ${g.noise} · ${g.gauss}${ok ? "" : " · measure, then set the knobs"}` };
        },
    },
    {
        id: "sightline", name: "Clear Sightline",
        brief: "A well bends the echoes, so the probe array misreads E. Move the probe until TRI reads FLAT (it then finds E's hidden height). Leave the sky alone.",
        t: 80,
        world: sightlineWorld,
        check(lab) {
            const base = sightlineWorld();
            const kept = base.domains.every((b) => {
                const d = lab.spec.domains.find((x) => x.id === b.id);
                return d && d.origin[0] === b.origin[0] && d.origin[1] === b.origin[1] && d.extent === b.extent && d.rate === b.rate && d.shearMin === b.shearMin;
            });
            if (!kept)
                return { ok: false, status: "the sky was changed: leave the well and the fast lane where they are" };
            const tr = triangulate(lab, "E");
            if (!tr)
                return { ok: false, status: "array listening…" };
            return { ok: tr.verdict === "flat", status: `${tr.verdict.toUpperCase()} · misfit ${tr.fix.residual.toFixed(4)}s · reads depth ${tr.fix.depth.toFixed(1)} · need flat` };
        },
    },
    {
        id: "heading", name: "Hidden Heading",
        brief: "E hides off your plane in a 4D world. TRI's lifted arrays read its signed hidden coordinates (z, w). Fly the probe there (Z / I, Shift reverses, steps of 4) until TRI reads E in your slice. Leave E alone.",
        t: 80,
        world: headingWorld,
        check(lab) {
            const base = headingWorld().emitters[0];
            const e = lab.spec.emitters.find((x) => x.id === "E");
            if (!lab.spec.bulk2 || !e || e.z !== base.z || e.w !== base.w || e.pos[0] !== base.pos[0] || e.pos[1] !== base.pos[1]) {
                return { ok: false, status: "E must stay where it is, in 4D: find it, do not move it" };
            }
            const tr = triangulate(lab, "E");
            if (!tr)
                return { ok: false, status: "array listening…" };
            const d = tr.fix.depth;
            return { ok: tr.verdict === "flat" && d <= HEADING_TOL, status: `${tr.verdict.toUpperCase()} · reads ${d.toFixed(1)} hidden units away · need ≤ ${HEADING_TOL}` };
        },
    },
];
/** The probe must read this close (hidden units) to E's slice. Probe steps are 4, so the target lies on the step grid. */
export const HEADING_TOL = 1.5;
/** 4D, empty sky: E hides at z=12, w=-8 (norm 14.4). A plane array reads only the norm; the lifted arrays give the signed heading. */
function headingWorld() {
    return {
        v: 1, rootSpeed: 6, bulk: true, bulk2: true, domains: [],
        emitters: [em({ id: "E", pos: [30, 30], period: 4, z: 12, w: -8 })],
    };
}
/** Bulk world: E hides 9 above the plane; a shear well sits between it and the default probe, plus a fast lane. */
function sightlineWorld() {
    return {
        v: 1, rootSpeed: 6, bulk: true,
        domains: [
            { id: "w", parent: "root", origin: [46, 44], scale: 1, extent: 15, echoSpeed: 6, rate: 1, shearMin: 0.2, changes: [] },
            { id: "f", parent: "root", origin: [76, 74], scale: 1, extent: 12, echoSpeed: 6, rate: 3, shearMin: null, changes: [] },
        ],
        emitters: [em({ id: "E", pos: [20, 25], period: 4, z: 9 })],
    };
}
/** Seeded hidden laws: all six vary (only the path law stays straight). Always at least 3 deviations from lawful. */
export function hiddenLaws(seed) {
    const r = rng(seed * 2654435761 + 12345);
    for (let i = 0; i < 50; i++) {
        const L = {
            ...LAWFUL,
            time: r() < 0.5 ? "local" : "global",
            medium: r() < 0.5 ? "strata" : "uniform",
            noise: NOISE_STEPS[Math.floor(r() * NOISE_STEPS.length)],
            dim: 2 + Math.floor(r() * 4),
            loss: LOSS_STEPS[Math.floor(r() * LOSS_STEPS.length)],
            gauss: ["holds", "leaky", "runaway"][Math.floor(r() * 3)],
        };
        const dev = (L.time !== LAWFUL.time ? 1 : 0) + (L.medium !== LAWFUL.medium ? 1 : 0) + (L.dim !== LAWFUL.dim ? 1 : 0)
            + (L.loss !== LAWFUL.loss ? 1 : 0) + (L.noise !== LAWFUL.noise ? 1 : 0) + (L.gauss !== LAWFUL.gauss ? 1 : 0);
        if (dev >= 3)
            return L;
    }
    return { ...LAWFUL, dim: 4, gauss: "leaky" };
}
