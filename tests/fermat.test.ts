import test from "node:test";
import assert from "node:assert/strict";
import { StrataTree, contour, fermatField, march, sampleField } from "../src/core/strata/index.js";
import type { ArrivalField } from "../src/core/strata/index.js";
import { LAWFUL, isLawful, parseLaws, validateLaws } from "../src/core/laws/index.js";
import type { Laws } from "../src/core/laws/index.js";
import { buildTree, decodeWorld, defaultWorld, encodeWorld, parseWorld } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";
import { arrivalAt, cycleLaw, emissionsUpTo, fieldOf, newLab, perceived, pumpFields } from "../src/lab/lab.js";

const MIN = [0, 0], MAX = [100, 100];
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const wellTree = (): StrataTree => {
  const t = new StrataTree(2, 6);
  t.add({ id: "w", parent: "root", origin: [50, 50], scale: 1, extent: 20, echoSpeed: 6, shear: (p) => 0.1 + 0.9 * Math.min(1, Math.hypot(p[0], p[1]) / 20) });
  return t;
};

test("fermat: uniform medium matches distance/speed within the stencil error", () => {
  const t = new StrataTree(2, 6);
  const f = fermatField(t, { domain: "root", pos: [20, 30] }, 2, MIN, MAX, 48);
  for (const p of [[80, 70], [50, 50], [95, 10], [10, 90], [60, 35], [20, 80]]) {
    const want = 2 + Math.hypot(p[0] - 20, p[1] - 30) / 6;
    assert.ok(rel(sampleField(f, MIN, MAX, p), want) < 0.02, `at ${p}`);
  }
});

test("fermat: never meaningfully slower than the straight chord, in the default world", () => {
  const tree = buildTree(defaultWorld());
  const f = fermatField(tree, { domain: "root", pos: [12, 12] }, 0, MIN, MAX, 48);
  let faster = 0;
  for (let x = 8; x <= 92; x += 12) for (let y = 8; y <= 92; y += 12) {
    const chord = march(tree, { domain: "root", pos: [12, 12] }, 0, { domain: "root", pos: [x, y] }, { maxStep: 1 }).rootTime;
    const b = sampleField(f, MIN, MAX, [x, y]);
    assert.ok(b <= chord * 1.03, `bent ${b} vs chord ${chord} at ${x},${y}`);
    if (b < chord * 0.98) faster++;
  }
  assert.ok(faster >= 5, "refraction should beat the chord in many places");
});

test("fermat: signals detour around a slow well (chord through the well is much slower)", () => {
  const t = wellTree();
  const from = { domain: "root", pos: [10, 50] }, to = [90, 50];
  const chord = march(t, from, 0, { domain: "root", pos: to }, { maxStep: 0.5 }).rootTime;
  const f = fermatField(t, from, 0, MIN, MAX, 64);
  const bent = sampleField(f, MIN, MAX, to);
  assert.ok(bent < chord * 0.85, `bent ${bent.toFixed(2)} should beat chord ${chord.toFixed(2)}`);
  assert.ok(bent >= 80 / 6 - 0.3, "cannot beat the uniform light-line");
});

test("fermat: a symmetric world gives a symmetric field", () => {
  const t = wellTree();
  const f = fermatField(t, { domain: "root", pos: [50, 50] }, 0, MIN, MAX, 64);
  const r = 30;
  const v = [[50 + r, 50], [50 - r, 50], [50, 50 + r], [50, 50 - r]].map((p) => sampleField(f, MIN, MAX, p));
  for (const x of v) assert.ok(rel(x, v[0]) < 0.03, `${v}`);
});

test("fermat: causal, finite, deterministic; later launches never arrive earlier (FIFO)", () => {
  const tree = buildTree(defaultWorld());
  const run = (t0: number) => fermatField(tree, { domain: "d1", pos: [-6, 8] }, t0, MIN, MAX, 40);
  const a = run(5), b = run(5), c = run(14);
  assert.deepEqual(Array.from(a.values), Array.from(b.values));
  const tStart = tree.toRootTime("d1", 5);
  for (let i = 0; i < a.values.length; i++) {
    assert.ok(Number.isFinite(a.values[i]) && a.values[i] >= tStart - 1e-9);
    assert.ok(c.values[i] >= a.values[i] - 1e-9, `FIFO broken at ${i}`);
  }
});

test("sampleField: exact on linear fields; clamps at the edges", () => {
  const n = 10, values = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[j * n + i] = 3 * ((i + 0.5) * 10) + 2 * ((j + 0.5) * 10);
  const f: ArrivalField = { n, values, tmin: 0, tmax: 1 };
  for (const p of [[23, 41], [50, 50], [77.7, 12.3]]) assert.ok(Math.abs(sampleField(f, MIN, MAX, p) - (3 * p[0] + 2 * p[1])) < 1e-9);
  assert.ok(Number.isFinite(sampleField(f, MIN, MAX, [-50, 500])));
});

test("contour: level set of a radial field is a ring of that radius", () => {
  const n = 60, values = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[j * n + i] = Math.hypot((i + 0.5) * (100 / n) - 50, (j + 0.5) * (100 / n) - 50);
  const segs = contour({ n, values, tmin: 0, tmax: 80 }, MIN, MAX, 25);
  assert.ok(segs.length > 60);
  for (const [x1, y1, x2, y2] of segs) {
    assert.ok(Math.abs(Math.hypot(x1 - 50, y1 - 50) - 25) < 0.5 && Math.abs(Math.hypot(x2 - 50, y2 - 50) - 25) < 0.5);
  }
  assert.equal(contour({ n, values, tmin: 0, tmax: 80 }, MIN, MAX, -5).length, 0);
});

test("path law: parsing, old links, validation, link round-trip", () => {
  assert.equal(LAWFUL.path, "straight");
  const { path: _omit, ...pre11 } = LAWFUL; // a v1.0 link has no path law
  assert.deepEqual(parseLaws(pre11), LAWFUL);
  assert.equal(parseLaws({ ...LAWFUL, path: "warp" }), null);
  assert.ok(validateLaws({ ...LAWFUL, path: "warp" } as unknown as Laws).length > 0);
  assert.ok(!isLawful({ ...LAWFUL, path: "bent" }));
  const w = defaultWorld(); w.laws = { ...LAWFUL, path: "bent", dim: 3 };
  const back = decodeWorld(encodeWorld(w));
  assert.equal(back?.laws?.path, "bent");
  const old = JSON.parse(JSON.stringify(defaultWorld())) as Record<string, unknown>;
  old.laws = { time: "global", medium: "uniform", dim: 2, loss: 0, noise: 0, gauss: "holds" };
  const parsed = parseWorld(old);
  assert.ok(parsed && parsed.laws?.path === "straight" && parsed.laws.time === "global");
});

test("lab: bent law falls back to the chord, then solves; probe behind a well hears earlier", () => {
  const spec: WorldSpec = {
    v: 1, rootSpeed: 6,
    domains: [{ id: "w", parent: "root", origin: [50, 50], scale: 1, extent: 20, echoSpeed: 6, rate: 1, shearMin: 0.1, changes: [] }],
    emitters: [{ id: "e1", domain: "root", pos: [10, 50], period: 6, phase: 0, hue: 10 }],
  };
  const lab = newLab(spec);
  lab.probe = [90, 50]; lab.t = 60;
  const em = emissionsUpTo(lab, 60, 1)[0];
  const straight = arrivalAt(lab, em);
  cycleLaw(lab, "path");
  assert.equal(lab.spec.laws?.path, "bent");
  lab.probe = [90, 50]; lab.t = 60;
  assert.equal(fieldOf(lab, em), null, "no field yet after a rebuild");
  assert.ok(Math.abs(arrivalAt(lab, em) - straight) < 1e-9, "chord fallback while unsolved");
  let guard = 0;
  while (pumpFields(lab, 1e6) > 0 && guard++ < 10) { /* solve everything */ }
  assert.equal(lab.pending, 0);
  const bentT = arrivalAt(lab, em);
  assert.ok(bentT < straight * 0.9, `bent ${bentT.toFixed(2)} vs straight ${straight.toFixed(2)}`);
  assert.ok(perceived(lab).length >= 1);
  cycleLaw(lab, "path");
  assert.equal(lab.spec.laws?.path, "straight");
});
