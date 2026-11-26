import test from "node:test";
import assert from "node:assert/strict";
import { LAWFUL, consistentLaws, fitSpreading, fluxDensity } from "../src/core/laws/index.js";
import type { FitSample, Laws } from "../src/core/laws/index.js";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const L = (o: Partial<Laws> = {}): Laws => ({ ...LAWFUL, ...o });
const sample = (laws: Laws, r: number, inside: number): FitSample => ({
  r, inside, intensity: fluxDensity(laws, 100, r) * Math.exp(-laws.loss * inside),
});
const grid = (laws: Laws, withInside: boolean): FitSample[] =>
  [3, 5, 8, 12, 18, 25, 35, 45].map((r, i) => sample(laws, r, withInside ? (i % 3) * 4 : 0));

test("fit: recovers the spreading exponent exactly in every dimension and Gauss law", () => {
  for (let D = 2; D <= 6; D++) for (const g of ["holds", "leaky", "runaway"] as const) {
    const laws = L({ dim: D, gauss: g });
    const f = fitSpreading(grid(laws, false));
    assert.ok(f);
    near(f.n, g === "holds" ? D - 1 : g === "leaky" ? D : Math.max(0, D - 2), 1e-9);
    assert.equal(f.loss, null, "no domain crossed: absorption is not measurable");
    assert.ok(f.rms < 1e-9);
  }
});

test("fit: separates absorption from spreading once paths cross domains", () => {
  const laws = L({ dim: 3, loss: 0.04 });
  const f = fitSpreading(grid(laws, true));
  assert.ok(f && f.loss !== null);
  near(f.n, 2, 1e-9);
  near(f.loss as number, 0.04, 1e-9);
});

test("fit: noisy-but-wrong data shows up as misfit; too few samples is refused", () => {
  const laws = L();
  const bad = grid(laws, false).map((s, i) => ({ ...s, intensity: s.intensity * (i % 2 ? 1.5 : 0.7) }));
  assert.ok((fitSpreading(bad) as { rms: number }).rms > 0.1);
  assert.equal(fitSpreading(grid(laws, false).slice(0, 4)), null);
  assert.equal(fitSpreading(grid(laws, false).map((s) => ({ ...s, r: 10 }))), null, "no spread in r: singular");
});

test("degeneracy: the exponent alone cannot name the universe", () => {
  const two = consistentLaws(2);
  assert.deepEqual(two.map((x) => `${x.dim}${x.gauss}`), ["3holds", "2leaky", "4runaway"]);
  assert.deepEqual(consistentLaws(1).map((x) => `${x.dim}${x.gauss}`), ["2holds", "3runaway"]);
  assert.ok(consistentLaws(2).every((x) => x.dim >= 2 && x.dim <= 6));
  assert.deepEqual(consistentLaws(1.5), []);
  // exactly one of the guesses conserves energy
  for (const n of [1, 2, 3, 4]) assert.equal(consistentLaws(n).filter((x) => x.gauss === "holds").length, 1);
});
