/**
 * Array triangulation: where is a source, how deep is it, and when did it fire, from arrival times alone?
 *
 * Sites sit in the observer's plane at a common height. The source is unknown: in-plane (x, y), height h above or
 * below that plane, and emission time t0. With sound speed v in a FLAT UNIFORM medium
 *   a_i = t0 + sqrt((x - x_i)^2 + (y - y_i)^2 + h^2) / v
 * h enters only as h^2 = q, so a planar array can measure |h| but never its sign: above and below the plane are
 * indistinguishable by timing alone (a mirror symmetry, not a flaw of the solver). Five or more sites overdetermine
 * the four unknowns (x, y, q, t0); the RMS misfit then tells whether the uniform-medium assumption was true.
 */
export interface LocateFix {
  x: number;
  y: number;
  /** |h|: distance of the source from the array's plane (sign unknowable) */
  depth: number;
  /** emission time, in the same clock as the arrivals */
  t0: number;
  /** RMS arrival-time misfit (seconds): ~0 in a uniform medium, large when the medium is warped */
  residual: number;
  converged: boolean;
}

type P = [number, number, number, number]; // x, y, q, t0

function solve4(A: number[][], b: number[]): number[] | null {
  const n = 4, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = [0, 0, 0, 0];
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

export function locateSource(sites: readonly (readonly number[])[], arrivals: readonly number[], speed: number): LocateFix | null {
  const m = sites.length;
  if (m < 5 || arrivals.length !== m || !(speed > 0) || arrivals.some((a) => !Number.isFinite(a))) return null;
  const res = (p: P, out: number[]): number => {
    let s = 0;
    for (let i = 0; i < m; i++) {
      const dx = p[0] - sites[i][0], dy = p[1] - sites[i][1];
      out[i] = p[3] + Math.sqrt(dx * dx + dy * dy + p[2] + 1e-12) / speed - arrivals[i];
      s += out[i] * out[i];
    }
    return s;
  };
  const cx = sites.reduce((s, q) => s + q[0], 0) / m, cy = sites.reduce((s, q) => s + q[1], 0) / m;
  const first = arrivals.indexOf(Math.min(...arrivals));
  let best: { p: P; cost: number; ok: boolean } | null = null;
  const starts: P[] = [];
  for (const q of [0.01, 25, 400, 2500]) {
    starts.push([cx, cy, q, Math.min(...arrivals) - 10 / speed]);
    starts.push([sites[first][0], sites[first][1], q, Math.min(...arrivals) - 5 / speed]);
  }
  const r = new Array<number>(m).fill(0), r2 = new Array<number>(m).fill(0);
  for (const s0 of starts) {
    let p: P = [...s0], cost = res(p, r), lam = 1e-3, ok = false;
    for (let it = 0; it < 120; it++) {
      const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], g = [0, 0, 0, 0];
      for (let i = 0; i < m; i++) {
        const dx = p[0] - sites[i][0], dy = p[1] - sites[i][1], R = Math.sqrt(dx * dx + dy * dy + p[2] + 1e-12);
        const J = [dx / (speed * R), dy / (speed * R), 1 / (2 * speed * R), 1];
        for (let a = 0; a < 4; a++) { g[a] += J[a] * r[i]; for (let b = 0; b < 4; b++) A[a][b] += J[a] * J[b]; }
      }
      for (let a = 0; a < 4; a++) A[a][a] += lam * (A[a][a] + 1e-12);
      const d = solve4(A, g.map((v) => -v));
      if (!d) { lam *= 10; continue; }
      const cand: P = [p[0] + d[0], p[1] + d[1], Math.max(0, p[2] + d[2]), p[3] + d[3]];
      const c2 = res(cand, r2);
      if (c2 < cost) { const step = Math.hypot(d[0], d[1], d[2] * 0.01, d[3]); p = cand; cost = c2; res(p, r); lam = Math.max(1e-12, lam / 3); if (step < 1e-11) { ok = true; break; } }
      else { lam *= 4; if (lam > 1e12) { ok = true; break; } }
    }
    if (!best || cost < best.cost - 1e-18) best = { p, cost, ok };
  }
  if (!best) return null;
  const [x, y, q, t0] = best.p;
  return { x, y, depth: Math.sqrt(q), t0, residual: Math.sqrt(best.cost / m), converged: best.ok };
}
