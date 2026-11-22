import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShearField, Vec2Space, ball } from '../../src/core/index.ts';
import type { Tracked, Vec2 } from '../../src/core/index.ts';

const O: Vec2 = { x: 0, y: 0 };
const mk = () => new ShearField<Vec2>({ space: Vec2Space });
const ent = (id: number, x: number, y = 0): Tracked<Vec2> => ({ id, pos: { x, y }, lag: 0 });
const region = (r: number, c: Vec2 = O) => ball(Vec2Space, c, r);

test('clocks compose down the tree: rate = product of ancestor clocks', () => {
  const f = mk();
  const a = f.addDomain({ id: 'a', region: region(1000), forbid: {}, clock: 0.5 });
  const b = f.addDomain({ id: 'b', region: region(500), forbid: {}, parent: 'a', clock: 2 });
  const c = f.addDomain({ id: 'c', region: region(100), forbid: {}, parent: 'b', clock: 4 });
  for (let i = 0; i < 10; i++) { f.begin(); f.commit(); }
  assert.deepEqual([a.rate, b.rate, c.rate], [0.5, 1, 4]);
  assert.deepEqual([a.time, b.time, c.time], [5, 10, 40]);
});

test('echo timing follows the domain clock (slow domain echoes later, fast earlier)', () => {
  const f = mk();
  const mkDom = (id: string, x: number, clock: number) => {
    f.track(ent(id === 'slow' ? 1 : 2, x));
    f.addDomain({ id, region: region(50, { x, y: 0 }), forbid: { z: 0.1 }, clock, echoDelay: 10, echoCount: 1 });
  };
  mkDom('slow', 1000, 0.5); mkDom('fast', -1000, 2);
  f.violate(1, 'z', O); f.violate(2, 'z', O);
  const at: Record<string, number> = {};
  for (let i = 0; i < 40; i++) {
    f.begin();
    for (const e of f.events) if (e.type === 'echo') at[e.domainId] ??= f.tick;
    f.commit();
  }
  assert.equal(at.slow, 20); // 10 local units at 0.5/tick
  assert.equal(at.fast, 5);  // 10 local units at 2/tick
});

test('wavefront speed is per local clock: clock 2 doubles effective speed', () => {
  const run = (clock: number) => {
    const f = mk();
    const actor = ent(1, 0), target = ent(2, 100);
    f.track(actor); f.track(target);
    f.addDomain({ id: 'd', region: region(500), forbid: { z: 0.1 }, clock, echoDelay: 1, echoCount: 1, ripple: 300, echoSpeed: 5 });
    f.violate(1, 'z', { x: 1, y: 0 });
    let fired = -1, hit = -1;
    for (let i = 0; i < 200 && hit < 0; i++) {
      const hs = f.begin();
      if (fired < 0 && f.events.some(e => e.type === 'echo')) fired = f.tick;
      if (hs.some(h => h.entityId === 2)) hit = f.tick;
      f.commit();
    }
    return hit - fired;
  };
  assert.equal(run(1), 20); // 100 / 5
  assert.equal(run(2), 10); // 100 / (5*2)
});

test('shear bleeds up the chain: dissonance and echoes scale by each level\'s bleed', () => {
  const f = mk();
  f.track(ent(1, 0));
  const g = f.addDomain({ id: 'g', region: region(1000), forbid: { z: 0.8 }, bleed: 0.5 });
  const p = f.addDomain({ id: 'p', region: region(500), forbid: {}, parent: 'g', bleed: 0.5 });
  const c = f.addDomain({ id: 'c', region: region(100), forbid: {}, parent: 'p', bleed: 0.5 });
  assert.equal(f.violate(1, 'z', { x: 1, y: 0 }), true); // c inherits g's rule
  assert.equal(c.dissonance, 0.8);
  assert.equal(p.dissonance, 0.4);
  assert.equal(g.dissonance, 0.2);
  assert.equal(f.echoes.length, 3);
});

test('violation counts once, in the deepest domain only (parent gets bleed, not a second hit)', () => {
  const f = mk();
  f.track(ent(1, 0));
  const p = f.addDomain({ id: 'p', region: region(500), forbid: { z: 0.6 }, bleed: 0.5 });
  const c = f.addDomain({ id: 'c', region: region(100), forbid: {}, parent: 'p', bleed: 0.5 });
  f.violate(1, 'z', O);
  assert.equal(f.events.filter(e => e.type === 'violation').length, 1);
  assert.equal(c.dissonance, 0.6);
  assert.equal(p.dissonance, 0.3);
});

test('child may permit what the parent forbids (severity 0 overrides)', () => {
  const f = mk();
  f.track(ent(1, 0));
  f.addDomain({ id: 'p', region: region(500), forbid: { z: 0.6 } });
  const c = f.addDomain({ id: 'c', region: region(100), forbid: { z: 0 }, parent: 'p' });
  assert.equal(f.violate(1, 'z', O), false);
  assert.equal(c.dissonance, 0);
});

test('child echo only reaches inside the child; leaked parent echo reaches the wider domain', () => {
  const f = mk();
  const actor = ent(1, 0), inner = ent(2, 20), outer = ent(3, 300);
  [actor, inner, outer].forEach(e => f.track(e));
  f.addDomain({ id: 'p', region: region(500), forbid: { z: 0.3 }, echoDelay: 1, echoCount: 1, ripple: 500 });
  f.addDomain({ id: 'c', region: region(100), forbid: {}, parent: 'p', echoDelay: 1, echoCount: 1, ripple: 100, bleed: 1 });
  f.violate(1, 'z', { x: 1, y: 0 });
  const all = new Set<number>();
  for (let i = 0; i < 5; i++) { for (const h of f.begin()) all.add(h.entityId); f.commit(); }
  assert.ok(all.has(2) && all.has(3)); // outer only reachable through the parent's echo
});

test('unknown parent throws; frozen domain (clock 0) never echoes', () => {
  const f = mk();
  assert.throws(() => f.addDomain({ id: 'x', region: region(1), forbid: {}, parent: 'nope' }));
  f.track(ent(1, 0));
  f.addDomain({ id: 'z', region: region(50), forbid: { a: 0.1 }, clock: 0, echoDelay: 1, echoCount: 1 });
  f.violate(1, 'a', O);
  let fired = 0;
  for (let i = 0; i < 100; i++) { f.begin(); fired += f.events.filter(e => e.type === 'echo').length; f.commit(); }
  assert.equal(fired, 0);
});
