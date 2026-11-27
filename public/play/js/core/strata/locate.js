function solve4(A, b) {
    const n = 4, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++)
            if (Math.abs(M[r][c]) > Math.abs(M[p][c]))
                p = r;
        if (Math.abs(M[p][c]) < 1e-300)
            return null;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++)
                M[r][k] -= f * M[c][k];
        }
    }
    const x = [0, 0, 0, 0];
    for (let r = n - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let k = r + 1; k < n; k++)
            s -= M[r][k] * x[k];
        x[r] = s / M[r][r];
    }
    return x.every(Number.isFinite) ? x : null;
}
export function locateSource(sites, arrivals, speed) {
    const m = sites.length;
    if (m < 5 || arrivals.length !== m || !(speed > 0) || arrivals.some((a) => !Number.isFinite(a)))
        return null;
    const res = (p, out) => {
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
    let best = null;
    const starts = [];
    for (const q of [0.01, 25, 400, 2500]) {
        starts.push([cx, cy, q, Math.min(...arrivals) - 10 / speed]);
        starts.push([sites[first][0], sites[first][1], q, Math.min(...arrivals) - 5 / speed]);
    }
    const r = new Array(m).fill(0), r2 = new Array(m).fill(0);
    for (const s0 of starts) {
        let p = [...s0], cost = res(p, r), lam = 1e-3, ok = false;
        for (let it = 0; it < 120; it++) {
            const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], g = [0, 0, 0, 0];
            for (let i = 0; i < m; i++) {
                const dx = p[0] - sites[i][0], dy = p[1] - sites[i][1], R = Math.sqrt(dx * dx + dy * dy + p[2] + 1e-12);
                const J = [dx / (speed * R), dy / (speed * R), 1 / (2 * speed * R), 1];
                for (let a = 0; a < 4; a++) {
                    g[a] += J[a] * r[i];
                    for (let b = 0; b < 4; b++)
                        A[a][b] += J[a] * J[b];
                }
            }
            for (let a = 0; a < 4; a++)
                A[a][a] += lam * (A[a][a] + 1e-12);
            const d = solve4(A, g.map((v) => -v));
            if (!d) {
                lam *= 10;
                continue;
            }
            const cand = [p[0] + d[0], p[1] + d[1], Math.max(0, p[2] + d[2]), p[3] + d[3]];
            const c2 = res(cand, r2);
            if (c2 < cost) {
                const step = Math.hypot(d[0], d[1], d[2] * 0.01, d[3]);
                p = cand;
                cost = c2;
                res(p, r);
                lam = Math.max(1e-12, lam / 3);
                if (step < 1e-11) {
                    ok = true;
                    break;
                }
            }
            else {
                lam *= 4;
                if (lam > 1e12) {
                    ok = true;
                    break;
                }
            }
        }
        if (!best || cost < best.cost - 1e-18)
            best = { p, cost, ok };
    }
    if (!best)
        return null;
    const [x, y, q, t0] = best.p;
    return { x, y, depth: Math.sqrt(q), t0, residual: Math.sqrt(best.cost / m), converged: best.ok };
}
