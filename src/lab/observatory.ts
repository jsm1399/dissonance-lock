import { wavefront } from "../core/strata/index.js";
import type { Vec } from "../core/strata/index.js";
import { FONT, hsl, text } from "../game/render.js";
import { LAWFUL } from "../core/laws/index.js";
import type { Laws } from "../core/laws/index.js";
import {
  LAW_KEYS, SIZE, SPEEDS, TMAX, addDomain, addEmitter, adjust, auditEmitter, computeHeat, cycleLaw, driftRate, emissionsUpTo,
  hitTest, metrics, moveSel, newLab, perceived, removeSel, resetLaws,
} from "./lab.js";
import type { LawKey, Lab, Sel, Tool } from "./lab.js";
import { defaultWorld, lawsOf } from "./world.js";
import type { WorldSpec } from "./world.js";

export interface Hooks {
  onChange(spec: WorldSpec): void;
  onExit(): void;
  /** returns the shareable URL for a spec */
  link(spec: WorldSpec): string;
  copy(text: string): Promise<boolean>;
}

interface Btn { id: string; label: string; x: number; y: number; w: number; h: number }
interface Geo { w: number; h: number; x0: number; y0: number; s: number; tbH: number; botTop: number; trackX0: number; trackX1: number; trackY: number }

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "SELECT" }, { id: "fast", label: "FAST" }, { id: "well", label: "WELL" },
  { id: "micro", label: "MICRO" }, { id: "emit", label: "EMIT" }, { id: "erase", label: "ERASE" },
];
const BOT_H = 150;

const LAW_HOTKEY: Record<string, LawKey> = { t: "time", m: "medium", d: "dim", x: "loss", n: "noise", g: "gauss" };
const LAW_TITLE: Record<LawKey, string> = { time: "TIME", medium: "MEDIUM", dim: "DIM", loss: "LOSS", noise: "NOISE", gauss: "GAUSS" };
const lawValue = (k: LawKey, L: Laws): string => (k === "dim" ? String(L.dim) : String(L[k]).toUpperCase());
const lawLabel = (k: LawKey, L: Laws): string => `${LAW_TITLE[k]}·${lawValue(k, L)}`;
const lawIsDefault = (k: LawKey, L: Laws): boolean => L[k] === LAWFUL[k];
const sci = (x: number): string => (x === 0 ? "0" : Math.abs(x) >= 0.01 && Math.abs(x) < 1000 ? x.toPrecision(3) : x.toExponential(1));

export interface Observatory {
  isOpen(): boolean;
  open(spec?: WorldSpec): void;
  close(): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, dt: number): void;
  key(k: string, shift: boolean): boolean;
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
  lab(): Lab | null;
}

export function createObservatory(hooks: Hooks): Observatory {
  let lab: Lab | null = null;
  let geo: Geo = { w: 0, h: 0, x0: 0, y0: 0, s: 1, tbH: 48, botTop: 0, trackX0: 0, trackX1: 0, trackY: 0 };
  let btns: Btn[] = [];
  let drag: Sel | null = null;
  let scrubbing = false;
  let toast: { text: string; until: number } | null = null;
  let lastRev = -1;
  const wf = new Map<string, { t: number; poly: Vec[] }>();

  const say = (t: string, now = performance.now()) => { toast = { text: t, until: now + 1800 }; };

  function layout(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const l = lab as Lab;
    const laws = lawsOf(l.spec);
    const items: { id: string; label: string; brk?: boolean }[] = [
      ...TOOLS,
      { id: "play", label: l.playing ? "PAUSE" : "PLAY" },
      { id: "speed", label: `×${SPEEDS[l.speedIdx]}` },
      { id: "heat", label: l.heat ? "HEAT ✓" : "HEAT" },
      { id: "link", label: "LINK" }, { id: "reset", label: "RESET" }, { id: "menu", label: "MENU" },
      ...LAW_KEYS.map((k, i) => ({ id: `law:${k}`, label: lawLabel(k, laws), brk: i === 0 })),
      { id: "lawful", label: "LAWFUL" },
    ];
    btns = [];
    let x = 8, y = 8;
    ctx.font = `700 11px ${FONT}`;
    for (const it of items) {
      const bw = Math.max(46, Math.ceil(ctx.measureText(it.label).width) + 18);
      if (it.brk && x > 8) { x = 8; y += 34; }
      if (x + bw > w - 8) { x = 8; y += 34; }
      btns.push({ id: it.id, label: it.label, x, y, w: bw, h: 28 });
      x += bw + 6;
    }
    const tbH = y + 36;
    const avail = Math.max(120, Math.min(w - 16, h - tbH - BOT_H - 8));
    const s = avail / SIZE;
    geo = {
      w, h, s, x0: (w - s * SIZE) / 2, y0: tbH + 4, tbH, botTop: h - BOT_H,
      trackX0: 64, trackX1: w - 20, trackY: h - BOT_H + 20,
    };
  }

  const toWorld = (px: number, py: number): Vec => [(px - geo.x0) / geo.s, (py - geo.y0) / geo.s];
  const inWorld = (p: Vec) => p[0] >= 0 && p[0] <= SIZE && p[1] >= 0 && p[1] <= SIZE;

  function activate(id: string): void {
    const l = lab as Lab;
    if (id === "play") { if (l.t >= TMAX) l.t = 0; l.playing = !l.playing; }
    else if (id === "speed") l.speedIdx = (l.speedIdx + 1) % SPEEDS.length;
    else if (id === "heat") {
      if (l.heat) l.heat = null;
      else {
        const target = l.sel?.kind === "emitter" ? l.sel.id : l.spec.emitters[0]?.id;
        if (!target || !computeHeat(l, target)) say("add an emitter first");
      }
    } else if (id === "link") {
      void hooks.copy(hooks.link(l.spec)).then((ok) => say(ok ? "link copied" : "copy unavailable"));
    } else if (id === "reset") {
      const keepTool = l.tool;
      lab = newLab(defaultWorld());
      lab.tool = keepTool;
      wf.clear();
      say("world reset");
    } else if (id === "menu") hooks.onExit();
    else if (id === "lawful") { resetLaws(l); wf.clear(); say("laws restored: lawful"); }
    else if (id.startsWith("law:")) lawStep(id.slice(4) as LawKey);
    else l.tool = id as Tool;
  }

  function lawStep(k: LawKey): void {
    const l = lab as Lab;
    const next = cycleLaw(l, k);
    wf.clear();
    say(`${LAW_TITLE[k]} → ${lawValue(k, next).toLowerCase()}`);
  }

  function place(p: Vec): void {
    const l = lab as Lab;
    if (l.tool === "select") {
      const hit = hitTest(l, p);
      l.sel = hit;
      if (hit) drag = hit;
      else { moveSel(l, { kind: "probe", id: "probe" }, p); l.sel = { kind: "probe", id: "probe" }; }
    } else if (l.tool === "erase") {
      const hit = hitTest(l, p);
      if (hit && hit.kind !== "probe") removeSel(l, hit); else say("nothing to erase");
    } else if (l.tool === "emit") {
      const id = addEmitter(l, p);
      if (id) l.sel = { kind: "emitter", id }; else say("emitter limit reached");
      l.tool = "select";
    } else {
      const id = addDomain(l, l.tool, p);
      if (id) { l.sel = { kind: "domain", id }; l.tool = "select"; }
      else say(l.tool === "micro" ? "place MICRO inside a domain" : "domain limit reached");
    }
  }

  function setT(px: number): void {
    const l = lab as Lab;
    const f = Math.min(1, Math.max(0, (px - geo.trackX0) / (geo.trackX1 - geo.trackX0)));
    l.t = f * TMAX;
  }

  // ---------- drawing ----------
  function drawWorld(c: CanvasRenderingContext2D, l: Lab, now: number): void {
    const { x0, y0, s } = geo;
    const X = (x: number) => x0 + x * s, Y = (y: number) => y0 + y * s;
    c.save();
    c.beginPath(); c.rect(x0, y0, SIZE * s, SIZE * s); c.clip();
    c.fillStyle = "#070a12"; c.fillRect(x0, y0, SIZE * s, SIZE * s);
    c.strokeStyle = "rgba(255,255,255,0.045)";
    for (let k = 0; k <= SIZE; k += 10) {
      c.beginPath(); c.moveTo(X(k), Y(0)); c.lineTo(X(k), Y(SIZE)); c.stroke();
      c.beginPath(); c.moveTo(X(0), Y(k)); c.lineTo(X(SIZE), Y(k)); c.stroke();
    }
    // heat (causal landscape)
    if (l.heat) {
      const f = l.heat.field, e = l.spec.emitters.find((q) => q.id === l.heat?.emitter);
      if (e) {
        const hue = e.hue, launch = l.tree.toRootTime(e.domain, e.phase + l.heat.k * e.period);
        const cs = (SIZE * s) / f.n;
        for (let j = 0; j < f.n; j++) for (let i = 0; i < f.n; i++) {
          const arr = f.values[j * f.n + i], tt = arr - launch;
          const band = Math.floor(tt / 2) % 2 === 0;
          const front = Math.abs(arr - l.t) < 0.6;
          c.fillStyle = front ? hsl(hue, 90, 72, 0.7) : arr <= l.t ? hsl(hue, 70, band ? 40 : 30, 0.34) : hsl(hue, 40, band ? 30 : 22, 0.14);
          c.fillRect(x0 + i * cs, y0 + j * cs, cs + 0.5, cs + 0.5);
        }
      }
    }
    // domains
    for (const d of l.tree.domains()) {
      const def = l.spec.domains.find((q) => q.id === d.id);
      const rate = l.tree.rateToRoot(d, l.t);
      const cx = X(d.centerRoot[0]), cy = Y(d.centerRoot[1]), r = d.radiusRoot * s;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
      if (d.shear) { g.addColorStop(0, "rgba(160,90,255,0.32)"); g.addColorStop(1, "rgba(160,90,255,0.03)"); }
      else { const a = Math.min(0.3, 0.05 + 0.04 * rate); g.addColorStop(0, `rgba(80,220,255,${a})`); g.addColorStop(1, `rgba(80,220,255,${a * 0.4})`); }
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = g; c.fill();
      c.strokeStyle = d.shear ? "rgba(160,90,255,0.6)" : "rgba(80,220,255,0.6)";
      c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
      text(c, d.shear ? `${d.id} ·shear` : `${d.id} ×${rate.toFixed(2)}${def && def.changes.length ? " ⟲" : ""}`, cx, cy - r - 7, 10,
        d.shear ? "rgba(190,150,255,0.9)" : "rgba(130,230,255,0.9)", "center");
    }
    // wavefronts
    const used = new Set<string>();
    for (const em of emissionsUpTo(l, l.t, 3)) {
      const age = l.t - em.launchRoot;
      if (age < 0 || age > 45) continue;
      const key = `${l.rev}|${em.emitter}|${em.k}`;
      used.add(key);
      let c0 = wf.get(key);
      if (!c0 || Math.abs(l.t - c0.t) >= 0.12) {
        c0 = { t: l.t, poly: wavefront(l.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, l.t, 48, 170, 1.5) };
        wf.set(key, c0);
      }
      c.beginPath();
      c0.poly.forEach((q, i) => (i === 0 ? c.moveTo(X(q[0]), Y(q[1])) : c.lineTo(X(q[0]), Y(q[1]))));
      c.closePath();
      c.strokeStyle = hsl(em.hue, 80, 62, Math.max(0.1, 0.75 - age / 55));
      c.lineWidth = 1.5; c.stroke();
    }
    c.lineWidth = 1;
    for (const k of wf.keys()) if (!used.has(k)) wf.delete(k);
    // emitters
    for (const e of l.spec.emitters) {
      const p = l.tree.toRootPos(e.domain, e.pos), cx = X(p[0]), cy = Y(p[1]);
      c.beginPath(); c.arc(cx, cy, 2.2 * s, 0, Math.PI * 2); c.fillStyle = hsl(e.hue, 80, 60, 0.16); c.fill();
      c.beginPath(); c.arc(cx, cy, 1.4 * s, 0, Math.PI * 2); c.fillStyle = hsl(e.hue, 85, 62); c.fill();
      text(c, e.id, cx, cy - 3.2 * s, 10, hsl(e.hue, 80, 78), "center", "700");
    }
    // probe
    const px = X(l.probe[0]), py = Y(l.probe[1]), pr = 1.8 * s;
    c.strokeStyle = "#fff"; c.lineWidth = 1.5;
    c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(px - pr * 1.6, py); c.lineTo(px + pr * 1.6, py); c.moveTo(px, py - pr * 1.6); c.lineTo(px, py + pr * 1.6); c.stroke();
    c.lineWidth = 1;
    // selection ring
    if (l.sel) {
      let sp: Vec | null = null, sr = 3 * s;
      if (l.sel.kind === "probe") sp = l.probe;
      else if (l.sel.kind === "emitter") { const e = l.spec.emitters.find((q) => q.id === l.sel?.id); if (e) sp = l.tree.toRootPos(e.domain, e.pos); }
      else { const d = l.tree.domains().find((q) => q.id === l.sel?.id); if (d) { sp = d.centerRoot; sr = d.radiusRoot * s + 3; } }
      if (sp) {
        c.strokeStyle = `rgba(255,255,255,${0.55 + 0.25 * Math.sin(now / 200)})`;
        c.setLineDash([2, 3]);
        c.beginPath(); c.arc(X(sp[0]), Y(sp[1]), l.sel.kind === "domain" ? sr : sr, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
      }
    }
    c.restore();
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.strokeRect(x0 + 0.5, y0 + 0.5, SIZE * s - 1, SIZE * s - 1);
  }

  function drawToolbar(c: CanvasRenderingContext2D, l: Lab): void {
    for (const b of btns) {
      const isLaw = b.id.startsWith("law:");
      const bent = isLaw && !lawIsDefault(b.id.slice(4) as LawKey, lawsOf(l.spec));
      const on = (b.id === l.tool) || (b.id === "heat" && !!l.heat) || (b.id === "play" && l.playing);
      const col = bent ? "#ffb454" : "#7fdbca";
      c.fillStyle = bent ? "rgba(255,180,84,0.16)" : on ? "rgba(127,219,202,0.22)" : "rgba(255,255,255,0.05)";
      c.fillRect(b.x, b.y, b.w, b.h);
      c.strokeStyle = bent || on ? col : isLaw ? "rgba(160,90,255,0.45)" : "rgba(255,255,255,0.22)";
      c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      text(c, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, 11, bent || on ? col : "#cfd8e3", "center", "700");
    }
  }

  function drawBottom(c: CanvasRenderingContext2D, l: Lab, now: number): void {
    const { w, botTop, trackX0, trackX1, trackY } = geo;
    c.fillStyle = "rgba(255,255,255,0.03)";
    c.fillRect(0, botTop, w, BOT_H);
    text(c, "TIME", 14, trackY, 10, "rgba(180,200,220,0.6)");
    c.fillStyle = "rgba(255,255,255,0.1)";
    c.fillRect(trackX0, trackY - 2, trackX1 - trackX0, 4);
    const kx = trackX0 + (l.t / TMAX) * (trackX1 - trackX0);
    c.fillStyle = "#7fdbca";
    c.fillRect(trackX0, trackY - 2, kx - trackX0, 4);
    c.beginPath(); c.arc(kx, trackY, 8, 0, Math.PI * 2); c.fillStyle = "#e8f1ff"; c.fill();
    // drift markers on the timeline
    for (const d of l.spec.domains) for (const [pt] of d.changes) {
      const rootT = l.tree.toRootTime(d.parent, pt);
      const mx = trackX0 + (rootT / TMAX) * (trackX1 - trackX0);
      c.fillStyle = "rgba(160,90,255,0.9)"; c.fillRect(mx - 1, trackY - 8, 2, 16);
    }
    text(c, `t ${l.t.toFixed(1)}s`, trackX1, trackY + 16, 11, "#e8f1ff", "right", "700");

    const m = metrics(l);
    text(c, "PROBE", 14, botTop + 46, 10, "rgba(180,200,220,0.6)");
    text(c, `spread ${m.spread.toFixed(1)}s · inversions ${m.inversions} · heard ${m.heard}`, 64, botTop + 46, 12, "rgba(220,232,248,0.95)");
    const heard = perceived(l).filter((p) => p.arrival >= l.t - 12).slice(-12);
    const byEmit = heard.slice().sort((a, b) => a.emission.launchRoot - b.emission.launchRoot);
    let maxRank = -1;
    heard.forEach((p, i) => {
      const rank = byEmit.indexOf(p) + 1, bad = rank - 1 < maxRank;
      maxRank = Math.max(maxRank, rank - 1);
      const cx = 24 + i * 30, cy = botTop + 92;
      c.beginPath(); c.arc(cx, cy, 11, 0, Math.PI * 2); c.fillStyle = hsl(p.emission.hue, 70, 45, 0.9); c.fill();
      c.lineWidth = bad ? 3 : 1; c.strokeStyle = bad ? "#ff4d6d" : "rgba(255,255,255,0.4)"; c.stroke(); c.lineWidth = 1;
      text(c, String(rank), cx, cy + 1, 10, "#fff", "center", "700");
    });
    if (heard.length === 0) text(c, "probe has heard nothing yet — press PLAY or drag TIME", 14, botTop + 92, 11, "rgba(180,200,220,0.45)");

    // conservation audit of one emitter's latest pulse along the chord to the probe
    const au = auditEmitter(l);
    if (au) {
      const a = au.audit, pct = (a.relResidual * 100).toFixed(1);
      const verdict = a.verdict === "conserved" ? "energy ✓ conserved"
        : a.verdict === "created" ? `energy ✗ CREATED +${pct}%` : `energy ✗ DESTROYED ${pct}%`;
      const col = a.verdict === "conserved" ? "rgba(127,219,202,0.95)" : "#ff4d6d";
      text(c, `AUDIT`, 14, botTop + 66, 10, "rgba(180,200,220,0.6)");
      text(c, `${au.emitter}→probe r ${a.r.toFixed(0)} · ${verdict} · flux ${sci(a.intensity)} · fidelity ${(a.fidelity * 100).toFixed(0)}% · absorbed ${sci(a.absorbedTotal)}`, 64, botTop + 66, 11, col);
    }
    let info = "Click the world to move the probe. Pick a tool to build. Keys 1-6 tools · Space play · ←/→ time · H heat · L link · laws: T time · M medium · D dim · X loss · N noise · G gauss";
    if (l.sel?.kind === "domain") {
      const d = l.spec.domains.find((q) => q.id === l.sel?.id);
      if (d) info = `${d.id} · ${d.shearMin !== null ? "shear well" : "clock domain"} · size ${d.extent.toFixed(1)} · rate ${d.rate.toFixed(2)} · drifts ${d.changes.length}   [ ] size · - = rate · , . drift at t · Del`;
    } else if (l.sel?.kind === "emitter") {
      const e = l.spec.emitters.find((q) => q.id === l.sel?.id);
      if (e) info = `${e.id} · period ${e.period.toFixed(1)} (own clock) · in ${e.domain}   - = period · H heat · Del`;
    } else if (l.sel?.kind === "probe") info = "probe — drag it anywhere; it reads the causal timeline at that point";
    // wrap the hint line to the available width (max 2 lines)
    c.font = `400 10px ${FONT}`;
    const maxW = w - 28;
    const words = info.split(" ");
    let line = "", ly = botTop + 120, lines = 0;
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (c.measureText(test).width > maxW && line && lines < 1) {
        text(c, line, 14, ly, 10, "rgba(180,200,220,0.7)");
        line = wd; ly += 13; lines++;
      } else line = test;
    }
    if (line) text(c, line, 14, ly, 10, "rgba(180,200,220,0.7)");

    if (toast && now < toast.until) {
      c.font = `700 12px ${FONT}`;
      const tw = c.measureText(toast.text).width + 28;
      c.fillStyle = "rgba(127,219,202,0.92)"; c.fillRect(w / 2 - tw / 2, botTop - 34, tw, 26);
      text(c, toast.text, w / 2, botTop - 20, 12, "#05070b", "center", "700");
    }
  }

  return {
    isOpen: () => lab !== null,
    lab: () => lab,
    open(spec) {
      lab = newLab(spec ?? defaultWorld());
      lastRev = -1;
      drag = null; scrubbing = false; wf.clear();
    },
    close() { lab = null; drag = null; scrubbing = false; wf.clear(); },
    draw(ctx, w, h, now, dt) {
      if (!lab) return;
      if (lab.playing) {
        lab.t += dt * SPEEDS[lab.speedIdx];
        if (lab.t >= TMAX) { lab.t = TMAX; lab.playing = false; }
      }
      if (lab.rev !== lastRev) { lastRev = lab.rev; hooks.onChange(lab.spec); }
      layout(ctx, w, h);
      ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, w, h);
      drawWorld(ctx, lab, now);
      drawToolbar(ctx, lab);
      drawBottom(ctx, lab, now);
    },
    key(k, shift) {
      const l = lab;
      if (!l) return false;
      const n = Number(k);
      if (n >= 1 && n <= TOOLS.length) { l.tool = TOOLS[n - 1].id; return true; }
      if (k in LAW_HOTKEY && !shift) { lawStep(LAW_HOTKEY[k]); return true; }
      switch (k) {
        case " ": activate("play"); return true;
        case "arrowleft": l.t = Math.max(0, l.t - (shift ? 5 : 1)); return true;
        case "arrowright": l.t = Math.min(TMAX, l.t + (shift ? 5 : 1)); return true;
        case "h": activate("heat"); return true;
        case "l": activate("link"); return true;
        case "escape": hooks.onExit(); return true;
        case "delete": case "backspace": if (l.sel) removeSel(l, l.sel); return true;
        case "[": if (l.sel) adjust(l, l.sel, "size", -1); return true;
        case "]": if (l.sel) adjust(l, l.sel, "size", 1); return true;
        case "-": if (l.sel) adjust(l, l.sel, l.sel.kind === "emitter" ? "period" : "rate", l.sel.kind === "emitter" ? 1 : -1); return true;
        case "=": case "+": if (l.sel) adjust(l, l.sel, l.sel.kind === "emitter" ? "period" : "rate", l.sel.kind === "emitter" ? -1 : 1); return true;
        case ",": case ".":
          if (l.sel && !driftRate(l, l.sel, k === "," ? 0.5 : 2)) say("scrub past the last drift (domains only)");
          return true;
        default: return false;
      }
    },
    pointerDown(x, y) {
      const l = lab;
      if (!l) return;
      const b = btns.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
      if (b) { activate(b.id); return; }
      if (y >= geo.botTop && y <= geo.botTop + 40 && x >= geo.trackX0 - 12) { scrubbing = true; setT(x); return; }
      const p = toWorld(x, y);
      if (inWorld(p)) place(p);
    },
    pointerMove(x, y) {
      const l = lab;
      if (!l) return;
      if (scrubbing) { setT(x); return; }
      if (drag) { const p = toWorld(x, y); moveSel(l, drag, p); }
    },
    pointerUp() { drag = null; scrubbing = false; },
  };
}
