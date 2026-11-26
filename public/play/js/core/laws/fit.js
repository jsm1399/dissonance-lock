import { DIM_MAX, DIM_MIN } from "./laws.js";
/** Solve the small normal equations by Gaussian elimination with partial pivoting. null if singular. */
function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++)
            if (Math.abs(M[r][c]) > Math.abs(M[p][c]))
                p = r;
        if (Math.abs(M[p][c]) < 1e-12)
            return null;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c)
                continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++)
                M[r][k] -= f * M[c][k];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}
export function fitSpreading(samples) {
    const s = samples.filter((x) => x.r > 0 && x.intensity > 0 && Number.isFinite(x.intensity));
    if (s.length < 6)
        return null;
    const y = s.map((x) => Math.log(x.intensity)), lr = s.map((x) => Math.log(x.r)), L = s.map((x) => x.inside);
    const withLoss = Math.max(...L) - Math.min(...L) > 1e-6;
    const cols = withLoss ? [s.map(() => 1), lr, L] : [s.map(() => 1), lr];
    const k = cols.length;
    const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => cols[i].reduce((a, v, q) => a + v * cols[j][q], 0)));
    const b = cols.map((c) => c.reduce((a, v, q) => a + v * y[q], 0));
    const x = solve(A, b);
    if (!x)
        return null;
    let ss = 0;
    for (let q = 0; q < s.length; q++) {
        const pred = x[0] + x[1] * lr[q] + (withLoss ? x[2] * L[q] : 0);
        ss += (y[q] - pred) ** 2;
    }
    return { n: -x[1], loss: withLoss ? -x[2] : null, rms: Math.sqrt(ss / s.length), samples: s.length };
}
/** Every (dimension, Gauss law) that spreads like r^-n. Gauss "holds" is the only one that conserves energy. */
export function consistentLaws(n, tol = 0.05) {
    const out = [];
    for (let dim = DIM_MIN; dim <= DIM_MAX; dim++) {
        if (Math.abs(n - (dim - 1)) <= tol)
            out.push({ dim, gauss: "holds" });
        if (Math.abs(n - dim) <= tol)
            out.push({ dim, gauss: "leaky" });
        if (Math.abs(n - Math.max(0, dim - 2)) <= tol)
            out.push({ dim, gauss: "runaway" });
    }
    return out.sort((a, b) => (a.gauss === "holds" ? 0 : 1) - (b.gauss === "holds" ? 0 : 1) || a.dim - b.dim);
}
