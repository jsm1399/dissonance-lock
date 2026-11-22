import { World } from './sim2d.ts';
import type { Vec2 } from '../core/index.ts';

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

const HOLD_TICKS = 30;

export function createSlipstream(): Level {
  const W = 800, H = 560;
  const world = new World({ width: W, height: H });
  world.defineAction('dash', 520);

  const player = world.addBody({ pos: { x: 70, y: 470 }, r: 12, tag: 'player' });
  world.addBody({ pos: { x: 170, y: 300 }, r: 16, mass: 2, tag: 'crate' });
  world.addBody({ pos: { x: 470, y: 205 }, r: 34, mass: 0, tag: 'pillar' });
  world.addBody({ pos: { x: 470, y: 395 }, r: 34, mass: 0, tag: 'pillar' });

  // Glide: plain physics zone (ice + crosswind). No shear rules.
  world.addZone({ id: 'glide', center: { x: 300, y: 300 }, radius: 170,
    fields: { friction: 0.05, gravity: { x: 0, y: 140 } } });

  // Hollow: well fields + Dissonance-Lock rules (dash forbidden).
  const hollow = { x: 640, y: 300 };
  world.addZone({ id: 'hollow', center: hollow, radius: 120,
    fields: { attract: 420, friction: 3.5 },
    shear: { forbid: { dash: 0.3 }, maxLag: 30, echoDelay: 18, echoGain: 0.65, echoCount: 3 } });
  world.addAnchor({ id: 'a1', pos: { x: 640, y: 215 }, radius: 36, power: 0.6 });

  const lv: Level = {
    name: 'Slipstream',
    hint: 'Dash the crate into the Hollow, then reach the exit. The crosswind bends your shot.',
    world, playerId: player.id,
    plate: { pos: hollow, r: 26 },
    exit: { pos: { x: 740, y: 500 }, r: 30 },
    held: 0, plateOn: false, won: false,
    tick() {
      const crate = world.bodies.find(b => b.tag === 'crate')!;
      const d = Math.hypot(crate.pos.x - lv.plate.pos.x, crate.pos.y - lv.plate.pos.y);
      const speed = Math.hypot(crate.vel.x, crate.vel.y);
      lv.held = d < lv.plate.r && speed < 30 ? lv.held + 1 : 0;
      lv.plateOn = lv.held >= HOLD_TICKS;
      const p = world.body(lv.playerId);
      const pd = Math.hypot(p.pos.x - lv.exit.pos.x, p.pos.y - lv.exit.pos.y);
      if (lv.plateOn && pd < lv.exit.r) lv.won = true;
    },
  };
  return lv;
}
