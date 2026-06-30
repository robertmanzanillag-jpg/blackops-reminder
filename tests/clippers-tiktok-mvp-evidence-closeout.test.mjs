import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const tmpDir = path.join(rootDir, "tmp");
const accountCsvPath = path.join(tmpDir, "tiktok-mvp-account-proof-test.csv");
const bridgeCsvPath = path.join(tmpDir, "tiktok-mvp-bridge-proof-test.csv");
const sportsEvidencePath = path.join(rootDir, "account-evidence/sports-daily-tiktok.json");
const memesEvidencePath = path.join(rootDir, "account-evidence/meme-radar-tiktok.json");
const metricoolQueuePath = path.join(rootDir, "scheduled/metricool-execution-queue.json");

const accountHeader = "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes";
const bridgeHeader = "account_id,platform,metricool_brand_name,metricool_blog_id,profile_url,proof,notes";

function runCloseout(args = []) {
  return spawnSync(process.execPath, [
    "script/clippers-tiktok-mvp-evidence-closeout.mjs",
    "--account-csv",
    accountCsvPath,
    "--bridge-csv",
    bridgeCsvPath,
    ...args,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function cleanAccountCsv() {
  return [
    accountHeader,
    "account,sports-daily,tiktok,verified,,,,,https://www.tiktok.com/signup,,https://drive.google.com/file/d/sports-daily-tiktok-proof/view,Sports Daily TikTok account ownership and 2FA security proof verified by Robert without secrets",
    "account,meme-radar,tiktok,verified,,,,,https://www.tiktok.com/signup,,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,Meme Radar TikTok account ownership and 2FA security proof verified by Robert without secrets",
  ].join("\n") + "\n";
}

function cleanBridgeCsv() {
  return [
    bridgeHeader,
    "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@sportsdaily,https://app.metricool.com/planner/sports-daily-tiktok-proof,SPORT TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
    "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://app.metricool.com/planner/meme-radar-tiktok-proof,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
  ].join("\n") + "\n";
}

test("TikTok MVP evidence closeout rejects placeholders and does not apply", async () => {
  const previousSports = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const previousMemes = await readFile(memesEvidencePath, "utf8").catch(() => null);
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(accountCsvPath, [
      accountHeader,
      "account,sports-daily,tiktok,verified,,,,,https://drive.google.com/file/d/sports-daily-tiktok-proof/view,https://www.tiktok.com/signup,<paste proof>",
      "account,meme-radar,tiktok,submitted,,,,,https://www.tiktok.com/signup,,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,ok",
    ].join("\n") + "\n");
    await writeFile(bridgeCsvPath, [
      bridgeHeader,
      "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@sportsdaily,<paste real public Metricool proof URL>,Replace this placeholder later",
      "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://example.com/not-real,Metricool proof should not use example domains",
    ].join("\n") + "\n");

    const result = runCloseout();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-evidence-closeout.json"), "utf8"));
    assert.equal(report.mode, "preview");
    assert.equal(report.totals.ready, 0);
    assert.ok(JSON.stringify(report).includes("placeholder") || JSON.stringify(report).includes("Metricool HTTPS"));
  } finally {
    if (previousSports === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, previousSports);
    if (previousMemes === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, previousMemes);
  }
});

test("TikTok MVP evidence closeout applies clean non-secret proof rows", async () => {
  const previousSports = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const previousMemes = await readFile(memesEvidencePath, "utf8").catch(() => null);
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(accountCsvPath, cleanAccountCsv());
    await writeFile(bridgeCsvPath, cleanBridgeCsv());

    const preview = runCloseout();
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.equal(JSON.parse(preview.stdout).status, "ready_to_apply");

    const apply = runCloseout(["--apply"]);
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const output = JSON.parse(apply.stdout);
    assert.equal(output.status, "applied");
    assert.equal(output.ready, 2);
    assert.equal(output.applied, 2);
    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-evidence-closeout.json"), "utf8"));
    assert.equal(report.readinessRefresh.stdout.activeMvpReadyLanes, 2);

    const sportsEvidence = JSON.parse(await readFile(sportsEvidencePath, "utf8"));
    const memesEvidence = JSON.parse(await readFile(memesEvidencePath, "utf8"));
    assert.equal(sportsEvidence.status, "verified");
    assert.equal(memesEvidence.status, "verified");
    assert.match(sportsEvidence.metricoolProofUrl, /metricool\.com/);
    assert.match(memesEvidence.profileUrl, /tiktok\.com\/@memeradar/);
    assert.equal(/password=|access_token=|refresh_token=|client_secret=|cookie=|bearer\s+[a-z0-9._-]+/i.test(JSON.stringify(sportsEvidence)), false);
  } finally {
    if (previousSports === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, previousSports);
    if (previousMemes === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, previousMemes);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP evidence closeout rejects mismatched TikTok handles", async () => {
  await mkdir(tmpDir, { recursive: true });
  await writeFile(accountCsvPath, cleanAccountCsv());
  await writeFile(bridgeCsvPath, [
    bridgeHeader,
    "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@someoneelse,https://app.metricool.com/planner/sports-daily-tiktok-proof,SPORT TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
    "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://app.metricool.com/planner/meme-radar-tiktok-proof,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
  ].join("\n") + "\n");

  const result = runCloseout();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_invalid_evidence");

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-evidence-closeout.json"), "utf8"));
  assert.equal(report.totals.ready, 1);
  assert.ok(JSON.stringify(report).includes("profile_url must match @sportsdaily"));
});

test("TikTok MVP evidence closeout rejects credential-bearing proof URLs", async () => {
  await mkdir(tmpDir, { recursive: true });
  await writeFile(accountCsvPath, [
    accountHeader,
    "account,sports-daily,tiktok,verified,,,,,https://www.tiktok.com/signup,,https://viewer:secret@drive.google.com/file/d/sports-daily-tiktok-proof/view,Sports Daily TikTok account ownership and 2FA security proof verified by Robert",
    "account,meme-radar,tiktok,verified,,,,,https://www.tiktok.com/signup,,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,Meme Radar TikTok account ownership and 2FA security proof verified by Robert",
  ].join("\n") + "\n");
  await writeFile(bridgeCsvPath, [
    bridgeHeader,
    "sports-daily,tiktok,SPORT,,https://viewer:secret@www.tiktok.com/@sportsdaily,https://app.metricool.com/planner/sports-daily-tiktok-proof,SPORT TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
    "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://viewer:secret@app.metricool.com/planner/meme-radar-tiktok-proof,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
  ].join("\n") + "\n");

  const result = runCloseout();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_invalid_evidence");

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-evidence-closeout.json"), "utf8"));
  assert.equal(report.totals.ready, 0);
  assert.ok(JSON.stringify(report).includes("safe HTTPS proof URL") || JSON.stringify(report).includes("public TikTok profile URL"));
});

test("TikTok MVP evidence closeout does not claim applied when readiness stays blocked", async () => {
  const previousSports = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const previousMemes = await readFile(memesEvidencePath, "utf8").catch(() => null);
  const previousQueue = await readFile(metricoolQueuePath, "utf8");
  try {
    await mkdir(tmpDir, { recursive: true });
    const queue = JSON.parse(previousQueue);
    queue.realPublishEnabled = true;
    await writeFile(metricoolQueuePath, JSON.stringify(queue, null, 2));
    await writeFile(accountCsvPath, cleanAccountCsv());
    await writeFile(bridgeCsvPath, cleanBridgeCsv());

    const apply = runCloseout(["--apply"]);
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const output = JSON.parse(apply.stdout);
    assert.equal(output.status, "applied_but_readiness_blocked");
    assert.equal(output.ready, 2);
    assert.equal(output.applied, 2);
  } finally {
    await writeFile(metricoolQueuePath, previousQueue);
    if (previousSports === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, previousSports);
    if (previousMemes === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, previousMemes);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});
