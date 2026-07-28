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

test("honors an explicit workspace root outside the project directory", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-project-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-workspace-"));
  const previous = process.env.CLIPPERS_WORKSPACE_ROOT;
  const calls = [];
  try {
    process.env.CLIPPERS_WORKSPACE_ROOT = workspaceRoot;
    const result = await runClipperFreeLocalWorker({
      projectRoot,
      run(command, args, options) {
        calls.push({ command, args, env: options.env });
        return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.reportPath, path.join(workspaceRoot, "reports", "free-local-worker", "latest.json"));
    assert.equal(calls[0].env.CLIPPERS_WORKSPACE_ROOT, workspaceRoot);
  } finally {
    if (previous === undefined) delete process.env.CLIPPERS_WORKSPACE_ROOT;
    else process.env.CLIPPERS_WORKSPACE_ROOT = previous;
  }
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

test("uploads public campaign media before CEO planning when explicitly authorized", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-media-"));
  const previous = {
    upload: process.env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED,
    provider: process.env.CLIPPERS_PUBLIC_MEDIA_PROVIDER,
    googleClient: process.env.GOOGLE_CLIENT_ID,
    googleSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRefresh: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    blogId: process.env.CLIPPERS_METRICOOL_BLOG_ID,
  };
  const calls = [];
  try {
    process.env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED = "true";
    process.env.CLIPPERS_PUBLIC_MEDIA_PROVIDER = "google_drive";
    process.env.GOOGLE_CLIENT_ID = "drive-client";
    process.env.GOOGLE_CLIENT_SECRET = "drive-secret";
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN = "drive-refresh";
    process.env.CLIPPERS_METRICOOL_BLOG_ID = "6431687";
    const result = await runClipperFreeLocalWorker({
      projectRoot,
      run(command, args, options) {
        calls.push({ command, args, env: options.env });
        return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.publicMediaUploadEnabled, true);
    assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
      ["npm", "run", "clippers:upload-metricool-media"],
      ["npm", "run", "clippers:streamer-growth-ceo"],
      ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
    ]);
    assert.equal(calls[0].env.GOOGLE_CLIENT_ID, "drive-client");
    assert.equal(calls[0].env.GOOGLE_DRIVE_REFRESH_TOKEN, "drive-refresh");
    assert.equal(calls[0].env.CLIPPERS_METRICOOL_BLOG_ID, "6431687");
    assert.equal(calls[0].env.OPENAI_API_KEY, undefined);
  } finally {
    const envNames = {
      upload: "CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED",
      provider: "CLIPPERS_PUBLIC_MEDIA_PROVIDER",
      googleClient: "GOOGLE_CLIENT_ID",
      googleSecret: "GOOGLE_CLIENT_SECRET",
      googleRefresh: "GOOGLE_DRIVE_REFRESH_TOKEN",
      blogId: "CLIPPERS_METRICOOL_BLOG_ID",
    };
    for (const [key, value] of Object.entries(previous)) {
      const envName = envNames[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
  }
});
