import test from "node:test";
import assert from "node:assert/strict";
import { calibrateBeacon, hardyZ, zeroCountApprox, zerosUpTo, zetaZeros } from "../src/core/strata/index.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);

test("zeta: the first zeros are computed, not tabulated, and match the literature", () => {
  const z = zetaZeros(10);
  const known = [14.134725141734693, 21.022039638771555, 25.010857580145688, 30.424876125859513, 32.935061587739189];
  known.forEach((v, i) => near(z[i], v, 1e-7));
  for (let i = 1; i < z.length; i++) assert.ok(z[i] > z[i - 1]);
});

test("zeta: no zero is missed or invented (Riemann-von Mangoldt count and the classical N(100) = 29)", () => {
  assert.equal(zerosUpTo(100).length, 29);
  for (const T of [50, 150, 300, 500]) {
    const n = zerosUpTo(T).length;
    assert.ok(Math.abs(n - zeroCountApprox(T)) < 1.6, `N(${T}) = ${n} vs ${zeroCountApprox(T).toFixed(2)}`);
  }
  assert.ok(zerosUpTo(5).length === 0);
});

test("zeta: Hardy Z changes sign exactly at the zeros and its magnitude vanishes there", () => {
  const z = zetaZeros(30);
  for (const g of z) {
    assert.ok(Math.abs(hardyZ(g)) < 1e-6);
    assert.ok(hardyZ(g - 0.02) * hardyZ(g + 0.02) < 0);
  }
});

test("calibrate: a blind listener recovers which zeros it heard, the clock rate and the offset", () => {
  const zs = zetaZeros(60);
  // sender clock runs 2.5x fast (slope 0.4 s per unit height); signal takes 7.3 s to arrive; we catch pulses 23..30
  const arr = zs.slice(22, 30).map((g) => 100 + 7.3 + 0.4 * g);
  const f = calibrateBeacon(arr);
  assert.ok(f);
  assert.equal(f.offset, 23);
  near(f.slope, 0.4, 1e-9);
  near(f.intercept, 107.3, 1e-6);
  assert.ok(f.residual < 1e-9);
  assert.ok(f.confidence > 5);
});

test("calibrate: a clock that drifts leaves a residual: the deviation from baseline", () => {
  const zs = zetaZeros(60);
  const clean = calibrateBeacon(zs.slice(10, 20).map((g) => 5 + 0.5 * g));
  const drift = calibrateBeacon(zs.slice(10, 20).map((g) => 5 + 0.5 * g + 0.002 * g * g));
  assert.ok(clean && drift);
  assert.ok(clean.residual < 1e-9);
  assert.ok(drift.residual > 1e-3);
});

test("calibrate: a metronome does not fit the zeros (their irregular gaps are a fingerprint)", () => {
  const per = Array.from({ length: 8 }, (_, i) => 3 + 2.2 * i);
  // fit the same periodic arrivals against two different zero windows: neither is distinguished by a perfect fit
  const f = calibrateBeacon(per);
  assert.ok(f);
  assert.ok(f.residual > 0.05, "the zeros' irregular gaps cannot masquerade as a metronome");
});

test("calibrate: too few arrivals is refused", () => {
  assert.equal(calibrateBeacon([1, 2, 3]), null);
});
