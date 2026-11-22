import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.ts';

test('zone gravity accelerates bodies only inside the zone', () => {
  const w = new World({ width: 800, height: 600, drag: 0 });
  const inside = w.addBody({ pos: { x: 100, y: 100 } });
  const outside = w.addBody({ pos: { x: 700, y: 100 } });
  w.addZone({ id: 'g', center: { x: 100, y: 100 }, radius: 50, rules: { gravity: { x: 0, y: 300 } } });
  for (let i = 0; i < 10; i++) w.step();
  assert.ok(inside.vel.y > 40);
  assert.equal(outside.vel.y, 0);
});

test('zone friction overrides world drag; smallest zone wins', () => {
  const w = new World({ width: 800, height: 600, drag: 1 });
  w.addZone({ id: 'big', center: { x: 400, y: 300 }, radius: 200, rules: { friction: 0 } });
  w.addZone({ id: 'small', center: { x: 400, y: 300 }, radius: 50, rules: { friction: 5 } });
  assert.equal(w.fieldsAt({ x: 400, y: 300 }).friction, 5);
  assert.equal(w.fieldsAt({ x: 550, y: 300 }).friction, 0);
  assert.equal(w.fieldsAt({ x: 790, y: 300 }).friction, 1);
});

test('attract + friction settles a body at the zone center', () => {
  const w = new World({ width: 800, height: 600 });
  const b = w.addBody({ pos: { x: 440, y: 300 } });
  w.addZone({ id: 'well', center: { x: 400, y: 300 }, radius: 100, rules: { attract: 420, friction: 3.5 } });
  for (let i = 0; i < 600; i++) w.step();
  assert.ok(Math.hypot(b.pos.x - 400, b.pos.y - 300) < 2);
});

test('gravity stacks across overlapping zones', () => {
  const w = new World({ width: 800, height: 600 });
  w.addZone({ id: 'a', center: { x: 100, y: 100 }, radius: 80, rules: { gravity: { x: 10, y: 0 } } });
  w.addZone({ id: 'b', center: { x: 100, y: 100 }, radius: 40, rules: { gravity: { x: 5, y: 7 } } });
  const f = w.fieldsAt({ x: 100, y: 100 });
  assert.equal(f.gx, 15); assert.equal(f.gy, 7);
});
