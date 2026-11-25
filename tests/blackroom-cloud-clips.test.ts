import test from "node:test";
import assert from "node:assert/strict";
import { addDays, clipsOnDay, djsOnCooldown, pickDrops, planSetDays, type CloudState } from "../script/blackroom-cloud-clips";

const st = (dj: string, days: string[]): CloudState => ({ failures: {}, sets: { a: { name: dj, dj, processedAt: "", clips: days.map((day, i) => ({ postId: `p${i}`, publishAt: "", day, duration: 30, offset: 0 })) } } });

test("cloud clips never repeat a DJ within 15 days", () => {
  const s = st("Mau", ["2026-12-01"]);
  assert.equal(djsOnCooldown(s, "2026-12-10").has("mau"), true);
  assert.equal(djsOnCooldown(s, "2026-12-16").has("mau"), false);
  assert.equal(planSetDays(s, "MAU", "2026-12-05"), null);
  assert.deepEqual(planSetDays(s, "Other", "2026-12-05"), ["2026-12-05", "2026-12-21", "2027-01-06"]);
});

test("cloud clips spread one set over different days", () => {
  const days = planSetDays({ sets: {}, failures: {} }, "X", "2026-12-01")!;
  assert.equal(new Set(days).size, days.length);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(clipsOnDay(st("A", ["2026-12-01", "2026-12-01"]), "2026-12-01"), 2);
});

test("cloud clips pick distinct drops away from intro and end", () => {
  const samples = Array.from({ length: 1200 }, (_, t) => ({ timeSeconds: t, rmsDb: [300, 700, 1000].includes(t) ? -5 : -30 }));
  const drops = pickDrops(samples, 1200, 3);
  assert.equal(drops.length, 3);
  for (const d of drops) assert.ok(d > 60);
  const sorted = [...drops].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 180);
});
