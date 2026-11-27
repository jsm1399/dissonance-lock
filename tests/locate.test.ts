import test from "node:test";
import assert from "node:assert/strict";
import { locateND, locateSource } from "../src/core/strata/index.js";
import { TRI_FLAT, newLab, triSites, triangulate } from "../src/lab/lab.js";
import { defaultWorld } from "../src/lab/world.js";
import type { WorldSpec } from "../src/lab/world.js";

let seed = 31;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const U = (a: number, b: number) => a + (b - a) * rnd();
const SITES: [number, number][] = [[50, 50], [66, 50], [34, 50], [50, 66], [50, 34]];
const arrivalsOf = (x: number, y: number, h: number, t0: number, v: number) => SITES.map(([sx, sy]) => t0 + Math.sqrt((x - sx) ** 2 + (y - sy) ** 2 + h * h) / v);

test("locateSource: recovers position, |depth| and emission time exactly from five arrivals", () => {
  for (let n = 0; n < 60; n++) {
    const x = U(0, 100), y = U(0, 100), h = rnd() < 0.3 ? 0 : U(0, 40), t0 = U(0, 30), v = U(2, 12);
    const f = locateSource(SITES, arrivalsOf(x, y, h, t0, v), v);
    assert.ok(f && f.converged, `n=${n}`);
    if (!f) continue;
    assert.ok(Math.hypot(f.x - x, f.y - y) < 1e-4, `pos n=${n}`);
    assert.ok(Math.abs(f.depth - h) < 1e-3, `depth ${f.depth} vs ${h}`);
    assert.ok(Math.abs(f.t0 - t0) < 1e-5);
    assert.ok(f.residual < 1e-6);
  }
});

test("locateSource: above and below the plane are indistinguishable (mirror symmetry)", () => {
  const up = arrivalsOf(30, 70, 12, 2, 6), down = arrivalsOf(30, 70, -12, 2, 6);
  assert.deepEqual(up, down);
});

test("locateSource: timing noise degrades gracefully, and bad input is refused", () => {
  const a = arrivalsOf(70, 30, 10, 4, 6).map((t) => t + U(-0.002, 0.002));
  const f = locateSource(SITES, a, 6);
  assert.ok(f && Math.hypot(f.x - 70, f.y - 30) < 3);
  assert.ok(f && f.residual < 0.01);
  assert.equal(locateSource(SITES.slice(0, 4), a.slice(0, 4), 6), null, "four sites cannot overdetermine four unknowns");
  assert.equal(locateSource(SITES, a, 0), null);
  assert.equal(locateSource(SITES, [...a.slice(0, 4), NaN], 6), null);
  assert.equal(locateSource(SITES, a.slice(0, 3), 6), null);
});

const flatWorld = (over: Partial<WorldSpec["emitters"][0]> = {}, bulk = false): WorldSpec => ({
  v: 1, rootSpeed: 6, domains: [],
  emitters: [{ id: "E", domain: "root", pos: [30, 40], period: 4, phase: 0, hue: 10, ...over }],
  ...(bulk ? { bulk: true } : {}),
});

test("array: in a flat medium the lab recovers position, clock and a hidden height", () => {
  const l = newLab(flatWorld());
  l.t = 60; l.probe = [60, 55];
  assert.equal(triangulate(l), null, "no emitter selected");
  l.sel = { kind: "emitter", id: "E" };
  const r = triangulate(l);
  assert.ok(r && r.verdict === "flat");
  assert.ok(r && r.errPos < 1e-6 && r.errT0 < 1e-6 && r.fix.depth < 1e-3);
  assert.ok(r && Math.abs(r.rateEst - 1) < 1e-6);
  assert.equal(triangulate(l), r, "cached");
  assert.equal(triSites(l).length, 5);
  // hidden axis: the same emitter lifted off the plane is found at that height, from timing alone
  const b = newLab(flatWorld({ z: 14 } as never, true));
  b.t = 60; b.probe = [60, 55]; b.sel = { kind: "emitter", id: "E" };
  const rb = triangulate(b);
  assert.ok(rb && rb.verdict === "flat" && Math.abs(rb.fix.depth - 14) < 1e-3 && rb.errPos < 1e-4, JSON.stringify(rb?.fix));
  b.probeZ = 20; // the array moves up: the source is now 6 below its plane, indistinguishable from 6 above
  const rc = triangulate(b);
  assert.ok(rc && Math.abs(rc.fix.depth - 6) < 1e-3);
});

test("array: a drifting sender clock is recovered from two solved firing times", () => {
  const spec: WorldSpec = {
    v: 1, rootSpeed: 6,
    domains: [{ id: "f", parent: "root", origin: [30, 40], scale: 1, extent: 6, echoSpeed: 6, rate: 2, shearMin: null, changes: [[40, 3]] }],
    emitters: [{ id: "E", domain: "f", pos: [0, 0], period: 4, phase: 0, hue: 10 }],
  };
  for (const [t, want] of [[35, 2], [90, 3]] as const) {
    const l = newLab(spec);
    l.t = t; l.probe = [75, 60]; l.sel = { kind: "emitter", id: "E" };
    const r = triangulate(l);
    assert.ok(r && r.verdict === "flat", `t=${t}`);
    assert.ok(r && Math.abs(r.rateEst - want) < 1e-6 && Math.abs(r.rateTrue - want) < 1e-9, `rate ${r?.rateEst} want ${want}`);
  }
});

test("array: a warped medium is flagged, and 'flat' is never wrong (150 random worlds)", () => {
  let flat = 0, warped = 0, lifted = 0;
  for (let n = 0; n < 150; n++) {
    const doms: WorldSpec["domains"] = [];
    for (let i = 0, k = Math.floor(rnd() * 3); i < k; i++) {
      doms.push({ id: `d${i}`, parent: "root", origin: [U(15, 85), U(15, 85)], scale: 1, extent: U(5, 16), echoSpeed: 6, rate: rnd() < 0.5 ? 1 : U(1.5, 4), shearMin: rnd() < 0.5 ? U(0.15, 0.5) : null, changes: [] });
    }
    const bulk = rnd() < 0.5;
    const spec: WorldSpec = {
      v: 1, rootSpeed: 6, domains: doms,
      emitters: [{ id: "E", domain: "root", pos: [U(5, 95), U(5, 95)], period: U(3, 6), phase: 0, hue: 1, ...(bulk ? { z: U(0, 30) } : {}) } as never],
      ...(bulk ? { bulk: true } : {}),
    };
    const l = newLab(spec);
    l.t = 70; l.probe = [U(20, 80), U(20, 80)]; l.sel = { kind: "emitter", id: "E" };
    const r = triangulate(l);
    assert.ok(r, `n=${n}`);
    if (!r) continue;
    if (r.verdict === "flat") {
      flat++;
      assert.ok(r.errPos < 1e-3 && r.errDepth < 1e-3 && r.errT0 < 1e-3, `flat but wrong n=${n}: pos ${r.errPos} depth ${r.errDepth}`);
      assert.ok(r.fix.residual <= TRI_FLAT);
      if (r.lift) { lifted++; assert.ok(r.lift.errZ < 1e-3, `lift wrong n=${n}: ${r.lift.errZ}`); }
    } else warped++;
  }
  assert.ok(flat > 40 && warped > 10 && lifted > 10, `non-vacuous: ${flat} flat / ${warped} warped / ${lifted} lifted`);
});

test("array: the default world's warped sources are caught", () => {
  const l = newLab(defaultWorld());
  l.t = 80; l.probe = [60, 50];
  for (const id of ["e1", "e3", "e4"]) {
    const r = triangulate(l, id);
    assert.ok(r && r.verdict === "warped", id);
  }
});

test("trial: Clear Sightline starts warped, cannot be passed by editing the sky, and is solved by moving the probe", async () => {
  const { TRIALS } = await import("../src/lab/trials.js");
  const { moveSel, removeSel } = await import("../src/lab/lab.js");
  const t = TRIALS.find((x) => x.id === "sightline");
  assert.ok(t);
  if (!t) return;
  const fresh = () => { const l = newLab(t.world()); l.t = t.t; return l; };
  const l = fresh();
  assert.equal(t.check(l).ok, false, "starts warped");
  assert.equal(l.spec.bulk, true);
  // doing nothing never solves it
  assert.equal(t.check(fresh()).ok, false);
  // erasing or moving the well is refused even though the array would then read flat
  const e = fresh(); removeSel(e, { kind: "domain", id: "w" });
  assert.equal(t.check(e).ok, false);
  const m = fresh(); moveSel(m, { kind: "domain", id: "w" }, [90, 10]);
  assert.match(t.check(m).status, /sky was changed/);
  // a clear spot exists for the probe
  const s = fresh(); s.probe = [20, 15];
  assert.equal(t.check(s).ok, true, t.check(s).status);
  assert.equal(triangulate(s, "E")?.verdict, "flat");
  assert.ok(Math.abs((triangulate(s, "E")?.fix.depth ?? 0) - 9) < 1e-3, "the hidden height is read as 9");
});

test("lift: a second array raised along the hidden axis recovers the SIGNED height, above or below", () => {
  for (const z of [-20, -12, 0, 7, 25]) {
    const l = newLab({ v: 1, rootSpeed: 6, bulk: true, domains: [], emitters: [{ id: "E", domain: "root", pos: [30, 40], period: 4, phase: 0, hue: 10, z } as never] });
    l.t = 60; l.probe = [60, 55]; l.probeZ = 3; l.sel = { kind: "emitter", id: "E" };
    const r = triangulate(l);
    assert.ok(r && r.verdict === "flat" && r.lift, `z=${z}`);
    assert.ok(r && r.lift && r.lift.errZ < 1e-9 && (z === 0 || Math.sign(r.lift.z) === Math.sign(z)), `z=${z} read ${r?.lift?.z}`);
    assert.ok(r && Math.abs(r.fix.depth - Math.abs(z - 3)) < 1e-3, "the single array still reads |z - probeZ|");
  }
});

test("hidden axes: with two (4D) a single plane reads only the NORM of the hidden vector; three lifted arrays read all of it", () => {
  const base: [number, number][] = [[50, 50], [66, 50], [34, 50], [50, 66], [50, 34], [58, 58], [42, 42]];
  const hit = (sites: number[][], src: number[], t0: number, v: number) => sites.map((s) => t0 + Math.hypot(...s.map((c, k) => c - src[k])) / v);
  // mirror/rotation symmetry: two different hidden vectors of equal norm give IDENTICAL arrivals at a planar array
  const flatSites = base.map((q) => [q[0], q[1], 0, 0]);
  const a = hit(flatSites, [30, 70, 12, -9], 1, 6), b = hit(flatSites, [30, 70, 15, 0], 1, 6), c = hit(flatSites, [30, 70, -9, 12], 1, 6);
  a.forEach((x, i) => { assert.ok(Math.abs(x - b[i]) < 1e-12 && Math.abs(x - c[i]) < 1e-12); });
  const f = locateND(flatSites, a, 6);
  assert.ok(f && f.residual < 1e-6, "the plane fits perfectly...");
  assert.ok(f && Math.abs(Math.hypot(f.pos[2], f.pos[3]) - 15) < 1e-3, "...with the right norm");
  // three arrays lifted along each hidden axis resolve the whole vector, in 40 random 4D worlds
  for (let n = 0; n < 40; n++) {
    const src = [U(5, 95), U(5, 95), U(-25, 25), U(-25, 25)], t0 = U(0, 10), v = U(3, 9);
    const sites: number[][] = [];
    for (const [gz, gw] of [[0, 0], [8, 0], [0, 8]]) for (const q of base) sites.push([q[0], q[1], gz, gw]);
    const g = locateND(sites, hit(sites, src, t0, v), v);
    assert.ok(g, `n=${n}`);
    if (g) assert.ok(Math.hypot(...g.pos.map((x, k) => x - src[k])) < 1e-4 && Math.abs(g.t0 - t0) < 1e-4, `n=${n}`);
  }
  assert.equal(locateND(flatSites.slice(0, 5), a.slice(0, 5), 6), null, "5 sites cannot fix 4 coordinates + time");
  assert.equal(locateND(flatSites, a, -1), null);
});
