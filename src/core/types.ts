export interface Vec { x: number; y: number }

export interface Body {
  id: number;
  pos: Vec;          // real (visual) position
  vel: Vec;
  r: number;
  invMass: number;   // 0 = static
  tag: string;
  lag: number;       // desync in ticks; hitbox trails the visual by this much
}

export interface Rules {
  /** action name -> severity (0..1 dissonance added per violation) */
  forbid: Record<string, number>;
}

export interface ZoneDef {
  id: string;
  center: Vec;
  radius: number;
  rules: Rules;
  maxLag?: number;     // ticks of hitbox lag at dissonance=1 (default 24)
  echoDelay?: number;  // ticks until first echo (default 18)
  echoGain?: number;   // impulse multiplier per echo generation (default 0.6)
  echoCount?: number;  // echo generations per violation (default 2)
  ripple?: number;     // radius in which echoes push bodies (default = zone radius)
  decay?: number;      // natural dissonance decay per tick (default 0 = needs anchor)
}

export interface Zone extends Required<ZoneDef> { dissonance: number }

export interface Anchor { id: string; pos: Vec; radius: number; power: number }

export interface Echo {
  due: number; zoneId: string; origin: Vec; impulse: Vec; gain: number; left: number;
}

export type WorldEvent =
  | { type: 'violation'; tick: number; bodyId: number; zoneId: string; action: string }
  | { type: 'echo'; tick: number; zoneId: string; origin: Vec }
  | { type: 'anchor'; tick: number; bodyId: number; anchorId: string; zonesCleared: string[] };
