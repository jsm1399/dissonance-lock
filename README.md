# Dissonance-Lock

Zero-dependency 2D physics sub-system: zones carry local "reality rules". Violating them builds **dissonance**; nearby bodies' hitboxes drift out of sync with their visuals (offset collisions) and forbidden actions **echo** back as delayed impulses until you **re-anchor**.

```ts
const w = new World({ width: 800, height: 600 });
w.defineAction('dash', 520);
const p = w.addBody({ pos: { x: 100, y: 100 } });
w.addZone({ id: 'quiet', center: { x: 400, y: 300 }, radius: 190, rules: { forbid: { dash: 0.35 } } });
w.addAnchor({ id: 'a', pos: { x: 400, y: 70 }, radius: 40, power: 0.5 });
w.act(p.id, 'dash', { x: 1, y: 0 }); // violation inside zone
w.step();                             // fixed 1/60s, deterministic
w.reanchor(p.id);                     // inside an anchor's radius
```

**Rule fields** (per zone): `forbid` (action → severity), `gravity` (stacks), `attract` (spring pull to center, stacks), `friction` (overrides world drag; smallest zone wins).

```ts
w.addZone({ id: 'ice', center, radius: 150, rules: { friction: 0.05, gravity: { x: 0, y: 140 } } });
w.addZone({ id: 'well', center, radius: 110, rules: { attract: 420, friction: 3.5, forbid: { dash: 0.3 } } });
```

`src/level.ts` holds the first puzzle (**Slipstream**); tests brute-force prove it is solvable and that the straight shot fails.

`npm i && npm run dev` · `npm test` · `npm run build` (outputs `dist/`, deploy to Cloudflare Pages).
