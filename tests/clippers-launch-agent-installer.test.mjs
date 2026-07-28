import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("LaunchAgent persists only explicit non-secret Clippers controls", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-home-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-workspace-"));
  try {
    const result = spawnSync("zsh", ["script/install-clippers-free-local-worker-launch-agent.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
        CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
        CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa",
        CLIPPERS_TARGET_DAILY_CLIPS: "5",
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE: "false",
        METRICOOL_USER_TOKEN: "must-not-persist",
        GOOGLE_DRIVE_REFRESH_TOKEN: "must-not-persist",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const plist = await readFile(
      path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist"),
      "utf8",
    );
    assert.match(plist, /CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED<\/key><string>true/);
    assert.match(plist, new RegExp(`CLIPPERS_WORKSPACE_ROOT</key><string>${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, /CLIPPERS_METRICOOL_BLOG_ID<\/key><string>6431687/);
    assert.match(plist, /CLIPPERS_TIKTOK_ACCOUNT<\/key><string>streamersclipusa/);
    assert.match(plist, /CLIPPERS_TARGET_DAILY_CLIPS<\/key><string>5/);
    assert.doesNotMatch(plist, /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("LaunchAgent does not install or start by default", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-default-"));
  try {
    const env = { ...process.env, HOME: home };
    delete env.CLIPPERS_LAUNCH_AGENT_DRY_RUN;
    const result = spawnSync("zsh", ["script/install-clippers-free-local-worker-launch-agent.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /validated without installation/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("LaunchAgent refuses live publishing without a Metricool blog id", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-invalid-"));
  try {
    for (const blogId of ["", "0"]) {
      const result = spawnSync("zsh", ["script/install-clippers-free-local-worker-launch-agent.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
          CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
          CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "false",
          CLIPPERS_METRICOOL_BLOG_ID: blogId,
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /CLIPPERS_METRICOOL_BLOG_ID is required/);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
