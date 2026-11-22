import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/game/levels.js";
import type { LevelDef } from "../src/game/levels.js";
import { StrataTree } from "../src/core/strata/index.js";
import { newGame, step, probeSpread, TICK, WORLD, MAX_CHARGES } from "../src/game/state.js";
import type { Game, Input } from "../src/game/state.js";

const idle: Input = { dx: 0, dy: 0, anchor: false };
const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
const run = (g: Game, seconds: number, inp: Input = idle) => {
  for (let i = 0; i < Math.round(seconds / TICK) && g.phase === "playing"; i++) step(g, inp);
};

/** one root beacon in a uniform medium (speed 6): analytic arrivals */
const simple = (over: Partial<LevelDef> = {}): LevelDef => ({
  ...LEVELS[0],
  build: () => new StrataTree(2, 6),
  beacons: [{ name: "A", domain: "root", pos: [20, 50], period: 4, phase: 0, hue: 190 }],
  start: [50, 50],
  ...over,
});

test("beacon pulses are heard at emit + distance/speed", () => {
  const g = newGame(simple());
  const heard: number[] = [];
  for (let i = 0; i < 20 * 20; i++) {
    step(g, idle);
    for (const e of g.events) if (e.kind === "heard") heard.push(e.pulse.arrival - e.pulse.emitRoot);
  }
  assert.ok(heard.length >= 2);
  for (const lag of heard) near(lag, 30 / 6, 0.02);
});

test("beacon clocks drift: pulses follow the domain's local time", () => {
  const lvl = simple({
    build: () => {
      const t = new StrataTree(2, 6);
      t.add({ id: "f", parent: "root", origin: [20, 50], scale: 1, extent: 5, echoSpeed: 6, rate: 4 });
      return t;
    },
    beacons: [{ name: "A", domain: "f", pos: [0, 0], period: 8, phase: 0, hue: 10 }],
  });
  const g = newGame(lvl);
  run(g, 9);
  // period 8 local at rate 4 => root period 2
  const roots = g.flight.concat(g.heard).map((p) => p.emitRoot).sort((a, b) => a - b);
  assert.deepEqual(roots.map((r) => Math.round(r * 100) / 100), [2, 4, 6, 8]);
});

test("movement is clamped to the world and normalised", () => {
  const g = newGame(simple());
  run(g, 20, { dx: 5, dy: 5, anchor: false });
  assert.ok(g.pos[0] <= WORLD && g.pos[1] <= WORLD);
  const h = newGame(simple());
  step(h, { dx: 10, dy: 0, anchor: false });
  near(h.pos[0] - 50, 14 * TICK);
});

test("re-anchor: resets dissonance, spends a charge, regenerates", () => {
  const g = newGame(LEVELS[1]);
  g.dissonance = 80;
  step(g, { dx: 0, dy: 0, anchor: true });
  assert.equal(g.dissonance, 0);
  assert.equal(g.charges, MAX_CHARGES - 1);
  assert.equal(g.heard.length, 0);
  step(g, { dx: 0, dy: 0, anchor: true });
  step(g, { dx: 0, dy: 0, anchor: true });
  assert.equal(g.charges, 0);
  g.dissonance = 50;
  step(g, { dx: 0, dy: 0, anchor: true });
  assert.ok(g.dissonance > 0, "no charge => no anchor");
  g.chargeTimer = 1e6;
  step(g, idle);
  assert.equal(g.charges, 1);
});

test("win: lock reaches 100 only while dissonance is inside the band", () => {
  const g = newGame(LEVELS[0]);
  g.dissonance = 40; g.lock = 99.99;
  step(g, idle);
  assert.equal(g.phase, "won");
  const h = newGame(LEVELS[0]);
  h.dissonance = 0; h.lock = 50;
  step(h, idle);
  assert.equal(h.lock, 50, "no lock progress outside the band");
});

test("lose: overload ends the run and freezes state", () => {
  const g = newGame(LEVELS[0]);
  g.pos = [100, 100];
  g.dissonance = 99.99;
  for (let i = 0; i < 400 && g.phase === "playing"; i++) { g.dissonance = Math.max(g.dissonance, 99.99); step(g, idle); }
  assert.equal(g.phase, "lost");
  const t = g.time;
  step(g, idle);
  assert.equal(g.time, t);
});

test("determinism: identical inputs give identical state", () => {
  const a = newGame(LEVELS[2]), b = newGame(LEVELS[2]);
  for (let i = 0; i < 600; i++) {
    const inp = { dx: Math.sin(i / 17), dy: Math.cos(i / 23), anchor: i % 211 === 0 };
    step(a, inp); step(b, inp);
  }
  assert.equal(a.dissonance, b.dissonance);
  assert.equal(a.lock, b.lock);
  assert.deepEqual(a.pos, b.pos);
});

test("invariants hold under random play on every level", () => {
  for (const L of LEVELS) {
    const g = newGame(L);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let prevLock = 0;
    for (let i = 0; i < 20 * 90 && g.phase === "playing"; i++) {
      step(g, { dx: rnd() * 2 - 1, dy: rnd() * 2 - 1, anchor: rnd() < 0.01 });
      assert.ok(g.dissonance >= 0 && g.dissonance <= 100);
      assert.ok(g.lock >= prevLock && g.lock <= 100);
      assert.ok(g.pos[0] >= 0 && g.pos[0] <= WORLD && g.pos[1] >= 0 && g.pos[1] <= WORLD);
      assert.ok(g.charges >= 0 && g.charges <= MAX_CHARGES);
      prevLock = g.lock;
    }
  }
});

test("design: every level has a coherent zone and an overload zone (contour exists)", () => {
  for (const L of LEVELS) {
    const g = newGame(L);
    run(g, 30);
    const pStar = L.decay / L.gain;
    let lo = Infinity, hi = -Infinity;
    for (let x = 10; x <= 90; x += 10) {
      for (let y = 10; y <= 90; y += 10) {
        const p = Math.min(1, probeSpread(g, [x, y]) / L.spreadCap);
        lo = Math.min(lo, p); hi = Math.max(hi, p);
      }
    }
    assert.ok(lo < pStar, `${L.name}: min pressure ${lo.toFixed(2)} must be < ${pStar}`);
    assert.ok(hi > pStar + 0.2, `${L.name}: max pressure ${hi.toFixed(2)} too low`);
  }
});

test("design: a contour-following bot can win every level", () => {
  const dirs: [number, number][] = [[0, 0]];
  for (let i = 0; i < 8; i++) dirs.push([Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  for (const L of LEVELS) {
    const g = newGame(L);
    g.pos = [50, 50];
    const pStar = L.decay / L.gain;
    while (g.phase === "playing" && g.time < 300) {
      const want = Math.min(1, Math.max(0, pStar + 0.006 * (45 - g.dissonance)));
      let best = dirs[0], bs = Infinity;
      for (const d of dirs) {
        const q = [Math.min(100, Math.max(0, g.pos[0] + d[0] * 14 * TICK)), Math.min(100, Math.max(0, g.pos[1] + d[1] * 14 * TICK))];
        const sc = Math.abs(Math.min(1, probeSpread(g, q) / L.spreadCap) - want);
        if (sc < bs) { bs = sc; best = d; }
      }
      step(g, { dx: best[0], dy: best[1], anchor: g.dissonance > 92 && g.charges > 0 });
    }
    assert.equal(g.phase, "won", `${L.name} unwinnable by bot (t=${g.time.toFixed(0)}, lock=${g.lock.toFixed(0)})`);
  }
});
