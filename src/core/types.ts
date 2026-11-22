import type { Region } from './region.ts';

/** Host-owned entity. `pos` is a LIVE reference the host mutates; the core only writes `lag`. */
export interface Tracked<V> { id: number; pos: V; lag: number }

export interface DomainDef<V> {
  id: string;
  region: Region<V>;
  /** local reality rules: action -> severity (0..1). Inherited from `parent`; a child value (0 = permit) overrides. */
  forbid: Record<string, number>;
  parent?: string;     // enclosing domain id (must already be added)
  clock?: number;      // local time rate relative to parent (default 1; 0 freezes the domain)
  bleed?: number;      // fraction of shear leaked to the parent, per level (default 0.5)
  maxLag?: number;     // ticks the perceived frame trails at dissonance=1 (default 24)
  echoDelay?: number;  // local-time units from violation to first echo (default 18)
  echoGain?: number;   // impulse multiplier per generation (default 0.6)
  echoCount?: number;  // echo generations per violation (default 2)
  ripple?: number;     // echo reach, in space units (default region.extent)
  echoSpeed?: number;  // wavefront speed, units per local-time unit (default Infinity = instantaneous ripple)
  decay?: number;      // natural dissonance decay per local-time unit (default 0: needs an anchor)
}

export interface Domain<V> extends Omit<Required<DomainDef<V>>, 'parent'> {
  parent: Domain<V> | null;
  dissonance: number;
  /** effective time rate versus global ticks (product of `clock` along the ancestry) */
  rate: number;
  /** local time elapsed; echo timing and wavefronts run on this clock */
  time: number;
}

export interface Anchor<V> { id: string; pos: V; radius: number; power: number }

export interface Echo<V> {
  /** `due` and `t0` are in the owning domain's local time */
  domainId: string; due: number; origin: V; impulse: V; gain: number; left: number;
  fired: boolean; t0: number; hit: Set<number>;
}

/** Impulse the host must apply to an entity (core never touches host physics state). */
export interface EchoHit<V> { entityId: number; impulse: V }

export type ShearEvent<V> =
  | { type: 'violation'; tick: number; entityId: number; domainId: string; action: string }
  | { type: 'echo'; tick: number; domainId: string; origin: V }
  | { type: 'anchor'; tick: number; entityId: number; anchorId: string; domainsCleared: string[] };
