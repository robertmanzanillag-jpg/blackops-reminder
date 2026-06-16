import assert from "node:assert/strict";
import test from "node:test";
import { getDateKeyFromClock, getZonedClock, shouldRunDailyScheduledJob, type SchedulerClock } from "../server/scheduler-time";

function clock(overrides: Partial<SchedulerClock> = {}): SchedulerClock {
  return {
    year: 2026,
    month: 6,
    day: 15,
    hour: 7,
    minute: 0,
    dayOfWeek: 1,
    ...overrides,
  };
}

test("builds stable date keys from scheduler clocks", () => {
  assert.equal(getDateKeyFromClock(clock()), "2026-6-15");
});

test("runs daily scheduled job only at the configured hour and minute", () => {
  assert.equal(shouldRunDailyScheduledJob(clock({ hour: 7, minute: 0 }), 7, 0, null), true);
  assert.equal(shouldRunDailyScheduledJob(clock({ hour: 6, minute: 59 }), 7, 0, null), false);
  assert.equal(shouldRunDailyScheduledJob(clock({ hour: 7, minute: 1 }), 7, 0, null), false);
});

test("prevents duplicate daily scheduled jobs for the same local date", () => {
  assert.equal(shouldRunDailyScheduledJob(clock(), 7, 0, "2026-6-15"), false);
  assert.equal(shouldRunDailyScheduledJob(clock({ day: 16 }), 7, 0, "2026-6-15"), true);
});

test("uses configured scheduler timezone when reading the local clock", () => {
  const zonedClock = getZonedClock(new Date("2026-06-15T11:00:00Z"), "America/New_York");

  assert.equal(zonedClock.year, 2026);
  assert.equal(zonedClock.month, 6);
  assert.equal(zonedClock.day, 15);
  assert.equal(zonedClock.hour, 7);
  assert.equal(zonedClock.minute, 0);
});
