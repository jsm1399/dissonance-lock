import { ShearField, Vec2Space, ball } from '../core/index.ts';
import type { Anchor, Domain, DomainDef, Tracked, Vec2 } from '../core/index.ts';
import { fieldsAt, type FieldRules, type FieldZone } from './fields.ts';

/** 2D circle-physics harness driving the Dissonance-Lock core. Not part of the core. */
export const DT = 1 / 60;

export interface Body extends Tracked<Vec2> {
  vel: Vec2; r: number; invMass: number; tag: string;
}
export interface BodyDef { pos: Vec2; r?: number; mass?: number; tag?: string; vel?: Vec2 }

export interface ZoneDef {
  id: string; center: Vec2; radius: number;
  fields?: FieldRules;
  /** Dissonance-Lock rules. Omit for a plain physics zone. */
  shear?: Omit<DomainDef<Vec2>, 'id' | 'region'>;
}
export interface Zone extends FieldZone { id: string; domain: Domain<Vec2> | null }

export interface WorldOpts {
  width: number; height: number;
  drag?: number; gravity?: Vec2; restitution?: number; historyDepth?: number;
}

export class World {
  readonly field: ShearField<Vec2>;
  bodies: Body[] = [];
  zones: Zone[] = [];
  opts: WorldOpts;
  private actions = new Map<string, number>();
  private nextId = 1;
  private drag: number;
  private rest: number;

  constructor(opts: WorldOpts) {
    this.opts = opts;
    this.drag = opts.drag ?? 1.2;
    this.rest = opts.restitution ?? 0.5;
    this.field = new ShearField<Vec2>({ space: Vec2Space, historyDepth: opts.historyDepth ?? 64 });
  }

  get tick(): number { return this.field.tick; }
  get events() { return this.field.events; }
  get echoes() { return this.field.echoes; }
  get anchors() { return this.field.anchors; }

  addBody(d: BodyDef): Body {
    const mass = d.mass ?? 1;
    const b: Body = {
      id: this.nextId++, pos: { ...d.pos }, vel: { ...(d.vel ?? { x: 0, y: 0 }) },
      r: d.r ?? 12, invMass: mass === 0 ? 0 : 1 / mass, tag: d.tag ?? '', lag: 0,
    };
    this.bodies.push(b);
    this.field.track(b);
    return b;
  }

  addZone(d: ZoneDef): Zone {
    const domain = d.shear
      ? this.field.addDomain({ id: d.id, region: ball(Vec2Space, d.center, d.radius), ...d.shear })
      : null;
    const z: Zone = { id: d.id, center: d.center, radius: d.radius, fields: d.fields ?? {}, domain };
    this.zones.push(z);
    return z;
  }

  addAnchor(a: Anchor<Vec2>): void { this.field.addAnchor(a); }
  defineAction(name: string, impulse: number): void { this.actions.set(name, impulse); }
  body(id: number): Body { return this.bodies.find(b => b.id === id)!; }
  perceived(b: Body): Vec2 { return this.field.perceived(b.id); }
  fieldsAt(p: Vec2) { return fieldsAt(this.zones, p, this.drag, this.opts.gravity); }
  reanchor(id: number): boolean { return this.field.reanchor(id); }

  move(id: number, dir: Vec2, accel = 900): void {
    const b = this.body(id);
    b.vel.x += dir.x * accel * DT * b.invMass;
    b.vel.y += dir.y * accel * DT * b.invMass;
  }

  /** Named impulse. Rule violations are reported to the core. */
  act(id: number, action: string, dir: Vec2): boolean {
    const mag = this.actions.get(action);
    if (mag === undefined) return false;
    const b = this.body(id);
    const len = Math.hypot(dir.x, dir.y) || 1;
    const imp = { x: (dir.x / len) * mag, y: (dir.y / len) * mag };
    b.vel.x += imp.x * b.invMass; b.vel.y += imp.y * b.invMass;
    return this.field.violate(id, action, imp);
  }

  step(): void {
    for (const h of this.field.begin()) {
      const b = this.body(h.entityId);
      b.vel.x += h.impulse.x * b.invMass; b.vel.y += h.impulse.y * b.invMass;
    }
    this.integrate();
    this.collide();
    this.bounds();
    this.field.commit();
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

  /** Contacts are detected in the PERCEIVED frame, corrected on REAL positions: offset collisions. */
  private collide(): void {
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.bodies[i], b = this.bodies[j];
        const wsum = a.invMass + b.invMass;
        if (wsum === 0) continue;
        const pa = this.field.perceived(a.id), pb = this.field.perceived(b.id);
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy);
        const pen = a.r + b.r - d;
        if (pen <= 0) continue;
        if (d === 0) { dx = 1; dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d;
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
