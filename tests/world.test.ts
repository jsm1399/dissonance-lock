import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.ts';

function build() {
  const w = new World({ width: 800, height: 600 });
  w.defineAction('dash', 400);
  const p = w.addBody({ pos: { x: 200, y: 200 }, tag: 'player' });
  const crate = w.addBody({ pos: { x: 260, y: 200 }, r: 14, mass: 2 });
  const z = w.addZone({ id: 'quiet', center: { x: 200, y: 200 }, radius: 150, rules: { forbid: { dash: 0.5 } } });
  w.addAnchor({ id: 'a1', pos: { x: 210, y: 210 }, radius: 40, power: 1 });
  return { w, p, crate, z };
}

test('deterministic: identical inputs give identical state', () => {
  const run = () => {
    const { w, p } = build();
    for (let i = 0; i < 300; i++) {
      if (i % 50 === 0) w.act(p.id, 'dash', { x: 1, y: 0.3 });
      w.step();
    }
    return JSON.stringify(w.bodies.map(b => [b.pos, b.vel, b.lag]));
  };
  assert.equal(run(), run());
});

test('allowed action outside rules causes no dissonance', () => {
  const { w, p, z } = build();
  w.defineAction('nudge', 50);
  assert.equal(w.act(p.id, 'nudge', { x: 1, y: 0 }), false);
  assert.equal(z.dissonance, 0);
});

test('violation builds dissonance, lag slews up, hitbox trails visual', () => {
  const { w, p, z } = build();
  assert.equal(w.act(p.id, 'dash', { x: 0, y: -1 }), true);
  assert.equal(z.dissonance, 0.5);
  let maxLag = 0, maxOffset = 0;
  for (let i = 0; i < 40; i++) {
    w.step();
    maxLag = Math.max(maxLag, p.lag);
    const h = w.perceived(p);
    maxOffset = Math.max(maxOffset, Math.hypot(h.x - p.pos.x, h.y - p.pos.y));
  }
  assert.ok(maxLag > 0, 'lag should rise');
  assert.ok(maxOffset > 0, 'hitbox offset from visual');
});

test('echo fires after delay and re-applies impulse', () => {
  const { w, p } = build();
  w.act(p.id, 'dash', { x: 0, y: -1 });
  assert.equal(w.echoes.length, 1);
  let fired = 0;
  for (let i = 0; i < 60; i++) { w.step(); fired += w.events.filter(e => e.type === 'echo').length; }
  assert.equal(fired, 2); // echoCount default 2
});

test('re-anchor clears dissonance, echoes, and lag recovers to 0', () => {
  const { w, p, z } = build();
  w.act(p.id, 'dash', { x: 0, y: 0.1 });
  for (let i = 0; i < 30; i++) w.step();
  assert.ok(z.dissonance > 0);
  // move player to anchor range
  p.pos.x = 210; p.pos.y = 210; p.vel.x = 0; p.vel.y = 0;
  assert.equal(w.reanchor(p.id), true);
  assert.equal(z.dissonance, 0);
  assert.equal(w.echoes.length, 0);
  for (let i = 0; i < 60; i++) w.step();
  assert.equal(p.lag, 0);
});

test('reanchor fails out of range', () => {
  const { w, p } = build();
  p.pos.x = 700; p.pos.y = 500;
  assert.equal(w.reanchor(p.id), false);
});
