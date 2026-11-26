export const vzero = (n) => Array.from({ length: n }, () => 0);
export const vadd = (a, b) => a.map((x, i) => x + b[i]);
export const vsub = (a, b) => a.map((x, i) => x - b[i]);
export const vscale = (a, k) => a.map((x) => x * k);
/** Plain loops: the march calls these millions of times, and the summation order is the same as a reduce from 0. */
export const vdot = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++)
        s += a[i] * b[i];
    return s;
};
export const vlen = (a) => Math.sqrt(vdot(a, a));
export const vdist = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
    }
    return Math.sqrt(s);
};
