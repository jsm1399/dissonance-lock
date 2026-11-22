export type Vec = readonly number[];
export const vzero = (n: number): Vec => Array.from({ length: n }, () => 0);
export const vadd = (a: Vec, b: Vec): Vec => a.map((x, i) => x + b[i]);
export const vsub = (a: Vec, b: Vec): Vec => a.map((x, i) => x - b[i]);
export const vscale = (a: Vec, k: number): Vec => a.map((x) => x * k);
export const vdot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i], 0);
export const vlen = (a: Vec): number => Math.sqrt(vdot(a, a));
export const vdist = (a: Vec, b: Vec): number => vlen(vsub(a, b));
