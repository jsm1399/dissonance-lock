# STATUS — Dissonance-Lock v1.4

## Live capabilities
- Game: tutorial, 5 campaign levels, Daily/Free Drift (seeded, calibrated), gamepad, PWA/offline.
- Strata core (N-dimensional): nested domains, per-domain clocks with drift, shear wells, causal march, Fermat bent paths, ledger.
- Lawbook (data): time, medium, dimension, loss, noise, Gauss; energy audit flags created/destroyed energy.
- Observatory: build worlds, scrub time, probe, heat landscape, share by link, path straight/bent.
- **NEW v1.3 Spacetime view (V):** probe-frame causal diagram. x = distance to probe, y = time. Each emission is a segment launch → arrival; red = heard out of order; white = causal horizon; dashed = lawful light line. Map stays live as an inset (drag the probe there).
- **NEW v1.3 Causal cone:** select an emitter (inset, SELECT tool) in Spacetime view. Its mid-window pulse is classified against every other pulse by the core CausalLedger: ▲ future (it could influence), ▼ past (could have influenced it), faded = independent (spacelike). Dotted lines are the ideal light cone; the markers are the true classification in the real medium.

- **NEW v1.4 Relays + causal intervention:** RELAY tool (key 6: click a source emitter, then empty space) makes an emitter that re-emits each pulse it hears after a delay on its own clock, so real cause→effect chains cross domains and clocks. CUT (K) removes the highlighted pulse from history and everything it would have caused; UNCUT (U) restores. Spacetime draws cause links, ✕ cut marks, and rings the pulses the origin actually caused (always a subset of its ledger-future). Relays and cuts travel in share links.

## Known limits
- Relay timing uses straight chords even under PATH·BENT.
- Cone classification uses straight chords (upper bound on arrival) even under PATH·BENT.
- Spacetime segments are straight (launch → arrival); bent paths show correct arrival but not the in-flight route.
- Observatory is a 2D slice; core supports N-D but no 3D slice viewer yet.

## Next objectives
1. Laws inside the game (bent Gauss/time laws as campaign levels).
2. Dimensional slicing: 3D strata with a movable slice plane.
3. Feedback: relay loops with damping/gain and a stability audit (can a world's causal graph run away?).
4. Reality-edit scripting: save/restore named interventions as part of the link.
