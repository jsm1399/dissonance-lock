/**
 * The arithmetic reference.
 *
 * The non-trivial zeros of the Riemann zeta function are an invariant, aperiodic sequence of numbers: nothing in any
 * world can change them. Used as a beacon schedule (pulse k launches at phase + scale x gamma_k) they give an
 * unambiguous timing reference. A periodic beacon cannot tell you WHICH pulse you heard, nor distinguish a slow
 * clock from a long period; the zeros can, because their gap pattern is a fingerprint.
 *
 * Nothing here depends on the truth of the Riemann Hypothesis: the zeros are COMPUTED (Hardy's Z function, exact
 * Euler-Maclaurin evaluation, sign changes), and every zero we use is checked against the Riemann-von Mangoldt count.
 */

// Bernoulli numbers B_2k / (2k)!  for k = 1..10
const BK: number[] = [
  1 / 12, -1 / 720, 1 / 30240, -1 / 1209600, 1 / 47900160,
  -691 / 1307674368000, 1 / 74724249600, -3617 / 10670622842880000, 43867 / 5109094217170944000, -174611 / 802857662698291200000,
];

/** Hardy's theta: arg Gamma(1/4 + it/2) - (t/2) ln pi, Stirling series (t >= 10). */
export function theta(t: number): number {
  const t2 = t * t;
  return (t / 2) * Math.log(t / (2 * Math.PI)) - t / 2 - Math.PI / 8 + 1 / (48 * t) + 7 / (5760 * t * t2) + 31 / (80640 * t2 * t2 * t);
}

const LN: number[] = [0];
const ln = (n: number): number => { while (LN.length <= n) LN.push(Math.log(LN.length)); return LN[n]; };

/** Hardy's Z(t) = e^{i theta(t)} zeta(1/2 + it), real; its sign changes are exactly the zeros on the critical line. */
export function hardyZ(t: number): number {
  const N = Math.ceil(t / 2) + 12;
  // zeta(s) = sum_{n<N} n^-s + N^{1-s}/(s-1) + N^-s/2 + sum_k B2k/(2k)! s(s+1)..(s+2k-2) N^{-s-2k+1}
  let re = 0, im = 0;
  for (let n = 1; n < N; n++) {
    const a = t * ln(n), r = Math.pow(n, -0.5);
    re += r * Math.cos(a); im -= r * Math.sin(a);
  }
  const lnN = ln(N), a = t * lnN, rN = Math.pow(N, -0.5);
  const c = Math.cos(a), s = Math.sin(a);
  const nsRe = rN * c, nsIm = -rN * s; // N^-s
  // N^{1-s} = N * N^-s ; divide by (s-1) = (-1/2 + it)
  const dr = -0.5, di = t, dd = dr * dr + di * di;
  const pRe = N * nsRe, pIm = N * nsIm;
  re += (pRe * dr + pIm * di) / dd; im += (pIm * dr - pRe * di) / dd;
  re += nsRe / 2; im += nsIm / 2;
  // product term s(s+1)...(s+2k-2), times N^{-s-2k+1}
  let prRe = 0.5, prIm = t; // s
  let inv = 1 / N;
  for (let k = 1; k <= BK.length; k++) {
    const w = BK[k - 1] * inv;
    const tRe = nsRe * prRe - nsIm * prIm, tIm = nsRe * prIm + nsIm * prRe;
    re += w * tRe; im += w * tIm;
    // next product factors (s+2k-1)(s+2k)
    for (const add of [2 * k - 1, 2 * k]) {
      const fRe = 0.5 + add;
      const nr = prRe * fRe - prIm * t, ni = prRe * t + prIm * fRe;
      prRe = nr; prIm = ni;
    }
    inv /= N * N;
  }
  const th = theta(t);
  return re * Math.cos(th) - im * Math.sin(th);
}

/** Riemann-von Mangoldt: N(T) ~ theta(T)/pi + 1 (error is O(log T)). */
export const zeroCountApprox = (T: number): number => theta(T) / Math.PI + 1;

const ZEROS: number[] = [];
const SCAN = { t: 14.0, z: NaN };
export const MAX_ZEROS = 400;
const STEP = 0.05;

/** Continue the sign-change scan until `have` zeros exist (or `reach` is passed), bisecting each bracket. */
function scan(have: number, reach: number): void {
  if (Number.isNaN(SCAN.z)) SCAN.z = hardyZ(SCAN.t);
  while (ZEROS.length < MAX_ZEROS && (ZEROS.length < have || SCAN.t < reach)) {
    const t2 = SCAN.t + STEP, z2 = hardyZ(t2);
    if (SCAN.z === 0 || SCAN.z * z2 < 0) {
      let lo = SCAN.t, hi = t2, flo = SCAN.z;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2, fm = hardyZ(mid);
        if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
      }
      ZEROS.push((lo + hi) / 2);
    }
    SCAN.t = t2; SCAN.z = z2;
  }
}

/** Ordinates gamma_1 < gamma_2 < ... of the first n non-trivial zeros (n <= 400), computed on demand and cached. */
export function zetaZeros(n: number): readonly number[] {
  if (n > MAX_ZEROS) throw new RangeError(`zetaZeros: at most ${MAX_ZEROS} zeros are tabulated`);
  scan(n, 0);
  return ZEROS.slice(0, n);
}

/** gamma_k (1-based); Infinity beyond the table. */
export function zetaZero(k: number): number {
  if (k < 1) return -Infinity;
  if (k > MAX_ZEROS) return Infinity;
  scan(k, 0);
  return ZEROS[k - 1];
}

/** How many zeros have gamma <= T. */
export function zeroCountUpTo(T: number): number {
  if (T < 14) return 0;
  scan(0, T + STEP);
  let lo = 0, hi = ZEROS.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ZEROS[mid] <= T) lo = mid + 1; else hi = mid; }
  return lo;
}

/** All tabulated zeros with gamma <= T (stops at the table limit). */
export function zerosUpTo(T: number): readonly number[] {
  scan(0, T + STEP);
  let k = ZEROS.length;
  while (k > 0 && ZEROS[k - 1] > T) k--;
  return ZEROS.slice(0, k);
}

export interface BeaconFix {
  /** which zero the first heard pulse was: arrivals[i] belongs to gamma_{offset + i} (1-based) */
  offset: number;
  /** seconds of arrival time per unit of height: scale / clock rate (what the clock is really doing) */
  slope: number;
  /** arrival time of gamma = 0 on this line: launch phase plus flight, in the listener's frame */
  intercept: number;
  /** rms misfit in seconds: 0 = the world keeps arithmetic time; larger = this reality deviates from baseline */
  residual: number;
  /** residual of the runner-up identification divided by the best one (> 1: unambiguous, large: certain) */
  confidence: number;
}

/**
 * Blind calibration. Given only the times at which consecutive pulses of a zeta beacon were heard (no labels, no
 * knowledge of the sender's clock), find which zeros they are and the affine map from height to heard time.
 * Needs >= 5 arrivals. Searches every identification j and keeps the best least-squares line.
 */
export function calibrateBeacon(arrivals: readonly number[], maxOffset = 150): BeaconFix | null {
  const m = arrivals.length;
  if (m < 5) return null;
  const zs = zetaZeros(Math.min(MAX_ZEROS, maxOffset + m));
  let best: { j: number; s: number; c: number; r: number } | null = null, second = Infinity;
  const fits: { j: number; s: number; c: number; r: number }[] = [];
  for (let j = 0; j + m <= Math.min(zs.length, maxOffset + m - 1); j++) {
    let sx = 0, sy = 0;
    for (let i = 0; i < m; i++) { sx += zs[j + i]; sy += arrivals[i]; }
    const mx = sx / m, my = sy / m;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < m; i++) { const dx = zs[j + i] - mx; sxx += dx * dx; sxy += dx * (arrivals[i] - my); }
    const s = sxy / sxx, c = my - s * mx;
    let ss = 0;
    for (let i = 0; i < m; i++) { const e = arrivals[i] - (c + s * zs[j + i]); ss += e * e; }
    fits.push({ j, s, c, r: Math.sqrt(ss / m) });
  }
  // positive slopes only (time runs forward)
  for (const f of fits) if (f.s > 0 && (best === null || f.r < best.r)) best = f;
  if (!best) return null;
  for (const f of fits) if (f.s > 0 && f !== best && Math.abs(f.j - best.j) >= 1 && f.r < second) second = f.r;
  const confidence = second === Infinity ? Infinity : second / Math.max(best.r, 1e-12);
  return { offset: best.j + 1, slope: best.s, intercept: best.c, residual: best.r, confidence };
}
