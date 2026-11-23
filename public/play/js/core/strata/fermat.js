/**
 * Bent (Fermat) propagation: earliest-arrival field of one emission, found by a time-dependent
 * Dijkstra over a 2D grid with a 32-neighbour stencil. Unlike `march` (one straight chord, an
 * upper bound) this lets the signal detour around slow regions and through fast ones, so
 * wavefronts refract. Edge times integrate ds/dt = v(x,t) with midpoint steps, which keeps the
 * graph FIFO: a later departure never arrives earlier, so Dijkstra is exact on the graph.
 * Accuracy is limited by the cell size (domains thinner than a cell can be skipped).
 */
const STENCIL = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
    [3, 1], [3, -1], [-3, 1], [-3, -1], [1, 3], [1, -3], [-1, 3], [-1, -3],
    [3, 2], [3, -2], [-3, 2], [-3, -2], [2, 3], [2, -3], [-2, 3], [-2, -3],
];
class MinHeap {
    t = [];
    id = [];
    get size() { return this.t.length; }
    push(time, node) {
        let i = this.t.length;
        this.t.push(time);
        this.id.push(node);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.t[p] <= time)
                break;
            this.t[i] = this.t[p];
            this.id[i] = this.id[p];
            i = p;
        }
        this.t[i] = time;
        this.id[i] = node;
    }
    pop() {
        const rt = this.t[0], rid = this.id[0];
        const lt = this.t.pop(), lid = this.id.pop();
        const n = this.t.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n)
                    break;
                if (c + 1 < n && this.t[c + 1] < this.t[c])
                    c++;
                if (this.t[c] >= lt)
                    break;
                this.t[i] = this.t[c];
                this.id[i] = this.id[c];
                i = c;
            }
            this.t[i] = lt;
            this.id[i] = lid;
        }
        return [rt, rid];
    }
}
/** Travel time along the straight edge a->b starting at root time t0. */
function edgeTime(tree, a, b, t0, maxStep) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / maxStep));
    const ds = len / n;
    let t = t0;
    for (let i = 0; i < n; i++) {
        const f0 = (i * ds) / len, fm = ((i + 0.5) * ds) / len;
        const p0 = [a[0] + dx * f0, a[1] + dy * f0];
        const pm = [a[0] + dx * fm, a[1] + dy * fm];
        const v0 = tree.speedAt(p0, t);
        const vm = tree.speedAt(pm, t + ds / (2 * v0));
        t += ds / vm;
    }
    return t - t0;
}
/**
 * Earliest-arrival field over a box, same layout as `arrivalField` (cell centres), but with bent paths.
 * `step` bounds the integration step along an edge (default: one cell).
 */
export function fermatField(tree, from, tEmitLocal, min, max, n, step) {
    const cw = (max[0] - min[0]) / n, ch = (max[1] - min[1]) / n;
    const maxStep = step ?? Math.min(cw, ch);
    const src = tree.toRootPos(from.domain, from.pos);
    const t0 = tree.toRootTime(from.domain, tEmitLocal);
    const centre = (i, j) => [min[0] + (i + 0.5) * cw, min[1] + (j + 0.5) * ch];
    const dist = new Float64Array(n * n).fill(Infinity);
    const done = new Uint8Array(n * n);
    const heap = new MinHeap();
    // seed: the cells around the source, reached straight from it
    const si = Math.floor((src[0] - min[0]) / cw), sj = Math.floor((src[1] - min[1]) / ch);
    for (let j = sj - 1; j <= sj + 1; j++)
        for (let i = si - 1; i <= si + 1; i++) {
            if (i < 0 || j < 0 || i >= n || j >= n)
                continue;
            const c = centre(i, j);
            const t = t0 + edgeTime(tree, src, c, t0, maxStep);
            const k = j * n + i;
            if (t < dist[k]) {
                dist[k] = t;
                heap.push(t, k);
            }
        }
    while (heap.size > 0) {
        const [t, k] = heap.pop();
        if (done[k])
            continue;
        done[k] = 1;
        const i = k % n, j = (k - i) / n;
        const a = centre(i, j);
        for (const [di, dj] of STENCIL) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= n || nj >= n)
                continue;
            const nk = nj * n + ni;
            if (done[nk])
                continue;
            const nt = t + edgeTime(tree, a, centre(ni, nj), t, maxStep);
            if (nt < dist[nk]) {
                dist[nk] = nt;
                heap.push(nt, nk);
            }
        }
    }
    let tmin = Infinity, tmax = -Infinity;
    for (const v of dist) {
        if (v < tmin)
            tmin = v;
        if (v > tmax)
            tmax = v;
    }
    return { n, values: dist, tmin, tmax };
}
/** Bilinear sample of a field at root position p (clamped to the box). */
export function sampleField(f, min, max, p) {
    const gx = Math.min(f.n - 1, Math.max(0, ((p[0] - min[0]) / (max[0] - min[0])) * f.n - 0.5));
    const gy = Math.min(f.n - 1, Math.max(0, ((p[1] - min[1]) / (max[1] - min[1])) * f.n - 0.5));
    const i = Math.min(f.n - 2, Math.floor(gx)), j = Math.min(f.n - 2, Math.floor(gy));
    const fx = gx - i, fy = gy - j;
    const v = (a, b) => f.values[b * f.n + a];
    return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
}
/** Marching-squares contour of a field at `level`: line segments [x1,y1,x2,y2] in root coordinates. */
export function contour(f, min, max, level) {
    const n = f.n, cw = (max[0] - min[0]) / n, ch = (max[1] - min[1]) / n;
    const out = [];
    const X = (i) => min[0] + (i + 0.5) * cw, Y = (j) => min[1] + (j + 0.5) * ch;
    const at = (i, j) => f.values[j * n + i];
    for (let j = 0; j < n - 1; j++)
        for (let i = 0; i < n - 1; i++) {
            const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
            const px = [X(i), X(i + 1), X(i + 1), X(i)], py = [Y(j), Y(j), Y(j + 1), Y(j + 1)];
            const pts = [];
            for (let e = 0; e < 4; e++) {
                const a = e, b = (e + 1) % 4;
                if ((v[a] < level) !== (v[b] < level)) {
                    const u = (level - v[a]) / (v[b] - v[a]);
                    pts.push([px[a] + (px[b] - px[a]) * u, py[a] + (py[b] - py[a]) * u]);
                }
            }
            if (pts.length === 2)
                out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
            else if (pts.length === 4) {
                out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
                out.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]]);
            }
        }
    return out;
}
