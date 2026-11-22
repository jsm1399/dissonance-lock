import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTidepool } from '../../src/harness/tidepool.ts';

function dash(px: number, py: number, deg: number) {
  const lv = createTidepool(), w = lv.world, p = w.body(lv.playerId);
  p.pos.x = px; p.pos.y = py;
  const a = (deg * Math.PI) / 180;
  w.act(p.id, 'dash', { x: Math.cos(a), y: Math.sin(a) });
  return lv;
}

test('finite-speed wave is observable: crate is untouched for 60+ ticks, then pushed by the wave', () => {
  const lv = dash(250, 100, 50), w = lv.world;
  const crate = w.bodies.find(b => b.tag === 'crate')!;
  let firstMove = -1, maxReach = 0;
  for (let i = 1; i <= 400 && firstMove < 0; i++) {
    w.step(); lv.tick();
    for (const e of w.echoes) if (e.fired && e.domainId === 'tidepool') {
      const d = w.field.domain('tidepool')!;
      maxReach = Math.max(maxReach, (d.time - e.t0) * d.echoSpeed);
    }
    if (Math.hypot(crate.vel.x, crate.vel.y) > 1) firstMove = i;
  }
  assert.ok(firstMove > 60, `crate moved at tick ${firstMove}`);
  assert.ok(maxReach > 100, 'wavefront radius grew across the screen');
});

test('nested Eddy leaks a weaker, slower wave into the Tidepool', () => {
  const lv = dash(150, 280, 0), w = lv.world;
  const ids = w.echoes.map(e => e.domainId).sort();
  assert.deepEqual(ids, ['eddy', 'tidepool']);
  const eddy = w.echoes.find(e => e.domainId === 'eddy')!, tide = w.echoes.find(e => e.domainId === 'tidepool')!;
  assert.ok(tide.gain < 1 && tide.gain === 0.8); // leaked via bleed 0.8
  w.step();
  assert.equal(w.field.domain('eddy')!.rate, 2);
  assert.equal(eddy.gain, 0.5);
});

test('wall holds: the player cannot cross to the crate side', () => {
  const lv = dash(300, 280, 0), w = lv.world, p = w.body(lv.playerId);
  for (let i = 0; i < 300; i++) { w.step(); lv.tick(); }
  assert.ok(p.pos.x < 400);
});

test('solvable: some dash position and aim parks the crate via the echo wave, then the exit is reachable', () => {
  let solved = false;
  outer: for (const px of [200, 250, 300]) for (const py of [100, 180, 260]) for (let deg = -80; deg <= 80; deg += 5) {
    const lv = dash(px, py, deg), w = lv.world, p = w.body(lv.playerId);
    for (let i = 0; i < 1200 && !lv.plateOn; i++) { w.step(); lv.tick(); }
    if (!lv.plateOn) continue;
    for (let i = 0; i < 900 && !lv.won; i++) {
      w.move(p.id, { x: Math.sign(lv.exit.pos.x - p.pos.x), y: Math.sign(lv.exit.pos.y - p.pos.y) }, 700);
      w.step(); lv.tick();
    }
    if (lv.won) { solved = true; break outer; }
  }
  assert.ok(solved);
});

test('doing nothing never solves it', () => {
  const lv = createTidepool();
  for (let i = 0; i < 1200; i++) { lv.world.step(); lv.tick(); }
  assert.equal(lv.plateOn, false);
});
