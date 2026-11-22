# Dissonance-Lock

Reality-rule violations in a local domain build **dissonance**: perceived frames lag (offset collisions), forbidden actions **echo** back as delayed ripples, until you **re-anchor**. The core is physics-, dimension- and scale-agnostic; see `ARCHITECTURE.md`.

```ts
import { ShearField, Vec2Space, ball } from './src/core/index.ts';
const f = new ShearField({ space: Vec2Space });
const e = { id: 1, pos: { x: 0, y: 0 }, lag: 0 };
f.track(e);
f.addDomain({ id: 'quiet', region: ball(Vec2Space, { x: 0, y: 0 }, 100), forbid: { dash: 0.3 } });
f.violate(1, 'dash', { x: 1, y: 0 });     // host reports an act
const hits = f.begin();                    // echoes + lags; host applies `hits`
/* ...host physics; contacts use f.perceived(id)... */
f.commit();
```

2D harness (`src/harness/`): `World` adds circle physics + optional `fields` (gravity/attract/friction) per zone; `createSlipstream()` is the demo puzzle.

`npm i && npm run dev` · `npm test` · `npm run build` (deploy `dist/` to Cloudflare Pages)
