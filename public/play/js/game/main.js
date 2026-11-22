import { LEVELS, TUTORIAL } from "./levels.js";
import { MAX_CHARGES, newGame, stars, step, TICK, WORLD } from "./state.js";
import { generateLevel } from "./gen.js";
import { SAVE_KEY, dailyKey, dailySeed, parseSave, shareText } from "./save.js";
import { advanceTutor, hintFor, newTutor, tutorProgress } from "./tutorial.js";
import { readPad } from "./pad.js";
import { draw, layout, resetRender } from "./render.js";
import { sfx } from "./sfx.js";
import { createObservatory } from "../lab/observatory.js";
import { decodeWorld, encodeWorld, parseWorld } from "../lab/world.js";
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
// ---------- persistence ----------
function loadSave() {
    try {
        return parseSave(localStorage.getItem(SAVE_KEY), LEVELS.length);
    }
    catch {
        return parseSave(null, LEVELS.length);
    }
}
function writeSave() {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    }
    catch { /* storage unavailable */ }
}
let save = loadSave();
let run = { kind: "campaign", idx: 0, depth: 1, daily: false, seed: 0, carry: MAX_CHARGES };
let game = null;
let tutor = null;
let acc = 0;
let anchorQueued = false;
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const starStr = (n) => "★".repeat(n) + "☆".repeat(3 - n);
// ---------- observatory ----------
const LAB_KEY = "dissonance-lock.lab.v1";
const labLink = (spec) => `${location.origin}${location.pathname}#w=${encodeWorld(spec)}`;
const obs = createObservatory({
    onChange(spec) {
        try {
            localStorage.setItem(LAB_KEY, JSON.stringify(spec));
        }
        catch { /* storage unavailable */ }
        try {
            history.replaceState(null, "", `#w=${encodeWorld(spec)}`);
        }
        catch { /* ignore */ }
    },
    onExit() {
        obs.close();
        try {
            history.replaceState(null, "", location.pathname + location.search);
        }
        catch { /* ignore */ }
        toMenu();
    },
    link: labLink,
    copy: async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        }
        catch {
            return false;
        }
    },
});
function openLab(spec) {
    let w = spec;
    if (!w) {
        try {
            w = parseWorld(localStorage.getItem(LAB_KEY) ?? "") ?? undefined;
        }
        catch {
            w = undefined;
        }
    }
    game = null;
    tutor = null;
    ui.hint = null;
    obs.open(w);
    ui.screen = "lab";
    sfx.unlock();
}
let actions = [];
function buildMenu() {
    const items = [];
    actions = [];
    const add = (m, a) => { items.push(m); actions.push(a); };
    add({ key: "0", title: TUTORIAL.name, blurb: TUTORIAL.blurb, right: save.tutorial ? "done ✓" : "start here" }, startTutorial);
    LEVELS.forEach((L, i) => add({ key: String(i + 1), title: L.name, blurb: L.blurb,
        right: save.best[i] === null ? "—" : `${starStr(save.stars[i])} ${fmtTime(save.best[i])}` }, () => startCampaign(i)));
    const today = dailyKey(new Date());
    add({ key: "D", title: "Daily Drift", blurb: `endless · same worlds for everyone · ${today}`,
        right: save.daily.key === today && save.daily.depth > 0 ? `depth ${save.daily.depth}` : "—" }, () => startDrift(true));
    add({ key: "F", title: "Free Drift", blurb: "endless · random seed · each depth is harder",
        right: save.driftBest > 0 ? `best ${save.driftBest}` : "—" }, () => startDrift(false));
    add({ key: "O", title: "Observatory", blurb: "build strata · scrub time · probe causality · share by link", right: "sandbox" }, () => openLab());
    return items;
}
const ui = {
    screen: "title", sel: save.tutorial ? 1 : 0, menu: buildMenu(), end: null, hint: null, toast: null, muted: false,
    anchorAt: -1e9, heardAt: -1e9, heardHue: 0,
    hits: {
        rows: [], anchor: { x: 0, y: 0, w: 0, h: 0 }, menu: { x: 0, y: 0, w: 0, h: 0 }, copy: { x: 0, y: 0, w: 0, h: 0 },
    },
};
let view = layout(innerWidth, innerHeight);
function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = layout(innerWidth, innerHeight);
}
function launch() {
    const level = run.kind === "tutorial" ? TUTORIAL
        : run.kind === "campaign" ? LEVELS[run.idx]
            : generateLevel(run.seed, run.depth);
    game = newGame(level);
    if (run.kind === "drift")
        game.charges = run.carry;
    tutor = run.kind === "tutorial" ? newTutor(game) : null;
    ui.hint = null;
    resetRender();
    acc = 0;
    anchorQueued = false;
    ui.end = null;
    ui.screen = "play";
    sfx.unlock();
}
const base = (kind) => ({ kind, idx: 0, depth: 1, daily: false, seed: 0, carry: MAX_CHARGES });
function startTutorial() { run = base("tutorial"); launch(); }
function startCampaign(i) { run = { ...base("campaign"), idx: Math.max(0, Math.min(LEVELS.length - 1, i)) }; launch(); }
function startDrift(daily) {
    const seed = daily ? dailySeed(dailyKey(new Date())) : (Math.random() * 4294967296) >>> 0;
    run = { ...base("drift"), daily, seed };
    launch();
}
function startItem(i) { actions[i]?.(); }
function toMenu() {
    game = null;
    tutor = null;
    ui.hint = null;
    resetRender();
    ui.menu = buildMenu();
    ui.screen = "title";
}
function restart() {
    if (run.kind === "drift") {
        run.depth = 1;
        run.carry = MAX_CHARGES;
    }
    launch();
}
function toast(text) { ui.toast = { text, until: performance.now() + 1800 }; }
function copyResult() {
    if (!ui.end?.copy)
        return;
    const cleared = run.kind === "drift" ? (game?.phase === "won" ? run.depth : run.depth - 1) : 0;
    const label = run.daily ? `Daily Drift ${dailyKey(new Date())}` : "Free Drift";
    const text = shareText(label, cleared, `${location.origin}/play/`);
    try {
        void navigator.clipboard.writeText(text).then(() => toast("result copied"), () => toast("copy unavailable"));
    }
    catch {
        toast("copy unavailable");
    }
}
// ---------- input ----------
const keys = new Set();
const pointer = { down: false, x: 0, y: 0 };
let padPrev = { confirm: false, back: false, pause: false, up: false, down: false };
function readInput() {
    let dx = 0, dy = 0;
    if (keys.has("arrowleft") || keys.has("a"))
        dx -= 1;
    if (keys.has("arrowright") || keys.has("d"))
        dx += 1;
    if (keys.has("arrowup") || keys.has("w"))
        dy -= 1;
    if (keys.has("arrowdown") || keys.has("s"))
        dy += 1;
    const pad = readPad(navigator.getGamepads?.()[0]);
    if (dx === 0 && dy === 0) {
        dx = pad.dx;
        dy = pad.dy;
    }
    if (dx === 0 && dy === 0 && pointer.down && game) {
        const tx = (pointer.x - view.x0) / view.s - game.pos[0];
        const ty = (pointer.y - view.y0) / view.s - game.pos[1];
        const d = Math.hypot(tx, ty);
        if (d > 0.3) {
            const m = Math.min(1, d / 3);
            dx = (tx / d) * m;
            dy = (ty / d) * m;
        }
    }
    return { dx, dy, anchor: anchorQueued };
}
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
function advance() {
    const won = game?.phase === "won";
    if (run.kind === "tutorial") {
        if (won)
            startCampaign(0);
        else
            launch();
    }
    else if (run.kind === "campaign") {
        if (won && run.idx < LEVELS.length - 1) {
            run.idx++;
            launch();
        }
        else if (won)
            toMenu();
        else
            launch();
    }
    else if (won) {
        run.depth++;
        launch();
    }
    else {
        run = { ...run, depth: 1, carry: MAX_CHARGES, seed: run.daily ? run.seed : (Math.random() * 4294967296) >>> 0 };
        launch();
    }
}
addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
    if (e.repeat && k === " ")
        return;
    sfx.unlock();
    if (ui.screen === "lab") {
        if (obs.key(k, e.shiftKey))
            e.preventDefault();
        return;
    }
    if (k === "m") {
        ui.muted = sfx.toggle();
        return;
    }
    if (ui.screen === "title") {
        const n = ui.menu.length;
        const hit = ui.menu.findIndex((m) => m.key.toLowerCase() === k);
        if (hit >= 0)
            startItem(hit);
        else if (k === "enter" || k === " ")
            startItem(ui.sel);
        else if (k === "arrowup" || k === "w")
            ui.sel = (ui.sel + n - 1) % n;
        else if (k === "arrowdown" || k === "s")
            ui.sel = (ui.sel + 1) % n;
        return;
    }
    if (ui.screen === "end") {
        if (k === "enter" || k === " ")
            advance();
        else if (k === "escape")
            toMenu();
        else if (k === "c")
            copyResult();
        return;
    }
    if (ui.screen === "pause") {
        if (k === "p")
            ui.screen = "play";
        else if (k === "escape")
            toMenu();
        else if (k === "r")
            restart();
        return;
    }
    if (k === "p" || k === "escape") {
        ui.screen = "pause";
        keys.clear();
        return;
    }
    if (k === "r") {
        restart();
        return;
    }
    if (k === " ") {
        anchorQueued = true;
        return;
    }
    keys.add(k);
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => { keys.clear(); pointer.down = false; if (ui.screen === "play")
    ui.screen = "pause"; obs.pointerUp(); });
canvas.addEventListener("pointerdown", (e) => {
    sfx.unlock();
    pointer.x = e.offsetX;
    pointer.y = e.offsetY;
    if (ui.screen === "lab") {
        obs.pointerDown(e.offsetX, e.offsetY);
        canvas.setPointerCapture(e.pointerId);
        return;
    }
    if (ui.screen === "title") {
        const i = ui.hits.rows.findIndex((r) => inside(r, e.offsetX, e.offsetY));
        if (i >= 0) {
            ui.sel = i;
            startItem(i);
        }
        return;
    }
    if (ui.screen === "end") {
        if (ui.end?.copy && inside(ui.hits.copy, e.offsetX, e.offsetY))
            copyResult();
        else
            advance();
        return;
    }
    if (ui.screen === "pause") {
        if (inside(ui.hits.menu, e.offsetX, e.offsetY))
            toMenu();
        else
            ui.screen = "play";
        return;
    }
    if (inside(ui.hits.anchor, e.offsetX, e.offsetY)) {
        anchorQueued = true;
        return;
    }
    pointer.down = true;
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
    pointer.x = e.offsetX;
    pointer.y = e.offsetY;
    if (ui.screen === "lab")
        obs.pointerMove(e.offsetX, e.offsetY);
});
const up = () => { pointer.down = false; obs.pointerUp(); };
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);
/** Gamepad edge-triggered actions (movement is polled in readInput). */
function pollPadButtons() {
    const p = readPad(navigator.getGamepads?.()[0]);
    const edge = (cur, prev) => cur && !prev;
    const confirm = edge(p.confirm, padPrev.confirm), back = edge(p.back, padPrev.back);
    const pause = edge(p.pause, padPrev.pause), upE = edge(p.up, padPrev.up), downE = edge(p.down, padPrev.down);
    padPrev = { confirm: p.confirm, back: p.back, pause: p.pause, up: p.up, down: p.down };
    if (ui.screen === "title") {
        const n = ui.menu.length;
        if (upE)
            ui.sel = (ui.sel + n - 1) % n;
        if (downE)
            ui.sel = (ui.sel + 1) % n;
        if (confirm)
            startItem(ui.sel);
    }
    else if (ui.screen === "end") {
        if (confirm)
            advance();
        if (back)
            toMenu();
    }
    else if (ui.screen === "pause") {
        if (confirm || pause)
            ui.screen = "play";
        if (back)
            toMenu();
    }
    else if (ui.screen === "play") {
        if (confirm)
            anchorQueued = true;
        if (pause)
            ui.screen = "pause";
    }
}
// ---------- game events ----------
function onWon(g) {
    const t = Math.round(g.time * 10) / 10;
    const st = stars(g);
    if (run.kind === "tutorial") {
        save.tutorial = true;
        writeSave();
        ui.end = {
            title: "CALIBRATED", good: true,
            lines: ["You can read the echoes.", "Campaign next: new domains bend time."],
            prompt: "Enter · Level 1",
        };
    }
    else if (run.kind === "campaign") {
        const prev = save.best[run.idx];
        if (prev === null || t < prev)
            save.best[run.idx] = t;
        save.stars[run.idx] = Math.max(save.stars[run.idx], st);
        save.tutorial = true;
        writeSave();
        const last = run.idx >= LEVELS.length - 1;
        ui.end = {
            title: last ? "ALL LOCKS HELD" : "LOCK ACHIEVED", good: true,
            lines: [`${g.level.name} · ${fmtTime(g.time)} · anchors used ${g.anchors}`, starStr(st)],
            prompt: last ? "Enter · menu" : "Enter · next level",
        };
    }
    else {
        const today = dailyKey(new Date());
        save.driftBest = Math.max(save.driftBest, run.depth);
        if (run.daily)
            save.daily = { key: today, depth: save.daily.key === today ? Math.max(save.daily.depth, run.depth) : run.depth };
        writeSave();
        run.carry = Math.min(MAX_CHARGES, g.charges + 1);
        ui.end = {
            title: `DEPTH ${run.depth} CLEARED`, good: true,
            lines: [`${fmtTime(g.time)} · anchors used ${g.anchors}`, `charges carried: ${run.carry}`],
            prompt: "Enter · descend", copy: true,
        };
    }
    ui.screen = "end";
    sfx.win();
}
function onLost(g) {
    if (run.kind === "drift") {
        const cleared = run.depth - 1;
        ui.end = {
            title: "DRIFT ENDED", good: false,
            lines: [`cleared ${cleared} level${cleared === 1 ? "" : "s"}`, run.daily ? "daily seed: same worlds again" : "new seed on retry"],
            prompt: "Enter · try again", copy: true,
        };
    }
    else {
        ui.end = { title: "OVERLOAD", good: false, lines: [`${g.level.name} · ${fmtTime(g.time)}`], prompt: "Enter · retry" };
    }
    ui.screen = "end";
    sfx.lose();
}
function handleEvents(g) {
    for (const ev of g.events) {
        if (ev.kind === "heard") {
            const hue = g.level.beacons[ev.pulse.beacon].hue;
            ui.heardAt = performance.now();
            ui.heardHue = hue;
            sfx.heard(hue);
        }
        else if (ev.kind === "anchor") {
            ui.anchorAt = performance.now();
            sfx.anchor();
        }
        else if (ev.kind === "won")
            onWon(g);
        else if (ev.kind === "lost")
            onLost(g);
    }
}
// ---------- loop ----------
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    pollPadButtons();
    if (ui.screen === "play" && game) {
        acc += dt;
        for (let n = 0; acc >= TICK && n < 5 && game.phase === "playing"; n++) {
            step(game, readInput());
            anchorQueued = false;
            acc -= TICK;
            handleEvents(game);
            if (tutor)
                advanceTutor(tutor, game);
        }
        if (tutor && game.phase === "playing") {
            const h = hintFor(tutor);
            ui.hint = { text: h.text, sub: h.sub, progress: tutorProgress(tutor) };
        }
        else
            ui.hint = null;
    }
    if (ui.screen === "lab")
        obs.draw(ctx, innerWidth, innerHeight, now, dt);
    else
        draw(ctx, game, ui, view, now);
    requestAnimationFrame(frame);
}
addEventListener("resize", resize);
resize();
// test/inspection hook
window.__dl = {
    startItem,
    state: () => ({
        screen: ui.screen, run: { ...run }, phase: game?.phase ?? null, time: game?.time ?? 0,
        dissonance: game?.dissonance ?? 0, lock: game?.lock ?? 0, pos: game?.pos ?? null, world: WORLD,
        tag: game?.level.tag ?? null, end: ui.end, charges: game?.charges ?? 0,
        tutorStep: tutor?.step ?? null, hint: ui.hint?.text ?? null, menuLen: ui.menu.length,
    }),
    game: () => game,
    save: () => save,
    lab: () => obs.lab(),
    openLab,
};
if (location.hash.startsWith("#w=")) {
    const shared = decodeWorld(location.hash.slice(3));
    if (shared)
        openLab(shared);
}
if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
requestAnimationFrame(frame);
