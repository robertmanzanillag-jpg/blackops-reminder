import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");

test("TikTok batch tracker completes with local source signature checks", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_metricool_review");
  assert.equal(output.rows, 10);
  assert.equal(output.readyToImport, 0);

  const tracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
  assert.equal(tracker.totals.readyToImport, 0);
  assert.ok(tracker.rows.every((row) => row.sourceProbe === "mp4_signature"));
  assert.ok(tracker.rows.every((row) => row.sourceVideoValid === true));
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("Scheduled rows are not counted as published")));
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("MP4/MOV signature checks")));
});

test("TikTok batch tracker blocks fake text files containing ftyp", async () => {
  const originalWorkbook = await readFile(workbookPath, "utf8");
  const fakeVideoPath = path.join(rootDir, "sources/memes/fake-ftyp-text-source.mp4");
  try {
    const workbook = JSON.parse(originalWorkbook);
    workbook.rows[0].sourcePath = fakeVideoPath;
    await writeFile(fakeVideoPath, `not a real video but it says ftyp here\n${"padding".repeat(400)}`);
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const tracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(tracker.status, "needs_evidence_fix");
    assert.equal(tracker.rows[0].sourceVideoValid, false);
    assert.equal(tracker.rows[0].sourceProbe, "mp4_signature");
    assert.equal(tracker.rows[0].blocker, "source_file_probe_failed");
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    await unlink(fakeVideoPath).catch(() => undefined);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15000,
    });
  }
});
