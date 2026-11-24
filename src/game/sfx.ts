/** Tiny WebAudio sfx. Created lazily on first user gesture; fully optional. */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let drone: { a: OscillatorNode; b: OscillatorNode; g: GainNode } | null = null;

function stopDrone(): void {
  if (!drone) return;
  const d = drone;
  drone = null;
  try { d.g.gain.setTargetAtTime(0.0001, d.g.context.currentTime, 0.15); d.a.stop(d.g.context.currentTime + 0.8); d.b.stop(d.g.context.currentTime + 0.8); } catch { /* already stopped */ }
}

export const sfx = {
  /** Ambient bed: two close tones whose beating IS the dissonance. level 0..1, or < 0 for silence. */
  drone(level: number): void {
    if (level < 0 || muted) { stopDrone(); return; }
    const a = ac();
    if (!a) return;
    if (!drone) {
      const g = a.createGain(), lp = a.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 700;
      g.gain.value = 0.0001;
      const oa = a.createOscillator(), ob = a.createOscillator();
      oa.type = "triangle"; ob.type = "triangle";
      oa.frequency.value = 55; ob.frequency.value = 55.7;
      oa.connect(g); ob.connect(g); g.connect(lp).connect(a.destination);
      oa.start(); ob.start();
      drone = { a: oa, b: ob, g };
    }
    const t = a.currentTime, d = Math.min(1, Math.max(0, level));
    drone.b.frequency.setTargetAtTime(55 * (1.012 + 0.05 * d), t, 0.2);
    drone.g.gain.setTargetAtTime(0.02 + 0.05 * d, t, 0.3);
  },
  get muted(): boolean { return muted; },
  toggle(): boolean { muted = !muted; return muted; },
  unlock(): void { ac(); },
  heard(hue: number): void { tone(260 + (hue / 360) * 520, 0.16, "sine", 0.05); },
  anchor(): void { tone(900, 0.45, "triangle", 0.09, 180); },
  win(): void { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, "sine", 0.08), i * 120)); },
  lose(): void { tone(220, 0.7, "sawtooth", 0.07, 55); },
};
