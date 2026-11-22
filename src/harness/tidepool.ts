import { World } from './sim2d.ts';
import { makeLevel, type Level } from './level.ts';

/**
 * Level 2. A wall splits the arena; the crate is out of reach. Dashing inside the Tidepool breaks its
 * rules: the echo travels as a slow visible wavefront, crosses the wall, and shoves the crate along
 * your dash direction. Closer to the crate = stronger push. The Eddy (nested, fast clock) echoes
 * quickly and leaks a weaker, slower wave into the Tidepool.
 */
export function createTidepool(): Level {
  const world = new World({ width: 800, height: 560 });
  world.defineAction('dash', 700);

  const player = world.addBody({ pos: { x: 150, y: 280 }, r: 12, tag: 'player' });
  world.addBody({ pos: { x: 540, y: 220 }, r: 16, mass: 2, tag: 'crate' });
  for (let y = 40; y <= 520; y += 80) world.addBody({ pos: { x: 400, y }, r: 40, mass: 0, tag: 'wall' });

  const plate = { x: 690, y: 400 };
  world.addZone({ id: 'basin', center: plate, radius: 110, fields: { attract: 260, friction: 3 } });

  world.addZone({ id: 'tidepool', center: { x: 400, y: 280 }, radius: 520,
    shear: { forbid: { dash: 0.2 }, maxLag: 10, echoDelay: 12, echoGain: 1, echoCount: 1,
      ripple: 640, echoSpeed: 3 } });
  world.addZone({ id: 'eddy', center: { x: 150, y: 280 }, radius: 110,
    shear: { parent: 'tidepool', forbid: {}, clock: 2, bleed: 0.8, maxLag: 10, echoDelay: 10,
      echoGain: 0.5, echoCount: 1, ripple: 160, echoSpeed: 8 } });
  world.addAnchor({ id: 'a1', pos: { x: 150, y: 190 }, radius: 36, power: 0.6 });

  return makeLevel({
    name: 'Tidepool',
    hint: 'The crate is behind the wall. Dash from here: the slow echo wave carries your push across.',
    world, playerId: player.id,
    plate: { pos: plate, r: 28 }, exit: { pos: { x: 60, y: 500 }, r: 30 },
  });
}
