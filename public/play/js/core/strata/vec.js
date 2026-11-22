export const vzero = (n) => Array.from({ length: n }, () => 0);
export const vadd = (a, b) => a.map((x, i) => x + b[i]);
export const vsub = (a, b) => a.map((x, i) => x - b[i]);
export const vscale = (a, k) => a.map((x) => x * k);
export const vdot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const vlen = (a) => Math.sqrt(vdot(a, a));
export const vdist = (a, b) => vlen(vsub(a, b));
