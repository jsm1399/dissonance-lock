import { hashSeed } from "./rng.js";

/** In-world framing. Pure text: no game rules live here. */
export interface Brief { title: string; lines: string[] }

export const BRIEFS: Record<number, Brief> = {
  1: { title: "SECTOR 1 · QUIET SHEAR", lines: ["A time-well sits between you and the beacons. Echoes arrive bent and late.", "Find the stretch of lattice where they still agree. Hold resonance there."] },
  2: { title: "SECTOR 2 · FAST WATER", lines: ["A clock-domain runs three times faster than the rest of the lattice, and it drifts.", "What is old news at the rim is brand new at the core."] },
  3: { title: "SECTOR 3 · DEEP STRATA", lines: ["Domains inside domains, each keeping its own time.", "Do not chase the order of events. Chase the quiet between them."] },
  4: { title: "SECTOR 4 · TWIN WELLS", lines: ["Two time-sinks and a fast lane in between. Cause and effect tangle here.", "Re-anchor before the lattice does it for you."] },
  5: { title: "SECTOR 5 · EVENT HORIZON", lines: ["A well deep enough that nothing arrives on time, and a fast pocket inside it.", "Few operators have held a lock here."] },
  6: { title: "SECTOR 6 · HIDDEN AXIS", lines: ["The lattice has a depth the map cannot show. Some beacons hover off your plane.", "Their echoes come late for reasons the nearest beacon will not explain."] },
};

const NAMES = ["Cinder", "Halcyon", "Mirrorfall", "Static Orchard", "Ninth Wake", "Glasswork", "Low Meridian", "Vesper Gate",
  "Hollow Choir", "Ash Relay", "Tidewire", "Lantern Deep", "Paper Sun", "Null Harbor", "Third Dawn", "Quiet Furnace"];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Deterministic designation for a Drift sector: same seed and depth, same name for everyone. */
export function sectorName(seed: number, depth: number): { code: string; name: string } {
  const h = hashSeed("sector", seed, depth);
  const code = `${LETTERS[h % LETTERS.length]}${LETTERS[(h >>> 5) % LETTERS.length]}-${10 + ((h >>> 10) % 90)}`;
  return { code, name: NAMES[(h >>> 17) % NAMES.length] };
}

export function driftBrief(seed: number, depth: number, beacons: number, hidden: boolean): Brief {
  const s = sectorName(seed, depth);
  const lines = [`Depth ${depth}. ${beacons} beacons on the lattice.`];
  lines.push(hidden ? "A hidden axis is present. Not every echo lies in your plane."
    : depth >= 4 ? "Nested clocks detected. Expect drift." : depth >= 2 ? "A fast domain has been reported." : "The lattice is calm. For now.");
  return { title: `${s.code} · ${s.name.toUpperCase()}`, lines };
}
