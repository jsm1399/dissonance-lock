import test from "node:test";
import assert from "node:assert/strict";
import { LAWFUL } from "../src/core/laws/index.js";
import { cycleLaw, lawFit, newLab, rebuild, toggleBulk } from "../src/lab/lab.js";
import { TRIALS } from "../src/lab/trials.js";
import { defaultWorld } from "../src/lab/world.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const tags = (r: NonNullable<ReturnType<typeof lawFit>>) => r.guesses.map((g) => `${g.dim}${g.gauss}`).sort();

test("lawfit: the default world reads as 2D with Gauss holding; absorption is only measurable when paths cross domains", () => {
  const lab = newLab(defaultWorld());
  const r = lawFit(lab, "e1");
  assert.ok(r);
  near(r.fit.n, 1, 1e-6);
  assert.equal(r.fit.loss, null, "e1's rays never cross a domain");
  const inside = lawFit(lab, "e2"); // lives in a domain: every path crosses one
  assert.ok(inside && inside.fit.loss !== null);
  near(inside.fit.loss as number, 0, 1e-9);
  assert.equal(r.consistent, true);
  assert.deepEqual(tags(r), ["2holds", "3runaway"]);
  assert.ok(r.fit.rms < 1e-9);
});

test("lawfit: dimension and loss are read back from the world's own flux", () => {
  const lab = newLab(defaultWorld());
  cycleLaw(lab, "dim"); // 3
  cycleLaw(lab, "loss"); cycleLaw(lab, "loss"); // 0.03
  const r = lawFit(lab, "e2");
  assert.ok(r);
  near(r.fit.n, 2, 1e-6);
  near(r.fit.loss as number, 0.03, 1e-6);
  assert.deepEqual(tags(r), ["2leaky", "3holds", "4runaway"]);
  assert.equal(r.consistent, true);
});

test("lawfit: two different universes are indistinguishable by intensity (D3 holds vs D2 leaky)", () => {
  const a = newLab(defaultWorld()), b = newLab(defaultWorld());
  cycleLaw(a, "dim");                  // D3, holds
  cycleLaw(b, "gauss");                // D2, leaky
  const ra = lawFit(a, "e1"), rb = lawFit(b, "e1");
  assert.ok(ra && rb);
  near(ra.fit.n, rb.fit.n, 1e-9);
  assert.deepEqual(tags(ra), tags(rb));
  assert.notEqual(ra.declared.dim, rb.declared.dim);
  assert.equal(ra.consistent && rb.consistent, true);
});

test("lawfit: cached per rev and emitter, refreshed after any edit; unknown emitters give null", () => {
  const lab = newLab(defaultWorld());
  const r1 = lawFit(lab, "e1");
  assert.strictEqual(lawFit(lab, "e1"), r1);
  cycleLaw(lab, "dim");
  assert.notStrictEqual(lawFit(lab, "e1"), r1);
  assert.equal(lawFit(lab, "nope"), null);
  rebuild(lab);
  assert.ok(lawFit(lab, "e2"));
});

test("lawfit: works with a hidden axis too", () => {
  const lab = newLab(defaultWorld());
  assert.equal(toggleBulk(lab), true);
  lab.probeZ = 5;
  const r = lawFit(lab, "e1");
  assert.ok(r);
  near(r.fit.n, 2, 1e-6); // a hidden axis makes the world 3D: flux falls as r^-2
  assert.equal(r.declared.dim, 3);
  assert.equal(r.consistent, true);
});

test("trial Heavy Space: DIM 4 with runaway flux creates energy; restoring Gauss at DIM 4 repairs it", () => {
  const t = TRIALS.find((x) => x.id === "heavy")!;
  const lab = newLab(t.world());
  lab.t = t.t;
  assert.equal(t.check(lab).ok, false);
  assert.match(t.check(lab).status, /CREATED/);
  const cheat = newLab(t.world());
  cheat.t = t.t;
  for (let i = 0; i < 3; i++) cycleLaw(cheat, "dim"); // 5, 6, 2: wrong dimension
  assert.equal(t.check(cheat).ok, false);
  cycleLaw(lab, "gauss");
  assert.equal(lab.spec.laws?.gauss, "holds");
  assert.equal(t.check(lab).ok, true);
  assert.equal(lab.spec.laws?.dim, 4);
  void LAWFUL;
});
