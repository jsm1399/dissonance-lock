import { ClockMap } from "./clock.js";
import type { Vec } from "./vec.js";
import { vadd, vsub, vscale, vdist, vzero } from "./vec.js";

export const ROOT = "root";

export interface DomainSpec {
  id: string;
  parent: string;
  /** Domain center, in PARENT coordinates. Local origin == center. */
  origin: Vec;
  /** Local length per parent length (>0). */
  scale: number;
  /** Ball radius, in PARENT length units. */
  extent: number;
  /** Echo speed in LOCAL length per LOCAL time (at shear == 1). */
  echoSpeed: number;
  /** Initial dt_local / dt_parent. */
  rate?: number;
  offset?: number;
  /** Clock-shear: positive rate multiplier at a local position. */
  shear?: (local: Vec) => number;
}

export interface Domain {
  readonly id: string;
  readonly parent: Domain | null;
  readonly depth: number;
  readonly origin: Vec;
  readonly scale: number;
  readonly extent: number;
  readonly echoSpeed: number;
  readonly shear?: (local: Vec) => number;
  readonly clock: ClockMap;
  readonly rootPerLocal: number;
  readonly centerRoot: Vec;
  readonly radiusRoot: number;
  /** root ... self */
  readonly chain: Domain[];
}

const pos = (x: number, name: string) => {
  if (!(x > 0)) throw new RangeError(`${name} must be > 0, got ${x}`);
};

function upPos(d: Domain, p: Vec): Vec {
  let q = p;
  for (let n: Domain | null = d; n && n.parent; n = n.parent) q = vadd(n.origin, vscale(q, 1 / n.scale));
  return q;
}
function downPos(d: Domain, p: Vec): Vec {
  let q = p;
  for (const n of d.chain) if (n.parent) q = vscale(vsub(q, n.origin), n.scale);
  return q;
}

export class StrataTree {
  readonly dim: number;
  readonly root: Domain;
  private byId = new Map<string, Domain>();
  private kids: Domain[] = [];

  constructor(dim: number, rootEchoSpeed: number) {
    pos(rootEchoSpeed, "rootEchoSpeed");
    this.dim = dim;
    const root: Domain = {
      id: ROOT, parent: null, depth: 0, origin: vzero(dim), scale: 1, extent: Infinity,
      echoSpeed: rootEchoSpeed, clock: new ClockMap(), rootPerLocal: 1,
      centerRoot: vzero(dim), radiusRoot: Infinity, chain: [],
    };
    root.chain.push(root);
    this.root = root;
    this.byId.set(ROOT, root);
  }

  get(id: string): Domain {
    const d = this.byId.get(id);
    if (!d) throw new Error(`unknown domain: ${id}`);
    return d;
  }

  /** All non-root domains, in insertion order. */
  domains(): readonly Domain[] { return this.kids; }

  add(s: DomainSpec): Domain {
    if (this.byId.has(s.id)) throw new Error(`duplicate domain: ${s.id}`);
    const parent = this.get(s.parent);
    if (s.origin.length !== this.dim) throw new RangeError("origin dimension mismatch");
    pos(s.scale, "scale"); pos(s.extent, "extent"); pos(s.echoSpeed, "echoSpeed");
    const node: Domain = {
      id: s.id, parent, depth: parent.depth + 1, origin: s.origin, scale: s.scale,
      extent: s.extent, echoSpeed: s.echoSpeed, shear: s.shear,
      clock: new ClockMap(s.rate ?? 1, s.offset ?? 0),
      rootPerLocal: parent.rootPerLocal / s.scale,
      centerRoot: upPos(parent, s.origin),
      radiusRoot: s.extent * parent.rootPerLocal,
      chain: [],
    };
    node.chain.push(...parent.chain, node);
    this.byId.set(s.id, node);
    this.kids.push(node);
    return node;
  }

  /** Change a domain's clock rate from PARENT time `parentTime` onward. */
  setRate(id: string, parentTime: number, rate: number): void {
    const d = this.get(id);
    if (!d.parent) throw new Error("root clock is the global clock");
    d.clock.setRate(parentTime, rate);
  }

  toRootPos(id: string, p: Vec): Vec { return upPos(this.get(id), p); }
  toLocalPos(id: string, p: Vec): Vec { return downPos(this.get(id), p); }

  toRootTime(id: string, t: number): number {
    for (let n: Domain | null = this.get(id); n && n.parent; n = n.parent) t = n.clock.parent(t);
    return t;
  }
  toLocalTime(id: string, t: number): number {
    for (const n of this.get(id).chain) if (n.parent) t = n.clock.local(t);
    return t;
  }

  /** dt_local / dt_root for domain d at root time t. */
  rateToRoot(d: Domain, tRoot: number): number {
    let t = tRoot, rho = 1;
    for (const n of d.chain) if (n.parent) { rho *= n.clock.rateAt(t); t = n.clock.local(t); }
    return rho;
  }

  /** Deepest domain containing root position p (ties: smaller radius, then first added). */
  domainAt(p: Vec): Domain {
    let best = this.root;
    for (const k of this.kids) {
      if (vdist(p, k.centerRoot) > k.radiusRoot) continue;
      if (k.depth > best.depth || (k.depth === best.depth && k.radiusRoot < best.radiusRoot)) best = k;
    }
    return best;
  }

  /** Echo speed in ROOT length per ROOT time at root position p, root time t. */
  speedAt(p: Vec, tRoot: number): number {
    const d = this.domainAt(p);
    let shear = 1;
    for (const n of d.chain) if (n.shear) shear *= n.shear(downPos(n, p));
    const v = d.echoSpeed * d.rootPerLocal * this.rateToRoot(d, tRoot) * shear;
    if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`non-positive echo speed in ${d.id}: ${v}`);
    return v;
  }

  finestRadius(): number {
    let r = Infinity;
    for (const k of this.kids) r = Math.min(r, k.radiusRoot);
    return r;
  }
}
