import { LEVELS } from "./levels.js";
import { newGame, step, TICK, WORLD } from "./state.js";
import type { Game, Input } from "./state.js";
import { draw, layout, resetRender } from "./render.js";
import type { Rect, Ui, View } from "./render.js";
import { sfx } from "./sfx.js";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const STORE = "dissonance-lock.best.v1";
function loadBest(): (number | null)[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null") as unknown;
    if (Array.isArray(raw)) return LEVELS.map((_, i) => (typeof raw[i] === "number" ? (raw[i] as number) : null));
  } catch { /* storage unavailable */ }
  return LEVELS.map(() => null);
}
function saveBest(b: (number | null)[]): void {
  try { localStorage.setItem(STORE, JSON.stringify(b)); } catch { /* ignore */ }
}

const ui: Ui = {
  screen: "title", levelIdx: 0, best: loadBest(), muted: false,
  anchorAt: -1e9, heardAt: -1e9, heardHue: 0,
  hits: { rows: [], anchor: { x: 0, y: 0, w: 0, h: 0 } },
};
let game: Game | null = null;
let view: View = layout(innerWidth, innerHeight);
let acc = 0;
let anchorQueued = false;
const keys = new Set<string>();
const pointer = { down: false, x: 0, y: 0 };

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = layout(innerWidth, innerHeight);
}

function start(i: number): void {
  ui.levelIdx = Math.max(0, Math.min(LEVELS.length - 1, i));
  game = newGame(LEVELS[ui.levelIdx]);
  resetRender();
  acc = 0;
  anchorQueued = false;
  ui.screen = "play";
  sfx.unlock();
}

function toMenu(): void {
  game = null;
  resetRender();
  ui.screen = "title";
}

function readInput(): Input {
  let dx = 0, dy = 0;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;
  if (dx === 0 && dy === 0 && pointer.down && game) {
    const tx = (pointer.x - view.x0) / view.s - game.pos[0];
    const ty = (pointer.y - view.y0) / view.s - game.pos[1];
    const d = Math.hypot(tx, ty);
    if (d > 0.3) { const m = Math.min(1, d / 3); dx = (tx / d) * m; dy = (ty / d) * m; }
  }
  return { dx, dy, anchor: anchorQueued };
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function endScreenKey(key: string): void {
  if (!game) return;
  if (key === "enter" || key === " ") {
    if (game.phase === "won") {
      if (ui.levelIdx < LEVELS.length - 1) start(ui.levelIdx + 1); else toMenu();
    } else start(ui.levelIdx);
  } else if (key === "escape") toMenu();
}

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (e.repeat && k === " ") return;
  sfx.unlock();
  if (k === "m") { ui.muted = sfx.toggle(); return; }
  if (ui.screen === "title") {
    if (k === "1" || k === "2" || k === "3") start(Number(k) - 1);
    else if (k === "enter" || k === " ") start(ui.levelIdx);
    else if (k === "arrowup" || k === "w") ui.levelIdx = Math.max(0, ui.levelIdx - 1);
    else if (k === "arrowdown" || k === "s") ui.levelIdx = Math.min(LEVELS.length - 1, ui.levelIdx + 1);
    return;
  }
  if (ui.screen === "end") { endScreenKey(k); return; }
  if (ui.screen === "pause") {
    if (k === "p" || k === "escape") ui.screen = "play";
    else if (k === "r") start(ui.levelIdx);
    return;
  }
  // playing
  if (k === "p" || k === "escape") { ui.screen = "pause"; keys.clear(); return; }
  if (k === "r") { start(ui.levelIdx); return; }
  if (k === " ") { anchorQueued = true; return; }
  keys.add(k);
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => { keys.clear(); pointer.down = false; if (ui.screen === "play") ui.screen = "pause"; });

canvas.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  pointer.x = e.offsetX; pointer.y = e.offsetY;
  if (ui.screen === "title") {
    const i = ui.hits.rows.findIndex((r) => inside(r, e.offsetX, e.offsetY));
    if (i >= 0) start(i);
    return;
  }
  if (ui.screen === "end") { endScreenKey("enter"); return; }
  if (ui.screen === "pause") { ui.screen = "play"; return; }
  if (inside(ui.hits.anchor, e.offsetX, e.offsetY)) { anchorQueued = true; return; }
  pointer.down = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => { pointer.x = e.offsetX; pointer.y = e.offsetY; });
const up = () => { pointer.down = false; };
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);

function handleEvents(g: Game): void {
  for (const ev of g.events) {
    if (ev.kind === "heard") {
      const hue = g.level.beacons[ev.pulse.beacon].hue;
      ui.heardAt = performance.now();
      ui.heardHue = hue;
      sfx.heard(hue);
    } else if (ev.kind === "anchor") {
      ui.anchorAt = performance.now();
      sfx.anchor();
    } else if (ev.kind === "won") {
      const t = Math.round(g.time * 10) / 10;
      const prev = ui.best[ui.levelIdx];
      if (prev === null || t < prev) { ui.best[ui.levelIdx] = t; saveBest(ui.best); }
      ui.screen = "end";
      sfx.win();
    } else if (ev.kind === "lost") {
      ui.screen = "end";
      sfx.lose();
    }
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (ui.screen === "play" && game) {
    acc += dt;
    for (let n = 0; acc >= TICK && n < 5 && game.phase === "playing"; n++) {
      step(game, readInput());
      anchorQueued = false;
      acc -= TICK;
      handleEvents(game);
    }
  }
  draw(ctx, game, ui, view, now);
  requestAnimationFrame(frame);
}

addEventListener("resize", resize);
resize();

// test/inspection hook
(window as unknown as { __dl: unknown }).__dl = {
  start,
  state: () => ({
    screen: ui.screen, level: ui.levelIdx, phase: game?.phase ?? null, time: game?.time ?? 0,
    dissonance: game?.dissonance ?? 0, lock: game?.lock ?? 0, pos: game?.pos ?? null, world: WORLD,
  }),
  game: () => game,
};
requestAnimationFrame(frame);
