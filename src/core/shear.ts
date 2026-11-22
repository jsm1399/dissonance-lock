import { History } from './history.ts';
import type { Anchor, Domain, DomainDef, Echo, EchoHit, ShearEvent, Tracked } from './types.ts';
import type { VectorSpace } from './vector.ts';

export interface ShearOpts<V> {
  space: VectorSpace<V>;
  historyDepth?: number; // max lag + 1 (default 64)
  maxEchoes?: number;    // safety cap (default 512)
}

/**
 * Dissonance-Lock core. Physics-agnostic, dimension-agnostic, unit-agnostic.
 *
 * Host frame contract (deterministic):
 *   hits = field.begin()      // advance time, fire echoes, update lags
 *   ...apply hits, integrate, resolve contacts using field.perceived(id)...
 *   field.commit()            // record this tick's states
 */
export class ShearField<V> {
  tick = 0;
  domains: Domain<V>[] = [];
  anchors: Anchor<V>[] = [];
  echoes: Echo<V>[] = [];
  events: ShearEvent<V>[] = [];
  private space: VectorSpace<V>;
  private depth: number;
  private maxEchoes: number;
  private ents = new Map<number, { e: Tracked<V>; hist: History<V> }>();
  private dmap = new Map<string, Domain<V>>();

  constructor(o: ShearOpts<V>) {
    this.space = o.space;
    this.depth = o.historyDepth ?? 64;
    this.maxEchoes = o.maxEchoes ?? 512;
  }

  track(e: Tracked<V>): void {
    const hist = new History<V>(this.depth, this.space);
    hist.push(e.pos);
    this.ents.set(e.id, { e, hist });
  }

  addDomain(def: DomainDef<V>): Domain<V> {
    const { parent: parentId, ...d } = def;
    const parent = parentId ? this.dmap.get(parentId) ?? null : null;
    if (parentId && !parent) throw new Error(`unknown parent domain: ${parentId}`);
    const dom: Domain<V> = {
      maxLag: 24, echoDelay: 18, echoGain: 0.6, echoCount: 2, ripple: d.region.extent,
      echoSpeed: Infinity, decay: 0, clock: 1, bleed: 0.5,
      ...d, parent, dissonance: 0, rate: 1, time: 0,
    };
    dom.maxLag = Math.min(dom.maxLag, this.depth - 1);
    this.domains.push(dom);
    this.dmap.set(dom.id, dom);
    return dom;
  }

  domain(id: string): Domain<V> | undefined { return this.dmap.get(id); }

  addAnchor(a: Anchor<V>): void { this.anchors.push(a); }

  /** The frame collisions should use: real state delayed by the entity's lag. Read-only. */
  perceived(id: number): V {
    const t = this.ents.get(id)!;
    return t.e.lag <= 0 ? t.e.pos : t.hist.get(t.e.lag - 1);
  }

  /**
   * Report a rule-breaking act. Attributed to the deepest domains containing the entity;
   * shear then leaks up the parent chain (scaled by each level's `bleed`), each level echoing on its own clock.
   */
  violate(id: number, action: string, impulse: V): boolean {
    const e = this.ents.get(id)!.e;
    const inside = this.domains.filter(d => d.region.contains(e.pos));
    const deepest = inside.filter(d => !inside.some(o => o !== d && this.isAncestor(d, o)));
    let violated = false;
    for (const d of deepest) {
      const sev = this.rule(d, action);
      if (!(sev > 0)) continue;
      violated = true;
      this.events.push({ type: 'violation', tick: this.tick, entityId: id, domainId: d.id, action });
      let w = 1;
      for (let x: Domain<V> | null = d; x && w > 0; x = x.parent) {
        x.dissonance = Math.min(1, x.dissonance + sev * w);
        this.echoes.push({
          domainId: x.id, due: x.time + x.echoDelay, origin: this.space.clone(e.pos),
          impulse: this.space.clone(impulse), gain: x.echoGain * w, left: x.echoCount,
          fired: false, t0: 0, hit: new Set(),
        });
        w *= x.bleed;
      }
    }
    if (this.echoes.length > this.maxEchoes) this.echoes.splice(0, this.echoes.length - this.maxEchoes);
    return violated;
  }

  private isAncestor(a: Domain<V>, of: Domain<V>): boolean {
    for (let x = of.parent; x; x = x.parent) if (x === a) return true;
    return false;
  }

  /** Nearest definition up the ancestry wins; undefined everywhere = permitted. */
  private rule(d: Domain<V>, action: string): number {
    for (let x: Domain<V> | null = d; x; x = x.parent) {
      const s = x.forbid[action];
      if (s !== undefined) return s;
    }
    return 0;
  }

  /** Re-anchor: inside an anchor's radius, purge dissonance (and, at zero, pending echoes) of domains containing it. */
  reanchor(id: number): boolean {
    const e = this.ents.get(id)!.e;
    const a = this.anchors.find(a => this.space.dist(a.pos, e.pos) <= a.radius);
    if (!a) return false;
    const cleared: string[] = [];
    for (const d of this.domains) {
      if (!d.region.contains(a.pos)) continue;
      d.dissonance = Math.max(0, d.dissonance - a.power);
      cleared.push(d.id);
      if (d.dissonance === 0) this.echoes = this.echoes.filter(x => x.domainId !== d.id);
    }
    this.events.push({ type: 'anchor', tick: this.tick, entityId: id, anchorId: a.id, domainsCleared: cleared });
    return true;
  }

  begin(): EchoHit<V>[] {
    this.events.length = 0;
    this.tick++;
    for (const d of this.domains) { // parents precede children, so rates compose down the tree
      d.rate = (d.parent ? d.parent.rate : 1) * d.clock;
      d.time += d.rate;
    }
    const hits: EchoHit<V>[] = [];
    this.runEchoes(hits);
    for (const d of this.domains) if (d.decay > 0) d.dissonance = Math.max(0, d.dissonance - d.decay * d.rate);
    this.updateLags();
    return hits;
  }

  commit(): void { for (const t of this.ents.values()) t.hist.push(t.e.pos); }

  private runEchoes(hits: EchoHit<V>[]): void {
    const next: Echo<V>[] = [];
    for (const e of this.echoes) {
      const d = this.dmap.get(e.domainId)!;
      if (e.due > d.time) { next.push(e); continue; }
      if (!e.fired) {
        e.fired = true; e.t0 = d.time;
        this.events.push({ type: 'echo', tick: this.tick, domainId: d.id, origin: e.origin });
        if (e.left > 1) next.push({
          ...e, due: d.time + d.echoDelay, gain: e.gain * d.echoGain, left: e.left - 1,
          fired: false, hit: new Set(), origin: this.space.clone(e.origin), impulse: this.space.clone(e.impulse),
        });
      }
      // wavefront on the domain's own clock: shear propagates causally, not instantly
      const reach = Math.min(d.ripple, d.echoSpeed === Infinity ? Infinity : (d.time - e.t0) * d.echoSpeed);
      for (const { e: ent } of this.ents.values()) {
        if (e.hit.has(ent.id) || !d.region.contains(ent.pos)) continue;
        const dist = this.space.dist(e.origin, ent.pos);
        if (dist > reach || dist > d.ripple) continue;
        e.hit.add(ent.id);
        hits.push({ entityId: ent.id, impulse: this.space.scale(e.impulse, e.gain * (1 - dist / d.ripple)) });
      }
      if (reach < d.ripple) next.push(e); // wave still travelling
    }
    this.echoes = next;
  }

  private updateLags(): void {
    for (const { e } of this.ents.values()) {
      let target = 0;
      for (const d of this.domains) {
        if (!d.region.contains(e.pos)) continue;
        target = Math.max(target, Math.round(d.dissonance * d.maxLag * (0.5 + 0.5 * d.region.falloff(e.pos))));
      }
      e.lag += Math.sign(target - e.lag); // slew 1 tick/tick: perceived frame never teleports
    }
  }
}
