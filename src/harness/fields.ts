import type { Vec2 } from '../core/index.ts';

/** Standard 2D force fields. Harness-only: the Dissonance-Lock core knows nothing about these. */
export interface FieldRules {
  gravity?: Vec2;    // px/s^2, stacks across zones
  attract?: number;  // spring pull to zone center (px/s^2 at the rim), stacks
  friction?: number; // damping/s; overrides world drag, smallest zone wins
}

export interface FieldZone { center: Vec2; radius: number; fields: FieldRules }

export function fieldsAt(zones: FieldZone[], p: Vec2, drag: number, gravity?: Vec2): { gx: number; gy: number; friction: number } {
  let gx = gravity?.x ?? 0, gy = gravity?.y ?? 0, friction = drag, smallest = Infinity;
  for (const z of zones) {
    const d = Math.hypot(z.center.x - p.x, z.center.y - p.y);
    if (d > z.radius) continue;
    const f = z.fields;
    if (f.gravity) { gx += f.gravity.x; gy += f.gravity.y; }
    if (f.attract && d > 0) {
      const k = (f.attract * (d / z.radius)) / d;
      gx += (z.center.x - p.x) * k; gy += (z.center.y - p.y) * k;
    }
    if (f.friction !== undefined && z.radius < smallest) { friction = f.friction; smallest = z.radius; }
  }
  return { gx, gy, friction };
}
