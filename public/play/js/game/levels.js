import { StrataTree } from "../core/strata/index.js";
/** Beacon site in its domain's coordinates (3D in bulk levels, 4D in bulk2 levels). */
export const beaconPos = (L, b) => (L.bulk2 ? [b.pos[0], b.pos[1], b.z ?? 0, b.w ?? 0] : L.bulk ? [b.pos[0], b.pos[1], b.z ?? 0] : b.pos);
/** The player's plane, lifted into the level's dimension. */
export const planeSite = (L, p) => (L.bulk2 ? [p[0], p[1], 0, 0] : L.bulk ? [p[0], p[1], 0] : p);
/** True when a beacon sits off the player's plane along any hidden axis. */
export const isHidden = (b) => !!(b.z || b.w);
export const ROOT_SPEED = 6;
function level1() {
    const t = new StrataTree(2, ROOT_SPEED);
    t.add({
        id: "well", parent: "root", origin: [62, 48], scale: 1, extent: 18, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 18),
    });
    return t;
}
function level2() {
    const t = new StrataTree(2, ROOT_SPEED);
    t.add({ id: "fast", parent: "root", origin: [34, 56], scale: 1, extent: 20, echoSpeed: ROOT_SPEED, rate: 3 });
    t.add({
        id: "well", parent: "root", origin: [74, 30], scale: 1, extent: 14, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.25 + 0.75 * Math.min(1, Math.hypot(p[0], p[1]) / 14),
    });
    t.setRate("fast", 30, 2);
    return t;
}
function level3() {
    const t = new StrataTree(2, ROOT_SPEED);
    t.add({ id: "fast", parent: "root", origin: [30, 58], scale: 1, extent: 20, echoSpeed: ROOT_SPEED, rate: 3 });
    t.add({
        id: "well", parent: "root", origin: [72, 34], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 15),
    });
    t.add({ id: "micro", parent: "fast", origin: [6, -2], scale: 10, extent: 5, echoSpeed: ROOT_SPEED * 10, rate: 2 });
    t.setRate("fast", 25, 1);
    t.setRate("fast", 55, 4);
    return t;
}
function level4() {
    const t = new StrataTree(2, ROOT_SPEED);
    t.add({
        id: "wellA", parent: "root", origin: [28, 30], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 15),
    });
    t.add({
        id: "wellB", parent: "root", origin: [72, 72], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(p[0], p[1]) / 15),
    });
    t.add({ id: "fast", parent: "root", origin: [72, 28], scale: 1, extent: 17, echoSpeed: ROOT_SPEED, rate: 2.5 });
    t.setRate("fast", 20, 3.5);
    t.setRate("fast", 45, 1.5);
    return t;
}
function level5() {
    const t = new StrataTree(2, ROOT_SPEED);
    t.add({
        id: "horizon", parent: "root", origin: [50, 50], scale: 1, extent: 24, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.12 + 0.88 * Math.min(1, Math.hypot(p[0], p[1]) / 24),
    });
    t.add({ id: "pocket", parent: "horizon", origin: [12, 0], scale: 4, extent: 5, echoSpeed: ROOT_SPEED * 4, rate: 5 });
    t.add({ id: "fast", parent: "root", origin: [16, 78], scale: 1, extent: 14, echoSpeed: ROOT_SPEED, rate: 3 });
    t.setRate("fast", 30, 1);
    t.setRate("fast", 60, 4);
    t.setRate("pocket", 40, 2);
    return t;
}
function level6() {
    const t = new StrataTree(3, ROOT_SPEED);
    t.add({ id: "fast", parent: "root", origin: [30, 60, 0], scale: 1, extent: 18, echoSpeed: ROOT_SPEED, rate: 3 });
    t.add({
        id: "well", parent: "root", origin: [72, 36, 0], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(...p) / 15),
    });
    t.setRate("fast", 30, 1.5);
    return t;
}
function level7() {
    const t = new StrataTree(4, ROOT_SPEED);
    t.add({ id: "fast", parent: "root", origin: [28, 62, 0, 0], scale: 1, extent: 17, echoSpeed: ROOT_SPEED, rate: 3 });
    t.add({
        id: "well", parent: "root", origin: [72, 34, 0, 0], scale: 1, extent: 15, echoSpeed: ROOT_SPEED,
        shear: (p) => 0.2 + 0.8 * Math.min(1, Math.hypot(...p) / 15),
    });
    t.setRate("fast", 28, 1.5);
    t.setRate("fast", 58, 4);
    return t;
}
/** Interactive tutorial world: open medium, three beacons, forgiving lock. */
export const TUTORIAL = {
    id: 0, tag: "T", name: "Calibration",
    blurb: "Learn to read the echoes. Two minutes.",
    build: () => new StrataTree(2, 9),
    beacons: [
        { name: "A", domain: "root", pos: [14, 16], period: 2.2, phase: 0, hue: 190 },
        { name: "B", domain: "root", pos: [86, 18], period: 2.7, phase: 0.5, hue: 40 },
        { name: "C", domain: "root", pos: [50, 88], period: 3.2, phase: 1.0, hue: 300 },
    ],
    start: [50, 50],
    gain: 22, decay: 6, spreadCap: 4.7, lockRate: 4, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
};
export const LEVELS = [
    {
        id: 1, tag: "L1", name: "Quiet Shear",
        blurb: "One time-well bends the echoes. Learn the band.",
        build: level1,
        beacons: [
            { name: "A", domain: "root", pos: [14, 16], period: 3.1, phase: 0, hue: 190 },
            { name: "B", domain: "root", pos: [86, 18], period: 3.7, phase: 0.8, hue: 40 },
            { name: "C", domain: "root", pos: [50, 88], period: 4.3, phase: 1.5, hue: 300 },
        ],
        start: [50, 50],
        gain: 22, decay: 6, spreadCap: 6, lockRate: 2.4, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
    {
        id: 2, tag: "L2", name: "Fast Water",
        blurb: "A fast clock-domain outruns the rest. Its rate drifts.",
        build: level2,
        beacons: [
            { name: "A", domain: "root", pos: [12, 12], period: 3.4, phase: 0, hue: 190 },
            { name: "B", domain: "fast", pos: [-6, 8], period: 9, phase: 2, hue: 40 },
            { name: "C", domain: "well", pos: [6, -4], period: 4.1, phase: 0.5, hue: 300 },
            { name: "D", domain: "root", pos: [88, 88], period: 5.2, phase: 1.2, hue: 130 },
        ],
        start: [50, 50],
        gain: 20, decay: 6, spreadCap: 10, lockRate: 2.6, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
    {
        id: 3, tag: "L3", name: "Deep Strata",
        blurb: "Nested scales, drifting clocks. Hold the lock.",
        build: level3,
        beacons: [
            { name: "A", domain: "root", pos: [10, 10], period: 3.3, phase: 0, hue: 190 },
            { name: "B", domain: "fast", pos: [-8, 6], period: 9, phase: 1, hue: 40 },
            { name: "C", domain: "well", pos: [5, -5], period: 4.0, phase: 0.6, hue: 300 },
            { name: "D", domain: "micro", pos: [0, 0], period: 26, phase: 5, hue: 130 },
            { name: "E", domain: "root", pos: [90, 90], period: 5.0, phase: 2.0, hue: 0 },
        ],
        start: [50, 50],
        gain: 20, decay: 6, spreadCap: 12, lockRate: 2.8, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
    {
        id: 4, tag: "L4", name: "Twin Wells",
        blurb: "Two time-sinks and a drifting fast lane. Echoes tangle.",
        build: level4,
        beacons: [
            { name: "A", domain: "root", pos: [10, 90], period: 3.4, phase: 0, hue: 190 },
            { name: "B", domain: "wellA", pos: [4, 4], period: 4.2, phase: 0.7, hue: 40 },
            { name: "C", domain: "fast", pos: [-5, 6], period: 9, phase: 1.5, hue: 300 },
            { name: "D", domain: "wellB", pos: [-5, -3], period: 4.6, phase: 2.0, hue: 130 },
            { name: "E", domain: "root", pos: [92, 10], period: 5.4, phase: 0.4, hue: 0 },
        ],
        start: [50, 50],
        gain: 22, decay: 6, spreadCap: 7.2, lockRate: 2.8, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
    {
        id: 5, tag: "L5", name: "Event Horizon",
        blurb: "A deep well, a fast pocket. Nothing arrives on time.",
        build: level5,
        beacons: [
            { name: "A", domain: "root", pos: [90, 10], period: 3.2, phase: 0, hue: 190 },
            { name: "B", domain: "horizon", pos: [-10, 8], period: 4.0, phase: 0.8, hue: 40 },
            { name: "C", domain: "pocket", pos: [0, 0], period: 40, phase: 6, hue: 300 },
            { name: "D", domain: "fast", pos: [4, -4], period: 9, phase: 2, hue: 130 },
            { name: "E", domain: "root", pos: [88, 90], period: 4.8, phase: 1.1, hue: 0 },
            { name: "F", domain: "root", pos: [8, 8], period: 5.6, phase: 2.2, hue: 260 },
        ],
        start: [50, 50],
        gain: 24, decay: 6, spreadCap: 16.8, lockRate: 3.0, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
    {
        id: 6, tag: "L6", name: "Hidden Axis",
        blurb: "Beacons hover off the plane. Echoes arrive late.",
        build: level6, bulk: true,
        beacons: [
            { name: "A", domain: "root", pos: [10, 10], period: 3.3, phase: 0, hue: 190 },
            { name: "B", domain: "root", pos: [88, 14], period: 3.9, phase: 0.7, hue: 40, z: 22 },
            { name: "C", domain: "fast", pos: [-6, 6], period: 9, phase: 1, hue: 300 },
            { name: "D", domain: "root", pos: [50, 92], period: 4.6, phase: 1.6, hue: 130, z: 30 },
            { name: "E", domain: "well", pos: [4, -4], period: 4.2, phase: 0.4, hue: 0, z: 8 },
            { name: "F", domain: "root", pos: [92, 88], period: 5.1, phase: 2.2, hue: 260 },
        ],
        start: [50, 50],
        gain: 22, decay: 6, spreadCap: 11.6, lockRate: 2.8, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
    {
        id: 7, tag: "L7", name: "Second Axis",
        blurb: "Two hidden axes. Late does not say which way.",
        build: level7, bulk: true, bulk2: true,
        beacons: [
            { name: "A", domain: "root", pos: [10, 12], period: 3.3, phase: 0, hue: 190 },
            { name: "B", domain: "root", pos: [90, 12], period: 3.9, phase: 0.7, hue: 40, z: 20 },
            { name: "C", domain: "fast", pos: [-6, 6], period: 9, phase: 1, hue: 300 },
            { name: "D", domain: "root", pos: [50, 92], period: 4.6, phase: 1.6, hue: 130, w: 24 },
            { name: "E", domain: "well", pos: [4, -4], period: 4.2, phase: 0.4, hue: 0, z: 5, w: -5 },
            { name: "F", domain: "root", pos: [90, 88], period: 5.1, phase: 2.2, hue: 260, z: 14, w: 14 },
        ],
        start: [50, 50],
        gain: 22, decay: 6, spreadCap: 11.3, lockRate: 2.8, bandLo: 20, bandHi: 75, window: 12, margin: 0.25,
    },
];
