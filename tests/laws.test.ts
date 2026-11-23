import test from "node:test";
import assert from "node:assert/strict";
import { StrataTree, march } from "../src/core/strata/index.js";
import { LAWFUL, auditRay, parseLaws, shellEnergy, fluxDensity, sphereArea, spreadExponent, validateLaws } from "../src/core/laws/index.js";
import type { Laws } from "../src/core/laws/index.js";
import { buildTree, decodeWorld, defaultWorld, encodeWorld, parseWorld, validate, wellIds } from "../src/lab/world.js";
import { arrivalAt, auditEmitter, cycleLaw, emissionsUpTo, newLab, rayAt, resetLaws } from "../src/lab/lab.js";

const L = (o: Partial<Laws> = {}): Laws => ({ ...LAWFUL, ...o });
const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} vs ${b}`);

test("sphereArea: known values for D=2..6", () => {
  close(sphereArea(2), 2 * Math.PI);
  close(sphereArea(3), 4 * Math.PI);
  close(sphereArea(4), 2 * Math.PI ** 2);
  close(sphereArea(5), (8 * Math.PI ** 2) / 3);
  close(sphereArea(6), Math.PI ** 3);
});

test("spread exponent follows dimension and Gauss law", () => {
  for (let D = 2; D <= 6; D++) {
    assert.equal(spreadExponent(L({ dim: D })), D - 1);
    assert.equal(spreadExponent(L({ dim: D, gauss: "leaky" })), D);
    assert.equal(spreadExponent(L({ dim: D, gauss: "runaway" })), D - 2);
  }
});

test("laws: validation and strict parsing", () => {
  assert.deepEqual(validateLaws(LAWFUL), []);
  assert.ok(validateLaws(L({ dim: 1 })).length > 0);
  assert.ok(validateLaws(L({ dim: 7 })).length > 0);
  assert.ok(validateLaws(L({ dim: 2.5 })).length > 0);
  assert.ok(validateLaws(L({ loss: -0.1 })).length > 0);
  assert.ok(validateLaws(L({ noise: -1 })).length > 0);
  assert.ok(validateLaws(L({ loss: NaN })).length > 0);
  assert.equal(parseLaws({ ...LAWFUL, gauss: "magic" }), null);
  assert.equal(parseLaws("nope"), null);
  assert.deepEqual(parseLaws(undefined), LAWFUL);
});

test("core is N-dimensional: uniform 3D and 4D marches equal distance / speed", () => {
  for (const D of [3, 4, 5]) {
    const tree = new StrataTree(D, 5);
    const a = Array.from({ length: D }, (_, i) => 10 + i);
    const b = Array.from({ length: D }, (_, i) => 40 - 3 * i);
    const dist = Math.hypot(...a.map((x, i) => x - b[i]));
    const r = march(tree, { domain: "root", pos: a }, 0, { domain: "root", pos: b });
    close(r.rootTime, dist / 5, 1e-9);
    close(r.segments.reduce((s, q) => s + q.length, 0), dist, 1e-9);
  }
});

test("core 3D: a fast domain shortens the arrival and shows up in the path segments", () => {
  const tree = new StrataTree(3, 4);
  tree.add({ id: "fast", parent: "root", origin: [50, 50, 50], scale: 1, extent: 15, echoSpeed: 4, rate: 3 });
  const a = { domain: "root", pos: [20, 50, 50] }, b = { domain: "root", pos: [80, 50, 50] };
  const t = march(tree, a, 0, b, { maxStep: 0.5 });
  assert.ok(t.rootTime < 60 / 4 - 1);
  assert.deepEqual(t.segments.map((q) => q.domain), ["root", "fast", "root"]);
  close(t.segments[1].length, 30, 1e-2);
  const off = march(tree, a, 0, { domain: "root", pos: [80, 50, 90] }, { maxStep: 0.5 });
  assert.deepEqual(off.segments.map((q) => q.domain), ["root"]); // this chord passes 16.6 from the centre, outside extent 15
});

test("march segments: lengths sum to the chord, order matches crossed", () => {
  const w = defaultWorld();
  const tree = buildTree(w);
  const r = march(tree, { domain: "root", pos: [5, 60] }, 0, { domain: "root", pos: [95, 30] }, { maxStep: 1 });
  close(r.segments.reduce((s, q) => s + q.length, 0), Math.hypot(90, 30), 1e-9);
  assert.deepEqual(r.segments.map((q) => q.domain), r.crossed);
});

test("audit: lawful laws conserve energy in every dimension, with and without loss", () => {
  const segs = [{ domain: "root", length: 20 }, { domain: "d1", length: 12 }, { domain: "d2", length: 6 }, { domain: "root", length: 22 }];
  for (let D = 2; D <= 6; D++) for (const loss of [0, 0.01, 0.1]) {
    const a = auditRay(L({ dim: D, loss }), segs, new Set(["d2"]), 100, 60);
    assert.equal(a.verdict, "conserved", `D=${D} loss=${loss}`);
    assert.ok(Math.abs(a.relResidual) < 1e-12);
    close(a.delivered + a.absorbedTotal, 100);
    if (loss === 0) assert.equal(a.absorbedTotal, 0);
    else assert.ok(a.absorbed.d1 > 0 && a.absorbed.d2 > 0 && a.absorbed.root === undefined);
  }
});

test("audit: broken Gauss laws are caught — runaway creates energy, leaky destroys it", () => {
  const segs = [{ domain: "root", length: 60 }];
  for (let D = 2; D <= 6; D++) {
    const run = auditRay(L({ dim: D, gauss: "runaway" }), segs, new Set(), 100, 60);
    assert.equal(run.verdict, "created", `runaway D=${D}`);
    close(run.delivered, 100 * 60, 1e-9);
    const leak = auditRay(L({ dim: D, gauss: "leaky" }), segs, new Set(), 100, 60);
    assert.equal(leak.verdict, "destroyed", `leaky D=${D}`);
    close(leak.delivered, 100 / 60, 1e-9);
  }
});

test("audit: inside the emitter core nothing is created or lost", () => {
  for (const g of ["holds", "leaky", "runaway"] as const) {
    const a = auditRay(L({ gauss: g }), [{ domain: "root", length: 0.5 }], new Set(), 100, 0.5);
    assert.equal(a.verdict, "conserved");
  }
});

test("flux density: inverse-power with the dimension, shell energy flat when lawful", () => {
  for (let D = 2; D <= 5; D++) {
    const l = L({ dim: D });
    close(fluxDensity(l, 100, 10) / fluxDensity(l, 100, 20), Math.pow(2, D - 1), 1e-12);
    close(shellEnergy(l, fluxDensity(l, 100, 7), 7), 100, 1e-12);
    close(shellEnergy(l, fluxDensity(l, 100, 31), 31), 100, 1e-12);
  }
});

test("information: fidelity decays only inside wells and stays in (0,1]", () => {
  const segs = [{ domain: "root", length: 30 }, { domain: "w", length: 10 }, { domain: "root", length: 30 }];
  const a = auditRay(L({ noise: 0.06 }), segs, new Set(["w"]), 100, 70);
  close(a.fidelity, Math.exp(-0.6), 1e-12);
  assert.ok(a.fidelity > 0 && a.fidelity <= 1);
  assert.ok(a.noiseBy.w > 0 && a.noiseBy.root === undefined);
  assert.equal(auditRay(L({ noise: 0 }), segs, new Set(["w"]), 100, 70).fidelity, 1);
  assert.equal(auditRay(L({ noise: 0.06 }), segs, new Set(), 100, 70).fidelity, 1);
});

test("laws are data: global time + uniform medium make lag == distance / rootSpeed", () => {
  const spec = defaultWorld();
  spec.laws = L({ time: "global", medium: "uniform" });
  const tree = buildTree(spec);
  for (const to of [[10, 10], [60, 40], [95, 80], [30, 58]]) {
    for (const from of [{ domain: "root", pos: [12, 12] }, { domain: "d1", pos: [-6, 8] }, { domain: "d2", pos: [5, -4] }]) {
      const r = march(tree, from, 0, { domain: "root", pos: to }, { maxStep: 0.5 });
      const a = tree.toRootPos(from.domain, from.pos);
      close(r.rootTime, Math.hypot(a[0] - to[0], a[1] - to[1]) / spec.rootSpeed, 1e-6);
    }
  }
});

test("laws are data: global time alone removes clock drift, medium alone keeps clocks", () => {
  const base = defaultWorld();
  const g = defaultWorld(); g.laws = L({ time: "global" });
  const u = defaultWorld(); u.laws = L({ medium: "uniform" });
  const tb = buildTree(base), tg = buildTree(g), tu = buildTree(u);
  assert.notEqual(tb.toRootTime("d1", 50), 50);
  assert.equal(tg.toRootTime("d1", 50), 50);
  assert.equal(tg.toRootTime("d2", 33), 33);
  assert.notEqual(tu.toRootTime("d1", 50), 50);
  // uniform removes shear: speed at the well centre equals rootSpeed * rate
  const wellC = tu.get("d2").centerRoot;
  close(tu.speedAt(wellC, 0), base.rootSpeed * 1, 1e-9);
  assert.ok(tb.speedAt(wellC, 0) < base.rootSpeed * 0.3);
});

test("regression: LAWFUL laws reproduce the exact v0.9 world", () => {
  const a = defaultWorld();
  const b = defaultWorld(); b.laws = { ...LAWFUL };
  const ta = buildTree(a), tb = buildTree(b);
  for (const to of [[10, 90], [72, 34], [30, 58], [99, 1]]) {
    const x = march(ta, { domain: "d1", pos: [-6, 8] }, 3, { domain: "root", pos: to }, { maxStep: 1 }).rootTime;
    const y = march(tb, { domain: "d1", pos: [-6, 8] }, 3, { domain: "root", pos: to }, { maxStep: 1 }).rootTime;
    assert.equal(x, y);
  }
});

test("world links: laws survive encode/decode; old links decode as lawful; bad laws are rejected", () => {
  const w = defaultWorld();
  w.laws = L({ time: "global", dim: 4, loss: 0.03, noise: 0.02, gauss: "runaway" });
  const back = decodeWorld(encodeWorld(w));
  assert.ok(back);
  assert.deepEqual(back?.laws, w.laws);
  const plain = decodeWorld(encodeWorld(defaultWorld()));
  assert.ok(plain);
  assert.equal(plain?.laws, undefined);
  const old = JSON.stringify(defaultWorld()); // a v0.9 link carries no laws
  assert.ok(parseWorld(old));
  const bad = JSON.parse(old); bad.laws = { ...LAWFUL, dim: 99 };
  assert.equal(parseWorld(bad), null);
  const bad2 = JSON.parse(old); bad2.laws = { ...LAWFUL, loss: -1 };
  assert.equal(parseWorld(bad2), null);
  const w2 = defaultWorld(); w2.laws = L({ dim: 9 });
  assert.ok(validate(w2).length > 0);
});

test("lab: cycling laws rebuilds the world and each knob walks its full cycle", () => {
  const lab = newLab(defaultWorld());
  const rev0 = lab.rev;
  assert.equal(cycleLaw(lab, "time").time, "global");
  assert.equal(cycleLaw(lab, "time").time, "local");
  assert.equal(cycleLaw(lab, "medium").medium, "uniform");
  assert.equal(cycleLaw(lab, "medium").medium, "strata");
  const dims = [3, 4, 5, 6, 2].map(() => cycleLaw(lab, "dim").dim);
  assert.deepEqual(dims, [3, 4, 5, 6, 2]);
  const loss = [0, 0, 0, 0].map(() => cycleLaw(lab, "loss").loss);
  assert.deepEqual(loss, [0.01, 0.03, 0.1, 0]);
  const noise = [0, 0, 0].map(() => cycleLaw(lab, "noise").noise);
  assert.deepEqual(noise, [0.02, 0.06, 0]);
  const gauss = [0, 0, 0].map(() => cycleLaw(lab, "gauss").gauss);
  assert.deepEqual(gauss, ["leaky", "runaway", "holds"]);
  assert.ok(lab.rev > rev0 + 10);
  assert.deepEqual(validate(lab.spec), []);
  cycleLaw(lab, "gauss"); cycleLaw(lab, "time");
  resetLaws(lab);
  assert.deepEqual(lab.spec.laws, LAWFUL);
});

test("lab: time law changes what the probe hears; lag becomes pure geometry", () => {
  const lab = newLab(defaultWorld());
  lab.t = 60;
  const ems = emissionsUpTo(lab, 60, 2).filter((e) => e.domain !== "root");
  assert.ok(ems.length > 0);
  const before = ems.map((e) => arrivalAt(lab, e));
  cycleLaw(lab, "time"); cycleLaw(lab, "medium");
  lab.t = 60;
  const ems2 = emissionsUpTo(lab, 60, 2).filter((e) => e.domain !== "root");
  const after = ems2.map((e) => arrivalAt(lab, e));
  assert.notDeepEqual(before.map((x) => Math.round(x * 100)), after.map((x) => Math.round(x * 100)));
  for (const e of ems2) {
    const from = lab.tree.toRootPos(e.domain, e.pos);
    const lag = arrivalAt(lab, e) - e.launchRoot;
    close(lag, Math.hypot(from[0] - lab.probe[0], from[1] - lab.probe[1]) / lab.spec.rootSpeed, 1e-6);
  }
});

test("lab audit: lawful world conserves; runaway/leaky are flagged; loss and noise are booked per domain", () => {
  const lab = newLab(defaultWorld());
  lab.t = 40;
  lab.probe = [30, 58]; // inside d1
  let au = auditEmitter(lab, "e1");
  assert.ok(au && au.audit.verdict === "conserved");
  cycleLaw(lab, "loss"); cycleLaw(lab, "loss"); // 0.03
  au = auditEmitter(lab, "e1");
  assert.ok(au && au.audit.verdict === "conserved" && au.audit.absorbed.d1 > 0 && au.audit.absorbedTotal > 0);
  cycleLaw(lab, "gauss"); // leaky
  au = auditEmitter(lab, "e1");
  assert.equal(au?.audit.verdict, "destroyed");
  cycleLaw(lab, "gauss"); // runaway
  au = auditEmitter(lab, "e1");
  assert.equal(au?.audit.verdict, "created");
  cycleLaw(lab, "gauss"); // holds
  lab.probe = [72, 34]; // inside well d2
  cycleLaw(lab, "noise");
  au = auditEmitter(lab, "e1");
  assert.ok(au && au.audit.fidelity < 1 && (au.audit.noiseBy.d2 ?? 0) > 0);
  assert.ok(wellIds(lab.spec).has("d2"));
  assert.ok(rayAt(lab, emissionsUpTo(lab, 40, 1)[0]).segments.length >= 1);
});
