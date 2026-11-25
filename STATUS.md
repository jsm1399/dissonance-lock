# STATUS — Dissonance-Lock v1.9

## Live capabilities
- Game: tutorial, 6 campaign levels, Daily/Free Drift (seeded, calibrated), gamepad, PWA/offline.
- Strata core (N-dimensional): nested domains, per-domain clocks with drift, shear wells, causal march, Fermat bent paths, ledger.
- Lawbook (data): time, medium, dimension, loss, noise, Gauss; energy audit flags created/destroyed energy.
- Observatory: build worlds, scrub time, probe, heat landscape, share by link, path straight/bent.
- **NEW v1.3 Spacetime view (V):** probe-frame causal diagram. x = distance to probe, y = time. Each emission is a segment launch → arrival; red = heard out of order; white = causal horizon; dashed = lawful light line. Map stays live as an inset (drag the probe there).
- **NEW v1.3 Causal cone:** select an emitter (inset, SELECT tool) in Spacetime view. Its mid-window pulse is classified against every other pulse by the core CausalLedger: ▲ future (it could influence), ▼ past (could have influenced it), faded = independent (spacelike). Dotted lines are the ideal light cone; the markers are the true classification in the real medium.

- **NEW v1.4 Relays + causal intervention:** RELAY tool (key 6: click a source emitter, then empty space) makes an emitter that re-emits each pulse it hears after a delay on its own clock, so real cause→effect chains cross domains and clocks. CUT (K) removes the highlighted pulse from history and everything it would have caused; UNCUT (U) restores. Spacetime draws cause links, ✕ cut marks, and rings the pulses the origin actually caused (always a subset of its ledger-future). Relays and cuts travel in share links.

- **NEW v1.5 Hidden dimension (BULK, key B):** the picture becomes a slice of a true 3D world (strata tree dim 3, domains become spheres). Z / Shift+Z move the selected emitter (or the probe) along the hidden axis. Off-plane emitters show their wavefront's section of the plane, spacetime and audit use 3D distance, and the BULK detector reports "apparent depth" vs actual from timing alone. It is exact in a uniform medium; slow wells fake depth, and fast drift hides it. Enabling bulk sets DIM 3 (flux ~ r^-2) so the energy audit stays honest. Depths travel in share links.

- **NEW v1.6 Hidden Axis in the game:** campaign Level 6 and Drift from depth 5 run in a 3D world. Some beacons hover off the plane (marked ↑, dashed halo, no wavefront ring: you only hear them), so their echoes arrive later than the map implies. Same strata core, same contour-calibrated generator; a bot wins L6 in about a minute. Menu text now fits narrow phones.

- **NEW v1.7 Atmosphere:** in-world framing (Lattice Ops transmissions at the start of every campaign sector and Drift sector, deterministic sector designations like "QK-47 · MIRRORFALL"), an animated title backdrop of drifting echoes with node status readout, vignette + scanlines, and an ambient drone whose beating is the dissonance (two close tones; the gap widens as DISS rises; M mutes). Offline precache now lists every script.
- **NEW v1.8 Feedback loops (LOOP, key 7):** click a source emitter, then the emitter that re-emits it (the same one = self-echo). Any emitter can carry one feedback tap (`fb`: from, delay on its OWN clock, gain), so causal graphs may now have cycles. A new event-driven core engine (`core/strata/feedback.ts`, priority queue over root time) plays the echo cascade out through the real strata (flight times, clock drift, shear, Lawbook loss absorbs energy per hop). Echoes are first-class pulses: they have wavefronts, are heard by the probe, show in Spacetime with cause links and amplitude, and CUT on a cause removes its whole lineage. Q/W gain, E/R delay, Y removes the loop. Gain is capped at 4, echoes below 2% fade, above 64x saturate, cascade capped at 1500.
- **NEW v1.8 Stability audit (LOOPS line):** no simulation needed: for each strongly connected loop it solves rho(W(s)) = 1 for the exact growth rate s (per second) given round-trip time and gain, and reports damped (halves every N s), marginal (rings forever), runaway (doubles every N s) or ZENO (loop closes in ~0 s: unbounded echoes). Also flags energy created when any hop gain, or any emitter's fan-out, multiplies energy. Matches the cascade in tests. Timing is a snapshot at the scrub time (clocks drift).

- **NEW v1.9 Arithmetic reference (ZETA, key J):** select a free-running emitter and press ZETA: instead of a metronome it pulses at phase + scale x gamma_k, where gamma_k are the non-trivial Riemann zeta zeros (14.13, 21.02, 25.01, ...). The zeros are COMPUTED (`core/strata/zeta.ts`: Hardy Z via exact Euler-Maclaurin, sign changes, bisection; first zeros match the literature to 1e-7 and the count matches N(100)=29 and Riemann-von Mangoldt), never hard-coded. `-`/`=` change the scale. Relays and feedback work on a zeta source.
- **NEW v1.9 Blind calibration (FIX line):** the probe takes only the arrival times of >=5 consecutive pulses of a zeta beacon (no labels, no knowledge of the sender's clock) and recovers WHICH zeros it heard, the sender's clock rate, and the lag, by matching the irregular gap fingerprint. A metronome cannot do this (it is ambiguous in index and in clock-vs-period). Residual = deviation from arithmetic time: clock drift or a bent world shows as `bent`/`broken`. Verified in tests against the true rate.
- **Doctrine (Riemann):** Nov 2026 an Anthropic mathematician (Levent Alpoge) claimed a Claude-assisted, Lean-formalised proof of the Riemann Hypothesis; reports say it is not yet independently verified (some mathematicians call it very likely valid). NOTHING in the project depends on RH being true: the calibration uses numerically computed zeros, which are what they are either way. Treat the zeta zeros as the project's invariant reference ("tuning fork"). Do NOT present "zeta = source code of the vacuum" as fact: it is speculation. If used it is in-world lore, labelled as such. Honest real links to explore later: zeros as a spectrum (Hilbert-Polya), random-matrix statistics of the gaps, machine-checked audits (Lean-style) as the project's guardrails.

## Known limits
- Bulk worlds use straight chords (bent paths need flat space); off-plane wavefront sections are redrawn every 0.5 s and assume arrival grows with in-plane distance.
- Zeta beacons: 400 zeros tabulated (gamma up to ~811), so a slow scale runs out of pulses before t=240; calibration assumes constant flight time (a moving probe or drifting path shows as deviation, by design).
- Feedback echoes use straight chords (like relays), and feedback echoes cannot themselves be relayed or cut: cut the pulse that caused them.
- Feedback audit assumes amplitude-only coupling (no noise/fidelity); stability is a snapshot at the scrub time.
- Relay timing uses straight chords even under PATH·BENT.
- Cone classification uses straight chords (upper bound on arrival) even under PATH·BENT.
- Spacetime segments are straight (launch → arrival); bent paths show correct arrival but not the in-flight route.

## Next objectives
1. Calibration as a game and a tool: "tune the world" levels (restore a bent domain until the zeta FIX reads baseline); several probes triangulating a drifting clock.
2. Reality-edit scripting: save/restore named interventions (cuts, loops, beacons) inside the link.
3. Spectral instrument: the gap statistics of the zeros vs a world's own pulse spectrum (random-matrix style comparison).
4. Causal-chain levels where effects reach you before causes; Observatory challenges as playable puzzles ("stabilise this loop").
5. Movable slice plane, 4D (two hidden axes) and depth triangulation with several probes.
