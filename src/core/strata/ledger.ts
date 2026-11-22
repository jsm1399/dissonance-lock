import type { StrataTree } from "./tree.js";
import type { Arrival, MarchOptions, Site } from "./propagate.js";
import { march } from "./propagate.js";

const EPS = 1e-9;
export type Relation = "before" | "after" | "same" | "spacelike";

export interface CausalEvent<P = unknown> {
  id: number; site: Site; localTime: number; rootTime: number; payload: P;
}
export interface Perceived<P = unknown> {
  event: CausalEvent<P>;
  arrivalLocal: number;
  /** arrival minus emission, both in the observer domain's local time */
  lag: number;
}

export class CausalLedger<P = unknown> {
  private tree: StrataTree;
  private opts: MarchOptions;
  private events: CausalEvent<P>[] = [];
  private cache = new Map<string, Arrival>();

  constructor(tree: StrataTree, opts: MarchOptions = {}) {
    this.tree = tree;
    this.opts = opts;
  }

  emit(site: Site, localTime: number, payload: P): CausalEvent<P> {
    const ev: CausalEvent<P> = {
      id: this.events.length, site, localTime,
      rootTime: this.tree.toRootTime(site.domain, localTime), payload,
    };
    this.events.push(ev);
    return ev;
  }

  arrival(ev: CausalEvent<P>, to: Site): Arrival {
    const key = `${ev.id}|${to.domain}|${to.pos.join(",")}`;
    let a = this.cache.get(key);
    if (!a) { a = march(this.tree, ev.site, ev.localTime, to, this.opts); this.cache.set(key, a); }
    return a;
  }

  /** Everything the observer can perceive by its local time, ordered by arrival. */
  perceived(observer: Site, localTime: number): Perceived<P>[] {
    const out: Perceived<P>[] = [];
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

  relation(a: CausalEvent<P>, b: CausalEvent<P>): Relation {
    const ab = this.arrival(a, b.site).rootTime <= b.rootTime + EPS;
    const ba = this.arrival(b, a.site).rootTime <= a.rootTime + EPS;
    if (ab && ba) return "same";
    if (ab) return "before";
    if (ba) return "after";
    return "spacelike";
  }
}
