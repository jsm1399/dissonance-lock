import { contour, sliceWavefront, wavefront } from "../core/strata/index.js";
import { FONT, hsl, text } from "../game/render.js";
import { LAWFUL } from "../core/laws/index.js";
import { LAW_KEYS, SIZE, SPEEDS, TMAX, addDomain, addEmitter, addRelay, adjust, clearCuts, emitterPos, setDepth, toggleBulk, toggleCut, auditEmitter, computeHeat, cycleLaw, driftRate, emissionsUpTo, fieldOf, hitTest, isBent, metrics, moveSel, newLab, perceived, pumpFields, removeSel, resetLaws, } from "./lab.js";
import { apparentDepth } from "./bulk.js";
import { causalCone, spacetime } from "./spacetime.js";
import { defaultWorld, lawsOf } from "./world.js";
const TOOLS = [
    { id: "select", label: "SELECT" }, { id: "fast", label: "FAST" }, { id: "well", label: "WELL" },
    { id: "micro", label: "MICRO" }, { id: "emit", label: "EMIT" }, { id: "relay", label: "RELAY" }, { id: "erase", label: "ERASE" },
];
const BOT_H = 150;
const LAW_HOTKEY = { t: "time", m: "medium", d: "dim", x: "loss", n: "noise", g: "gauss", p: "path" };
const LAW_TITLE = { time: "TIME", medium: "MEDIUM", dim: "DIM", loss: "LOSS", noise: "NOISE", gauss: "GAUSS", path: "PATH" };
const lawValue = (k, L) => (k === "dim" ? String(L.dim) : String(L[k]).toUpperCase());
const lawLabel = (k, L) => `${LAW_TITLE[k]}·${lawValue(k, L)}`;
const lawIsDefault = (k, L) => L[k] === LAWFUL[k];
const probeSiteOf = (l) => (l.spec.bulk ? [l.probe[0], l.probe[1], l.probeZ] : [l.probe[0], l.probe[1]]);
const sci = (x) => (x === 0 ? "0" : Math.abs(x) >= 0.01 && Math.abs(x) < 1000 ? x.toPrecision(3) : x.toExponential(1));
export function createObservatory(hooks) {
    let lab = null;
    let geo = { st: { x: 0, y: 0, w: 0, h: 0 }, w: 0, h: 0, x0: 0, y0: 0, s: 1, tbH: 48, botTop: 0, trackX0: 0, trackX1: 0, trackY: 0 };
    let btns = [];
    let drag = null;
    let scrubbing = false;
    let toast = null;
    let lastRev = -1;
    let view = "map";
    const wf = new Map();
    const say = (t, now = performance.now()) => { toast = { text: t, until: now + 1800 }; };
    function layout(ctx, w, h) {
        const l = lab;
        const laws = lawsOf(l.spec);
        const items = [
            ...TOOLS,
            { id: "play", label: l.playing ? "PAUSE" : "PLAY" },
            { id: "speed", label: `×${SPEEDS[l.speedIdx]}` },
            { id: "heat", label: l.heat ? "HEAT ✓" : "HEAT" },
            { id: "cut", label: "CUT" }, { id: "uncut", label: l.spec.cuts?.length ? `UNCUT·${l.spec.cuts.length}` : "UNCUT" },
            { id: "link", label: "LINK" }, { id: "reset", label: "RESET" }, { id: "menu", label: "MENU" },
            { id: "view", label: view === "st" ? "VIEW·SPACETIME" : "VIEW·MAP" },
            { id: "bulk", label: l.spec.bulk ? "BULK·ON" : "BULK·OFF" },
            ...LAW_KEYS.map((k, i) => ({ id: `law:${k}`, label: lawLabel(k, laws), brk: i === 0 })),
            { id: "lawful", label: "LAWFUL" },
        ];
        btns = [];
        let x = 8, y = 8;
        ctx.font = `700 11px ${FONT}`;
        for (const it of items) {
            const bw = Math.max(46, Math.ceil(ctx.measureText(it.label).width) + 18);
            if (it.brk && x > 8) {
                x = 8;
                y += 34;
            }
            if (x + bw > w - 8) {
                x = 8;
                y += 34;
            }
            btns.push({ id: it.id, label: it.label, x, y, w: bw, h: 28 });
            x += bw + 6;
        }
        const tbH = y + 36;
        const avail = Math.max(120, Math.min(w - 16, h - tbH - BOT_H - 8));
        const st = { x: 8, y: tbH + 4, w: w - 16, h: Math.max(120, h - tbH - BOT_H - 8) };
        let s = avail / SIZE, x0 = (w - s * SIZE) / 2, y0 = tbH + 4;
        if (view === "st") {
            // the map shrinks to a fully interactive inset in the top-left of the diagram
            const side = Math.max(110, Math.min(st.w * 0.28, st.h * 0.26));
            s = side / SIZE;
            x0 = st.x + 46;
            y0 = st.y + 12;
        }
        geo = {
            st, w, h, s, x0, y0, tbH, botTop: h - BOT_H,
            trackX0: 64, trackX1: w - 20, trackY: h - BOT_H + 20,
        };
    }
    const toWorld = (px, py) => [(px - geo.x0) / geo.s, (py - geo.y0) / geo.s];
    const inWorld = (p) => p[0] >= 0 && p[0] <= SIZE && p[1] >= 0 && p[1] <= SIZE;
    function activate(id) {
        const l = lab;
        if (id === "play") {
            if (l.t >= TMAX)
                l.t = 0;
            l.playing = !l.playing;
        }
        else if (id === "speed")
            l.speedIdx = (l.speedIdx + 1) % SPEEDS.length;
        else if (id === "heat") {
            if (l.heat)
                l.heat = null;
            else {
                const target = l.sel?.kind === "emitter" ? l.sel.id : l.spec.emitters[0]?.id;
                if (!target || !computeHeat(l, target))
                    say("add an emitter first");
            }
        }
        else if (id === "link") {
            void hooks.copy(hooks.link(l.spec)).then((ok) => say(ok ? "link copied" : "copy unavailable"));
        }
        else if (id === "reset") {
            const keepTool = l.tool;
            lab = newLab(defaultWorld());
            lab.tool = keepTool;
            wf.clear();
            say("world reset");
        }
        else if (id === "bulk") {
            const on = toggleBulk(l);
            wf.clear();
            say(on ? "bulk ON: a hidden axis (Z / Shift+Z), DIM 3" : "bulk OFF: flat plane");
        }
        else if (id === "cut") {
            if (l.sel?.kind !== "emitter")
                say("select an emitter, then CUT its highlighted pulse");
            else {
                const c = causalCone(l, spacetime(l), l.sel.id, l.t - 0.3 * SPAN);
                if (!c)
                    say("no pulse to cut yet");
                else {
                    toggleCut(l, c.origin.emitter, c.origin.k);
                    wf.clear();
                    say(`cut ${c.origin.emitter} pulse ${c.origin.k}`);
                }
            }
        }
        else if (id === "uncut") {
            clearCuts(l);
            wf.clear();
            say("history restored");
        }
        else if (id === "view") {
            view = view === "map" ? "st" : "map";
            wf.clear();
            say(view === "st" ? "spacetime: probe frame" : "map view");
        }
        else if (id === "menu")
            hooks.onExit();
        else if (id === "lawful") {
            resetLaws(l);
            wf.clear();
            say("laws restored: lawful");
        }
        else if (id.startsWith("law:"))
            lawStep(id.slice(4));
        else
            l.tool = id;
    }
    function lawStep(k) {
        const l = lab;
        const next = cycleLaw(l, k);
        wf.clear();
        say(`${LAW_TITLE[k]} → ${lawValue(k, next).toLowerCase()}`);
    }
    function place(p) {
        const l = lab;
        if (l.tool === "select") {
            const hit = hitTest(l, p);
            l.sel = hit;
            if (hit)
                drag = hit;
            else {
                moveSel(l, { kind: "probe", id: "probe" }, p);
                l.sel = { kind: "probe", id: "probe" };
            }
        }
        else if (l.tool === "erase") {
            const hit = hitTest(l, p);
            if (hit && hit.kind !== "probe")
                removeSel(l, hit);
            else
                say("nothing to erase");
        }
        else if (l.tool === "relay") {
            const hit = hitTest(l, p);
            if (hit?.kind === "emitter") {
                l.sel = hit;
                say(`relay source ${hit.id}: click empty space to place`);
            }
            else if (l.sel?.kind !== "emitter")
                say("click a source emitter first");
            else {
                const id = addRelay(l, p, l.sel.id);
                if (id) {
                    l.sel = { kind: "emitter", id };
                    l.tool = "select";
                }
                else
                    say("emitter limit reached");
            }
        }
        else if (l.tool === "emit") {
            const id = addEmitter(l, p);
            if (id)
                l.sel = { kind: "emitter", id };
            else
                say("emitter limit reached");
            l.tool = "select";
        }
        else {
            const id = addDomain(l, l.tool, p);
            if (id) {
                l.sel = { kind: "domain", id };
                l.tool = "select";
            }
            else
                say(l.tool === "micro" ? "place MICRO inside a domain" : "domain limit reached");
        }
    }
    function setT(px) {
        const l = lab;
        const f = Math.min(1, Math.max(0, (px - geo.trackX0) / (geo.trackX1 - geo.trackX0)));
        l.t = f * TMAX;
    }
    // ---------- drawing ----------
    function drawWorld(c, l, now) {
        const { x0, y0, s } = geo;
        const X = (x) => x0 + x * s, Y = (y) => y0 + y * s;
        c.save();
        c.beginPath();
        c.rect(x0, y0, SIZE * s, SIZE * s);
        c.clip();
        c.fillStyle = "#070a12";
        c.fillRect(x0, y0, SIZE * s, SIZE * s);
        c.strokeStyle = "rgba(255,255,255,0.045)";
        for (let k = 0; k <= SIZE; k += 10) {
            c.beginPath();
            c.moveTo(X(k), Y(0));
            c.lineTo(X(k), Y(SIZE));
            c.stroke();
            c.beginPath();
            c.moveTo(X(0), Y(k));
            c.lineTo(X(SIZE), Y(k));
            c.stroke();
        }
        // heat (causal landscape)
        if (l.heat) {
            const f = l.heat.field, e = l.spec.emitters.find((q) => q.id === l.heat?.emitter);
            if (e) {
                const hue = e.hue, launch = l.tree.toRootTime(e.domain, l.heat.launchLocal);
                const cs = (SIZE * s) / f.n;
                for (let j = 0; j < f.n; j++)
                    for (let i = 0; i < f.n; i++) {
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
            if (d.shear) {
                g.addColorStop(0, "rgba(160,90,255,0.32)");
                g.addColorStop(1, "rgba(160,90,255,0.03)");
            }
            else {
                const a = Math.min(0.3, 0.05 + 0.04 * rate);
                g.addColorStop(0, `rgba(80,220,255,${a})`);
                g.addColorStop(1, `rgba(80,220,255,${a * 0.4})`);
            }
            c.beginPath();
            c.arc(cx, cy, r, 0, Math.PI * 2);
            c.fillStyle = g;
            c.fill();
            c.strokeStyle = d.shear ? "rgba(160,90,255,0.6)" : "rgba(80,220,255,0.6)";
            c.setLineDash([4, 4]);
            c.stroke();
            c.setLineDash([]);
            text(c, d.shear ? `${d.id} ·shear` : `${d.id} ×${rate.toFixed(2)}${def && def.changes.length ? " ⟲" : ""}`, cx, cy - r - 7, 10, d.shear ? "rgba(190,150,255,0.9)" : "rgba(130,230,255,0.9)", "center");
        }
        // wavefronts
        const used = new Set();
        const bent = isBent(l);
        for (const em of emissionsUpTo(l, l.t, 3)) {
            const age = l.t - em.launchRoot;
            if (age < 0 || age > 45)
                continue;
            const key = `${l.rev}|${em.emitter}|${em.k}`;
            used.add(key);
            const f = bent ? fieldOf(l, em) : null;
            if (f) {
                // bent law: the true wavefront is the level set arrival == now of the Fermat field
                c.beginPath();
                for (const sg of contour(f, [0, 0], [SIZE, SIZE], l.t)) {
                    c.moveTo(X(sg[0]), Y(sg[1]));
                    c.lineTo(X(sg[2]), Y(sg[3]));
                }
                c.strokeStyle = hsl(em.hue, 80, 62, Math.max(0.1, 0.75 - age / 55));
                c.lineWidth = 1.5;
                c.stroke();
                continue;
            }
            let c0 = wf.get(key);
            const off = Math.abs(em.pos[2] ?? 0) > 1e-9; // emitter hovering off the plane: draw the shell's section
            if (!c0 || Math.abs(l.t - c0.t) >= (off ? 0.5 : 0.12)) {
                c0 = {
                    t: l.t,
                    poly: off ? (age > 25 ? null : sliceWavefront(l.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, l.t, 24, 170))
                        : wavefront(l.tree, { domain: em.domain, pos: em.pos }, em.launchLocal, l.t, 48, 170, 1.5),
                };
                wf.set(key, c0);
            }
            if (!c0.poly)
                continue;
            c.beginPath();
            c0.poly.forEach((q, i) => (i === 0 ? c.moveTo(X(q[0]), Y(q[1])) : c.lineTo(X(q[0]), Y(q[1]))));
            c.closePath();
            c.strokeStyle = hsl(em.hue, 80, 62, Math.max(0.1, 0.75 - age / 55));
            c.lineWidth = 1.5;
            c.stroke();
        }
        c.lineWidth = 1;
        for (const k of wf.keys())
            if (!used.has(k))
                wf.delete(k);
        // relay links (cause -> effect)
        for (const e of l.spec.emitters) {
            if (!e.relay)
                continue;
            const src = l.spec.emitters.find((q) => q.id === e.relay?.from);
            if (!src)
                continue;
            const a = l.tree.toRootPos(src.domain, emitterPos(l, src)), b = l.tree.toRootPos(e.domain, emitterPos(l, e));
            c.setLineDash([2, 3]);
            c.strokeStyle = hsl(e.hue, 70, 65, 0.6);
            c.beginPath();
            c.moveTo(X(a[0]), Y(a[1]));
            c.lineTo(X(b[0]), Y(b[1]));
            c.stroke();
            c.setLineDash([]);
        }
        // emitters
        for (const e of l.spec.emitters) {
            const p = l.tree.toRootPos(e.domain, emitterPos(l, e)), cx = X(p[0]), cy = Y(p[1]);
            if (l.spec.bulk && Math.abs(e.z ?? 0) > 1e-9) {
                const up = e.z > 0, len = Math.min(16, Math.abs(e.z) * 0.4) * s;
                c.strokeStyle = hsl(e.hue, 60, 65, 0.7);
                c.setLineDash([2, 2]);
                c.beginPath();
                c.moveTo(cx, cy);
                c.lineTo(cx, cy + (up ? -len : len));
                c.stroke();
                c.setLineDash([]);
                text(c, `z${up ? "+" : ""}${e.z.toFixed(0)}`, cx + 4 * s, cy + (up ? -len : len), 9, hsl(e.hue, 80, 78), "left");
            }
            c.beginPath();
            c.arc(cx, cy, 2.2 * s, 0, Math.PI * 2);
            c.fillStyle = hsl(e.hue, 80, 60, 0.16);
            c.fill();
            c.beginPath();
            c.arc(cx, cy, 1.4 * s, 0, Math.PI * 2);
            c.fillStyle = hsl(e.hue, 85, 62);
            c.fill();
            if (e.relay) {
                c.strokeStyle = hsl(e.hue, 85, 70);
                c.strokeRect(cx - 1.9 * s, cy - 1.9 * s, 3.8 * s, 3.8 * s);
            }
            text(c, e.id, cx, cy - 3.2 * s, 10, hsl(e.hue, 80, 78), "center", "700");
        }
        // probe
        const px = X(l.probe[0]), py = Y(l.probe[1]), pr = 1.8 * s;
        c.strokeStyle = "#fff";
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(px, py, pr, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.moveTo(px - pr * 1.6, py);
        c.lineTo(px + pr * 1.6, py);
        c.moveTo(px, py - pr * 1.6);
        c.lineTo(px, py + pr * 1.6);
        c.stroke();
        c.lineWidth = 1;
        if (l.spec.bulk && Math.abs(l.probeZ) > 1e-9)
            text(c, `z${l.probeZ > 0 ? "+" : ""}${l.probeZ.toFixed(0)}`, px + pr * 2, py - pr * 1.6, 9, "#fff", "left");
        // selection ring
        if (l.sel) {
            let sp = null, sr = 3 * s;
            if (l.sel.kind === "probe")
                sp = l.probe;
            else if (l.sel.kind === "emitter") {
                const e = l.spec.emitters.find((q) => q.id === l.sel?.id);
                if (e)
                    sp = l.tree.toRootPos(e.domain, emitterPos(l, e));
            }
            else {
                const d = l.tree.domains().find((q) => q.id === l.sel?.id);
                if (d) {
                    sp = d.centerRoot;
                    sr = d.radiusRoot * s + 3;
                }
            }
            if (sp) {
                c.strokeStyle = `rgba(255,255,255,${0.55 + 0.25 * Math.sin(now / 200)})`;
                c.setLineDash([2, 3]);
                c.beginPath();
                c.arc(X(sp[0]), Y(sp[1]), l.sel.kind === "domain" ? sr : sr, 0, Math.PI * 2);
                c.stroke();
                c.setLineDash([]);
            }
        }
        c.restore();
        c.strokeStyle = "rgba(255,255,255,0.25)";
        c.strokeRect(x0 + 0.5, y0 + 0.5, SIZE * s - 1, SIZE * s - 1);
    }
    // ---------- spacetime: the probe's causal diagram ----------
    const SPAN = 60;
    function drawSpacetime(c, l) {
        const R = geo.st;
        const st = spacetime(l);
        const cone = l.sel?.kind === "emitter" ? causalCone(l, st, l.sel.id, l.t - 0.3 * SPAN) : null;
        const px = R.x + 40, pw = R.w - 52, py = R.y + 8, ph = R.h - 42;
        const tmin = l.t - 0.72 * SPAN;
        const X = (d) => px + (1 - d / st.dmax) * pw;
        const T = (t) => py + ph - ((t - tmin) / SPAN) * ph;
        const clipT = (t) => Math.min(py + ph, Math.max(py, T(t)));
        c.save();
        c.fillStyle = "#070a12";
        c.fillRect(R.x, R.y, R.w, R.h);
        c.beginPath();
        c.rect(R.x, R.y, R.w, R.h);
        c.clip();
        c.lineWidth = 1;
        for (let t = Math.ceil(tmin / 10) * 10; t < tmin + SPAN; t += 10) {
            const y = T(t);
            c.strokeStyle = "rgba(255,255,255,0.05)";
            c.beginPath();
            c.moveTo(px, y);
            c.lineTo(px + pw, y);
            c.stroke();
            text(c, `${t}s`, px - 6, y, 10, "rgba(180,200,220,0.5)", "right");
        }
        // emitter worldlines; ticks are the emitter's OWN clock beats seen in root time
        for (const e of l.spec.emitters) {
            const p = l.tree.toRootPos(e.domain, emitterPos(l, e));
            const d = Math.hypot(...p.map((x, i) => x - (probeSiteOf(l)[i] ?? 0)));
            const x = X(d);
            c.strokeStyle = hsl(e.hue, 60, 50, 0.22);
            c.beginPath();
            c.moveTo(x, py);
            c.lineTo(x, py + ph);
            c.stroke();
            text(c, e.id, x, py + ph + 12, 10, hsl(e.hue, 80, 75), "center", "700");
        }
        for (const ln of st.lines) {
            c.fillStyle = hsl(ln.hue, 80, 65, 0.9);
            c.fillRect(X(ln.dist) - 3, clipT(ln.launch) - 0.5, 6, 1.5);
        }
        // signals: dim whole path, bright the part already travelled
        const v0 = l.spec.rootSpeed;
        const byKey = new Map(st.lines.map((q) => [`${q.emitter}|${q.k}`, q]));
        c.setLineDash([2, 3]);
        c.lineWidth = 1;
        c.strokeStyle = "rgba(255,255,255,0.35)";
        for (const ln of st.lines) {
            const cause = ln.cause ? byKey.get(ln.cause) : undefined;
            if (!cause)
                continue;
            c.beginPath();
            c.moveTo(X(cause.dist), T(cause.launch));
            c.lineTo(X(ln.dist), T(ln.launch));
            c.stroke();
        }
        c.setLineDash([]);
        c.strokeStyle = "#ff4d6d";
        c.lineWidth = 2;
        for (const k of st.cuts) {
            const cx = X(k.dist), cy = T(k.launch);
            if (cy < py || cy > py + ph)
                continue;
            c.beginPath();
            c.moveTo(cx - 5, cy - 5);
            c.lineTo(cx + 5, cy + 5);
            c.moveTo(cx + 5, cy - 5);
            c.lineTo(cx - 5, cy + 5);
            c.stroke();
        }
        c.lineWidth = 1;
        if (cone) {
            // ideal light cone of the selected pulse (the true classification below uses the real medium)
            const o = cone.origin, ox = X(o.dist), oy = T(o.launch);
            const reachD = Math.max(0, (tmin + SPAN - o.launch)) * v0, reachP = Math.max(0, o.launch - tmin) * v0;
            c.setLineDash([3, 4]);
            c.lineWidth = 1;
            c.strokeStyle = "rgba(127,219,202,0.5)";
            for (const sgn of [-1, 1]) {
                c.beginPath();
                c.moveTo(ox, oy);
                c.lineTo(X(o.dist + sgn * reachD), T(tmin + SPAN));
                c.stroke();
            }
            c.strokeStyle = "rgba(255,180,84,0.5)";
            for (const sgn of [-1, 1]) {
                c.beginPath();
                c.moveTo(ox, oy);
                c.lineTo(X(o.dist + sgn * reachP), T(tmin));
                c.stroke();
            }
            c.setLineDash([]);
        }
        for (const ln of st.lines) {
            const rel = cone?.rel.get(ln);
            c.globalAlpha = rel === "independent" ? 0.3 : 1;
            const x0 = X(ln.dist), y0 = T(ln.launch), x1 = X(0), y1 = T(ln.arrival);
            c.strokeStyle = hsl(ln.hue, 70, 55, 0.22);
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x0, y0);
            c.lineTo(x1, y1);
            c.stroke();
            const f = ln.arrival > ln.launch ? Math.min(1, Math.max(0, (l.t - ln.launch) / (ln.arrival - ln.launch))) : 1;
            if (f > 0) {
                c.strokeStyle = hsl(ln.hue, 85, 65, 0.9);
                c.lineWidth = 1.6;
                c.beginPath();
                c.moveTo(x0, y0);
                c.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
                c.stroke();
            }
            if (ln.heard) {
                c.beginPath();
                c.arc(x1, y1, 4, 0, Math.PI * 2);
                c.fillStyle = hsl(ln.hue, 80, 60);
                c.fill();
                if (ln.inverted) {
                    c.lineWidth = 2;
                    c.strokeStyle = "#ff4d6d";
                    c.stroke();
                }
            }
            c.globalAlpha = 1;
            if (cone?.caused.has(ln)) {
                c.strokeStyle = "#7fdbca";
                c.lineWidth = 2;
                c.beginPath();
                c.arc(x0, clipT(ln.launch), 7, 0, Math.PI * 2);
                c.stroke();
                c.lineWidth = 1;
            }
            if (rel === "future" || rel === "past") {
                const mx = x0, my = clipT(ln.launch), up = rel === "future";
                c.fillStyle = up ? "#7fdbca" : "#ffb454";
                c.beginPath();
                c.moveTo(mx, my + (up ? -9 : 9));
                c.lineTo(mx - 5, my + (up ? -1 : 1));
                c.lineTo(mx + 5, my + (up ? -1 : 1));
                c.closePath();
                c.fill();
            }
        }
        if (cone) {
            const o = cone.origin;
            c.strokeStyle = "#fff";
            c.lineWidth = 3;
            c.beginPath();
            c.moveTo(X(o.dist), T(o.launch));
            c.lineTo(X(0), T(o.arrival));
            c.stroke();
            c.beginPath();
            c.arc(X(o.dist), T(o.launch), 5, 0, Math.PI * 2);
            c.fillStyle = "#fff";
            c.fill();
        }
        c.lineWidth = 1;
        // lawful light line (uniform medium) and the probe's actual causal horizon
        const v = l.spec.rootSpeed;
        c.setLineDash([5, 5]);
        c.strokeStyle = "rgba(255,255,255,0.4)";
        c.beginPath();
        c.moveTo(X(0), T(l.t));
        c.lineTo(X(st.dmax), T(l.t - st.dmax / v));
        c.stroke();
        c.setLineDash([]);
        if (st.horizon.length > 0) {
            c.strokeStyle = "#ffffff";
            c.lineWidth = 2;
            c.beginPath();
            st.horizon.forEach((h, i) => (i === 0 ? c.moveTo(X(h.dist), T(h.launch)) : c.lineTo(X(h.dist), T(h.launch))));
            c.stroke();
            c.lineWidth = 1;
            for (const h of st.horizon) {
                c.beginPath();
                c.arc(X(h.dist), T(h.launch), 3, 0, Math.PI * 2);
                c.fillStyle = "#fff";
                c.fill();
            }
        }
        c.strokeStyle = "rgba(127,219,202,0.85)";
        c.beginPath();
        c.moveTo(px, T(l.t));
        c.lineTo(px + pw, T(l.t));
        c.stroke();
        c.strokeStyle = "rgba(255,255,255,0.7)";
        c.beginPath();
        c.moveTo(X(0), py);
        c.lineTo(X(0), py + ph);
        c.stroke();
        text(c, "NOW", px + pw - 4, T(l.t) - 8, 10, "#7fdbca", "right", "700");
        text(c, "PROBE", X(0) - 4, py + 8, 10, "#fff", "right", "700");
        text(c, `SPACETIME · inversions ${st.inversions}`, px + pw - 4, py + 22, 11, st.inversions > 0 ? "#ff4d6d" : "rgba(127,219,202,0.95)", "right", "700");
        if (cone) {
            text(c, `${cone.origin.emitter} pulse ${cone.origin.k} · ▲ future ${cone.future} · ▼ past ${cone.past} · independent ${cone.independent}${cone.caused.size > 0 ? ` · caused ${cone.caused.size}` : ""}`, px + pw - 4, py + 36, 11, "#ffffff", "right", "700");
        }
        else
            text(c, "select an emitter in the inset → its causal cone", px + pw - 4, py + 36, 10, "rgba(180,200,220,0.6)", "right");
        const dep = l.spec.bulk && l.sel?.kind === "emitter" ? apparentDepth(l, l.sel.id) : null;
        if (dep) {
            text(c, `bulk · ${dep.emitter}: apparent depth ${dep.apparent.toFixed(1)} · actual ${dep.actual.toFixed(1)} (flat-medium estimate)`, px + pw - 4, py + 50, 10, "#ffb454", "right");
        }
        const cap = R.w < 640 ? "dashed: lawful light · white: causal horizon · red: out of order"
            : "distance from probe ← · time ↑ · dashed: lawful light line · white: causal horizon · red: heard out of order";
        text(c, cap, px + pw, py + ph + 28, 9, "rgba(180,200,220,0.55)", "right");
        c.restore();
        c.strokeStyle = "rgba(255,255,255,0.25)";
        c.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
    }
    function drawToolbar(c, l) {
        for (const b of btns) {
            const isLaw = b.id.startsWith("law:");
            const bent = isLaw && !lawIsDefault(b.id.slice(4), lawsOf(l.spec));
            const on = (b.id === "bulk" && !!l.spec.bulk) || (b.id === l.tool) || (b.id === "heat" && !!l.heat) || (b.id === "play" && l.playing);
            const col = bent ? "#ffb454" : "#7fdbca";
            c.fillStyle = bent ? "rgba(255,180,84,0.16)" : on ? "rgba(127,219,202,0.22)" : "rgba(255,255,255,0.05)";
            c.fillRect(b.x, b.y, b.w, b.h);
            c.strokeStyle = bent || on ? col : isLaw ? "rgba(160,90,255,0.45)" : "rgba(255,255,255,0.22)";
            c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
            text(c, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, 11, bent || on ? col : "#cfd8e3", "center", "700");
        }
    }
    function drawBottom(c, l, now) {
        const { w, botTop, trackX0, trackX1, trackY } = geo;
        c.fillStyle = "rgba(255,255,255,0.03)";
        c.fillRect(0, botTop, w, BOT_H);
        text(c, "TIME", 14, trackY, 10, "rgba(180,200,220,0.6)");
        c.fillStyle = "rgba(255,255,255,0.1)";
        c.fillRect(trackX0, trackY - 2, trackX1 - trackX0, 4);
        const kx = trackX0 + (l.t / TMAX) * (trackX1 - trackX0);
        c.fillStyle = "#7fdbca";
        c.fillRect(trackX0, trackY - 2, kx - trackX0, 4);
        c.beginPath();
        c.arc(kx, trackY, 8, 0, Math.PI * 2);
        c.fillStyle = "#e8f1ff";
        c.fill();
        // drift markers on the timeline
        for (const d of l.spec.domains)
            for (const [pt] of d.changes) {
                const rootT = l.tree.toRootTime(d.parent, pt);
                const mx = trackX0 + (rootT / TMAX) * (trackX1 - trackX0);
                c.fillStyle = "rgba(160,90,255,0.9)";
                c.fillRect(mx - 1, trackY - 8, 2, 16);
            }
        text(c, `t ${l.t.toFixed(1)}s`, trackX1, trackY + 16, 11, "#e8f1ff", "right", "700");
        const m = metrics(l);
        text(c, "PROBE", 14, botTop + 46, 10, "rgba(180,200,220,0.6)");
        text(c, `spread ${m.spread.toFixed(1)}s · inversions ${m.inversions} · heard ${m.heard}${l.pending > 0 ? ` · solving bent paths (${l.pending})` : ""}`, 64, botTop + 46, 12, "rgba(220,232,248,0.95)");
        const heard = perceived(l).filter((p) => p.arrival >= l.t - 12).slice(-12);
        const byEmit = heard.slice().sort((a, b) => a.emission.launchRoot - b.emission.launchRoot);
        let maxRank = -1;
        heard.forEach((p, i) => {
            const rank = byEmit.indexOf(p) + 1, bad = rank - 1 < maxRank;
            maxRank = Math.max(maxRank, rank - 1);
            const cx = 24 + i * 30, cy = botTop + 92;
            c.beginPath();
            c.arc(cx, cy, 11, 0, Math.PI * 2);
            c.fillStyle = hsl(p.emission.hue, 70, 45, 0.9);
            c.fill();
            c.lineWidth = bad ? 3 : 1;
            c.strokeStyle = bad ? "#ff4d6d" : "rgba(255,255,255,0.4)";
            c.stroke();
            c.lineWidth = 1;
            text(c, String(rank), cx, cy + 1, 10, "#fff", "center", "700");
        });
        if (heard.length === 0)
            text(c, "probe has heard nothing yet — press PLAY or drag TIME", 14, botTop + 92, 11, "rgba(180,200,220,0.45)");
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
        let info = "Click the world to move the probe. Pick a tool to build. Keys 1-7 tools · Space play · ←/→ time · H heat · V spacetime · K cut pulse · U uncut · B bulk · Z depth · L link · laws: T time · M medium · D dim · X loss · N noise · G gauss · P path (straight/bent)";
        if (l.sel?.kind === "domain") {
            const d = l.spec.domains.find((q) => q.id === l.sel?.id);
            if (d)
                info = `${d.id} · ${d.shearMin !== null ? "shear well" : "clock domain"} · size ${d.extent.toFixed(1)} · rate ${d.rate.toFixed(2)} · drifts ${d.changes.length}   [ ] size · - = rate · , . drift at t · Del`;
        }
        else if (l.sel?.kind === "emitter") {
            const e = l.spec.emitters.find((q) => q.id === l.sel?.id);
            if (e)
                info = e.relay
                    ? `${e.id} · relay of ${e.relay.from} +${e.relay.delay.toFixed(1)} (own clock) · in ${e.domain}   - = delay · K cut pulse · H heat · Del`
                    : `${e.id} · period ${e.period.toFixed(1)} (own clock) · in ${e.domain}   - = period · K cut pulse · H heat · Del`;
        }
        else if (l.sel?.kind === "probe")
            info = "probe — drag it anywhere; it reads the causal timeline at that point";
        // wrap the hint line to the available width (max 2 lines)
        c.font = `400 10px ${FONT}`;
        const maxW = w - 28;
        const words = info.split(" ");
        let line = "", ly = botTop + 120, lines = 0;
        for (const wd of words) {
            const test = line ? `${line} ${wd}` : wd;
            if (c.measureText(test).width > maxW && line && lines < 1) {
                text(c, line, 14, ly, 10, "rgba(180,200,220,0.7)");
                line = wd;
                ly += 13;
                lines++;
            }
            else
                line = test;
        }
        if (line)
            text(c, line, 14, ly, 10, "rgba(180,200,220,0.7)");
        if (toast && now < toast.until) {
            c.font = `700 12px ${FONT}`;
            const tw = c.measureText(toast.text).width + 28;
            c.fillStyle = "rgba(127,219,202,0.92)";
            c.fillRect(w / 2 - tw / 2, botTop - 34, tw, 26);
            text(c, toast.text, w / 2, botTop - 20, 12, "#05070b", "center", "700");
        }
    }
    return {
        isOpen: () => lab !== null,
        lab: () => lab,
        view: () => view,
        open(spec) {
            lab = newLab(spec ?? defaultWorld());
            lastRev = -1;
            view = "map";
            drag = null;
            scrubbing = false;
            wf.clear();
        },
        close() { lab = null; drag = null; scrubbing = false; wf.clear(); },
        draw(ctx, w, h, now, dt) {
            if (!lab)
                return;
            if (lab.playing) {
                lab.t += dt * SPEEDS[lab.speedIdx];
                if (lab.t >= TMAX) {
                    lab.t = TMAX;
                    lab.playing = false;
                }
            }
            if (lab.rev !== lastRev) {
                lastRev = lab.rev;
                hooks.onChange(lab.spec);
            }
            pumpFields(lab);
            layout(ctx, w, h);
            ctx.fillStyle = "#05070b";
            ctx.fillRect(0, 0, w, h);
            if (view === "st")
                drawSpacetime(ctx, lab);
            drawWorld(ctx, lab, now);
            drawToolbar(ctx, lab);
            drawBottom(ctx, lab, now);
        },
        key(k, shift) {
            const l = lab;
            if (!l)
                return false;
            const n = Number(k);
            if (n >= 1 && n <= TOOLS.length) {
                l.tool = TOOLS[n - 1].id;
                return true;
            }
            if (k in LAW_HOTKEY && !shift) {
                lawStep(LAW_HOTKEY[k]);
                return true;
            }
            switch (k) {
                case " ":
                    activate("play");
                    return true;
                case "arrowleft":
                    l.t = Math.max(0, l.t - (shift ? 5 : 1));
                    return true;
                case "arrowright":
                    l.t = Math.min(TMAX, l.t + (shift ? 5 : 1));
                    return true;
                case "v":
                    activate("view");
                    return true;
                case "b":
                    activate("bulk");
                    return true;
                case "z": {
                    if (!l.spec.bulk) {
                        say("bulk is off: press B for a hidden axis");
                        return true;
                    }
                    const sel = l.sel && l.sel.kind !== "domain" ? l.sel : { kind: "probe", id: "probe" };
                    setDepth(l, sel, shift ? -4 : 4);
                    wf.clear();
                    say(`${sel.id} depth ${sel.kind === "probe" ? l.probeZ : (l.spec.emitters.find((q) => q.id === sel.id)?.z ?? 0)}`);
                    return true;
                }
                case "k":
                    activate("cut");
                    return true;
                case "u":
                    activate("uncut");
                    return true;
                case "h":
                    activate("heat");
                    return true;
                case "l":
                    activate("link");
                    return true;
                case "escape":
                    hooks.onExit();
                    return true;
                case "delete":
                case "backspace":
                    if (l.sel)
                        removeSel(l, l.sel);
                    return true;
                case "[":
                    if (l.sel)
                        adjust(l, l.sel, "size", -1);
                    return true;
                case "]":
                    if (l.sel)
                        adjust(l, l.sel, "size", 1);
                    return true;
                case "-":
                    if (l.sel)
                        adjust(l, l.sel, l.sel.kind === "emitter" ? "period" : "rate", l.sel.kind === "emitter" ? 1 : -1);
                    return true;
                case "=":
                case "+":
                    if (l.sel)
                        adjust(l, l.sel, l.sel.kind === "emitter" ? "period" : "rate", l.sel.kind === "emitter" ? -1 : 1);
                    return true;
                case ",":
                case ".":
                    if (l.sel && !driftRate(l, l.sel, k === "," ? 0.5 : 2))
                        say("scrub past the last drift (domains only)");
                    return true;
                default: return false;
            }
        },
        pointerDown(x, y) {
            const l = lab;
            if (!l)
                return;
            const b = btns.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
            if (b) {
                activate(b.id);
                return;
            }
            if (y >= geo.botTop && y <= geo.botTop + 40 && x >= geo.trackX0 - 12) {
                scrubbing = true;
                setT(x);
                return;
            }
            const p = toWorld(x, y);
            if (inWorld(p))
                place(p);
        },
        pointerMove(x, y) {
            const l = lab;
            if (!l)
                return;
            if (scrubbing) {
                setT(x);
                return;
            }
            if (drag) {
                const p = toWorld(x, y);
                moveSel(l, drag, p);
            }
        },
        pointerUp() { drag = null; scrubbing = false; },
    };
}
