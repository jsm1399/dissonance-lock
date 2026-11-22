import { StrataTree } from "../core/strata/index.js";
import type { Vec } from "../core/strata/index.js";

export interface BeaconDef {
  name: string;
  domain: string;
  /** position in the beacon's own domain coordinates */
  pos: Vec;
  /** emission period in the beacon's own local time */
  period: number;
  phase: number;
  hue: number;
}

export interface LevelDef {
  id: number;
  /** short HUD tag, e.g. "L1" or "D3" */
  tag: string;
  name: string;
  blurb: string;
  build(): StrataTree;
  beacons: BeaconDef[];
  start: Vec;
  /** dissonance pressure gain / passive decay (per second) */
  gain: number;
  decay: number;
  /** lag spread (seconds) that saturates pressure */
  spreadCap: number;
  /** lock progress per second while dissonance sits inside [bandLo, bandHi] */
  lockRate: number;
  bandLo: number;
  bandHi: number;
  /** seconds a heard pulse counts toward inversions */
  window: number;
  /** order-comparison tolerance, seconds */
  margin: number;
}

export const ROOT_SPEED = 6;

function level1(): StrataTree {
  const t = new StrataTree(2, ROOT_SPEED);
  t.add({
    id: "well", parent: "root", origin: [62, 48], scale: 1, extent: 18, echoSpeed: ROOT_SPEED,
    shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 18),
  });
  return t;
}

function level2(): StrataTree {
  const t = new StrataTree(2, ROOT_SPEED);
  t.add({ id: "fast", parent: "root", origin: [34, 56], scale: 1, extent: 20, echoSpeed: ROOT_SPEED, rate: 3 });
  t.add({
    id: "well", parent: "root", origin: [74, 30], scale: 1, extent: 14, echoSpeed: ROOT_SPEED,
    shear: (p) => 0.25 + 0.75 * Math.min(1, Math.hypot(p[0], p[1]) / 14),
  });
  t.setRate("fast", 30, 2);
  return t;
}

function level3(): StrataTree {
  const t = new StrataTree(2, ROOT_SPEED);
  t.add({ id: "fast", parent: "root", origin: [30, 58], scale: 1, extent: 20, echoSpeed: ROOT_SPEED, rate: 3 });
  t.add({
    id: "well", parent: "root", origin: [72, 34], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
    shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 15),
  });
  t.add({ id: "micro", parent: "fast", origin: [6, -2], scale: 10, extent: 5, echoSpeed: ROOT_SPEED * 10, rate: 2 });
  t.setRate("fast", 25, 1);
  t.setRate("fast", 55, 4);
  return t;
}

function level4(): StrataTree {
  const t = new StrataTree(2, ROOT_SPEED);
  t.add({
    id: "wellA", parent: "root", origin: [28, 30], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
    shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 15),
  });
  t.add({
    id: "wellB", parent: "root", origin: [72, 72], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
    shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 15),
  });
  t.add({ id: "fast", parent: "root", origin: [72, 28], scale: 1, extent: 17, echoSpeed: ROOT_SPEED, rate: 2.5 });
  t.setRate("fast", 20, 3.5);
  t.setRate("fast", 45, 1.5);
  return t;
}

function level5(): StrataTree {
  const t = new StrataTree(2, ROOT_SPEED);
  t.add({
    id: "horizon", parent: "root", origin: [50, 50], scale: 1, extent: 24, echoSpeed: ROOT_SPEED,
    shear: (p) => 0.12 + 0.88 * Math.min(1, Math.hypot(p[0], p[1]) / 24),
  });
  t.add({ id: "pocket", parent: "horizon", origin: [12, 0], scale: 4, extent: 5, echoSpeed: ROOT_SPEED * 4, rate: 5 });
  t.add({ id: "fast", parent: "root", origin: [16, 78], scale: 1, extent: 14, echoSpeed: ROOT_SPEED, rate: 3 });
  t.setRate("fast", 30, 1);
  t.setRate("fast", 60, 4);
  t.setRate("pocket", 40, 2);
  return t;
}

export const LEVELS: LevelDef[] = [
  {
    id: 1, tag: "L1", name: "Quiet Shear",
    blurb: "One time-well bends the echoes. Learn the band.",
    build: level1,
    beacons: [
      { name: "A", domain: "root", pos: [14, 16], period: 3.1, phase: 0, hue: 190 },
      { name: "B", domain: "root", pos: [86, 18], period: 3.7, phase: 0.8, hue: 40 },
      { name: "C", domain: "root", pos: [50, 88], period: 4.3, phase: 1.5, hue: 300 },
    ],
    start: [50, 50],
    gain: 22, decay: 6, spreadCap: 6, lockRate: 2.4, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
  },
  {
    id: 2, tag: "L2", name: "Fast Water",
    blurb: "A fast clock-domain outruns the rest. Its rate drifts.",
    build: level2,
    beacons: [
      { name: "A", domain: "root", pos: [12, 12], period: 3.4, phase: 0, hue: 190 },
      { name: "B", domain: "fast", pos: [-6, 8], period: 9, phase: 2, hue: 40 },
      { name: "C", domain: "well", pos: [6, -4], period: 4.1, phase: 0.5, hue: 300 },
      { name: "D", domain: "root", pos: [88, 88], period: 5.2, phase: 1.2, hue: 130 },
    ],
    start: [50, 50],
    gain: 20, decay: 6, spreadCap: 10, lockRate: 2.6, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
  },
  {
    id: 3, tag: "L3", name: "Deep Strata",
    blurb: "Nested scales, drifting clocks. Hold the lock.",
    build: level3,
    beacons: [
      { name: "A", domain: "root", pos: [10, 10], period: 3.3, phase: 0, hue: 190 },
      { name: "B", domain: "fast", pos: [-8, 6], period: 9, phase: 1, hue: 40 },
      { name: "C", domain: "well", pos: [5, -5], period: 4.0, phase: 0.6, hue: 300 },
      { name: "D", domain: "micro", pos: [0, 0], period: 26, phase: 5, hue: 130 },
      { name: "E", domain: "root", pos: [90, 90], period: 5.0, phase: 2.0, hue: 0 },
    ],
    start: [50, 50],
    gain: 20, decay: 6, spreadCap: 12, lockRate: 2.8, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
  },
  {
    id: 4, tag: "L4", name: "Twin Wells",
    blurb: "Two time-sinks and a drifting fast lane. Echoes tangle.",
    build: level4,
    beacons: [
      { name: "A", domain: "root", pos: [10, 90], period: 3.4, phase: 0, hue: 190 },
      { name: "B", domain: "wellA", pos: [4, 4], period: 4.2, phase: 0.7, hue: 40 },
      { name: "C", domain: "fast", pos: [-5, 6], period: 9, phase: 1.5, hue: 300 },
      { name: "D", domain: "wellB", pos: [-5, -3], period: 4.6, phase: 2.0, hue: 130 },
      { name: "E", domain: "root", pos: [92, 10], period: 5.4, phase: 0.4, hue: 0 },
    ],
    start: [50, 50],
    gain: 22, decay: 6, spreadCap: 7.2, lockRate: 2.8, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
  },
  {
    id: 5, tag: "L5", name: "Event Horizon",
    blurb: "A deep well with a fast pocket inside. Nothing arrives when it should.",
    build: level5,
    beacons: [
      { name: "A", domain: "root", pos: [90, 10], period: 3.2, phase: 0, hue: 190 },
      { name: "B", domain: "horizon", pos: [-10, 8], period: 4.0, phase: 0.8, hue: 40 },
      { name: "C", domain: "pocket", pos: [0, 0], period: 40, phase: 6, hue: 300 },
      { name: "D", domain: "fast", pos: [4, -4], period: 9, phase: 2, hue: 130 },
      { name: "E", domain: "root", pos: [88, 90], period: 4.8, phase: 1.1, hue: 0 },
      { name: "F", domain: "root", pos: [8, 8], period: 5.6, phase: 2.2, hue: 260 },
    ],
    start: [50, 50],
    gain: 24, decay: 6, spreadCap: 16.8, lockRate: 3.0, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
  },
];
