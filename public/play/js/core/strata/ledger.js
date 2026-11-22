import { march } from "./propagate.js";
const EPS = 1e-9;
export class CausalLedger {
    tree;
    opts;
    events = [];
    cache = new Map();
    constructor(tree, opts = {}) {
        this.tree = tree;
        this.opts = opts;
    }
    emit(site, localTime, payload) {
        const ev = {
            id: this.events.length, site, localTime,
            rootTime: this.tree.toRootTime(site.domain, localTime), payload,
        };
        this.events.push(ev);
        return ev;
    }
    arrival(ev, to) {
        const key = `${ev.id}|${to.domain}|${to.pos.join(",")}`;
        let a = this.cache.get(key);
        if (!a) {
            a = march(this.tree, ev.site, ev.localTime, to, this.opts);
            this.cache.set(key, a);
        }
        return a;
    }
    /** Everything the observer can perceive by its local time, ordered by arrival. */
    perceived(observer, localTime) {
        const out = [];
        for (const ev of this.events) {
            const a = this.arrival(ev, observer);
            if (a.localTime <= localTime + EPS) {
                out.push({
                    event: ev, arrivalLocal: a.localTime,
                    lag: a.localTime - this.tree.toLocalTime(observer.domain, ev.rootTime),
                });
            }
        }
        return out.sort((x, y) => x.arrivalLocal - y.arrivalLocal);
    }
    relation(a, b) {
        const ab = this.arrival(a, b.site).rootTime <= b.rootTime + EPS;
        const ba = this.arrival(b, a.site).rootTime <= a.rootTime + EPS;
        if (ab && ba)
            return "same";
        if (ab)
            return "before";
        if (ba)
            return "after";
        return "spacelike";
    }
}
