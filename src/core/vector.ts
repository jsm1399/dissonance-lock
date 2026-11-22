/** Minimal vector algebra the core needs. Any dimension, any scale: supply your own space. */
export interface VectorSpace<V> {
  clone(v: V): V;
  copy(to: V, from: V): void;
  scale(v: V, k: number): V;
  dist(a: V, b: V): number;
}

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export const Vec2Space: VectorSpace<Vec2> = {
  clone: v => ({ x: v.x, y: v.y }),
  copy: (t, f) => { t.x = f.x; t.y = f.y; },
  scale: (v, k) => ({ x: v.x * k, y: v.y * k }),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
};

export const Vec3Space: VectorSpace<Vec3> = {
  clone: v => ({ x: v.x, y: v.y, z: v.z }),
  copy: (t, f) => { t.x = f.x; t.y = f.y; t.z = f.z; },
  scale: (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k }),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
};
