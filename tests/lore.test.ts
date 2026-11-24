import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/game/levels.js";
import { BRIEFS, driftBrief, sectorName } from "../src/game/lore.js";

test("lore: every campaign level has a briefing that names its own sector", () => {
  for (const L of LEVELS) {
    const b = BRIEFS[L.id];
    assert.ok(b, `no briefing for ${L.tag}`);
    assert.ok(b.title.toUpperCase().includes(L.name.toUpperCase()), `${b.title} vs ${L.name}`);
    assert.ok(b.lines.length >= 1 && b.lines.every((l) => l.length > 10 && l.length < 140));
  }
});

test("lore: sector designations are deterministic, well-formed and varied", () => {
  assert.deepEqual(sectorName(777, 4), sectorName(777, 4));
  const seen = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    const s = sectorName(seed, 3);
    assert.match(s.code, /^[A-Z]{2}-\d{2}$/);
    assert.ok(s.name.length > 3);
    seen.add(`${s.code} ${s.name}`);
  }
  assert.ok(seen.size > 40, `only ${seen.size} distinct sectors in 60`);
  assert.notDeepEqual(sectorName(5, 1), sectorName(5, 2));
});

test("lore: drift briefings reflect what the level really contains", () => {
  assert.match(driftBrief(9, 6, 5, true).lines.join(" "), /hidden axis/i);
  assert.doesNotMatch(driftBrief(9, 3, 4, false).lines.join(" "), /hidden axis/i);
  assert.match(driftBrief(9, 1, 3, false).title, /^[A-Z]{2}-\d{2} · /);
  assert.ok(driftBrief(9, 2, 3, false).lines[0].includes("3 beacons"));
});
