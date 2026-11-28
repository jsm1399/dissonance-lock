import test from "node:test";
import assert from "node:assert/strict";
import { newLab, setDepth, triangulate, cycleBulk } from "../src/lab/lab.js";
import { ON_SLICE, planesOf, rangeOf, setProbeOn, sliceOf } from "../src/lab/slice.js";
import { defaultWorld } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const em = (id: string, pos: [number, number], o: object = {}) => ({ id, domain: "root", pos, period: 4, phase: 0, hue: 10, ...o });
const world4 = (): WorldSpec => ({
  v: 1, rootSpeed: 6, bulk: true, bulk2: true,
  domains: [{ id: "d1", parent: "root", origin: [30, 58], scale: 1, extent: 18, echoSpeed: 6, rate: 1, shearMin: null, changes: [] }],
  emitters: [em("E", [30, 30], { z: 12, w: -8 }), em("F", [30, 58], { z: 0, w: 0 })],
});

test("planesOf: one plane in 2D, three with a hidden axis, six with two", () => {
  assert.deepEqual(planesOf(2), [["x", "y"]]);
  assert.equal(planesOf(3).length, 3);
  assert.deepEqual(planesOf(4).map((p) => p.join("")), ["xy", "xz", "xw", "yz", "yw", "zw"]);
  assert.deepEqual(rangeOf("x"), [0, 100]);
  assert.deepEqual(rangeOf("w"), [-40, 40]);
});

test("slice: emitters report their coordinates and their offset from the slice", () => {
  const lab = newLab(world4());
  const zw = sliceOf(lab, ["z", "w"]);
  const E = zw.emitters.find((e) => e.id === "E")!;
  near(E.a, 12); near(E.b, -8);
  near(E.off, Math.hypot(30 - 50, 30 - 50), 1e-9); // held x, y: 20√2 away from the probe in the plane
  assert.equal(E.onSlice, false);
  assert.deepEqual(zw.held, { x: 50, y: 50 });
  const xy = sliceOf(lab, ["x", "y"]);
  near(xy.emitters.find((e) => e.id === "E")!.off, Math.hypot(12, 8)); // seen from the plane: off by its hidden norm
  near(xy.emitters.find((e) => e.id === "F")!.off, 0);
  assert.equal(xy.emitters.find((e) => e.id === "F")!.onSlice, true);
  // fly the probe into E's slice: its offset in the xy plane drops to zero
  const l2 = newLab(world4());
  const P = { kind: "probe" as const, id: "probe" };
  for (let i = 0; i < 3; i++) setDepth(l2, P, 4, "z");
  for (let i = 0; i < 2; i++) setDepth(l2, P, -4, "w");
  near(sliceOf(l2, ["x", "y"]).emitters.find((e) => e.id === "E")!.off, 0);
  assert.ok(ON_SLICE > 0);
});

test("slice: a ball's cross-section shrinks as the held coordinates leave its centre, and vanishes outside it", () => {
  const lab = newLab(world4());
  setProbeOn(lab, ["x", "y"], 30, 58); // centre of d1
  near(sliceOf(lab, ["x", "y"]).domains[0].r, 18);
  const P = { kind: "probe" as const, id: "probe" };
  setDepth(lab, P, 12, "z"); setDepth(lab, P, 0, "w");
  near(sliceOf(lab, ["x", "y"]).domains[0].r, Math.sqrt(18 * 18 - 12 * 12));
  // hidden offsets add in quadrature across both held axes
  setDepth(lab, P, 8, "w");
  near(sliceOf(lab, ["x", "y"]).domains[0].r, Math.sqrt(18 * 18 - 12 * 12 - 8 * 8));
  // in a plane that keeps z, the held coordinates are x-offset-free here: w=8 only
  near(sliceOf(lab, ["x", "z"]).domains[0].r, Math.sqrt(18 * 18 - 8 * 8 - 0)); // y held at 58 (centre), w held at 8
  setDepth(lab, P, 20, "z"); // z = 32: far outside an 18-ball
  assert.equal(sliceOf(lab, ["x", "y"]).domains.length, 0);
});

test("slice: emitters in a scaled domain are placed by the tree, not by their local numbers", () => {
  const w: WorldSpec = {
    v: 1, rootSpeed: 6, bulk: true,
    domains: [{ id: "m", parent: "root", origin: [60, 40], scale: 4, extent: 10, echoSpeed: 24, rate: 1, shearMin: null, changes: [] }],
    emitters: [em("E", [0, 0], { domain: "m" })],
  };
  const lab = newLab(w);
  // local (4, -8, z 8) in a domain scaled 4x down: root offset (1, -2, 2)
  lab.spec.emitters[0].pos = [4, -8]; lab.spec.emitters[0].z = 8;
  const s = sliceOf(lab, ["x", "z"]);
  near(s.emitters[0].a, 61); near(s.emitters[0].b, 2);
});

test("slice: setProbeOn moves only the shown axes, clamps, and refreshes the instruments", () => {
  const lab = newLab(world4());
  lab.t = 80;
  const before = triangulate(lab, "E")!.fix.depth;
  setProbeOn(lab, ["z", "w"], 12, -8);
  assert.equal(lab.probeZ, 12); assert.equal(lab.probeW, -8);
  assert.deepEqual(lab.probe, [50, 50], "x and y are held");
  const after = triangulate(lab, "E")!.fix.depth;
  assert.ok(before > 14 && after < 1.5, `depth ${before.toFixed(1)} -> ${after.toFixed(1)}: reaching E's hidden coordinates puts it in the slice`);
  setProbeOn(lab, ["x", "w"], 500, -500);
  assert.equal(lab.probe[0], 100); assert.equal(lab.probeW, -40);
  assert.equal(lab.probe[1], 50);
  assert.throws(() => sliceOf(newLab(defaultWorld()), ["x", "z"]), RangeError, "a 2D world has no z axis");
  // leaving 4D: the hidden planes disappear with the hidden axes
  const off = newLab(world4()); cycleBulk(off);
  assert.equal(off.spec.bulk, undefined);
  assert.equal(sliceOf(off, ["x", "y"]).emitters.length, 2);
  assert.throws(() => sliceOf(off, ["z", "w"]), RangeError);
});
