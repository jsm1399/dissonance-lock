const checkRate = (r) => {
    if (!(r > 0) || !Number.isFinite(r))
        throw new RangeError(`rate must be finite and > 0, got ${r}`);
};
/** Monotone map parentTime -> localTime, piecewise linear, right-continuous in rate. */
export class ClockMap {
    knots;
    constructor(rate = 1, offset = 0) {
        checkRate(rate);
        this.knots = [{ p: 0, l: offset, rate }];
    }
    byP(p) {
        let lo = 0, hi = this.knots.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.knots[mid].p <= p)
                lo = mid;
            else
                hi = mid - 1;
        }
        return this.knots[lo];
    }
    byL(l) {
        let lo = 0, hi = this.knots.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.knots[mid].l <= l)
                lo = mid;
            else
                hi = mid - 1;
        }
        return this.knots[lo];
    }
    local(p) { const k = this.byP(p); return k.l + (p - k.p) * k.rate; }
    parent(l) { const k = this.byL(l); return k.p + (l - k.l) / k.rate; }
    rateAt(p) { return this.byP(p).rate; }
    /** Change rate from parent-time p onward. Must be appended in time order. */
    setRate(p, rate) {
        checkRate(rate);
        const last = this.knots[this.knots.length - 1];
        if (p < last.p)
            throw new RangeError("rate changes must be appended in time order");
        if (p === last.p) {
            last.rate = rate;
            return;
        }
        this.knots.push({ p, l: last.l + (p - last.p) * last.rate, rate });
    }
}
