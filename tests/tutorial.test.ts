import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIAL } from "../src/game/levels.js";
import { newGame, probeSpread, step, TICK, SPEED } from "../src/game/state.js";
import { advanceTutor, hintFor, newTutor, tutorProgress, TUTOR_STEPS } from "../src/game/tutorial.js";
import { readPad } from "../src/game/pad.js";
import { emptySave, parseSave, shareText } from "../src/game/save.js";
import { LEVELS } from "../src/game/levels.js";

test("tutorial: steps advance from observable state, never regress", () => {
  const g = newGame(TUTORIAL);
  const t = newTutor(g);
  assert.equal(t.step, 0);
  advanceTutor(t, g);
  assert.equal(t.step, 0, "needs movement first");
  g.pos = [60, 50];
  advanceTutor(t, g);
  assert.equal(t.step, 1);
  g.heardTotal = 3;
  advanceTutor(t, g);
  assert.equal(t.step, 2);
  g.time += 15;
  advanceTutor(t, g);
  assert.equal(t.step, 3, "read-order step times out");
  g.dissonance = 40;
  advanceTutor(t, g);
  assert.equal(t.step, 4);
  g.lock = 40;
  advanceTutor(t, g);
  assert.equal(t.step, 5);
  g.anchors = 1;
  advanceTutor(t, g);
  assert.equal(t.step, TUTOR_STEPS - 1);
  advanceTutor(t, g);
  assert.equal(t.step, TUTOR_STEPS - 1);
  assert.ok(hintFor(t).text.length > 0);
  assert.equal(tutorProgress(t), 1);
});

test("tutorial: a guided bot reaches the last step and wins", () => {
  const dirs: [number, number][] = [[0, 0]];
  for (let i = 0; i < 8; i++) dirs.push([Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  const g = newGame(TUTORIAL);
  const t = newTutor(g);
  const pStar = TUTORIAL.decay / TUTORIAL.gain;
  let reachedLast = false;
  while (g.phase === "playing" && g.time < 240) {
    const want = Math.min(1, Math.max(0, pStar + 0.006 * (45 - g.dissonance)));
    let best = dirs[0], bs = Infinity;
    for (const d of dirs) {
      const q = [Math.min(100, Math.max(0, g.pos[0] + d[0] * SPEED * TICK)), Math.min(100, Math.max(0, g.pos[1] + d[1] * SPEED * TICK))];
      const sc = Math.abs(Math.min(1, probeSpread(g, q) / TUTORIAL.spreadCap) - want);
      if (sc < bs) { bs = sc; best = d; }
    }
    // the player is told to re-anchor at step 5: do exactly that once
    const anchor = t.step === 5 || (g.dissonance > 92 && g.charges > 0);
    step(g, { dx: best[0], dy: best[1], anchor });
    advanceTutor(t, g);
    if (t.step === TUTOR_STEPS - 1) reachedLast = true;
  }
  assert.ok(reachedLast, "tutorial never reached its final step");
  assert.equal(g.phase, "won", `tutorial not winnable (t=${g.time.toFixed(0)} lock=${g.lock.toFixed(0)})`);
});

test("gamepad mapping: deadzone, d-pad, buttons", () => {
  const btn = (n: number[]) => Array.from({ length: 17 }, (_, i) => ({ pressed: n.includes(i) }));
  assert.deepEqual(readPad(null).dx, 0);
  const idle = readPad({ axes: [0.1, -0.15], buttons: btn([]) });
  assert.equal(idle.dx, 0);
  assert.equal(idle.dy, 0);
  const stick = readPad({ axes: [1, 0], buttons: btn([0]) });
  assert.equal(stick.dx, 1);
  assert.equal(stick.confirm, true);
  const dpad = readPad({ axes: [0, 0], buttons: btn([14, 12]) });
  assert.ok(Math.abs(Math.hypot(dpad.dx, dpad.dy) - 1) < 1e-9, "diagonal normalised");
  assert.ok(dpad.dx < 0 && dpad.dy < 0);
  assert.equal(readPad({ axes: [0, 0], buttons: btn([9]) }).pause, true);
  assert.equal(readPad({ axes: [0, -0.9], buttons: btn([]) }).up, true);
});

test("save: tutorial flag and share text", () => {
  const n = LEVELS.length;
  assert.equal(emptySave(n).tutorial, false);
  assert.equal(parseSave(JSON.stringify({ tutorial: true }), n).tutorial, true);
  assert.equal(parseSave(JSON.stringify({ tutorial: "yes" }), n).tutorial, false);
  const s = shareText("Daily Drift 2026-11-22", 4, "https://x.test/play/");
  assert.ok(s.includes("Daily Drift 2026-11-22") && s.includes("Depth 4 cleared") && s.includes("https://x.test/play/"));
});
