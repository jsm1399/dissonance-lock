import test from "node:test";
import assert from "node:assert/strict";
import { StrataTree, analyzeFeedback, march, runFeedback, FB_BASE } from "../src/core/strata/index.js";
import type { FbEdge, FbNode, FbSeed } from "../src/core/strata/index.js";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const root = (id: string, x: number, y = 50): FbNode => ({ id, site: { domain: "root", pos: [x, y] } });
const seed = (node: string, t: number, key = `${node}|1`): FbSeed => ({ node, key, launchLocal: t, launchRoot: t });

test("engine: a self-echo repeats every flight+delay with amplitude gain^n", () => {
  const tree = new StrataTree(2, 6);
  const r = runFeedback(tree, [root("A", 20)], [{ from: "A", to: "A", delay: 2, gain: 0.5 }], [seed("A", 10)], { horizon: 100 });
  assert.equal(r.injected, 1);
  assert.ok(r.pulses.length >= 4);
  r.pulses.forEach((p, i) => {
    near(p.launchRoot, 10 + 2 * (i + 1), 1e-9); // co-located: no flight
    near(p.amp, Math.pow(0.5, i + 1), 1e-12);
    assert.equal(p.gen, i + 1);
    assert.equal(p.k, FB_BASE + i + 1);
    assert.equal(p.cause, i === 0 ? "A|1" : `A|${FB_BASE + i}`);
  });
  assert.equal(r.saturated, false);
  assert.ok(r.faded >= 1, "echoes below the floor fade out of the world");
});

test("engine: a two-node loop adds flight in both directions", () => {
  const tree = new StrataTree(2, 5);
  const nodes = [root("A", 10), root("B", 60)]; // 50 apart => 10s of flight each way
  const edges: FbEdge[] = [{ from: "A", to: "B", delay: 1, gain: 0.9 }, { from: "B", to: "A", delay: 3, gain: 0.8 }];
  const r = runFeedback(tree, nodes, edges, [seed("A", 0)], { horizon: 200 });
  const t = r.pulses.map((p) => [p.node, p.launchRoot, p.amp]) as [string, number, number][];
  assert.deepEqual(t.slice(0, 4).map((x) => x[0]), ["B", "A", "B", "A"]);
  near(t[0][1], 0 + 10 + 1, 1e-6);
  near(t[1][1], 11 + 10 + 3, 1e-6);
  near(t[2][1], 24 + 11, 1e-6);
  near(t[1][2], 0.9 * 0.8, 1e-12);
});

test("engine: the heap interleaves seeds and echoes in time order", () => {
  const tree = new StrataTree(2, 6);
  const edges: FbEdge[] = [{ from: "A", to: "A", delay: 1, gain: 0.6 }];
  const r = runFeedback(tree, [root("A", 20)], edges, [seed("A", 0.5, "A|1"), seed("A", 1.2, "A|2")], { horizon: 20 });
  for (let i = 1; i < r.pulses.length; i++) assert.ok(r.pulses[i].launchRoot >= r.pulses[i - 1].launchRoot);
  const first = r.pulses.filter((p) => p.cause === "A|1" || p.cause === "A|2");
  assert.equal(first.length, 2);
  assert.equal(r.injected, 2);
});

test("analysis: closed-form growth rate of a self-loop is ln(gain)/period", () => {
  const tree = new StrataTree(2, 6);
  const n = [root("A", 20)];
  for (const [g, want] of [[1.5, Math.log(1.5) / 2], [0.5, Math.log(0.5) / 2], [1, 0]] as const) {
    const a = analyzeFeedback(tree, n, [{ from: "A", to: "A", delay: 2, gain: g }], 10);
    assert.ok(a.worst);
    near(a.worst.rate, want, 1e-9);
    assert.equal(a.worst.verdict, g > 1 ? "runaway" : g < 1 ? "damped" : "marginal");
    near(a.worst.minDelay, 2, 1e-9);
    assert.deepEqual(a.worst.path, ["A", "A"]);
  }
});

test("analysis: two-node loop growth = ln(g1 g2)/(round-trip time), and it matches the simulation", () => {
  const tree = new StrataTree(2, 5);
  const nodes = [root("A", 10), root("B", 60)];
  const edges: FbEdge[] = [{ from: "A", to: "B", delay: 1, gain: 1.3 }, { from: "B", to: "A", delay: 3, gain: 1.1 }];
  const a = analyzeFeedback(tree, nodes, edges, 0);
  const trip = 10 + 1 + 10 + 3;
  near(a.worst?.rate ?? NaN, Math.log(1.3 * 1.1) / trip, 1e-6);
  near(a.worst?.gain ?? NaN, Math.sqrt(1.3 * 1.1), 1e-6);
  assert.equal(a.verdict, "runaway");
  // simulation: amplitude of every second echo of A grows by g1 g2 per trip
  const r = runFeedback(tree, nodes, edges, [seed("A", 0)], { horizon: 200, ampMax: 1e9 });
  const as = r.pulses.filter((p) => p.node === "A");
  assert.ok(as.length >= 4);
  const slope = Math.log(as[3].amp / as[1].amp) / (as[3].launchRoot - as[1].launchRoot);
  near(slope, a.worst?.rate ?? NaN, 1e-6);
});

test("analysis: unequal loops in one component, rate is the Malthusian root (checked against the cascade)", () => {
  const tree = new StrataTree(2, 5);
  const nodes = [root("A", 10), root("B", 35), root("C", 60)];
  const edges: FbEdge[] = [
    { from: "A", to: "B", delay: 0.5, gain: 1.2 }, { from: "B", to: "C", delay: 0.5, gain: 1.2 },
    { from: "C", to: "A", delay: 0.5, gain: 1.2 }, { from: "B", to: "A", delay: 0.5, gain: 0.7 },
  ];
  const a = analyzeFeedback(tree, nodes, edges, 0);
  const s = a.worst?.rate as number;
  assert.ok(s > 0);
  const r = runFeedback(tree, nodes, edges, [seed("A", 0)], { horizon: 120, ampMax: 1e12, ampMin: 1e-12, maxPulses: 200000 });
  assert.equal(r.truncated, false);
  const win = (lo: number, hi: number) => r.pulses.filter((p) => p.launchRoot >= lo && p.launchRoot < hi).reduce((x, p) => x + p.amp, 0);
  const g = Math.log(win(90, 120) / win(60, 90)) / 30;
  near(g, s, 0.015);
  assert.equal(a.verdict, "runaway");
  assert.deepEqual(a.worst?.nodes, ["A", "B", "C"]);
  assert.deepEqual(a.worst?.path, ["A", "B", "A"]); // shortest loop through A
});

test("analysis: a damped loop that fans out can still create energy (amplifier flag)", () => {
  const tree = new StrataTree(2, 6);
  const nodes = [root("S", 10), root("A", 40), root("B", 70)];
  const edges: FbEdge[] = [{ from: "S", to: "A", delay: 1, gain: 0.7 }, { from: "S", to: "B", delay: 1, gain: 0.7 }];
  const a = analyzeFeedback(tree, nodes, edges, 0);
  assert.equal(a.verdict, "none"); // no cycle
  assert.equal(a.amplifier, true); // but 0.7 + 0.7 > 1: it splits one pulse into 1.4 pulses of energy
  const calm = analyzeFeedback(tree, nodes, [{ from: "S", to: "A", delay: 1, gain: 0.7 }, { from: "S", to: "B", delay: 1, gain: 0.3 }], 0);
  assert.equal(calm.amplifier, false);
});

test("engine: runaway gain saturates and stays bounded", () => {
  const tree = new StrataTree(2, 6);
  const r = runFeedback(tree, [root("A", 20)], [{ from: "A", to: "A", delay: 1, gain: 2 }], [seed("A", 0)], { horizon: 200 });
  assert.equal(r.saturated, true);
  assert.ok(r.peak <= 64);
  assert.ok(r.pulses.length < 20);
});

test("zeno: a co-located zero-delay loop is flagged and the engine terminates", () => {
  const tree = new StrataTree(2, 6);
  const edge: FbEdge[] = [{ from: "A", to: "A", delay: 0, gain: 1.01 }];
  const a = analyzeFeedback(tree, [root("A", 20)], edge, 0);
  assert.equal(a.verdict, "zeno");
  const r = runFeedback(tree, [root("A", 20)], edge, [seed("A", 5)], { horizon: 100, ampMax: 1e12, maxPulses: 300 });
  assert.equal(r.truncated, true);
  assert.equal(r.pulses.length, 300);
  const damp = analyzeFeedback(tree, [root("A", 20)], [{ from: "A", to: "A", delay: 0, gain: 0.5 }], 0);
  assert.equal(damp.verdict, "damped");
});

test("loss: path absorption multiplies every hop through a domain", () => {
  const tree = new StrataTree(2, 5);
  tree.add({ id: "d", parent: "root", origin: [35, 50], scale: 1, extent: 10, echoSpeed: 5 });
  const nodes = [root("A", 10), root("B", 60)];
  const edges: FbEdge[] = [{ from: "A", to: "B", delay: 0, gain: 1 }];
  const r = runFeedback(tree, nodes, edges, [seed("A", 0)], { horizon: 100, loss: 0.05, march: { maxStep: 0.25 } });
  near(r.pulses[0].amp, Math.exp(-0.05 * 20), 0.01); // 20 units of chord inside d
  const a = analyzeFeedback(tree, nodes, [...edges, { from: "B", to: "A", delay: 0, gain: 1.5 }], 0, 0.05, { maxStep: 0.25 });
  near(a.worst?.gain as number, Math.sqrt(1.5 * Math.exp(-0.05 * 40)), 0.01);
});

test("clocks: the echo delay runs on the re-emitter's own clock", () => {
  const tree = new StrataTree(2, 6);
  tree.add({ id: "f", parent: "root", origin: [60, 50], scale: 1, extent: 5, echoSpeed: 6, rate: 4 });
  const nodes: FbNode[] = [root("A", 20), { id: "B", site: { domain: "f", pos: [0, 0] } }];
  const mo = { maxStep: 0.25 };
  const r = runFeedback(tree, nodes, [{ from: "A", to: "B", delay: 2, gain: 0.9 }], [seed("A", 0)], { horizon: 100, march: mo });
  const arr = march(tree, nodes[0].site, 0, nodes[1].site, mo).rootTime;
  near(r.pulses[0].launchRoot, arr + 0.5, 1e-9); // 2 local seconds at rate 4 = 0.5 root seconds
  near(r.pulses[0].launchLocal, tree.toLocalTime("f", arr) + 2, 1e-9);
});

test("determinism: identical graphs give identical echo histories", () => {
  const tree = new StrataTree(2, 6);
  const nodes = [root("A", 10), root("B", 70), root("C", 40, 10)];
  const edges: FbEdge[] = [
    { from: "A", to: "B", delay: 1, gain: 0.8 }, { from: "B", to: "C", delay: 1, gain: 0.8 }, { from: "C", to: "A", delay: 1, gain: 0.95 },
  ];
  const seeds = [seed("A", 0), seed("B", 3.3, "B|1")];
  const x = JSON.stringify(runFeedback(tree, nodes, edges, seeds, { horizon: 150 }));
  const y = JSON.stringify(runFeedback(tree, nodes, edges, seeds, { horizon: 150 }));
  assert.equal(x, y);
});
