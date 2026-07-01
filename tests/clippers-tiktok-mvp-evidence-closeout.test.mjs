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
const routesPath = path.join(process.cwd(), "server/routes.ts");
const proofLinksModulePath = path.join(process.cwd(), "server/clippers-tiktok-mvp-proof-links.ts");
const clippersPagePath = path.join(process.cwd(), "client/src/pages/clippers.tsx");
const evidenceCloseoutPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-evidence-closeout.mjs");
const closeoutWizardPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-closeout-wizard.mjs");
const proofIntakePath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-intake-pack.mjs");
const proofDropKitPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-drop-kit.mjs");
const proofImportPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-intake-import.mjs");
const proofDoctorPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-doctor.mjs");
const proofRefreshPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-refresh.mjs");
const proofUnblockerPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-unblocker.mjs");
const proofQuickFillPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-quick-fill.mjs");
const proofHandoffPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-handoff.mjs");
const localVerificationPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-local-verification.mjs");
const autopilotBoundaryPath = path.join(process.cwd(), "script/clippers-tiktok-mvp-autopilot-boundary.mjs");
const closeoutReportPath = path.join(rootDir, "reports/clippers-tiktok-mvp-evidence-closeout.json");
const combinedProofCsvPath = path.join(tmpDir, "tiktok-mvp-combined-proof-test.csv");
const defaultCombinedProofCsvPath = path.join(rootDir, "reports/tiktok-mvp-proof-intake/combined-proof-intake.csv");
const quickFillInputPath = path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-quick-fill-input.json");
const proofLinksPath = path.join(rootDir, "proof-drop/tiktok-mvp/proof-links.json");
const proofLinksStarterPath = path.join(rootDir, "proof-drop/tiktok-mvp/proof-links-starter.json");
const targetAccountCsvPath = path.join(rootDir, "account-permission-mvp-account-evidence.csv");
const targetBridgeCsvPath = path.join(rootDir, "scheduled/metricool-tiktok-bridge-evidence.csv");

const accountHeader = "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes";
const bridgeHeader = "account_id,platform,metricool_brand_name,metricool_blog_id,profile_url,proof,notes";
const combinedHeader = "account_id,account_name,platform,handle,metricool_brand_name,public_profile_url,account_ownership_proof_url,metricool_connection_proof_url,account_notes,metricool_notes,copy_to_account_csv,copy_to_bridge_csv";

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

function requiredSlice(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing slice start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing slice end: ${end}`);
  return source.slice(startIndex, endIndex);
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

function cleanBridgeCsvWithGoogleEvidence() {
  return [
    bridgeHeader,
    "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@sportsdaily,https://drive.google.com/file/d/sports-daily-metricool-connected-proof/view?usp=sharing,SPORT TikTok is connected in Metricool with public non-secret Drive screenshot proof reviewed by Robert",
    "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing,memes TikTok is connected in Metricool with public non-secret Docs proof reviewed by Robert",
  ].join("\n") + "\n";
}

function cleanCombinedCsv() {
  return [
    combinedHeader,
    "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,https://drive.google.com/file/d/sports-daily-tiktok-proof/view,https://app.metricool.com/planner/sports-daily-tiktok-proof,Sports Daily TikTok account ownership and 2FA security proof verified by Robert without secrets,SPORT TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
    "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,https://app.metricool.com/planner/meme-radar-tiktok-proof,Meme Radar TikTok account ownership and 2FA security proof verified by Robert without secrets,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
  ].join("\n") + "\n";
}

async function writeApprovalRequiredMetricoolQueueForTest() {
  const raw = await readFile(metricoolQueuePath, "utf8");
  const queue = JSON.parse(raw);
  queue.status = "approval_required";
  queue.publishMode = "approval_required";
  queue.realPublishEnabled = false;
  queue.approvalRequired = true;
  queue.totals = {
    ...(queue.totals || {}),
    readyToSend: 0,
    queuedForApproval: Math.max(Number(queue.totals?.queuedForApproval || 0), 2),
  };
  await writeFile(metricoolQueuePath, JSON.stringify(queue, null, 2));
  return raw;
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

    const report = JSON.parse(await readFile(closeoutReportPath, "utf8"));
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
  const previousQueue = await writeApprovalRequiredMetricoolQueueForTest();
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
    assert.ok(["applied", "applied_but_readiness_blocked"].includes(output.status));
    assert.equal(output.ready, 2);
    assert.equal(output.applied, 2);
    const report = JSON.parse(await readFile(closeoutReportPath, "utf8"));
    assert.equal(report.totals.ready, 2);
    if (output.status === "applied") {
      assert.equal(report.readinessRefresh.stdout.status, "metricool_mvp_ready");
      assert.equal(report.readinessRefresh.stdout.activeMvpReadyLanes, 2);
      assert.equal(report.readinessRefresh.stdout.activeMvpTargetLanes, 2);
    } else {
      assert.equal(output.status, "applied_but_readiness_blocked");
      assert.notEqual(report.readinessRefresh.stdout.status, "metricool_mvp_ready");
    }

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
    await writeFile(metricoolQueuePath, previousQueue);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP evidence closeout accepts Google Drive or Docs Metricool evidence URLs", async () => {
  const previousSports = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const previousMemes = await readFile(memesEvidencePath, "utf8").catch(() => null);
  const previousQueue = await writeApprovalRequiredMetricoolQueueForTest();
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(accountCsvPath, cleanAccountCsv());
    await writeFile(bridgeCsvPath, cleanBridgeCsvWithGoogleEvidence());

    const preview = runCloseout();
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const previewOutput = JSON.parse(preview.stdout);
    assert.equal(previewOutput.status, "ready_to_apply");
    assert.equal(previewOutput.applied, 0);

    const applied = runCloseout(["--apply"]);
    assert.equal(applied.status, 0, applied.stderr || applied.stdout);
    const appliedOutput = JSON.parse(applied.stdout);
    assert.ok(["applied", "applied_but_readiness_blocked"].includes(appliedOutput.status));
    assert.equal(appliedOutput.applied, 2);
    const report = JSON.parse(await readFile(closeoutReportPath, "utf8"));
    if (appliedOutput.status === "applied") {
      assert.equal(report.readinessRefresh.stdout.status, "metricool_mvp_ready");
      assert.equal(report.readinessRefresh.stdout.activeMvpReadyLanes, 2);
      assert.equal(report.readinessRefresh.stdout.activeMvpTargetLanes, 2);
    } else {
      assert.equal(appliedOutput.status, "applied_but_readiness_blocked");
      assert.notEqual(report.readinessRefresh.stdout.status, "metricool_mvp_ready");
    }

    const sportsEvidence = JSON.parse(await readFile(sportsEvidencePath, "utf8"));
    const memesEvidence = JSON.parse(await readFile(memesEvidencePath, "utf8"));
    assert.equal(sportsEvidence.metricoolProofUrl, "https://drive.google.com/file/d/sports-daily-metricool-connected-proof/view?usp=sharing");
    assert.equal(memesEvidence.metricoolProofUrl, "https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing");
    assert.equal(sportsEvidence.status, "verified");
    assert.equal(memesEvidence.status, "verified");
  } finally {
    if (previousSports === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, previousSports);
    if (previousMemes === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, previousMemes);
    await writeFile(metricoolQueuePath, previousQueue);
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

  const report = JSON.parse(await readFile(closeoutReportPath, "utf8"));
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
    "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://app.metricool.com/planner/meme-radar-tiktok-proof?X-Amz-Signature=abc123,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert",
  ].join("\n") + "\n");

  const result = runCloseout();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_invalid_evidence");

  const report = JSON.parse(await readFile(closeoutReportPath, "utf8"));
  assert.equal(report.totals.ready, 0);
  assert.ok(JSON.stringify(report).includes("safe HTTPS proof URL") || JSON.stringify(report).includes("public TikTok profile URL"));
  assert.match(await readFile(evidenceCloseoutPath, "utf8"), /x-amz-signature/);
});

test("TikTok MVP proof links preview rejects embedded credential proof URLs", async () => {
  const {
    auditClipperTikTokMvpProofLinks,
    extractClipperTikTokMvpProofLinksPaste,
    safeClipperHttpsProofUrl,
    safeClipperMetricoolConnectionProofUrl,
  } = await import(`${proofLinksModulePath}?proof-links-credential-test=${Date.now()}`);

  assert.equal(safeClipperHttpsProofUrl("https://viewer:secret@drive.google.com/file/d/sports-daily-tiktok-proof/view"), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://viewer:secret@docs.google.com/document/d/meme-radar-proof/edit"), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://drive.google.com/drive/search?q=metricool"), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://drive.google.com/drive/my-drive"), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://docs.google.com/"), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://docs.google.com/document/d/meme-radar-proof/edit"), true);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://drive.google.com/open?id=sports-daily-proof"), true);

  const proofLinks = {
    lanes: {
      "sports-daily:tiktok": {
        accountOwnershipProofUrl: "https://viewer:secret@drive.google.com/file/d/sports-daily-tiktok-proof/view",
        metricoolConnectionProofUrl: "https://drive.google.com/file/d/sports-daily-metricool-proof/view",
        accountNotes: "Sports Daily TikTok ownership and 2FA proof verified by Robert without secrets.",
        metricoolNotes: "SPORT TikTok profile connected in Metricool with public proof reviewed by Robert.",
      },
      "meme-radar:tiktok": {
        accountOwnershipProofUrl: "https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
        metricoolConnectionProofUrl: "https://viewer:secret@docs.google.com/document/d/meme-radar-metricool-proof/edit",
        accountNotes: "Meme Radar TikTok ownership and 2FA proof verified by Robert without secrets.",
        metricoolNotes: "memes TikTok profile connected in Metricool with public proof reviewed by Robert.",
      },
    },
  };

  const preview = auditClipperTikTokMvpProofLinks(proofLinks);
  assert.equal(preview.readyForProofDrop, false);
  assert.equal(preview.status, "blocked");
  assert.ok(preview.issues.some((issue) => issue.includes("accountOwnershipProofUrl must be a real safe HTTPS proof URL")));
  assert.ok(preview.issues.some((issue) => issue.includes("metricoolConnectionProofUrl must be a real HTTPS metricool.com URL or concrete Google Drive file/folder or Docs evidence URL")));

  const pastePreview = extractClipperTikTokMvpProofLinksPaste([
    "SPORT https://viewer:secret@drive.google.com/file/d/sports-daily-proof/view",
    "memes https://viewer:secret@docs.google.com/document/d/meme-radar-proof/edit",
  ].join("\n"));
  assert.equal(pastePreview.status, "needs_review");
  assert.ok(pastePreview.issues.some((issue) => /passwords|tokens|cookies|keys|recovery/i.test(issue)));
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

test("TikTok MVP evidence closeout is wired into guarded API routes and UI controls", async () => {
  const routes = await readFile(routesPath, "utf8");
  const proofLinksModule = await readFile(proofLinksModulePath, "utf8");
  const page = await readFile(clippersPagePath, "utf8");

  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-evidence-closeout"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-intake-pack"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-proof-intake-pack"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-drop-kit"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-proof-drop-kit"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-links"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/preview-tiktok-mvp-proof-links"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/metricool-bridge-evidence-csv-status"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/metricool-bridge-preview-gate"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/load-metricool-bridge-evidence-csv"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/parse-tiktok-mvp-proof-links-paste"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-links-drop-status"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/create-tiktok-mvp-proof-links-drop-starter"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/import-tiktok-mvp-proof-links-drop"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/ingest-tiktok-mvp-proof-links-drop"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/save-tiktok-mvp-proof-links"/);
  assert.match(proofLinksModule, /containsClipperSecretLikeText/);
  assert.match(proofLinksModule, /clipperUnsafeProofQueryParamPattern/);
  assert.match(routes, /auditClipperTikTokMvpProofLinks/);
  assert.match(routes, /function isClipperGoogleEvidenceProofUrl/);
  assert.ok(routes.includes('^\\/file\\/d\\/[^/]+'));
  assert.ok(routes.includes('^\\/drive\\/(?:u\\/\\d+\\/)?folders\\/[^/]+'));
  assert.ok(routes.includes('pathname === "/open" || pathname === "/folderview"'));
  assert.ok(routes.includes('^\\/(?:document|spreadsheets|presentation|forms|drawings)\\/d\\/[^/]+'));
  assert.match(routes, /extractClipperTikTokMvpProofLinksPaste/);
  assert.match(proofLinksModule, /doesNotUnlock/);
  assert.match(proofLinksModule, /Does not apply account or Metricool evidence/);
  assert.match(proofLinksModule, /Does not schedule or publish TikTok posts/);
  assert.match(proofLinksModule, /Does not enable direct social APIs or real publishing/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-intake-import"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/preview-tiktok-mvp-proof-intake-import"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/apply-tiktok-mvp-proof-intake-import"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-quick-fill"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/apply-tiktok-mvp-proof-quick-fill"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-refresh"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-proof-refresh"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-unblocker"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-proof-unblocker"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-handoff"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-proof-handoff"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-local-verification"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-local-verification"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-closeout-wizard"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-closeout-wizard"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-autopilot-boundary"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-autopilot-boundary"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-operating-refresh"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-operating-refresh"/);
  assert.match(routes, /runClipperTikTokMvpOperatingRefresh/);
  assert.match(routes, /readClipperTikTokMvpOperatingRefresh/);
  assert.equal(await readFile(autopilotBoundaryPath, "utf8").then((source) => source.includes("Authorization from Robert is not treated as account ownership")), true);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-doctor"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/prepare-tiktok-mvp-proof-doctor"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/preview-tiktok-mvp-evidence-closeout"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/apply-tiktok-mvp-evidence-closeout"/);
  assert.match(routes, /x-clippers-operator-confirm"\) !== "apply-tiktok-mvp-evidence-closeout"/);
  assert.match(routes, /tiktokMvpEvidenceCloseout\.status !== "applied"/);
  const getRoute = requiredSlice(
    routes,
    'app.get("/api/clippers/tiktok-mvp-evidence-closeout"',
    'app.post("/api/clippers/preview-tiktok-mvp-evidence-closeout"',
  );
  const previewRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/preview-tiktok-mvp-evidence-closeout"',
    'app.post("/api/clippers/apply-tiktok-mvp-evidence-closeout"',
  );
  const intakeRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-intake-pack"',
    'app.get("/api/clippers/tiktok-mvp-proof-drop-kit"',
  );
  const proofDropRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-drop-kit"',
    'app.post("/api/clippers/preview-tiktok-mvp-proof-links"',
  );
  const proofLinksRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/preview-tiktok-mvp-proof-links"',
    'app.post("/api/clippers/parse-tiktok-mvp-proof-links-paste"',
  );
  const metricoolBridgePreviewRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/preview-metricool-bridge-evidence-batch"',
    'app.get("/api/clippers/metricool-bridge-preview-gate"',
  );
  const metricoolBridgePreviewGateRoute = requiredSlice(
    routes,
    'app.get("/api/clippers/metricool-bridge-preview-gate"',
    'app.get("/api/clippers/metricool-bridge-evidence-csv-status"',
  );
  const metricoolBridgeCsvStatusRoute = requiredSlice(
    routes,
    'app.get("/api/clippers/metricool-bridge-evidence-csv-status"',
    'app.post("/api/clippers/load-metricool-bridge-evidence-csv"',
  );
  const metricoolBridgeCsvLoadRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/load-metricool-bridge-evidence-csv"',
    'app.post("/api/clippers/record-metricool-bridge-evidence-batch"',
  );
  const metricoolBridgeRecordRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/record-metricool-bridge-evidence-batch"',
    'app.post("/api/clippers/prepare-publisher-execution-queue"',
  );
  const proofLinksPasteRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/parse-tiktok-mvp-proof-links-paste"',
    'app.get("/api/clippers/tiktok-mvp-proof-links-drop-status"',
  );
  const proofLinksDropStatusRoute = requiredSlice(
    routes,
    'app.get("/api/clippers/tiktok-mvp-proof-links-drop-status"',
    'app.post("/api/clippers/create-tiktok-mvp-proof-links-drop-starter"',
  );
  const proofLinksDropStatusHelper = requiredSlice(
    routes,
    "async function buildClipperTikTokMvpProofLinksDropStatus()",
    "export function buildClipperExternalCloseoutEvidenceCsvTemplate",
  );
  const proofLinksDropStarterRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/create-tiktok-mvp-proof-links-drop-starter"',
    'app.post("/api/clippers/import-tiktok-mvp-proof-links-drop"',
  );
  const proofLinksDropImportRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/import-tiktok-mvp-proof-links-drop"',
    'app.post("/api/clippers/ingest-tiktok-mvp-proof-links-drop"',
  );
  const proofLinksDropIngestRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/ingest-tiktok-mvp-proof-links-drop"',
    'app.post("/api/clippers/save-tiktok-mvp-proof-links"',
  );
  const proofLinksSaveRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/save-tiktok-mvp-proof-links"',
    'app.get("/api/clippers/tiktok-mvp-proof-intake-import"',
  );
  const proofLinksSaveHelper = requiredSlice(
    routes,
    "const saveClipperTikTokMvpProofLinksAndRefresh =",
    "const readClipperExternalCloseoutPack =",
  );
  const importPreviewRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/preview-tiktok-mvp-proof-intake-import"',
    'app.post("/api/clippers/apply-tiktok-mvp-proof-intake-import"',
  );
  const importApplyRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/apply-tiktok-mvp-proof-intake-import"',
    'app.get("/api/clippers/tiktok-mvp-proof-quick-fill"',
  );
  const quickFillRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/apply-tiktok-mvp-proof-quick-fill"',
    'app.get("/api/clippers/tiktok-mvp-proof-refresh"',
  );
  const refreshRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-refresh"',
    'app.get("/api/clippers/tiktok-mvp-proof-unblocker"',
  );
  const unblockerRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-unblocker"',
    'app.get("/api/clippers/tiktok-mvp-proof-handoff"',
  );
  const handoffRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-handoff"',
    'app.get("/api/clippers/tiktok-mvp-local-verification"',
  );
  const localVerificationRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-local-verification"',
    'app.get("/api/clippers/tiktok-mvp-closeout-wizard"',
  );
  const closeoutWizardRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-closeout-wizard"',
    'app.get("/api/clippers/tiktok-mvp-autopilot-boundary"',
  );
  const autopilotBoundaryRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-autopilot-boundary"',
    'app.get("/api/clippers/tiktok-mvp-operating-refresh"',
  );
  const operatingRefreshRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-operating-refresh"',
    'app.get("/api/clippers/tiktok-mvp-proof-doctor"',
  );
  const operatorButtonHelper = requiredSlice(
    page,
    "const runTikTokMvpOperatorButton =",
    "const tiktokMetricoolBlockedRows =",
  );
  const applyRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/apply-tiktok-mvp-evidence-closeout"',
    'app.get("/api/clippers/operational-readiness"',
  );
  assert.match(getRoute, /readClipperTikTokMvpEvidenceCloseout/);
  assert.doesNotMatch(getRoute, /runClipperTikTokMvpEvidenceCloseout|runClipperNodeJson|--apply/);
  assert.match(previewRoute, /runClipperTikTokMvpEvidenceCloseout\(false\)/);
  assert.doesNotMatch(previewRoute, /x-clippers-operator-confirm|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(intakeRoute, /runClipperTikTokMvpProofIntakePack/);
  assert.match(intakeRoute, /readClipperTikTokMvpProofIntakePack/);
  assert.match(intakeRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(intakeRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(intakeRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(proofDropRoute, /runClipperTikTokMvpProofDropKit/);
  assert.match(proofDropRoute, /readClipperTikTokMvpProofDropKit/);
  assert.match(proofDropRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(proofDropRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.match(proofDropRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(proofDropRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(proofDropRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksRoute, /auditClipperTikTokMvpProofLinks/);
  assert.match(proofLinksRoute, /writeClipperTikTokMvpProofLinksPreviewGate/);
  assert.match(proofLinksRoute, /tiktokMvpProofLinksPreviewGate/);
  assert.doesNotMatch(proofLinksRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(metricoolBridgeCsvStatusRoute, /buildClipperMetricoolBridgeEvidenceCsvStatus/);
  assert.match(metricoolBridgePreviewRoute, /writeClipperMetricoolBridgePreviewGate/);
  assert.match(metricoolBridgePreviewRoute, /metricoolBridgePreviewGate/);
  assert.match(metricoolBridgePreviewGateRoute, /buildClipperMetricoolBridgePreviewGateStatus/);
  assert.match(metricoolBridgePreviewGateRoute, /metricoolBridgePreviewGate/);
  assert.match(metricoolBridgeRecordRoute, /validateClipperMetricoolBridgePreviewGate/);
  assert.match(metricoolBridgeRecordRoute, /previewHash/);
  assert.match(metricoolBridgeRecordRoute, /blocked_missing_or_stale_preview/);
  assert.match(routes, /clipperMetricoolBridgePreviewGatePath/);
  assert.match(routes, /clipperTikTokMvpEvidenceCloseoutPreviewGatePath/);
  assert.match(routes, /hashClipperMetricoolBridgeRaw/);
  assert.match(routes, /hashClipperTikTokMvpEvidenceCloseoutRaw/);
  assert.match(routes, /createHash\("sha256"\)/);
  assert.match(routes, /Stores only a SHA-256 hash and preview totals/);
  assert.match(routes, /rawStored:\s*false/);
  assert.match(routes, /expired/);
  assert.match(routes, /writeClipperTikTokMvpEvidenceCloseoutPreviewGate/);
  assert.match(routes, /validateClipperTikTokMvpEvidenceCloseoutPreviewGate/);
  assert.match(metricoolBridgeCsvLoadRoute, /loadClipperMetricoolBridgeEvidenceCsv/);
  assert.match(routes, /async function loadClipperMetricoolBridgeEvidenceCsv/);
  assert.match(routes, /readNodeFile\(clipperMetricoolBridgeEvidenceCsvPath/);
  assert.match(routes, /containsClipperSecretLikeText\(raw\)/);
  assert.match(routes, /blocked_secret_like_csv/);
  assert.match(routes, /metricoolBridgeEvidenceCsvLoad/);
  assert.match(routes, /clipperMetricoolBridgeEvidenceCsvPath/);
  assert.match(routes, /Public TikTok profile URL/);
  assert.match(routes, /Metricool connection proof/);
  assert.match(page, /prepare-clippers-tiktok-mvp-operating-refresh-button/);
  assert.match(page, /clippers-tiktok-mvp-operating-refresh-panel/);
  assert.match(page, /clippers-tiktok-mvp-operating-refresh-proof-gate/);
  assert.match(page, /proofGate\.status/);
  assert.match(page, /proofGate\.requiredLanes \|\| \[\]\)\.join/);
  assert.match(page, /proofGate\.nextSafeButton/);
  assert.match(page, /proofGate\.nextLockedButton/);
  assert.match(page, /proofGate\.blockedBy/);
  assert.match(page, /proofGate\.failedPreflightChecks/);
  assert.match(page, /proofGate\.failedVerifierChecks/);
  assert.match(page, /proofGate\.paths\?\.proofLinksJson/);
  assert.match(page, /proofGate\.paths\?\.bridgeEvidenceCsv/);
  assert.match(page, /sports-daily:tiktok\.accountOwnershipProofUrl=\$\{sportUrl\}/);
  assert.match(page, /sports-daily:tiktok\.metricoolConnectionProofUrl=\$\{sportUrl\}/);
  assert.match(page, /meme-radar:tiktok\.accountOwnershipProofUrl=\$\{memesUrl\}/);
  assert.match(page, /meme-radar:tiktok\.metricoolConnectionProofUrl=\$\{memesUrl\}/);
  assert.match(page, /tiktokMvpFastPathOwnershipConfirmed/);
  assert.match(page, /tiktokMvpFastPathSportProofReady = isMetricoolProofUrl\(tiktokMvpFastPathSportProofUrl\)/);
  assert.match(page, /tiktokMvpFastPathMemesProofReady = isMetricoolProofUrl\(tiktokMvpFastPathMemesProofUrl\)/);
  assert.match(page, /tiktokMvpFastPathCanBuild = tiktokMvpFastPathSportProofReady/);
  assert.match(page, /\(token\|access\|refresh\|auth\|signature\|signed\|session\|cookie\|key\|secret\|password\|passcode\|recovery\)=/);
  assert.match(page, /Fast path requiere confirmacion/);
  assert.match(page, /Proof URLs no validos/);
  assert.match(page, /SPORT proof URL/);
  assert.match(page, /memes proof URL/);
  assert.match(page, /must be Metricool or concrete Drive file\/folder\/Docs evidence/);
  assert.match(page, /clippers-tiktok-mvp-fast-path-ownership-confirmation/);
  assert.match(page, /!tiktokMvpFastPathOwnershipConfirmed/);
  assert.match(page, /shows the TikTok profile connected under Robert control/);
  assert.match(page, /const clearTikTokMvpProofLinksGeneratedState = \(\) => \{[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksText\(""\);[\s\S]*?setTiktokMvpProofLinksPreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?setTiktokMvpFastPathOwnershipConfirmed\(false\);[\s\S]*?\};/);
  assert.match(page, /setTiktokMvpFastPathSportProofUrl\(event\.target\.value\);[\s\S]*?clearTikTokMvpProofLinksGeneratedState\(\);/);
  assert.match(page, /setTiktokMvpFastPathMemesProofUrl\(event\.target\.value\);[\s\S]*?clearTikTokMvpProofLinksGeneratedState\(\);/);
  assert.match(page, /setTiktokMvpProofLinksText\(""\)/);
  assert.match(page, /setTiktokMvpProofLinksSaveReceipt\(null\)/);
  assert.match(page, /setTiktokMvpProofLinksPasteText\(event\.target\.value\)/);
  assert.match(page, /setTiktokMvpProofLinksPasteText\(event\.target\.value\);[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksPreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);/);
  assert.match(page, /These two URLs build explicit account \+ Metricool proof fields/);
  assert.match(page, /tiktokMvpOperatingRefreshMutation/);
  assert.match(operatingRefreshRoute, /runClipperTikTokMvpOperatingRefresh/);
  assert.match(operatingRefreshRoute, /readClipperTikTokMvpOperatingRefresh/);
  assert.match(operatingRefreshRoute, /readClipperTikTokMvpAutopilotBoundary/);
  assert.match(operatingRefreshRoute, /readClipperTikTokMvpProofHandoff/);
  assert.doesNotMatch(operatingRefreshRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(routes, /isClipperMetricoolConnectionProofUrl/);
  assert.match(routes, /concrete Google Drive file\/folder or Docs evidence URL/);
  assert.match(routes, /realPublishEnabled:\s*false/);
  assert.doesNotMatch(metricoolBridgeCsvStatusRoute, /writeNodeFile|recordClipperMetricoolBridgeEvidenceBatch|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule|send posts/i);
  assert.doesNotMatch(metricoolBridgeCsvLoadRoute, /writeNodeFile|recordClipperMetricoolBridgeEvidenceBatch|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true/);
  assert.doesNotMatch(metricoolBridgePreviewRoute, /recordClipperMetricoolBridgeEvidenceBatch|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule|send posts/i);
  assert.doesNotMatch(metricoolBridgePreviewGateRoute, /recordClipperMetricoolBridgeEvidenceBatch|writeNodeFile|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule|send posts/i);
  assert.match(proofLinksPasteRoute, /extractClipperTikTokMvpProofLinksPaste/);
  assert.match(proofLinksModule, /explicitFields/);
  assert.match(proofLinksModule, /accountOwnershipProofUrl\|metricoolConnectionProofUrl\|accountNotes\|metricoolNotes/);
  assert.doesNotMatch(proofLinksPasteRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksDropStatusRoute, /buildClipperTikTokMvpProofLinksDropStatus/);
  assert.match(proofLinksDropStatusHelper, /checklistTotals/);
  assert.match(proofLinksDropStatusHelper, /nextButton/);
  assert.match(proofLinksDropStatusHelper, /two real non-secret SPORT and memes Metricool URLs or concrete Drive file\/folder\/Docs TikTok proof URLs/);
  assert.match(proofLinksDropStatusHelper, /four-field fallback when ownership proof is separate/);
  assert.match(proofLinksDropStatusHelper, /Metricool or concrete Drive file\/folder\/Docs proof can be reused only when it clearly proves ownership\/control/);
  assert.doesNotMatch(proofLinksDropStatusHelper, /four non-secret proof URLs|four non-secret TikTok\/Metricool proof links/);
  assert.match(routes, /TikTok ownership proof/);
  assert.match(routes, /Metricool connection proof/);
  assert.match(routes, /does not return raw paste text/);
  assert.doesNotMatch(proofLinksDropStatusRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksDropStarterRoute, /create-tiktok-mvp-proof-links-drop-starter/);
  assert.match(proofLinksDropStarterRoute, /!existing\.trim\(\)/);
  assert.match(proofLinksDropStarterRoute, /fastPathPastePacketText/);
  assert.match(proofLinksDropStarterRoute, /starterKind/);
  assert.match(proofLinksDropStarterRoute, /metricool_fast_path/);
  assert.match(proofLinksDropStarterRoute, /writeNodeFile/);
  assert.match(proofLinksDropStarterRoute, /overwritten:\s*false/);
  assert.match(proofLinksDropStarterRoute, /realPublishEnabled:\s*false/);
  assert.match(proofLinksDropStarterRoute, /Does not overwrite an existing filled proof links drop file/);
  assert.doesNotMatch(proofLinksDropStarterRoute, /runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|schedule/i);
  assert.match(proofLinksDropImportRoute, /readClipperTikTokMvpProofLinksDropPaste/);
  assert.match(routes, /proof-links-paste-packet-filled\.txt/);
  assert.match(proofLinksDropImportRoute, /extractClipperTikTokMvpProofLinksPaste/);
  assert.match(proofLinksDropImportRoute, /realPublishEnabled:\s*false/);
  assert.match(proofLinksDropImportRoute, /Does not save proof-links\.json until the operator presses Save proof links/);
  assert.doesNotMatch(proofLinksDropImportRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|schedule/i);
  assert.match(proofLinksDropIngestRoute, /readClipperTikTokMvpProofLinksDropPaste/);
  assert.match(proofLinksDropIngestRoute, /extractClipperTikTokMvpProofLinksPaste/);
  assert.match(proofLinksDropIngestRoute, /validateClipperTikTokMvpProofLinks/);
  assert.match(proofLinksDropIngestRoute, /blocked_invalid_drop/);
  assert.match(proofLinksDropIngestRoute, /saveClipperTikTokMvpProofLinksAndRefresh/);
  assert.match(proofLinksDropIngestRoute, /saved_and_refreshed/);
  assert.match(proofLinksDropIngestRoute, /realPublishEnabled:\s*false/);
  assert.match(proofLinksDropIngestRoute, /Does not apply final evidence/);
  assert.doesNotMatch(proofLinksDropIngestRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|schedule/i);
  assert.match(proofLinksSaveRoute, /validateClipperTikTokMvpProofLinks/);
  assert.match(proofLinksSaveRoute, /validateClipperTikTokMvpProofLinksPreviewGate/);
  assert.match(proofLinksSaveRoute, /previewHash/);
  assert.match(proofLinksSaveRoute, /blocked_missing_or_stale_preview/);
  assert.match(proofLinksSaveRoute, /auditClipperTikTokMvpProofLinks/);
  assert.match(proofLinksSaveRoute, /!audit\.readyForProofDrop/);
  assert.match(proofLinksSaveRoute, /saveClipperTikTokMvpProofLinksAndRefresh/);
  assert.match(proofLinksSaveHelper, /proof-links\.json/);
  assert.match(proofLinksSaveHelper, /proof-links-save-receipt\.json/);
  assert.match(proofLinksSaveHelper, /proof-links-save-receipt\.md/);
  assert.match(proofLinksSaveHelper, /tiktokMvpProofLinksSaveReceipt/);
  assert.match(proofLinksSaveHelper, /Receipt is informational and does not apply evidence/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofDropKit/);
  assert.match(proofLinksSaveHelper, /proof-quick-fill-input\.json/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofQuickFill/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofIntakeImport\(false\)/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpCloseoutWizard/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofHandoff/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokExternalCloseoutSession/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofDoctor/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofUnblocker/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpProofHandoff/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpEvidenceCloseout/);
  assert.match(proofLinksSaveHelper, /postProofRefreshRuns/);
  assert.match(proofLinksSaveHelper, /script\/clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(proofLinksSaveHelper, /script\/clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(proofLinksSaveHelper, /script\/clippers-metricool-mcp-preflight\.ts/);
  assert.match(proofLinksSaveHelper, /script\/clippers-metricool-current-batch-upload-pack\.mjs/);
  assert.match(proofLinksSaveHelper, /script\/clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(proofLinksSaveHelper, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpGoLivePacket/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpReadinessVerifier/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokNextAction/);
  assert.match(proofLinksSaveHelper, /readClipperMetricoolMcpPreflight/);
  assert.match(proofLinksSaveHelper, /readClipperMetricoolCurrentBatchUploadPack/);
  assert.match(proofLinksSaveHelper, /readClipperMetricoolCurrentBatchSessionPacket/);
  assert.match(proofLinksSaveHelper, /tiktokNextAction/);
  assert.match(proofLinksSaveHelper, /metricoolCurrentBatchUploadPack/);
  assert.match(proofLinksSaveHelper, /metricoolCurrentBatchSessionPacket/);
  assert.match(proofLinksSaveHelper, /buildClipperMetricoolBridgeEvidenceCsvStatus/);
  assert.match(proofLinksSaveHelper, /metricoolBridgeEvidenceCsvStatus/);
  assert.doesNotMatch(proofLinksRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(importPreviewRoute, /runClipperTikTokMvpProofIntakeImport\(false\)/);
  assert.match(importPreviewRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(importPreviewRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(importPreviewRoute, /x-clippers-operator-confirm|runClipperTikTokMvpProofIntakeImport\(true\)|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(importApplyRoute, /x-clippers-operator-confirm"\) !== "apply-tiktok-mvp-proof-intake-import"/);
  assert.match(importApplyRoute, /runClipperTikTokMvpProofIntakeImport\(true\)/);
  assert.match(importApplyRoute, /tiktokMvpProofIntakeImport\.status !== "applied"/);
  assert.match(importApplyRoute, /postImportApplyRuns/);
  assert.match(importApplyRoute, /runClipperTikTokMvpProofDoctor/);
  assert.match(importApplyRoute, /runClipperTikTokMvpCloseoutWizard/);
  assert.match(importApplyRoute, /runClipperTikTokMvpProofHandoff/);
  assert.match(importApplyRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(importApplyRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(importApplyRoute, /readClipperTikTokMvpProofHandoff/);
  assert.match(importApplyRoute, /readClipperTikTokNextAction/);
  assert.match(importApplyRoute, /tiktokNextAction/);
  assert.doesNotMatch(importApplyRoute, /runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(quickFillRoute, /runClipperTikTokMvpProofQuickFill/);
  assert.match(quickFillRoute, /proof-quick-fill-input\.json/);
  assert.match(quickFillRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(quickFillRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.match(quickFillRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(quickFillRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(quickFillRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(refreshRoute, /runClipperTikTokMvpProofRefresh/);
  assert.match(refreshRoute, /readClipperTikTokMvpProofRefresh/);
  assert.match(refreshRoute, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(refreshRoute, /readClipperTikTokMvpProofDoctor/);
  assert.match(refreshRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(refreshRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(refreshRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(unblockerRoute, /runClipperTikTokMvpProofUnblocker/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofRefresh/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofDoctor/);
  assert.match(unblockerRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(unblockerRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(unblockerRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(handoffRoute, /runClipperTikTokMvpProofHandoff/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofHandoff/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofDropKit/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(handoffRoute, /readClipperTikTokMvpEvidenceCloseout/);
  assert.match(handoffRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(handoffRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(handoffRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(handoffRoute, /--apply|runClipperTikTokMvpProofIntakeImport\(true\)|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(localVerificationRoute, /runClipperTikTokMvpLocalVerification/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpLocalVerification/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.match(localVerificationRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(localVerificationRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(localVerificationRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(closeoutWizardRoute, /runClipperTikTokMvpCloseoutWizard/);
  assert.match(closeoutWizardRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(closeoutWizardRoute, /readClipperTikTokMvpProofDropKit/);
  assert.match(closeoutWizardRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.match(closeoutWizardRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(closeoutWizardRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(closeoutWizardRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(autopilotBoundaryRoute, /runClipperTikTokMvpAutopilotBoundary/);
  assert.match(autopilotBoundaryRoute, /readClipperTikTokMvpAutopilotBoundary/);
  assert.match(autopilotBoundaryRoute, /readClipperTikTokMvpProofHandoff/);
  assert.match(autopilotBoundaryRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(autopilotBoundaryRoute, /readClipperTikTokMvpLocalVerification/);
  assert.match(autopilotBoundaryRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.doesNotMatch(autopilotBoundaryRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  const doctorRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-doctor"',
    'app.get("/api/clippers/tiktok-mvp-evidence-closeout"',
  );
  assert.match(doctorRoute, /runClipperTikTokMvpProofDoctor/);
  assert.match(doctorRoute, /readClipperTikTokMvpProofDoctor/);
  assert.match(doctorRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(doctorRoute, /readClipperTikTokNextAction/);
  assert.doesNotMatch(doctorRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(applyRoute, /res\.status\(403\)/);
  assert.match(applyRoute, /x-clippers-operator-confirm"\) !== "apply-tiktok-mvp-evidence-closeout"/);
  assert.match(applyRoute, /validateClipperTikTokMvpEvidenceCloseoutPreviewGate/);
  assert.match(applyRoute, /blocked_missing_or_stale_preview/);
  assert.match(applyRoute, /Preview closeout again after every CSV edit/);
  assert.match(applyRoute, /runClipperTikTokMvpEvidenceCloseout\(true\)/);
  assert.match(applyRoute, /tiktokMvpEvidenceCloseout\.status !== "applied"/);
  assert.match(applyRoute, /res\.status\(400\)/);
  assert.match(applyRoute, /runClipperOperationalReadiness/);
  assert.match(applyRoute, /postCloseoutApplyRuns/);
  assert.match(applyRoute, /script\/clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(applyRoute, /script\/clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(applyRoute, /script\/clippers-metricool-mcp-preflight\.ts/);
  assert.match(applyRoute, /script\/clippers-metricool-current-batch-upload-pack\.mjs/);
  assert.match(applyRoute, /script\/clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(applyRoute, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(applyRoute, /readClipperTikTokMvpGoLivePacket/);
  assert.match(applyRoute, /readClipperTikTokMvpReadinessVerifier/);
  assert.match(applyRoute, /readClipperTikTokNextAction/);
  assert.match(applyRoute, /readClipperMetricoolMcpPreflight/);
  assert.match(applyRoute, /readClipperMetricoolCurrentBatchUploadPack/);
  assert.match(applyRoute, /readClipperMetricoolCurrentBatchSessionPacket/);
  assert.match(applyRoute, /tiktokNextAction/);
  assert.match(applyRoute, /metricoolCurrentBatchUploadPack/);
  assert.match(applyRoute, /metricoolCurrentBatchSessionPacket/);
  assert.doesNotMatch(applyRoute, /ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);

  assert.match(page, /preview-clippers-tiktok-mvp-evidence-closeout-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-proof-intake-pack-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-proof-drop-kit-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-proof-doctor-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-proof-refresh-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-proof-unblocker-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-proof-handoff-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-local-verification-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-closeout-wizard-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-autopilot-boundary-button/);
  assert.match(page, /apply-clippers-tiktok-mvp-proof-quick-fill-button/);
  assert.match(page, /reset-clippers-tiktok-mvp-proof-quick-fill-button/);
  assert.match(page, /preview-clippers-tiktok-mvp-proof-intake-import-button/);
  assert.match(page, /apply-clippers-tiktok-mvp-proof-intake-import-button/);
  assert.match(page, /Stage proof CSVs/);
  assert.match(page, /Proof CSVs listos para stage/);
  assert.match(page, /Proof CSVs stageados/);
  assert.doesNotMatch(page, /Proof import aplicado/);
  assert.doesNotMatch(page, />\s*Apply import\s*</);
  assert.match(page, /Proof handoff listo para apply review/);
  assert.match(page, /Proof doctor listo para review/);
  assert.match(page, /Proof refresh listo para review/);
  assert.match(page, /Proof unblocker listo para apply preview/);
  assert.match(page, /Closeout wizard listo para apply review/);
  assert.match(page, /Boundary listo para apply review/);
  assert.doesNotMatch(page, /"Proof handoff listo"/);
  assert.doesNotMatch(page, /"Proof doctor listo"/);
  assert.doesNotMatch(page, /"Proof refresh listo"/);
  assert.doesNotMatch(page, /"Proof unblocker listo"/);
  assert.doesNotMatch(page, /"Closeout wizard listo"/);
  assert.doesNotMatch(page, /"Boundary listo"/);
  assert.match(page, /apply-clippers-tiktok-mvp-evidence-closeout-button/);
  assert.match(page, /Open apply review/);
  assert.doesNotMatch(page, />\s*Apply closeout\s*</);
  assert.match(page, /const tiktokProofFlowBusy =/);
  assert.match(page, /disabled=\{tiktokProofFlowBusy \|\| isLoading/);
  assert.match(page, /ClipperTikTokMvpEvidenceCloseoutPreviewGateSummary/);
  assert.match(page, /ClipperTikTokMvpProofLinksPreviewGateSummary/);
  assert.match(page, /tiktokMvpProofLinksPreviewGate/);
  assert.match(page, /previewHash: tiktokMvpProofLinksPreviewGate\?\.rawHash/);
  assert.match(page, /tiktokMvpProofLinksSaveGateReady/);
  assert.match(page, /tiktokMvpEvidenceCloseoutPreviewGate/);
  assert.match(page, /clippers-tiktok-mvp-evidence-closeout-panel/);
  assert.match(page, /clippers-tiktok-mvp-autopilot-boundary-panel/);
  assert.match(page, /clippers-tiktok-mvp-autopilot-boundary-deliverables/);
  assert.match(page, /clippers-tiktok-mvp-autopilot-boundary-external-actions/);
  assert.match(page, /codexCanCreateExternalAccounts/);
  assert.match(page, /codexCanInventPermissions/);
  assert.match(page, /clippers-tiktok-mvp-evidence-closeout-preview-gate/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-pack-paths/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-current-blockers/);
  assert.match(page, /clippers-tiktok-mvp-drive-evidence-checklist/);
  assert.match(page, /driveEvidenceChecklist/);
  assert.match(page, /lane\.evidenceQuality\?\.issues/);
  assert.match(page, /clippers-tiktok-mvp-proof-drop-kit-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-drop-kit-lanes/);
  assert.match(page, /clippers-metricool-bridge-csv-status/);
  assert.match(page, /clippers-metricool-bridge-csv-checklist/);
  assert.match(page, /load-clippers-metricool-bridge-evidence-csv-button/);
  assert.match(page, /metricoolBridgeEvidenceCsvLoadMutation/);
  assert.match(page, /setMetricoolBridgeEvidenceBatchText\(data\.metricoolBridgeEvidenceCsvLoad\.raw\)/);
  assert.match(page, /Preview the current Metricool bridge rows before importing evidence/);
  assert.match(page, /previewHash: metricoolBridgeEvidenceCurrentPreviewGate\?\.rawHash/);
  assert.match(page, /metricoolBridgePreviewGate: ClipperMetricoolBridgePreviewGate/);
  assert.match(page, /\["\/api\/clippers\/metricool-bridge-preview-gate"\]/);
  assert.match(page, /clippers-metricool-bridge-preview-gate-status/);
  assert.match(page, /raw stored/);
  assert.match(page, /queryClient\.setQueryData\(\["\/api\/clippers\/metricool-bridge-preview-gate"\], data\.metricoolBridgePreviewGate\)/);
  assert.match(page, /metricoolBridgeEvidenceCurrentPreviewGate\?\.status !== "ready_for_import"/);
  assert.match(page, /!metricoolBridgeEvidenceCurrentPreview \|\| metricoolBridgeEvidenceCurrentPreview\.totals\.recorded <= 0/);
  assert.match(page, /\["\/api\/clippers\/metricool-bridge-evidence-csv-status"\]/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-editor/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-paste-assistant/);
  assert.match(page, /clippers-tiktok-mvp-metricool-fast-path-panel/);
  assert.match(page, /clippers-tiktok-mvp-fast-path-sport-input/);
  assert.match(page, /clippers-tiktok-mvp-fast-path-memes-input/);
  assert.match(page, /build-clippers-tiktok-mvp-metricool-fast-path-button/);
  assert.match(page, /buildTikTokMvpMetricoolFastPathPaste/);
  assert.match(page, /tiktokMvpProofLinksPasteMutation\.mutate\(packetText\)/);
  assert.match(page, /Build & preview 2 URLs/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-drop-status/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-drop-checklist/);
  assert.match(page, /tiktokMvpProofLinksDropStatus\.checklistTotals\.ready/);
  assert.match(page, /tiktokMvpProofLinksDropStatus\.nextButton/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-links-drop-status"\]/);
  assert.match(page, /load-clippers-tiktok-mvp-proof-links-paste-packet-button/);
  assert.match(page, /load-clippers-tiktok-mvp-proof-links-fast-path-packet-button/);
  assert.match(page, /tiktokMvpProofHandoff\?\.fastPathPastePacketText/);
  assert.match(page, /Load 2-proof packet/);
  assert.match(page, /import-clippers-tiktok-mvp-proof-links-drop-button/);
  assert.match(page, /create-clippers-tiktok-mvp-proof-links-drop-starter-button/);
  assert.match(page, /ingest-clippers-tiktok-mvp-proof-links-drop-button/);
  assert.match(page, /tiktokMvpProofLinksDropIngestMutation/);
  assert.match(page, /tiktokMvpProofLinksDropStarterMutation/);
  assert.match(page, /starterKind/);
  assert.match(page, /tiktokMvpProofLinksDropImportMutation/);
  assert.match(page, /tiktokMvpProofHandoff\?\.pastePacketText/);
  assert.match(page, /setTiktokMvpProofLinksText\(data\.tiktokMvpProofLinksDropImport\.proofLinksText\)/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-handoff"\], data\.tiktokMvpProofHandoff/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-refresh"\], data\.tiktokMvpProofRefresh/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-intake-import"\], data\.tiktokMvpProofIntakeImport/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-doctor"\], data\.tiktokMvpProofDoctor/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-evidence-closeout"\], data\.tiktokMvpEvidenceCloseout/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-go-live-packet"\], data\.tiktokMvpGoLivePacket/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-readiness-verifier"\], data\.tiktokMvpReadinessVerifier/);
  assert.match(page, /\["\/api\/clippers\/tiktok-next-action"\], data\.tiktokNextAction/);
  assert.match(page, /\["\/api\/clippers\/metricool-mcp-preflight"\], data\.metricoolMcpPreflight/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-upload-pack"\], data\.metricoolCurrentBatchUploadPack/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-session-packet"\], data\.metricoolCurrentBatchSessionPacket/);
  assert.match(page, /postProofRefreshError/);
  assert.match(page, /parse-clippers-tiktok-mvp-proof-links-paste-button/);
  assert.match(page, /const tiktokMvpProofLinksSaveMutation = useMutation\(\{[\s\S]*?onMutate: \(\) => \{[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?mutationFn: async \(\) =>/);
  assert.match(page, /const tiktokMvpProofLinksPreviewMutation = useMutation\(\{[\s\S]*?onMutate: \(\) => \{[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?mutationFn: async \(\) =>/);
  assert.match(page, /const tiktokMvpProofLinksPasteMutation = useMutation\(\{[\s\S]*?onMutate: \(\) => \{[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksText\(""\);[\s\S]*?setTiktokMvpProofLinksPreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?mutationFn: async \(pasteTextOverride\?: string\) =>/);
  assert.match(page, /setTiktokMvpProofLinksPreview\(data\.tiktokMvpProofLinksPreview\);[\s\S]*?setTiktokMvpProofLinksPreviewGate\(data\.tiktokMvpProofLinksPreviewGate\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);/);
  assert.match(page, /setTiktokMvpProofLinksPastePreview\(data\.tiktokMvpProofLinksPastePreview\);[\s\S]*?setTiktokMvpProofLinksText\(data\.tiktokMvpProofLinksPastePreview\.proofLinksText\);[\s\S]*?setTiktokMvpProofLinksPreview\(data\.tiktokMvpProofLinksPastePreview\.proofLinksPreview\);[\s\S]*?setTiktokMvpProofLinksPreviewGate\(data\.tiktokMvpProofLinksPreviewGate\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-paste-preview/);
  assert.match(page, /save-clippers-tiktok-mvp-proof-links-from-paste-preview-button/);
  assert.match(page, /Save previewed links/);
  assert.doesNotMatch(page, /Save verified links/);
  assert.doesNotMatch(page, /TikTok MVP verificado|Metricool proof lines ready|Proof quick fill guardado/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-textarea/);
  assert.match(page, /preview-clippers-tiktok-mvp-proof-links-button/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-preview-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-preview-impact/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-goal-impact/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-save-receipt/);
  assert.match(page, /tiktokMvpProofLinksSaveReceipt/);
  assert.match(page, /goalBoardImpact/);
  assert.match(page, /unlocksOperatorActions/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-preview-lanes/);
  assert.match(page, /save-clippers-tiktok-mvp-proof-links-button/);
  assert.match(page, /tiktokMvpProofLinksSaveGateReady/);
  assert.match(page, /disabled=\{tiktokProofFlowBusy \|\| isLoading \|\| !tiktokMvpProofLinksText\.trim\(\) \|\| !tiktokMvpProofLinksSaveGateReady\}/);
  assert.match(page, /Preview must be clean before Save links turns on/);
  assert.match(page, /signed\/temporary URLs/);
  assert.match(page, /reset-clippers-tiktok-mvp-proof-links-button/);
  assert.match(page, /load-clippers-tiktok-mvp-proof-links-starter-button/);
  assert.match(page, /build-clippers-tiktok-mvp-metricool-fast-path-button/);
  assert.match(page, /disabled=\{tiktokProofFlowBusy \|\| isLoading \|\| !tiktokMvpFastPathCanBuild\}/);
  assert.match(page, /setTiktokMvpProofLinksText\(tiktokMvpProofLinks\?\.raw \|\| ""\);[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksPreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?setTiktokMvpFastPathOwnershipConfirmed\(false\);/);
  assert.match(page, /setTiktokMvpProofLinksText\(tiktokMvpProofHandoffJsonStarterText \|\| tiktokMvpProofDropKit\.proofLinksStarterText \|\| ""\);[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksPreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?setTiktokMvpFastPathOwnershipConfirmed\(false\);/);
  assert.match(page, /setTiktokMvpProofLinksText\(event\.target\.value\);[\s\S]*?setTiktokMvpProofLinksPastePreview\(null\);[\s\S]*?setTiktokMvpProofLinksPreview\(null\);[\s\S]*?setTiktokMvpProofLinksSaveReceipt\(null\);[\s\S]*?setTiktokMvpFastPathOwnershipConfirmed\(false\);/);
  assert.match(page, /tiktokMvpProofHandoffJsonStarterText/);
  assert.match(page, /tiktokMvpProofHandoff\?\.jsonStarter/);
  assert.match(page, /JSON\.stringify\(tiktokMvpProofHandoff\.jsonStarter, null, 2\)/);
  assert.match(page, /Load JSON starter/);
  assert.match(page, /tiktokMvpProofDropKit\.proofLinksStarterText/);
  assert.match(page, /clippers-tiktok-mvp-proof-doctor-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-refresh-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblocker-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblocker-fixes/);
  assert.match(page, /clippers-tiktok-mvp-proof-handoff-panel/);
  assert.match(page, /nextSafeButton\?: "preview_proof_links"/);
  assert.match(page, /safe: \{tiktokMvpProofHandoff\.nextSafeButton \|\| tiktokMvpProofHandoff\.nextButton\}/);
  assert.match(page, /locked: \{tiktokMvpProofHandoff\.nextLockedButton\}/);
  assert.doesNotMatch(page, /next: \{tiktokMvpProofHandoff\.nextButton\}/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblock-board/);
  assert.match(page, /clippers-tiktok-mvp-proof-fast-path-rows/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblock-board-rows/);
  assert.match(page, /unblockBoard\.impact\.metricool100SourceReadyBatches/);
  assert.match(page, /paths\.unblockBoardCsv/);
  assert.match(page, /paths\.oneScreenTxt/);
  assert.match(page, /One-screen guide/);
  assert.match(page, /paths\.fastPathPastePacketTxt/);
  assert.match(page, /2-proof packet/);
  assert.match(page, /clippers-tiktok-mvp-proof-handoff-gates/);
  assert.match(page, /clippers-tiktok-mvp-proof-handoff-collection-packets/);
  assert.match(page, /paths\.pastePacketTxt/);
  assert.match(page, /paths\.jsonStarter/);
  assert.match(page, /JSON starter/);
  assert.match(page, /clippers-tiktok-mvp-local-verification-panel/);
  assert.match(page, /clippers-tiktok-mvp-local-verification-commands/);
  assert.match(page, /proofState\.quickFillCurrent/);
  assert.match(page, /proofState\.proofRefreshFresh/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-refresh"\], data\.tiktokMvpProofRefresh/);
  assert.doesNotMatch(page, /tiktokMvpProofQuickFillGeneratedMs >= tiktokMvpProofRefreshGeneratedMs/);
  assert.match(page, /clippers-tiktok-mvp-closeout-wizard-panel/);
  assert.match(page, /clippers-tiktok-mvp-closeout-wizard-steps/);
  assert.match(page, /clippers-tiktok-mvp-closeout-proof-gate/);
  assert.match(page, /clippers-tiktok-mvp-operator-session/);
  assert.match(page, /run-clippers-tiktok-mvp-operator-recommended-button/);
  assert.match(page, /runTikTokMvpOperatorButton/);
  assert.match(page, /postImportApplyError/);
  assert.match(page, /postCloseoutApplyError/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-closeout-wizard"\], data\.tiktokMvpCloseoutWizard/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-handoff"\], data\.tiktokMvpProofHandoff/);
  assert.match(page, /\["\/api\/clippers\/metricool-mcp-preflight"\], data\.metricoolMcpPreflight/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-upload-pack"\], data\.metricoolCurrentBatchUploadPack/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-session-packet"\], data\.metricoolCurrentBatchSessionPacket/);
  assert.match(page, /getTikTokMvpOperatorButtonLabel/);
  assert.match(page, /case "import_preview"/);
  assert.match(page, /case "closeout_preview"/);
  assert.match(page, /case "local_verification"/);
  assert.match(page, /case "prepare_tiktok_mvp_proof_doctor"/);
  assert.match(page, /case "apply_tiktok_mvp_evidence_closeout"/);
  assert.match(page, /activeTikTokMvpOperatorButton === "apply_closeout_with_confirmation"/);
  assert.doesNotMatch(operatorButtonHelper, /tiktokMvpEvidenceCloseoutApplyMutation\.mutate/);
  assert.match(operatorButtonHelper, /case "apply_tiktok_mvp_evidence_closeout":[\s\S]*tiktokMvpEvidenceCloseoutPreviewMutation\.mutate\(\)/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-save-next-action/);
  assert.match(page, /run-clippers-tiktok-mvp-proof-links-save-next-button/);
  assert.match(page, /tiktokMvpProofLinksReceiptNextAllowed/);
  assert.match(page, /Closeout apply still requires the separate explicit apply review gate/);
  assert.match(page, /clippers-tiktok-mvp-proof-quick-fill-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-quick-fill-textarea/);
  assert.match(page, /stale_applied_result/);
  assert.match(page, /tiktokMvpProofQuickFillCurrent/);
  assert.match(page, /tiktokMvpProofQuickFillIssuesValid/);
  assert.match(page, /Quick fill report is malformed/);
  assert.match(page, /older than or no longer matches the current Proof refresh/);
  assert.match(page, /applied current/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-import-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-import-fix-queue/);
  assert.match(page, /clippers-tiktok-mvp-proof-fix-queue/);
  assert.match(page, /fixQueueCsv/);
  assert.match(page, /tiktokMvpProofDropKitMutation\.isPending/);
  assert.match(page, /tiktokMvpProofLinksPreviewMutation\.isPending/);
  assert.match(page, /tiktokMvpProofLinksSaveMutation\.isPending/);
  assert.match(page, /\["\/api\/clippers\/metricool-bridge-evidence-csv-status"\], data\.metricoolBridgeEvidenceCsvStatus/);
  assert.match(page, /tiktokMvpProofHandoffMutation\.isPending/);
  assert.match(page, /tiktokMvpProofRefreshMutation\.isPending/);
  assert.match(page, /tiktokMvpProofUnblockerMutation\.isPending/);
  assert.match(page, /tiktokMvpLocalVerificationMutation\.isPending/);
  assert.match(page, /tiktokMvpCloseoutWizardMutation\.isPending/);
  assert.match(page, /tiktokMvpProofQuickFillMutation\.isPending/);
  assert.match(page, /const tiktokMvpCloseoutApplyAllowed = tiktokMvpEvidenceCloseout\?\.status === "ready_to_apply"\s+&& tiktokMvpCloseoutWizard\?\.status === "ready_for_operator_apply_review"/);
  assert.match(page, /disabled=\{tiktokProofFlowBusy \|\| isLoading \|\| !tiktokMvpCloseoutApplyAllowed\}/);
  const closeoutPanel = requiredSlice(
    page,
    'data-testid="clippers-tiktok-mvp-evidence-closeout-panel"',
    'data-testid="clippers-metricool-bridge-required-fields"',
  );
  assert.match(closeoutPanel, /This does not publish/);
  assert.match(closeoutPanel, /only copies validated proof rows into local target CSVs/);
  assert.match(closeoutPanel, /does not post, schedule, or enable real publishing/);
  assert.match(closeoutPanel, /Account CSV/);
  assert.match(closeoutPanel, /Bridge CSV/);
  assert.doesNotMatch(closeoutPanel, /ready to publish/i);
});

test("TikTok MVP proof intake pack generates safe templates without enabling publishing", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-intake-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "needs_real_tiktok_metricool_proof");
  assert.match(output.htmlPath, /proof-intake-pack\.html$/);

  const source = await readFile(proofIntakePath, "utf8");
  assert.doesNotMatch(source, /ready_to_send|video\.publish|directSocialApisRequired:\s*true/);
  assert.match(source, /This pack does not publish, schedule, or enable direct social APIs/);

  const pack = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-pack.json"), "utf8"));
  assert.equal(pack.launchMode, "metricool_approval_required");
  assert.equal(pack.directSocialApisRequired, false);
  assert.equal(pack.totals.lanes, 2);
  assert.equal(pack.paths.targetAccountCsv.endsWith("account-permission-mvp-account-evidence.csv"), true);
  assert.equal(pack.paths.targetBridgeCsv.endsWith("scheduled/metricool-tiktok-bridge-evidence.csv"), true);
  assert.ok(pack.lanes.every((lane) => lane.evidenceQuality));
  assert.equal(pack.driveEvidenceChecklist.length, 2);
  assert.ok(pack.driveEvidenceChecklist.every((item) => item.metricoolProofMustShow.some((text) => text.includes("connected TikTok profile"))));
  assert.ok(pack.driveEvidenceChecklist.every((item) => item.redact.includes("tokens")));
  assert.ok(pack.lanes.some((lane) =>
    lane.accountId === "sports-daily"
    && lane.evidenceQuality.issues.some((issue) => issue.includes("accountProofUrl"))
  ));

  const accountTemplate = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/account-evidence-template.csv"), "utf8");
  const bridgeTemplate = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/metricool-bridge-evidence-template.csv"), "utf8");
  const markdown = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-pack.md"), "utf8");
  const html = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-pack.html"), "utf8");
  assert.match(accountTemplate, /sports-daily","tiktok","submitted"/);
  assert.match(accountTemplate, /meme-radar","tiktok","submitted"/);
  assert.match(accountTemplate, /<paste real public ownership proof URL for @sportsdaily; change status to verified only after proof is real and reviewed>/);
  assert.match(accountTemplate, /<paste real public ownership proof URL for @memeradar; change status to verified only after proof is real and reviewed>/);
  assert.doesNotMatch(accountTemplate, /"verified".*<paste real public ownership proof URL/);
  assert.match(bridgeTemplate, /https:\/\/www\.tiktok\.com\/@sportsdaily/);
  assert.match(bridgeTemplate, /<paste real public Metricool proof URL or Drive\/Docs evidence URL for memes @memeradar>/);
  assert.match(markdown, /Evidence quality:/);
  assert.match(markdown, /Current blocker: .*accountProofUrl/);
  assert.match(markdown, /Drive\/Docs Evidence Checklist/);
  assert.match(markdown, /connected TikTok profile @sportsdaily/);
  assert.match(html, /Evidence quality:/);
  assert.match(html, /accountProofUrl/);
  assert.match(html, /Drive\/Docs Evidence Checklist/);
  assert.match(html, /sports-daily-metricool-tiktok-connected-proof/);
  assert.doesNotMatch(`${accountTemplate}\n${bridgeTemplate}\n${markdown}\n${html}`, /access_token=|refresh_token=|client_secret=|cookie=|bearer\s+[a-z0-9._-]+|password=/i);
  assert.match(html, /This guide does not publish or schedule posts/);
});

test("TikTok MVP proof intake import blocks placeholder combined rows without writing targets", async () => {
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(combinedProofCsvPath, [
      combinedHeader,
      "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,<paste real public ownership proof URL>,<paste real public Metricool proof URL>,Replace ownership proof later,Replace Metricool proof later,,",
      "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://example.com/not-real,https://example.com/not-metricool,ok,ok,,",
    ].join("\n") + "\n");

    const result = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-intake-import.mjs",
      "--combined-csv",
      combinedProofCsvPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_intake");
    assert.equal(output.applied, false);

    const source = await readFile(proofImportPath, "utf8");
    assert.doesNotMatch(source, /ready_to_send|video\.publish|directSocialApisRequired:\s*true/);
    assert.match(source, /Metricool remains approval_required/);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-import.json"), "utf8"));
    assert.equal(report.launchMode, "metricool_approval_required");
    assert.equal(report.directSocialApisRequired, false);
    assert.equal(report.applied, false);
    assert.ok(report.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.column === "account_ownership_proof_url"));
    assert.ok(report.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.column === "metricool_connection_proof_url"));
    assert.match(report.paths.fixQueueCsv, /proof-intake-import-fix-queue\.csv$/);
    assert.match(report.nextStep, /do not apply/i);
    const fixQueueCsv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-import-fix-queue.csv"), "utf8");
    assert.match(fixQueueCsv, /account_ownership_proof_url/);
    assert.match(fixQueueCsv, /metricool_connection_proof_url/);
    assert.doesNotMatch(fixQueueCsv, /access_token=|refresh_token=|client_secret=|cookie=|password=/i);
  } finally {
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof intake import blocks mismatched combined identity fields", async () => {
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(combinedProofCsvPath, [
      combinedHeader,
      "sports-daily,Sports Daily Clips,tiktok,@someoneelse,WRONG,https://www.tiktok.com/@someoneelse,https://drive.google.com/file/d/sports-daily-tiktok-proof/view,https://app.metricool.com/planner/sports-daily-tiktok-proof,Sports Daily TikTok account ownership and 2FA security proof verified by Robert without secrets,SPORT TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
      "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,https://app.metricool.com/planner/meme-radar-tiktok-proof,Meme Radar TikTok account ownership and 2FA security proof verified by Robert without secrets,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
    ].join("\n") + "\n");

    const result = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-intake-import.mjs",
      "--combined-csv",
      combinedProofCsvPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_intake");
    assert.ok(output.intakeErrors >= 3);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-import.json"), "utf8"));
    assert.match(report.intakeErrors.join("\n"), /handle must be @sportsdaily/);
    assert.match(report.intakeErrors.join("\n"), /metricool_brand_name must be SPORT/);
    assert.match(report.intakeErrors.join("\n"), /public_profile_url must be https:\/\/www\.tiktok\.com\/@sportsdaily/);
    assert.ok(report.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.column === "handle"));
    assert.ok(report.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.column === "metricool_brand_name"));
    assert.ok(report.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.column === "public_profile_url"));
  } finally {
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof intake import previews and applies clean combined proof CSVs only to target CSVs", async () => {
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(combinedProofCsvPath, cleanCombinedCsv());

    const preview = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-intake-import.mjs",
      "--combined-csv",
      combinedProofCsvPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const previewOutput = JSON.parse(preview.stdout);
    assert.equal(previewOutput.status, "ready_to_apply");
    assert.equal(previewOutput.applied, false);
    assert.equal(previewOutput.ready, 2);
    const restoredCloseout = JSON.parse(await readFile(closeoutReportPath, "utf8"));
    assert.notEqual(restoredCloseout.status, "ready_to_apply");
    assert.equal(restoredCloseout.accountCsvPath, targetAccountCsvPath);

    const apply = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-intake-import.mjs",
      "--combined-csv",
      combinedProofCsvPath,
      "--apply",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const applyOutput = JSON.parse(apply.stdout);
    assert.equal(applyOutput.status, "applied");
    assert.equal(applyOutput.applied, true);

    const accountTarget = await readFile(targetAccountCsvPath, "utf8");
    const bridgeTarget = await readFile(targetBridgeCsvPath, "utf8");
    assert.match(accountTarget, /sports-daily/);
    assert.match(bridgeTarget, /https:\/\/app\.metricool\.com\/planner\/meme-radar-tiktok-proof/);
    assert.doesNotMatch(`${accountTarget}\n${bridgeTarget}`, /<paste|example\.com|access_token=|refresh_token=|client_secret=|cookie=|password=/i);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-import.json"), "utf8"));
    assert.equal(report.status, "applied");
    assert.equal(report.fixQueue.length, 0);
    assert.match(report.nextStep, /evidence closeout apply/i);
  } finally {
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof intake import apply preserves the default combined proof sheet", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, cleanCombinedCsv());

    const apply = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-intake-import.mjs",
      "--apply",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const output = JSON.parse(apply.stdout);
    assert.equal(output.status, "applied");

    const combinedAfter = await readFile(defaultCombinedProofCsvPath, "utf8");
    assert.match(combinedAfter, /https:\/\/app\.metricool\.com\/planner\/sports-daily-tiktok-proof/);
    assert.doesNotMatch(combinedAfter, /<paste real public Metricool proof URL/);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof doctor diagnoses target CSV blockers without applying evidence", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "needs_proof_fix");
  assert.equal(output.ready, 0);
  assert.equal(output.fixQueue, 4);
  assert.match(output.markdownPath, /proof-doctor\.md$/);
  assert.match(output.fixQueuePath, /proof-fix-queue\.csv$/);

  const source = await readFile(proofDoctorPath, "utf8");
  assert.doesNotMatch(source, /--apply|ready_to_send|video\.publish|directSocialApisRequired:\s*true/);
  assert.match(source, /Doctor runs preview only; it never applies evidence/);

  const doctor = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-doctor.json"), "utf8"));
  assert.equal(doctor.launchMode, "metricool_approval_required");
  assert.equal(doctor.directSocialApisRequired, false);
  assert.equal(doctor.totals.lanes, 2);
  assert.equal(doctor.totals.blocked, 2);
  assert.equal(doctor.totals.fixQueue, 4);
  assert.match(doctor.paths.fixQueueCsv, /proof-fix-queue\.csv$/);
  assert.match(doctor.paths.proofLinksFilledDrop, /proof-links-paste-packet-filled\.txt$/);
  assert.match(doctor.paths.proofLinksJsonDrop, /proof-links\.json$/);
  assert.match(doctor.paths.metricoolBridgePreviewGate, /metricool-bridge-preview-gate\.json$/);
  assert.equal(doctor.recommendedProofFlow.title, "TikTok Metricool proof-links bridge");
  assert.ok(doctor.recommendedProofFlow.steps.some((step) => step.includes("Safe ingest drop")));
  assert.ok(doctor.recommendedProofFlow.steps.some((step) => step.includes("Preview bridge rows")));
  assert.ok(doctor.requiredProofLinks.some((item) => item.key === "sports-daily:tiktok.metricoolConnectionProofUrl"));
  assert.ok(doctor.requiredProofLinks.some((item) => item.key === "meme-radar:tiktok.accountOwnershipProofUrl"));
  assert.match(doctor.nextStep, /proof links drop with two real Metricool\/Drive proof URLs/);
  assert.ok(doctor.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.source === "bridge" && row.requiredValue.includes("metricool.com")));
  assert.ok(doctor.lanes.every((lane) => lane.nextAction && lane.status === "blocked"));
  assert.doesNotMatch(JSON.stringify(doctor), /access_token=|refresh_token=|client_secret=|cookie=|bearer\s+[a-z0-9._-]+|password=/i);

  const fixQueueCsv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-fix-queue.csv"), "utf8");
  assert.match(fixQueueCsv, /sports-daily:tiktok/);
  assert.match(fixQueueCsv, /real HTTPS metricool.com proof URL or Google Drive\/Docs evidence URL/);
  assert.doesNotMatch(fixQueueCsv, /ready_to_send|video\.publish|access_token=|refresh_token=|client_secret=/i);
});

test("TikTok MVP proof refresh runs import and doctor sequentially without applying", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await mkdir(path.dirname(targetAccountCsvPath), { recursive: true });
    await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, [
      combinedHeader,
      "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,<paste real public ownership proof URL>,<paste real public Metricool proof URL>,Replace ownership proof later,Replace Metricool proof later,,",
      "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://example.com/not-real,https://example.com/not-metricool,ok,ok,,",
    ].join("\n") + "\n");
    await writeFile(targetAccountCsvPath, [
      accountHeader,
      "account,sports-daily,tiktok,submitted,,,,,https://www.tiktok.com/signup,,<paste proof>,Replace with real ownership/security proof",
      "account,meme-radar,tiktok,submitted,,,,,https://www.tiktok.com/signup,,https://example.com/not-real,ok",
    ].join("\n") + "\n");
    await writeFile(targetBridgeCsvPath, [
      bridgeHeader,
      "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@sportsdaily,<paste real public Metricool proof URL>,Replace this placeholder later",
      "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://example.com/not-metricool,ok",
    ].join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-refresh.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.importStatus, "blocked_invalid_intake");
    assert.equal(output.doctorStatus, "needs_proof_fix");
    assert.equal(output.readyLanes, 0);
    assert.equal(output.importFixQueue, 4);
    assert.equal(output.doctorFixQueue, 4);
    assert.ok(output.blockers.includes("import_status_blocked_invalid_intake"));
    assert.ok(output.blockers.includes("doctor_status_needs_proof_fix"));
    assert.match(output.reportJsonPath, /proof-refresh\.json$/);

    const source = await readFile(proofRefreshPath, "utf8");
    assert.doesNotMatch(source, /--apply|ready_to_send|video\.publish|directSocialApisRequired:\s*true|runClipperTikTokMvpEvidenceCloseout\(true\)/);
    assert.match(source, /Metricool remains approval_required/);
    assert.match(source, /const status = blockers\.length === 0 \? "ready_to_apply" : "blocked"/);
    assert.match(source, /explicit TikTok MVP closeout apply review gate/);
    assert.doesNotMatch(source, /run the guarded TikTok MVP evidence closeout apply/);

    const proofDoctorSource = await readFile(path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-doctor.mjs"), "utf8");
    assert.match(proofDoctorSource, /explicit TikTok MVP closeout apply review gate/);
    assert.doesNotMatch(proofDoctorSource, /Run TikTok MVP evidence closeout apply only/);
    const proofImportSource = await readFile(path.join(process.cwd(), "script/clippers-tiktok-mvp-proof-intake-import.mjs"), "utf8");
    assert.match(proofImportSource, /explicit apply review gate/);
    assert.doesNotMatch(proofImportSource, /Run TikTok MVP evidence closeout apply only/);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-refresh.json"), "utf8"));
    assert.equal(report.launchMode, "metricool_approval_required");
    assert.equal(report.directSocialApisRequired, false);
    assert.equal(report.readyChecks.importReady, false);
    assert.equal(report.readyChecks.doctorReady, false);
    assert.ok(report.blockers.includes("import_fix_queue_4"));
    assert.match(report.guardrails.join("\n"), /does not apply evidence, publish, schedule/);
    assert.match(report.paths.importFixQueueCsv, /proof-intake-import-fix-queue\.csv$/);
    assert.match(report.paths.doctorFixQueueCsv, /proof-fix-queue\.csv$/);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-refresh.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof refresh stays blocked when import preview has fixes even if target proof rows are ready", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await mkdir(path.dirname(targetAccountCsvPath), { recursive: true });
    await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, [
      combinedHeader,
      "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,<paste real public ownership proof URL>,<paste real public Metricool proof URL>,Replace ownership proof later,Replace Metricool proof later,,",
      "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,https://app.metricool.com/planner/meme-radar-tiktok-proof,Meme Radar TikTok account ownership and 2FA security proof verified by Robert without secrets,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
    ].join("\n") + "\n");
    await writeFile(targetAccountCsvPath, cleanAccountCsv());
    await writeFile(targetBridgeCsvPath, cleanBridgeCsv());

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-refresh.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);

    assert.equal(output.status, "blocked");
    assert.equal(output.importStatus, "blocked_invalid_intake");
    assert.equal(output.doctorStatus, "ready_to_apply");
    assert.equal(output.readyLanes, 2);
    assert.ok(output.importFixQueue > 0);
    assert.equal(output.doctorFixQueue, 0);
    assert.ok(output.blockers.includes("import_status_blocked_invalid_intake"));
    assert.ok(output.blockers.some((item) => /^import_fix_queue_/.test(item)));
    assert.ok(!output.blockers.includes("doctor_status_ready_to_apply"));

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-refresh.json"), "utf8"));
    assert.equal(report.readyChecks.doctorReady, true);
    assert.equal(report.readyChecks.lanesReady, true);
    assert.equal(report.readyChecks.importReady, false);
    assert.equal(report.readyChecks.noImportFixes, false);
    assert.match(report.nextStep, /Fix the combined proof intake rows/);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-refresh.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof refresh points to proof doctor when import is clean but target proof rows are blocked", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await mkdir(path.dirname(targetAccountCsvPath), { recursive: true });
    await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, cleanCombinedCsv());
    await writeFile(targetAccountCsvPath, [
      accountHeader,
      "account,sports-daily,tiktok,submitted,,,,,https://www.tiktok.com/signup,,<paste proof>,Replace with real ownership/security proof",
      "account,meme-radar,tiktok,submitted,,,,,https://www.tiktok.com/signup,,https://example.com/not-real,ok",
    ].join("\n") + "\n");
    await writeFile(targetBridgeCsvPath, [
      bridgeHeader,
      "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@sportsdaily,<paste real public Metricool proof URL>,Replace this placeholder later",
      "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://example.com/not-metricool,ok",
    ].join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-refresh.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);

    assert.equal(output.status, "blocked");
    assert.equal(output.importStatus, "ready_to_apply");
    assert.equal(output.doctorStatus, "needs_proof_fix");
    assert.equal(output.importFixQueue, 0);
    assert.equal(output.doctorFixQueue, 4);
    assert.ok(output.blockers.includes("doctor_status_needs_proof_fix"));
    assert.ok(output.blockers.includes("doctor_fix_queue_4"));
    assert.ok(!output.blockers.includes("import_status_ready_to_apply"));

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-refresh.json"), "utf8"));
    assert.equal(report.readyChecks.importReady, true);
    assert.equal(report.readyChecks.noImportFixes, true);
    assert.equal(report.readyChecks.doctorReady, false);
    assert.match(report.nextStep, /proof doctor fix queue/);
    assert.doesNotMatch(report.nextStep, /combined proof intake rows/);

    const source = await readFile(proofRefreshPath, "utf8");
    assert.match(source, /function nextStepForRefresh/);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-refresh.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof unblocker consolidates open proof fixes without applying", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousAccount = await readFile(targetAccountCsvPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await mkdir(path.dirname(targetAccountCsvPath), { recursive: true });
    await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, [
      combinedHeader,
      "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,<paste real public ownership proof URL>,<paste real public Metricool proof URL>,Replace ownership proof later,Replace Metricool proof later,,",
      "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://example.com/not-real,https://example.com/not-metricool,ok,ok,,",
    ].join("\n") + "\n");
    await writeFile(targetAccountCsvPath, [
      accountHeader,
      "account,sports-daily,tiktok,submitted,,,,,https://www.tiktok.com/signup,,<paste proof>,Replace with real ownership/security proof",
      "account,meme-radar,tiktok,submitted,,,,,https://www.tiktok.com/signup,,https://example.com/not-real,ok",
    ].join("\n") + "\n");
    await writeFile(targetBridgeCsvPath, [
      bridgeHeader,
      "sports-daily,tiktok,SPORT,,https://www.tiktok.com/@sportsdaily,<paste real public Metricool proof URL>,Replace this placeholder later",
      "meme-radar,tiktok,memes,,https://www.tiktok.com/@memeradar,https://example.com/not-metricool,ok",
    ].join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-unblocker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_needs_real_proof");
    assert.equal(output.readyLanes, 0);
    assert.equal(output.openFixes, 4);
    assert.match(output.csvPath, /proof-unblocker\.csv$/);
    assert.match(output.htmlPath, /proof-unblocker\.html$/);

    const source = await readFile(proofUnblockerPath, "utf8");
    assert.doesNotMatch(source, /--apply|ready_to_send|video\.publish|directSocialApisRequired:\s*true|runClipperTikTokMvpEvidenceCloseout\(true\)/);
    assert.match(source, /Metricool remains approval_required/);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-unblocker.json"), "utf8"));
    assert.equal(report.launchMode, "metricool_approval_required");
    assert.equal(report.directSocialApisRequired, false);
    assert.equal(report.totals.openFixes, 4);
    assert.ok(report.fixes.some((row) => row.lane === "sports-daily:tiktok" && row.field === "account_ownership_proof_url"));
    assert.ok(report.fixes.some((row) => row.lane === "meme-radar:tiktok" && row.field === "metricool_connection_proof_url"));
    assert.match(report.guardrails.join("\n"), /does not apply evidence, publish, schedule/);
    const csv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-unblocker.csv"), "utf8");
    assert.match(csv, /sports-daily:tiktok/);
    assert.match(csv, /metricool_connection_proof_url/);
    assert.doesNotMatch(csv, /access_token=|refresh_token=|client_secret=|cookie=|password=/i);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousAccount === null) await unlink(targetAccountCsvPath).catch(() => undefined);
    else await writeFile(targetAccountCsvPath, previousAccount);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-unblocker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof quick fill rejects placeholders without writing combined intake", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousInput = await readFile(quickFillInputPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, cleanCombinedCsv());
    await writeFile(targetBridgeCsvPath, cleanBridgeCsv());
    const before = await readFile(defaultCombinedProofCsvPath, "utf8");
    const bridgeBefore = await readFile(targetBridgeCsvPath, "utf8");
    await writeFile(quickFillInputPath, JSON.stringify({
      lanes: {
        "sports-daily:tiktok": {
          accountOwnershipProofUrl: "<paste real public ownership proof URL>",
          metricoolConnectionProofUrl: "<paste real public Metricool proof URL>",
          accountNotes: "Replace ownership proof later",
          metricoolNotes: "Replace Metricool proof later",
        },
        "meme-radar:tiktok": {
          accountOwnershipProofUrl: "https://example.com/not-real",
          metricoolConnectionProofUrl: "https://example.com/not-metricool",
          accountNotes: "ok",
          metricoolNotes: "ok",
        },
      },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-quick-fill.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_quick_fill");
    assert.equal(output.appliedToIntake, false);
    assert.ok(output.issues >= 4);

    const after = await readFile(defaultCombinedProofCsvPath, "utf8");
    assert.equal(after, before);
    const bridgeAfter = await readFile(targetBridgeCsvPath, "utf8");
    assert.equal(bridgeAfter, bridgeBefore);
    const source = await readFile(proofQuickFillPath, "utf8");
    assert.match(source, /unsafeProofQueryParamPattern/);
    assert.match(source, /x-amz-signature/);
    assert.match(source, /validMetricoolReuseConfirmationNotes/);
    assert.match(source, /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/);
    assert.doesNotMatch(source, /ready_to_send|video\.publish|directSocialApisRequired:\s*true|runClipperTikTokMvpEvidenceCloseout\(true\)/);
    assert.match(source, /does not apply final evidence, publish, schedule/);

    await writeFile(quickFillInputPath, JSON.stringify({
      lanes: {
        "sports-daily:tiktok": {
          accountOwnershipProofUrl: "https://drive.google.com/folderview?id=sports-daily-tiktok-proof-folder&utm_source=copy#ownership",
          metricoolConnectionProofUrl: "https://drive.google.com/drive/u/0/folders/sports-daily-tiktok-proof-folder?usp=sharing",
          accountNotes: "Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
          metricoolNotes: "SPORT TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
        },
        "meme-radar:tiktok": {
          accountOwnershipProofUrl: "https://docs.google.com/spreadsheets/d/meme-radar-metricool-connected-proof/edit/?usp=sharing#ownership",
          metricoolConnectionProofUrl: "https://docs.google.com/spreadsheets/d/meme-radar-metricool-connected-proof/preview",
          accountNotes: "Meme Radar ownership proof confirmed by Robert without secrets.",
          metricoolNotes: "memes TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
        },
      },
    }, null, 2));
    const sameProofResult = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-quick-fill.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(sameProofResult.status, 0, sameProofResult.stderr || sameProofResult.stdout);
    const sameProofOutput = JSON.parse(sameProofResult.stdout);
    assert.equal(sameProofOutput.status, "blocked_invalid_quick_fill");
    assert.equal(sameProofOutput.appliedToIntake, false);
    const sameProofAfter = await readFile(defaultCombinedProofCsvPath, "utf8");
    assert.equal(sameProofAfter, before);
    const sameProofBridgeAfter = await readFile(targetBridgeCsvPath, "utf8");
    assert.equal(sameProofBridgeAfter, bridgeBefore);
    const sameProofReport = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-quick-fill.json"), "utf8"));
    assert.match(sameProofReport.issues.join("\n"), /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/);

    await writeFile(quickFillInputPath, JSON.stringify({
      lanes: {
        "sports-daily:tiktok": {
          accountOwnershipProofUrl: "https://viewer:secret@drive.google.com/file/d/sports-daily-tiktok-proof/view",
          metricoolConnectionProofUrl: "https://app.metricool.com/planner/sports-daily-tiktok-proof",
          accountNotes: "Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
          metricoolNotes: "SPORT TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
        },
        "meme-radar:tiktok": {
          accountOwnershipProofUrl: "https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
          metricoolConnectionProofUrl: "https://viewer:secret@docs.google.com/document/d/meme-radar-metricool-proof/edit",
          accountNotes: "Meme Radar TikTok ownership and 2FA security proof verified by Robert without secrets.",
          metricoolNotes: "memes TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
        },
      },
    }, null, 2));
    const credentialResult = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-quick-fill.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(credentialResult.status, 0, credentialResult.stderr || credentialResult.stdout);
    const credentialOutput = JSON.parse(credentialResult.stdout);
    assert.equal(credentialOutput.status, "blocked_invalid_quick_fill");
    assert.equal(credentialOutput.appliedToIntake, false);
    const credentialAfter = await readFile(defaultCombinedProofCsvPath, "utf8");
    assert.equal(credentialAfter, before);
    const credentialBridgeAfter = await readFile(targetBridgeCsvPath, "utf8");
    assert.equal(credentialBridgeAfter, bridgeBefore);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousInput === null) await unlink(quickFillInputPath).catch(() => undefined);
    else await writeFile(quickFillInputPath, previousInput);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-unblocker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof quick fill writes clean proof to combined intake and bridge CSV", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousInput = await readFile(quickFillInputPath, "utf8").catch(() => null);
  const previousBridge = await readFile(targetBridgeCsvPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, [
      combinedHeader,
      "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,<paste real public ownership proof URL>,<paste real public Metricool proof URL>,Replace ownership proof later,Replace Metricool proof later,,",
      "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,<paste real public ownership proof URL>,<paste real public Metricool proof URL>,Replace ownership proof later,Replace Metricool proof later,,",
    ].join("\n") + "\n");
    await writeFile(quickFillInputPath, JSON.stringify({
      lanes: {
        "sports-daily:tiktok": {
          accountOwnershipProofUrl: "https://drive.google.com/file/d/sports-daily-tiktok-proof/view",
          metricoolConnectionProofUrl: "https://app.metricool.com/planner/sports-daily-tiktok-proof",
          accountNotes: "Sports Daily TikTok ownership and 2FA proof reviewed by Robert without secrets.",
          metricoolNotes: "SPORT TikTok profile is connected in Metricool approval_required mode without secrets.",
        },
        "meme-radar:tiktok": {
          accountOwnershipProofUrl: "https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
          metricoolConnectionProofUrl: "https://app.metricool.com/planner/meme-radar-tiktok-proof",
          accountNotes: "Meme Radar TikTok ownership and 2FA proof reviewed by Robert without secrets.",
          metricoolNotes: "memes TikTok profile is connected in Metricool approval_required mode without secrets.",
        },
      },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-quick-fill.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "applied_to_combined_intake");
    assert.equal(output.appliedToIntake, true);
    assert.equal(output.issues, 0);

    const combined = await readFile(defaultCombinedProofCsvPath, "utf8");
    assert.match(combined, /https:\/\/drive\.google\.com\/file\/d\/sports-daily-tiktok-proof\/view/);
    assert.match(combined, /https:\/\/app\.metricool\.com\/planner\/meme-radar-tiktok-proof/);
    assert.doesNotMatch(combined, /<paste|example\.com|access_token=|refresh_token=|client_secret=|cookie=|password=/i);
    const bridge = await readFile(targetBridgeCsvPath, "utf8");
    assert.match(bridge, /^account_id,platform,metricool_brand_name,metricool_blog_id,profile_url,proof,notes/m);
    assert.match(bridge, /"sports-daily","tiktok","SPORT","","https:\/\/www\.tiktok\.com\/@sportsdaily","https:\/\/app\.metricool\.com\/planner\/sports-daily-tiktok-proof"/);
    assert.match(bridge, /"meme-radar","tiktok","memes","","https:\/\/www\.tiktok\.com\/@memeradar","https:\/\/app\.metricool\.com\/planner\/meme-radar-tiktok-proof"/);
    assert.doesNotMatch(bridge, /<paste|example\.com|access_token=|refresh_token=|client_secret=|cookie=|password=/i);
    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-quick-fill.json"), "utf8"));
    assert.equal(report.launchMode, "metricool_approval_required");
    assert.equal(report.directSocialApisRequired, false);
    assert.equal(report.appliedToIntake, true);
    assert.equal(report.paths.metricoolBridgeCsv, targetBridgeCsvPath);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousInput === null) await unlink(quickFillInputPath).catch(() => undefined);
    else await writeFile(quickFillInputPath, previousInput);
    if (previousBridge === null) await unlink(targetBridgeCsvPath).catch(() => undefined);
    else await writeFile(targetBridgeCsvPath, previousBridge);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-unblocker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof doctor creates fix queue for missing account and bridge rows", async () => {
  try {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(accountCsvPath, `${accountHeader}\n`);
    await writeFile(bridgeCsvPath, `${bridgeHeader}\n`);

    const result = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-doctor.mjs",
      "--account-csv",
      accountCsvPath,
      "--bridge-csv",
      bridgeCsvPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "needs_proof_fix");
    assert.equal(output.rejected, 0);
    assert.equal(output.fixQueue, 4);

    const doctor = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-doctor.json"), "utf8"));
    assert.equal(doctor.totals.closeoutRejected, 2);
    assert.equal(doctor.totals.fixQueue, 4);
    assert.ok(doctor.recommendedProofFlow.steps.some((step) => step.includes("Metricool bridge CSV")));
    assert.ok(doctor.fixQueue.some((row) => row.lane === "meme-radar:tiktok" && row.source === "account" && row.reason === "missing accepted account ownership/security proof"));
    assert.ok(doctor.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.source === "bridge" && row.reason === "missing accepted Metricool bridge proof"));
  } finally {
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof doctor ignores stale ready reports when closeout preview fails", async () => {
  const previousReport = await readFile(closeoutReportPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(closeoutReportPath), { recursive: true });
    await writeFile(closeoutReportPath, JSON.stringify({
      status: "ready_to_apply",
      totals: {
        lanes: 2,
        ready: 2,
        rejected: 0,
      },
      rows: [
        {
          accountId: "sports-daily",
          status: "ready",
          reasons: [],
          accountProofStatus: "ready",
          bridgeProofStatus: "ready",
        },
        {
          accountId: "meme-radar",
          status: "ready",
          reasons: [],
          accountProofStatus: "ready",
          bridgeProofStatus: "ready",
        },
      ],
      rejected: [],
    }, null, 2));

    const result = spawnSync(process.execPath, [
      "script/clippers-tiktok-mvp-proof-doctor.mjs",
      "--closeout-script",
      "script/missing-tiktok-closeout-preview.mjs",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "needs_proof_fix");
    assert.equal(output.closeoutStatus, "preview_failed");
    assert.equal(output.ready, 0);
    assert.equal(output.blocked, 2);
    assert.equal(output.fixQueue, 0);

    const doctor = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-doctor.json"), "utf8"));
    assert.equal(doctor.closeoutStatus, "preview_failed");
    assert.deepEqual(doctor.fixQueue, []);
    assert.match(doctor.nextStep, /stale reports are ignored/);
  } finally {
    if (previousReport === null) await unlink(closeoutReportPath).catch(() => undefined);
    else await writeFile(closeoutReportPath, previousReport);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof doctor UI tolerates pre-fix-queue reports", async () => {
  const page = await readFile(clippersPagePath, "utf8");
  assert.match(page, /tiktokMvpProofDoctor\.totals\.fixQueue \?\? tiktokMvpProofDoctor\.fixQueue\?\.length \?\? 0/);
  assert.match(page, /\(tiktokMvpProofDoctor\.fixQueue \?\? \[\]\)\.length > 0/);
  assert.match(page, /\(tiktokMvpProofDoctor\.fixQueue \?\? \[\]\)\.slice\(0, 4\)/);
  assert.match(page, /clippers-tiktok-mvp-required-proof-links/);
  assert.match(page, /clippers-tiktok-mvp-recommended-proof-flow/);
  assert.match(page, /tiktokMvpProofDoctor\.paths\.proofLinksFilledDrop/);
  assert.match(page, /tiktokMvpProofDoctor\.recommendedProofFlow\?\.steps/);
});

test("TikTok MVP local verification is wired as a blocked guardrail check", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["clippers:tiktok-mvp-closeout-wizard"],
    "node script/clippers-tiktok-mvp-closeout-wizard.mjs",
  );
  assert.equal(
    packageJson.scripts["clippers:tiktok-mvp-proof-drop-kit"],
    "node script/clippers-tiktok-mvp-proof-drop-kit.mjs",
  );
  assert.equal(
    packageJson.scripts["clippers:tiktok-mvp-local-verification"],
    "node script/clippers-tiktok-mvp-local-verification.mjs",
  );
  assert.equal(
    packageJson.scripts["clippers:tiktok-mvp-proof-handoff"],
    "node script/clippers-tiktok-mvp-proof-handoff.mjs",
  );

  const result = spawnSync(process.execPath, ["--check", localVerificationPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const source = await readFile(localVerificationPath, "utf8");
  assert.match(source, /npm",\s*args: \["run", "check"\]/);
  assert.match(source, /npm",\s*args: \["run", "build"\]/);
  assert.match(source, /tests\/clippers-tiktok-mvp-evidence-closeout\.test\.mjs/);
  assert.match(source, /--test-name-pattern/);
  assert.match(source, /TikTok MVP local verification\|TikTok MVP proof drop kit prepares local inventory/);
  assert.match(source, /clippers:tiktok-mvp-proof-drop-kit/);
  assert.match(source, /clippers:tiktok-mvp-proof-quick-fill/);
  assert.match(source, /clippers:tiktok-mvp-proof-unblocker/);
  assert.match(source, /clippers:tiktok-mvp-closeout-wizard/);
  assert.match(source, /function isQuickFillCurrentWithProofRefresh/);
  assert.match(source, /quickFill\.appliedToIntake === true/);
  assert.match(source, /const quickFillIssues = Array\.isArray\(quickFill\.issues\) \? quickFill\.issues : null/);
  assert.match(source, /isFreshGeneratedAt\(quickFill\.generatedAt\)/);
  assert.match(source, /isFreshGeneratedAt\(proofRefresh\.generatedAt\)/);
  assert.match(source, /quickFillCurrent/);
  assert.match(source, /businessBlocker/);
  assert.match(source, /blocked_needs_real_metricool_tiktok_proof/);
  assert.match(source, /quickFillIssuesValid/);
  assert.match(source, /proofRefreshFresh/);
  assert.match(source, /proofRefresh\?\.status === "ready_to_apply"/);
  assert.doesNotMatch(source, /quickFillGeneratedAt >= proofRefreshGeneratedAt/);
  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /prepare-tiktok-mvp-local-verification/);
  assert.match(routes, /tiktokMvpProofRefresh: await readClipperTikTokMvpProofRefresh\(\)/);
  assert.match(source, /blocked_before_metricool_approval_review/);
  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /tiktokMvpLocalVerification\.businessBlocker/);
  assert.match(source, /Metricool remains approval_required/);
  assert.match(source, /Published counts remain zero until real public TikTok post evidence is imported/);
});

test("TikTok MVP closeout wizard consolidates gates without applying evidence", async () => {
  const result = spawnSync(process.execPath, ["--check", closeoutWizardPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const source = await readFile(closeoutWizardPath, "utf8");
  assert.match(source, /blocked_needs_operator_evidence/);
  assert.match(source, /ready_for_operator_apply_review/);
  assert.match(source, /Proof drop links/);
  assert.match(source, /Quick fill/);
  assert.match(source, /Import preview/);
  assert.match(source, /Closeout preview/);
  assert.match(source, /Apply closeout remains separately guarded by the operator confirmation header/);
  assert.match(source, /closeout-apply-gate\.csv/);
  assert.match(source, /renderApplyGateCsv/);
  assert.match(source, /buildOperatorSession/);
  assert.match(source, /TikTok MVP operator session/);
  assert.match(source, /proofCollectionPackets/);
  assert.match(source, /Proof packets needed/);
  assert.match(source, /preview_or_save_proof_links/);
  assert.doesNotMatch(source, /--apply/);
  assert.doesNotMatch(source, /runClipperTikTokMvpEvidenceCloseout\(true\)/);
  assert.doesNotMatch(source, /video\.publish/);
  assert.doesNotMatch(source, /realPublishEnabled:\s*true/);
  assert.doesNotMatch(source, /ready_to_send/);
  assert.match(source, /realPublishEnabled:\s*false/);
  assert.match(source, /directSocialApisRequired:\s*false/);
});

test("TikTok MVP closeout wizard writes an apply gate CSV without applying", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-closeout-wizard.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.match(output.applyGateCsvPath, /closeout-apply-gate\.csv$/);
  assert.notEqual(output.status, "ready_to_send");

  const wizard = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/closeout-wizard.json"), "utf8"));
  assert.equal(wizard.operatorSession.status, "blocked_operator_session");
  assert.equal(wizard.operatorSession.nextGateId, "proof_drop_links");
  assert.match(wizard.operatorSession.copyPacket, /Metricool approval_required/);
  assert.match(wizard.operatorSession.copyPacket, /Proof packets needed: 4/);
  assert.match(wizard.operatorSession.copyPacket, /sports-daily-account-ownership/);
  assert.match(wizard.operatorSession.copyPacket, /metricoolConnectionProofUrl/);
  assert.match(wizard.operatorSession.copyPacket, /meme-radar:tiktok/);
  assert.doesNotMatch(wizard.operatorSession.copyPacket, /ready_to_send|realPublishEnabled=true|video\.publish/i);

  const csv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/closeout-apply-gate.csv"), "utf8");
  assert.match(csv, /proof_drop_links/);
  assert.match(csv, /quick_fill/);
  assert.match(csv, /import_preview/);
  assert.match(csv, /closeout_preview/);
  assert.match(csv, /ready_to_apply/);
  assert.doesNotMatch(csv, /realPublishEnabled\s*=\s*true|ready_to_send|video\.publish/i);
});

test("TikTok MVP proof handoff refreshes previews without applying evidence", async () => {
  const result = spawnSync(process.execPath, ["--check", proofHandoffPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const source = await readFile(proofHandoffPath, "utf8");
  assert.match(source, /blocked_needs_proof_links/);
  assert.match(source, /businessBlocker/);
  assert.match(source, /blocked_needs_real_metricool_tiktok_proof/);
  assert.match(source, /blocked_needs_import_preview/);
  assert.match(source, /ready_for_operator_apply_review/);
  assert.match(source, /buildCollectionPackets/);
  assert.match(source, /accountOwnershipProofUrl/);
  assert.match(source, /metricoolConnectionProofUrl/);
  assert.match(source, /proofPacketsNeeded/);
  assert.match(source, /proof-handoff-collection-packets\.csv/);
  assert.match(source, /proof-links-paste-packet\.txt/);
  assert.match(source, /proof-links-fast-path-paste-packet\.txt/);
  assert.match(source, /renderCollectionCsv/);
  assert.match(source, /renderFastPathProofLinksPastePacket/);
  assert.match(source, /Must be a real HTTPS metricool\.com URL/);
  assert.match(source, /signed\/temporary URLs/);
  assert.match(source, /x-amz\/signature\/expires query params/);
  assert.match(source, /script\/clippers-tiktok-mvp-proof-drop-kit\.mjs/);
  assert.match(source, /script\/clippers-tiktok-mvp-proof-intake-import\.mjs/);
  assert.match(source, /script\/clippers-tiktok-mvp-closeout-wizard\.mjs/);
  assert.match(source, /function isQuickFillCurrentWithProofRefresh/);
  assert.match(source, /const quickFillIssues = Array\.isArray\(quickFill\.issues\) \? quickFill\.issues : null/);
  assert.match(source, /isFreshGeneratedAt\(quickFill\.generatedAt\)/);
  assert.match(source, /isFreshGeneratedAt\(proofRefresh\.generatedAt\)/);
  assert.match(source, /currentWithProofRefresh/);
  assert.match(source, /proofRefreshFresh/);
  assert.match(source, /nextSafeButton/);
  assert.match(source, /nextLockedButton/);
  assert.match(source, /preview_proof_links/);
  assert.match(source, /Locked until clean preview/);
  assert.match(source, /Preview links first; save only if the preview gate is clean\/current/);
  assert.match(source, /proof drop or paste packet/);
  assert.doesNotMatch(source, /then save proof links/);
  assert.doesNotMatch(source, /quickFillGeneratedAt >= proofRefreshGeneratedAt/);
  assert.match(source, /Proof handoff never applies evidence, publishes, schedules, or enables direct social APIs/);
  assert.doesNotMatch(source, /--apply/);
  assert.doesNotMatch(source, /runClipperTikTokMvpEvidenceCloseout\(true\)/);
  assert.doesNotMatch(source, /video\.publish/);
  assert.doesNotMatch(source, /realPublishEnabled:\s*true/);
  assert.doesNotMatch(source, /ready_to_send/);
  assert.match(source, /realPublishEnabled:\s*false/);
  assert.match(source, /directSocialApisRequired:\s*false/);
});

test("TikTok MVP proof handoff writes a collection packet CSV", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-handoff.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.businessBlocker, "blocked_needs_real_metricool_tiktok_proof");
  assert.equal(output.nextSafeButton, "preview_proof_links");
  assert.equal(output.nextLockedButton, "save_proof_links");
  assert.match(output.collectionCsvPath, /proof-handoff-collection-packets\.csv$/);
  assert.match(output.pastePacketPath, /proof-links-paste-packet\.txt$/);
  assert.match(output.fastPathPastePacketPath, /proof-links-fast-path-paste-packet\.txt$/);
  assert.match(output.jsonStarterPath, /proof-links-json-starter\.json$/);
  assert.match(output.oneScreenPath, /proof-fill-one-screen\.txt$/);
  assert.equal(output.proofPacketsNeeded, 4);
  assert.equal(output.minimumProofUrlsNeeded, 2);
  assert.equal(output.fastPathAvailable, true);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-handoff.json"), "utf8"));
  assert.equal(report.businessBlocker, "blocked_needs_real_metricool_tiktok_proof");
  assert.equal(report.unblockBoard.status, "blocked_needs_operator_proof");
  assert.equal(report.unblockBoard.missingProofs, 4);
  assert.equal(report.unblockBoard.minimumProofUrlsNeeded, 2);
  assert.equal(report.unblockBoard.fastPathAvailable, true);
  assert.equal(report.totals.minimumProofUrlsNeeded, 2);
  assert.equal(report.totals.fastPathAvailable, true);
  assert.equal(report.nextSafeButton, "preview_proof_links");
  assert.equal(report.nextLockedButton, "save_proof_links");
  assert.match(report.paths.fastPathPastePacketTxt, /proof-links-fast-path-paste-packet\.txt$/);
  assert.match(report.fastPathPastePacketText, /sports-daily:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(report.fastPathPastePacketText, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(report.fastPathPastePacketText, /Preview links first/);
  assert.doesNotMatch(report.fastPathPastePacketText, /ready_to_send|realPublishEnabled=true|video\.publish/i);
  assert.ok([0, 100].includes(report.unblockBoard.impact.metricool100Rows));
  assert.ok([0, 10].includes(report.unblockBoard.impact.metricool100SourceReadyBatches));
  assert.equal(report.unblockBoard.impact.metricool100OperatorReadyBatches, 0);
  assert.ok([0, 10].includes(report.unblockBoard.impact.metricool100BlockedBatches));
  assert.equal(report.unblockBoard.fastPathRows.length, 2);
  assert.match(report.unblockBoard.fastPathRows[0].exactPasteLine, /metricoolConnectionProofUrl=/);
  assert.match(report.unblockBoard.fastPathRows[0].reuseAsOwnershipLine, /accountOwnershipProofUrl=/);
  assert.equal(report.unblockBoard.fastPathRows[0].metricoolBrandName, "SPORT");
  assert.equal(report.unblockBoard.fastPathRows[1].metricoolBrandName, "memes");
  assert.match(report.nextAction, /Preview links first; save only if the preview gate is clean\/current/);
  assert.match(report.nextAction, /proof drop or paste packet/);
  assert.doesNotMatch(report.nextAction, /proof-links\.json, then rerun Proof drop kit|then save proof links/i);
  assert.equal(typeof report.proofState.quickFillCurrent, "boolean");
  assert.equal(typeof report.proofState.proofRefreshFresh, "boolean");
  assert.match(report.gates.find((gate) => gate.id === "quick_fill").detail, /currentWithProofRefresh|malformed/);
  assert.match(report.unblockBoard.rows[0].exactPasteLine, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.doesNotMatch(JSON.stringify(report.unblockBoard), /access_token=|refresh_token=|client_secret=|cookie=|password=|ready_to_send|video\.publish/i);
  assert.match(report.pastePacketText, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.match(report.pastePacketText, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
  const fastPathPacket = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-links-fast-path-paste-packet.txt"), "utf8");
  assert.match(fastPathPacket, /TikTok MVP Metricool fast-path proof packet/);
  assert.match(fastPathPacket, /sports-daily:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(fastPathPacket, /meme-radar:tiktok\.accountOwnershipProofUrl=/);
  assert.doesNotMatch(fastPathPacket, /access_token=|refresh_token=|client_secret=|cookie=|password=|ready_to_send|video\.publish/i);
  assert.match(report.paths.jsonStarter, /proof-links-json-starter\.json$/);
  assert.deepEqual(Object.keys(report.jsonStarter.lanes).sort(), ["meme-radar:tiktok", "sports-daily:tiktok"]);
  for (const lane of Object.values(report.jsonStarter.lanes)) {
    assert.equal(lane.accountOwnershipProofUrl, "");
    assert.equal(lane.metricoolConnectionProofUrl, "");
    assert.match(lane.accountNotes, /ownership|2FA|security/i);
    assert.match(lane.metricoolNotes, /Metricool connection/i);
  }
  assert.match(report.paths.oneScreenTxt, /proof-fill-one-screen\.txt$/);
  assert.doesNotMatch(JSON.stringify(report.jsonStarter), /https:\/\/example\.com|placeholder|ready_to_send|realPublishEnabled=true|video\.publish/i);
  assert.doesNotMatch(report.pastePacketText, /access_token=|refresh_token=|client_secret=|cookie=|password=|ready_to_send|video\.publish/i);

  const csv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-handoff-collection-packets.csv"), "utf8");
  assert.match(csv, /sports-daily-account-ownership/);
  assert.match(csv, /sports-daily-metricool-connection/);
  assert.match(csv, /meme-radar-account-ownership/);
  assert.match(csv, /meme-radar-metricool-connection/);
  assert.match(csv, /Must be a real HTTPS metricool\.com URL/);
  assert.match(csv, /signed\/temporary URLs/);
  assert.match(csv, /x-amz\/signature\/expires query params/);
  assert.doesNotMatch(csv, /access_token=|refresh_token=|client_secret=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+/i);

  const unblockCsv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-unblock-board.csv"), "utf8");
  assert.match(unblockCsv, /exact_paste_line/);
  assert.match(unblockCsv, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.match(unblockCsv, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(unblockCsv, /Metricool bridge evidence preview/);
  assert.doesNotMatch(unblockCsv, /access_token=|refresh_token=|client_secret=|cookie=|password=|ready_to_send|video\.publish/i);

  const pastePacket = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-links-paste-packet.txt"), "utf8");
  assert.match(pastePacket, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.match(pastePacket, /sports-daily:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(pastePacket, /meme-radar:tiktok\.accountOwnershipProofUrl=/);
  assert.match(pastePacket, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(pastePacket, /Fast path: if the Metricool or concrete Drive file\/folder\/Docs proof clearly shows the TikTok profile connected under Robert control/);
  assert.match(pastePacket, /Metricool proof URLs must be https:\/\/\*\.metricool\.com\/\.\.\. or concrete Google Drive file\/folder or Docs evidence URLs/);
  assert.doesNotMatch(pastePacket, /access_token=|refresh_token=|client_secret=|cookie=|password=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|ready_to_send|realPublishEnabled=true|video\.publish/i);

  const jsonStarter = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-links-json-starter.json"), "utf8"));
  assert.deepEqual(jsonStarter, report.jsonStarter);
  assert.deepEqual(Object.keys(jsonStarter.lanes).sort(), ["meme-radar:tiktok", "sports-daily:tiktok"]);
  assert.equal(jsonStarter.lanes["sports-daily:tiktok"].accountOwnershipProofUrl, "");
  assert.equal(jsonStarter.lanes["sports-daily:tiktok"].metricoolConnectionProofUrl, "");
  assert.equal(jsonStarter.lanes["meme-radar:tiktok"].accountOwnershipProofUrl, "");
  assert.equal(jsonStarter.lanes["meme-radar:tiktok"].metricoolConnectionProofUrl, "");
  assert.doesNotMatch(JSON.stringify(jsonStarter), /access_token=|refresh_token=|client_secret=|cookie=|password=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|https:\/\/example\.com|placeholder|ready_to_send|realPublishEnabled=true|video\.publish/i);

  const oneScreen = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-fill-one-screen.txt"), "utf8");
  assert.match(oneScreen, /TikTok MVP proof fill - one screen/);
  assert.match(oneScreen, /Fast path first: paste these 2 real non-secret Metricool URLs or concrete Drive file\/folder\/Docs proof URLs/);
  assert.match(oneScreen, /Expanded fields the app prepares from the fast path/);
  assert.doesNotMatch(oneScreen, /undefined/);
  assert.doesNotMatch(oneScreen, /preview confirms/i);
  assert.match(oneScreen, /Robert\/operator must manually confirm/);
  assert.match(oneScreen, /SPORT connected to @sportsdaily/);
  assert.match(oneScreen, /memes connected to @memeradar/);
  assert.match(oneScreen, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.match(oneScreen, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(oneScreen, /Minimum real proof URLs needed: 2/);
  assert.match(oneScreen, /Fast path: if the Metricool or concrete Drive file\/folder\/Docs proof clearly shows the TikTok profile connected under Robert control/);
  assert.match(oneScreen, /Preview links first; save only if the preview gate is clean\/current/);
  assert.match(oneScreen, /Next safe button: preview_proof_links/);
  assert.match(oneScreen, /Locked until clean preview: save_proof_links/);
  assert.doesNotMatch(oneScreen, /Next safe button: save_proof_links/);
  assert.doesNotMatch(oneScreen, /proof-links\.json, then rerun Proof drop kit|then save proof links/i);
  assert.match(oneScreen, /This file does not apply evidence, schedule posts, publish, or enable direct social APIs/);
  assert.doesNotMatch(oneScreen, /access_token=|refresh_token=|client_secret=|cookie=|password=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|ready_to_send|realPublishEnabled=true|video\.publish/i);
});

test("TikTok MVP proof drop kit prepares local inventory without applying evidence", async () => {
  const syntaxResult = spawnSync(process.execPath, ["--check", proofDropKitPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(syntaxResult.status, 0, syntaxResult.stderr || syntaxResult.stdout);

  const source = await readFile(proofDropKitPath, "utf8");
  assert.match(source, /proof-drop/);
  assert.match(source, /proof-links\.json/);
  assert.match(source, /proof-links-starter\.json/);
  assert.match(source, /blocked_needs_public_proof_links/);
  assert.match(source, /ready_quick_fill_ran/);
  assert.match(source, /metricool\.com/);
  assert.match(source, /unsafeProofQueryParamPattern/);
  assert.match(source, /x-amz-signature/);
  assert.match(source, /URLs with x-amz\/signature\/expires\/session\/token query params are blocked/);
  assert.match(source, /validMetricoolReuseConfirmationNotes/);
  assert.match(source, /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/);
  assert.match(source, /Local files are inventory only; closeout still requires real public\/non-secret HTTPS proof URLs/);
  assert.doesNotMatch(source, /--apply/);
  assert.doesNotMatch(source, /runClipperTikTokMvpEvidenceCloseout\(true\)/);
  assert.doesNotMatch(source, /video\.publish/);
  assert.doesNotMatch(source, /realPublishEnabled:\s*true/);
  assert.doesNotMatch(source, /ready_to_send/);
  assert.match(source, /realPublishEnabled:\s*false/);
  assert.match(source, /directSocialApisRequired:\s*false/);

  const previousProofLinks = await readFile(proofLinksPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(proofLinksPath), { recursive: true });
    await writeFile(proofLinksPath, JSON.stringify({
      lanes: {
        "sports-daily:tiktok": {
          accountOwnershipProofUrl: "",
          metricoolConnectionProofUrl: "",
          accountNotes: "Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
          metricoolNotes: "SPORT Metricool connection to @sportsdaily verified by Robert without secrets.",
        },
        "meme-radar:tiktok": {
          accountOwnershipProofUrl: "",
          metricoolConnectionProofUrl: "",
          accountNotes: "Meme Radar TikTok ownership and 2FA security proof verified by Robert without secrets.",
          metricoolNotes: "memes Metricool connection to @memeradar verified by Robert without secrets.",
        },
      },
    }, null, 2));

    const runResult = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-drop-kit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);
    const output = JSON.parse(runResult.stdout);
    assert.equal(output.status, "blocked_needs_public_proof_links");
    assert.equal(output.readyForQuickFill, false);
    assert.equal(output.quickFillStatus, "not_run");
    assert.match(output.proofLinksStarterPath, /proof-links-starter\.json$/);

    const starter = JSON.parse(await readFile(proofLinksStarterPath, "utf8"));
    assert.deepEqual(Object.keys(starter.lanes).sort(), ["meme-radar:tiktok", "sports-daily:tiktok"]);
    for (const lane of Object.values(starter.lanes)) {
      assert.equal(typeof lane.accountOwnershipProofUrl, "string");
      assert.equal(typeof lane.metricoolConnectionProofUrl, "string");
      assert.equal(typeof lane.accountNotes, "string");
      assert.equal(typeof lane.metricoolNotes, "string");
    }
    assert.doesNotMatch(JSON.stringify(starter), /access_token=|refresh_token=|client_secret=|cookie=|password=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+/i);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-drop-kit.json"), "utf8"));
    assert.equal(report.paths.proofLinksStarterJson, proofLinksStarterPath);
    assert.match(report.proofLinksStarterText, /"sports-daily:tiktok"/);
    assert.match(report.proofLinksStarterText, /"meme-radar:tiktok"/);
    assert.equal(report.quickFillStatus, "not_run");
    assert.equal(report.realPublishEnabled, false);
    assert.equal(report.directSocialApisRequired, false);

    await writeFile(proofLinksPath, JSON.stringify({
      lanes: {
        "sports-daily:tiktok": {
          accountOwnershipProofUrl: "https://drive.google.com/folderview?id=sports-daily-tiktok-proof-folder&utm_source=copy#ownership",
          metricoolConnectionProofUrl: "https://drive.google.com/drive/u/0/folders/sports-daily-tiktok-proof-folder?usp=sharing",
          accountNotes: "Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
          metricoolNotes: "SPORT Metricool connection to @sportsdaily verified by Robert without secrets.",
        },
        "meme-radar:tiktok": {
          accountOwnershipProofUrl: "https://docs.google.com/spreadsheets/d/meme-radar-metricool-connected-proof/edit/?usp=sharing#ownership",
          metricoolConnectionProofUrl: "https://docs.google.com/spreadsheets/d/meme-radar-metricool-connected-proof/preview",
          accountNotes: "Meme Radar ownership proof confirmed by Robert without secrets.",
          metricoolNotes: "memes Metricool connection to @memeradar verified by Robert without secrets.",
        },
      },
    }, null, 2));
    const sameUrlRunResult = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-drop-kit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(sameUrlRunResult.status, 0, sameUrlRunResult.stderr || sameUrlRunResult.stdout);
    const sameUrlOutput = JSON.parse(sameUrlRunResult.stdout);
    assert.equal(sameUrlOutput.status, "blocked_needs_public_proof_links");
    assert.equal(sameUrlOutput.readyForQuickFill, false);
    assert.equal(sameUrlOutput.quickFillStatus, "not_run");
    const sameUrlReport = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-drop-kit.json"), "utf8"));
    assert.match(sameUrlReport.issues.join("\n"), /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/);
  } finally {
    if (previousProofLinks === null) await unlink(proofLinksPath).catch(() => undefined);
    else await writeFile(proofLinksPath, previousProofLinks);
  }
});

test("TikTok MVP local verification cannot apply evidence or enable publishing", async () => {
  const source = await readFile(localVerificationPath, "utf8");
  assert.doesNotMatch(source, /--apply/);
  assert.doesNotMatch(source, /runClipperTikTokMvpEvidenceCloseout\(true\)/);
  assert.doesNotMatch(source, /video\.publish/);
  assert.doesNotMatch(source, /realPublishEnabled:\s*true/);
  assert.doesNotMatch(source, /ready_to_send/);
  assert.match(source, /realPublishEnabled:\s*false/);
  assert.match(source, /directSocialApisRequired:\s*false/);
});

test("TikTok MVP autopilot boundary separates Codex-ready work from external proof work", async () => {
  const syntaxResult = spawnSync(process.execPath, ["--check", autopilotBoundaryPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(syntaxResult.status, 0, syntaxResult.stderr || syntaxResult.stdout);

  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-autopilot-boundary.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_external_account_proof");
  assert.equal(output.launchDecision, "blocked_before_metricool");
  assert.equal(output.minimumProofUrlsNeeded, 2);
  assert.ok(output.externalActionsRequired >= 2);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/autopilot-boundary.json"), "utf8"));
  assert.equal(report.realPublishEnabled, false);
  assert.equal(report.directSocialApisRequired, false);
  assert.equal(report.codexCanCreateExternalAccounts, false);
  assert.equal(report.codexCanInventPermissions, false);
  assert.equal(report.launchDecision === "ready_for_metricool_approval_review", report.status === "ready_for_operator_apply_review");
  assert.equal(report.codexDeliverables.find((item) => item.id === "tiktok_only_metricool_scope")?.status, "done");
  assert.equal(report.totals.refreshFailures, 0);
  assert.match(report.guardrails.join("\n"), /Authorization from Robert is not treated as account ownership/);
  assert.match(report.guardrails.join("\n"), /does not create external TikTok\/Metricool accounts/);
  assert.match(report.nextStep, /real SPORT and memes TikTok Metricool proof URLs/);
  assert.ok(report.codexDeliverables.some((item) => item.id === "proof_collection_packets" && item.status === "done"));
  assert.ok(report.externalActionsRequired.some((item) => item.status === "needs_real_external_proof"));
  assert.doesNotMatch(JSON.stringify(report), /ready_to_send|realPublishEnabled=true|video\.publish|access_token=|refresh_token=|client_secret=/i);

  const markdown = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/autopilot-boundary.md"), "utf8");
  assert.match(markdown, /External Actions Required/);
  assert.match(markdown, /authorization from being treated as proof/i);
  assert.doesNotMatch(markdown, /ready_to_send|realPublishEnabled=true|video\.publish/i);

  const csv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/autopilot-boundary.csv"), "utf8");
  assert.match(csv, /codex_deliverable/);
  assert.match(csv, /external_action/);
  assert.match(csv, /needs_real_external_proof/);
  assert.doesNotMatch(csv, /ready_to_send|realPublishEnabled=true|video\.publish/i);
});

test("TikTok MVP autopilot boundary fails closed in source", async () => {
  const source = await readFile(autopilotBoundaryPath, "utf8");
  assert.match(source, /function refreshFailed/);
  assert.match(source, /const refreshHasFailure = refreshFailed\(refreshRuns\)/);
  assert.match(source, /const missingProof = refreshHasFailure \|\| proofMissing/);
  assert.match(source, /refreshFailures: Object\.values\(refreshRuns\)\.filter/);
  assert.match(source, /function scopeIsTikTokOnly/);
  assert.match(source, /status: scopeIsTikTokOnly\(readinessVerifier\) \? "done" : "needs_review"/);
  assert.doesNotMatch(source, /readinessVerifier\?\.scope === "tiktok_only_metricool_mvp" \|\| operationalReadiness\?\.mvp\?\.directSocialApisRequired === false/);
  assert.match(source, /status === "ready_for_operator_apply_review"[\s\S]*\? "ready_for_metricool_approval_review"[\s\S]*: status === "needs_internal_followup"[\s\S]*\? "blocked_internal_followup"[\s\S]*: "blocked_before_metricool"/);
});
