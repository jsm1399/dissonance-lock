import type { Game } from "./state.js";
import { WORLD, MAX_CHARGES, CHARGE_REGEN } from "./state.js";
import { wavefront } from "../core/strata/index.js";
import { beaconPos, isHidden } from "./levels.js";
import type { Vec } from "../core/strata/index.js";

export interface Rect { x: number; y: number; w: number; h: number }
export type Screen = "title" | "play" | "pause" | "end" | "lab";

export interface MenuItem { key: string; title: string; blurb: string; right: string }
export interface EndInfo { title: string; good: boolean; lines: string[]; prompt: string; copy?: boolean }
export interface BriefView { title: string; lines: string[]; since: number; until: number }
export interface HintView { text: string; sub: string; progress: number }

export interface Ui {
  screen: Screen;
  sel: number;
  menu: MenuItem[];
  end: EndInfo | null;
  hint: HintView | null;
  brief: BriefView | null;
  toast: { text: string; until: number } | null;
  muted: boolean;
  /** performance.now() of last anchor / last heard pulse, for flashes */
  anchorAt: number;
  heardAt: number;
  heardHue: number;
  hits: { rows: Rect[]; anchor: Rect; menu: Rect; copy: Rect };
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

const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
export const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function text(
  c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign = "left", weight = "400", maxW?: number,
): void {
  c.font = `${weight} ${size}px ${FONT}`;
  if (maxW !== undefined && maxW > 0 && c.measureText(s).width > maxW) {
    // narrow screens: shrink toward 8px first, then cut with an ellipsis rather than run off the edge
    let sz = size;
    while (sz > 8 && c.measureText(s).width > maxW) { sz -= 0.5; c.font = `${weight} ${sz}px ${FONT}`; }
    if (c.measureText(s).width > maxW) {
      let t = s;
      while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
      s = `${t}…`;
    }
  }
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
      if (isHidden(b)) continue; // hidden-axis beacons give no ring: you only hear them
      wfCache.set(p.id, {
        t: g.time,
        poly: wavefront(g.tree, { domain: b.domain, pos: beaconPos(g.level, b) }, p.emitLocal, g.time, 72, 170, 1.0),
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
  text(c, `${L.tag} · ${L.name}`, 14, 34, 15, "#e8f1ff", "left", "700");
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
  c.lineWidth = inBand ? 2 + (REDUCED ? 0 : 0.8 * Math.sin(now / 120)) : 1.5;
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
    const pr = g.tree.toRootPos(b.domain, beaconPos(g.level, b));
    const lastLocal = b.phase + (g.nextK[i] - 1) * b.period;
    const since = g.time - g.tree.toRootTime(b.domain, lastLocal);
    const cx = X(pr[0]), cy = Y(pr[1]);
    const pulse = since >= 0 && since < 0.7 ? 1 - since / 0.7 : 0;
    c.beginPath(); c.arc(cx, cy, (2.2 + pulse * 3) * v.s, 0, Math.PI * 2);
    c.fillStyle = hsl(b.hue, 80, 60, 0.12 + pulse * 0.3); c.fill();
    c.beginPath(); c.arc(cx, cy, 1.5 * v.s, 0, Math.PI * 2);
    c.fillStyle = hsl(b.hue, 85, 62); c.fill();
    text(c, b.name, cx, cy - 3.4 * v.s, 10, hsl(b.hue, 80, 75), "center", "700");
    if (isHidden(b)) { // hovers off the plane: dashed halo + axis tag, no wavefront
      c.setLineDash([2, 3]); c.strokeStyle = hsl(b.hue, 70, 70, 0.8);
      c.beginPath(); c.arc(cx, cy, 3 * v.s, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      text(c, `↑${b.z ? "z" : ""}${b.w ? "w" : ""}`, cx + 4 * v.s, cy - 2.4 * v.s, 11, hsl(b.hue, 80, 80), "center", "700");
    }
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
  const halo = (2.6 + (REDUCED ? 0 : 0.35 * Math.sin(now / 160))) * v.s * (1 + g.pressure);
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
    c.fillStyle = `rgba(255,40,80,${REDUCED ? 0.08 : 0.06 + 0.06 * Math.sin(now / 90)})`;
    c.fillRect(v.x0, v.y0, WORLD * v.s, WORLD * v.s);
  }
  c.restore();
  c.strokeStyle = "rgba(255,255,255,0.25)";
  c.strokeRect(v.x0 + 0.5, v.y0 + 0.5, WORLD * v.s - 1, WORLD * v.s - 1);
}

function drawHint(c: CanvasRenderingContext2D, ui: Ui, v: View): void {
  const h = ui.hint;
  if (!h) return;
  const w = Math.min(WORLD * v.s - 16, 560);
  const x = v.w / 2 - w / 2, y = v.y0 + 8;
  c.fillStyle = "rgba(3,5,9,0.86)";
  c.fillRect(x, y, w, 72);
  c.strokeStyle = "rgba(127,219,202,0.7)";
  c.strokeRect(x + 0.5, y + 0.5, w - 1, 71);
  c.fillStyle = "#7fdbca";
  c.fillRect(x, y + 70, w * h.progress, 2);
  text(c, h.text, x + 12, y + 18, 14, "#7fdbca", "left", "700");
  // wrap sub text
  const words = h.sub.split(" ");
  let line = "", ly = y + 38;
  const maxW = w - 24;
  c.font = `400 11px ${FONT}`;
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (c.measureText(test).width > maxW && line) {
      text(c, line, x + 12, ly, 11, "rgba(220,230,245,0.9)");
      line = wd; ly += 14;
    } else line = test;
  }
  if (line) text(c, line, x + 12, ly, 11, "rgba(220,230,245,0.9)");
}

function wrapLines(c: CanvasRenderingContext2D, s: string, maxW: number, size: number): string[] {
  c.font = `400 ${size}px ${FONT}`;
  const out: string[] = [];
  let line = "";
  for (const wd of s.split(" ")) {
    const t = line ? `${line} ${wd}` : wd;
    if (c.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Incoming transmission shown while a sector loads: pure framing, dismissed by moving. */
function drawBrief(c: CanvasRenderingContext2D, ui: Ui, v: View, now: number): void {
  const b = ui.brief;
  if (!b) return;
  const fade = Math.min(1, (now - b.since) / 400, (b.until - now) / 600);
  if (fade <= 0) return;
  const w = Math.min(WORLD * v.s - 16, 560), x = v.w / 2 - w / 2, y = v.y0 + 8;
  const body = b.lines.flatMap((l) => wrapLines(c, l, w - 24, 11));
  const h = 52 + body.length * 15;
  c.save();
  c.globalAlpha = fade;
  c.fillStyle = "rgba(3,5,9,0.88)"; c.fillRect(x, y, w, h);
  c.strokeStyle = "rgba(255,180,84,0.75)"; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.fillStyle = "#ffb454"; c.fillRect(x, y, 3, h);
  text(c, "INCOMING TRANSMISSION · LATTICE OPS", x + 14, y + 13, 9, "rgba(255,180,84,0.8)");
  text(c, b.title, x + 14, y + 32, 14, "#ffe3b8", "left", "700");
  body.forEach((l, i) => text(c, l, x + 14, y + 52 + i * 15, 11, "rgba(225,232,245,0.92)"));
  c.restore();
}

// ---- atmosphere: title backdrop, vignette, scanlines (purely cosmetic) ----
let scan: CanvasPattern | null = null;
let vig: { w: number; h: number; g: CanvasGradient } | null = null;

function drawFX(c: CanvasRenderingContext2D, v: View): void {
  if (!vig || vig.w !== v.w || vig.h !== v.h) {
    const g = c.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.45, v.w / 2, v.h / 2, Math.hypot(v.w, v.h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
    vig = { w: v.w, h: v.h, g };
  }
  c.fillStyle = vig.g; c.fillRect(0, 0, v.w, v.h);
  if (!scan && typeof document !== "undefined") {
    const p = document.createElement("canvas");
    p.width = 1; p.height = 4;
    const q = p.getContext("2d");
    if (q) { q.fillStyle = "rgba(120,200,255,0.045)"; q.fillRect(0, 0, 1, 1); scan = c.createPattern(p, "repeat"); }
  }
  if (scan) { c.fillStyle = scan; c.fillRect(0, 0, v.w, v.h); }
}

const GHOSTS = [[0.16, 0.22, 7.3], [0.82, 0.18, 9.1], [0.5, 0.62, 11.7], [0.12, 0.8, 8.3], [0.9, 0.74, 6.1], [0.34, 0.4, 13.1]];

/** Slow echoes drifting across the title: a lattice at rest. */
function drawBackdrop(c: CanvasRenderingContext2D, v: View, now: number): void {
  const t = now / 1000, R = Math.hypot(v.w, v.h) * 0.45;
  c.lineWidth = 1;
  GHOSTS.forEach(([fx, fy, per], i) => {
    const hue = 190 + i * 37;
    const cx = fx * v.w, cy = fy * v.h;
    for (let k = 0; k < 3; k++) {
      const ph = (REDUCED ? 0.3 + k * 0.3 : ((t / per) + k / 3 + i * 0.17) % 1);
      c.beginPath(); c.arc(cx, cy, ph * R, 0, Math.PI * 2);
      c.strokeStyle = hsl(hue, 70, 60, 0.55 * (1 - ph));
      c.stroke();
    }
    c.beginPath(); c.arc(cx, cy, 2.2, 0, Math.PI * 2); c.fillStyle = hsl(hue, 80, 65, 0.7); c.fill();
  });
  if (v.w >= 700) {
    const drift = (Math.sin(t * 0.37) * 0.012 + Math.sin(t * 0.11) * 0.02).toFixed(3);
    text(c, "NODE 7F · LATTICE LINK STABLE", 16, 20, 10, "rgba(127,219,202,0.8)");
    text(c, `CLOCK DRIFT ${Number(drift) >= 0 ? "+" : ""}${drift} ms · ${fmtTime(t)} UPTIME`, 16, 35, 10, "rgba(180,200,220,0.65)");
  }
}

function drawToast(c: CanvasRenderingContext2D, ui: Ui, v: View, now: number): void {
  const t = ui.toast;
  if (!t || now > t.until) return;
  c.font = `700 12px ${FONT}`;
  const w = c.measureText(t.text).width + 28;
  const x = v.w / 2 - w / 2, y = v.h - v.stripH - 40;
  c.fillStyle = "rgba(127,219,202,0.92)";
  c.fillRect(x, y, w, 26);
  text(c, t.text, v.w / 2, y + 14, 12, "#05070b", "center", "700");
}

function dim(c: CanvasRenderingContext2D, v: View, a: number): void {
  c.fillStyle = `rgba(3,5,9,${a})`;
  c.fillRect(0, 0, v.w, v.h);
}

function drawTitle(c: CanvasRenderingContext2D, ui: Ui, v: View, now: number): void {
  drawBackdrop(c, v, now);
  dim(c, v, 0.7);
  const cx = v.w / 2;
  let y = Math.max(36, v.h * 0.07);
  text(c, "DISSONANCE-LOCK", cx, y, Math.min(40, v.w / 11), "#e8f1ff", "center", "700");
  y += 30;
  text(c, "hold the lock between echoes", cx, y, 14, "rgba(127,219,202,0.9)", "center");
  y += 30;
  const lines = [
    "Echoes reach you late. Every domain runs its own clock.",
    "Dissonance builds when echoes arrive out of step.",
    "Keep it inside the white band to build LOCK. Overload = defeat.",
    "RE-ANCHOR (space) resets dissonance. Move: WASD / arrows / drag.",
  ];
  const fs = Math.max(8, Math.min(12, (v.w - 16) / 37.8));
  // short screens: the rules are on the tutorial; give the menu rows the room
  if (v.h >= 720) { for (const l of lines) { text(c, l, cx, y, fs, "rgba(200,215,235,0.85)", "center"); y += fs + 7; } y += 14; }
  else y -= 8;
  ui.hits.rows = [];
  const n = ui.menu.length;
  const room = v.h - y - 34;
  const rowH = Math.max(30, Math.min(50, room / n - 6));
  ui.menu.forEach((m, i) => {
    const w = Math.min(500, v.w - 24), r: Rect = { x: cx - w / 2, y, w, h: rowH };
    ui.hits.rows.push(r);
    const sel = i === ui.sel;
    c.fillStyle = sel ? "rgba(127,219,202,0.14)" : "rgba(255,255,255,0.04)";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = sel ? "#7fdbca" : "rgba(255,255,255,0.18)";
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    text(c, `${m.key}  ${m.title}`, r.x + 12, r.y + rowH * 0.36, 13, "#e8f1ff", "left", "700");
    text(c, m.blurb, r.x + 12, r.y + rowH * 0.72, 10, "rgba(180,200,220,0.7)");
    text(c, m.right, r.x + r.w - 12, r.y + rowH * 0.36, 11, "#7fdbca", "right");
    y += rowH + 6;
  });
  text(c, "press a key, Enter, or tap · P pause · R restart · M mute", cx, v.h - 18, 11, "rgba(180,200,220,0.55)", "center");
}

function drawEnd(c: CanvasRenderingContext2D, ui: Ui, v: View): void {
  dim(c, v, 0.8);
  const e = ui.end;
  if (!e) return;
  const cx = v.w / 2;
  let y = v.h / 2 - 20 - e.lines.length * 11;
  text(c, e.title, cx, y, Math.min(36, v.w / 11), e.good ? "#7fdbca" : "#ff4d6d", "center", "700");
  y += 38;
  for (const l of e.lines) { text(c, l, cx, y, 13, "#e8f1ff", "center"); y += 22; }
  y += 14;
  text(c, e.prompt, cx, y, 14, "#e8f1ff", "center", "700");
  text(c, "Esc · menu", cx, y + 24, 11, "rgba(180,200,220,0.6)", "center");
  if (e.copy) {
    const r: Rect = { x: cx - 70, y: y + 42, w: 140, h: 32 };
    ui.hits.copy = r;
    c.fillStyle = "rgba(127,219,202,0.14)";
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = "#7fdbca";
    c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    text(c, "C · copy result", cx, r.y + 17, 11, "#7fdbca", "center", "700");
  }
}

export function draw(ctx: CanvasRenderingContext2D, g: Game | null, ui: Ui, v: View, now: number): void {
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, v.w, v.h);
  if (g) {
    updateWavefronts(g);
    drawWorld(ctx, g, ui, v, now);
    drawHud(ctx, g, v, now);
    drawStrip(ctx, g, ui, v);
    if (ui.screen === "play") { drawHint(ctx, ui, v); drawBrief(ctx, ui, v, now); }
  }
  if (ui.screen === "title" || !g) {
    if (!g) {
      // title backdrop: faint empty frame
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(v.x0 + 0.5, v.y0 + 0.5, WORLD * v.s - 1, WORLD * v.s - 1);
    }
    drawTitle(ctx, ui, v, now);
  } else if (ui.screen === "pause") {
    dim(ctx, v, 0.65);
    text(ctx, "PAUSED", v.w / 2, v.h / 2 - 30, 30, "#e8f1ff", "center", "700");
    text(ctx, "tap / P · resume     R · restart", v.w / 2, v.h / 2 + 4, 12, "rgba(180,200,220,0.7)", "center");
    const r: Rect = { x: v.w / 2 - 60, y: v.h / 2 + 24, w: 120, h: 36 };
    ui.hits.menu = r;
    ctx.fillStyle = "rgba(127,219,202,0.14)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#7fdbca";
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    text(ctx, "MENU (Esc)", v.w / 2, r.y + 19, 12, "#7fdbca", "center", "700");
  } else if (ui.screen === "end") drawEnd(ctx, ui, v);
  drawToast(ctx, ui, v, now);
  drawFX(ctx, v);
  text(ctx, ui.muted ? "muted" : "", v.w - 10, v.h - v.stripH - 8, 10, "rgba(180,200,220,0.5)", "right");
}
