import test from "node:test";
import assert from "node:assert/strict";
import { TRIALS } from "../src/lab/trials.js";
import { GOAL_KINDS, asTrial, briefOf, checkGoal, decodeTrial, encodeTrial, forge, goalProblems, keepOf, startsSolved } from "../src/lab/forge.js";
import type { Goal } from "../src/lab/forge.js";
import { adjustFeedback, clearDrifts, cycleLaw, newLab, removeFeedback } from "../src/lab/lab.js";
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
  assert.deepEqual(CASES.map((c) => c.goal.kind).sort(), [...GOAL_KINDS].sort());
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
