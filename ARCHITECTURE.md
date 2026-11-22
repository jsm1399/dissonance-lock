# Architecture

```
src/core/      Dissonance-Lock mechanics ONLY (no physics, no levels, no fields)
src/harness/   Replaceable hosts: sim2d (circle physics + gravity/attract/friction), slipstream (puzzle)
src/demo/      Browser canvas demo
```

## Core contract (`ShearField<V>`)
- **Domain**: a `Region<V>` + local rules (`forbid`: action → severity) + shear params. Violations raise `dissonance` (0..1).
- **Lag**: entities in a dissonant domain get `lag` ticks (slewed 1/tick). `perceived(id)` is the lagged frame hosts use for contacts, so hitboxes trail reality (offset collisions).
- **Echoes**: a violation schedules delayed, decaying re-impulses (`echoCount`, `echoGain`, `echoDelay`). Delivered as `EchoHit[]`; the host applies them. The core never mutates host physics.
- **Echo ripple**: `ripple` radius with linear falloff. `echoSpeed` makes it a causal wavefront (default `Infinity` = instant).
- **Re-anchor**: anchors cut dissonance and purge pending echoes.

Host frame: `hits = field.begin()` → apply hits, integrate, contacts via `perceived()` → `field.commit()`.

## Scaling without rewrites
- **Dimension**: core is generic over `VectorSpace<V>` (`Vec2Space`, `Vec3Space` shipped; bring your own).
- **Region shape**: implement `Region<V>` (ball shipped; boxes, meshes, light-cones are drop-ins).
- **Scale**: no unit assumptions. Tests run a 1e12-unit domain with `echoSpeed` 1e10/tick (light-delay-style shear, Type I–II scale).
- **Time**: ticks are abstract; a host may run domains at different tick rates by calling `begin/commit` per time-scale.
- **Planned (core-only)**: nested domains, per-domain clocks, region-based `perceived` for lagged sensors.
