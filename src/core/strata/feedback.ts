import type { StrataTree } from "./tree.js";
import type { MarchOptions, Site } from "./propagate.js";
import { march } from "./propagate.js";

/**
 * Feedback: causal graphs with cycles.
 *
 * A node hears pulses (from any node, itself included) and re-emits each one after `delay` of ITS OWN local
 * time, scaled by `gain`. Because every hop costs real flight time through the strata, a loop is a physical
 * thing: it has a period, a gain per round, and therefore a growth rate. Two instruments live here:
 *  - runFeedback: an event-driven engine (priority queue over root time) that plays the cascade out;
 *  - analyzeFeedback: the exact asymptotics, with no simulation: solves rho(W(s)) = 1 for the growth rate s.
 */
export interface FbNode { id: string; site: Site }
/** `to` re-emits pulses of `from`, `delay` later on `to`'s own clock, amplitude x `gain` (and x path survival). */
export interface FbEdge { from: string; to: string; delay: number; gain: number }
/** A pulse that exists independently of feedback (a free-running or relay launch). */
export interface FbSeed { node: string; key: string; launchLocal: number; launchRoot: number }

export interface FbPulse {
  node: string;
  /** `${node}|${FB_BASE + n}`: n counts this node's echoes in launch order */
  key: string;
  /** the n above: feedback pulse indices live above this so they never collide with clock pulse indices */
  k: number;
  launchLocal: number;
  launchRoot: number;
  amp: number;
  /** hops from a seed (1 = direct echo of an independent pulse) */
  gen: number;
  /** key of the pulse that caused it */
  cause: string;
}

export const FB_BASE = 100000;

export interface FbOptions {
  /** root time after which nothing is launched */
  horizon: number;
  /** energy absorbed per unit root length inside any domain (Lawbook `loss`) */
  loss?: number;
  /** echoes weaker than this fade out of the world (default 0.02) */
  ampMin?: number;
  /** echoes stronger than this saturate: they are emitted but spawn no more (default 64) */
  ampMax?: number;
  /** hard cap on echoes (default 1500) */
  maxPulses?: number;
  march?: MarchOptions;
}

export interface FbResult {
  /** all echoes, ascending launch time */
  pulses: FbPulse[];
  /** independent pulses that fed the network */
  injected: number;
  /** total amplitude of all echoes */
  emitted: number;
  peak: number;
  /** echoes that decayed below ampMin */
  faded: number;
  /** something hit ampMax: the loop is amplifying without bound */
  saturated: boolean;
  /** the cap stopped the cascade */
  truncated: boolean;
}

interface Ev {
  id: number;
  node: string;
  launchLocal: number;
  launchRoot: number;
  amp: number;
  gen: number;
  /** seed key, or event id of the parent echo */
  cause: string | number;
  seed: boolean;
  key: string;
  /** hit the amplitude ceiling: recorded, but spawns nothing */
  sat: boolean;
}

class Heap {
  private a: Ev[] = [];
  get size(): number { return this.a.length; }
  private lt(x: Ev, y: Ev): boolean { return x.launchRoot < y.launchRoot || (x.launchRoot === y.launchRoot && x.id < y.id); }
  push(e: Ev): void {
    const a = this.a;
    a.push(e);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.lt(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Ev | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0], last = a.pop() as Ev;
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.lt(a[l], a[m])) m = l;
        if (r < a.length && this.lt(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Fraction of energy that survives the chord between two nodes: exp(-loss x length spent inside domains). */
function survival(tree: StrataTree, a: FbNode, b: FbNode, loss: number, mo: MarchOptions): number {
  if (loss === 0) return 1;
  const r = march(tree, a.site, 0, b.site, mo);
  let inside = 0;
  for (const s of r.segments) if (s.domain !== "root") inside += s.length;
  return Math.exp(-loss * inside);
}

const MARCH_DEFAULT: MarchOptions = { maxStep: 1 };

export function runFeedback(
  tree: StrataTree, nodes: readonly FbNode[], edges: readonly FbEdge[], seeds: readonly FbSeed[], opts: FbOptions,
): FbResult {
  const ampMin = opts.ampMin ?? 0.02, ampMax = opts.ampMax ?? 64, cap = opts.maxPulses ?? 1500;
  const loss = opts.loss ?? 0, mo = opts.march ?? MARCH_DEFAULT;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, FbEdge[]>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    const l = out.get(e.from);
    if (l) l.push(e); else out.set(e.from, [e]);
  }
  const trans = new Map<string, number>();
  const surv = (e: FbEdge): number => {
    const k = `${e.from}>${e.to}`;
    let v = trans.get(k);
    if (v === undefined) { v = survival(tree, byId.get(e.from) as FbNode, byId.get(e.to) as FbNode, loss, mo); trans.set(k, v); }
    return v;
  };

  const heap = new Heap();
  let nextId = 0, injected = 0;
  for (const s of seeds) {
    if (!out.has(s.node) || s.launchRoot > opts.horizon) continue;
    heap.push({ id: nextId++, node: s.node, launchLocal: s.launchLocal, launchRoot: s.launchRoot, amp: 1, gen: 0, cause: s.key, seed: true, key: s.key, sat: false });
    injected++;
  }

  const echoes: Ev[] = [];
  let peak = 0, faded = 0, saturated = false, truncated = false;
  for (let ev = heap.pop(); ev; ev = heap.pop()) {
    if (ev.sat) continue; // saturated: stays in the record, spawns nothing
    for (const e of out.get(ev.node) ?? []) {
      const a = byId.get(ev.node) as FbNode, b = byId.get(e.to) as FbNode;
      const amp = ev.amp * e.gain * surv(e);
      if (amp < ampMin) { faded++; continue; }
      const arr = march(tree, a.site, ev.launchLocal, b.site, mo).rootTime;
      const launchLocal = tree.toLocalTime(b.site.domain, arr) + e.delay;
      const launchRoot = tree.toRootTime(b.site.domain, launchLocal);
      if (launchRoot > opts.horizon) continue;
      if (echoes.length >= cap) { truncated = true; continue; }
      const sat = amp > ampMax;
      if (sat) saturated = true;
      const child: Ev = {
        id: nextId++, node: e.to, launchLocal, launchRoot, amp: sat ? ampMax : amp, gen: ev.gen + 1,
        cause: ev.seed ? ev.key : ev.id, seed: false, key: "", sat,
      };
      peak = Math.max(peak, child.amp);
      echoes.push(child);
      heap.push(child);
    }
    if (truncated) break;
  }

  // Final keys: per node, in launch order. Causes follow.
  const perNode = new Map<string, Ev[]>();
  for (const e of echoes) {
    const l = perNode.get(e.node);
    if (l) l.push(e); else perNode.set(e.node, [e]);
  }
  const keyOf = new Map<number, { key: string; k: number }>();
  for (const [node, list] of perNode) {
    list.sort((x, y) => x.launchRoot - y.launchRoot || x.id - y.id);
    list.forEach((e, i) => keyOf.set(e.id, { key: `${node}|${FB_BASE + i + 1}`, k: FB_BASE + i + 1 }));
  }
  const pulses: FbPulse[] = echoes
    .map((e) => {
      const kk = keyOf.get(e.id) as { key: string; k: number };
      const cause = typeof e.cause === "string" ? e.cause : (keyOf.get(e.cause) as { key: string }).key;
      return { node: e.node, key: kk.key, k: kk.k, launchLocal: e.launchLocal, launchRoot: e.launchRoot, amp: e.amp, gen: e.gen, cause };
    })
    .sort((x, y) => x.launchRoot - y.launchRoot || (x.key < y.key ? -1 : 1));
  let emitted = 0;
  for (const p of pulses) emitted += p.amp;
  return { pulses, injected, emitted, peak, faded, saturated, truncated };
}

// ---------------------------------------------------------------- stability analysis

export type FbVerdict = "none" | "damped" | "marginal" | "runaway" | "zeno";

export interface LoopReport {
  /** one representative cycle, first node repeated at the end (A,B,A) */
  path: string[];
  /** nodes of the strongly connected component */
  nodes: string[];
  /** amplitude multiplier per trip round the loop, ignoring timing (spectral radius at s = 0) */
  gain: number;
  /** growth rate per root second: + runs away, - dies out. Solves rho(W(s)) = 1. */
  rate: number;
  /** root seconds for one trip round the loop (flight + delays), shortest cycle */
  minDelay: number;
  verdict: Exclude<FbVerdict, "none">;
}

export interface FbAudit {
  verdict: FbVerdict;
  loops: LoopReport[];
  worst: LoopReport | null;
  /** some edge, or some node's fan-out, multiplies energy: the world creates energy */
  amplifier: boolean;
}

export const RATE_EPS = 0.002;
export const ZENO_DELAY = 0.02;

interface Timed { from: string; to: string; tau: number; g: number }

function timed(tree: StrataTree, nodes: Map<string, FbNode>, e: FbEdge, tRef: number, loss: number, mo: MarchOptions): Timed {
  const a = nodes.get(e.from) as FbNode, b = nodes.get(e.to) as FbNode;
  const launchLocal = tree.toLocalTime(a.site.domain, tRef);
  const arr = march(tree, a.site, launchLocal, b.site, mo).rootTime;
  const lb = tree.toLocalTime(b.site.domain, arr) + e.delay;
  const tau = tree.toRootTime(b.site.domain, lb) - tRef;
  return { from: e.from, to: e.to, tau: Math.max(0, tau), g: e.gain * survival(tree, a, b, loss, mo) };
}

/** Largest eigenvalue magnitude of a non-negative matrix, by power iteration on I + W (aperiodic by construction). */
function spectralRadius(W: number[][]): number {
  const n = W.length;
  let v = Array.from({ length: n }, () => 1 / Math.sqrt(n));
  let lam = 1;
  for (let it = 0; it < 2000; it++) {
    const u = v.map((x, i) => x + W[i].reduce((s, w, j) => s + w * v[j], 0));
    const nrm = Math.hypot(...u);
    if (nrm === 0) return 0;
    const nv = u.map((x) => x / nrm);
    const done = Math.abs(nrm - lam) < 1e-13 && nv.every((x, i) => Math.abs(x - v[i]) < 1e-11);
    v = nv; lam = nrm;
    if (done) break;
  }
  return lam - 1;
}

function sccs(ids: string[], adj: Map<string, string[]>): string[][] {
  let idx = 0;
  const index = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), stack: string[] = [], out: string[][] = [];
  const visit = (v: string): void => {
    index.set(v, idx); low.set(v, idx); idx++;
    stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v) as number, low.get(w) as number)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      for (let w: string | undefined; w !== v;) { w = stack.pop() as string; on.delete(w); comp.push(w); }
      out.push(comp);
    }
  };
  for (const v of ids) if (!index.has(v)) visit(v);
  return out;
}

/** Shortest cycle through `start` inside a component (BFS), as a node path that ends where it began. */
function cycleThrough(start: string, comp: Set<string>, adj: Map<string, string[]>): string[] {
  const prev = new Map<string, string>();
  const q = [start];
  let last: string | null = null;
  while (q.length > 0 && last === null) {
    const v = q.shift() as string;
    for (const w of adj.get(v) ?? []) {
      if (!comp.has(w)) continue;
      if (w === start) { last = v; break; }
      if (!prev.has(w)) { prev.set(w, v); q.push(w); }
    }
  }
  const mid: string[] = [];
  for (let x = last; x !== null && x !== start; x = prev.get(x) ?? start) mid.unshift(x);
  return [start, ...mid, start];
}

/**
 * Stability of the feedback graph at root time `tRef` (clocks drift, so timing is a snapshot).
 * For each strongly connected component, with W_ij(s) = gain_ij exp(-s tau_ij), the pulse amplitudes grow like
 * exp(s* t) where rho(W(s*)) = 1. s* > 0 is a runaway; the world is creating energy.
 */
export function analyzeFeedback(
  tree: StrataTree, nodes: readonly FbNode[], edges: readonly FbEdge[], tRef: number, loss = 0, mo: MarchOptions = MARCH_DEFAULT,
): FbAudit {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const es = edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => timed(tree, byId, e, tRef, loss, mo));
  const adj = new Map<string, string[]>();
  for (const e of es) { const l = adj.get(e.from); if (l) l.push(e.to); else adj.set(e.from, [e.to]); }

  const fan = new Map<string, number>();
  let amplifier = false;
  for (const e of es) {
    if (e.g > 1 + 1e-9) amplifier = true;
    fan.set(e.from, (fan.get(e.from) ?? 0) + e.g);
  }
  for (const v of fan.values()) if (v > 1 + 1e-9) amplifier = true;

  const loops: LoopReport[] = [];
  const ids = [...new Set(es.flatMap((e) => [e.from, e.to]))].sort();
  for (const comp of sccs(ids, adj)) {
    const set = new Set(comp);
    const inside = es.filter((e) => set.has(e.from) && set.has(e.to));
    if (inside.length === 0) continue; // a lone node without a self-loop is no loop
    const order = comp.slice().sort();
    const ix = new Map(order.map((v, i) => [v, i]));
    const n = order.length;
    const W = (s: number): number[][] => {
      const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      for (const e of inside) m[ix.get(e.to) as number][ix.get(e.from) as number] += e.g * Math.exp(-s * e.tau);
      return m;
    };
    const f = n === 1
      ? (s: number) => inside.reduce((a, e) => a + e.g * Math.exp(-s * e.tau), 0)
      : (s: number) => spectralRadius(W(s));
    // shortest round trip (Floyd-Warshall on tau; diagonal starts at infinity so it finds cycles)
    const d = Array.from({ length: n }, () => new Array<number>(n).fill(Infinity));
    for (const e of inside) { const i = ix.get(e.from) as number, j = ix.get(e.to) as number; d[i][j] = Math.min(d[i][j], e.tau); }
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
    let minDelay = Infinity;
    for (let i = 0; i < n; i++) minDelay = Math.min(minDelay, d[i][i]);

    const gain = f(0);
    let rate: number;
    if (n === 1) {
      const tau = inside.reduce((a, e) => a + e.tau, 0) / inside.length;
      rate = gain <= 0 ? -Infinity : tau > 0 && inside.length === 1 ? Math.log(gain) / tau : bisect(f, gain);
    } else rate = bisect(f, gain);
    let verdict: LoopReport["verdict"];
    if (minDelay < ZENO_DELAY && gain >= 1 - 1e-9) verdict = gain > 1 + 1e-9 ? "zeno" : "marginal";
    else if (rate > RATE_EPS) verdict = "runaway";
    else if (rate >= -RATE_EPS) verdict = "marginal";
    else verdict = "damped";
    loops.push({ path: cycleThrough(order[0], set, adj), nodes: order, gain, rate, minDelay, verdict });
  }
  const rank: Record<string, number> = { damped: 0, marginal: 1, runaway: 2, zeno: 3 };
  loops.sort((a, b) => rank[b.verdict] - rank[a.verdict] || b.rate - a.rate);
  const worst = loops[0] ?? null;
  return { verdict: worst ? worst.verdict : "none", loops, worst, amplifier };
}

/** Solve f(s) = 1 for the decreasing f. gain = f(0). Clamped to +-30 per second. */
function bisect(f: (s: number) => number, gain: number): number {
  const S = 30;
  let lo: number, hi: number;
  if (gain >= 1) { lo = 0; hi = S; if (f(hi) >= 1) return S; }
  else { lo = -S; hi = 0; if (f(lo) <= 1) return -S; }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 1) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
