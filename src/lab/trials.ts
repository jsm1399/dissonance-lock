import { feedbackAudit, hasFeedback, zetaFix } from "./lab.js";
import type { Lab } from "./lab.js";
import type { WorldSpec } from "./world.js";

/**
 * Calibration Trials: broken worlds that the player repairs with the Observatory's own tools.
 * Every goal is judged by an instrument the Observatory already trusts (the loop stability audit, the energy
 * account, the zeta clock fix), so a trial can never be passed by flattering a scoreboard.
 */
export interface TrialState { ok: boolean; status: string }

export interface Trial {
  id: string;
  name: string;
  /** one line, what is wrong and what to achieve */
  brief: string;
  /** the broken world */
  world(): WorldSpec;
  /** scrub time the trial is set at */
  t: number;
  check(lab: Lab): TrialState;
}

type Em = WorldSpec["emitters"][number];
const em = (o: Partial<Em> & Pick<Em, "id" | "pos">): Em => ({ domain: "root", period: 40, phase: 0, hue: 190, ...o });

const rate = (r: number): string => `${r >= 0 ? "+" : ""}${r.toFixed(3)}/s`;

export const TRIALS: Trial[] = [
  {
    id: "runaway", name: "Runaway",
    brief: "A and B re-emit each other and every round trip is louder. Make the loop die out; do not remove it.",
    t: 0,
    world: () => ({
      v: 1, rootSpeed: 6, domains: [],
      emitters: [
        em({ id: "A", pos: [10, 50], hue: 190, fb: { from: "B", delay: 1, gain: 1.3 } }),
        em({ id: "B", pos: [40, 50], hue: 40, fb: { from: "A", delay: 1, gain: 1.3 } }),
      ],
    }),
    check(lab) {
      if (!hasFeedback(lab)) return { ok: false, status: "the loop is gone: keep it, tame it" };
      const a = feedbackAudit(lab), w = a.worst;
      if (!w) return { ok: false, status: "no loop left: keep it, tame it" };
      const ok = w.verdict === "damped" && w.rate <= -0.01;
      return { ok, status: `${w.verdict.toUpperCase()} ${rate(w.rate)} · need damped, faster than -0.010/s` };
    },
  },
  {
    id: "ring", name: "Ring Forever",
    brief: "This loop fades away. Tune it so it rings forever: neither fading nor growing.",
    t: 0,
    world: () => ({
      v: 1, rootSpeed: 6, domains: [],
      emitters: [
        em({ id: "A", pos: [10, 50], hue: 190, fb: { from: "B", delay: 1, gain: 0.8 } }),
        em({ id: "B", pos: [40, 50], hue: 40, fb: { from: "A", delay: 1, gain: 1 } }),
      ],
    }),
    check(lab) {
      if (!hasFeedback(lab)) return { ok: false, status: "the loop is gone: keep it" };
      const w = feedbackAudit(lab).worst;
      if (!w) return { ok: false, status: "no loop left: keep it" };
      return { ok: w.verdict === "marginal", status: `${w.verdict.toUpperCase()} ${rate(w.rate)} · need within ±0.002/s` };
    },
  },
  {
    id: "clock", name: "Quiet the Clock",
    brief: "Z is a zeta beacon whose clock drifts. Make the probe's calibration read as arithmetic time again.",
    t: 110,
    world: () => ({
      v: 1, rootSpeed: 6,
      domains: [{ id: "f", parent: "root", origin: [20, 50], scale: 1, extent: 6, echoSpeed: 6, rate: 3, shearMin: null, changes: [[90, 2], [96, 3.5]] }],
      emitters: [em({ id: "Z", domain: "f", pos: [0, 0], zeta: 3 })],
    }),
    check(lab) {
      const f = zetaFix(lab);
      if (!f || !f.fix) return { ok: false, status: "probe is still listening…" };
      const dev = `${(f.deviation * 100).toFixed(2)}%`;
      return { ok: f.verdict === "baseline" && f.identified, status: `${f.verdict.toUpperCase()} · deviation ${dev} · need baseline (< 0.30%)` };
    },
  },
  {
    id: "fanout", name: "Fan-Out",
    brief: "S feeds two re-emitters and together they send out more energy than S gave. Make the world passive, keep both taps.",
    t: 0,
    world: () => ({
      v: 1, rootSpeed: 6, domains: [],
      emitters: [
        em({ id: "S", pos: [50, 10], period: 6, hue: 130 }),
        em({ id: "A", pos: [20, 70], hue: 190, fb: { from: "S", delay: 1, gain: 0.7 } }),
        em({ id: "B", pos: [80, 70], hue: 40, fb: { from: "S", delay: 1, gain: 0.7 } }),
      ],
    }),
    check(lab) {
      const taps = lab.spec.emitters.filter((e) => e.fb);
      if (taps.length < 2) return { ok: false, status: "both taps must stay" };
      const sum = taps.reduce((s, e) => s + (e.fb?.gain ?? 0), 0);
      const strong = taps.every((e) => (e.fb?.gain ?? 0) >= 0.25);
      const a = feedbackAudit(lab);
      return { ok: !a.amplifier && strong, status: `${a.amplifier ? "✗ energy created" : "✓ passive"} · fan-out ${sum.toFixed(2)} · need ≤ 1.00, each tap ≥ 0.25` };
    },
  },
];
