import test from "node:test";
import assert from "node:assert/strict";
import { StrataTree, arrivalField, march } from "../src/core/strata/index.js";
import {
  LIMITS, buildTree, decodeWorld, defaultWorld, encodeWorld, parseWorld, validate,
} from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";
import {
  addDomain, addEmitter, adjust, computeHeat, driftRate, emissionsUpTo, hitTest, metrics, moveSel, newLab,
  perceived, removeSel,
} from "../src/lab/lab.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const clone = (w: WorldSpec): WorldSpec => JSON.parse(JSON.stringify(w)) as WorldSpec;

test("arrivalField: uniform medium gives distance/speed", () => {
  const t = new StrataTree(2, 5);
  const f = arrivalField(t, { domain: "root", pos: [0, 0] }, 2, [0, 0], [100, 100], 10);
  assert.equal(f.values.length, 100);
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
    const d = Math.hypot((i + 0.5) * 10, (j + 0.5) * 10);
    near(f.values[j * 10 + i], 2 + d / 5, 1e-6);
  }
  near(f.tmin, f.values[0]);
  assert.ok(f.tmax > f.tmin);
});

test("world: default validates, builds, and survives encode/decode", () => {
  const w = defaultWorld();
  assert.deepEqual(validate(w), []);
  const tree = buildTree(w);
  assert.equal(tree.domains().length, 2);
  const back = decodeWorld(encodeWorld(w));
  assert.ok(back);
  assert.deepEqual(back, w);
  assert.ok(encodeWorld(w).length < 1200, "link stays compact");
});

test("world: validation rejects malformed specs", () => {
  const w = defaultWorld();
  const bad = (f: (x: WorldSpec) => void) => { const c = clone(w); f(c); return validate(c).length > 0 || parseWorld(c) === null; };
  assert.ok(bad((c) => { c.domains[0].scale = 0; }));
  assert.ok(bad((c) => { c.domains[0].parent = "nope"; }));
  assert.ok(bad((c) => { c.domains[1].id = "d1"; }));
  assert.ok(bad((c) => { c.emitters[0].domain = "ghost"; }));
  assert.ok(bad((c) => { c.rootSpeed = -1; }));
  assert.ok(bad((c) => { c.domains[0].changes = [[5, 1], [2, 1]]; }));
  assert.ok(bad((c) => { c.domains[0].shearMin = 2; }));
  assert.ok(bad((c) => { while (c.emitters.length <= LIMITS.emitters) c.emitters.push({ ...c.emitters[0], id: `x${c.emitters.length}` }); }));
  assert.equal(parseWorld("not json"), null);
  assert.equal(parseWorld({ domains: 1 }), null);
  assert.equal(decodeWorld("@@@"), null);
  assert.equal(decodeWorld(""), null);
});

test("lab: add/move/remove keep the world valid and nested", () => {
  const lab = newLab();
  const fast = addDomain(lab, "fast", [60, 80]);
  assert.ok(fast);
  assert.equal(addDomain(lab, "micro", [90, 90]), null, "micro needs a parent domain");
  const micro = addDomain(lab, "micro", [60, 80]);
  assert.ok(micro);
  assert.equal(lab.tree.get(micro as string).parent?.id, fast);
  const e = addEmitter(lab, [60, 80]) as string;
  assert.equal(lab.spec.emitters.find((x) => x.id === e)?.domain, micro, "emitter lands in the deepest domain");
  assert.deepEqual(validate(lab.spec), []);
  // moving a domain keeps its emitter attached in domain coordinates
  const before = lab.tree.toRootPos(micro as string, [0, 0]);
  moveSel(lab, { kind: "domain", id: fast as string }, [70, 70]);
  const after = lab.tree.toRootPos(micro as string, [0, 0]);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 1);
  assert.deepEqual(validate(lab.spec), []);
  // removing a domain removes descendants and their emitters
  removeSel(lab, { kind: "domain", id: fast as string });
  assert.ok(!lab.spec.domains.some((d) => d.id === fast || d.id === micro));
  assert.ok(!lab.spec.emitters.some((x) => x.id === e));
  assert.deepEqual(validate(lab.spec), []);
});

test("lab: hit testing prefers probe, then emitters, then deepest domain", () => {
  const lab = newLab();
  assert.equal(hitTest(lab, [50.5, 50.5])?.kind, "probe");
  assert.equal(hitTest(lab, [12, 12])?.kind, "emitter");
  assert.equal(hitTest(lab, [30, 58])?.kind, "domain");
  assert.equal(hitTest(lab, [3, 95]), null);
});

test("lab: adjust knobs clamp; drift schedules clock changes in order", () => {
  const lab = newLab();
  const d = { kind: "domain" as const, id: "d1" };
  for (let i = 0; i < 80; i++) adjust(lab, d, "rate", 1);
  assert.ok(lab.spec.domains[0].rate <= 8);
  for (let i = 0; i < 80; i++) adjust(lab, d, "size", -1);
  assert.ok(lab.spec.domains[0].extent >= 1);
  const e = { kind: "emitter" as const, id: "e1" };
  for (let i = 0; i < 80; i++) adjust(lab, e, "period", -1);
  assert.ok(lab.spec.emitters[0].period >= 0.8);

  const l2 = newLab();
  l2.t = 50;
  const n0 = l2.spec.domains[0].changes.length;
  assert.ok(driftRate(l2, { kind: "domain", id: "d1" }, 2));
  assert.equal(l2.spec.domains[0].changes.length, n0 + 1);
  l2.t = 10; // before the drift just added: refused, world untouched
  assert.equal(driftRate(l2, { kind: "domain", id: "d1" }, 2), false);
  assert.deepEqual(validate(l2.spec), []);
});

test("lab: emissions follow emitter-local clocks", () => {
  const w: WorldSpec = {
    v: 1, rootSpeed: 6,
    domains: [{ id: "d1", parent: "root", origin: [20, 20], scale: 1, extent: 10, echoSpeed: 6, rate: 4, shearMin: null, changes: [] }],
    emitters: [{ id: "e1", domain: "d1", pos: [0, 0], period: 8, phase: 0, hue: 10 }],
  };
  const lab = newLab(w);
  const ems = emissionsUpTo(lab, 9, 10).map((e) => Math.round(e.launchRoot * 100) / 100).sort((a, b) => a - b);
  assert.deepEqual(ems, [2, 4, 6, 8]); // period 8 local at rate 4 => every 2 root seconds
});

test("lab: probe perceives at emit + distance/speed; metrics are sane", () => {
  const w: WorldSpec = {
    v: 1, rootSpeed: 6, domains: [],
    emitters: [
      { id: "e1", domain: "root", pos: [20, 50], period: 4, phase: 0, hue: 10 },
      { id: "e2", domain: "root", pos: [80, 50], period: 4, phase: 0, hue: 200 },
    ],
  };
  const lab = newLab(w);
  lab.probe = [50, 50];
  lab.t = 20;
  const ps = perceived(lab);
  assert.ok(ps.length >= 2);
  for (const p of ps) near(p.lag, 5, 0.02);
  const m = metrics(lab);
  assert.ok(m.spread < 0.05, "equidistant emitters are coherent");
  lab.probe = [25, 50]; // near e1, far from e2
  lab.arrivals.clear();
  lab.t = 30;
  assert.ok(metrics(lab).spread > 3, "off-centre probe sees a scrambled timeline");
  // arrival is independent of t (cache keyed by emission only)
  const a = perceived(lab).map((p) => p.arrival);
  lab.t = 31;
  const b = perceived(lab).map((p) => p.arrival);
  for (const x of a) assert.ok(b.some((y) => Math.abs(x - y) < 1e-9));
});

test("lab: heat field matches march", () => {
  const lab = newLab();
  lab.t = 20;
  assert.ok(computeHeat(lab, "e1", 8));
  const h = lab.heat!;
  const e = lab.spec.emitters[0];
  const p: [number, number] = [(3 + 0.5) * 12.5, (4 + 0.5) * 12.5];
  const direct = march(lab.tree, { domain: e.domain, pos: e.pos }, e.phase + h.k * e.period, { domain: "root", pos: p }, { maxStep: 1.5 }).rootTime;
  near(h.field.values[4 * 8 + 3], direct, 1e-9);
  assert.equal(computeHeat(lab, "nope"), false);
});

test("lab: random edit storm never breaks validity", () => {
  const lab = newLab();
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 300; i++) {
    const at: [number, number] = [rnd() * 100, rnd() * 100];
    const r = rnd();
    if (r < 0.15) addDomain(lab, "fast", at);
    else if (r < 0.25) addDomain(lab, "well", at);
    else if (r < 0.35) addDomain(lab, "micro", at);
    else if (r < 0.5) addEmitter(lab, at);
    else if (r < 0.65) { const h = hitTest(lab, at); if (h) moveSel(lab, h, [rnd() * 100, rnd() * 100]); }
    else if (r < 0.75) { const h = hitTest(lab, at); if (h) removeSel(lab, h); }
    else if (r < 0.85) { const h = hitTest(lab, at); if (h) { adjust(lab, h, "size", rnd() < 0.5 ? 1 : -1); adjust(lab, h, "rate", 1); } }
    else { lab.t = rnd() * 200; const h = hitTest(lab, at); if (h) driftRate(lab, h, rnd() < 0.5 ? 0.5 : 2); }
    assert.deepEqual(validate(lab.spec), [], `invalid after step ${i}`);
    assert.ok(parseWorld(lab.spec) !== null);
  }
  lab.t = 100;
  assert.ok(metrics(lab).spread >= 0);
  const back = decodeWorld(encodeWorld(lab.spec));
  assert.ok(back, "storm world survives link round-trip");
});
