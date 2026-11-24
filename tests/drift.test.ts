import test from "node:test";
import assert from "node:assert/strict";
import { hashSeed, rng } from "../src/game/rng.js";
import { generateLevel } from "../src/game/gen.js";
import { LEVELS, beaconPos } from "../src/game/levels.js";
import { emptySave, parseSave, dailyKey, dailySeed } from "../src/game/save.js";
import { newGame, stars, WORLD } from "../src/game/state.js";

test("rng: deterministic, uniform-ish, in [0,1)", () => {
  const a = rng(42), b = rng(42);
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.05);
  assert.notEqual(rng(1)(), rng(2)());
  assert.equal(hashSeed("daily", "2026-11-22"), hashSeed("daily", "2026-11-22"));
  assert.notEqual(hashSeed("daily", "2026-11-22"), hashSeed("daily", "2026-11-23"));
});

test("generateLevel: deterministic per (seed, depth), different across seeds", () => {
  const a = generateLevel(777, 4), b = generateLevel(777, 4), c = generateLevel(778, 4);
  assert.deepEqual(a.beacons, b.beacons);
  assert.equal(a.spreadCap, b.spreadCap);
  assert.notDeepEqual(a.beacons, c.beacons);
  assert.equal(a.tag, "D4");
});

test("generateLevel: valid worlds across seeds and depths", () => {
  for (const seed of [1, 99, 20261122]) {
    for (let depth = 1; depth <= 9; depth += 2) {
      const L = generateLevel(seed, depth);
      const tree = L.build();
      assert.equal(L.beacons.length, Math.min(6, 3 + Math.floor(depth / 2)));
      assert.ok(L.spreadCap >= 4);
      for (const d of tree.domains()) {
        assert.ok(d.centerRoot[0] >= 0 && d.centerRoot[0] <= WORLD && d.centerRoot[1] >= 0 && d.centerRoot[1] <= WORLD);
      }
      for (const b of L.beacons) {
        const p = tree.toRootPos(b.domain, beaconPos(L, b));
        assert.ok(p[0] >= -1 && p[0] <= WORLD + 1 && p[1] >= -1 && p[1] <= WORLD + 1, `${b.name} outside world`);
        assert.ok(b.period > 0);
      }
      const g = newGame(L);
      assert.equal(g.phase, "playing");
    }
  }
});

test("save: tolerant parsing and clamping", () => {
  const n = LEVELS.length;
  assert.deepEqual(parseSave(null, n), emptySave(n));
  assert.deepEqual(parseSave("not json", n), emptySave(n));
  assert.deepEqual(parseSave("42", n), emptySave(n));
  const s = parseSave(JSON.stringify({ best: [61.5, "x"], stars: [9, -3], driftBest: 4, daily: { key: "2026-11-22", depth: 3 } }), n);
  assert.equal(s.best.length, n);
  assert.equal(s.best[0], 61.5);
  assert.equal(s.best[1], null);
  assert.equal(s.stars[0], 3);
  assert.equal(s.stars[1], 0);
  assert.equal(s.driftBest, 4);
  assert.deepEqual(s.daily, { key: "2026-11-22", depth: 3 });
});

test("daily key/seed: UTC date string, stable seed", () => {
  assert.equal(dailyKey(new Date("2026-11-22T23:59:59Z")), "2026-11-22");
  assert.equal(dailySeed("2026-11-22"), dailySeed("2026-11-22"));
});

test("stars: faster and anchor-free is better", () => {
  const g = newGame(LEVELS[0]);
  const minT = 100 / g.level.lockRate;
  g.time = minT * 1.2; g.anchors = 0;
  assert.equal(stars(g), 3);
  g.anchors = 1;
  assert.equal(stars(g), 2);
  g.time = minT * 3;
  assert.equal(stars(g), 1);
});
