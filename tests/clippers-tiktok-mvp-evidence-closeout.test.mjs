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

function cleanCombinedCsv() {
  return [
    combinedHeader,
    "sports-daily,Sports Daily Clips,tiktok,@sportsdaily,SPORT,https://www.tiktok.com/@sportsdaily,https://drive.google.com/file/d/sports-daily-tiktok-proof/view,https://app.metricool.com/planner/sports-daily-tiktok-proof,Sports Daily TikTok account ownership and 2FA security proof verified by Robert without secrets,SPORT TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
    "meme-radar,Meme Radar,tiktok,@memeradar,memes,https://www.tiktok.com/@memeradar,https://drive.google.com/file/d/meme-radar-tiktok-proof/view,https://app.metricool.com/planner/meme-radar-tiktok-proof,Meme Radar TikTok account ownership and 2FA security proof verified by Robert without secrets,memes TikTok is connected in Metricool with public non-secret proof reviewed by Robert,,",
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
    const report = JSON.parse(await readFile(closeoutReportPath, "utf8"));
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
  assert.match(routes, /app\.post\("\/api\/clippers\/parse-tiktok-mvp-proof-links-paste"/);
  assert.match(routes, /app\.get\("\/api\/clippers\/tiktok-mvp-proof-links-drop-status"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/create-tiktok-mvp-proof-links-drop-starter"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/import-tiktok-mvp-proof-links-drop"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/ingest-tiktok-mvp-proof-links-drop"/);
  assert.match(routes, /app\.post\("\/api\/clippers\/save-tiktok-mvp-proof-links"/);
  assert.match(proofLinksModule, /containsClipperSecretLikeText/);
  assert.match(proofLinksModule, /clipperUnsafeProofQueryParamPattern/);
  assert.match(routes, /auditClipperTikTokMvpProofLinks/);
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
  assert.doesNotMatch(intakeRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(proofDropRoute, /runClipperTikTokMvpProofDropKit/);
  assert.match(proofDropRoute, /readClipperTikTokMvpProofDropKit/);
  assert.match(proofDropRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(proofDropRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.doesNotMatch(proofDropRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksRoute, /auditClipperTikTokMvpProofLinks/);
  assert.doesNotMatch(proofLinksRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksPasteRoute, /extractClipperTikTokMvpProofLinksPaste/);
  assert.match(proofLinksModule, /explicitFields/);
  assert.match(proofLinksModule, /accountOwnershipProofUrl\|metricoolConnectionProofUrl\|accountNotes\|metricoolNotes/);
  assert.doesNotMatch(proofLinksPasteRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksDropStatusRoute, /buildClipperTikTokMvpProofLinksDropStatus/);
  assert.match(proofLinksDropStatusHelper, /checklistTotals/);
  assert.match(proofLinksDropStatusHelper, /nextButton/);
  assert.match(routes, /TikTok ownership proof/);
  assert.match(routes, /Metricool connection proof/);
  assert.match(routes, /does not return raw paste text/);
  assert.doesNotMatch(proofLinksDropStatusRoute, /writeNodeFile|runClipperTikTokMvpProofDropKit|runClipperTikTokMvpCloseoutWizard|--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(proofLinksDropStarterRoute, /create-tiktok-mvp-proof-links-drop-starter/);
  assert.match(proofLinksDropStarterRoute, /!existing\.trim\(\)/);
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
  assert.match(proofLinksSaveRoute, /auditClipperTikTokMvpProofLinks/);
  assert.match(proofLinksSaveRoute, /!audit\.readyForProofDrop/);
  assert.match(proofLinksSaveRoute, /saveClipperTikTokMvpProofLinksAndRefresh/);
  assert.match(proofLinksSaveHelper, /proof-links\.json/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofDropKit/);
  assert.match(proofLinksSaveHelper, /proof-quick-fill-input\.json/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofQuickFill/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofIntakeImport\(false\)/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpCloseoutWizard/);
  assert.match(proofLinksSaveHelper, /runClipperTikTokMvpProofHandoff/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpProofHandoff/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpEvidenceCloseout/);
  assert.match(proofLinksSaveHelper, /postProofRefreshRuns/);
  assert.match(proofLinksSaveHelper, /script\/clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(proofLinksSaveHelper, /script\/clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpGoLivePacket/);
  assert.match(proofLinksSaveHelper, /readClipperTikTokMvpReadinessVerifier/);
  assert.doesNotMatch(proofLinksRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(importPreviewRoute, /runClipperTikTokMvpProofIntakeImport\(false\)/);
  assert.doesNotMatch(importPreviewRoute, /x-clippers-operator-confirm|runClipperTikTokMvpProofIntakeImport\(true\)|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(importApplyRoute, /x-clippers-operator-confirm"\) !== "apply-tiktok-mvp-proof-intake-import"/);
  assert.match(importApplyRoute, /runClipperTikTokMvpProofIntakeImport\(true\)/);
  assert.match(importApplyRoute, /tiktokMvpProofIntakeImport\.status !== "applied"/);
  assert.match(importApplyRoute, /postImportApplyRuns/);
  assert.match(importApplyRoute, /runClipperTikTokMvpProofDoctor/);
  assert.match(importApplyRoute, /runClipperTikTokMvpCloseoutWizard/);
  assert.match(importApplyRoute, /runClipperTikTokMvpProofHandoff/);
  assert.match(importApplyRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(importApplyRoute, /readClipperTikTokMvpProofHandoff/);
  assert.doesNotMatch(importApplyRoute, /runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(quickFillRoute, /runClipperTikTokMvpProofQuickFill/);
  assert.match(quickFillRoute, /proof-quick-fill-input\.json/);
  assert.match(quickFillRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(quickFillRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.doesNotMatch(quickFillRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(refreshRoute, /runClipperTikTokMvpProofRefresh/);
  assert.match(refreshRoute, /readClipperTikTokMvpProofRefresh/);
  assert.match(refreshRoute, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(refreshRoute, /readClipperTikTokMvpProofDoctor/);
  assert.doesNotMatch(refreshRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(unblockerRoute, /runClipperTikTokMvpProofUnblocker/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofRefresh/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(unblockerRoute, /readClipperTikTokMvpProofDoctor/);
  assert.doesNotMatch(unblockerRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(handoffRoute, /runClipperTikTokMvpProofHandoff/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofHandoff/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofDropKit/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(handoffRoute, /readClipperTikTokMvpProofIntakeImport/);
  assert.match(handoffRoute, /readClipperTikTokMvpEvidenceCloseout/);
  assert.match(handoffRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.doesNotMatch(handoffRoute, /--apply|runClipperTikTokMvpProofIntakeImport\(true\)|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(localVerificationRoute, /runClipperTikTokMvpLocalVerification/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpLocalVerification/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpProofQuickFill/);
  assert.match(localVerificationRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.doesNotMatch(localVerificationRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  assert.match(closeoutWizardRoute, /runClipperTikTokMvpCloseoutWizard/);
  assert.match(closeoutWizardRoute, /readClipperTikTokMvpCloseoutWizard/);
  assert.match(closeoutWizardRoute, /readClipperTikTokMvpProofDropKit/);
  assert.match(closeoutWizardRoute, /readClipperTikTokMvpProofUnblocker/);
  assert.doesNotMatch(closeoutWizardRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness|ready_to_send|realPublishEnabled\s*=\s*true|publish|schedule/i);
  const doctorRoute = requiredSlice(
    routes,
    'app.post("/api/clippers/prepare-tiktok-mvp-proof-doctor"',
    'app.get("/api/clippers/tiktok-mvp-evidence-closeout"',
  );
  assert.match(doctorRoute, /runClipperTikTokMvpProofDoctor/);
  assert.match(doctorRoute, /readClipperTikTokMvpProofDoctor/);
  assert.doesNotMatch(doctorRoute, /--apply|runClipperTikTokMvpEvidenceCloseout\(true\)|runClipperOperationalReadiness/);
  assert.match(applyRoute, /res\.status\(403\)/);
  assert.match(applyRoute, /x-clippers-operator-confirm"\) !== "apply-tiktok-mvp-evidence-closeout"/);
  assert.match(applyRoute, /runClipperTikTokMvpEvidenceCloseout\(true\)/);
  assert.match(applyRoute, /tiktokMvpEvidenceCloseout\.status !== "applied"/);
  assert.match(applyRoute, /res\.status\(400\)/);
  assert.match(applyRoute, /runClipperOperationalReadiness/);
  assert.match(applyRoute, /postCloseoutApplyRuns/);
  assert.match(applyRoute, /script\/clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(applyRoute, /script\/clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(applyRoute, /readClipperTikTokMvpGoLivePacket/);
  assert.match(applyRoute, /readClipperTikTokMvpReadinessVerifier/);
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
  assert.match(page, /apply-clippers-tiktok-mvp-proof-quick-fill-button/);
  assert.match(page, /reset-clippers-tiktok-mvp-proof-quick-fill-button/);
  assert.match(page, /preview-clippers-tiktok-mvp-proof-intake-import-button/);
  assert.match(page, /apply-clippers-tiktok-mvp-proof-intake-import-button/);
  assert.match(page, /apply-clippers-tiktok-mvp-evidence-closeout-button/);
  assert.match(page, /const tiktokProofFlowBusy =/);
  assert.match(page, /disabled=\{tiktokProofFlowBusy \|\| isLoading/);
  assert.match(page, /clippers-tiktok-mvp-evidence-closeout-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-pack-paths/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-current-blockers/);
  assert.match(page, /lane\.evidenceQuality\?\.issues/);
  assert.match(page, /clippers-tiktok-mvp-proof-drop-kit-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-drop-kit-lanes/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-editor/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-paste-assistant/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-drop-status/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-drop-checklist/);
  assert.match(page, /tiktokMvpProofLinksDropStatus\.checklistTotals\.ready/);
  assert.match(page, /tiktokMvpProofLinksDropStatus\.nextButton/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-links-drop-status"\]/);
  assert.match(page, /load-clippers-tiktok-mvp-proof-links-paste-packet-button/);
  assert.match(page, /import-clippers-tiktok-mvp-proof-links-drop-button/);
  assert.match(page, /create-clippers-tiktok-mvp-proof-links-drop-starter-button/);
  assert.match(page, /ingest-clippers-tiktok-mvp-proof-links-drop-button/);
  assert.match(page, /tiktokMvpProofLinksDropIngestMutation/);
  assert.match(page, /tiktokMvpProofLinksDropStarterMutation/);
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
  assert.match(page, /postProofRefreshError/);
  assert.match(page, /parse-clippers-tiktok-mvp-proof-links-paste-button/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-paste-preview/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-textarea/);
  assert.match(page, /preview-clippers-tiktok-mvp-proof-links-button/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-preview-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-preview-impact/);
  assert.match(page, /clippers-tiktok-mvp-proof-links-preview-lanes/);
  assert.match(page, /save-clippers-tiktok-mvp-proof-links-button/);
  assert.match(page, /!tiktokMvpProofLinksPreview\?\.readyForProofDrop/);
  assert.match(page, /Preview must be clean before Save links turns on/);
  assert.match(page, /signed\/temporary URLs/);
  assert.match(page, /reset-clippers-tiktok-mvp-proof-links-button/);
  assert.match(page, /load-clippers-tiktok-mvp-proof-links-starter-button/);
  assert.match(page, /tiktokMvpProofDropKit\.proofLinksStarterText/);
  assert.match(page, /clippers-tiktok-mvp-proof-doctor-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-refresh-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblocker-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblocker-fixes/);
  assert.match(page, /clippers-tiktok-mvp-proof-handoff-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblock-board/);
  assert.match(page, /clippers-tiktok-mvp-proof-unblock-board-rows/);
  assert.match(page, /unblockBoard\.impact\.metricool100SourceReadyBatches/);
  assert.match(page, /paths\.unblockBoardCsv/);
  assert.match(page, /clippers-tiktok-mvp-proof-handoff-gates/);
  assert.match(page, /clippers-tiktok-mvp-proof-handoff-collection-packets/);
  assert.match(page, /paths\.pastePacketTxt/);
  assert.match(page, /clippers-tiktok-mvp-local-verification-panel/);
  assert.match(page, /clippers-tiktok-mvp-local-verification-commands/);
  assert.match(page, /clippers-tiktok-mvp-closeout-wizard-panel/);
  assert.match(page, /clippers-tiktok-mvp-closeout-wizard-steps/);
  assert.match(page, /clippers-tiktok-mvp-operator-session/);
  assert.match(page, /run-clippers-tiktok-mvp-operator-recommended-button/);
  assert.match(page, /runTikTokMvpOperatorButton/);
  assert.match(page, /postImportApplyError/);
  assert.match(page, /postCloseoutApplyError/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-closeout-wizard"\], data\.tiktokMvpCloseoutWizard/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-proof-handoff"\], data\.tiktokMvpProofHandoff/);
  assert.match(page, /getTikTokMvpOperatorButtonLabel/);
  assert.match(page, /case "import_preview"/);
  assert.match(page, /case "closeout_preview"/);
  assert.match(page, /case "local_verification"/);
  assert.match(page, /activeTikTokMvpOperatorButton === "apply_closeout_with_confirmation"/);
  assert.doesNotMatch(operatorButtonHelper, /tiktokMvpEvidenceCloseoutApplyMutation\.mutate/);
  assert.match(page, /clippers-tiktok-mvp-proof-quick-fill-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-quick-fill-textarea/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-import-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-intake-import-fix-queue/);
  assert.match(page, /clippers-tiktok-mvp-proof-fix-queue/);
  assert.match(page, /fixQueueCsv/);
  assert.match(page, /tiktokMvpProofDropKitMutation\.isPending/);
  assert.match(page, /tiktokMvpProofLinksPreviewMutation\.isPending/);
  assert.match(page, /tiktokMvpProofLinksSaveMutation\.isPending/);
  assert.match(page, /tiktokMvpProofHandoffMutation\.isPending/);
  assert.match(page, /tiktokMvpProofRefreshMutation\.isPending/);
  assert.match(page, /tiktokMvpProofUnblockerMutation\.isPending/);
  assert.match(page, /tiktokMvpLocalVerificationMutation\.isPending/);
  assert.match(page, /tiktokMvpCloseoutWizardMutation\.isPending/);
  assert.match(page, /tiktokMvpProofQuickFillMutation\.isPending/);
  assert.match(page, /tiktokMvpEvidenceCloseout\?\.status !== "ready_to_apply"/);
  const closeoutPanel = requiredSlice(
    page,
    'data-testid="clippers-tiktok-mvp-evidence-closeout-panel"',
    'data-testid="clippers-metricool-bridge-required-fields"',
  );
  assert.match(closeoutPanel, /This does not publish/);
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
  assert.ok(pack.lanes.some((lane) =>
    lane.accountId === "sports-daily"
    && lane.evidenceQuality.issues.some((issue) => issue.includes("accountProofUrl"))
  ));

  const accountTemplate = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/account-evidence-template.csv"), "utf8");
  const bridgeTemplate = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/metricool-bridge-evidence-template.csv"), "utf8");
  const markdown = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-pack.md"), "utf8");
  const html = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-intake-pack.html"), "utf8");
  assert.match(accountTemplate, /<paste real public ownership proof URL for @sportsdaily>/);
  assert.match(accountTemplate, /<paste real public ownership proof URL for @memeradar>/);
  assert.match(bridgeTemplate, /https:\/\/www\.tiktok\.com\/@sportsdaily/);
  assert.match(bridgeTemplate, /<paste real public Metricool proof URL for memes @memeradar>/);
  assert.match(markdown, /Evidence quality:/);
  assert.match(markdown, /Current blocker: .*accountProofUrl/);
  assert.match(html, /Evidence quality:/);
  assert.match(html, /accountProofUrl/);
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
  assert.ok(doctor.fixQueue.some((row) => row.lane === "sports-daily:tiktok" && row.source === "bridge" && row.requiredValue.includes("metricool.com")));
  assert.ok(doctor.lanes.every((lane) => lane.nextAction && lane.status === "blocked"));
  assert.doesNotMatch(JSON.stringify(doctor), /access_token=|refresh_token=|client_secret=|cookie=|bearer\s+[a-z0-9._-]+|password=/i);

  const fixQueueCsv = await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-fix-queue.csv"), "utf8");
  assert.match(fixQueueCsv, /sports-daily:tiktok/);
  assert.match(fixQueueCsv, /real HTTPS metricool.com proof URL/);
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
    assert.match(output.reportJsonPath, /proof-refresh\.json$/);

    const source = await readFile(proofRefreshPath, "utf8");
    assert.doesNotMatch(source, /--apply|ready_to_send|video\.publish|directSocialApisRequired:\s*true|runClipperTikTokMvpEvidenceCloseout\(true\)/);
    assert.match(source, /Metricool remains approval_required/);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-refresh.json"), "utf8"));
    assert.equal(report.launchMode, "metricool_approval_required");
    assert.equal(report.directSocialApisRequired, false);
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
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
    await writeFile(defaultCombinedProofCsvPath, cleanCombinedCsv());
    const before = await readFile(defaultCombinedProofCsvPath, "utf8");
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
    const source = await readFile(proofQuickFillPath, "utf8");
    assert.match(source, /unsafeProofQueryParamPattern/);
    assert.match(source, /x-amz-signature/);
    assert.doesNotMatch(source, /ready_to_send|video\.publish|directSocialApisRequired:\s*true|runClipperTikTokMvpEvidenceCloseout\(true\)/);
    assert.match(source, /does not apply final evidence, publish, schedule/);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousInput === null) await unlink(quickFillInputPath).catch(() => undefined);
    else await writeFile(quickFillInputPath, previousInput);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-unblocker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP proof quick fill writes clean proof only to combined intake", async () => {
  const previousCombined = await readFile(defaultCombinedProofCsvPath, "utf8").catch(() => null);
  const previousInput = await readFile(quickFillInputPath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(defaultCombinedProofCsvPath), { recursive: true });
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
    const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-quick-fill.json"), "utf8"));
    assert.equal(report.launchMode, "metricool_approval_required");
    assert.equal(report.directSocialApisRequired, false);
    assert.equal(report.appliedToIntake, true);
  } finally {
    if (previousCombined === null) await unlink(defaultCombinedProofCsvPath).catch(() => undefined);
    else await writeFile(defaultCombinedProofCsvPath, previousCombined);
    if (previousInput === null) await unlink(quickFillInputPath).catch(() => undefined);
    else await writeFile(quickFillInputPath, previousInput);
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
  assert.match(source, /clippers:tiktok-mvp-proof-drop-kit/);
  assert.match(source, /clippers:tiktok-mvp-proof-quick-fill/);
  assert.match(source, /clippers:tiktok-mvp-proof-unblocker/);
  assert.match(source, /clippers:tiktok-mvp-closeout-wizard/);
  assert.match(source, /blocked_before_metricool_approval_review/);
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
  assert.match(source, /blocked_needs_import_preview/);
  assert.match(source, /ready_for_operator_apply_review/);
  assert.match(source, /buildCollectionPackets/);
  assert.match(source, /accountOwnershipProofUrl/);
  assert.match(source, /metricoolConnectionProofUrl/);
  assert.match(source, /proofPacketsNeeded/);
  assert.match(source, /proof-handoff-collection-packets\.csv/);
  assert.match(source, /proof-links-paste-packet\.txt/);
  assert.match(source, /renderCollectionCsv/);
  assert.match(source, /Must be a real HTTPS metricool\.com URL/);
  assert.match(source, /signed\/temporary URLs/);
  assert.match(source, /x-amz\/signature\/expires query params/);
  assert.match(source, /script\/clippers-tiktok-mvp-proof-drop-kit\.mjs/);
  assert.match(source, /script\/clippers-tiktok-mvp-proof-intake-import\.mjs/);
  assert.match(source, /script\/clippers-tiktok-mvp-closeout-wizard\.mjs/);
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
  assert.match(output.collectionCsvPath, /proof-handoff-collection-packets\.csv$/);
  assert.match(output.pastePacketPath, /proof-links-paste-packet\.txt$/);
  assert.equal(output.proofPacketsNeeded, 4);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/tiktok-mvp-proof-intake/proof-handoff.json"), "utf8"));
  assert.equal(report.unblockBoard.status, "blocked_needs_operator_proof");
  assert.equal(report.unblockBoard.missingProofs, 4);
  assert.equal(report.unblockBoard.impact.metricool100Rows, 100);
  assert.equal(report.unblockBoard.impact.metricool100SourceReadyBatches, 10);
  assert.equal(report.unblockBoard.impact.metricool100OperatorReadyBatches, 0);
  assert.equal(report.unblockBoard.impact.metricool100BlockedBatches, 10);
  assert.match(report.unblockBoard.rows[0].exactPasteLine, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.doesNotMatch(JSON.stringify(report.unblockBoard), /access_token=|refresh_token=|client_secret=|cookie=|password=|ready_to_send|video\.publish/i);
  assert.match(report.pastePacketText, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.match(report.pastePacketText, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
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
  assert.match(pastePacket, /Metricool proof URLs must be https:\/\/\*\.metricool\.com/);
  assert.doesNotMatch(pastePacket, /access_token=|refresh_token=|client_secret=|cookie=|password=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|ready_to_send|realPublishEnabled=true|video\.publish/i);
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
