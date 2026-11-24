import test from "node:test";
import assert from "node:assert/strict";
import { march } from "../src/core/strata/index.js";
import {
  addRelay, addDomain, auditEmitter, clearCuts, computeHeat, cycleLaw, emissionsUpTo, launchOf, newLab, removeSel,
  toggleCut, adjust, moveSel, hitTest, addEmitter,
} from "../src/lab/lab.js";
import { causalCone, spacetime } from "../src/lab/spacetime.js";
import { decodeWorld, defaultWorld, encodeWorld, parseWorld, validate } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A free-running at x=20 (period 4); R relays A from x=80 after 1s. Uniform medium, speed 6 => 10s of flight. */
const chain = (): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [
    { id: "A", domain: "root", pos: [20, 50], period: 4, phase: 0, hue: 10 },
    { id: "R", domain: "root", pos: [80, 50], period: 4, phase: 0, hue: 200, relay: { from: "A", delay: 1 } },
  ],
});
const ks = (lab: ReturnType<typeof newLab>, id: string, t: number) =>
  emissionsUpTo(lab, t, 40).filter((e) => e.emitter === id).sort((a, b) => a.k - b.k);

test("relay: launches exactly flight-time + delay after the source pulse", () => {
  const lab = newLab(chain());
  assert.deepEqual(validate(lab.spec), []);
  const r = ks(lab, "R", 60);
  assert.equal(r.length, 12);
  for (const e of r) near(e.launchRoot, 4 * e.k + 10 + 1, 0.02);
  // nothing launches before it has been caused
  assert.ok(ks(lab, "R", 10).length === 0);
});

test("relay chains compose: A -> R1 -> R2 accumulates flight and delays", () => {
  const w = chain();
  w.emitters.push({ id: "R2", domain: "root", pos: [80, 10], period: 4, phase: 0, hue: 90, relay: { from: "R", delay: 2 } });
  const lab = newLab(w);
  assert.deepEqual(validate(w), []);
  for (const e of ks(lab, "R2", 80)) near(e.launchRoot, 4 * e.k + 11 + 40 / 6 + 2, 0.03);
});

test("relay in a fast-clock domain: delay runs on the relay's own clock", () => {
  const w = chain();
  w.domains.push({ id: "f", parent: "root", origin: [80, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 4, shearMin: null, changes: [] });
  w.emitters[1] = { ...w.emitters[1], domain: "f", pos: [0, 0] };
  const lab = newLab(w);
  assert.deepEqual(validate(w), []);
  const L = launchOf(lab, "R", 3) as { launchLocal: number; launchRoot: number };
  const A = launchOf(lab, "A", 3) as { launchLocal: number; launchRoot: number };
  const heard = march(lab.tree, { domain: "root", pos: [20, 50] }, A.launchLocal, { domain: "f", pos: [0, 0] }, { maxStep: 1 }).rootTime;
  near(L.launchRoot, heard + 1 / 4, 1e-9); // 1 local second at rate 4 = 0.25 root seconds
});

test("cut: a removed pulse never happens, and neither does anything it caused", () => {
  const lab = newLab(chain());
  const w = chain();
  w.emitters.push({ id: "R2", domain: "root", pos: [80, 10], period: 4, phase: 0, hue: 90, relay: { from: "R", delay: 2 } });
  const lab2 = newLab(w);
  const before = (id: string) => ks(lab2, id, 80).map((e) => e.k);
  assert.ok(before("A").includes(3) && before("R").includes(3) && before("R2").includes(3));
  assert.equal(toggleCut(lab2, "A", 3), true);
  for (const id of ["A", "R", "R2"]) assert.ok(!ks(lab2, id, 80).some((e) => e.k === 3), `${id} pulse 3 should be gone`);
  for (const id of ["A", "R", "R2"]) assert.ok(ks(lab2, id, 80).some((e) => e.k === 4), `${id} pulse 4 untouched`);
  assert.deepEqual(validate(lab2.spec), []);
  // cutting only the middle of a chain spares upstream but kills downstream
  clearCuts(lab2);
  assert.equal(lab2.spec.cuts, undefined);
  toggleCut(lab2, "R", 5);
  assert.ok(ks(lab2, "A", 80).some((e) => e.k === 5));
  assert.ok(!ks(lab2, "R", 80).some((e) => e.k === 5) && !ks(lab2, "R2", 80).some((e) => e.k === 5));
  assert.equal(toggleCut(lab2, "R", 5), false, "toggling again restores it");
  assert.ok(ks(lab2, "R2", 80).some((e) => e.k === 5));
  assert.ok(lab.spec.cuts === undefined);
});

test("cut changes what the probe hears (intervention is visible in the metrics)", () => {
  const lab = newLab(chain());
  lab.probe = [50, 50];
  lab.t = 40;
  const n0 = spacetime(lab).lines.length;
  toggleCut(lab, "A", 6);
  assert.equal(spacetime(lab).lines.length, n0 - 2, "A#6 and R#6 vanish");
  assert.equal(spacetime(lab).cuts.length, 1);
  near(spacetime(lab).cuts[0].launch, 24, 1e-9);
});

test("validation: relay cycles, unknown sources, negative delays and bad cuts are rejected", () => {
  const bad = (f: (w: WorldSpec) => void) => { const c = clone(chain()); f(c); return validate(c).length > 0 || parseWorld(c) === null; };
  assert.ok(bad((w) => { w.emitters[0].relay = { from: "R", delay: 1 }; }), "cycle");
  assert.ok(bad((w) => { w.emitters[1].relay = { from: "R", delay: 1 }; }), "self");
  assert.ok(bad((w) => { w.emitters[1].relay = { from: "ghost", delay: 1 }; }), "unknown");
  assert.ok(bad((w) => { w.emitters[1].relay = { from: "A", delay: -1 }; }), "negative");
  assert.ok(bad((w) => { w.emitters[1].relay = { from: "A", delay: NaN }; }), "nan");
  assert.ok(bad((w) => { (w.emitters[1] as { relay: unknown }).relay = "A"; }), "string");
  assert.ok(bad((w) => { w.cuts = [{ emitter: "A", k: 0 }]; }), "k=0");
  assert.ok(bad((w) => { w.cuts = [{ emitter: "ghost", k: 1 }]; }), "ghost cut");
  assert.ok(bad((w) => { w.cuts = Array.from({ length: 25 }, (_, i) => ({ emitter: "A", k: i + 1 })); }), "too many cuts");
  assert.deepEqual(validate(chain()), []);
});

test("links: relays and cuts survive encode/decode; old worlds are unchanged", () => {
  const w = chain();
  w.cuts = [{ emitter: "A", k: 3 }];
  const back = decodeWorld(encodeWorld(w));
  assert.deepEqual(back, w);
  const plain = decodeWorld(encodeWorld(defaultWorld()));
  assert.deepEqual(plain, defaultWorld());
  assert.equal(plain?.cuts, undefined);
  assert.ok(encodeWorld(w).length < 1500);
  assert.equal(parseWorld({ ...chain(), cuts: "no" }) !== null, true, "non-array cuts are ignored, not trusted");
});

test("lab: addRelay / remove cascade / delay knob keep the world valid", () => {
  const lab = newLab(defaultWorld());
  const id = addRelay(lab, [60, 80], "e1") as string;
  assert.ok(id);
  const id2 = addRelay(lab, [90, 20], id) as string;
  assert.ok(id2);
  assert.equal(addRelay(lab, [1, 1], "ghost"), null);
  assert.deepEqual(validate(lab.spec), []);
  const e = lab.spec.emitters.find((x) => x.id === id)!;
  const d0 = e.relay!.delay;
  adjust(lab, { kind: "emitter", id }, "period", -1);
  assert.ok(e.relay!.delay > d0, "'=' (dir -1) lengthens a relay's delay");
  toggleCut(lab, "e1", 4);
  removeSel(lab, { kind: "emitter", id: "e1" });
  assert.ok(!lab.spec.emitters.some((x) => x.id === id || x.id === id2 || x.id === "e1"), "relays die with their source");
  assert.equal(lab.spec.cuts, undefined, "cuts of removed emitters go too");
  assert.deepEqual(validate(lab.spec), []);
});

test("lab: heat and audit work for relays; a relay with no pulse yet is simply absent", () => {
  const lab = newLab(chain());
  lab.t = 3;
  assert.equal(computeHeat(lab, "R", 6), false);
  lab.t = 60;
  assert.equal(computeHeat(lab, "R", 6), true);
  assert.equal(lab.heat?.emitter, "R");
  const k = lab.heat!.k;
  near(lab.tree.toRootTime("root", lab.heat!.launchLocal), 4 * k + 11, 0.02);
  const au = auditEmitter(lab, "R");
  assert.ok(au && au.audit.verdict === "conserved");
});

test("laws reshape causality: global time + uniform medium re-time a relay in a clock domain", () => {
  const w = chain();
  w.domains.push({ id: "f", parent: "root", origin: [80, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 4, shearMin: null, changes: [] });
  w.emitters[1] = { ...w.emitters[1], domain: "f", pos: [0, 0] };
  const lab = newLab(w);
  const a = ks(lab, "R", 80).map((e) => Math.round(e.launchRoot * 100));
  cycleLaw(lab, "time"); cycleLaw(lab, "medium");
  const b = ks(lab, "R", 80).map((e) => Math.round(e.launchRoot * 100));
  assert.notDeepEqual(a, b);
  for (const e of ks(lab, "R", 80)) near(e.launchRoot, 4 * e.k + 10 + 1, 0.05); // uniform + global: plain geometry
});

test("spacetime: relay pulses name their cause; the cone's `caused` set is a subset of the ledger's future", () => {
  const w = chain();
  w.emitters.push({ id: "R2", domain: "root", pos: [80, 10], period: 4, phase: 0, hue: 90, relay: { from: "R", delay: 2 } });
  const lab = newLab(w);
  lab.probe = [50, 50];
  lab.t = 60;
  const st = spacetime(lab);
  for (const l of st.lines) {
    if (l.emitter === "A") assert.equal(l.cause, null);
    if (l.emitter === "R") assert.equal(l.cause, `A|${l.k}`);
    if (l.emitter === "R2") assert.equal(l.cause, `R|${l.k}`);
  }
  const cone = causalCone(lab, st, "A", 30)!;
  const k = cone.origin.k;
  const caused = [...cone.caused].map((l) => `${l.emitter}#${l.k}`).sort();
  assert.deepEqual(caused, [`R#${k}`, `R2#${k}`].sort());
  for (const l of cone.caused) assert.equal(cone.rel.get(l), "future", "cause implies ledger-future");
  assert.ok(cone.caused.size < cone.future, "potential influence is wider than actual influence");
});

test("lab: edit storm with relays and cuts never breaks validity or the link round-trip", () => {
  const lab = newLab(defaultWorld());
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 250; i++) {
    const at: [number, number] = [rnd() * 100, rnd() * 100];
    const r = rnd();
    const em = lab.spec.emitters;
    if (r < 0.15 && em.length) addRelay(lab, at, em[Math.floor(rnd() * em.length)].id, rnd() * 3);
    else if (r < 0.25) addEmitter(lab, at);
    else if (r < 0.35) addDomain(lab, rnd() < 0.5 ? "fast" : "well", at);
    else if (r < 0.5 && em.length) toggleCut(lab, em[Math.floor(rnd() * em.length)].id, 1 + Math.floor(rnd() * 20));
    else if (r < 0.6) clearCuts(lab);
    else if (r < 0.75) { const h = hitTest(lab, at); if (h) removeSel(lab, h); }
    else if (r < 0.9) { const h = hitTest(lab, at); if (h) moveSel(lab, h, [rnd() * 100, rnd() * 100]); }
    else { lab.t = rnd() * 150; spacetime(lab); }
    assert.deepEqual(validate(lab.spec), [], `invalid after step ${i}`);
    assert.ok(parseWorld(lab.spec) !== null, `unparseable after step ${i}`);
  }
  lab.t = 90;
  const st = spacetime(lab);
  for (const l of st.lines) assert.ok(l.arrival >= l.launch);
  assert.ok(decodeWorld(encodeWorld(lab.spec)), "storm world survives link round-trip");
});
