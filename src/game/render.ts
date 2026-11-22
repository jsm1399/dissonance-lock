import type { Game } from "./state.js";
import { WORLD, MAX_CHARGES, CHARGE_REGEN } from "./state.js";
import { LEVELS } from "./levels.js";
import { wavefront } from "../core/strata/index.js";
import type { Vec } from "../core/strata/index.js";

export interface Rect { x: number; y: number; w: number; h: number }
export type Screen = "title" | "play" | "pause" | "end";

export interface Ui {
  screen: Screen;
  levelIdx: number;
  best: (number | null)[];
  muted: boolean;
  /** performance.now() of last anchor / last heard pulse, for flashes */
  anchorAt: number;
  heardAt: number;
  heardHue: number;
  hits: { rows: Rect[]; anchor: Rect };
}

export interface View { w: number; h: number; x0: number; y0: number; s: number; hudH: number; stripH: number }

export function layout(w: number, h: number): View {
  const hudH = w < 640 ? 96 : 64;
  const stripH = 58;
  const avail = Math.min(w - 16, h - hudH - stripH - 8);
  const s = Math.max(1, avail) / WORLD;
  const free = h - hudH - stripH;
  return { w, h, s, hudH, stripH, x0: (w - s * WORLD) / 2, y0: hudH + Math.max(4, (free - s * WORLD) / 2) };
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function text(
  c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign = "left", weight = "400",
): void {
  c.font = `${weight} ${size}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.fillStyle = color;
  c.fillText(s, x, y);
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const dissHue = (d: number) => 190 - Math.min(100, d) * 1.9;

// ---- render-side caches (visual only) ----
let cacheOwner: Game | null = null;
const wfCache = new Map<number, { t: number; poly: Vec[] }>();
let trail: Vec[] = [];

export function resetRender(): void {
  cacheOwner = null;
  wfCache.clear();
  trail = [];
}

function updateWavefronts(g: Game): void {
  if (cacheOwner !== g) { wfCache.clear(); trail = []; cacheOwner = g; }
  const live = new Set<number>();
  for (const p of g.flight) {
    live.add(p.id);
    const c = wfCache.get(p.id);
    if (!c || g.time - c.t >= 0.1) {
      const b = g.level.beacons[p.beacon];
      wfCache.set(p.id, {
        t: g.time,
        poly: wavefront(g.tree, { domain: b.domain, pos: b.pos }, p.emitLocal, g.time, 72, 170, 1.0),
      });
    }
  }
  for (const id of wfCache.keys()) if (!live.has(id)) wfCache.delete(id);
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(last[0] - g.pos[0], last[1] - g.pos[1]) > 0.6) {
    trail.push(g.pos);
    if (trail.length > 28) trail.shift();
  }
}

function bar(
  c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string,
): void {
  c.fillStyle = "rgba(255,255,255,0.07)";
  c.fillRect(x, y, w, h);
  c.fillStyle = color;
  c.fillRect(x, y, w * Math.min(1, Math.max(0, frac)), h);
  c.strokeStyle = "rgba(255,255,255,0.22)";
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHud(c: CanvasRenderingContext2D, g: Game, v: View, now: number): void {
  const L = g.level;
  const narrow = v.w < 640;
  text(c, "DISSONANCE-LOCK", 14, 16, 12, "rgba(180,200,220,0.55)", "left", "700");
  text(c, `L${L.id} · ${L.name}`, 14, 34, 15, "#e8f1ff", "left", "700");
  text(c, fmtTime(g.time), v.w - 14, 16, 14, "#e8f1ff", "right", "700");

  // anchor pips
  const px = v.w - 14;
  for (let i = 0; i < MAX_CHARGES; i++) {
    const full = i < g.charges;
    const cx = px - 8 - i * 22, cy = 36;
    c.beginPath();
    c.arc(cx, cy, 7, 0, Math.PI * 2);
    c.fillStyle = full ? "#7fdbca" : "rgba(255,255,255,0.08)";
    c.fill();
    c.strokeStyle = "rgba(127,219,202,0.7)";
    c.stroke();
    if (!full && i === g.charges) {
      c.beginPath();
      c.arc(cx, cy, 7, -Math.PI / 2, -Math.PI / 2 + (g.chargeTimer / CHARGE_REGEN) * Math.PI * 2);
      c.strokeStyle = "#7fdbca";
      c.lineWidth = 2.5;
      c.stroke();
      c.lineWidth = 1;
    }
  }
  text(c, "ANCHOR", px - 8 - (MAX_CHARGES - 1) * 22 - 18, 36, 10, "rgba(180,200,220,0.6)", "right");

  const bw = narrow ? v.w - 28 : Math.min(300, v.w * 0.3);
  const bx = narrow ? 14 : v.w / 2 - bw - 12;
  const by = narrow ? 52 : 14;
  const dx2 = narrow ? 14 : v.w / 2 + 12;
  const dy2 = narrow ? 76 : 14;

  text(c, "LOCK", bx, by + 20, 10, "rgba(180,200,220,0.6)");
  bar(c, bx + 40, by + 12, bw - 40, 16, g.lock / 100, "#7fdbca");
  text(c, `${Math.floor(g.lock)}%`, bx + bw - 4, by + 20, 10, "#05070b", "right", "700");

  text(c, "DISS", dx2, dy2 + 20, 10, "rgba(180,200,220,0.6)");
  const bx2 = dx2 + 40, bw2 = bw - 40;
  bar(c, bx2, dy2 + 12, bw2, 16, g.dissonance / 100, hsl(dissHue(g.dissonance), 80, 55));
  // resonant band
  const lo = bx2 + (g.level.bandLo / 100) * bw2, hi = bx2 + (g.level.bandHi / 100) * bw2;
  const inBand = g.dissonance >= L.bandLo && g.dissonance <= L.bandHi;
  c.strokeStyle = inBand ? "#fff" : "rgba(255,255,255,0.5)";
  c.lineWidth = inBand ? 2 + 0.8 * Math.sin(now / 120) : 1.5;
  c.strokeRect(lo, dy2 + 9, hi - lo, 22);
  c.lineWidth = 1;
}

function drawStrip(c: CanvasRenderingContext2D, g: Game, ui: Ui, v: View): void {
  const y = v.h - v.stripH;
  c.fillStyle = "rgba(255,255,255,0.03)";
  c.fillRect(0, y, v.w, v.stripH);
  text(c, "HEARD ORDER", 14, y + 14, 10, "rgba(180,200,220,0.55)");
  text(c, `spread ${g.spread.toFixed(1)}s`, 14, y + 42, 11, "rgba(200,215,235,0.8)");

  const heard = g.heard.slice().sort((a, b) => (a.perceivedAt as number) - (b.perceivedAt as number)).slice(-9);
  const byEmit = heard.slice().sort((a, b) => a.emitRoot - b.emitRoot);
  let maxRank = -1;
  heard.forEach((p, i) => {
    const rank = byEmit.indexOf(p) + 1;
    const cx = 130 + i * 34, cy = y + 30;
    const bad = rank - 1 < maxRank;
    maxRank = Math.max(maxRank, rank - 1);
    c.beginPath();
    c.arc(cx, cy, 12, 0, Math.PI * 2);
    c.fillStyle = hsl(g.level.beacons[p.beacon].hue, 70, 45, 0.9);
    c.fill();
    c.lineWidth = bad ? 3 : 1;
    c.strokeStyle = bad ? "#ff4d6d" : "rgba(255,255,255,0.4)";
    c.stroke();
    c.lineWidth = 1;
    text(c, String(rank), cx, cy + 1, 11, "#fff", "center", "700");
  });
  if (heard.length === 0) text(c, "waiting for echoes…", 130, y + 30, 11, "rgba(180,200,220,0.4)");

  const r: Rect = { x: v.w - 118, y: y + 10, w: 104, h: 38 };
  ui.hits.anchor = r;
  const ready = g.charges >= 1;
  c.fillStyle = ready ? "rgba(127,219,202,0.16)" : "rgba(255,255,255,0.04)";
  c.fillRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = ready ? "#7fdbca" : "rgba(255,255,255,0.2)";
  c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  text(c, "RE-ANCHOR", r.x + r.w / 2, r.y + 14, 11, ready ? "#7fdbca" : "rgba(255,255,255,0.35)", "center", "700");
  text(c, "SPACE", r.x + r.w / 2, r.y + 28, 9, "rgba(180,200,220,0.5)", "center");
}

function drawWorld(c: CanvasRenderingContext2D, g: Game, ui: Ui, v: View, now: number): void {
  const X = (x: number) => v.x0 + x * v.s;
  const Y = (y: number) => v.y0 + y * v.s;
  c.save();
  c.beginPath();
  c.rect(v.x0, v.y0, WORLD * v.s, WORLD * v.s);
  c.clip();
  c.fillStyle = "#070a12";
  c.fillRect(v.x0, v.y0, WORLD * v.s, WORLD * v.s);
  c.strokeStyle = "rgba(255,255,255,0.045)";
  for (let k = 0; k <= WORLD; k += 10) {
    c.beginPath(); c.moveTo(X(k), Y(0)); c.lineTo(X(k), Y(WORLD)); c.stroke();
    c.beginPath(); c.moveTo(X(0), Y(k)); c.lineTo(X(WORLD), Y(k)); c.stroke();
  }

  // domains
  for (const d of g.tree.domains()) {
    const rate = g.tree.rateToRoot(d, g.time);
    const cx = X(d.centerRoot[0]), cy = Y(d.centerRoot[1]), r = d.radiusRoot * v.s;
    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    if (d.shear) {
      grad.addColorStop(0, "rgba(160,90,255,0.32)");
      grad.addColorStop(1, "rgba(160,90,255,0.03)");
    } else {
      const a = Math.min(0.28, 0.05 + 0.045 * rate);
      grad.addColorStop(0, `rgba(80,220,255,${a})`);
      grad.addColorStop(1, `rgba(80,220,255,${a * 0.4})`);
    }
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = grad; c.fill();
    c.strokeStyle = d.shear ? "rgba(160,90,255,0.55)" : "rgba(80,220,255,0.55)";
    c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
    const label = d.shear ? `${d.id} ·shear` : `${d.id} ×${rate.toFixed(1)}`;
    text(c, label, cx, cy - r - 7, 10, d.shear ? "rgba(190,150,255,0.85)" : "rgba(130,230,255,0.85)", "center");
  }

  // wavefronts
  for (const p of g.flight) {
    const w = wfCache.get(p.id);
    if (!w) continue;
    const hue = g.level.beacons[p.beacon].hue;
    const age = g.time - p.emitRoot;
    c.beginPath();
    w.poly.forEach((q, i) => (i === 0 ? c.moveTo(X(q[0]), Y(q[1])) : c.lineTo(X(q[0]), Y(q[1]))));
    c.closePath();
    c.strokeStyle = hsl(hue, 80, 62, Math.max(0.12, 0.7 - age / 40));
    c.lineWidth = 1.6;
    c.stroke();
  }
  c.lineWidth = 1;

  // beacons
  g.level.beacons.forEach((b, i) => {
    const pr = g.tree.toRootPos(b.domain, b.pos);
    const lastLocal = b.phase + (g.nextK[i] - 1) * b.period;
    const since = g.time - g.tree.toRootTime(b.domain, lastLocal);
    const cx = X(pr[0]), cy = Y(pr[1]);
    const pulse = since >= 0 && since < 0.7 ? 1 - since / 0.7 : 0;
    c.beginPath(); c.arc(cx, cy, (2.2 + pulse * 3) * v.s, 0, Math.PI * 2);
    c.fillStyle = hsl(b.hue, 80, 60, 0.12 + pulse * 0.3); c.fill();
    c.beginPath(); c.arc(cx, cy, 1.5 * v.s, 0, Math.PI * 2);
    c.fillStyle = hsl(b.hue, 85, 62); c.fill();
    text(c, b.name, cx, cy - 3.4 * v.s, 10, hsl(b.hue, 80, 75), "center", "700");
  });

  // trail + player
  for (let i = 0; i < trail.length; i++) {
    c.beginPath();
    c.arc(X(trail[i][0]), Y(trail[i][1]), 0.8 * v.s * (i / trail.length), 0, Math.PI * 2);
    c.fillStyle = `rgba(255,255,255,${0.25 * (i / trail.length)})`;
    c.fill();
  }
  const hue = dissHue(g.dissonance);
  const px = X(g.pos[0]), py = Y(g.pos[1]);
  const halo = (2.6 + 0.35 * Math.sin(now / 160)) * v.s * (1 + g.pressure);
  c.beginPath(); c.arc(px, py, halo, 0, Math.PI * 2);
  c.fillStyle = hsl(hue, 85, 55, 0.2); c.fill();
  c.beginPath();
  const s = 1.6 * v.s;
  c.moveTo(px, py - s); c.lineTo(px + s, py); c.lineTo(px, py + s); c.lineTo(px - s, py); c.closePath();
  c.fillStyle = "#fff"; c.fill();
  c.strokeStyle = hsl(hue, 90, 60); c.lineWidth = 2; c.stroke(); c.lineWidth = 1;

  // flashes
  const fa = (now - ui.anchorAt) / 600;
  if (fa >= 0 && fa < 1) {
    c.beginPath(); c.arc(px, py, fa * 40 * v.s, 0, Math.PI * 2);
    c.strokeStyle = `rgba(127,219,202,${1 - fa})`; c.lineWidth = 3; c.stroke(); c.lineWidth = 1;
  }
  const fh = (now - ui.heardAt) / 450;
  if (fh >= 0 && fh < 1) {
    c.beginPath(); c.arc(px, py, (3 + fh * 7) * v.s, 0, Math.PI * 2);
    c.strokeStyle = hsl(ui.heardHue, 85, 65, 0.8 * (1 - fh)); c.lineWidth = 2; c.stroke(); c.lineWidth = 1;
  }
  if (g.dissonance > 80) {
    c.fillStyle = `rgba(255,40,80,${0.06 + 0.06 * Math.sin(now / 90)})`;
    c.fillRect(v.x0, v.y0, WORLD * v.s, WORLD * v.s);
  }
  c.restore();
  c.strokeStyle = "rgba(255,255,255,0.25)";
  c.strokeRect(v.x0 + 0.5, v.y0 + 0.5, WORLD * v.s - 1, WORLD * v.s - 1);
}

function dim(c: CanvasRenderingContext2D, v: View, a: number): void {
  c.fillStyle = `rgba(3,5,9,${a})`;
  c.fillRect(0, 0, v.w, v.h);
}

function drawTitle(c: CanvasRenderingContext2D, ui: Ui, v: View): void {
  dim(c, v, 0.88);
  const cx = v.w / 2;
  let y = Math.max(48, v.h * 0.12);
  text(c, "DISSONANCE-LOCK", cx, y, Math.min(40, v.w / 11), "#e8f1ff", "center", "700");
  y += 34;
  text(c, "hold the lock between echoes", cx, y, 14, "rgba(127,219,202,0.9)", "center");
  y += 40;
  const lines = [
    "Echoes reach you late. Every domain runs its own clock.",
    "Dissonance builds when echoes arrive out of step.",
    "Keep it inside the white band to build LOCK. Overload = defeat.",
    "RE-ANCHOR (space) resets dissonance. 2 charges.",
    "Move: WASD / arrows / drag.   P pause · R restart · M mute",
  ];
  const fs = v.w < 520 ? 11 : 13;
  for (const l of lines) { text(c, l, cx, y, fs, "rgba(200,215,235,0.85)", "center"); y += fs + 9; }
  y += 18;
  ui.hits.rows = [];
  LEVELS.forEach((L, i) => {
    const w = Math.min(460, v.w - 32), r: Rect = { x: cx - w / 2, y, w, h: 50 };
    ui.hits.rows.push(r);
    const sel = i === ui.levelIdx;
    c.fillStyle = sel ? "rgba(127,219,202,0.14)" : "rgba(255,255,255,0.04)";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = sel ? "#7fdbca" : "rgba(255,255,255,0.18)";
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    text(c, `${i + 1}  ${L.name}`, r.x + 14, r.y + 18, 14, "#e8f1ff", "left", "700");
    text(c, L.blurb, r.x + 14, r.y + 36, 10, "rgba(180,200,220,0.7)");
    const b = ui.best[i];
    text(c, b === null || b === undefined ? "—" : `best ${fmtTime(b)}`, r.x + r.w - 14, r.y + 18, 11, "#7fdbca", "right");
    y += 58;
  });
  y += 10;
  text(c, "press 1-3, Enter, or tap a level", cx, y, 11, "rgba(180,200,220,0.6)", "center");
}

function drawEnd(c: CanvasRenderingContext2D, g: Game, ui: Ui, v: View): void {
  dim(c, v, 0.78);
  const won = g.phase === "won";
  const cx = v.w / 2, cy = v.h / 2;
  text(c, won ? "LOCK ACHIEVED" : "OVERLOAD", cx, cy - 56, Math.min(38, v.w / 11), won ? "#7fdbca" : "#ff4d6d", "center", "700");
  text(c, `${g.level.name} · ${fmtTime(g.time)} · anchors used ${g.anchors}`, cx, cy - 14, 13, "#e8f1ff", "center");
  const best = ui.best[ui.levelIdx];
  if (won && best !== null && best !== undefined) text(c, `best ${fmtTime(best)}`, cx, cy + 10, 12, "rgba(127,219,202,0.9)", "center");
  const next = won ? (ui.levelIdx < LEVELS.length - 1 ? "Enter · next level" : "Enter · menu") : "Enter · retry";
  text(c, next, cx, cy + 44, 14, "#e8f1ff", "center", "700");
  text(c, "Esc · menu", cx, cy + 66, 11, "rgba(180,200,220,0.6)", "center");
}

export function draw(ctx: CanvasRenderingContext2D, g: Game | null, ui: Ui, v: View, now: number): void {
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, v.w, v.h);
  if (g) {
    updateWavefronts(g);
    drawWorld(ctx, g, ui, v, now);
    drawHud(ctx, g, v, now);
    drawStrip(ctx, g, ui, v);
  }
  if (ui.screen === "title" || !g) {
    if (!g) {
      // title backdrop: faint empty frame
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(v.x0 + 0.5, v.y0 + 0.5, WORLD * v.s - 1, WORLD * v.s - 1);
    }
    drawTitle(ctx, ui, v);
  } else if (ui.screen === "pause") {
    dim(ctx, v, 0.65);
    text(ctx, "PAUSED", v.w / 2, v.h / 2 - 8, 30, "#e8f1ff", "center", "700");
    text(ctx, "P · resume    R · restart    Esc · menu", v.w / 2, v.h / 2 + 28, 12, "rgba(180,200,220,0.7)", "center");
  } else if (ui.screen === "end") drawEnd(ctx, g, ui, v);
  text(ctx, ui.muted ? "muted" : "", v.w - 10, v.h - v.stripH - 8, 10, "rgba(180,200,220,0.5)", "right");
}
