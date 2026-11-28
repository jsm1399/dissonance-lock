import test from "node:test";
import assert from "node:assert/strict";
import { TRIALS } from "../src/lab/trials.js";
import { addFeedback, adjustFeedback, clearDrifts, cycleBulk, newLab, removeFeedback, setDepth } from "../src/lab/lab.js";
import { validate, parseWorld } from "../src/lab/world.js";
import { emptySave, parseSave } from "../src/game/save.js";
import type { Lab } from "../src/lab/lab.js";

const trial = (id: string) => TRIALS.find((t) => t.id === id)!;
const fresh = (id: string): Lab => { const t = trial(id), l = newLab(t.world()); l.t = t.t; return l; };
const times = (n: number, f: () => unknown) => { for (let i = 0; i < n; i++) f(); };

test("trials: every world is valid, ids are unique, and none is solved on arrival", () => {
  assert.equal(new Set(TRIALS.map((t) => t.id)).size, TRIALS.length);
  for (const t of TRIALS) {
    assert.deepEqual(validate(t.world()), [], t.id);
    assert.ok(parseWorld(t.world()), t.id);
    const l = fresh(t.id);
    const r = t.check(l);
    assert.equal(r.ok, false, `${t.id} must start broken`);
    assert.ok(r.status.length > 0);
  }
});

test("trial Runaway: damping the loop passes; deleting it does not", () => {
  const l = fresh("runaway");
  assert.match(trial("runaway").check(l).status, /RUNAWAY/);
  times(3, () => adjustFeedback(l, "A", "gain", -1));
  assert.equal(trial("runaway").check(l).ok, false, "slightly less runaway is still runaway");
  times(6, () => adjustFeedback(l, "A", "gain", -1));
  assert.equal(trial("runaway").check(l).ok, true);
  const cheat = fresh("runaway");
  removeFeedback(cheat, "A"); removeFeedback(cheat, "B");
  assert.equal(trial("runaway").check(cheat).ok, false);
  const half = fresh("runaway");
  removeFeedback(half, "A"); // B still taps A but the cycle is broken: no loop left
  assert.equal(trial("runaway").check(half).ok, false);
});

test("trial Ring Forever: some gain setting reaches marginal; overshoot and deletion fail", () => {
  const solved: number[] = [];
  for (let n = -12; n <= 12; n++) {
    const l = fresh("ring");
    times(Math.abs(n), () => adjustFeedback(l, "A", "gain", n < 0 ? -1 : 1));
    if (trial("ring").check(l).ok) solved.push(n);
  }
  assert.ok(solved.length >= 1 && solved.length <= 3, `solution window: ${solved}`);
  const l = fresh("ring");
  times(8, () => adjustFeedback(l, "A", "gain", 1));
  assert.equal(trial("ring").check(l).ok, false);
  removeFeedback(l, "A");
  assert.equal(trial("ring").check(l).ok, false);
});

test("trial Quiet the Clock: flattening the drifting clock restores arithmetic time", () => {
  const l = fresh("clock");
  const r0 = trial("clock").check(l);
  assert.equal(r0.ok, false);
  assert.match(r0.status, /BENT|BROKEN|AMBIGUOUS/);
  assert.equal(clearDrifts(l, "f"), true);
  assert.equal(trial("clock").check(l).ok, true);
  assert.equal(clearDrifts(l, "f"), false, "already flat");
  assert.equal(clearDrifts(l, "nope"), false);
});

test("trial Fan-Out: passive with both taps passes; one tap, or a silenced tap, does not", () => {
  const l = fresh("fanout");
  assert.match(trial("fanout").check(l).status, /energy created/);
  times(5, () => { adjustFeedback(l, "A", "gain", -1); adjustFeedback(l, "B", "gain", -1); });
  assert.equal(trial("fanout").check(l).ok, true);
  const one = fresh("fanout");
  removeFeedback(one, "B");
  assert.equal(trial("fanout").check(one).ok, false);
  const quiet = fresh("fanout");
  times(30, () => adjustFeedback(quiet, "A", "gain", -1));
  times(30, () => adjustFeedback(quiet, "B", "gain", -1));
  assert.equal(trial("fanout").check(quiet).ok, false, "silencing both taps is not a repair");
  const rewired = fresh("fanout");
  addFeedback(rewired, "S", "A", 1, 0.5); addFeedback(rewired, "S", "B", 1, 0.5);
  assert.equal(trial("fanout").check(rewired).ok, true);
  void setDepth;
});

test("save: cleared trials persist, dedupe and survive garbage", () => {
  assert.deepEqual(emptySave(6).trials, []);
  const s = parseSave(JSON.stringify({ trials: ["runaway", "ring", "runaway", 7, null] }), 6);
  assert.deepEqual(s.trials, ["runaway", "ring"]);
  assert.deepEqual(parseSave(JSON.stringify({ trials: "x" }), 6).trials, []);
  assert.deepEqual(parseSave("not json", 6).trials, []);
});

test("trial Hidden Heading: only the right hidden coordinates pass; moving E or leaving 4D does not", () => {
  const t = trial("heading");
  const probe = { kind: "probe" as const, id: "probe" };
  const go = (l: Lab, z: number, w: number) => {
    times(Math.abs(z) / 4, () => setDepth(l, probe, z > 0 ? 4 : -4, "z"));
    times(Math.abs(w) / 4, () => setDepth(l, probe, w > 0 ? 4 : -4, "w"));
  };
  assert.match(t.check(fresh("heading")).status, /14\.4/, "starts far: reads the norm");
  for (const [z, w] of [[8, -8], [12, -12], [-12, 8], [0, 0], [12, 0]] as [number, number][]) {
    const l = fresh("heading"); go(l, z, w);
    assert.equal(t.check(l).ok, false, `(${z},${w}) is not E's slice`);
  }
  const l = fresh("heading"); go(l, 12, -8);
  assert.equal(t.check(l).ok, true);
  const moved = fresh("heading"); go(moved, 12, -8);
  setDepth(moved, { kind: "emitter", id: "E" }, -12, "z"); // drag E onto the probe instead
  setDepth(moved, { kind: "emitter", id: "E" }, 8, "w");
  assert.equal(t.check(moved).ok, false, "moving E is refused");
  const flat = fresh("heading");
  cycleBulk(flat); cycleBulk(flat); // 4D -> off
  assert.equal(t.check(flat).ok, false, "leaving 4D is refused");
});

test("trial Common Slice: only the hidden address E and F share passes; G's address and the origin do not", () => {
  const t = trial("common");
  const probe = { kind: "probe" as const, id: "probe" };
  const go = (l: Lab, z: number, w: number) => {
    times(Math.abs(z) / 4, () => setDepth(l, probe, z > 0 ? 4 : -4, "z"));
    times(Math.abs(w) / 4, () => setDepth(l, probe, w > 0 ? 4 : -4, "w"));
  };
  assert.equal(t.check(fresh("common")).ok, false, "starts in the wrong slice");
  for (const [z, w] of [[-8, 12], [0, 0], [12, 0], [8, -8]] as [number, number][]) {
    const l = fresh("common"); go(l, z, w);
    assert.equal(t.check(l).ok, false, `(${z},${w}) is not the shared slice`);
  }
  const l = fresh("common"); go(l, 12, -8);
  assert.equal(t.check(l).ok, true);
  const moved = fresh("common"); go(moved, 12, -8);
  setDepth(moved, { kind: "emitter", id: "F" }, -4, "z");
  assert.equal(t.check(moved).ok, false, "editing the sky is refused");
  const flat = fresh("common"); cycleBulk(flat);
  assert.equal(t.check(flat).ok, false, "leaving 4D is refused");
});
