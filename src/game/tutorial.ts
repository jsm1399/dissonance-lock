import type { Game } from "./state.js";

export interface Hint { text: string; sub: string }

export interface Tutor {
  step: number;
  /** game time the current step began */
  since: number;
  startPos: readonly number[];
}

export const newTutor = (g: Game): Tutor => ({ step: 0, since: g.time, startPos: g.pos });

const HINTS: Hint[] = [
  { text: "MOVE to begin", sub: "WASD / arrows / drag. Rings are echoes racing toward you." },
  { text: "Echoes arrive late", sub: "Farther beacons are heard later. Wait for a few to reach you." },
  { text: "Read HEARD ORDER (bottom)", sub: "Numbers = true emission order. A red ring = heard out of order. That mismatch is dissonance." },
  { text: "Move until DISS enters the white box", sub: "Too low: drift toward a corner. Too high: move toward the middle." },
  { text: "Hold it there", sub: "LOCK fills only while DISS stays inside the box." },
  { text: "Press SPACE to RE-ANCHOR", sub: "It resets dissonance. You have 2 charges; they recharge slowly." },
  { text: "Fill the LOCK", sub: "Keep DISS in the box. If it nears overload, re-anchor." },
];

export const TUTOR_STEPS = HINTS.length;

/** Advance the tutorial state machine from observable game state. Pure given (t, g). */
export function advanceTutor(t: Tutor, g: Game): void {
  const inBand = g.dissonance >= g.level.bandLo && g.dissonance <= g.level.bandHi;
  const elapsed = g.time - t.since;
  let done = false;
  switch (t.step) {
    case 0:
      done = Math.hypot(g.pos[0] - t.startPos[0], g.pos[1] - t.startPos[1]) >= 8;
      break;
    case 1:
      done = g.heardTotal >= 3;
      break;
    case 2:
      done = g.dissonance >= 6 || elapsed >= 14;
      break;
    case 3:
      done = inBand;
      break;
    case 4:
      done = g.lock >= 35;
      break;
    case 5:
      done = g.anchors >= 1;
      break;
    default:
      break;
  }
  if (done && t.step < HINTS.length - 1) { t.step++; t.since = g.time; }
}

export const hintFor = (t: Tutor): Hint => HINTS[Math.min(t.step, HINTS.length - 1)];
export const tutorProgress = (t: Tutor): number => (t.step + 1) / HINTS.length;
