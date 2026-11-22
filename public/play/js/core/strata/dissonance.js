/**
 * Causal-inversion count: pairs (i, j) emitted in order i < j (by more than `margin`)
 * but perceived in the opposite order (by more than `margin`).
 */
export function countInversions(ps, margin = 0) {
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
        for (let j = 0; j < ps.length; j++) {
            if (i === j)
                continue;
            if (ps[i].emitRoot + margin < ps[j].emitRoot && ps[i].perceivedAt > ps[j].perceivedAt + margin)
                n++;
        }
    }
    return n;
}
/** Normalized dissonance pressure in [0, 1]. */
export const pressureOf = (inversions, cap) => Math.min(1, Math.max(0, inversions / cap));
/** Population standard deviation of observed lags: how incoherent the perceived timeline is. */
export function lagSpread(lags) {
    if (lags.length < 2)
        return 0;
    let mean = 0;
    for (const l of lags)
        mean += l;
    mean /= lags.length;
    let v = 0;
    for (const l of lags)
        v += (l - mean) * (l - mean);
    return Math.sqrt(v / lags.length);
}
