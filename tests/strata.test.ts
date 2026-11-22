import test from "node:test";
import assert from "node:assert/strict";
import {
  ClockMap, StrataTree, CausalLedger, march, reach, wavefront, countInversions, lagSpread, vdist,
} from "../src/core/strata/index.js";

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);

test("ClockMap: piecewise rates, exact inverse", () => {
  const c = new ClockMap();
  c.setRate(10, 2);
  c.setRate(20, 0.5);
  near(c.local(5), 5); near(c.local(15), 20); near(c.local(20), 30); near(c.local(30), 35);
  near(c.parent(35), 30); near(c.parent(20), 15);
  for (const p of [0, 3.3, 10, 14, 20, 27, 90]) near(c.parent(c.local(p)), p, 1e-9);
  assert.throws(() => c.setRate(5, 1), RangeError);
  assert.throws(() => c.setRate(30, 0), RangeError);
});

test("StrataTree: nested position/time composition roundtrips", () => {
  const t = new StrataTree(2, 1);
  t.add({ id: "A", parent: "root", origin: [10, 0], scale: 2, extent: 50, echoSpeed: 1, rate: 2 });
  t.add({ id: "B", parent: "A", origin: [1, 1], scale: 5, extent: 5, echoSpeed: 1, rate: 0.5 });
  const c = t.toRootPos("B", [0, 0]);
  near(c[0], 10.5); near(c[1], 0.5);
  const p = t.toLocalPos("B", t.toRootPos("B", [2, 3]));
  near(p[0], 2, 1e-9); near(p[1], 3, 1e-9);
  near(t.toLocalTime("B", t.toRootTime("B", 7.7)), 7.7, 1e-9);
  near(t.toLocalTime("B", 10), 10, 1e-9);
  assert.throws(() => t.add({ id: "A", parent: "root", origin: [0, 0], scale: 1, extent: 1, echoSpeed: 1 }));
  assert.throws(() => t.add({ id: "Z", parent: "nope", origin: [0, 0], scale: 1, extent: 1, echoSpeed: 1 }));
});

test("march: uniform medium", () => {
  const t = new StrataTree(2, 2);
  near(march(t, { domain: "root", pos: [0, 0] }, 5, { domain: "root", pos: [100, 0] }).rootTime, 55);
});

test("march: refraction through a fast-clock domain (analytic 75)", () => {
  const t = new StrataTree(1, 1);
  t.add({ id: "fast", parent: "root", origin: [50], scale: 1, extent: 25, echoSpeed: 1, rate: 2 });
  const fwd = march(t, { domain: "root", pos: [0] }, 0, { domain: "root", pos: [100] });
  near(fwd.rootTime, 75, 0.01);
  assert.deepEqual(fwd.crossed, ["root", "fast", "root"]);
  near(march(t, { domain: "root", pos: [100] }, 0, { domain: "root", pos: [0] }).rootTime, 75, 0.01);
});

test("march: mid-flight clock-rate change (analytic 20, local 30)", () => {
  const t = new StrataTree(1, 1);
  t.add({ id: "all", parent: "root", origin: [0], scale: 1, extent: 1e6, echoSpeed: 1 });
  t.setRate("all", 10, 2);
  const r = march(t, { domain: "root", pos: [0] }, 0, { domain: "all", pos: [30] }, { maxStep: 0.01 });
  near(r.rootTime, 20, 0.02);
  near(r.localTime, 30, 0.04);
});

test("march: shear halves speed; scale-invariant micro domain", () => {
  const s = new StrataTree(1, 1);
  s.add({ id: "s", parent: "root", origin: [0], scale: 1, extent: 1e6, echoSpeed: 1, shear: () => 0.5 });
  near(march(s, { domain: "root", pos: [0] }, 0, { domain: "root", pos: [10] }).rootTime, 20);
  const m = new StrataTree(1, 1);
  m.add({ id: "micro", parent: "root", origin: [0], scale: 10, extent: 1e6, echoSpeed: 10 });
  near(march(m, { domain: "micro", pos: [0] }, 0, { domain: "micro", pos: [100] }).rootTime, 10);
});

test("reach/wavefront: uniform radius = v*t, refracts through fast domain", () => {
  const u = new StrataTree(2, 3);
  const poly = wavefront(u, { domain: "root", pos: [50, 50] }, 0, 4, 16, 100, 0.5);
  assert.equal(poly.length, 16);
  for (const q of poly) near(vdist(q, [50, 50]), 12, 0.3);
  const t = new StrataTree(2, 1);
  t.add({ id: "fast", parent: "root", origin: [10, 0], scale: 1, extent: 5, echoSpeed: 1, rate: 4 });
  const east = reach(t, [0, 0], [1, 0], 0, 8, 100, 0.05);
  const west = reach(t, [0, 0], [-1, 0], 0, 8, 100, 0.05);
  near(west, 8, 0.1);
  assert.ok(east > 8 + 5, `east ${east} should outrun west ${west}`);
  assert.equal(reach(t, [0, 0], [1, 0], 5, 5, 100, 0.1), 0);
});

test("CausalLedger: relation + perceived lag", () => {
  const t = new StrataTree(1, 1);
  const L = new CausalLedger<string>(t);
  const a = L.emit({ domain: "root", pos: [0] }, 0, "a");
  const b = L.emit({ domain: "root", pos: [10] }, 10, "b");
  const c = L.emit({ domain: "root", pos: [10] }, 5, "c");
  assert.equal(L.relation(a, b), "before");
  assert.equal(L.relation(b, a), "after");
  assert.equal(L.relation(a, c), "spacelike");
  const obs = { domain: "root", pos: [10] };
  assert.deepEqual(L.perceived(obs, 9).map((p) => p.event.payload), ["c"]);
  const at10 = L.perceived(obs, 10);
  assert.deepEqual(at10.map((p) => p.event.payload), ["c", "a", "b"]);
  near(at10.find((p) => p.event.payload === "a")!.lag, 10);
});

test("dissonance: inversions and lag spread", () => {
  assert.equal(countInversions([{ emitRoot: 0, perceivedAt: 5 }, { emitRoot: 1, perceivedAt: 3 }]), 1);
  assert.equal(countInversions([{ emitRoot: 0, perceivedAt: 3 }, { emitRoot: 1, perceivedAt: 5 }]), 0);
  assert.equal(countInversions([{ emitRoot: 0, perceivedAt: 3.1 }, { emitRoot: 0.1, perceivedAt: 3 }], 0.5), 0);
  assert.equal(lagSpread([4]), 0);
  near(lagSpread([2, 2, 2]), 0);
  near(lagSpread([1, 3]), 1);
});
