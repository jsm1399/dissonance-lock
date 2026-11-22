import { DT } from '../harness/sim2d.ts';
import { createSlipstream, type Level } from '../harness/slipstream.ts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const W = canvas.width, H = canvas.height;

let lv: Level = createSlipstream();
const reset = () => { lv = createSlipstream(); flashes.length = 0; };

const keys = new Set<string>();
const mouse = { x: -1, y: -1, on: false };
const flashes: { x: number; y: number; t: number }[] = [];

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - r.left) / r.width) * W; mouse.y = ((e.clientY - r.top) / r.height) * H; mouse.on = true;
});
canvas.addEventListener('mouseleave', () => { mouse.on = false; });
canvas.addEventListener('mousedown', () => dash());
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); dash(); }
  if (e.code === 'KeyE') lv.world.reanchor(lv.playerId);
  if (e.code === 'KeyR') reset();
});
addEventListener('keyup', e => keys.delete(e.code));

function keyDir() {
  return { x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), y: (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0) };
}
function dash(): void {
  if (lv.won) return;
  const p = lv.world.body(lv.playerId);
  const k = keyDir();
  const dir = mouse.on ? { x: mouse.x - p.pos.x, y: mouse.y - p.pos.y } : (k.x || k.y ? k : { x: 1, y: 0 });
  lv.world.act(lv.playerId, 'dash', dir);
}

let acc = 0, last = performance.now();
function frame(now: number): void {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= DT) {
    const k = keyDir();
    if (!lv.won && (k.x || k.y)) lv.world.move(lv.playerId, k);
    lv.world.step(); lv.tick();
    for (const e of lv.world.events) if (e.type === 'echo') flashes.push({ x: e.origin.x, y: e.origin.y, t: 1 });
    acc -= DT;
  }
  draw();
  requestAnimationFrame(frame);
}

function circle(x: number, y: number, r: number): void { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

function draw(): void {
  const w = lv.world;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '13px system-ui';
  for (const z of w.zones) {
    const dom = z.domain, quiet = !!dom, dis = dom?.dissonance ?? 0;
    circle(z.center.x, z.center.y, z.radius);
    ctx.fillStyle = quiet ? `rgba(150,90,255,${0.07 + dis * 0.22})` : 'rgba(90,170,255,0.07)'; ctx.fill();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = quiet ? `rgba(170,120,255,${0.4 + dis * 0.6})` : 'rgba(110,180,255,0.5)'; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = quiet ? '#b79cff' : '#7fb8ff';
    ctx.fillText(quiet ? `${z.id}: dissonance ${(dis * 100).toFixed(0)}% · dash forbidden` : `${z.id}: ice + southward wind`, z.center.x - 90, z.center.y - z.radius - 8);
  }
  // plate + exit
  circle(lv.plate.pos.x, lv.plate.pos.y, lv.plate.r);
  ctx.strokeStyle = lv.plateOn ? '#ffd24a' : '#8a7a3a'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
  circle(lv.exit.pos.x, lv.exit.pos.y, lv.exit.r);
  ctx.strokeStyle = lv.plateOn ? '#4aff9a' : '#355'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#789'; ctx.fillText('EXIT', lv.exit.pos.x - 16, lv.exit.pos.y + 4);
  for (const a of w.anchors) {
    circle(a.pos.x, a.pos.y, a.radius); ctx.strokeStyle = '#3fd0a0'; ctx.stroke();
    ctx.fillStyle = '#3fd0a0'; ctx.fillText('◆', a.pos.x - 5, a.pos.y + 5);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]; f.t -= 0.03;
    if (f.t <= 0) { flashes.splice(i, 1); continue; }
    circle(f.x, f.y, 60 * (1 - f.t) + 8); ctx.strokeStyle = `rgba(255,180,90,${f.t})`; ctx.stroke();
  }
  for (const b of w.bodies) {
    circle(b.pos.x, b.pos.y, b.r);
    ctx.fillStyle = b.tag === 'player' ? '#6ab0ff' : b.tag === 'pillar' ? '#556' : '#c9a36a'; ctx.fill();
    if (b.lag > 0) { const p = w.perceived(b); circle(p.x, p.y, b.r); ctx.strokeStyle = '#ff6a6a'; ctx.stroke(); }
  }
  if (mouse.on) { // aim line
    const p = w.body(lv.playerId);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.moveTo(p.pos.x, p.pos.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
  }
  ctx.fillStyle = '#cfd6e4';
  ctx.fillText(`${lv.name} — ${lv.hint}`, 12, 20);
  ctx.fillText(lv.plateOn ? 'Plate held ✔ — reach the exit' : `Plate: ${Math.min(100, Math.round((lv.held / 30) * 100))}%`, 12, 40);
  if (lv.won) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H / 2 - 50, W, 100);
    ctx.fillStyle = '#4aff9a'; ctx.font = '28px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('SOLVED — press R to replay', W / 2, H / 2 + 10); ctx.textAlign = 'left'; ctx.font = '13px system-ui';
  }
}
requestAnimationFrame(frame);
