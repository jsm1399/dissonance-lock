import { march, countInversions, lagSpread, vdist } from "../core/strata/index.js";
import type { MarchOptions, Site, Vec } from "../core/strata/index.js";
import type { LevelDef } from "./levels.js";
import type { StrataTree } from "../core/strata/index.js";

export const WORLD = 100;
export const TICK = 0.05;
export const SPEED = 14;
export const MAX_CHARGES = 2;
export const CHARGE_REGEN = 14;
export const MARCH: MarchOptions = { maxStep: 1 };
const REPATH = 0.4;

export interface Pulse {
  id: number;
  beacon: number;
  emitLocal: number;
  emitRoot: number;
  arrival: number;
  calc: Vec | null;
  perceivedAt: number | null;
}

export type Phase = "playing" | "won" | "lost";
export type GameEvent =
  | { kind: "heard"; pulse: Pulse }
  | { kind: "anchor" }
  | { kind: "won" }
  | { kind: "lost" };

export interface Input { dx: number; dy: number; anchor: boolean }

export interface Game {
  level: LevelDef;
  tree: StrataTree;
  time: number;
  pos: Vec;
  phase: Phase;
  dissonance: number;
  lock: number;
  charges: number;
  chargeTimer: number;
  flight: Pulse[];
  heard: Pulse[];
  nextK: number[];
  nextId: number;
  inversions: number;
  spread: number;
  pressure: number;
  anchors: number;
  peak: number;
  events: GameEvent[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function newGame(level: LevelDef): Game {
  return {
    level, tree: level.build(), time: 0, pos: level.start.slice(), phase: "playing",
    dissonance: 0, lock: 0, charges: MAX_CHARGES, chargeTimer: 0,
    flight: [], heard: [], nextK: level.beacons.map(() => 1), nextId: 0,
    inversions: 0, spread: 0, pressure: 0, anchors: 0, peak: 0, events: [],
  };
}

export function step(g: Game, input: Input): void {
  g.events.length = 0;
  if (g.phase !== "playing") return;
  const L = g.level;

  // movement (root frame)
  let dx = input.dx, dy = input.dy;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  g.pos = [clamp(g.pos[0] + dx * SPEED * TICK, 0, WORLD), clamp(g.pos[1] + dy * SPEED * TICK, 0, WORLD)];
  g.time += TICK;

  // beacons emit on their own (possibly drifting) clocks
  for (let i = 0; i < L.beacons.length; i++) {
    const b = L.beacons[i];
    for (;;) {
      const emitLocal = b.phase + g.nextK[i] * b.period;
      const emitRoot = g.tree.toRootTime(b.domain, emitLocal);
      if (emitRoot > g.time) break;
      g.flight.push({ id: g.nextId++, beacon: i, emitLocal, emitRoot, arrival: NaN, calc: null, perceivedAt: null });
      g.nextK[i]++;
    }
  }

  // wavefront arrival at the player
  const site: Site = { domain: "root", pos: g.pos };
  const still: Pulse[] = [];
  for (const p of g.flight) {
    if (p.calc === null || vdist(p.calc, g.pos) > REPATH) {
      const b = L.beacons[p.beacon];
      p.arrival = march(g.tree, { domain: b.domain, pos: b.pos }, p.emitLocal, site, MARCH).rootTime;
      p.calc = g.pos;
    }
    if (p.arrival <= g.time) {
      p.perceivedAt = Math.max(p.arrival, p.emitRoot);
      g.heard.push(p);
      g.events.push({ kind: "heard", pulse: p });
    } else still.push(p);
  }
  g.flight = still;
  g.heard = g.heard.filter((p) => (p.perceivedAt as number) >= g.time - L.window);

  // dissonance: how scrambled the perceived timeline is
  g.inversions = countInversions(
    g.heard.map((p) => ({ emitRoot: p.emitRoot, perceivedAt: p.perceivedAt as number })), L.margin,
  );
  const latest = new Map<number, Pulse>();
  for (const p of g.heard) {
    const q = latest.get(p.beacon);
    if (!q || (p.perceivedAt as number) > (q.perceivedAt as number)) latest.set(p.beacon, p);
  }
  g.spread = lagSpread([...latest.values()].map((p) => (p.perceivedAt as number) - p.emitRoot));
  g.pressure = Math.min(1, g.spread / L.spreadCap);

  if (input.anchor && g.charges >= 1) {
    g.charges -= 1;
    g.anchors += 1;
    g.dissonance = 0;
    g.heard = [];
    g.inversions = 0;
    g.spread = 0;
    g.pressure = 0;
    g.events.push({ kind: "anchor" });
  } else {
    g.dissonance = clamp(g.dissonance + (L.gain * g.pressure - L.decay) * TICK, 0, 100);
  }
  g.peak = Math.max(g.peak, g.dissonance);

  if (g.charges < MAX_CHARGES) {
    g.chargeTimer += TICK;
    if (g.chargeTimer >= CHARGE_REGEN) { g.charges += 1; g.chargeTimer = 0; }
  } else g.chargeTimer = 0;

  // lock builds only while dissonance rides inside the resonant band
  if (g.dissonance >= L.bandLo && g.dissonance <= L.bandHi) g.lock = Math.min(100, g.lock + L.lockRate * TICK);

  if (g.lock >= 100) { g.phase = "won"; g.events.push({ kind: "won" }); }
  else if (g.dissonance >= 100) { g.phase = "lost"; g.events.push({ kind: "lost" }); }
}

/** Lag spread a stationary player at `pos` would currently measure (latest pulse per beacon). Used by bots/tests. */
export function probeSpread(g: Game, pos: Vec): number {
  const L = g.level;
  const lags: number[] = [];
  for (let i = 0; i < L.beacons.length; i++) {
    const k = g.nextK[i] - 1;
    if (k < 1) continue;
    const b = L.beacons[i];
    const emitLocal = b.phase + k * b.period;
    const a = march(g.tree, { domain: b.domain, pos: b.pos }, emitLocal, { domain: "root", pos }, MARCH);
    lags.push(a.rootTime - g.tree.toRootTime(b.domain, emitLocal));
  }
  return lagSpread(lags);
}
