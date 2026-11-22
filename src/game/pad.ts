export interface PadLike {
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

export interface PadState {
  dx: number;
  dy: number;
  /** A / cross */
  confirm: boolean;
  /** B / circle */
  back: boolean;
  /** Start */
  pause: boolean;
  up: boolean;
  down: boolean;
}

const DEAD = 0.22;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : v);

/** Map a standard-layout gamepad to game controls (stick + d-pad, A/B/Start). */
export function readPad(p: PadLike | null | undefined): PadState {
  const none: PadState = { dx: 0, dy: 0, confirm: false, back: false, pause: false, up: false, down: false };
  if (!p) return none;
  const b = (i: number) => !!p.buttons[i]?.pressed;
  let dx = dz(p.axes[0] ?? 0);
  let dy = dz(p.axes[1] ?? 0);
  if (b(14)) dx -= 1;
  if (b(15)) dx += 1;
  if (b(12)) dy -= 1;
  if (b(13)) dy += 1;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  return {
    dx, dy, confirm: b(0), back: b(1), pause: b(9),
    up: b(12) || (p.axes[1] ?? 0) < -0.6, down: b(13) || (p.axes[1] ?? 0) > 0.6,
  };
}
