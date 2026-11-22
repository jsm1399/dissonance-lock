import type { Vec } from './types.ts';

/** Ring buffer of past positions. get(0) = newest. */
export class History {
  private buf: Float64Array;
  private head = 0;
  private count = 0;
  readonly cap: number;
  constructor(cap: number) { this.cap = cap; this.buf = new Float64Array(cap * 2); }

  push(p: Vec): void {
    this.buf[this.head * 2] = p.x;
    this.buf[this.head * 2 + 1] = p.y;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  get(k: number, out: Vec): Vec {
    if (this.count === 0) return out;
    const kk = Math.min(k, this.count - 1);
    const i = (this.head - 1 - kk + this.cap * 2) % this.cap;
    out.x = this.buf[i * 2];
    out.y = this.buf[i * 2 + 1];
    return out;
  }
}
