import type { VectorSpace } from './vector.ts';

/** Where a domain's local reality applies. Implement for boxes, meshes, light-cones, etc. */
export interface Region<V> {
  center: V;
  /** characteristic size; default echo ripple radius */
  extent: number;
  contains(p: V): boolean;
  /** 1 at the heart of the region, 0 at its edge */
  falloff(p: V): number;
}

export function ball<V>(space: VectorSpace<V>, center: V, radius: number): Region<V> {
  return {
    center, extent: radius,
    contains: p => space.dist(center, p) <= radius,
    falloff: p => Math.max(0, 1 - space.dist(center, p) / radius),
  };
}
