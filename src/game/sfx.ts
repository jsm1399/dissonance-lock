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

export const sfx = {
  get muted(): boolean { return muted; },
  toggle(): boolean { muted = !muted; return muted; },
  unlock(): void { ac(); },
  heard(hue: number): void { tone(260 + (hue / 360) * 520, 0.16, "sine", 0.05); },
  anchor(): void { tone(900, 0.45, "triangle", 0.09, 180); },
  win(): void { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, "sine", 0.08), i * 120)); },
  lose(): void { tone(220, 0.7, "sawtooth", 0.07, 55); },
};
