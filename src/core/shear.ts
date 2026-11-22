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

  addDomain(d: DomainDef<V>): Domain<V> {
    const dom: Domain<V> = {
      maxLag: 24, echoDelay: 18, echoGain: 0.6, echoCount: 2, ripple: d.region.extent,
      echoSpeed: Infinity, decay: 0, ...d, dissonance: 0,
    };
    dom.maxLag = Math.min(dom.maxLag, this.depth - 1);
    this.domains.push(dom);
    return dom;
  }

  addAnchor(a: Anchor<V>): void { this.anchors.push(a); }

  /** The frame collisions should use: real state delayed by the entity's lag. Read-only. */
  perceived(id: number): V {
    const t = this.ents.get(id)!;
    return t.e.lag <= 0 ? t.e.pos : t.hist.get(t.e.lag - 1);
  }

  /** Report a rule-breaking act. Builds dissonance and schedules echoes in every domain it violates. */
  violate(id: number, action: string, impulse: V): boolean {
    const e = this.ents.get(id)!.e;
    let violated = false;
    for (const d of this.domains) {
      const sev = d.forbid[action];
      if (sev === undefined || !d.region.contains(e.pos)) continue;
      violated = true;
      d.dissonance = Math.min(1, d.dissonance + sev);
      this.events.push({ type: 'violation', tick: this.tick, entityId: id, domainId: d.id, action });
      this.echoes.push({
        domainId: d.id, due: this.tick + d.echoDelay, origin: this.space.clone(e.pos),
        impulse: this.space.clone(impulse), gain: d.echoGain, left: d.echoCount,
        fired: false, t0: 0, hit: new Set(),
      });
    }
    if (this.echoes.length > this.maxEchoes) this.echoes.splice(0, this.echoes.length - this.maxEchoes);
    return violated;
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
    const hits: EchoHit<V>[] = [];
    this.runEchoes(hits);
    for (const d of this.domains) if (d.decay > 0) d.dissonance = Math.max(0, d.dissonance - d.decay);
    this.updateLags();
    return hits;
  }

  commit(): void { for (const t of this.ents.values()) t.hist.push(t.e.pos); }

  private runEchoes(hits: EchoHit<V>[]): void {
    const next: Echo<V>[] = [];
    for (const e of this.echoes) {
      if (e.due > this.tick) { next.push(e); continue; }
      const d = this.domains.find(d => d.id === e.domainId)!;
      if (!e.fired) {
        e.fired = true; e.t0 = this.tick;
        this.events.push({ type: 'echo', tick: this.tick, domainId: d.id, origin: e.origin });
        if (e.left > 1) next.push({
          ...e, due: this.tick + d.echoDelay, gain: e.gain * d.echoGain, left: e.left - 1,
          fired: false, hit: new Set(), origin: this.space.clone(e.origin), impulse: this.space.clone(e.impulse),
        });
      }
      // wavefront: finite echoSpeed makes shear propagate causally instead of instantly
      const reach = Math.min(d.ripple, d.echoSpeed === Infinity ? Infinity : (this.tick - e.t0) * d.echoSpeed);
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
