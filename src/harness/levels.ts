import { createSlipstream } from './slipstream.ts';
import { createTidepool } from './tidepool.ts';
import type { Level } from './level.ts';

export const LEVELS: (() => Level)[] = [createSlipstream, createTidepool];
