import test from "node:test";
import assert from "node:assert/strict";
import { TRIALS } from "../src/lab/trials.js";
import { GOAL_KINDS, asTrial, briefOf, checkGoal, decodeTrial, encodeTrial, forge, goalProblems, keepOf, placeProbe, probeOf, startsSolved } from "../src/lab/forge.js";
import type { ProbePos } from "../src/lab/forge.js";
import type { Goal } from "../src/lab/forge.js";
import { adjustFeedback, clearDrifts, cycleLaw, moveSel, newLab, removeFeedback, setDepth, triangulate } from "../src/lab/lab.js";
import type { Lab } from "../src/lab/lab.js";
import { packJson, validate } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const trial = (id: string) => TRIALS.find((t) => t.id === id)!;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const times = (n: number, f: () => unknown) => { for (let i = 0; i < n; i++) f(); };
const lab = (id: string): Lab => { const t = trial(id), l = newLab(t.world()); l.t = t.t; return l; };

interface Case { id: string; goal: Goal; solve(l: Lab): void }
const CASES: Case[] = [
  { id: "runaway", goal: { kind: "damped" }, solve: (l) => times(9, () => adjustFeedback(l, "A", "gain", -1)) },
  { id: "ring", goal: { kind: "marginal" }, solve: (l) => times(3, () => adjustFeedback(l, "A", "gain", 1)) },
  { id: "fanout", goal: { kind: "passive" }, solve: (l) => times(5, () => { adjustFeedback(l, "A", "gain", -1); adjustFeedback(l, "B", "gain", -1); }) },
  { id: "heavy", goal: { kind: "conserved", target: "E" }, solve: (l) => { cycleLaw(l, "gauss"); } },
  { id: "clock", goal: { kind: "baseline", target: "Z" }, solve: (l) => { clearDrifts(l, "f"); } },
];

test("forge: every goal kind is covered and rejects worlds it cannot judge", () => {
  assert.deepEqual([...CASES.map((c) => c.goal.kind), "flat"].sort(), [...GOAL_KINDS].sort(), "flat has its own tests below (it is solved by moving the probe, not editing the world)");
  const bare: WorldSpec = { v: 1, rootSpeed: 6, domains: [], emitters: [{ id: "E", domain: "root", pos: [20, 50], period: 4, phase: 0, hue: 10 }] };
  for (const k of ["damped", "marginal", "passive"] as const) assert.ok(goalProblems(bare, { kind: k }).length > 0, k);
  assert.ok(goalProblems(bare, { kind: "conserved" }).length > 0);
  assert.deepEqual(goalProblems(bare, { kind: "conserved", target: "E" }), []);
  assert.ok(goalProblems(bare, { kind: "baseline", target: "E" }).length > 0, "E is not a zeta beacon");
  assert.ok(goalProblems(bare, { kind: "conserved", target: "nope" }).length > 0);
});

test("forge: each goal seals from a broken world with a witness, and round-trips through a link", () => {
  for (const c of CASES) {
    const start = lab(c.id), t = trial(c.id).t;
    const startSpec = clone(start.spec);
    assert.equal(startsSolved(startSpec, c.goal, t), false, `${c.id} starts broken`);
    const solved = lab(c.id);
    c.solve(solved);
    const r = forge("", c.goal, t, startSpec, solved.spec);
    assert.ok(r.ok, `${c.id}: ${r.ok ? "" : r.why}`);
    if (!r.ok) continue;
    assert.deepEqual(validate(r.trial.world), []);
    const enc = encodeTrial(r.trial);
    assert.ok(enc.length < 3000, `${c.id} link ${enc.length} chars`);
    const back = decodeTrial(enc);
    assert.ok(back, c.id);
    assert.deepEqual(back, r.trial);
    // the runnable trial starts failed and is passed by the witness
    const tr = asTrial(back as NonNullable<typeof back>);
    const a = newLab(tr.world()); a.t = tr.t;
    assert.equal(tr.check(a).ok, false, `${c.id} fails on arrival`);
    const b = newLab(tr.world()); b.t = tr.t; c.solve(b);
    assert.equal(tr.check(b).ok, true, `${c.id} witness passes`);
    assert.ok(tr.brief.length > 20);
  }
});

test("forge: refuses an unsolved repair, a start that already passes, and an unsettable goal", () => {
  const start = lab("runaway"), g: Goal = { kind: "damped" };
  const unsolved = lab("runaway");
  times(3, () => adjustFeedback(unsolved, "A", "gain", -1));
  const r1 = forge("x", g, 0, start.spec, unsolved.spec);
  assert.equal(r1.ok, false);
  const solved = lab("runaway"); times(9, () => adjustFeedback(solved, "A", "gain", -1));
  const r2 = forge("x", g, 0, solved.spec, solved.spec);
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? "" : r2.why, /already passes/);
  const r3 = forge("x", { kind: "baseline", target: "A" }, 0, start.spec, solved.spec);
  assert.equal(r3.ok, false);
});

test("forge: keep rules stop the cheap exits (delete the loop, silence taps, lower the dimension)", () => {
  const keepLoop = keepOf(trial("runaway").world());
  const l = lab("runaway");
  removeFeedback(l, "A"); removeFeedback(l, "B");
  assert.equal(checkGoal(l, { kind: "damped" }, keepLoop).ok, false);
  const f = lab("fanout"), kf = keepOf(trial("fanout").world());
  times(30, () => { adjustFeedback(f, "A", "gain", -1); adjustFeedback(f, "B", "gain", -1); });
  assert.equal(checkGoal(f, { kind: "passive" }, kf).ok, false, "silenced taps");
  const h = lab("heavy"), kh = keepOf(trial("heavy").world());
  assert.equal(kh.dim, 4);
  cycleLaw(h, "gauss"); cycleLaw(h, "dim"); // holds, but DIM 5
  assert.equal(checkGoal(h, { kind: "conserved", target: "E" }, kh).ok, false, "DIM changed");
  assert.match(briefOf({ kind: "conserved", target: "E" }, kh), /DIM at 4/);
});

test("forge: links are strict (garbage, bad goals, bad times, solved starts, tampered worlds)", () => {
  const good = (() => {
    const s = lab("runaway"), w = lab("runaway"); times(9, () => adjustFeedback(w, "A", "gain", -1));
    const r = forge("My trial", { kind: "damped" }, 0, s.spec, w.spec);
    if (!r.ok) throw new Error(r.why);
    return r.trial;
  })();
  assert.equal(good.name, "My trial");
  const enc = encodeTrial(good);
  assert.ok(decodeTrial(enc));
  for (const bad of ["", "@@@", "e30", packJson(null), packJson({ v: 2 }), packJson({ v: 1, g: "nope", t: 0, w: good.world }),
    packJson({ v: 1, g: "damped", t: -1, w: good.world }), packJson({ v: 1, g: "damped", t: 9999, w: good.world }),
    packJson({ v: 1, g: "damped", t: "x", w: good.world }), packJson({ v: 1, g: "conserved", t: 0, w: good.world }),
    packJson({ v: 1, g: "damped", t: 0, w: { ...good.world, rootSpeed: -3 } }), packJson({ v: 1, g: "damped", t: 0, w: 5 })]) {
    assert.equal(decodeTrial(bad), null, bad.slice(0, 30));
  }
  // a link whose start already passes is refused
  const solved = lab("runaway"); times(9, () => adjustFeedback(solved, "A", "gain", -1));
  assert.equal(decodeTrial(packJson({ v: 1, g: "damped", t: 0, w: solved.spec })), null);
  // names are sanitised
  const named = decodeTrial(packJson({ v: 1, n: "<script>alert(1)</script> Hi", g: "damped", t: 0, w: good.world }));
  assert.ok(named && !/[<>()]/.test(named.name));
});

test("forge: random link noise never throws", () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < 300; i++) {
    let s = "";
    for (let k = Math.floor(rnd() * 80); k > 0; k--) s += alpha[Math.floor(rnd() * alpha.length)];
    assert.doesNotThrow(() => decodeTrial(s));
  }
});

// ---------- flat goal: the sightline, authored by moving the probe ----------
const sightline = () => trial("sightline");
/** A probe position (on a coarse grid) where the array reads FLAT for the sightline world. */
function flatSpot(): ProbePos {
  const t = sightline();
  for (let y = 20; y <= 80; y += 10) for (let x = 20; x <= 80; x += 10) {
    const l = newLab(t.world()); l.t = t.t; placeProbe(l, { x, y });
    if (triangulate(l, "E")?.verdict === "flat") return { x, y };
  }
  throw new Error("no flat probe position found");
}

test("forge flat: probe position travels in the link; moving the probe solves it, editing the sky does not", () => {
  const t = sightline(), goal: Goal = { kind: "flat", target: "E" };
  const startSpec = clone(t.world()), good = flatSpot();
  assert.deepEqual(goalProblems(startSpec, { kind: "flat" }).length > 0, true, "needs a target");
  assert.deepEqual(goalProblems(startSpec, goal), []);
  assert.equal(startsSolved(startSpec, goal, t.t), false, "default probe is warped");
  assert.equal(startsSolved(startSpec, goal, t.t, good), true, "the witness position reads flat");
  // seal: start at the default probe, witness probe elsewhere
  assert.equal(forge("", goal, t.t, startSpec, startSpec, { x: 50, y: 50 }, { x: 50, y: 50 }).ok, false, "unsolved: same probe");
  assert.equal(forge("", goal, t.t, startSpec, startSpec, good, good).ok, false, "a start that already passes is refused");
  const r = forge("", goal, t.t, startSpec, startSpec, { x: 50, y: 50 }, good);
  assert.ok(r.ok, r.ok ? "" : r.why);
  if (!r.ok) return;
  assert.equal(r.trial.probe, undefined, "default start probe is not stored");
  // an author who starts the probe somewhere else carries it in the link
  const start2: ProbePos = { x: 62.5, y: 41.25 };
  const r2 = forge("far", goal, t.t, startSpec, startSpec, start2, good);
  assert.ok(r2.ok);
  if (!r2.ok) return;
  assert.deepEqual(r2.trial.probe, start2);
  const back = decodeTrial(encodeTrial(r2.trial));
  assert.deepEqual(back, r2.trial);
  const tr = asTrial(back as NonNullable<typeof back>);
  assert.deepEqual(tr.probe, start2);
  assert.match(tr.brief, /TRI reads FLAT/);
  const a = newLab(tr.world()); a.t = tr.t; placeProbe(a, tr.probe as ProbePos);
  assert.equal(tr.check(a).ok, false, "fails on arrival");
  placeProbe(a, good);
  assert.equal(tr.check(a).ok, true, "moving the probe to the flat spot passes");
  // rewriting the sky is refused even when it makes the array read flat
  const b = newLab(tr.world()); b.t = tr.t; placeProbe(b, good);
  moveSel(b, { kind: "domain", id: "w" }, [10, 90]);
  const verdict = tr.check(b);
  assert.equal(verdict.ok, false);
  assert.match(verdict.status, /sky was changed/);
  assert.deepEqual(probeOf(a), good);
});

test("forge flat: links are strict about the probe", () => {
  const t = sightline(), goal: Goal = { kind: "flat", target: "E" };
  const r = forge("", goal, t.t, clone(t.world()), clone(t.world()), { x: 50, y: 50 }, flatSpot());
  assert.ok(r.ok);
  if (!r.ok) return;
  const enc = (p: unknown) => packJson({ v: 1, n: "x", g: "flat", e: "E", t: r.trial.t, w: r.trial.world, p });
  assert.ok(decodeTrial(enc({ x: 40, y: 30 })), "a good probe parses");
  for (const bad of [{ x: -1, y: 5 }, { x: 101, y: 5 }, { x: "4", y: 5 }, { x: 1 }, { x: 1, y: 2, w: 3 }, { x: 1, y: 2, z: 99 }, { x: 1, y: 2, q: 1 }, [1, 2], 7, null]) {
    assert.equal(decodeTrial(enc(bad)), null, JSON.stringify(bad));
  }
  assert.equal(decodeTrial(enc(flatSpot())), null, "a probe that already reads flat is refused: the trial would start solved");
  // a probe on a non-flat goal is refused
  const loop = lab("runaway");
  assert.equal(decodeTrial(packJson({ v: 1, n: "x", g: "damped", t: 0, w: clone(loop.spec), p: { x: 10, y: 10 } })), null);
  // hidden coordinates are accepted only in worlds that have the axis
  assert.ok(decodeTrial(enc({ x: 40, y: 30, z: 4 })), "the sightline world is bulk, so z is allowed");
});

test("forge flat: the probe's hidden height is part of the link in 4D", () => {
  const w: WorldSpec = { v: 1, rootSpeed: 6, bulk: true, bulk2: true, domains: [], emitters: [{ id: "E", domain: "root", pos: [30, 30], period: 4, phase: 0, hue: 10, z: 12, w: -8 }] };
  const goal: Goal = { kind: "flat", target: "E" };
  const l = newLab(clone(w)); l.t = 80;
  const P = { kind: "probe" as const, id: "probe" };
  setDepth(l, P, 4, "z"); setDepth(l, P, -8, "w");
  assert.deepEqual(probeOf(l), { x: 50, y: 50, z: 4, w: -8 });
  // an empty 4D sky always reads flat, so this start is refused as already solved
  assert.equal(forge("", goal, 80, w, w, probeOf(l), probeOf(l)).ok, false);
});
