import test from "node:test";
import assert from "node:assert/strict";
import { countInversions } from "../src/core/strata/index.js";
import { newLab, metrics, cycleLaw } from "../src/lab/lab.js";
import { spacetime, causalCone, MARGIN } from "../src/lab/spacetime.js";
import { defaultWorld } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

const uniform = (): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [
    { id: "e1", domain: "root", pos: [20, 50], period: 4, phase: 0, hue: 10 },
    { id: "e2", domain: "root", pos: [80, 50], period: 4, phase: 0, hue: 200 },
  ],
});

test("spacetime: lines are geometry — distance, causal arrival, heard flag", () => {
  const lab = newLab(defaultWorld());
  lab.t = 60;
  const st = spacetime(lab);
  assert.ok(st.lines.length > 4);
  for (const l of st.lines) {
    const e = lab.spec.emitters.find((x) => x.id === l.emitter)!;
    const p = lab.tree.toRootPos(e.domain, e.pos);
    assert.ok(Math.abs(l.dist - Math.hypot(p[0] - lab.probe[0], p[1] - lab.probe[1])) < 1e-9);
    assert.ok(l.arrival >= l.launch, "a signal never arrives before it is launched");
    assert.equal(l.heard, l.arrival <= lab.t);
    assert.ok(l.dist <= st.dmax);
  }
});

test("spacetime: uniform medium — slope is exactly 1/speed, no inversions at the centre", () => {
  const lab = newLab(uniform());
  lab.probe = [50, 50];
  lab.t = 40;
  const st = spacetime(lab);
  assert.equal(st.inversions, 0);
  for (const l of st.lines) assert.ok(Math.abs(l.arrival - l.launch - l.dist / 6) < 0.02);
  assert.ok(st.lines.every((l) => !l.inverted));
});

test("spacetime: an off-centre probe sees inversions, and they equal the dissonance definition", () => {
  const lab = newLab(uniform());
  lab.probe = [25, 50];
  lab.t = 40;
  const st = spacetime(lab);
  assert.ok(st.inversions > 0);
  const live = st.lines.filter((l) => l.heard && l.arrival >= lab.t - 12);
  assert.equal(
    st.inversions,
    countInversions(live.map((l) => ({ emitRoot: l.launch, perceivedAt: l.arrival })), MARGIN),
  );
  assert.ok(st.lines.some((l) => l.inverted));
});

test("spacetime: its inversion count agrees with the Observatory's probe metrics", () => {
  for (const t of [40, 70, 110]) {
    const lab = newLab(defaultWorld());
    lab.t = t;
    assert.equal(spacetime(lab).inversions, metrics(lab).inversions, `t=${t}`);
  }
});

test("spacetime: causal horizon is the newest heard emission per emitter, nearest first", () => {
  const lab = newLab(uniform());
  lab.probe = [50, 50];
  lab.t = 40;
  const st = spacetime(lab);
  assert.equal(st.horizon.length, 2);
  for (let i = 1; i < st.horizon.length; i++) assert.ok(st.horizon[i].dist >= st.horizon[i - 1].dist);
  for (const h of st.horizon) {
    const ideal = lab.t - h.dist / 6;
    assert.ok(h.launch <= ideal + 1e-6, "cannot have heard something not yet arrived");
    assert.ok(h.launch >= ideal - 4 - 1e-6, "newest heard is within one period of the light line");
  }
});

test("spacetime: laws change the diagram — global time + uniform medium collapse lag to pure distance", () => {
  const lab = newLab(defaultWorld());
  lab.t = 60;
  const before = spacetime(lab).lines.map((l) => Math.round((l.arrival - l.launch) * 100));
  cycleLaw(lab, "time"); cycleLaw(lab, "medium");
  const after = spacetime(lab);
  assert.notDeepEqual(before, after.lines.map((l) => Math.round((l.arrival - l.launch) * 100)));
  for (const l of after.lines) assert.ok(Math.abs(l.arrival - l.launch - l.dist / lab.spec.rootSpeed) < 0.05);
});

test("causal cone: uniform medium — future/past/independent follow |dt| vs distance/speed exactly", () => {
  const lab = newLab(uniform());
  lab.probe = [50, 50];
  lab.t = 60;
  const st = spacetime(lab);
  const cone = causalCone(lab, st, "e1");
  assert.ok(cone);
  const gap = 60 / 6; // e1 and e2 are 60 apart
  let seen = { past: 0, future: 0, independent: 0 };
  for (const [l, rel] of cone.rel) {
    const dt = l.launch - cone.origin.launch;
    const same = l.emitter === "e1";
    const want = same ? (dt > 0 ? "future" : "past")
      : dt >= gap - 1e-6 ? "future" : dt <= -gap + 1e-6 ? "past" : "independent";
    if (!same && Math.abs(Math.abs(dt) - gap) < 0.05) continue; // on the light line itself
    assert.equal(rel, want, `${l.emitter}#${l.k} dt=${dt.toFixed(2)}`);
    seen[rel]++;
  }
  assert.ok(seen.past > 0 && seen.future >= 0 && seen.independent > 0, JSON.stringify(seen));
  assert.equal(cone.past + cone.future + cone.independent, st.lines.length - 1);
});

test("causal cone: relations are antisymmetric between two emitters' newest pulses", () => {
  for (const spec of [uniform(), defaultWorld()]) {
    const lab = newLab(spec);
    lab.t = 80;
    const st = spacetime(lab);
    const ids = lab.spec.emitters.map((e) => e.id);
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const ca = causalCone(lab, st, a)!, cb = causalCone(lab, st, b)!;
      const ra = ca.rel.get(cb.origin), rb = cb.rel.get(ca.origin);
      if (ra === "future") assert.equal(rb, "past", `${a}->${b}`);
      if (ra === "past") assert.equal(rb, "future", `${a}->${b}`);
      if (ra === "independent") assert.equal(rb, "independent", `${a}->${b}`);
    }
  }
});

test("causal cone: same-emitter pulses are ordered; unknown emitter gives null", () => {
  const lab = newLab(defaultWorld());
  lab.t = 80;
  const st = spacetime(lab);
  assert.equal(causalCone(lab, st, "nope"), null);
  const c = causalCone(lab, st, "e2")!;
  for (const [l, rel] of c.rel) if (l.emitter === "e2") assert.equal(rel, l.k > c.origin.k ? "future" : "past");
});

test("causal cone: aroundLaunch picks the pulse nearest that time and finds both a past and a future", () => {
  const lab = newLab(uniform());
  lab.probe = [50, 50];
  lab.t = 60;
  const st = spacetime(lab);
  const c = causalCone(lab, st, "e1", 40)!;
  const best = Math.min(...st.lines.filter((l) => l.emitter === "e1").map((l) => Math.abs(l.launch - 40)));
  assert.ok(Math.abs(c.origin.launch - 40) <= best + 1e-9);
  assert.ok(c.past > 0 && c.future > 0 && c.independent > 0);
});
