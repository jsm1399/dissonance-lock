# STATUS — Dissonance-Lock v1.6

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

## Known limits
- Bulk worlds use straight chords (bent paths need flat space); off-plane wavefront sections are redrawn every 0.5 s and assume arrival grows with in-plane distance.
- Relay timing uses straight chords even under PATH·BENT.
- Cone classification uses straight chords (upper bound on arrival) even under PATH·BENT.
- Spacetime segments are straight (launch → arrival); bent paths show correct arrival but not the in-flight route.

## Next objectives
1. Laws inside the game (bent Gauss/time laws as campaign levels).
2. Movable slice plane (tilt/offset) and 4D (two hidden axes) with a depth-triangulation instrument using several probes.
3. Feedback: relay loops with damping/gain and a stability audit (can a world's causal graph run away?).
4. Reality-edit scripting: save/restore named interventions as part of the link.
