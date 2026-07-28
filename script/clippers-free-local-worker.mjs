import { spawnSync } from "node:child_process";
import { mkdir, open, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CLIPPERS_ALLOWED_ENV_KEYS, loadClipperSelectedEnv } from "./clippers-selected-env.mjs";

const SAFE_ENV_KEYS = ["HOME", "LANG", "LC_ALL", "NODE_ENV", "PATH", "SHELL", "TMPDIR", "USER"];

function localOnlyEnv(source, overrides = {}) {
  const safe = Object.fromEntries(SAFE_ENV_KEYS
    .filter((key) => typeof source[key] === "string")
    .map((key) => [key, source[key]]));
  return { ...safe, ...overrides };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: 30 * 60_000,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    stdout: "",
    stderr: result.status === 0 ? "" : "Subprocess failed; output omitted to prevent credential leakage.",
  };
}

export async function runClipperFreeLocalWorker(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  loadClipperSelectedEnv(projectRoot);
  const workspaceRoot = path.resolve(
    options.workspaceRoot || process.env.CLIPPERS_WORKSPACE_ROOT || path.join(projectRoot, "clippers_workspace"),
  );
  const stateDir = path.join(workspaceRoot, "reports", "free-local-worker");
  const lockPath = path.join(stateDir, "worker.lock");
  const reportPath = path.join(stateDir, "latest.json");
  await mkdir(stateDir, { recursive: true });

  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      const lockAgeMs = Date.now() - (await stat(lockPath)).mtimeMs;
      if (lockAgeMs <= 2 * 60 * 60_000) return { status: "skipped", reason: "already_running", reportPath };
      await unlink(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
    if (!lock) throw error;
  }

  const startedAt = new Date().toISOString();
  const publishingAuthorized = process.env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED === "true";
  const publicMediaUploadAuthorized = process.env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED === "true";
  const metricoolEnv = publishingAuthorized ? {
    METRICOOL_USER_TOKEN: process.env.METRICOOL_USER_TOKEN,
    METRICOOL_USER_ID: process.env.METRICOOL_USER_ID,
    CLIPPERS_METRICOOL_BLOG_ID: process.env.CLIPPERS_METRICOOL_BLOG_ID,
    CLIPPERS_TIKTOK_ACCOUNT: process.env.CLIPPERS_TIKTOK_ACCOUNT || "streamersclipusa",
  } : {};
  const publicMediaEnv = publicMediaUploadAuthorized ? Object.fromEntries(
    [...CLIPPERS_ALLOWED_ENV_KEYS]
      .filter((key) => key.startsWith("GOOGLE_") || key.startsWith("YOUTUBE_") || key.startsWith("CLIPPERS_PUBLIC_MEDIA"))
      .map((key) => [key, process.env[key]])
      .filter(([, value]) => typeof value === "string" && value),
  ) : {};
  if (publicMediaUploadAuthorized && process.env.CLIPPERS_METRICOOL_BLOG_ID) {
    publicMediaEnv.CLIPPERS_METRICOOL_BLOG_ID = process.env.CLIPPERS_METRICOOL_BLOG_ID;
  }
  const env = localOnlyEnv(process.env, {
    CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
    CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: publishingAuthorized ? "true" : "false",
    CLIPPERS_TARGET_DAILY_CLIPS: process.env.CLIPPERS_TARGET_DAILY_CLIPS || "5",
    CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: publicMediaUploadAuthorized ? "true" : "false",
    CLIPPERS_PUBLIC_MEDIA_PROVIDER: process.env.CLIPPERS_PUBLIC_MEDIA_PROVIDER || "google_drive",
    ...Object.fromEntries(Object.entries(metricoolEnv).filter(([, value]) => typeof value === "string" && value)),
    ...publicMediaEnv,
  });
  const execute = options.run || run;
  try {
    const mediaUpload = publicMediaUploadAuthorized
      ? execute("npm", ["run", "clippers:upload-metricool-media"], { cwd: projectRoot, env })
      : {
          command: "Public media upload skipped",
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
        };
    const planning = mediaUpload.status === 0
      ? execute("npm", ["run", "clippers:streamer-growth-ceo"], { cwd: projectRoot, env })
      : {
          command: "CEO planning skipped",
          status: null,
          signal: null,
          stdout: "",
          stderr: "Public media upload failed",
        };
    const delivery = planning.status === 0 && publishingAuthorized
      ? execute("node", ["script/clippers-metricool-autopilot.mjs"], { cwd: projectRoot, env })
      : {
          command: "Metricool delivery skipped",
          status: publishingAuthorized ? null : 0,
          signal: null,
          stdout: "",
          stderr: planning.status === 0 ? "" : "CEO planning failed",
        };
    const executeCleanup = process.env.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE === "true";
    const cleanup = planning.status === 0 && (delivery.status === 0 || !publishingAuthorized)
      ? execute("node", ["script/clippers-cleanup-published-vyro-media.mjs", ...(executeCleanup ? ["--execute"] : [])], { cwd: projectRoot, env })
      : { command: "cleanup skipped", status: null, signal: null, stdout: "", stderr: "Planning or delivery failed" };
    const report = {
      status: planning.status === 0 && delivery.status === 0 && cleanup.status === 0 ? "completed" : "blocked",
      startedAt,
      finishedAt: new Date().toISOString(),
      paidAiUsed: false,
      paidAiCredentialsPassed: false,
      paidSpendAllowed: false,
      publishingSurface: "metricool",
      metricoolDeliveryEnabled: publishingAuthorized,
      publicMediaUploadEnabled: publicMediaUploadAuthorized,
      cleanupExecuteEnabled: executeCleanup,
      mediaUpload,
      planning,
      delivery,
      cleanup,
      publicationRule: "Only proof-backed TikTok posts with an exact public URL count as published or measured.",
      note: publishingAuthorized
        ? "Metricool delivery runs only for proof-backed, unique queue items with public HTTPS media and required campaign hashtags."
        : "Metricool delivery is disabled until explicit authorization is configured.",
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    return { ...report, reportPath };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runClipperFreeLocalWorker();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
}
