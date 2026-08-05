import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const installerPath = path.join(repoRoot, "script", "install-clippers-free-local-worker-launch-agent.sh");
const gitCommonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  cwd: repoRoot,
  encoding: "utf8",
}).stdout.trim();
const primaryCheckoutRoot = gitCommonDir.endsWith(`${path.sep}.git`) ? path.dirname(gitCommonDir) : repoRoot;

test("LaunchAgent resolves the checkout from the installer and does not freeze dynamic authorization", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-home-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-workspace-"));
  try {
    const result = spawnSync("zsh", [installerPath], {
      cwd: workspaceRoot,
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
    assert.match(plist, new RegExp(`<key>WorkingDirectory</key><string>${primaryCheckoutRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, new RegExp(`<string>${primaryCheckoutRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/script/clippers-free-local-worker\\.mjs</string>`));
    assert.match(plist, new RegExp(`CLIPPERS_WORKSPACE_ROOT</key><string>${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(
      plist,
      /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN|CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED|CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED|CLIPPERS_METRICOOL_BLOG_ID|CLIPPERS_TARGET_DAILY_CLIPS/,
    );
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
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /validated without installation/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("LaunchAgent refuses an invalid project root without replacing the existing plist", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-invalid-"));
  try {
    const invalidRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-invalid-project-"));
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_PROJECT_DIR: invalidRoot,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a valid Clippers checkout/);
    await assert.rejects(readFile(path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist")));
    await rm(invalidRoot, { recursive: true, force: true });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
