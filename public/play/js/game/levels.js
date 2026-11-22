import { StrataTree } from "../core/strata/index.js";
const ROOT_SPEED = 6;
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
export const LEVELS = [
    {
        id: 1, name: "Quiet Shear",
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
        id: 2, name: "Fast Water",
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
        id: 3, name: "Deep Strata",
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
];
