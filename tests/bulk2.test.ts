import test from "node:test";
import assert from "node:assert/strict";
import { addEmitter, arrivalAt, auditEmitter, cycleBulk, emissionsUpTo, hitTest, newLab, probeSite, removeSel, setDepth, triangulate } from "../src/lab/lab.js";
import { apparentDepth } from "../src/lab/bulk.js";
import { decodeWorld, encodeWorld, hiddenAxes, parseWorld, validate } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

let seed = 77;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const U = (a: number, b: number) => a + (b - a) * rnd();

const w4 = (z: number, w: number, extra: Partial<WorldSpec> = {}): WorldSpec => ({
  v: 1, rootSpeed: 6, bulk: true, bulk2: true, domains: [],
  emitters: [{ id: "E", domain: "root", pos: [30, 40], period: 4, phase: 0, hue: 10, z, w }],
  ...extra,
});

test("4D spec: bulk2 needs bulk, w needs bulk2, limits hold, links round-trip", () => {
  const ok = w4(9, -14);
  assert.deepEqual(validate(ok), []);
  assert.equal(hiddenAxes(ok), 2);
  assert.equal(hiddenAxes({ bulk: true }), 1);
  assert.equal(hiddenAxes({ bulk2: true }), 0, "a second axis without the first is not a world");
  assert.ok(validate({ ...ok, bulk: undefined }).length > 0);
  assert.ok(validate({ ...ok, bulk2: undefined }).length > 0, "w set but no second axis");
  assert.ok(validate(w4(0, 999)).length > 0);
  assert.ok(validate({ ...ok, bulk2: false as never }).length > 0);
  assert.equal(parseWorld(JSON.parse(JSON.stringify({ ...ok, bulk: undefined }))), null);
  const back = decodeWorld(encodeWorld(ok));
  assert.ok(back);
  assert.equal(back?.bulk2, true);
  assert.equal(back?.emitters[0].w, -14);
  assert.equal(newLab(ok).tree.dim, 4);
  assert.equal(newLab({ ...ok, bulk2: undefined, emitters: [{ ...ok.emitters[0], w: undefined }] }).tree.dim, 3);
});

test("4D lab: BULK cycles flat -> 3D -> 4D -> flat and a lawful DIM follows", () => {
  const l = newLab({ v: 1, rootSpeed: 6, domains: [], emitters: [{ id: "E", domain: "root", pos: [30, 40], period: 4, phase: 0, hue: 10 }] });
  assert.equal(cycleBulk(l), 1);
  assert.equal(l.spec.laws?.dim, 3);
  assert.equal(cycleBulk(l), 2);
  assert.equal(l.spec.laws?.dim, 4);
  assert.equal(l.tree.dim, 4);
  assert.equal(setDepth(l, { kind: "emitter", id: "E" }, 8, "w"), true);
  assert.equal(l.spec.emitters[0].w, 8);
  assert.equal(setDepth(l, { kind: "probe", id: "probe" }, 8, "w"), true);
  assert.equal(l.probeW, 8);
  assert.deepEqual(probeSite(l), [50, 50, 0, 8]);
  assert.deepEqual(validate(l.spec), []);
  assert.equal(cycleBulk(l), 0);
  assert.equal(l.spec.bulk, undefined);
  assert.equal(l.spec.bulk2, undefined);
  assert.equal(l.spec.emitters[0].w, undefined);
  assert.equal(l.probeW, 0);
  assert.notEqual(l.spec.laws?.dim, 4);
  assert.equal(setDepth(l, { kind: "emitter", id: "E" }, 8, "w"), false);
  cycleBulk(l);
  assert.equal(setDepth(l, { kind: "emitter", id: "E" }, 8, "w"), false, "no second axis in 3D");
});

test("4D lab: echoes cross the whole 4D distance (flat medium: arrival = distance / speed)", () => {
  for (let n = 0; n < 12; n++) {
    const z = U(-30, 30), w = U(-30, 30), pz = U(-20, 20), pw = U(-20, 20);
    const l = newLab(w4(z, w));
    l.t = 80; l.probe = [U(10, 90), U(10, 90)]; l.probeZ = pz; l.probeW = pw;
    const em = emissionsUpTo(l, 30, 1).find((e) => e.emitter === "E");
    assert.ok(em);
    if (!em) continue;
    const d = Math.hypot(30 - l.probe[0], 40 - l.probe[1], z - pz, w - pw);
    assert.ok(Math.abs(arrivalAt(l, em) - (em.launchRoot + d / 6)) < 1e-9, `n=${n}`);
    l.sel = { kind: "emitter", id: "E" };
    const a = apparentDepth(l, "E");
    assert.ok(a && Math.abs(a.actual - Math.hypot(z - pz, w - pw)) < 1e-9, "actual depth is the norm of the hidden vector");
  }
});

test("4D array: a plane array reads only the NORM of the hidden vector; lifted arrays read both signed coordinates", () => {
  for (const [z, w] of [[9, -14], [-6, 5], [0, 22], [-20, -20], [12, -9], [15, 0]]) {
    const l = newLab(w4(z, w));
    l.t = 60; l.probe = [60, 55]; l.probeZ = 2; l.probeW = -3; l.sel = { kind: "emitter", id: "E" };
    const r = triangulate(l);
    assert.ok(r && r.verdict === "flat" && r.lift && r.lift.w !== undefined, `${z},${w}`);
    if (!r || !r.lift) continue;
    assert.ok(Math.abs(r.fix.depth - Math.hypot(z - 2, w + 3)) < 1e-3, "plane array: norm of the offset");
    assert.ok(Math.abs(r.lift.z - z) < 1e-6 && Math.abs((r.lift.w as number) - w) < 1e-6, `lift read ${r.lift.z}, ${r.lift.w} want ${z}, ${w}`);
    assert.ok(r.errPos < 1e-6 && r.errT0 < 1e-6);
  }
  // hidden vectors of equal norm are indistinguishable to ONE plane array: only the lift tells them apart
  const a = newLab(w4(12, -9)), b = newLab(w4(15, 0));
  for (const l of [a, b]) { l.t = 60; l.probe = [60, 55]; l.sel = { kind: "emitter", id: "E" }; }
  const ra = triangulate(a), rb = triangulate(b);
  assert.ok(ra && rb);
  assert.ok(Math.abs((ra?.fix.depth ?? 0) - (rb?.fix.depth ?? 1)) < 1e-6);
  assert.ok(Math.abs((ra?.lift?.w ?? 0) - (rb?.lift?.w ?? 0)) > 5);
});

test("4D array: a warped medium is flagged and never trusted", () => {
  const spec = w4(9, -14, { domains: [{ id: "w", parent: "root", origin: [45, 48], scale: 1, extent: 14, echoSpeed: 6, rate: 1, shearMin: 0.2, changes: [] }] });
  const l = newLab(spec);
  l.t = 60; l.probe = [60, 55]; l.sel = { kind: "emitter", id: "E" };
  const r = triangulate(l);
  assert.ok(r && r.verdict === "warped");
});

test("4D energy: the audit measures the full 4D distance; DIM 4 Gauss holds, runaway and leaky are caught", () => {
  const laws = (gauss: "holds" | "leaky" | "runaway") => ({ time: "local", medium: "strata", dim: 4, loss: 0, noise: 0, gauss, path: "straight" }) as never;
  for (const [gauss, verdict] of [["holds", "conserved"], ["runaway", "created"], ["leaky", "destroyed"]] as const) {
    const l = newLab(w4(9, -14, { laws: laws(gauss) }));
    l.t = 40; l.probeZ = 3; l.probeW = 2;
    const au = auditEmitter(l, "E");
    assert.ok(au, gauss);
    assert.equal(au?.audit.verdict, verdict, gauss);
    assert.ok(Math.abs((au?.audit.r ?? 0) - Math.hypot(20, 10, 9 - 3, -14 - 2)) < 1e-9, "r is the distance in all four dimensions");
  }
});

test("4D edit storm: random edits including bulk cycling keep every world valid", () => {
  const l = newLab();
  for (let i = 0; i < 400; i++) {
    const at: [number, number] = [U(0, 100), U(0, 100)], r = rnd();
    if (r < 0.15) cycleBulk(l);
    else if (r < 0.3) addEmitter(l, at);
    else if (r < 0.5) { const h = hitTest(l, at); if (h) setDepth(l, h, rnd() < 0.5 ? 4 : -4, rnd() < 0.5 ? "z" : "w"); }
    else if (r < 0.6) setDepth(l, { kind: "probe", id: "probe" }, rnd() < 0.5 ? 4 : -4, rnd() < 0.5 ? "z" : "w");
    else if (r < 0.7) { const h = hitTest(l, at); if (h && h.kind !== "probe") removeSel(l, h); }
    else { l.t = U(20, 120); l.sel = { kind: "emitter", id: l.spec.emitters[0]?.id ?? "x" }; triangulate(l); }
    assert.deepEqual(validate(l.spec), [], `invalid at step ${i}`);
    assert.ok(parseWorld(JSON.parse(JSON.stringify(l.spec))) !== null, `unparseable at step ${i}`);
    assert.equal(l.tree.dim, 2 + hiddenAxes(l.spec));
  }
  assert.ok(decodeWorld(encodeWorld(l.spec)), "the storm world survives a link");
});
