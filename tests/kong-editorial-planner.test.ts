import { test } from "node:test";
import assert from "node:assert/strict";
import { planDailyEditorial } from "../server/kong-editorial-planner";
import type { ProductionState } from "../server/kong-production-pipeline";
import type { OnlineFootage } from "../server/kong-online-sources";
const now = new Date("2026-10-28T14:00:00Z");
const rights = { evidenceUrl: "https://example.com/authorization", confirmedBy: "owner", expiresAt: "2026-12-01T00:00:00Z" };
const source = (i: number): OnlineFootage => ({ id: `source-${i}`, provider: "owner", sourceUrl: `https://example.com/${i}`, mediaUrl: `https://example.com/${i}.mp4`,
  author: "owner", discoveredAt: "2026-10-28T10:00:00Z", rightsEvidence: "recorded authorized footage", rightsExpiresAt: "2026-11-30T00:00:00Z",
  allowedMediaOrigins: ["https://example.com"], attribution: "owner", audioPolicy: "remove_source_audio", qaStatus: "pending", durationSeconds: 12 });
const state = (): ProductionState => ({ version: 1, sourceCursor: 0, candidates: Array.from({ length: 20 }, (_, i) => source(i)), jobs: [], assets: [], errors: [] });
const options = { now, musicRights: rights, footageRights: rights, authorizedForPublicDistribution: true };
test("empty rights never generate tasks or implied approval", () => {
  assert.equal(planDailyEditorial(state(), { now }).tasks.length, 0);
  assert.equal(planDailyEditorial(state(), { ...options, musicRights: undefined }).tasks.length, 0);
  assert.equal(planDailyEditorial(state(), { ...options, authorizedForPublicDistribution: false }).tasks.length, 0);
});
test("five bounded varied deterministic tasks contain site CTA and40% exploration", () => {
  const s = state(), before = JSON.stringify(s), plan = planDailyEditorial(s, options);
  assert.equal(plan.tasks.length, 5); assert.deepEqual(plan, planDailyEditorial(s, options)); assert.equal(JSON.stringify(s), before);
  assert.ok(new Set(plan.tasks.map(t => t.layout)).size >= 3);
  assert.ok(plan.experiments.filter(e => e.classification === "exploration").length / plan.tasks.length >= .4);
  assert.equal(new Set(plan.tasks.flatMap(t => t.sourceIds)).size, plan.tasks.flatMap(t => t.sourceIds).length);
  for (let i = 0; i < plan.tasks.length; i++) {
    assert.ok(plan.tasks[i].caption.includes("https://kongnightlife.com"));
    assert.ok(["pov", "humor", "dancefloor"].includes(plan.tasks[i].family));
    if (i) assert.notEqual(plan.tasks[i].layout, plan.tasks[i - 1].layout);
  }
});
test("reject stale/future/expired online candidates", () => {
  const s = state(); s.candidates = [source(0), source(1), source(2)];
  s.candidates[0].discoveredAt = "2026-10-01T00:00:00Z";
  s.candidates[1].discoveredAt = "2026-11-01T00:00:00Z";
  s.candidates[2].rightsExpiresAt = "2026-10-27T00:00:00Z";
  assert.equal(planDailyEditorial(s, options).tasks.length, 0);
});
test("persisted daily tasks prevent overfill; fourteen-day source/hook history prevents reuse", () => {
  const s = state(), plan = planDailyEditorial(s, options);
  s.jobs = plan.tasks.map(task => ({ id: task.id, task, sources: [], stage: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString() }));
  assert.equal(planDailyEditorial(s, options).tasks.length, 0);
  s.jobs.forEach(j => { j.createdAt = "2026-10-27T14:00:00Z"; });
  const next = planDailyEditorial(s, options);
  assert.equal(next.tasks.length, 5);
  assert.ok(next.tasks.every(t => !plan.tasks.some(p => p.hook === t.hook || p.sourceIds.some(id => t.sourceIds.includes(id)))));
});
test("unverified/stale events never become claims; concrete verified event preserves source/date", () => {
  const event = { title: "Friday Night Session", startsAt: "2026-10-30T23:00:00Z", sourceUrl: "https://kongnightlife.com/events/friday", verifiedAt: now.toISOString(), validUntil: "2026-10-31T00:00:00Z" };
  assert.ok(planDailyEditorial(state(), { ...options, events: [{ title: "Made up event" }] }).tasks.every(t => t.family !== "lineup"));
  assert.ok(planDailyEditorial(state(), { ...options, events: [{ ...event, verifiedAt: "2026-10-20T00:00:00Z" }] }).tasks.every(t => t.family !== "lineup"));
  const plan = planDailyEditorial(state(), { ...options, events: [event] });
  const factual = plan.tasks.find(t => t.family === "lineup")!;
  assert.equal(factual.hook, event.title); assert.equal(factual.facts!.sourceUrl, event.sourceUrl);
  assert.match(factual.caption, /Oct 30/); assert.equal(factual.reveal, undefined);
});
