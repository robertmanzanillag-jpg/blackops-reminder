import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const installerPath = path.join(repoRoot, "script", "install-clippers-free-local-worker-launch-agent.sh");
const localtimeTarget = spawnSync("readlink", ["/etc/localtime"], { encoding: "utf8" }).stdout.trim();
const systemTimeZone = localtimeTarget.includes("/zoneinfo/") ? localtimeTarget.split("/zoneinfo/")[1] : "unknown";

test("production runtime guard rejects untracked entrypoints and files", async () => {
  const installer = await readFile(installerPath, "utf8");
  assert.match(installer, /status --porcelain --untracked-files=all/);
  assert.match(installer, /ls-files --error-unmatch/);
});

test("LaunchAgents bind configurable runtime/config roots and persist only explicit non-secret controls", async () => {
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
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
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
    assert.match(plist, new RegExp(`<key>WorkingDirectory</key><string>${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, new RegExp(`<string>${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/script/clippers-free-local-worker\\.mjs</string>`));
    assert.match(plist, new RegExp(`CLIPPERS_WORKSPACE_ROOT</key><string>${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, new RegExp(`CLIPPERS_CONFIG_ROOT</key><string>${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, /CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED<\/key><string>true<\/string>/);
    assert.match(plist, /CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED<\/key><string>true<\/string>/);
    assert.match(plist, /CLIPPERS_METRICOOL_BLOG_ID<\/key><string>6431687<\/string>/);
    assert.match(plist, /<key>TZ<\/key><string>America\/New_York<\/string>/);
    assert.match(plist, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>7<\/integer><key>Minute<\/key><integer>0<\/integer>/);
    assert.doesNotMatch(plist, /StartInterval/);
    assert.doesNotMatch(
      plist,
      /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/,
    );
    const watchdogPlist = await readFile(
      path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-daily-watchdog.plist"),
      "utf8",
    );
    assert.match(watchdogPlist, new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/script/clippers-daily-watchdog\\.mjs`));
    assert.match(watchdogPlist, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>10<\/integer><key>Minute<\/key><integer>0<\/integer>/);
    assert.match(watchdogPlist, /watchdog\.error\.log/);
    assert.doesNotMatch(watchdogPlist, /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("LaunchAgent does not install or start by default", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-default-"));
  try {
    const env = { ...process.env, HOME: home };
    env.CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME = "true";
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

test("LaunchAgent refuses a dirty development runtime unless the test-only override is explicit", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-dirty-runtime-"));
  try {
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runtime has unstaged changes|exactly at origin\/main/);
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
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a valid Clippers runtime checkout/);
    await assert.rejects(readFile(path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist")));
    await rm(invalidRoot, { recursive: true, force: true });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("LaunchAgent refuses a schedule time zone different from the macOS system time zone", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-timezone-"));
  try {
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_WATCHDOG_TIME_ZONE: systemTimeZone === "UTC" ? "America/New_York" : "UTC",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /StartCalendarInterval uses the macOS system time zone/);
    await assert.rejects(readFile(path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("installation verifies both launchd jobs and kickstarts only the worker", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-install-"));
  const fakeBin = path.join(home, "bin");
  const launchctlLog = path.join(home, "launchctl.log");
  try {
    await mkdir(fakeBin, { recursive: true });
    const fakeLaunchctl = path.join(fakeBin, "launchctl");
    await writeFile(fakeLaunchctl, `#!/bin/zsh\nprint -r -- "$*" >> "${launchctlLog}"\nexit 0\n`);
    await chmod(fakeLaunchctl, 0o700);
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "false",
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installed and verified/);
    const calls = await readFile(launchctlLog, "utf8");
    assert.match(calls, /bootstrap .*com\.blackops\.clippers-free-worker\.plist/);
    assert.match(calls, /bootstrap .*com\.blackops\.clippers-daily-watchdog\.plist/);
    assert.match(calls, /print .*com\.blackops\.clippers-free-worker/);
    assert.match(calls, /print .*com\.blackops\.clippers-daily-watchdog/);
    assert.match(calls, /kickstart -k .*com\.blackops\.clippers-free-worker/);
    assert.doesNotMatch(calls, /kickstart -k .*com\.blackops\.clippers-daily-watchdog/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
