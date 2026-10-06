import assert from "node:assert/strict";
import test from "node:test";
import { createProjectMonitor, type ProjectMonitorEvent } from "../server/project-monitor";

const counts = { total: 3, idle: 1, waiting: 2 };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("minute ticks and repeated start cannot overlap an active monitor cycle", async () => {
  const events: ProjectMonitorEvent[] = [];
  let intervalCallback: () => void = () => {};
  let schedules = 0;
  let cancellations = 0;
  let runs = 0;
  let finish: () => void = () => {};
  let now = 100;
  const monitor = createProjectMonitor({
    run: () => { runs++; return new Promise<void>(resolve => { finish = resolve; }); },
    getPoolCounts: () => counts,
    report: event => events.push(event),
    now: () => now,
    schedule: (callback, interval) => {
      assert.equal(interval, 60_000);
      schedules++;
      intervalCallback = callback;
      return {} as ReturnType<typeof setInterval>;
    },
    cancel: () => { cancellations++; },
  });
  monitor.start();
  monitor.start();
  assert.equal(schedules, 1);
  assert.equal(runs, 1);
  now = 60_200;
  intervalCallback();
  assert.equal(await monitor.runNow(), false);
  assert.equal(runs, 1);
  assert.deepEqual(events[0], { event: "cycle_skipped", durationMs: 60_100, pool: counts });
  finish();
  await tick();
  assert.equal(events[2].event, "cycle_completed");
  intervalCallback();
  assert.equal(runs, 2);
  finish();
  await tick();
  monitor.stop();
  monitor.stop();
  assert.equal(cancellations, 1);
});

test("a rejected cycle is recorded once, sanitized, and unlocks the next cycle", async () => {
  const events: ProjectMonitorEvent[] = [];
  let runs = 0;
  const monitor = createProjectMonitor({
    run: async () => {
      runs++;
      if (runs === 1) throw Object.assign(new Error("postgres://owner:secret@private/database"), { code: "08P01" });
    },
    getPoolCounts: () => counts,
    report: event => events.push(event),
  });
  assert.equal(await monitor.runNow(), true);
  assert.equal(runs, 1);
  assert.equal(events[0].event, "cycle_failed");
  assert.equal(events[0].code, "08P01");
  assert.doesNotMatch(JSON.stringify(events), /secret|private|postgres:\/\//);
  assert.equal(await monitor.runNow(), true);
  assert.equal(runs, 2);
  assert.equal(events[1].event, "cycle_completed");
});

test("telemetry failure and stop/start during a cycle never leave or release its lock early", async () => {
  let runs = 0;
  let finish: () => void = () => {};
  const monitor = createProjectMonitor({
    run: () => { runs++; return new Promise<void>(resolve => { finish = resolve; }); },
    getPoolCounts: () => { throw new Error("metrics unavailable"); },
    report: () => { throw new Error("logger unavailable"); },
    schedule: () => ({} as ReturnType<typeof setInterval>),
    cancel: () => {},
  });
  monitor.start();
  monitor.stop();
  monitor.start();
  assert.equal(runs, 1);
  finish();
  await tick();
  const next = monitor.runNow();
  assert.equal(runs, 2);
  finish();
  assert.equal(await next, true);
  monitor.stop();
});
