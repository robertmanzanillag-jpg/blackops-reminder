import assert from "node:assert/strict";
import test from "node:test";
import { getNextRunAt } from "../server/automation-schedule";

test("daily runs use the definition timezone across daylight saving changes", () => {
  const schedule = { kind: "daily_time", hour: 6, minute: 45 };
  assert.equal(getNextRunAt(schedule, "America/New_York", new Date("2026-10-05T08:00:00Z"))?.toISOString(), "2026-10-05T10:45:00.000Z");
  assert.equal(getNextRunAt(schedule, "America/New_York", new Date("2026-11-01T08:00:00Z"))?.toISOString(), "2026-11-01T11:45:00.000Z");
  assert.equal(getNextRunAt(schedule, "America/New_York", new Date("2026-10-05T10:45:00Z"))?.toISOString(), "2026-10-06T10:45:00.000Z");
});

test("DST missing minutes skip to the next real occurrence and folds choose the next occurrence", () => {
  assert.equal(getNextRunAt({ kind: "daily_time", hour: 2, minute: 30 }, "America/New_York", new Date("2026-03-08T06:00:00Z"))?.toISOString(), "2026-03-09T06:30:00.000Z");
  assert.equal(getNextRunAt({ kind: "daily_time", hour: 1, minute: 30 }, "America/New_York", new Date("2026-11-01T05:45:00Z"))?.toISOString(), "2026-11-01T06:30:00.000Z");
  assert.equal(getNextRunAt({ kind: "daily_time", hour: 1, minute: 30 }, "America/New_York", new Date("2026-11-01T05:45:00Z"), new Date("2026-11-01T05:30:00Z"))?.toISOString(), "2026-11-02T06:30:00.000Z");
});

test("weekly and interval schedules reject invalid fields and zones", () => {
  assert.equal(getNextRunAt({ kind: "weekly_time", dayOfWeek: 1, hour: 9 }, "Europe/London", new Date("2026-10-05T12:00:00Z"))?.toISOString(), "2026-10-12T08:00:00.000Z");
  for (const schedule of [{ kind: "daily_time", hour: 24 }, { kind: "weekly_time", dayOfWeek: 7 }, { kind: "interval", everyMinutes: -1 }, { kind: "manual" }]) assert.equal(getNextRunAt(schedule), null);
  assert.equal(getNextRunAt({ kind: "daily_time" }, "invalid/zone"), null);
});
