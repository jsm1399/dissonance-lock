import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLevel } from '../src/level.ts';

function crateOf(lv: ReturnType<typeof createLevel>) { return lv.world.bodies.find(b => b.tag === 'crate')!; }

/** Place player at (r, angle) around the crate and dash at it; return level after `ticks`. */
function shot(r: number, deg: number, ticks = 900) {
  const lv = createLevel(), w = lv.world, c = crateOf(lv), p = w.body(lv.playerId);
  const a = (deg * Math.PI) / 180;
  p.pos.x = c.pos.x + Math.cos(a) * r; p.pos.y = c.pos.y + Math.sin(a) * r;
  w.act(p.id, 'dash', { x: c.pos.x - p.pos.x, y: c.pos.y - p.pos.y });
  for (let i = 0; i < ticks && !lv.plateOn; i++) { w.step(); lv.tick(); }
  return lv;
}

test('straight shot fails: the crosswind bends it off the plate', () => {
  const lv = shot(50, 180);
  assert.equal(lv.plateOn, false);
});

test('level is solvable: a dash exists that parks the crate, and the exit is reachable', () => {
  let solved = false;
  for (const r of [40, 60, 80]) for (let deg = 0; deg < 360 && !solved; deg += 5) {
    const lv = shot(r, deg);
    if (!lv.plateOn) continue;
    const w = lv.world, p = w.body(lv.playerId);
    for (let i = 0; i < 900 && !lv.won; i++) {
      w.move(p.id, { x: Math.sign(lv.exit.pos.x - p.pos.x), y: Math.sign(lv.exit.pos.y - p.pos.y) }, 700);
      w.step(); lv.tick();
    }
    if (lv.won) solved = true;
  }
  assert.ok(solved);
});
