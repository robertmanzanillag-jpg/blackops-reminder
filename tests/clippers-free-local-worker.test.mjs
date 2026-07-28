import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runClipperFreeLocalWorker } from "../script/clippers-free-local-worker.mjs";

test("runs local CEO planning and cleanup without paid AI", async () => {
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
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["npm", "run", "clippers:streamer-growth-ceo"],
    ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
  ]);
  assert.equal(calls[0].env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED, "false");
  assert.equal(calls[0].env.CLIPPERS_TARGET_DAILY_CLIPS, "5");
  const saved = JSON.parse(await readFile(result.reportPath, "utf8"));
  assert.equal(saved.metricoolDeliveryEnabled, false);
});

test("strips paid AI credentials from subprocesses", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-env-"));
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "must-not-pass";
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
  }
  assert.equal(observedEnv.OPENAI_API_KEY, undefined);
  assert.equal(observedEnv.METRICOOL_USER_TOKEN, undefined);
  assert.equal(observedEnv.GOOGLE_API_KEY, undefined);
  assert.equal(observedEnv.PATH, process.env.PATH);
});
