import { World, DT } from '../index.ts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const W = canvas.width, H = canvas.height;

let world: World, playerId = 0;

function reset(): void {
  world = new World({ width: W, height: H });
  world.defineAction('dash', 520);
  playerId = world.addBody({ pos: { x: 120, y: H / 2 }, r: 12, tag: 'player' }).id;
  for (let i = 0; i < 9; i++) {
    world.addBody({ pos: { x: 360 + (i % 3) * 46, y: H / 2 - 46 + Math.floor(i / 3) * 46 }, r: 16, mass: 2, tag: 'crate' });
  }
  world.addBody({ pos: { x: 640, y: 120 }, r: 30, mass: 0, tag: 'pillar' });
  world.addZone({
    id: 'quiet', center: { x: 420, y: H / 2 }, radius: 190,
    rules: { forbid: { dash: 0.35 } }, maxLag: 30, echoDelay: 18, echoGain: 0.65, echoCount: 3,
  });
  world.addAnchor({ id: 'a1', pos: { x: 420, y: 70 }, radius: 40, power: 0.5 });
  world.addAnchor({ id: 'a2', pos: { x: 420, y: H - 70 }, radius: 40, power: 0.5 });
}
reset();

const keys = new Set<string>();
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); world.act(playerId, 'dash', dirFromKeys()); }
  if (e.code === 'KeyE') world.reanchor(playerId);
  if (e.code === 'KeyR') reset();
});
addEventListener('keyup', e => keys.delete(e.code));

function dirFromKeys() {
  const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const y = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
  return x === 0 && y === 0 ? { x: 1, y: 0 } : { x, y };
}

let acc = 0, last = performance.now();
const flashes: { x: number; y: number; t: number }[] = [];

function frame(now: number): void {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= DT) {
    const d = dirFromKeys();
    if (keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD')) world.move(playerId, d);
    world.step();
    for (const e of world.events) if (e.type === 'echo') flashes.push({ x: e.origin.x, y: e.origin.y, t: 1 });
    acc -= DT;
  }
  draw();
  requestAnimationFrame(frame);
}

function draw(): void {
  ctx.clearRect(0, 0, W, H);
  for (const z of world.zones) {
    ctx.beginPath(); ctx.arc(z.center.x, z.center.y, z.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(150,90,255,${0.06 + z.dissonance * 0.22})`; ctx.fill();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = `rgba(170,120,255,${0.4 + z.dissonance * 0.6})`; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#b79cff'; ctx.fillText(`dissonance ${(z.dissonance * 100).toFixed(0)}%  (dash forbidden)`, z.center.x - 80, z.center.y - z.radius - 8);
  }
  for (const a of world.anchors) {
    ctx.beginPath(); ctx.arc(a.pos.x, a.pos.y, a.radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#3fd0a0'; ctx.stroke();
    ctx.fillStyle = '#3fd0a0'; ctx.fillText('◆', a.pos.x - 5, a.pos.y + 5);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]; f.t -= 0.03;
    if (f.t <= 0) { flashes.splice(i, 1); continue; }
    ctx.beginPath(); ctx.arc(f.x, f.y, 60 * (1 - f.t) + 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,180,90,${f.t})`; ctx.stroke();
  }
  for (const b of world.bodies) {
    const color = b.tag === 'player' ? '#6ab0ff' : b.tag === 'pillar' ? '#556' : '#c9a36a';
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    if (b.lag > 0) { // hitbox ghost: where collisions actually happen
      const p = world.perceived(b);
      ctx.beginPath(); ctx.arc(p.x, p.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff6a6a'; ctx.stroke();
    }
  }
}
requestAnimationFrame(frame);
