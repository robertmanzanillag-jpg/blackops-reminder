import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("paused local editor performs no media work and removes stale temporary fragments", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "blackroom-editor-paused-"));
  const agentDir = path.join(project, "clippers_workspace/blackroom/agent");
  const staleDirectory = path.join(agentDir, "editor-tmp/stale-run");
  await mkdir(staleDirectory, { recursive: true });
  const sourceDir = path.join(project, "clippers_workspace/blackroom/sources");
  const renderDir = path.join(project, "clippers_workspace/blackroom/rendered");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  const orphan = path.join(renderDir, "blackroom-tiktok-orphan.mp4");
  const preserved = path.join(renderDir, "blackroom-tiktok-preserved.mp4");
  await writeFile(orphan, "orphan");
  await writeFile(preserved, "reserved");
  await writeFile(path.join(staleDirectory, "large-video.part"), "stale");
  await writeFile(path.join(agentDir, "queue.json"), JSON.stringify({ enabled: false }));
  await writeFile(path.join(agentDir, "worker-ledger.json"), JSON.stringify({
    version: 1,
    entries: [{ sourcePath: path.join(sourceDir, "missing-source.mp4"), renderPath: preserved }],
  }));
  const scriptPath = path.resolve("script/blackroom-deterministic-editor.ts");
  await execFileAsync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, BLACKROOM_PROJECT_DIR: project },
  });
  await assert.rejects(access(staleDirectory));
  await assert.rejects(access(orphan));
  await access(preserved);
  assert.deepEqual(await readdir(path.join(project, "clippers_workspace/blackroom/sources")), []);
  assert.deepEqual(await readdir(path.join(project, "clippers_workspace/blackroom/rendered")), ["blackroom-tiktok-preserved.mp4"]);
});
