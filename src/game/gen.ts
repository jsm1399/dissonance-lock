import { StrataTree } from "../core/strata/index.js";
import type { Vec } from "../core/strata/index.js";
import { ROOT_SPEED } from "./levels.js";
import type { BeaconDef, LevelDef } from "./levels.js";
import { newGame, probeSpread, step } from "./state.js";
import type { Input } from "./state.js";
import { hashSeed, rng } from "./rng.js";

interface DomSpec {
  id: string;
  parent: string;
  origin: Vec;
  scale: number;
  extent: number;
  echoSpeed: number;
  rate: number;
  shearMin?: number;
  changes: [number, number][];
}

const IDLE: Input = { dx: 0, dy: 0, anchor: false };

/** Spread range (seconds) over a 9x9 probe grid, at several moments of a stationary run. */
export function calibrate(level: LevelDef, times: number[] = [30, 60]): { min: number; max: number } {
  // neutral copy so the idle run can neither win nor lose
  const g = newGame({ ...level, gain: 0, decay: 0, lockRate: 0 });
  g.pos = [50, 50];
  let min = Infinity, max = 0;
  for (const t of times) {
    for (let i = 0; g.time < t && i < 100000; i++) step(g, IDLE);
    for (let x = 10; x <= 90; x += 10) {
      for (let y = 10; y <= 90; y += 10) {
        const s = probeSpread(g, [x, y]);
        min = Math.min(min, s);
        max = Math.max(max, s);
      }
    }
  }
  return { min, max };
}

function candidate(seed: number, depth: number, attempt: number): LevelDef {
  const r = rng(hashSeed(seed, depth, attempt));
  const U = (a: number, b: number) => a + (b - a) * r();
  const doms: DomSpec[] = [];
  const placed: { c: Vec; r: number }[] = [];
  const free = (c: Vec, rad: number) => placed.every((p) => Math.hypot(p.c[0] - c[0], p.c[1] - c[1]) > p.r + rad + 3);
  const place = (rad: number): Vec | null => {
    for (let k = 0; k < 60; k++) {
      const c: Vec = [U(rad + 4, 96 - rad), U(rad + 4, 96 - rad)];
      if (free(c, rad)) { placed.push({ c, r: rad }); return c; }
    }
    return null;
  };

  const wells = depth >= 6 ? 2 : 1;
  for (let i = 0; i < wells; i++) {
    const rad = U(12, 18), c = place(rad);
    if (c) doms.push({ id: `well${i}`, parent: "root", origin: c, scale: 1, extent: rad, echoSpeed: ROOT_SPEED, rate: 1, shearMin: U(0.12, 0.3), changes: [] });
  }
  let fast: DomSpec | null = null;
  if (depth >= 2) {
    const rad = U(14, 22), c = place(rad);
    if (c) {
      const changes: [number, number][] = [[U(18, 35), U(1, 4)]];
      if (depth >= 4) changes.push([U(45, 70), U(1, 4.5)]);
      fast = { id: "fast", parent: "root", origin: c, scale: 1, extent: rad, echoSpeed: ROOT_SPEED, rate: U(2, 3.5), changes };
      doms.push(fast);
    }
  }
  let micro: DomSpec | null = null;
  if (depth >= 4 && fast) {
    const ang = U(0, Math.PI * 2), d = U(0.1, 0.5) * fast.extent;
    micro = {
      id: "micro", parent: "fast", origin: [Math.cos(ang) * d, Math.sin(ang) * d], scale: 10, extent: U(3, 5),
      echoSpeed: ROOT_SPEED * 10, rate: U(1.5, 3), changes: [[U(40, 60), U(1, 3)]],
    };
    doms.push(micro);
  }

  const build = (): StrataTree => {
    const t = new StrataTree(2, ROOT_SPEED);
    for (const d of doms) {
      const radLocal = d.extent * d.scale;
      t.add({
        id: d.id, parent: d.parent, origin: d.origin, scale: d.scale, extent: d.extent, echoSpeed: d.echoSpeed,
        rate: d.rate,
        shear: d.shearMin === undefined ? undefined
          : (p) => d.shearMin! + (1 - d.shearMin!) * Math.min(1, Math.hypot(p[0], p[1]) / radLocal),
      });
    }
    for (const d of doms) for (const [tm, rt] of d.changes) t.setRate(d.id, tm, rt);
    return t;
  };

  // beacons: a spread of root beacons plus some living inside domains
  const n = Math.min(6, 3 + Math.floor(depth / 2));
  const beacons: BeaconDef[] = [];
  const rootPts: Vec[] = [];
  const inDom = doms.filter((d) => d.id !== "micro" || depth >= 4);
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i * 360) / n + 190) % 360;
    const rootPeriod = U(3, 5.5);
    const host = i % 2 === 1 && inDom.length ? inDom[Math.floor(r() * inDom.length)] : null;
    if (host) {
      const ang = U(0, Math.PI * 2), rad = U(0.15, 0.65) * host.extent * host.scale;
      const parentRate = host.id === "micro" && fast ? fast.rate : 1;
      const period = rootPeriod * host.rate * parentRate;
      beacons.push({
        name: String.fromCharCode(65 + i), domain: host.id, pos: [Math.cos(ang) * rad, Math.sin(ang) * rad],
        period, phase: U(0, period), hue,
      });
    } else {
      let p: Vec = [U(8, 92), U(8, 92)];
      for (let k = 0; k < 40 && !rootPts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 22); k++) p = [U(8, 92), U(8, 92)];
      rootPts.push(p);
      beacons.push({ name: String.fromCharCode(65 + i), domain: "root", pos: p, period: rootPeriod, phase: U(0, rootPeriod), hue });
    }
  }

  const gain = 20 + Math.min(8, depth);
  const decay = 6;
  return {
    id: 100 + depth, tag: `D${depth}`, name: `Drift ${depth}`, blurb: `seed ${seed}`,
    build, beacons, start: [50, 50],
    gain, decay, spreadCap: 10, lockRate: 2.6 + Math.min(0.6, depth * 0.05),
    bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
  };
}

/** Deterministic, calibrated, contour-guaranteed level for (seed, depth). */
export function generateLevel(seed: number, depth: number): LevelDef {
  let fallback: LevelDef | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const lvl = candidate(seed, depth, attempt);
    const pS = lvl.decay / lvl.gain;
    const { min, max } = calibrate(lvl);
    const cap = Math.max(4, Math.max(min, 0.3) / (0.6 * pS));
    lvl.spreadCap = Math.round(cap * 10) / 10;
    fallback = lvl;
    if (max / lvl.spreadCap >= pS + 0.22) return lvl;
  }
  return fallback as LevelDef;
}
