import test from "node:test";
import assert from "node:assert/strict";
import { LAWFUL, LOSS_STEPS, NOISE_STEPS } from "../src/core/laws/index.js";
import type { Laws } from "../src/core/laws/index.js";
import { auditEmitter, lawFit, newLab, nextLaw, zetaFix } from "../src/lab/lab.js";
import { TRIALS, hiddenLaws } from "../src/lab/trials.js";
import { lawsOf, parseWorld, validate } from "../src/lab/world.js";

const U = TRIALS.find((t) => t.id === "universe")!;

/** Solve the trial the way a player would: from the instruments only. */
function infer(seed: number): Laws {
  const lab = newLab(U.world(seed));
  lab.t = U.t;
  const f = lawFit(lab, "E"), au = auditEmitter(lab, "E");
  assert.ok(f && au && f.delay && f.noise !== null, `instruments live for seed ${seed}`);
  const gauss = au.audit.verdict === "conserved" ? "holds" : au.audit.verdict === "destroyed" ? "leaky" : "runaway";
  const n = Math.round(f.fit.n);
  const dim = gauss === "holds" ? n + 1 : gauss === "leaky" ? n : n + 2;
  const snap = (steps: number[], v: number) => steps.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), steps[0]);
  const speed = (id: string) => f.delay?.speeds.find((q) => q.domain === id)?.factor ?? NaN;
  return {
    ...LAWFUL, dim, gauss,
    loss: snap(LOSS_STEPS, f.fit.loss as number), noise: snap(NOISE_STEPS, f.noise),
    time: speed("f") > 2 ? "local" : "global",
    medium: speed("w") < 0.9 ? "strata" : "uniform",
  };
}

test("universe: hidden laws are seeded, deterministic, varied and never nearly lawful", () => {
  const seen = new Set<string>();
  for (let s = 1; s <= 60; s++) {
    const a = hiddenLaws(s), b = hiddenLaws(s);
    assert.deepEqual(a, b);
    seen.add(JSON.stringify(a));
    const dev = [a.time !== "local", a.medium !== "strata", a.dim !== 2, a.loss !== 0, a.noise !== 0, a.gauss !== "holds"].filter(Boolean).length;
    assert.ok(dev >= 3);
    assert.equal(a.path, "straight");
  }
  assert.ok(seen.size > 20, "plenty of different universes");
  assert.deepEqual(validate(U.world(7)), []);
  assert.ok(parseWorld(U.world(7)));
});

test("universe: every hidden universe is identifiable from the instruments alone", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const h = hiddenLaws(seed), got = infer(seed);
    assert.deepEqual(got, h, `seed ${seed}`);
  }
});

test("universe: the trial accepts the right guess, rejects near misses, and never leaks the answer", () => {
  const seed = 11, h = hiddenLaws(seed);
  const lab = newLab(U.world(seed));
  lab.t = U.t;
  assert.equal(U.check(lab, { guess: { ...LAWFUL } }).ok, false);
  assert.equal(U.check(lab, { guess: null }).ok, false);
  assert.equal(U.check(lab, { guess: { ...h } }).ok, true);
  assert.equal(U.check(lab, { guess: { ...h, dim: h.dim === 6 ? 5 : h.dim + 1 } }).ok, false);
  assert.equal(U.check(lab, { guess: { ...h, time: h.time === "local" ? "global" : "local" } }).ok, false);
  assert.equal(U.check(lab, { guess: { ...h, medium: h.medium === "strata" ? "uniform" : "strata" } }).ok, false);
  assert.equal(U.check(lab, { guess: { ...h, noise: h.noise === 0.06 ? 0.02 : 0.06 } }).ok, false);
  const st = U.check(lab, { guess: { ...LAWFUL } }).status;
  assert.ok(!st.includes(String(h.dim)) || h.dim === 2, "status shows the guess, not the truth");
  assert.deepEqual(lawsOf(lab.spec), h);
});

test("universe: the guess knobs walk exactly like the world's knobs", () => {
  let g: Laws = { ...LAWFUL };
  g = nextLaw(g, "dim"); g = nextLaw(g, "gauss"); g = nextLaw(g, "time"); g = nextLaw(g, "loss");
  assert.deepEqual(g, { ...LAWFUL, dim: 3, gauss: "leaky", time: "global", loss: 0.01 });
  assert.deepEqual(LAWFUL.dim, 2, "nextLaw is pure");
});
