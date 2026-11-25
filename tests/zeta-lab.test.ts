import test from "node:test";
import assert from "node:assert/strict";
import { FB_BASE, zetaZeros } from "../src/core/strata/index.js";
import {
  addFeedback, adjust, emissionsUpTo, feedbackOf, hasZeta, launchOf, newLab, perceived, pulseCount, pulseLocal, toggleZeta, zetaFix,
} from "../src/lab/lab.js";
import { decodeWorld, encodeWorld, parseWorld, validate } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const beacon = (over: Partial<WorldSpec["emitters"][number]> = {}): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [{ id: "Z", domain: "root", pos: [20, 50], period: 4, phase: 0.5, hue: 190, zeta: 1.5, ...over }],
});

test("world: zeta beacons validate, round-trip through links, and reject nonsense", () => {
  assert.deepEqual(validate(beacon()), []);
  const bad = (f: (w: WorldSpec) => void) => { const w = clone(beacon()); f(w); return validate(w).length > 0 || parseWorld(w) === null; };
  assert.ok(bad((w) => { w.emitters[0].zeta = 0; }));
  assert.ok(bad((w) => { w.emitters[0].zeta = 99; }));
  assert.ok(bad((w) => { w.emitters[0].zeta = NaN; }));
  assert.ok(bad((w) => { w.emitters.push({ id: "R", domain: "root", pos: [50, 50], period: 4, phase: 0, hue: 1, zeta: 1, relay: { from: "Z", delay: 1 } }); }));
  const back = decodeWorld(encodeWorld(beacon()));
  assert.equal(back?.emitters[0].zeta, 1.5);
});

test("schedule: pulse k launches at phase + scale x gamma_k, and the counter inverts it", () => {
  const lab = newLab(beacon());
  const e = lab.spec.emitters[0], zs = zetaZeros(40);
  for (const k of [1, 2, 7, 30]) {
    near(pulseLocal(e, k), 0.5 + 1.5 * zs[k - 1], 1e-12);
    near(launchOf(lab, "Z", k)?.launchRoot ?? NaN, 0.5 + 1.5 * zs[k - 1], 1e-9);
  }
  assert.equal(pulseCount(e, 0.5 + 1.5 * 14), 0);
  assert.equal(pulseCount(e, 0.5 + 1.5 * 14.2), 1);
  assert.equal(pulseCount(e, 0.5 + 1.5 * zs[9]), 10);
  assert.equal(pulseCount(e, 0.5 + 1.5 * zs[9] - 1e-6), 9);
  const ems = emissionsUpTo(lab, 60, 5);
  assert.deepEqual(ems.map((m) => m.k).sort((a, b) => a - b), [...ems.map((m) => m.k)].sort((a, b) => a - b));
  assert.ok(ems.length === 5 && ems.every((m) => m.launchRoot <= 60));
});

test("probe: a blind listener names the zeros it heard and the sender's clock (uniform medium)", () => {
  const lab = newLab(beacon());
  lab.probe = [60, 50]; lab.t = 110;
  assert.equal(hasZeta(lab), true);
  const f = zetaFix(lab);
  assert.ok(f && f.fix);
  assert.equal(f.identified, true);
  assert.equal(f.verdict, "baseline");
  near(f.rateEst, 1, 1e-6); near(f.rateTrue, 1, 1e-9);
  assert.ok(f.deviation < 1e-6);
  near(f.fix.intercept, 0.5 + 40 / 6, 1e-6); // phase + flight
  assert.ok(f.fix.confidence > 3);
});

test("probe: the sender's clock rate comes out of the heard times alone (3x fast domain)", () => {
  const w = beacon({ domain: "f", pos: [0, 0], zeta: 3 });
  w.domains.push({ id: "f", parent: "root", origin: [20, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 3, shearMin: null, changes: [] });
  const lab = newLab(w);
  lab.probe = [80, 50]; lab.t = 120;
  const f = zetaFix(lab);
  assert.ok(f && f.fix);
  assert.equal(f.identified, true);
  near(f.rateTrue, 3, 1e-9);
  near(f.rateEst, 3, 0.02);
  assert.equal(f.verdict, "baseline");
});

test("probe: clock drift inside the window shows up as deviation from arithmetic time", () => {
  const w = beacon({ domain: "f", pos: [0, 0], zeta: 3 });
  w.domains.push({ id: "f", parent: "root", origin: [20, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 3, shearMin: null, changes: [[40, 0.5], [55, 4]] });
  const lab = newLab(w);
  lab.probe = [80, 50]; lab.t = 60;
  const f = zetaFix(lab);
  assert.ok(f && f.fix);
  assert.ok(f.deviation > 0.003, `deviation ${f.deviation}`);
  assert.ok(f.verdict === "bent" || f.verdict === "broken" || f.verdict === "ambiguous");
});

test("probe: listens until 5 consecutive pulses are heard; metronomes have no fix", () => {
  const lab = newLab(beacon());
  lab.probe = [60, 50]; lab.t = 25;
  const early = zetaFix(lab);
  assert.ok(early);
  assert.equal(early.verdict, "listening");
  assert.equal(early.fix, null);
  const plain = newLab(beacon({ zeta: undefined }));
  assert.equal(zetaFix(plain), null);
  assert.equal(hasZeta(plain), false);
});

test("relays and feedback work on a zeta source", () => {
  const w = beacon();
  w.emitters.push({ id: "R", domain: "root", pos: [70, 50], period: 4, phase: 0, hue: 10, relay: { from: "Z", delay: 1 } });
  const lab = newLab(w);
  const z = launchOf(lab, "Z", 4), r = launchOf(lab, "R", 4);
  assert.ok(z && r);
  near(r.launchRoot, z.launchRoot + 50 / 6 + 1, 1e-6);
  assert.ok(addFeedback(lab, "Z", "Z", 2, 0.5));
  const echoes = feedbackOf(lab).result.pulses;
  assert.ok(echoes.length > 5);
  assert.ok(echoes.every((p) => p.k >= FB_BASE));
  assert.ok(perceived(lab, 8).length >= 0);
});

test("lab edits: toggling and scaling a beacon", () => {
  const lab = newLab(beacon({ zeta: undefined }));
  assert.equal(toggleZeta(lab, "Z"), true);
  assert.equal(lab.spec.emitters[0].zeta, 1);
  for (let i = 0; i < 80; i++) adjust(lab, { kind: "emitter", id: "Z" }, "period", 1);
  assert.equal(lab.spec.emitters[0].zeta, 5);
  for (let i = 0; i < 80; i++) adjust(lab, { kind: "emitter", id: "Z" }, "period", -1);
  assert.equal(lab.spec.emitters[0].zeta, 0.2);
  assert.deepEqual(validate(lab.spec), []);
  assert.equal(toggleZeta(lab, "Z"), false);
  assert.equal(lab.spec.emitters[0].zeta, undefined);
  assert.equal(toggleZeta(lab, "nope"), null);
  const w = beacon({ zeta: undefined });
  w.emitters.push({ id: "R", domain: "root", pos: [70, 50], period: 4, phase: 0, hue: 10, relay: { from: "Z", delay: 1 } });
  assert.equal(toggleZeta(newLab(w), "R"), null, "a relay cannot keep zeta time");
});
