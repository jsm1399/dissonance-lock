import { World } from './sim2d.ts';
import { makeLevel, type Level } from './level.ts';

export type { Level } from './level.ts';

export function createSlipstream(): Level {
  const world = new World({ width: 800, height: 560 });
  world.defineAction('dash', 520);

  const player = world.addBody({ pos: { x: 70, y: 470 }, r: 12, tag: 'player' });
  world.addBody({ pos: { x: 170, y: 300 }, r: 16, mass: 2, tag: 'crate' });
  world.addBody({ pos: { x: 470, y: 205 }, r: 34, mass: 0, tag: 'pillar' });
  world.addBody({ pos: { x: 470, y: 395 }, r: 34, mass: 0, tag: 'pillar' });

  world.addZone({ id: 'glide', center: { x: 300, y: 300 }, radius: 170,
    fields: { friction: 0.05, gravity: { x: 0, y: 140 } } });

  const hollow = { x: 640, y: 300 };
  world.addZone({ id: 'hollow', center: hollow, radius: 120,
    fields: { attract: 420, friction: 3.5 },
    shear: { forbid: { dash: 0.3 }, maxLag: 30, echoDelay: 18, echoGain: 0.65, echoCount: 3 } });
  world.addAnchor({ id: 'a1', pos: { x: 640, y: 215 }, radius: 36, power: 0.6 });

  return makeLevel({
    name: 'Slipstream',
    hint: 'Dash the crate into the Hollow, then reach the exit. The crosswind bends your shot.',
    world, playerId: player.id,
    plate: { pos: hollow, r: 26 }, exit: { pos: { x: 740, y: 500 }, r: 30 },
  });
}
