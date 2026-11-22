// Core (Dissonance-Lock mechanics)
export * from './core/index.ts';
// Harnesses (2D physics + demo level) — optional, replaceable
export { World, DT } from './harness/sim2d.ts';
export type { Body, BodyDef, Zone, ZoneDef, WorldOpts } from './harness/sim2d.ts';
export type { FieldRules } from './harness/fields.ts';
export { createSlipstream } from './harness/slipstream.ts';
export { createTidepool } from './harness/tidepool.ts';
export { LEVELS } from './harness/levels.ts';
export type { Level } from './harness/level.ts';
