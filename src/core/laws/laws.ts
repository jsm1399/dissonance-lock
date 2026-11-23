/**
 * Lawbook: the rules of a world as swappable DATA. Dimension-agnostic and unitless.
 * The same world (domains, emitters) can be run under different laws; nothing else changes.
 */
export type TimeLaw = "local" | "global";
export type MediumLaw = "strata" | "uniform";
/** How flux dilutes with distance. holds = Gauss (r^-(D-1)); leaky dilutes too fast; runaway too slowly. */
export type GaussLaw = "holds" | "leaky" | "runaway";

export interface Laws {
  /** local: every domain keeps its own clock. global: one clock for all (domain rates/drifts ignored). */
  time: TimeLaw;
  /** strata: echo speed varies by domain and shear. uniform: one echo speed everywhere. */
  medium: MediumLaw;
  /** Dimension of the space the picture is a slice of (2..6). Sets how energy dilutes with distance. */
  dim: number;
  /** Energy absorbed per unit root length travelled inside any domain (>= 0). */
  loss: number;
  /** Information fidelity lost per unit root length travelled inside shear wells (>= 0). */
  noise: number;
  gauss: GaussLaw;
}

export const DIM_MIN = 2;
export const DIM_MAX = 6;

export const LAWFUL: Laws = { time: "local", medium: "strata", dim: 2, loss: 0, noise: 0, gauss: "holds" };

export const LOSS_STEPS = [0, 0.01, 0.03, 0.1];
export const NOISE_STEPS = [0, 0.02, 0.06];

export const cloneLaws = (l: Laws): Laws => ({ ...l });
export const isLawful = (l: Laws): boolean =>
  l.time === LAWFUL.time && l.medium === LAWFUL.medium && l.dim === LAWFUL.dim &&
  l.loss === LAWFUL.loss && l.noise === LAWFUL.noise && l.gauss === LAWFUL.gauss;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Human-readable problems; empty array = valid. */
export function validateLaws(l: Laws): string[] {
  const e: string[] = [];
  if (l.time !== "local" && l.time !== "global") e.push("time law must be local|global");
  if (l.medium !== "strata" && l.medium !== "uniform") e.push("medium law must be strata|uniform");
  if (!Number.isInteger(l.dim) || l.dim < DIM_MIN || l.dim > DIM_MAX) e.push(`dim must be an integer in ${DIM_MIN}..${DIM_MAX}`);
  if (!fin(l.loss) || l.loss < 0 || l.loss > 1) e.push("loss must be in [0,1]");
  if (!fin(l.noise) || l.noise < 0 || l.noise > 1) e.push("noise must be in [0,1]");
  if (l.gauss !== "holds" && l.gauss !== "leaky" && l.gauss !== "runaway") e.push("gauss must be holds|leaky|runaway");
  return e;
}

/** Strict parse of untrusted data: undefined -> LAWFUL, anything malformed -> null. */
export function parseLaws(raw: unknown): Laws | null {
  if (raw === undefined || raw === null) return cloneLaws(LAWFUL);
  if (typeof raw !== "object") return null;
  const j = raw as Partial<Laws>;
  const l: Laws = {
    time: j.time as TimeLaw, medium: j.medium as MediumLaw, dim: j.dim as number,
    loss: j.loss as number, noise: j.noise as number, gauss: j.gauss as GaussLaw,
  };
  return validateLaws(l).length === 0 ? l : null;
}

/** Γ(n/2) for integer n >= 1, exactly via the half-integer recurrence. */
function gammaHalf(n: number): number {
  let g = n % 2 === 0 ? 1 : Math.sqrt(Math.PI); // Γ(1) or Γ(1/2)
  for (let x = n % 2 === 0 ? 1 : 0.5; x < n / 2 - 1e-9; x += 1) g *= x;
  return g;
}

/** Surface measure of the unit (D-1)-sphere in D dimensions (D=2: 2π, D=3: 4π, D=4: 2π²). */
export const sphereArea = (D: number): number => (2 * Math.pow(Math.PI, D / 2)) / gammaHalf(D);

/** Emitters have a finite core; inside it nothing dilutes. */
export const CORE = 1;

/** Exponent n in flux ∝ r^-n for these laws. */
export function spreadExponent(l: Laws): number {
  return l.gauss === "holds" ? l.dim - 1 : l.gauss === "leaky" ? l.dim : Math.max(0, l.dim - 2);
}

/** Flux density at distance r from an emission of total energy `e` (before absorption). */
export function fluxDensity(l: Laws, e: number, r: number): number {
  const rr = Math.max(CORE, r);
  return e / (sphereArea(l.dim) * Math.pow(rr, spreadExponent(l)));
}

/** Total energy crossing the whole (D-1)-sphere of radius r, given the flux density there. */
export function shellEnergy(l: Laws, flux: number, r: number): number {
  const rr = Math.max(CORE, r);
  return flux * sphereArea(l.dim) * Math.pow(rr, l.dim - 1);
}
