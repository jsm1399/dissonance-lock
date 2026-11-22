import type { VectorSpace } from './vector.ts';

/** Ring buffer of past states. get(0) = newest. Returned values are read-only references. */
export class History<V> {
  readonly cap: number;
  private space: VectorSpace<V>;
  private buf: V[] = [];
  private head = 0;
  private count = 0;
  constructor(cap: number, space: VectorSpace<V>) { this.cap = cap; this.space = space; }

  push(p: V): void {
    if (this.buf.length < this.cap) this.buf.push(this.space.clone(p));
    else this.space.copy(this.buf[this.head], p);
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  get(k: number): V {
    const kk = Math.min(k, this.count - 1);
    return this.buf[(this.head - 1 - kk + this.cap * 2) % this.cap];
  }
}
