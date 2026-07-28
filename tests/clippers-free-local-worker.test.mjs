import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runClipperFreeLocalWorker } from "../script/clippers-free-local-worker.mjs";

test("runs deterministic CEO and dry-run cleanup without paid AI", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.paidAiUsed, false);
  assert.equal(result.paidSpendAllowed, false);
  assert.deepEqual(calls.map((call) => [call.command, ...call.args]), [
    ["npm", "run", "clippers:streamer-growth-ceo"],
    ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
  ]);
  assert.equal(calls[0].env.CLIPPERS_TARGET_DAILY_CLIPS, "15");
  assert.equal(calls[0].env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED, "false");
  assert.equal(result.metricoolDeliveryEnabled, false);
  assert.equal(result.cleanupExecuteEnabled, false);
  const saved = JSON.parse(await readFile(result.reportPath, "utf8"));
  assert.equal(saved.paidAiUsed, false);
});

test("strips paid AI credentials from subprocesses", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-env-"));
  const previous = process.env.OPENAI_API_KEY;
  const previousGemini = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = "must-not-pass";
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "must-not-pass-either";
  let observedEnv;
  try {
    await runClipperFreeLocalWorker({
      projectRoot,
      run(_command, _args, options) {
        observedEnv = options.env;
        return { command: "ok", status: 0, signal: null, stdout: "", stderr: "" };
      },
    });
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    if (previousGemini === undefined) delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    else process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGemini;
  }
  assert.equal(observedEnv.OPENAI_API_KEY, undefined);
  assert.equal(observedEnv.AI_INTEGRATIONS_GEMINI_API_KEY, undefined);
});

test("real cleanup requires an explicit local-worker opt in", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-cleanup-"));
  const previous = process.env.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE;
  process.env.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE = "true";
  const calls = [];
  try {
    const result = await runClipperFreeLocalWorker({
      projectRoot,
      run(command, args) {
        calls.push([command, ...args]);
        return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.cleanupExecuteEnabled, true);
  } finally {
    if (previous === undefined) delete process.env.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE;
    else process.env.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE = previous;
  }
  assert.deepEqual(calls[1], ["node", "script/clippers-cleanup-published-vyro-media.mjs", "--execute"]);
});

test("does not run cleanup after CEO planning fails", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-fail-"));
  let calls = 0;
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run(command, args) {
      calls += 1;
      return { command: [command, ...args].join(" "), status: 1, signal: null, stdout: "", stderr: "blocked" };
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(calls, 1);
  assert.equal(result.cleanup.status, null);
});
