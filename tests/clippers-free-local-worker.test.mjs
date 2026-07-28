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

test("passes only Metricool delivery credentials after explicit authorization", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-live-"));
  const previous = {
    authorization: process.env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED,
    token: process.env.METRICOOL_USER_TOKEN,
    userId: process.env.METRICOOL_USER_ID,
    blogId: process.env.CLIPPERS_METRICOOL_BLOG_ID,
    openai: process.env.OPENAI_API_KEY,
  };
  const calls = [];
  try {
    process.env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED = "true";
    process.env.METRICOOL_USER_TOKEN = "metricool-secret";
    process.env.METRICOOL_USER_ID = "3558197";
    process.env.CLIPPERS_METRICOOL_BLOG_ID = "6431687";
    process.env.OPENAI_API_KEY = "must-not-pass";
    const result = await runClipperFreeLocalWorker({
      projectRoot,
      run(command, args, options) {
        calls.push({ command, args, env: options.env });
        return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.metricoolDeliveryEnabled, true);
    assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
      ["npm", "run", "clippers:streamer-growth-ceo"],
      ["node", "script/clippers-metricool-autopilot.mjs"],
      ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
    ]);
    assert.equal(calls[1].env.METRICOOL_USER_TOKEN, "metricool-secret");
    assert.equal(calls[1].env.METRICOOL_USER_ID, "3558197");
    assert.equal(calls[1].env.CLIPPERS_METRICOOL_BLOG_ID, "6431687");
    assert.equal(calls[1].env.OPENAI_API_KEY, undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envName = {
        authorization: "CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED",
        token: "METRICOOL_USER_TOKEN",
        userId: "METRICOOL_USER_ID",
        blogId: "CLIPPERS_METRICOOL_BLOG_ID",
        openai: "OPENAI_API_KEY",
      }[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
  }
});
