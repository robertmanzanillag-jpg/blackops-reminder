import assert from "node:assert/strict";
import test from "node:test";
import { WorkerLoop } from "../server/ai-media-studio/workers/worker-loop";
import { parseWorkerCliArgs, runWorkerCli } from "../script/ai-media-studio-worker";

test("runOnce bounds concurrency and reconciliation has an independent cadence", async () => {
  let now = 1_000;
  let active = 0;
  let maxActive = 0;
  let releases: Array<() => void> = [];
  let reconciliations = 0;
  const loop = new WorkerLoop({
    concurrency: 3, idleBackoffMs: 5, reconciliationIntervalMs: 100, now: () => now,
    reconcile: async () => { reconciliations += 1; },
    runOne: async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => { releases.push(resolve); });
      active -= 1;
      return "worked";
    },
  });
  const first = loop.runOnce();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(active, 3);
  releases.splice(0).forEach((release) => release());
  assert.deepEqual(await first, { worked: 3, idle: 0, reconciled: true });
  assert.equal(maxActive, 3);
  now += 99;
  const second = loop.runOnce();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releases.splice(0).forEach((release) => release());
  assert.equal((await second).reconciled, false);
  now += 1;
  const third = loop.runOnce();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releases.splice(0).forEach((release) => release());
  assert.equal((await third).reconciled, true);
  assert.equal(reconciliations, 2);
});

test("loop applies idle backoff and abort drains already-started work", async () => {
  const controller = new AbortController();
  let started = 0;
  let finished = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const loop = new WorkerLoop({
    concurrency: 2, idleBackoffMs: 50, reconciliationIntervalMs: 1_000,
    runOne: async () => { started += 1; await gate; finished += 1; return "worked"; },
    sleep: async () => undefined,
  });
  const running = loop.run(controller.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(started, 2);
  controller.abort();
  release();
  await running;
  assert.equal(finished, 2);
  assert.equal(started, 2, "abort prevents scheduling another batch");
});

test("idle loop waits before polling again", async () => {
  const controller = new AbortController();
  let calls = 0;
  const sleeps: number[] = [];
  const loop = new WorkerLoop({
    concurrency: 1, idleBackoffMs: 25, reconciliationIntervalMs: 1_000,
    runOne: async () => { calls += 1; return "idle"; },
    sleep: async (ms) => { sleeps.push(ms); controller.abort(); },
  });
  await loop.run(controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [25]);
});

test("CLI is dry and run-once by default; loops need config and an abort signal", async () => {
  assert.deepEqual(parseWorkerCliArgs([]), { mode: "run-once", dryRun: true, configPath: undefined });
  assert.throws(() => parseWorkerCliArgs(["--loop"]), /explicit --config/);
  const output: string[] = [];
  let created = 0;
  await runWorkerCli([], {
    write: (line) => output.push(line),
    createLoop: () => { created += 1; throw new Error("dry-run must not compose a worker"); },
  });
  assert.equal(created, 0);
  assert.match(output[0] ?? "", /\"dryRun\":true/);
  await assert.rejects(runWorkerCli(["--loop", "--config", "worker.json", "--live"], {
    createLoop: () => new WorkerLoop({ concurrency: 1, idleBackoffMs: 1, reconciliationIntervalMs: 1, runOne: async () => "idle" }),
    write: () => undefined,
  }), /AbortSignal/);
});
