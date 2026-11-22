import { History } from './history.ts';
import type { Anchor, Body, Echo, Vec, WorldEvent, Zone, ZoneDef } from './types.ts';

export interface WorldOpts {
  width: number; height: number;
  drag?: number;          // velocity damping per second (default 1.2)
  gravity?: Vec;          // global acceleration (default 0,0)
  restitution?: number;   // default 0.5
  maxLagCap?: number;     // history depth (default 64)
}

export interface BodyDef { pos: Vec; r?: number; mass?: number; tag?: string; vel?: Vec }

export const DT = 1 / 60;

export class World {
  tick = 0;
  bodies: Body[] = [];
  zones: Zone[] = [];
  anchors: Anchor[] = [];
  echoes: Echo[] = [];
  events: WorldEvent[] = [];
  private hist = new Map<number, History>();
  private actions = new Map<string, number>(); // name -> impulse magnitude
  private nextId = 1;
  private readonly drag: number;
  private readonly rest: number;
  private readonly cap: number;

  opts: WorldOpts;
  constructor(opts: WorldOpts) {
    this.opts = opts;
    this.drag = opts.drag ?? 1.2;
    this.rest = opts.restitution ?? 0.5;
    this.cap = opts.maxLagCap ?? 64;
  }

  // ---------- setup ----------
  addBody(d: BodyDef): Body {
    const mass = d.mass ?? 1;
    const b: Body = {
      id: this.nextId++, pos: { ...d.pos }, vel: { ...(d.vel ?? { x: 0, y: 0 }) },
      r: d.r ?? 12, invMass: mass === 0 ? 0 : 1 / mass, tag: d.tag ?? '', lag: 0,
    };
    this.bodies.push(b);
    const h = new History(this.cap);
    h.push(b.pos);
    this.hist.set(b.id, h);
    return b;
  }

  addZone(d: ZoneDef): Zone {
    const z: Zone = {
      maxLag: 24, echoDelay: 18, echoGain: 0.6, echoCount: 2, ripple: d.radius, decay: 0,
      ...d, dissonance: 0,
    };
    z.maxLag = Math.min(z.maxLag, this.cap - 1);
    this.zones.push(z);
    return z;
  }

  addAnchor(a: Anchor): void { this.anchors.push(a); }
  defineAction(name: string, impulse: number): void { this.actions.set(name, impulse); }
  body(id: number): Body { return this.bodies.find(b => b.id === id)!; }

  /** Hitbox position: real position delayed by body.lag ticks. */
  perceived(b: Body, out: Vec = { x: 0, y: 0 }): Vec {
    if (b.lag <= 0) { out.x = b.pos.x; out.y = b.pos.y; return out; }
    return this.hist.get(b.id)!.get(b.lag - 1, out);
  }

  // ---------- input ----------
  /** Continuous movement; never violates rules. */
  move(id: number, dir: Vec, accel = 900): void {
    const b = this.body(id);
    b.vel.x += dir.x * accel * DT * b.invMass;
    b.vel.y += dir.y * accel * DT * b.invMass;
  }

  /** Named impulse action. Violating a zone's rules builds dissonance + schedules echoes. */
  act(id: number, action: string, dir: Vec): boolean {
    const mag = this.actions.get(action);
    if (mag === undefined) return false;
    const b = this.body(id);
    const len = Math.hypot(dir.x, dir.y) || 1;
    const imp = { x: (dir.x / len) * mag, y: (dir.y / len) * mag };
    b.vel.x += imp.x * b.invMass;
    b.vel.y += imp.y * b.invMass;

    let violated = false;
    for (const z of this.zones) {
      const sev = z.rules.forbid?.[action];
      if (sev === undefined || !this.inZone(z, b.pos)) continue;
      violated = true;
      z.dissonance = Math.min(1, z.dissonance + sev);
      this.events.push({ type: 'violation', tick: this.tick, bodyId: id, zoneId: z.id, action });
      this.echoes.push({
        due: this.tick + z.echoDelay, zoneId: z.id, origin: { ...b.pos },
        impulse: imp, gain: z.echoGain, left: z.echoCount,
      });
    }
    return violated;
  }

  /** Re-anchor: if body is inside an anchor's radius, purge dissonance + echoes of zones containing it. */
  reanchor(id: number): boolean {
    const b = this.body(id);
    const a = this.anchors.find(a => dist(a.pos, b.pos) <= a.radius);
    if (!a) return false;
    const cleared: string[] = [];
    for (const z of this.zones) {
      if (!this.inZone(z, a.pos)) continue;
      z.dissonance = Math.max(0, z.dissonance - a.power);
      cleared.push(z.id);
      if (z.dissonance === 0) this.echoes = this.echoes.filter(e => e.zoneId !== z.id);
    }
    this.events.push({ type: 'anchor', tick: this.tick, bodyId: id, anchorId: a.id, zonesCleared: cleared });
    return true;
  }

  // ---------- simulation ----------
  step(): void {
    this.events.length = 0;
    this.tick++;
    this.runEchoes();
    for (const z of this.zones) if (z.decay > 0) z.dissonance = Math.max(0, z.dissonance - z.decay);
    this.integrate();
    this.updateLags();
    this.collide();
    this.bounds();
    for (const b of this.bodies) this.hist.get(b.id)!.push(b.pos);
  }

  private inZone(z: Zone, p: Vec): boolean { return dist(z.center, p) <= z.radius; }

  private runEchoes(): void {
    const keep: Echo[] = [];
    for (const e of this.echoes) {
      if (e.due > this.tick) { keep.push(e); continue; }
      const z = this.zones.find(z => z.id === e.zoneId)!;
      this.events.push({ type: 'echo', tick: this.tick, zoneId: z.id, origin: e.origin });
      for (const b of this.bodies) {
        if (b.invMass === 0 || !this.inZone(z, b.pos)) continue;
        const d = dist(e.origin, b.pos);
        if (d > z.ripple) continue;
        const f = e.gain * (1 - d / z.ripple);
        b.vel.x += e.impulse.x * f * b.invMass;
        b.vel.y += e.impulse.y * f * b.invMass;
      }
      if (e.left > 1) keep.push({ ...e, due: this.tick + z.echoDelay, gain: e.gain * z.echoGain, left: e.left - 1 });
    }
    this.echoes = keep;
  }

  /** Effective physics rules at a point: gravity+attract stack, friction = smallest containing zone that sets it. */
  fieldsAt(p: Vec): { gx: number; gy: number; friction: number } {
    const g = this.opts.gravity;
    let gx = g?.x ?? 0, gy = g?.y ?? 0, friction = this.drag, fr = Infinity;
    for (const z of this.zones) {
      const d = dist(z.center, p);
      if (d > z.radius) continue;
      const r = z.rules;
      if (r.gravity) { gx += r.gravity.x; gy += r.gravity.y; }
      if (r.attract && d > 0) {
        const k = r.attract * (d / z.radius) / d; // magnitude attract*d/radius, direction to center
        gx += (z.center.x - p.x) * k; gy += (z.center.y - p.y) * k;
      }
      if (r.friction !== undefined && z.radius < fr) { friction = r.friction; fr = z.radius; }
    }
    return { gx, gy, friction };
  }

  private integrate(): void {
    for (const b of this.bodies) {
      if (b.invMass === 0) continue;
      const f = this.fieldsAt(b.pos);
      const damp = Math.max(0, 1 - f.friction * DT);
      b.vel.x = (b.vel.x + f.gx * DT) * damp;
      b.vel.y = (b.vel.y + f.gy * DT) * damp;
      b.pos.x += b.vel.x * DT; b.pos.y += b.vel.y * DT;
    }
  }

  private updateLags(): void {
    for (const b of this.bodies) {
      let target = 0;
      for (const z of this.zones) {
        const d = dist(z.center, b.pos);
        if (d > z.radius) continue;
        target = Math.max(target, Math.round(z.dissonance * z.maxLag * (1 - 0.5 * (d / z.radius))));
      }
      b.lag += Math.sign(target - b.lag); // slew 1 tick/tick: no hitbox teleporting
    }
  }

  private collide(): void {
    const pa: Vec = { x: 0, y: 0 }, pb: Vec = { x: 0, y: 0 };
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.bodies[i], b = this.bodies[j];
        const wsum = a.invMass + b.invMass;
        if (wsum === 0) continue;
        this.perceived(a, pa); this.perceived(b, pb);
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy);
        const pen = a.r + b.r - d;
        if (pen <= 0) continue;
        if (d === 0) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d;
        // positional correction applied to REAL positions, normal from PERCEIVED ones
        const ca = pen * (a.invMass / wsum), cb = pen * (b.invMass / wsum);
        a.pos.x -= nx * ca; a.pos.y -= ny * ca;
        b.pos.x += nx * cb; b.pos.y += ny * cb;
        const rv = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
        if (rv > 0) continue;
        const j2 = (-(1 + this.rest) * rv) / wsum;
        a.vel.x -= j2 * nx * a.invMass; a.vel.y -= j2 * ny * a.invMass;
        b.vel.x += j2 * nx * b.invMass; b.vel.y += j2 * ny * b.invMass;
      }
    }
  }

  private bounds(): void {
    const { width: w, height: h } = this.opts;
    for (const b of this.bodies) {
      if (b.invMass === 0) continue;
      if (b.pos.x < b.r) { b.pos.x = b.r; b.vel.x = Math.abs(b.vel.x) * this.rest; }
      if (b.pos.x > w - b.r) { b.pos.x = w - b.r; b.vel.x = -Math.abs(b.vel.x) * this.rest; }
      if (b.pos.y < b.r) { b.pos.y = b.r; b.vel.y = Math.abs(b.vel.y) * this.rest; }
      if (b.pos.y > h - b.r) { b.pos.y = h - b.r; b.vel.y = -Math.abs(b.vel.y) * this.rest; }
    }
  }
}

function dist(a: Vec, b: Vec): number { return Math.hypot(a.x - b.x, a.y - b.y); }
