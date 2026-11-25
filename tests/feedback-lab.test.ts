import test from "node:test";
import assert from "node:assert/strict";
import { FB_BASE } from "../src/core/strata/index.js";
import { LAWFUL } from "../src/core/laws/index.js";
import {
  addEmitter, addFeedback, adjustFeedback, emissionsUpTo, feedbackAudit, feedbackOf, hasFeedback, launchOf, newLab, rebuild,
  removeFeedback, removeSel, toggleCut, perceived, moveSel, hitTest, addDomain, driftRate, adjust,
} from "../src/lab/lab.js";
import { causalCone, spacetime } from "../src/lab/spacetime.js";
import { decodeWorld, defaultWorld, encodeWorld, parseWorld, validate } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A free-running at x=20 with a self-echo (delay 2, gain 0.5). Uniform medium, speed 6. */
const selfEcho = (): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [{ id: "A", domain: "root", pos: [20, 50], period: 4, phase: 0, hue: 10, fb: { from: "A", delay: 2, gain: 0.5 } }],
});
/** A at x=10 free-running; B at x=40 taps A, and A taps B: a loop with 5s flight each way. */
const pair = (gA = 0.9, gB = 0.9): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [
    { id: "A", domain: "root", pos: [10, 50], period: 40, phase: 0, hue: 10, fb: { from: "B", delay: 1, gain: gA } },
    { id: "B", domain: "root", pos: [40, 50], period: 40, phase: 0, hue: 200, fb: { from: "A", delay: 1, gain: gB } },
  ],
});
const echoes = (lab: ReturnType<typeof newLab>, id: string, t: number) =>
  emissionsUpTo(lab, t, 1000).filter((e) => e.emitter === id && e.k >= FB_BASE).sort((a, b) => a.launchRoot - b.launchRoot);

test("world: feedback validates (self and mutual cycles allowed) and rejects nonsense", () => {
  assert.deepEqual(validate(selfEcho()), []);
  assert.deepEqual(validate(pair()), []);
  const bad = (f: (w: WorldSpec) => void) => { const w = clone(pair()); f(w); return validate(w).length > 0 || parseWorld(w) === null; };
  assert.ok(bad((w) => { w.emitters[0].fb = { from: "B", delay: 1, gain: 0 }; }));
  assert.ok(bad((w) => { w.emitters[0].fb = { from: "B", delay: 1, gain: 4.5 }; }));
  assert.ok(bad((w) => { w.emitters[0].fb = { from: "B", delay: -1, gain: 1 }; }));
  assert.ok(bad((w) => { w.emitters[0].fb = { from: "ghost", delay: 1, gain: 1 }; }));
  assert.ok(bad((w) => { w.emitters[0].fb = { from: "B", delay: 99, gain: 1 }; }));
  assert.ok(bad((w) => { (w.emitters[0] as unknown as { fb: unknown }).fb = "x"; }));
  assert.ok(parseWorld(pair()) !== null);
});

test("world links: feedback survives encode/decode and old links are unaffected", () => {
  const w = pair(1.234567, 0.5);
  const back = decodeWorld(encodeWorld(w));
  assert.ok(back);
  assert.deepEqual(back?.emitters[0].fb, { from: "B", delay: 1, gain: 1.235 });
  assert.deepEqual(back?.emitters[1].fb, { from: "A", delay: 1, gain: 0.5 });
  const plain = decodeWorld(encodeWorld(defaultWorld()));
  assert.ok(plain && plain.emitters.every((e) => e.fb === undefined));
});

test("lab: a self-echo reappears delay later at gain^n, caused by the pulse before it", () => {
  const lab = newLab(selfEcho());
  assert.equal(hasFeedback(lab), true);
  const es = echoes(lab, "A", 20);
  assert.ok(es.length >= 5);
  // base pulse k=1 launches at t=4; its echoes follow at 6, 8, 10, ...
  const chain = es.filter((e) => e.cause === "A|1" || e.launchRoot < 4.5 + 1e-9 && false);
  assert.equal(chain.length, 1);
  near(chain[0].launchRoot, 6, 1e-9);
  near(chain[0].amp ?? NaN, 0.5, 1e-12);
  const second = es.find((e) => e.cause === `A|${chain[0].k}`);
  assert.ok(second);
  near(second.launchRoot, 8, 1e-9);
  near(second.amp ?? NaN, 0.25, 1e-12);
  // launchOf resolves echo indices
  const L = launchOf(lab, "A", chain[0].k);
  assert.ok(L);
  near(L.launchRoot, 6, 1e-9);
  assert.equal(launchOf(lab, "A", FB_BASE + 99999), null);
});

test("lab: a mutual loop adds flight each way; echoes alternate A, B", () => {
  const lab = newLab(pair());
  const a = echoes(lab, "A", 120), b = echoes(lab, "B", 120);
  assert.ok(a.length > 3 && b.length > 3);
  // seeds at t=40 (both). B hears A's seed after 5s + 1 => 46; A hears B's seed likewise.
  near(b[0].launchRoot, 46, 1e-6);
  near(a[0].launchRoot, 46, 1e-6);
  // the next echo of A comes from B's echo: 46 + 5 + 1 = 52, amplitude 0.9 * 0.9
  near(a[1].launchRoot, 52, 1e-6);
  near(a[1].amp ?? NaN, 0.81, 1e-12);
});

test("cut: removing a pulse removes every echo it caused (the whole lineage) and nothing else", () => {
  const lab = newLab(selfEcho());
  const lineage = (es: ReturnType<typeof echoes>, root: string) => {
    const mine = new Set<string>([root]);
    for (const e of es) if (mine.has(e.cause as string)) mine.add(`${e.emitter}|${e.k}`);
    return es.filter((e) => mine.has(`${e.emitter}|${e.k}`));
  };
  const before = echoes(lab, "A", 60);
  assert.ok(lineage(before, "A|1").length >= 3, "a chain of echoes");
  toggleCut(lab, "A", 1);
  const after = echoes(lab, "A", 60);
  assert.equal(lineage(after, "A|1").length, 0);
  // the pulse after it (k=2) keeps its whole chain, at the same times (indices may shift)
  const t2 = lineage(before, "A|2").map((e) => e.launchRoot);
  assert.ok(t2.length >= 3);
  assert.deepEqual(lineage(after, "A|2").map((e) => e.launchRoot), t2);
  assert.ok(after.length < before.length);
  toggleCut(lab, "A", 1);
  assert.deepEqual(echoes(lab, "A", 60).map((e) => e.launchRoot), before.map((e) => e.launchRoot));
});

test("lab: echoes are heard by the probe at their own arrival times, with causal links in spacetime", () => {
  const lab = newLab(pair());
  lab.t = 70;
  lab.probe = [25, 50];
  const ps = perceived(lab, 10);
  assert.ok(ps.some((p) => p.emission.k >= FB_BASE));
  const st = spacetime(lab, 20);
  const ec = st.lines.filter((l) => l.k >= FB_BASE);
  assert.ok(ec.length > 0);
  for (const l of ec) { assert.ok(l.cause); assert.ok(l.amp > 0 && l.amp <= 1); }
  const c = causalCone(lab, st, "A", 40);
  assert.ok(c);
  // the seed pulse of A caused an echo (at B) that is in view
  assert.ok(c.caused.size >= 1);
});

test("audit: gain tips the loop from damped to runaway at exactly gain^2 = 1", () => {
  for (const [g, verdict] of [[0.7, "damped"], [1, "marginal"], [1.3, "runaway"]] as const) {
    const lab = newLab(pair(g, g));
    const a = feedbackAudit(lab);
    assert.equal(a.verdict, verdict);
    assert.deepEqual(a.worst?.nodes, ["A", "B"]);
    near(a.worst?.minDelay ?? NaN, 12, 1e-6); // 5 + 1 + 5 + 1
    near(a.worst?.rate ?? NaN, Math.log(g * g) / 12, 1e-6);
  }
  const hot = feedbackOf(newLab(pair(1.5, 1.5)));
  assert.equal(hot.result.saturated, true);
  assert.ok(hot.result.peak <= 64);
});

test("audit and cascade agree on a drifting world: scrubbing time changes the snapshot, not the verdict class", () => {
  const w = pair(1.1, 1.1);
  w.domains.push({ id: "d", parent: "root", origin: [25, 50], scale: 1, extent: 8, echoSpeed: 6, rate: 3, shearMin: null, changes: [[50, 0.5]] });
  const lab = newLab(w);
  const early = feedbackAudit(lab).worst?.rate as number;
  lab.t = 100;
  const late = feedbackAudit(lab).worst?.rate as number;
  assert.ok(early > 0 && late > 0);
  assert.notEqual(Math.round(early * 1e4), Math.round(late * 1e4));
});

test("laws: Lawbook loss damps every hop that crosses a domain", () => {
  const w = pair(1, 1);
  w.domains.push({ id: "d", parent: "root", origin: [25, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 1, shearMin: null, changes: [] });
  const lab = newLab(w);
  const base = echoes(lab, "B", 120)[0].amp as number;
  near(base, 1, 1e-12);
  lab.spec.laws = { ...LAWFUL, loss: 0.05 };
  rebuild(lab);
  const lossy = echoes(lab, "B", 120)[0].amp as number;
  near(lossy, Math.exp(-0.05 * 12), 0.02);
  assert.equal(feedbackAudit(lab).verdict, "damped");
});

test("lab edits: add, tune and remove loops; deleting a source drops the tap, not the emitter", () => {
  const lab = newLab();
  assert.equal(hasFeedback(lab), false);
  assert.equal(feedbackOf(lab).result.pulses.length, 0);
  assert.equal(feedbackAudit(lab).verdict, "none");
  assert.ok(addFeedback(lab, "e1", "e1"));
  assert.ok(addFeedback(lab, "e4", "e3"));
  assert.deepEqual(validate(lab.spec), []);
  assert.ok(feedbackOf(lab).result.pulses.length > 0);
  const g0 = lab.spec.emitters.find((e) => e.id === "e1")?.fb?.gain as number;
  for (let i = 0; i < 200; i++) adjustFeedback(lab, "e1", "gain", 1);
  assert.equal(lab.spec.emitters[0].fb?.gain, 4);
  for (let i = 0; i < 200; i++) adjustFeedback(lab, "e1", "gain", -1);
  assert.equal(lab.spec.emitters[0].fb?.gain, 0.05);
  for (let i = 0; i < 80; i++) adjustFeedback(lab, "e1", "delay", 1);
  assert.equal(lab.spec.emitters[0].fb?.delay, 30);
  assert.ok(g0 > 0);
  removeSel(lab, { kind: "emitter", id: "e4" });
  assert.ok(lab.spec.emitters.some((e) => e.id === "e3"));
  assert.equal(lab.spec.emitters.find((e) => e.id === "e3")?.fb, undefined);
  assert.ok(removeFeedback(lab, "e1"));
  assert.equal(removeFeedback(lab, "e1"), false);
  assert.equal(addFeedback(lab, "nope", "e1"), false);
  assert.deepEqual(validate(lab.spec), []);
});

test("zeno loop in the lab: co-located zero-delay amplifier is flagged and the cascade stays capped", () => {
  const w = selfEcho();
  w.emitters[0].fb = { from: "A", delay: 0, gain: 1.05 };
  const lab = newLab(w);
  assert.equal(feedbackAudit(lab).verdict, "zeno");
  const r = feedbackOf(lab).result;
  assert.ok(r.truncated || r.saturated);
  assert.ok(r.pulses.length <= 1500);
});

test("edit storm with loops: always valid, bounded work, link round-trip", () => {
  const lab = newLab();
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    const at: [number, number] = [rnd() * 100, rnd() * 100];
    const r = rnd();
    const ids = lab.spec.emitters.map((e) => e.id);
    const pick = () => ids[Math.floor(rnd() * ids.length)];
    if (r < 0.15) addEmitter(lab, at);
    else if (r < 0.4 && ids.length) addFeedback(lab, pick(), pick(), rnd() * 6, 0.3 + rnd() * 1.5);
    else if (r < 0.5 && ids.length) removeFeedback(lab, pick());
    else if (r < 0.6) addDomain(lab, rnd() < 0.5 ? "fast" : "well", at);
    else if (r < 0.7) { const h = hitTest(lab, at); if (h) moveSel(lab, h, [rnd() * 100, rnd() * 100]); }
    else if (r < 0.78) { const h = hitTest(lab, at); if (h && h.kind !== "probe") removeSel(lab, h); }
    else if (r < 0.86) { const h = hitTest(lab, at); if (h) adjust(lab, h, "rate", 1); }
    else { lab.t = rnd() * 200; const h = hitTest(lab, at); if (h) driftRate(lab, h, rnd() < 0.5 ? 0.5 : 2); }
    assert.deepEqual(validate(lab.spec), [], `invalid after step ${i}`);
    assert.ok(parseWorld(lab.spec) !== null);
    feedbackAudit(lab);
    emissionsUpTo(lab, lab.t, 3);
  }
  assert.ok(Date.now() - t0 < 60000, "stays interactive");
  assert.ok(decodeWorld(encodeWorld(lab.spec)));
});
