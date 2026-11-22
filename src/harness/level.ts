import type { Vec2 } from '../core/index.ts';
import type { World } from './sim2d.ts';

/** Puzzle harness: win-state logic only. Lives outside the core on purpose. */
export interface Level {
  name: string;
  hint: string;
  world: World;
  playerId: number;
  plate: { pos: Vec2; r: number };
  exit: { pos: Vec2; r: number };
  held: number;
  plateOn: boolean;
  won: boolean;
  /** call once per world.step() */
  tick(): void;
}

export const HOLD_TICKS = 30;

export interface LevelInit {
  name: string; hint: string; world: World; playerId: number;
  plate: { pos: Vec2; r: number }; exit: { pos: Vec2; r: number };
}

/** Standard win rule: park the 'crate' on the plate (slow, held 30 ticks), then reach the exit. */
export function makeLevel(init: LevelInit): Level {
  const lv: Level = {
    ...init, held: 0, plateOn: false, won: false,
    tick() {
      const crate = init.world.bodies.find(b => b.tag === 'crate')!;
      const d = Math.hypot(crate.pos.x - lv.plate.pos.x, crate.pos.y - lv.plate.pos.y);
      const speed = Math.hypot(crate.vel.x, crate.vel.y);
      lv.held = d < lv.plate.r && speed < 30 ? lv.held + 1 : 0;
      lv.plateOn = lv.held >= HOLD_TICKS;
      const p = init.world.body(lv.playerId);
      const pd = Math.hypot(p.pos.x - lv.exit.pos.x, p.pos.y - lv.exit.pos.y);
      if (lv.plateOn && pd < lv.exit.r) lv.won = true;
    },
  };
  return lv;
}
