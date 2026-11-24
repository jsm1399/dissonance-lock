import test from "node:test";
import assert from "node:assert/strict";
import { StrataTree, march, sliceWavefront, wavefront } from "../src/core/strata/index.js";
import {
  addDomain, addEmitter, arrivalAt, auditEmitter, computeHeat, cycleLaw, emissionsUpTo, hitTest, moveSel, newLab,
  setDepth, toggleBulk,
} from "../src/lab/lab.js";
import { apparentDepth } from "../src/lab/bulk.js";
import { spacetime } from "../src/lab/spacetime.js";
import { buildTree, decodeWorld, defaultWorld, encodeWorld, parseWorld, validate } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const flat = (): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [{ id: "e1", domain: "root", pos: [50, 50], period: 4, phase: 0, hue: 10 }],
});

test("bulk: an emitter straight above the probe is heard after depth / speed", () => {
  const lab = newLab(flat());
  toggleBulk(lab);
  lab.probe = [50, 50];
  setDepth(lab, { kind: "emitter", id: "e1" }, 30);
  assert.equal(lab.spec.emitters[0].z, 30);
  const em = emissionsUpTo(lab, 40, 3)[0];
  near(arrivalAt(lab, em) - em.launchRoot, 30 / 6, 1e-9);
  // and tilted: 3-4-5 triangle scaled by 10 (in-plane 40, depth 30 -> 50)
  moveSel(lab, { kind: "probe", id: "probe" }, [90, 50]);
  const em2 = emissionsUpTo(lab, 40, 3)[0];
  near(arrivalAt(lab, em2) - em2.launchRoot, 50 / 6, 1e-9);
});

test("bulk with zero depth is exactly the flat world (regression)", () => {
  const w = defaultWorld();
  const a = newLab(clone(w)), b = newLab(clone(w));
  b.spec.bulk = true;
  (b as { tree: unknown }).tree = buildTree(b.spec);
  for (const t of [30, 70]) {
    a.t = t; b.t = t;
    const ea = emissionsUpTo(a, t, 3), eb = emissionsUpTo(b, t, 3);
    assert.equal(ea.length, eb.length);
    ea.forEach((x, i) => {
      assert.equal(x.k, eb[i].k);
      near(arrivalAt(a, x), arrivalAt(b, eb[i]), 1e-9);
    });
  }
});

test("bulk: depth breaks the plane's causal order for a flat observer (the apparent-depth experiment)", () => {
  const lab = newLab(flat());
  toggleBulk(lab);
  lab.probe = [80, 50];
  lab.t = 60;
  assert.equal(apparentDepth(lab, "e1")!.apparent, 0);
  setDepth(lab, { kind: "emitter", id: "e1" }, 24);
  const d = apparentDepth(lab, "e1")!;
  near(d.planar, 30, 1e-9);
  near(d.actual, 24, 1e-9);
  near(d.apparent, 24, 1e-6);
  setDepth(lab, { kind: "probe", id: "probe" }, 8); // probe off the plane too: offset is now 16
  near(apparentDepth(lab, "e1")!.actual, 16, 1e-9);
  near(apparentDepth(lab, "e1")!.apparent, 16, 1e-6);
  assert.equal(apparentDepth(newLab(flat()), "e1"), null, "flat worlds have nothing to detect");
});

test("bulk: a slow medium fakes depth — the detector is only honest in a uniform medium", () => {
  const lab = newLab(defaultWorld());
  toggleBulk(lab);
  lab.t = 90;
  moveSel(lab, { kind: "probe", id: "probe" }, [92, 36]); // the chord from e1 crosses the shear well d2
  const fake = apparentDepth(lab, "e1");
  assert.ok(fake && fake.actual === 0, "e1 lies exactly in the plane");
  assert.ok(Math.abs(fake.apparent - fake.actual) > 1, `a slow well mimics a hidden dimension (apparent ${fake.apparent.toFixed(1)})`);
  cycleLaw(lab, "time"); cycleLaw(lab, "medium");
  near(apparentDepth(lab, "e1")!.apparent, 0, 1e-3);
});

test("bulk: toggling is reversible, drops depths and keeps the laws coherent", () => {
  const lab = newLab(flat());
  assert.equal(setDepth(lab, { kind: "emitter", id: "e1" }, 5), false, "no depth in a flat world");
  assert.equal(toggleBulk(lab), true);
  assert.equal(lab.spec.laws?.dim, 3);
  assert.equal(lab.tree.dim, 3);
  setDepth(lab, { kind: "emitter", id: "e1" }, 9);
  assert.deepEqual(validate(lab.spec), []);
  assert.equal(toggleBulk(lab), false);
  assert.equal(lab.spec.bulk, undefined);
  assert.equal(lab.spec.emitters[0].z, undefined);
  assert.equal(lab.spec.laws, undefined, "dim back to lawful 2");
  assert.equal(lab.tree.dim, 2);
  for (let i = 0; i < 30; i++) { toggleBulk(lab); setDepth(lab, { kind: "probe", id: "probe" }, 3); }
  assert.deepEqual(validate(lab.spec), []);
});

test("bulk: depth is clamped, symmetric, and validated", () => {
  const lab = newLab(flat());
  toggleBulk(lab);
  for (let i = 0; i < 40; i++) setDepth(lab, { kind: "emitter", id: "e1" }, 5);
  assert.equal(lab.spec.emitters[0].z, 40);
  for (let i = 0; i < 40; i++) setDepth(lab, { kind: "emitter", id: "e1" }, -5);
  assert.equal(lab.spec.emitters[0].z, -40);
  const w = clone(lab.spec);
  assert.deepEqual(validate(w), []);
  const bad = (f: (x: WorldSpec) => void) => { const c = clone(lab.spec); f(c); return validate(c).length > 0 || parseWorld(c) === null; };
  assert.ok(bad((c) => { c.emitters[0].z = 500; }));
  assert.ok(bad((c) => { c.emitters[0].z = NaN; }));
  assert.ok(bad((c) => { delete c.bulk; c.emitters[0].z = 5; }), "depth without a bulk world");
  assert.ok(bad((c) => { (c as { bulk: unknown }).bulk = "yes"; }));
});

test("links: bulk worlds and depths round-trip; old links are untouched", () => {
  const lab = newLab(defaultWorld());
  toggleBulk(lab);
  setDepth(lab, { kind: "emitter", id: "e2" }, 12);
  const back = decodeWorld(encodeWorld(lab.spec));
  assert.deepEqual(back, lab.spec);
  assert.deepEqual(decodeWorld(encodeWorld(defaultWorld())), defaultWorld());
});

test("bulk: editing keeps depth; spacetime distances are 3D; audit uses 3D radius", () => {
  const lab = newLab(defaultWorld());
  toggleBulk(lab);
  setDepth(lab, { kind: "emitter", id: "e1" }, 20);
  moveSel(lab, { kind: "emitter", id: "e1" }, [40, 20]);
  assert.equal(lab.spec.emitters[0].z, 20, "moving in-plane keeps height");
  const id = addEmitter(lab, [70, 70]) as string;
  assert.equal(lab.spec.emitters.find((e) => e.id === id)?.z, undefined);
  assert.ok(addDomain(lab, "fast", [20, 80]));
  assert.equal(hitTest(lab, [40, 20])?.id, "e1", "picking works on the projection");
  lab.t = 50;
  lab.probe = [40, 20];
  const st = spacetime(lab);
  const l = st.lines.find((x) => x.emitter === "e1")!;
  near(l.dist, 20, 1e-9);
  const au = auditEmitter(lab, "e1")!;
  near(au.audit.r, 20, 1e-9);
  assert.equal(au.audit.verdict, "conserved", "DIM 3 audit in a 3D world");
  cycleLaw(lab, "dim"); // 4: the audit is about the law, still self-consistent
  assert.ok(computeHeat(lab, "e1", 6));
  assert.deepEqual(validate(lab.spec), []);
});

test("core: slice of an off-plane wavefront is a circle sqrt((v t)^2 - z^2) in a uniform medium", () => {
  const t = new StrataTree(3, 6);
  const from = { domain: "root", pos: [50, 50, 30] };
  assert.equal(sliceWavefront(t, from, 0, 4, 24, 170), null, "shell (r=24) has not reached the plane (30) yet");
  const poly = sliceWavefront(t, from, 0, 10, 24, 170, 12)!; // r = 60 -> in-plane radius sqrt(3600-900)=51.96
  assert.equal(poly.length, 24);
  for (const q of poly) near(Math.hypot(q[0] - 50, q[1] - 50), Math.sqrt(3600 - 900), 0.15);
  const flat3 = wavefront(t, { domain: "root", pos: [50, 50, 0] }, 0, 5, 16, 170, 0.5);
  for (const q of flat3) near(Math.hypot(q[0] - 50, q[1] - 50, q[2]), 30, 0.3);
});

test("core: 3D domains are spheres — a fast ball bends a chord that passes through its plane section", () => {
  const w = defaultWorld();
  w.bulk = true;
  const tree = buildTree(w);
  const t = march(tree, { domain: "root", pos: [5, 58, 0] }, 0, { domain: "root", pos: [55, 58, 0] }, { maxStep: 0.5 });
  assert.ok(t.segments.some((s) => s.domain === "d1"));
  const t2 = march(tree, { domain: "root", pos: [5, 58, 40] }, 0, { domain: "root", pos: [55, 58, 40] }, { maxStep: 0.5 });
  assert.ok(!t2.segments.some((s) => s.domain === "d1"), "the same chord lifted clear of the ball misses it");
});
