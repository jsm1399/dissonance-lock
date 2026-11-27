import { TMAX, auditEmitter, feedbackAudit, hasFeedback, newLab, zetaFix } from "./lab.js";
import { lawsOf, packJson, parseWorld, roundWorld, unpackJson } from "./world.js";
export const GOAL_KINDS = ["damped", "marginal", "passive", "conserved", "baseline"];
export const MIN_TAP_GAIN = 0.25;
export const DAMPED_RATE = -0.01;
const NAME_MAX = 28;
const GOAL_TITLE = {
    damped: "Damp the loop", marginal: "Ring forever", passive: "Make it passive", conserved: "Conserve energy", baseline: "Quiet the clock",
};
export const goalTitle = (k) => GOAL_TITLE[k];
export const keepOf = (spec) => ({ taps: spec.emitters.filter((e) => e.fb).length, dim: lawsOf(spec).dim });
/** Why a goal cannot be set on this world (empty = it can). */
export function goalProblems(spec, g) {
    const taps = spec.emitters.filter((e) => e.fb).length;
    const target = g.target === undefined ? undefined : spec.emitters.find((e) => e.id === g.target);
    switch (g.kind) {
        case "damped":
        case "marginal": return taps > 0 ? [] : ["needs a feedback loop (LOOP tool)"];
        case "passive": return taps > 0 ? [] : ["needs at least one feedback tap (LOOP tool)"];
        case "conserved": return target ? [] : ["select the emitter whose energy is audited"];
        case "baseline": return target && target.zeta !== undefined ? [] : ["select a zeta beacon (ZETA)"];
        default: return ["unknown goal"];
    }
}
const rate = (r) => `${r >= 0 ? "+" : ""}${r.toFixed(3)}/s`;
/** Judge a lab against a goal. Pure: reads only the Observatory's own audits. */
export function checkGoal(lab, goal, keep) {
    const taps = lab.spec.emitters.filter((e) => e.fb);
    switch (goal.kind) {
        case "damped":
        case "marginal": {
            if (!hasFeedback(lab) || taps.length < keep.taps)
                return { ok: false, status: "a tap was removed: keep the loop, tame it" };
            const w = feedbackAudit(lab).worst;
            if (!w)
                return { ok: false, status: "no loop left: keep it" };
            const ok = goal.kind === "damped" ? w.verdict === "damped" && w.rate <= DAMPED_RATE : w.verdict === "marginal";
            const need = goal.kind === "damped" ? "need damped, faster than -0.010/s" : "need marginal, within ±0.002/s";
            return { ok, status: `${w.verdict.toUpperCase()} ${rate(w.rate)} · ${need}` };
        }
        case "passive": {
            if (taps.length < keep.taps)
                return { ok: false, status: "a tap was removed: keep them all" };
            const weak = taps.some((e) => (e.fb?.gain ?? 0) < MIN_TAP_GAIN);
            const a = feedbackAudit(lab);
            const sum = taps.reduce((s, e) => s + (e.fb?.gain ?? 0), 0);
            return { ok: !a.amplifier && !weak, status: `${a.amplifier ? "✗ energy created" : "✓ passive"} · fan-out ${sum.toFixed(2)} · need passive, each tap ≥ ${MIN_TAP_GAIN.toFixed(2)}` };
        }
        case "conserved": {
            const au = goal.target ? auditEmitter(lab, goal.target) : null;
            if (!au)
                return { ok: false, status: "no pulse heard from the audited emitter yet" };
            const L = lawsOf(lab.spec);
            const v = au.audit.verdict;
            return { ok: v === "conserved" && L.dim === keep.dim, status: `energy ${v.toUpperCase()} · DIM ${L.dim} · need conserved at DIM ${keep.dim}` };
        }
        case "baseline": {
            const f = goal.target ? zetaFix(lab, goal.target) : null;
            if (!f || !f.fix)
                return { ok: false, status: "probe is still listening…" };
            return { ok: f.verdict === "baseline" && f.identified, status: `${f.verdict.toUpperCase()} · deviation ${(f.deviation * 100).toFixed(2)}% · need baseline (< 0.30%)` };
        }
        default: return { ok: false, status: "unknown goal" };
    }
}
const clean = (s) => s.replace(/[^A-Za-z0-9 ·\-]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
export function briefOf(goal, keep) {
    const taps = keep.taps === 1 ? "the tap" : `all ${keep.taps} taps`;
    switch (goal.kind) {
        case "damped": return `Make this loop die out, faster than -0.010/s. Keep ${taps}; do not delete the loop.`;
        case "marginal": return `Tune this loop so it rings forever: neither fading nor growing. Keep ${taps}.`;
        case "passive": return `Together the taps send out more energy than they hear. Make the world passive; keep ${taps}, each at gain 0.25 or more.`;
        case "conserved": return `The audit of ${goal.target} does not conserve energy. Make it read conserved and keep DIM at ${keep.dim}.`;
        case "baseline": return `${goal.target} is a zeta beacon whose timing is not arithmetic. Make the probe's FIX read baseline.`;
        default: return "";
    }
}
/**
 * Seal a trial. `start` is the broken world as the author left it, `solved` the lab the author then repaired.
 * Refuses unless the goal is settable, the start FAILS it and the solved world PASSES it (the witness).
 */
export function forge(name, goal, t, start, solved) {
    // judge both worlds exactly as a player will meet them: rounded for the link, default probe, the trial's scrub time
    const world = parseWorld(roundWorld(start)), fixed = parseWorld(roundWorld(solved));
    if (!world || !fixed)
        return { ok: false, why: "that world is not shareable" };
    const problems = goalProblems(world, goal);
    if (problems.length > 0)
        return { ok: false, why: problems[0] };
    const tt = Math.min(TMAX, Math.max(0, Math.round(t * 10) / 10));
    const keep = keepOf(world);
    if (judge(world, goal, keep, tt).ok)
        return { ok: false, why: "the start already passes: break it first" };
    const w = judge(fixed, goal, keep, tt);
    if (!w.ok)
        return { ok: false, why: `not solved yet · ${w.status}` };
    return { ok: true, trial: { v: 1, name: clean(name) || `Custom ${goalTitle(goal.kind)}`, goal: { ...goal }, t: tt, world } };
}
/** Judge a bare world with a fresh lab (default probe), as every player of a shared trial sees it. */
export function judge(world, goal, keep, t) {
    const l = newLab(world);
    l.t = t;
    return checkGoal(l, goal, keep);
}
/** Does this world already satisfy the goal at scrub time t (a trial must start broken)? */
export const startsSolved = (world, goal, t) => judge(world, goal, keepOf(world), t).ok;
/** The runnable Trial for a custom spec (same shape as the built-in ones). */
export function asTrial(ct) {
    const keep = keepOf(ct.world);
    return {
        id: "custom", name: ct.name, brief: briefOf(ct.goal, keep), t: ct.t,
        world: () => parseWorld(JSON.parse(JSON.stringify(ct.world))),
        check: (lab) => checkGoal(lab, ct.goal, keep),
    };
}
export const encodeTrial = (ct) => packJson({ v: 1, n: ct.name, g: ct.goal.kind, e: ct.goal.target, t: ct.t, w: roundWorld(ct.world) });
/** Strict parse of an untrusted link. Null on any problem, including a trial that is already solved on arrival. */
export function decodeTrial(s) {
    try {
        const j = unpackJson(s);
        if (!j || typeof j !== "object" || j.v !== 1)
            return null;
        if (typeof j.g !== "string" || !GOAL_KINDS.includes(j.g))
            return null;
        if (typeof j.t !== "number" || !Number.isFinite(j.t) || j.t < 0 || j.t > TMAX)
            return null;
        if (j.e !== undefined && typeof j.e !== "string")
            return null;
        const world = parseWorld(j.w);
        if (!world)
            return null;
        const goal = { kind: j.g, ...(j.e === undefined ? {} : { target: j.e }) };
        if (goalProblems(world, goal).length > 0)
            return null;
        if (startsSolved(world, goal, j.t))
            return null;
        return { v: 1, name: clean(typeof j.n === "string" ? j.n : "") || `Custom ${goalTitle(goal.kind)}`, goal, t: j.t, world };
    }
    catch {
        return null;
    }
}
