import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShearField, Vec2Space, Vec3Space, ball } from '../../src/core/index.ts';
import type { Tracked, Vec3 } from '../../src/core/index.ts';

const ent = (id: number, x: number, y = 0, z = 0): Tracked<Vec3> => ({ id, pos: { x, y, z }, lag: 0 });

test('core is dimension-agnostic: 3D lag trails a moving entity', () => {
  const f = new ShearField<Vec3>({ space: Vec3Space });
  const a = ent(1, 0);
  f.track(a);
  f.addDomain({ id: 'd', region: ball(Vec3Space, { x: 0, y: 0, z: 0 }, 1000), forbid: { blink: 1 }, maxLag: 10 });
  f.violate(1, 'blink', { x: 1, y: 0, z: 0 });
  for (let i = 0; i < 20; i++) { f.begin(); a.pos.x += 1; f.commit(); }
  assert.equal(a.lag, 10);
  f.begin(); a.pos.x += 1; // mid-frame (after host integration, before commit): contacts happen here
  assert.equal(f.perceived(1).x, a.pos.x - 10); // perceived frame trails by exactly `lag` ticks
});

test('echoSpeed=Infinity ripples instantly; finite speed is a causal wavefront', () => {
  const run = (echoSpeed: number) => {
    const f = new ShearField<Vec3>({ space: Vec3Space });
    const actor = ent(1, 0), near = ent(2, 10), far = ent(3, 80);
    [actor, near, far].forEach(e => f.track(e));
    f.addDomain({ id: 'd', region: ball(Vec3Space, { x: 0, y: 0, z: 0 }, 200), forbid: { x: 0.1 },
      echoDelay: 1, echoCount: 1, ripple: 100, echoSpeed });
    f.violate(1, 'x', { x: 1, y: 0, z: 0 });
    const t: Record<number, number> = {};
    for (let i = 0; i < 60; i++) { for (const h of f.begin()) t[h.entityId] ??= f.tick; f.commit(); }
    return t;
  };
  const inst = run(Infinity), wave = run(5);
  assert.equal(inst[2], inst[3]);                 // simultaneous
  assert.ok(wave[3] - wave[2] >= 13 && wave[3] - wave[2] <= 15); // (80-10)/5 = 14 ticks apart
});

test('scale-free: planetary-radius domain with light-delay-style echo', () => {
  const f = new ShearField<Vec3>({ space: Vec3Space });
  const a = ent(1, 0), far = ent(2, 5e11);
  f.track(a); f.track(far);
  f.addDomain({ id: 'sys', region: ball(Vec3Space, { x: 0, y: 0, z: 0 }, 1e12), forbid: { fire: 0.5 },
    echoDelay: 1, echoCount: 1, ripple: 1e12, echoSpeed: 1e10 });
  f.violate(1, 'fire', { x: 1, y: 0, z: 0 });
  let hitTick = -1;
  for (let i = 0; i < 100 && hitTick < 0; i++) { if (f.begin().some(h => h.entityId === 2)) hitTick = f.tick; f.commit(); }
  assert.ok(hitTick >= 50 && hitTick <= 54, `hit at ${hitTick}`);
});

test('anchors and domain rules work in 2D space too, with no physics host', () => {
  const f = new ShearField({ space: Vec2Space });
  const a = { id: 1, pos: { x: 0, y: 0 }, lag: 0 };
  f.track(a);
  const d = f.addDomain({ id: 'd', region: ball(Vec2Space, { x: 0, y: 0 }, 50), forbid: { z: 0.6 } });
  f.addAnchor({ id: 'k', pos: { x: 0, y: 0 }, radius: 5, power: 1 });
  assert.equal(f.violate(1, 'z', { x: 1, y: 0 }), true);
  assert.equal(d.dissonance, 0.6);
  assert.equal(f.reanchor(1), true);
  assert.equal(d.dissonance, 0);
  assert.equal(f.echoes.length, 0);
});

test('actions outside a domain, or not forbidden, never violate', () => {
  const f = new ShearField({ space: Vec2Space });
  const a = { id: 1, pos: { x: 500, y: 0 }, lag: 0 };
  f.track(a);
  f.addDomain({ id: 'd', region: ball(Vec2Space, { x: 0, y: 0 }, 50), forbid: { z: 1 } });
  assert.equal(f.violate(1, 'z', { x: 1, y: 0 }), false);
  a.pos.x = 0;
  assert.equal(f.violate(1, 'other', { x: 1, y: 0 }), false);
});
