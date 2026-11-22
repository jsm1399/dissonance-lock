interface Knot { p: number; l: number; rate: number }

const checkRate = (r: number) => {
  if (!(r > 0) || !Number.isFinite(r)) throw new RangeError(`rate must be finite and > 0, got ${r}`);
};

/** Monotone map parentTime -> localTime, piecewise linear, right-continuous in rate. */
export class ClockMap {
  private knots: Knot[];
  constructor(rate = 1, offset = 0) {
    checkRate(rate);
    this.knots = [{ p: 0, l: offset, rate }];
  }
  private byP(p: number): Knot {
    let lo = 0, hi = this.knots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.knots[mid].p <= p) lo = mid; else hi = mid - 1;
    }
    return this.knots[lo];
  }
  private byL(l: number): Knot {
    let lo = 0, hi = this.knots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.knots[mid].l <= l) lo = mid; else hi = mid - 1;
    }
    return this.knots[lo];
  }
  local(p: number): number { const k = this.byP(p); return k.l + (p - k.p) * k.rate; }
  parent(l: number): number { const k = this.byL(l); return k.p + (l - k.l) / k.rate; }
  rateAt(p: number): number { return this.byP(p).rate; }
  /** Change rate from parent-time p onward. Must be appended in time order. */
  setRate(p: number, rate: number): void {
    checkRate(rate);
    const last = this.knots[this.knots.length - 1];
    if (p < last.p) throw new RangeError("rate changes must be appended in time order");
    if (p === last.p) { last.rate = rate; return; }
    this.knots.push({ p, l: last.l + (p - last.p) * last.rate, rate });
  }
}
