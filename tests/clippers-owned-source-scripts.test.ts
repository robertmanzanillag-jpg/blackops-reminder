import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const tikTokMetricoolApproveCopyPattern = /approve\/schedule|schedule\/approve|approve or schedule|approved or scheduled|approved\/scheduled|approving\/scheduling|approval\/scheduling/i;
const queuePath = path.join(rootDir, "scheduled", "metricool-execution-queue.json");
const queueMarkdownPath = path.join(rootDir, "scheduled", "metricool-execution-queue.md");
const queueCsvPath = path.join(rootDir, "scheduled", "metricool-execution-queue.csv");
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sliceRequired = (content: string, startNeedle: string, endNeedle: string) => {
  const start = content.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing start marker: ${startNeedle}`);
  const end = content.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing end marker after ${startNeedle}: ${endNeedle}`);
  return content.slice(start, end);
};

const parseTestCsvLine = (line: string) => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
};

const renderTestCsvLine = (cells: unknown[]) => cells
  .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
  .join(",");

const mutateTestCsvRows = (raw: string, mutate: (cells: string[], index: number, header: string[]) => string[]) => {
  const lines = raw.trimEnd().split(/\r?\n/);
  const header = parseTestCsvLine(lines[0] || "");
  return [
    lines[0],
    ...lines.slice(1).map((line, index) => renderTestCsvLine(mutate(parseTestCsvLine(line), index, header))),
  ].join("\n") + "\n";
};

async function withFutureCurrentBatchSchedule(callback: () => Promise<void>) {
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const sportsEvidencePath = path.join(rootDir, "account-evidence/sports-daily-tiktok.json");
  const memesEvidencePath = path.join(rootDir, "account-evidence/meme-radar-tiktok.json");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  const originalSportsEvidence = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const originalMemesEvidence = await readFile(memesEvidencePath, "utf8").catch(() => null);
  const runFixtureScript = (args: string[], allowErrorPattern?: RegExp) => {
    const refresh = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    if (refresh.status !== 0 && allowErrorPattern?.test(`${refresh.stderr}\n${refresh.stdout}`)) return;
    assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
  };
  const runFixtureRefreshScripts = () => {
    for (const args of [
      ["script/clippers-account-permission-readiness.mjs"],
      ["script/clippers-metricool-operator-handoff.mjs"],
      ["script/clippers-tiktok-launch-control.mjs"],
      ["script/clippers-tiktok-mvp-go-live-packet.mjs"],
      ["script/clippers-goal-completion-audit.mjs"],
      ["script/clippers-tiktok-mvp-readiness-verifier.mjs"],
      ["--import", "tsx", "script/clippers-metricool-mcp-preflight.ts"],
    ]) {
      runFixtureScript(args);
    }
  };
  try {
    await mkdir(path.dirname(sportsEvidencePath), { recursive: true });
    const recordedAt = new Date().toISOString();
    await writeFile(sportsEvidencePath, JSON.stringify({
      status: "verified",
      notes: "Test fixture: SPORT TikTok profile and Metricool bridge proof verified for local operator cockpit assertions.",
      accountId: "sports-daily",
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@sportsdaily",
      accountProofUrl: "https://drive.google.com/file/d/sports-daily-tiktok-proof/view",
      metricoolProofUrl: "https://app.metricool.com/brands/6431687",
      recordedAt,
      source: "test-fixture",
    }, null, 2));
    await writeFile(memesEvidencePath, JSON.stringify({
      status: "verified",
      notes: "Test fixture: memes TikTok profile and Metricool bridge proof verified for local operator cockpit assertions.",
      accountId: "meme-radar",
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@memeradar",
      accountProofUrl: "https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
      metricoolProofUrl: "https://app.metricool.com/brands/6431685",
      recordedAt,
      source: "test-fixture",
    }, null, 2));
    runFixtureRefreshScripts();
    const workbook = JSON.parse(originalWorkbook);
    const base = Date.now() + 90 * 60 * 1000;
    workbook.rows = (workbook.rows || []).map((row: Record<string, unknown>, index: number) => {
      const sourceCategory = row.accountId === "sports-daily" ? "sports" : "memes";
      const sourceFileName = path.basename(String(row.sourcePath || `${sourceCategory}-owned-01.mp4`));
      const fixtureSourcePath = path.join(rootDir, "sources", sourceCategory, sourceFileName);
      return {
        ...row,
        sourcePath: fixtureSourcePath,
        publishAt: new Date(base + index * 20 * 60 * 1000).toISOString(),
      };
    });
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    const workbookRowsById = new Map((workbook.rows || []).map((row: Record<string, unknown>) => [String(row.metricoolQueueItemId || ""), row]));
    await writeFile(
      batchEvidencePath,
      mutateTestCsvRows(originalBatchEvidence, (cells, _index, header) => {
        const queueId = cells[header.indexOf("metricool_queue_item_id")] || "";
        const workbookRow = workbookRowsById.get(queueId) as Record<string, unknown> | undefined;
        if (!workbookRow) return cells;
        cells[header.indexOf("scheduled_for")] = String(workbookRow.publishAt || "");
        cells[header.indexOf("source_path")] = String(workbookRow.sourcePath || "");
        cells[header.indexOf("caption_seed")] = String(workbookRow.captionSeed || "");
        for (const field of [
          "metricool_approval_url",
          "published_post_url",
          "final_status",
          "views_24h",
          "likes_24h",
          "comments_24h",
          "shares_24h",
          "operator_notes",
        ]) {
          cells[header.indexOf(field)] = "";
        }
        return cells;
      }),
    );
    for (const args of [
      ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"],
      ["script/clippers-tiktok-batch-tracker.mjs"],
      ["script/clippers-tiktok-batch-runbook.mjs"],
      ["script/clippers-tiktok-evidence-checklist.mjs"],
    ]) {
      const refresh = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
    }
    await callback();
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    await writeFile(batchEvidencePath, originalBatchEvidence);
    if (originalSportsEvidence === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, originalSportsEvidence);
    if (originalMemesEvidence === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, originalMemesEvidence);
    runFixtureRefreshScripts();
    for (const args of [
      ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"],
      ["script/clippers-tiktok-batch-tracker.mjs"],
      ["script/clippers-tiktok-batch-runbook.mjs"],
      ["script/clippers-tiktok-evidence-checklist.mjs"],
      ["script/clippers-tiktok-post-schedule-verifier.mjs"],
      ["script/clippers-tiktok-batch-closeout-verifier.mjs"],
    ]) {
      runFixtureScript(args);
    }
    runFixtureScript(["script/clippers-metricool-current-batch-upload-pack.mjs"], /Upload pack blocked: verifier=fail/);
    runFixtureScript(["script/clippers-tiktok-operator-cockpit.mjs"]);
    runFixtureScript(["script/clippers-tiktok-operator-cockpit-preflight.mjs"]);
    runFixtureScript(["script/clippers-tiktok-next-action.mjs"]);
    runFixtureScript(["script/clippers-metricool-current-batch-session-packet.mjs"]);
  }
}

test("local Clippers server startup avoids unsupported socket options", async () => {
  const serverIndex = await readFile(path.join(process.cwd(), "server/index.ts"), "utf8");
  const listenBlock = sliceRequired(serverIndex, "httpServer.listen(", "startReminderScheduler();");
  assert.doesNotMatch(listenBlock, /reusePort/);
  assert.match(listenBlock, /host/);
  assert.match(listenBlock, /port/);
});

test("owned source rights dry-run feeds Metricool source readiness sync without fake readiness", async () => {
  const originalQueue = await readFile(queuePath, "utf8").catch(() => null);
  const originalMarkdown = await readFile(queueMarkdownPath, "utf8").catch(() => null);
  const originalCsv = await readFile(queueCsvPath, "utf8").catch(() => null);

  try {
    const dryRun = spawnSync(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const audit = JSON.parse(dryRun.stdout);
    assert.equal(audit.realPublishEnabled, false);
    assert.equal(audit.publishMode, "approval_required");
    assert.equal(audit.rightsReady, audit.byCategory.sports.rightsReady + audit.byCategory.memes.rightsReady + audit.byCategory.streamers.rightsReady);
    assert.equal(audit.evidenceProblems, 0);
    assert.equal(audit.registrationPending, 0);

    const sync = spawnSync(process.execPath, ["script/clippers-sync-metricool-source-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    const synced = JSON.parse(sync.stdout);
    assert.equal(synced.realPublishEnabled, false);
    assert.equal(synced.publishMode, "approval_required");
    assert.equal(synced.localOwnedSourceTotals.total, audit.rightsReady);

    const queue = JSON.parse(await readFile(queuePath, "utf8"));
    assert.equal(queue.realPublishEnabled, false);
    assert.equal(queue.publishMode, "approval_required");
    assert.equal(queue.totals.readyToSend, 0);
    assert.equal(queue.sourceReadiness.localOwnedSourceTotals.total, audit.rightsReady);
    assert.equal(
      queue.sourceReadiness.totals.rightsReadyAssets,
      queue.sourceReadiness.categories.reduce((sum, category) => sum + category.rightsReadyAssets, 0),
    );
    assert.ok(queue.items.every((item) =>
      item.approvalRequired === true && item.canSendNow === false && item.status !== "ready_to_send"
    ));

    const syncScript = await readFile(path.join(process.cwd(), "script/clippers-sync-metricool-source-readiness.mjs"), "utf8");
    assert.ok(syncScript.includes("rightsAuditTimeoutMs"));
    assert.ok(syncScript.includes("detached: true"));
    assert.ok(syncScript.includes("process.kill(-child.pid"));
    assert.ok(syncScript.includes('child.kill("SIGKILL")'));
  } finally {
    if (originalQueue !== null) await writeFile(queuePath, originalQueue);
    else await unlink(queuePath).catch(() => undefined);
    if (originalMarkdown !== null) await writeFile(queueMarkdownPath, originalMarkdown);
    else await unlink(queueMarkdownPath).catch(() => undefined);
    if (originalCsv !== null) await writeFile(queueCsvPath, originalCsv);
    else await unlink(queueCsvPath).catch(() => undefined);
  }
});

test("account permission readiness reports Metricool MVP without claiming direct API approval", async () => {
  await withFutureCurrentBatchSchedule(async () => {
  const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "metricool_mvp_ready");
  assert.equal(output.launchMode, "metricool_approval_required");
  assert.equal(output.directSocialApisRequired, false);
  assert.equal(output.verifiedAccounts, 2);
  assert.equal(output.accountProfiles, 9);
  assert.equal(output.metricoolReadyLanes, 2);
  assert.equal(output.activeMvpReadyLanes, 2);
  assert.equal(output.activeMvpTargetLanes, 2);
  assert.equal(output.directApiReadyLanes, 0);
  assert.ok(output.externalProofsNeedEvidence > 0);
  assert.ok(output.externalEvidenceRepairRows > 0);
  assert.ok(output.fullReadinessPercent < 100);
  assert.ok(output.fullReadinessMissing > 0);
  assert.ok(output.nextEvidenceRows > 0);
  assert.equal(output.metricoolMvpAccountEvidenceRows, 0);
  assert.equal(output.metricoolMvpProfileEvidenceRows, 4);
  assert.equal(output.tiktokMvpCloseoutStatus, "ready_for_metricool_tiktok");
  assert.equal(output.tiktokMvpCloseoutReady, 2);
  assert.equal(output.tiktokMvpCloseoutRows, 2);
  assert.ok(output.connectedMetricoolRightsReadyAssets > 0);
  assert.ok(output.localOwnedSourceAssets >= 0);

  const readiness = JSON.parse(await readFile(path.join(rootDir, "account-permission-readiness.json"), "utf8"));
  assert.equal(readiness.status, "metricool_mvp_ready");
  assert.equal(readiness.launchMode, "metricool_approval_required");
  assert.equal(readiness.directSocialApisRequired, false);
  assert.match(readiness.nextStep, /review\/schedule TikTok queued clips/);
  assert.doesNotMatch(readiness.nextStep, /approved TikTok queued clips/i);
  assert.equal(readiness.activeMvp.scope, "tiktok_only_metricool_mvp");
  assert.deepEqual(readiness.activeMvp.platforms, ["tiktok"]);
  assert.deepEqual(readiness.activeMvp.accountIds, ["sports-daily", "meme-radar"]);
  assert.deepEqual(readiness.activeMvp.metricoolBrands, ["SPORT", "memes"]);
  assert.deepEqual(readiness.activeMvp.deferredLanes, ["instagram", "youtube", "streamers"]);
  assert.equal(readiness.activeMvp.directSocialApisRequired, false);
  assert.equal(readiness.activeMvp.approvalRequired, true);
  assert.equal(readiness.activeMvp.requiredApprovalMode, "approval_required");
  assert.equal(readiness.activeMvp.realPublishEnabled, false);
  assert.equal(readiness.activeMvp.requiredRealPublishEnabled, false);
  assert.equal(readiness.activeMvp.readyToSend, 0);
  assert.deepEqual(readiness.activeMvp.safetyBlockers, []);
  assert.match(readiness.activeMvp.bridgeEvidenceCsvPath, /metricool-tiktok-bridge-evidence\.csv$/);
  assert.match(readiness.activeMvp.nextStep, /review\/schedule TikTok queued clips/);
  assert.ok(readiness.externalCloseout.proofFilesNeedRealEvidence > 0);
  assert.ok(readiness.externalCloseout.nextEvidenceRows > 0);
  assert.match(readiness.externalCloseout.evidenceImportCsvPath, /external-closeout-evidence-import\.csv$/);
  assert.equal(readiness.sourceReadiness.connectedMetricoolRightsReadyAssets, output.connectedMetricoolRightsReadyAssets);
  assert.equal(readiness.sourceReadiness.localOwnedSourceAssets, output.localOwnedSourceAssets);
  assert.equal(readiness.fullReadinessGap.status, "metricool_mvp_ready_with_external_blockers");
  assert.equal(readiness.fullReadinessGap.percent, output.fullReadinessPercent);
  assert.ok(readiness.fullReadinessGap.missing > 0);
  assert.ok(readiness.fullReadinessGap.rows.some((row) => row.id === "external_proofs" && row.missing > 0));
  assert.ok(readiness.nextEvidenceDrop.rows > 0);
  assert.equal(readiness.nextEvidenceDrop.source, "external_closeout");
  assert.equal(readiness.metricoolMvpEvidence.accountRows, 0);
  assert.equal(readiness.metricoolMvpEvidence.bridgeEvidenceRows, 2);
  assert.equal(readiness.metricoolMvpEvidence.pendingProfileRows, 4);
  assert.match(readiness.metricoolMvpEvidence.accountEvidenceCsvPath, /account-permission-mvp-account-evidence\.csv$/);
  assert.match(readiness.metricoolMvpEvidence.bridgeEvidenceCsvPath, /metricool-tiktok-bridge-evidence\.csv$/);
  assert.match(readiness.metricoolMvpEvidence.pendingProfileEvidenceCsvPath, /metricool-pending-profile-evidence\.csv$/);
  assert.match(readiness.metricoolMvpEvidence.bridgeEvidenceTemplate, /sports-daily","tiktok","SPORT/);
  assert.match(readiness.metricoolMvpEvidence.bridgeEvidenceTemplate, /meme-radar","tiktok","memes/);
  assert.doesNotMatch(readiness.metricoolMvpEvidence.bridgeEvidenceTemplate, /instagram|youtube/i);
  assert.doesNotMatch(readiness.metricoolMvpEvidence.bridgeEvidenceTemplate, /METRICOOL_USER_TOKEN|client_secret|access_token/i);
  assert.equal(readiness.metricoolMvpEvidence.bridgeEvidencePreviewRows.length, 2);
  assert.equal(readiness.metricoolMvpEvidence.bridgeOperatorCards.length, 2);
  assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.rows, 2);
  assert.match(readiness.metricoolMvpEvidence.bridgeProofPack.status, /needs_real_metricool_bridge_proof|ready_for_metricool_operator/);
  assert.match(readiness.metricoolMvpEvidence.bridgeProofPack.markdownPath, /metricool-tiktok-bridge-proof-pack\.md$/);
  assert.match(readiness.metricoolMvpEvidence.bridgeProofPack.csvPath, /metricool-tiktok-bridge-proof-pack\.csv$/);
  assert.match(readiness.metricoolMvpEvidence.bridgeProofPack.nextStep, /Metricool|approval_required|proof/i);
  assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.approvalRequired, true);
  assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.realPublishEnabled, false);
  assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.readyToSend, 0);
  assert.deepEqual(readiness.metricoolMvpEvidence.bridgeProofPack.safetyBlockers, []);
  assert.ok(readiness.metricoolMvpEvidence.bridgeOperatorCards.some((card) =>
    card.accountId === "sports-daily"
    && card.metricoolBrandName === "SPORT"
    && card.csvRowTemplate.includes('"sports-daily","tiktok","SPORT"')
    && card.copyPacket.includes("Required proof: real HTTPS Metricool planner/profile proof URL")
  ));
  assert.ok(readiness.metricoolMvpEvidence.bridgeOperatorCards.some((card) =>
    card.accountId === "meme-radar"
    && card.metricoolBrandName === "memes"
    && card.csvRowTemplate.includes('"meme-radar","tiktok","memes"')
  ));
  assert.doesNotMatch(JSON.stringify(readiness.metricoolMvpEvidence.bridgeOperatorCards), /client_secret|access_token|refresh_token|password=|cookie=/i);
  assert.match(readiness.metricoolMvpEvidence.nextStep, /TikTok MVP|Instagram\/YouTube profile evidence stays deferred/i);
  assert.equal(readiness.tiktokMvpAccountCloseout.status, "ready_for_metricool_tiktok");
  assert.equal(readiness.tiktokMvpAccountCloseout.directSocialApisRequired, false);
  assert.equal(readiness.tiktokMvpAccountCloseout.totals.rows, 2);
  assert.equal(readiness.tiktokMvpAccountCloseout.totals.ready, 2);
  assert.ok(readiness.tiktokMvpAccountCloseout.rows.every((row) => row.platform === "tiktok"));
  assert.ok(readiness.tiktokMvpAccountCloseout.rows.every((row) => row.evidenceQuality.status === "accepted"));
  assert.ok(readiness.tiktokMvpAccountCloseout.rows.every((row) => row.evidenceQuality.issues.length === 0));
  assert.ok(readiness.tiktokMvpAccountCloseout.rows.some((row) => row.accountId === "sports-daily"));
  assert.ok(readiness.tiktokMvpAccountCloseout.rows.some((row) => row.accountId === "meme-radar"));
  assert.ok(readiness.tiktokMvpAccountCloseout.guardrails.some((guardrail) => guardrail.includes("approval_required")));
  assert.ok(readiness.tiktokMvpAccountCloseout.guardrails.some((guardrail) => guardrail.includes("Direct TikTok API developer scopes are not required")));
  assert.ok(readiness.nextEvidenceDrop.previewRows[0].includes("developer_app"));
  assert.ok(readiness.nextEvidenceDrop.previewCards.length > 0);
  assert.equal(readiness.nextEvidenceDrop.previewCards[0].kind, "developer_app");
  const bridgeEvidenceCsv = await readFile(path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv"), "utf8");
  assert.match(bridgeEvidenceCsv, /^account_id,platform,metricool_brand_name,metricool_blog_id,profile_url,proof,notes/m);
  assert.match(bridgeEvidenceCsv, /sports-daily","tiktok","SPORT/);
  assert.match(bridgeEvidenceCsv, /meme-radar","tiktok","memes/);
  assert.doesNotMatch(bridgeEvidenceCsv, /instagram|youtube|client_secret|access_token/i);
  const bridgeProofPack = JSON.parse(await readFile(path.join(rootDir, "scheduled", "metricool-tiktok-bridge-proof-pack.json"), "utf8"));
  assert.equal(bridgeProofPack.mode, "tiktok_metricool_bridge_proof_pack");
  assert.equal(bridgeProofPack.directSocialApisRequired, false);
  assert.equal(bridgeProofPack.realPublishEnabled, false);
  assert.equal(bridgeProofPack.approvalRequired, true);
  assert.equal(bridgeProofPack.readyToSend, 0);
  assert.deepEqual(bridgeProofPack.safetyBlockers, []);
  assert.equal(bridgeProofPack.totals.rows, 2);
  assert.ok(bridgeProofPack.rows.every((row) => row.platform === "tiktok"));
  assert.ok(bridgeProofPack.rows.every((row) => row.requiredProof.includes("real HTTPS Metricool proof URL")));
  assert.ok(bridgeProofPack.rows.every((row) => row.requiredProof.includes("real account ownership/security proof URL")));
  assert.ok(bridgeProofPack.rows.every((row) => row.accountEvidenceFields.includes("proof")));
  assert.ok(bridgeProofPack.rows.every((row) => row.bridgeEvidenceFields.includes("metricool_brand_name")));
  assert.ok(bridgeProofPack.rows.every((row) => row.accountEvidenceCsv.endsWith("account-permission-mvp-account-evidence.csv")));
  assert.match(bridgeProofPack.paths.accountEvidenceCsv, /account-permission-mvp-account-evidence\.csv$/);
  assert.ok(bridgeProofPack.guardrails.some((guardrail) => guardrail.includes("does not create external accounts")));
  assert.doesNotMatch(JSON.stringify(bridgeProofPack), /client_secret|access_token|refresh_token|password=|cookie=/i);
  const bridgeProofMarkdown = await readFile(path.join(rootDir, "scheduled", "metricool-tiktok-bridge-proof-pack.md"), "utf8");
  assert.match(bridgeProofMarkdown, /TikTok Metricool Bridge Proof Pack/);
  assert.match(bridgeProofMarkdown, /SPORT/);
  assert.match(bridgeProofMarkdown, /memes/);
  assert.match(bridgeProofMarkdown, /Account proof CSV:/);
  assert.match(bridgeProofMarkdown, /Account evidence fields:/);
  assert.match(bridgeProofMarkdown, /Bridge evidence fields:/);
  assert.match(bridgeProofMarkdown, /Direct TikTok\/Instagram\/YouTube APIs are not required/);
  assert.doesNotMatch(bridgeProofMarkdown, /client_secret|access_token|refresh_token|password=|cookie=/i);
  assert.equal(readiness.nextEvidenceDrop.previewCards[0].platform, "instagram");
  assert.match(readiness.nextEvidenceDrop.previewCards[0].proofPath, /external-closeout-proofs\/developer_app-instagram\.md$/);
  assert.match(readiness.nextEvidenceDrop.previewCards[0].nextStep, /real non-secret evidence/i);
  assert.match(readiness.nextEvidenceDrop.previewCards[0].copyText, /Missing fields: app_identifier, proof/);
  assert.match(readiness.nextEvidenceDrop.previewCards[0].copyText, /Proof file:/);
  const readinessMarkdown = await readFile(path.join(rootDir, "account-permission-readiness.md"), "utf8");
  assert.match(readinessMarkdown, /Full Readiness Gap/);
  assert.match(readinessMarkdown, /Active MVP Now/);
  assert.match(readinessMarkdown, /Scope: tiktok_only_metricool_mvp/);
  assert.match(readinessMarkdown, /Metricool brands: SPORT, memes/);
  assert.match(readinessMarkdown, /Deferred lanes: instagram, youtube, streamers/);
  assert.match(readinessMarkdown, /Preview rows:/);
  assert.match(readinessMarkdown, /Preview cards:/);
  assert.match(readinessMarkdown, /Metricool MVP Evidence Only/);
  assert.match(readinessMarkdown, /Metricool bridge proof pack/);
  assert.match(readinessMarkdown, /Metricool bridge operator cards/);
  assert.match(readinessMarkdown, /Required proof: real HTTPS Metricool planner\/profile proof URL|sports-daily","tiktok","SPORT/);
  assert.match(readinessMarkdown, /TikTok MVP Account Closeout/);
  assert.equal(readiness.totals.developerAppsApproved, 0);
  assert.equal(readiness.totals.permissionGroupsApproved, 0);
  assert.ok(readiness.accountRows.some((row) =>
    row.accountId === "sports-daily"
    && row.platform === "tiktok"
    && row.readyForMetricoolApproval === true
    && row.directApiReady === false
    && row.nextStep.includes("Ready for Metricool approval_required")
    && row.directApiBacklog.some((blocker) => blocker.includes("developer app not approved"))
  ));
  assert.ok(readiness.accountRows.some((row) =>
    row.accountId === "streamer-pulse"
    && row.platform === "tiktok"
    && row.accountStatus !== "verified"
    && row.readyForMetricoolApproval === false
  ));

  const nextEvidenceCsv = await readFile(path.join(rootDir, "account-permission-next-evidence.csv"), "utf8");
  assert.ok(nextEvidenceCsv.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes"));
  assert.match(nextEvidenceCsv, /external-closeout-proofs\/developer_app-instagram\.md/);
  assert.match(nextEvidenceCsv, /https:\/\/app\.clipprreview\.com\/api\/clippers\/oauth\/instagram\/callback/);
  assert.doesNotMatch(nextEvidenceCsv, /CLIENT_SECRET|client_secret|password=|refresh_token|access_token/);

  const mvpAccountEvidenceCsv = await readFile(path.join(rootDir, "account-permission-mvp-account-evidence.csv"), "utf8");
  assert.ok(mvpAccountEvidenceCsv.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes"));
  assert.doesNotMatch(mvpAccountEvidenceCsv, /"account","sports-daily","instagram","verified"/);
  assert.doesNotMatch(mvpAccountEvidenceCsv, /"account","sports-daily","youtube","verified"/);
  assert.doesNotMatch(mvpAccountEvidenceCsv, /"account","meme-radar","instagram","verified"/);
  assert.doesNotMatch(mvpAccountEvidenceCsv, /"account","meme-radar","youtube","verified"/);
  assert.doesNotMatch(mvpAccountEvidenceCsv, /developer_app|permission|client_secret|refresh_token|access_token/);

  const tiktokCloseoutJson = JSON.parse(await readFile(path.join(rootDir, "tiktok-mvp-account-closeout.json"), "utf8"));
  assert.equal(tiktokCloseoutJson.status, "ready_for_metricool_tiktok");
  assert.equal(tiktokCloseoutJson.totals.rows, 2);
  assert.equal(tiktokCloseoutJson.totals.ready, 2);
  assert.ok(tiktokCloseoutJson.rows.every((row) => row.requiredProof.includes("Metricool brand/profile connection proof")));
  assert.ok(tiktokCloseoutJson.rows.every((row) => row.evidenceQuality.status === "accepted"));
  assert.ok(tiktokCloseoutJson.rows.every((row) => row.copyText.includes("TikTok MVP account:")));
  const tiktokCloseoutMarkdown = await readFile(path.join(rootDir, "tiktok-mvp-account-closeout.md"), "utf8");
  assert.match(tiktokCloseoutMarkdown, /TikTok MVP Account Closeout/);
  assert.match(tiktokCloseoutMarkdown, /Evidence quality: accepted/);
  assert.match(tiktokCloseoutMarkdown, /Evidence issues: none/);
  assert.match(tiktokCloseoutMarkdown, /SPORT|Sports Daily/);
  assert.match(tiktokCloseoutMarkdown, /Meme Radar/);
  assert.match(tiktokCloseoutMarkdown, /Direct social APIs required: no/);
  assert.doesNotMatch(tiktokCloseoutMarkdown, /client_secret|refresh_token|access_token|password/i);
  const tiktokCloseoutCsv = await readFile(path.join(rootDir, "tiktok-mvp-account-closeout.csv"), "utf8");
  assert.match(tiktokCloseoutCsv, /"account_id","account_name","category","platform","handle","status","account_status","evidence_quality_status","evidence_quality_issues"/);
  assert.match(tiktokCloseoutCsv, /sports-daily/);
  assert.match(tiktokCloseoutCsv, /meme-radar/);
  });
});

test("account permission readiness writes active TikTok MVP account evidence rows when proof is missing", async () => {
  const sportsEvidencePath = path.join(rootDir, "account-evidence/sports-daily-tiktok.json");
  const memesEvidencePath = path.join(rootDir, "account-evidence/meme-radar-tiktok.json");
  const originalSportsEvidence = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const originalMemesEvidence = await readFile(memesEvidencePath, "utf8").catch(() => null);
  try {
    await unlink(sportsEvidencePath).catch(() => undefined);
    await unlink(memesEvidencePath).catch(() => undefined);

    const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.metricoolMvpAccountEvidenceRows, 2);
    assert.equal(output.tiktokMvpCloseoutStatus, "needs_tiktok_account_evidence");

    const readiness = JSON.parse(await readFile(path.join(rootDir, "account-permission-readiness.json"), "utf8"));
    assert.equal(readiness.metricoolMvpEvidence.accountRows, 2);
    assert.match(readiness.metricoolMvpEvidence.accountEvidenceCsvPath, /account-permission-mvp-account-evidence\.csv$/);
    const sportsRow = readiness.accountRows.find((row) => row.accountId === "sports-daily" && row.platform === "tiktok");
    assert.equal(sportsRow.evidenceQuality.status, "missing");
    assert.ok(sportsRow.evidenceQuality.issues.some((issue) => issue.includes("exact profileUrl")));
    assert.ok(sportsRow.evidenceQuality.issues.some((issue) => issue.includes("accountProofUrl")));
    assert.ok(sportsRow.evidenceQuality.issues.some((issue) => issue.includes("metricoolProofUrl")));
    assert.ok(readiness.tiktokMvpAccountCloseout.rows.every((row) => row.evidenceQuality.issues.length > 0));

    const mvpAccountEvidenceCsv = await readFile(path.join(rootDir, "account-permission-mvp-account-evidence.csv"), "utf8");
    assert.match(mvpAccountEvidenceCsv, /"account","sports-daily","tiktok","verified"/);
    assert.match(mvpAccountEvidenceCsv, /"account","meme-radar","tiktok","verified"/);
    assert.match(mvpAccountEvidenceCsv, /active TikTok MVP account proof/);
    assert.doesNotMatch(mvpAccountEvidenceCsv, /"instagram"|"youtube"|developer_app|permission|client_secret|refresh_token|access_token|password=/);
  } finally {
    if (originalSportsEvidence === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, originalSportsEvidence);
    if (originalMemesEvidence === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, originalMemesEvidence);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("account permission readiness rejects shallow verified TikTok MVP evidence", async () => {
  const sportsEvidencePath = path.join(rootDir, "account-evidence/sports-daily-tiktok.json");
  const memesEvidencePath = path.join(rootDir, "account-evidence/meme-radar-tiktok.json");
  const originalSportsEvidence = await readFile(sportsEvidencePath, "utf8").catch(() => null);
  const originalMemesEvidence = await readFile(memesEvidencePath, "utf8").catch(() => null);
  try {
    await mkdir(path.dirname(sportsEvidencePath), { recursive: true });
    const recordedAt = new Date().toISOString();
    await writeFile(sportsEvidencePath, JSON.stringify({
      status: "verified",
      notes: "Shallow verified fixture has a profile and generic proof URL but no required ownership or Metricool evidence fields.",
      accountId: "sports-daily",
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@sportsdaily",
      proofUrl: "https://app.metricool.com/brands/6431687",
      recordedAt,
    }, null, 2));
    await writeFile(memesEvidencePath, JSON.stringify({
      status: "verified",
      notes: "Shallow verified fixture has a profile and generic proof URL but no required ownership or Metricool evidence fields.",
      accountId: "meme-radar",
      platform: "tiktok",
      profileUrl: "https://www.tiktok.com/@memeradar",
      proofUrl: "https://app.metricool.com/brands/6431685",
      recordedAt,
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.activeMvpReadyLanes, 0);
    assert.equal(output.tiktokMvpCloseoutStatus, "needs_tiktok_account_evidence");

    const readiness = JSON.parse(await readFile(path.join(rootDir, "account-permission-readiness.json"), "utf8"));
    const sportsRow = readiness.accountRows.find((row) => row.accountId === "sports-daily" && row.platform === "tiktok");
    assert.equal(sportsRow.accountStatus, "rejected");
    assert.equal(sportsRow.readyForMetricoolApproval, false);
    assert.equal(sportsRow.evidenceQuality.status, "rejected");
    assert.ok(sportsRow.evidenceQuality.issues.some((issue) => issue.includes("accountProofUrl")));
    assert.ok(sportsRow.evidenceQuality.issues.some((issue) => issue.includes("metricoolProofUrl")));
    assert.match(sportsRow.nextStep, /accountProofUrl|metricoolProofUrl/);

    const closeout = JSON.parse(await readFile(path.join(rootDir, "tiktok-mvp-account-closeout.json"), "utf8"));
    assert.equal(closeout.status, "needs_tiktok_account_evidence");
    assert.equal(closeout.totals.ready, 0);
    assert.ok(closeout.rows.every((row) => row.status === "needs_account_proof"));
    assert.ok(closeout.rows.every((row) => row.evidenceQuality.status === "rejected"));
    assert.ok(closeout.rows.every((row) => row.evidenceQuality.issues.some((issue) => issue.includes("accountProofUrl"))));

    const closeoutMarkdown = await readFile(path.join(rootDir, "tiktok-mvp-account-closeout.md"), "utf8");
    assert.match(closeoutMarkdown, /Evidence quality: rejected/);
    assert.match(closeoutMarkdown, /accountProofUrl must be a real safe HTTPS ownership\/security proof URL/);
    assert.match(closeoutMarkdown, /metricoolProofUrl must be a real safe HTTPS Metricool proof URL/);
    const closeoutCsv = await readFile(path.join(rootDir, "tiktok-mvp-account-closeout.csv"), "utf8");
    assert.match(closeoutCsv, /"evidence_quality_status","evidence_quality_issues"/);
    assert.match(closeoutCsv, /accountProofUrl must be a real safe HTTPS ownership\/security proof URL/);
  } finally {
    if (originalSportsEvidence === null) await unlink(sportsEvidencePath).catch(() => undefined);
    else await writeFile(sportsEvidencePath, originalSportsEvidence);
    if (originalMemesEvidence === null) await unlink(memesEvidencePath).catch(() => undefined);
    else await writeFile(memesEvidencePath, originalMemesEvidence);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("operational readiness keeps MVP separate from full external readiness", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "metricool_mvp_ready");
  assert.equal(output.metricoolMvpReady, true);
  assert.equal(output.fullDirectApiReady, false);
  assert.equal(output.readyToSend, 0);
  assert.equal(output.metricoolMvpBlockers, 0);
  assert.ok(output.directApiBacklog > 0);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-operational-readiness.json"), "utf8"));
  assert.equal(report.status, "metricool_mvp_ready");
  assert.equal(report.mvp.launchMode, "metricool_approval_required");
  assert.equal(report.mvp.directSocialApisRequired, false);
  assert.equal(report.metricool.realPublishEnabled, false);
  assert.equal(report.metricool.publishMode, "approval_required");
  assert.equal(report.metricool.readyToSend, 0);
  assert.equal(report.accounts.directApiReadyLanes, 0);
  assert.deepEqual(report.metricoolMvpBlockers, []);
  assert.ok(report.directApiBacklog.some((blocker) => blocker.includes("direct API publishing remains blocked")));
});

test("external closeout pack lists remaining account developer and permission actions", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_external_actions");
  assert.equal(output.accounts, 7);
  assert.equal(output.developerApps, 3);
  assert.equal(output.permissions, 6);
  assert.equal(output.tasks, 16);
  assert.equal(output.goLiveAuditStatus, "blocked_external_actions");
  assert.ok(output.goLiveAuditBlockedGates > 0);
  assert.equal(output.proofFilesNeedRealEvidence, 16);
  assert.match(output.proofTodoPath, /clippers-external-closeout-proof-todo\.md$/);
  assert.match(output.operatorQueuePath, /clippers-external-closeout-operator-queue\.md$/);
  assert.match(output.batchHandoffPath, /clippers-external-closeout-batches\.md$/);
  assert.match(output.goLiveAuditPath, /clippers-external-go-live-audit\.md$/);
  assert.match(output.actionSheetPath, /clippers-external-operator-action-sheet\.md$/);
  assert.match(output.nextWorkRunPath, /clippers-external-next-work-run\.md$/);

  const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.json"), "utf8"));
  assert.equal(pack.metricool.readyToSend, 0);
  assert.equal(pack.metricool.publishMode, "approval_required");
  assert.equal(pack.metricool.realPublishEnabled, false);
  assert.ok(pack.paths.proofDir.endsWith("external-closeout-proofs"));
  assert.ok(!pack.blockers.some((blocker) => blocker.includes("Local app is not listening")));
  assert.ok(pack.tasks.some((task) => task.id === "account:streamer-pulse:tiktok" && task.priority === "critical"));
  assert.ok(pack.tasks.some((task) => task.id === "developer_app:tiktok" && task.missingEnvVars.includes("TIKTOK_CLIENT_KEY")));
  assert.ok(pack.tasks.some((task) => task.id === "permission:tiktok:video.publish"));
  assert.ok(pack.tasks.every((task) => task.proofPath && task.proofPath.includes("external-closeout-proofs")));
  assert.equal(pack.totals.proofFilesNeedRealEvidence, 16);
  assert.equal(pack.artifactSafety.status, "clean");
  assert.equal(pack.artifactSafety.scanned, 22);
  assert.equal(pack.artifactSafety.findings.length, 0);
  assert.equal(pack.paths.actionSheetMarkdown.endsWith("clippers-external-operator-action-sheet.md"), true);
  assert.equal(pack.paths.nextWorkRunMarkdown.endsWith("clippers-external-next-work-run.md"), true);
  assert.equal(pack.paths.nextWorkRunCsv.endsWith("clippers-external-next-work-run.csv"), true);
  assert.equal(pack.paths.batchHandoffMarkdown.endsWith("clippers-external-closeout-batches.md"), true);
  assert.equal(pack.paths.batchHandoffCsv.endsWith("clippers-external-closeout-batches.csv"), true);
  assert.equal(pack.batchHandoff.status, "needs_operator");
  assert.equal(pack.batchHandoff.totals.batches, 9);
  assert.equal(pack.batchHandoff.totals.rows, 16);
  assert.equal(pack.batchHandoff.totals.metricoolReadyToSend, 0);
  assert.equal(pack.batchHandoff.totals.realPublishEnabled, false);
  assert.equal(pack.batchHandoff.batches.reduce((sum, batch) => sum + batch.total, 0), pack.operatorQueue.length);
  assert.equal(pack.batchHandoff.nextBatch.id, "external-closeout-instagram-developer_app");
  assert.ok(pack.batchHandoff.batches.some((batch) => batch.platform === "tiktok" && batch.lane === "account" && batch.accountIds.includes("streamer-pulse")));
  assert.ok(pack.batchHandoff.batches.every((batch) => batch.doneCriteria.some((item) => item.includes("No passwords"))));
  assert.ok(pack.batchHandoff.batches.every((batch) => batch.evidenceRows.every((row) => row.startsWith("\"") && !row.includes("<"))));
  assert.equal(pack.actionSheet.status, "needs_operator");
  assert.equal(pack.actionSheet.totals.rows, 16);
  assert.equal(pack.actionSheet.totals.developerApps, 3);
  assert.equal(pack.actionSheet.totals.permissions, 6);
  assert.equal(pack.actionSheet.totals.accounts, 7);
  assert.equal(pack.actionSheet.nextAction.id, "developer_app:instagram");
  assert.equal(pack.actionSheet.accountSetupCards.length, 7);
  assert.ok(pack.actionSheet.accountSetupCards.some((card) => card.id === "account:sports-daily:instagram" && card.metricoolBridgeNeeded === true));
  assert.ok(pack.actionSheet.accountSetupCards.every((card) => card.copyNote.includes("Do not store login credentials")));
  assert.equal(pack.actionSheet.developerAppCards.length, 3);
  assert.ok(pack.actionSheet.developerAppCards.some((card) => card.platform === "tiktok" && card.redirectUri.includes("/api/clippers/oauth/tiktok/callback")));
  assert.ok(pack.actionSheet.developerAppCards.every((card) => card.copyNote.includes("approval_required")));
  assert.equal(pack.actionSheet.permissionRequestCards.length, 6);
  assert.ok(pack.actionSheet.permissionRequestCards.some((card) => card.scope === "video.publish" && card.copyNote.includes("approval_required")));
  assert.equal(pack.actionSheet.workSession.status, "needs_operator");
  assert.equal(pack.actionSheet.workSession.label, "Next 45-minute closeout work run");
  assert.equal(pack.actionSheet.workSession.rows[0].id, "developer_app:instagram");
  assert.equal(pack.actionSheet.workSession.rows.length, 5);
  assert.equal(pack.nextWorkRun.status, "needs_operator");
  assert.equal(pack.nextWorkRun.paths.markdown.endsWith("clippers-external-next-work-run.md"), true);
  assert.equal(pack.nextWorkRun.rows[0].id, "developer_app:instagram");
  assert.equal(pack.nextWorkRun.rows.length, 5);
  assert.ok(pack.nextWorkRun.portalSessions.length >= 3);
  assert.ok(pack.nextWorkRun.portalSessions.some((session) => session.platform === "instagram" && session.actions >= 1));
  assert.ok(pack.nextWorkRun.portalSessions.every((session) => session.copyPacket.includes("Evidence CSV fields to fill:")));
  assert.ok(pack.nextWorkRun.portalSessions.every((session) => session.evidenceStarterRows.length > 0));
  assert.ok(pack.actionSheet.workSession.validateCommand.includes("clippers:import-external-closeout-evidence"));
  assert.ok(pack.actionSheet.workSession.applyReadyCommand.includes("--apply-ready"));
  assert.ok(pack.actionSheet.workSession.rows.every((row) => row.copyPacket.includes("Evidence CSV fields to fill:")));
  assert.equal(JSON.stringify(pack.actionSheet.workSession).includes("client_secret"), false);
  assert.equal(pack.actionSheet.officialSourceCards.length, 6);
  assert.ok(pack.actionSheet.officialSourceCards.some((card) => card.scope === "video.publish" && card.sourceStatus === "official_verified"));
  assert.ok(pack.actionSheet.officialSourceCards.some((card) => card.scope === "instagram_content_publish" && card.accessMode === "login_required"));
  assert.ok(pack.actionSheet.officialSourceCards.some((card) => card.scope === "https://www.googleapis.com/auth/youtube.upload" && card.primaryOfficialUrl.includes("developers.google.com/youtube")));
  assert.ok(pack.actionSheet.guardrails.some((item) => item.includes("Metricool remains approval_required")));
  assert.equal(pack.goLiveAudit.status, "blocked_external_actions");
  assert.equal(pack.goLiveAudit.totals.operatorActions, 16);
  assert.equal(pack.goLiveAudit.totals.proofFilesNeedRealEvidence, 16);
  assert.equal(pack.goLiveAudit.totals.metricoolReadyToSend, 0);
  assert.equal(pack.goLiveAudit.totals.workBlocks, 3);
  assert.ok(pack.goLiveAudit.totals.estimatedOperatorMinutes > 0);
  assert.equal(pack.goLiveAudit.totals.evidenceRepairRows, 16);
  assert.equal(pack.goLiveAudit.evidenceRepairQueue.length, 16);
  assert.equal(pack.goLiveAudit.evidenceRepairQueue[0].id, pack.tasks[0].id);
  assert.equal(pack.goLiveAudit.evidenceRepairQueue[0].proofPath, pack.tasks[0].proofPath);
  assert.ok(pack.goLiveAudit.evidenceRepairQueue.every((row) => row.reason.length > 0));
  assert.ok(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("Repair action:"));
  assert.ok(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("Evidence CSV fields to fill:"));
  assert.ok(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("Do not paste private credentials"));
  assert.equal(pack.goLiveAudit.evidenceRepairQueue[0].copyPacket.includes("client_secret"), false);
  assert.equal(pack.goLiveAudit.workBlocks.length, 3);
  assert.ok(pack.goLiveAudit.workBlocks.some((block) => block.id === "developer_apps" && block.actions === 3));
  assert.ok(pack.goLiveAudit.workBlocks.some((block) => block.id === "permissions" && block.actions === 6));
  assert.ok(pack.goLiveAudit.workBlocks.some((block) => block.id === "accounts" && block.actions === 7));
  assert.ok(pack.goLiveAudit.workBlocks.every((block) => block.doneCriteria.length >= 3));
  assert.equal(pack.goLiveAudit.gates.some((gate) => gate.id === "metricool_publish_mode" && gate.status === "verified"), true);
  assert.equal(pack.goLiveAudit.gates.some((gate) => gate.id === "external_actions" && gate.status === "blocked"), true);
  assert.equal(pack.goLiveAudit.gates.some((gate) => gate.id === "evidence_import" && gate.status === "blocked"), true);
  assert.equal(pack.goLiveAudit.nextAction.id, "developer_app:instagram");
  assert.ok(pack.tasks.every((task) => task.proofStatus === "needs_real_proof"));
  assert.equal(pack.proofTodo.length, 16);
  assert.ok(pack.proofTodo.every((row) => !row.requiredCsvStatus.includes("_or_")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.requiredCsvStatus === "submitted"));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.requiredCsvFields.includes("app_identifier")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.missingCsvFields.includes("app_identifier")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.requiredCsvFields.includes("public_base_url")));
  assert.ok(pack.proofTodo.some((row) => row.id === "developer_app:tiktok" && row.blockers.some((blocker) => blocker.includes("app_identifier"))));
  assert.ok(pack.proofTodo.some((row) => row.id === "permission:tiktok:video.publish" && row.requiredCsvStatus === "requested"));
  assert.ok(pack.proofTodo.some((row) => row.id === "permission:tiktok:video.publish" && row.requiredCsvFields.includes("scope")));
  assert.ok(pack.proofTodo.some((row) => row.id === "permission:tiktok:video.publish" && row.blockers.some((blocker) => blocker.includes("proof stub"))));
  assert.ok(pack.proofTodo.some((row) => row.id === "account:streamer-pulse:tiktok" && row.requiredCsvStatus === "verified"));
  assert.equal(pack.operatorQueue.length, 16);
  assert.equal(pack.operatorQueue[0].id, "developer_app:instagram");
  assert.equal(pack.operatorQueue[0].rank, 1);
  assert.ok(pack.operatorQueue[0].operatorAction.includes("developer portal"));
  assert.ok(pack.operatorQueue.some((row) => row.id === "developer_app:tiktok" && row.missingCsvFields.includes("app_identifier")));

  const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
  assert.match(evidenceCsv, /kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes/);
  assert.match(evidenceCsv, /permission.*video\.publish/);
  assert.match(evidenceCsv, /external-closeout-proofs/);
  assert.doesNotMatch(evidenceCsv, /submitted_or_approved|requested_or_approved/);
  assert.match(evidenceCsv, /developer_app","[^"]*","tiktok","submitted/);
  assert.match(evidenceCsv, /permission","[^"]*","tiktok","requested","video\.publish/);
  const firstProof = await readFile(pack.tasks[0].proofPath, "utf8");
  assert.match(firstProof, /needs_real_proof/);
  assert.match(firstProof, /Safe proof examples/);
  assert.match(firstProof, /Completion checklist/);
  assert.match(firstProof, /Evidence CSV fields to fill/);
  assert.match(firstProof, /- status: verified/);
  const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
  assert.equal(proofTodo.rows.length, 16);
  assert.equal(proofTodo.artifactSafety.status, "clean");
  assert.equal(proofTodo.operatorQueue.length, 16);
  assert.equal(proofTodo.totals.proofFilesFilled, 0);
  assert.equal(proofTodo.rows.some((row) => row.readyToApply === true), false);
  const proofTodoCsv = await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.csv"), "utf8");
  assert.match(proofTodoCsv, /required_csv_status/);
  assert.match(proofTodoCsv, /required_csv_fields/);
  assert.match(proofTodoCsv, /ready_to_apply/);
  assert.match(proofTodoCsv, /blockers/);
  assert.match(proofTodoCsv, /app_identifier/);
  assert.doesNotMatch(proofTodoCsv, /submitted_or_approved|requested_or_approved/);
  const proofTodoMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.md"), "utf8");
  assert.match(proofTodoMarkdown, /Clippers External Closeout Proof Todo/);
  assert.match(proofTodoMarkdown, /Do not paste tokens/);
  const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
  assert.equal(operatorQueue.rows.length, 16);
  assert.equal(operatorQueue.artifactSafety.status, "clean");
  assert.equal(operatorQueue.totals.critical, 10);
  assert.match(operatorQueue.nextStep, /developer portal|account\/profile/);
  const operatorQueueCsv = await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.csv"), "utf8");
  assert.match(operatorQueueCsv, /missing_csv_fields/);
  assert.match(operatorQueueCsv, /operator_action/);
  const operatorQueueMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.md"), "utf8");
  assert.match(operatorQueueMarkdown, /Clippers External Closeout Operator Queue/);
  assert.match(operatorQueueMarkdown, /shortest safe queue/);
  const batchHandoff = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-batches.json"), "utf8"));
  assert.equal(batchHandoff.rows, undefined);
  assert.equal(batchHandoff.totals.batches, 9);
  assert.equal(batchHandoff.totals.proofFilesNeedRealEvidence, 16);
  assert.equal(batchHandoff.artifactSafety.status, "clean");
  assert.ok(batchHandoff.guardrails.some((item) => item.includes("Metricool remains approval_required")));
  assert.ok(batchHandoff.batches.some((batch) => batch.id === "external-closeout-youtube-permission" && batch.scopes.some((scope) => scope.includes("youtube"))));
  const batchHandoffCsv = await readFile(path.join(rootDir, "reports/clippers-external-closeout-batches.csv"), "utf8");
  assert.match(batchHandoffCsv, /rank,id,platform,lane,status,total/);
  assert.match(batchHandoffCsv, /external-closeout-instagram-developer_app/);
  assert.doesNotMatch(batchHandoffCsv, /ready_to_send","[1-9]/);
  const batchHandoffMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-batches.md"), "utf8");
  assert.match(batchHandoffMarkdown, /Clippers External Closeout Batches/);
  assert.match(batchHandoffMarkdown, /batch-by-batch handoff/);
  assert.match(batchHandoffMarkdown, /Metricool ready to send: 0/);
  assert.match(batchHandoffMarkdown, /Real publish enabled: no/);
  assert.match(batchHandoffMarkdown, /No passwords/);
  const goLiveAudit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.json"), "utf8"));
  assert.equal(goLiveAudit.status, "blocked_external_actions");
  assert.equal(goLiveAudit.totals.blocked > 0, true);
  assert.equal(goLiveAudit.nextAction.id, "developer_app:instagram");
  const goLiveAuditCsv = await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.csv"), "utf8");
  assert.match(goLiveAuditCsv, /artifact_safety/);
  assert.match(goLiveAuditCsv, /metricool_publish_mode/);
  assert.match(goLiveAuditCsv, /work_block/);
  assert.match(goLiveAuditCsv, /developer_apps/);
  assert.match(goLiveAuditCsv, /evidence_repair/);
  const goLiveAuditMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.md"), "utf8");
  assert.match(goLiveAuditMarkdown, /Clippers External Go-Live Audit/);
  assert.match(goLiveAuditMarkdown, /does not enable automatic publishing/);
  assert.match(goLiveAuditMarkdown, /Work Blocks/);
  assert.match(goLiveAuditMarkdown, /Developer apps/);
  assert.match(goLiveAuditMarkdown, /Evidence Repair Queue/);
  assert.match(goLiveAuditMarkdown, /Copy packet:/);
  const actionSheet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.json"), "utf8"));
  assert.equal(actionSheet.rows.length, 16);
  assert.equal(actionSheet.blocks.length, 3);
  assert.equal(actionSheet.accountSetupCards.length, 7);
  assert.equal(actionSheet.developerAppCards.length, 3);
  assert.equal(actionSheet.permissionRequestCards.length, 6);
  assert.equal(actionSheet.officialSourceCards.length, 6);
  assert.equal(actionSheet.portalCloseoutBoard.length, 3);
  assert.ok(actionSheet.portalCloseoutBoard.some((card) => card.platform === "instagram" && card.actions > 0));
  assert.ok(actionSheet.portalCloseoutBoard.some((card) => card.platform === "tiktok" && card.critical > 0));
  assert.ok(actionSheet.portalCloseoutBoard.some((card) => card.platform === "youtube" && card.evidenceStarterRows.some((row) => row.includes("youtube"))));
  assert.ok(actionSheet.portalCloseoutBoard.every((card) => card.checklist.some((item) => item.includes("approval_required"))));
  assert.ok(actionSheet.portalCloseoutBoard.every((card) => card.evidenceStarterRows.length === card.actions));
  assert.ok(actionSheet.officialSourceCards.every((card) => card.permissionProofPath.includes("external-closeout-proofs")));
  assert.ok(actionSheet.officialSourceCards.some((card) => card.scope === "video.upload" && card.submitDecision === "request_now"));
  assert.equal(actionSheet.nextAction.id, "developer_app:instagram");
  assert.ok(actionSheet.rows.every((row) => row.copyPacket.includes("Evidence CSV fields to fill:")));
  const actionSheetCsv = await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.csv"), "utf8");
  assert.match(actionSheetCsv, /operator_action/);
  assert.match(actionSheetCsv, /proof_path/);
  const actionSheetMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.md"), "utf8");
  assert.match(actionSheetMarkdown, /Clippers External Operator Action Sheet/);
  assert.match(actionSheetMarkdown, /This is the working sheet/);
  assert.match(actionSheetMarkdown, /Next Work Run/);
  assert.match(actionSheetMarkdown, /Apply ready/);
  assert.match(actionSheetMarkdown, /Account Setup Cards/);
  assert.match(actionSheetMarkdown, /Setup note:/);
  assert.match(actionSheetMarkdown, /Developer App Cards/);
  assert.match(actionSheetMarkdown, /Portal Closeout Board/);
  assert.match(actionSheetMarkdown, /App review use case:/);
  assert.match(actionSheetMarkdown, /Permission Request Cards/);
  assert.match(actionSheetMarkdown, /Review note:/);
  assert.match(actionSheetMarkdown, /Official Permission Source Cards/);
  assert.match(actionSheetMarkdown, /Verified claims:/);
  assert.match(actionSheetMarkdown, /Recheck steps:/);
  assert.match(actionSheetMarkdown, /Copy packet:/);
  assert.doesNotMatch(actionSheetMarkdown, /Auto-send/);
  const nextWorkRun = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-next-work-run.json"), "utf8"));
  assert.equal(nextWorkRun.status, "needs_operator");
  assert.equal(nextWorkRun.rows.length, 5);
  assert.equal(nextWorkRun.rows[0].id, "developer_app:instagram");
  const nextWorkRunMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-next-work-run.md"), "utf8");
  assert.match(nextWorkRunMarkdown, /Clippers External Next Work Run/);
  assert.match(nextWorkRunMarkdown, /Apply ready/);
  assert.match(nextWorkRunMarkdown, /Portal Sessions/);
  assert.match(nextWorkRunMarkdown, /Copy packet:/);
  assert.match(nextWorkRunMarkdown, /Evidence CSV fields to fill:/);
  const nextWorkRunCsv = await readFile(path.join(rootDir, "reports/clippers-external-next-work-run.csv"), "utf8");
  assert.match(nextWorkRunCsv, /order,id,lane,platform,required_status.*copy_packet/);
  assert.match(nextWorkRunCsv, /developer_app:instagram/);
  const productionPublicUrl = JSON.parse(await readFile(path.join(rootDir, "production-public-url.json"), "utf8")).publicBaseUrl.replace(/\/$/, "");
  const productionPublicUrlPattern = regexEscape(productionPublicUrl);
  const developerProof = await readFile(path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md"), "utf8");
  assert.match(developerProof, /App identifier\/client key\/project ID is public-safe/);
  assert.match(developerProof, /No client private value/);
  assert.match(developerProof, /Evidence CSV fields to fill/);
  assert.match(developerProof, /- app_identifier:/);
  assert.match(developerProof, new RegExp(`- public_base_url: ${productionPublicUrlPattern}`));
  assert.match(developerProof, new RegExp(`- redirect_uri: ${productionPublicUrlPattern}/api/clippers/oauth/tiktok/callback`));

  const importer = await readFile(path.join(process.cwd(), "script/clippers-import-external-closeout-evidence.ts"), "utf8");
  assert.match(importer, /const batchRejected = batchResult\?\.launchEvidenceBatch\.rejected\.length \|\| 0/);
  assert.match(importer, /batchRejected === 0/);
  assert.match(importer, /rejected\.length \|\| strictBlocked \|\| batchRejected/);
  assert.match(importer, /--apply-ready/);
  assert.match(importer, /partial_ready_to_apply/);
  assert.match(importer, /partial_import_applied/);

  const source = await readFile(path.join(process.cwd(), "script/clippers-external-closeout-pack.mjs"), "utf8");
  assert.match(source, /const blocked = tasks\.length > 0 \|\| safeOperationalBlockers\.length > 0/);
  assert.match(source, /status: blocked \? "blocked_external_actions" : "ready_for_final_review"/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/external-closeout-proof-todo/);
  assert.match(routes, /\/api\/clippers\/external-closeout-operator-queue/);
  assert.match(routes, /\/api\/clippers\/external-closeout-batches/);
  assert.match(routes, /\/api\/clippers\/external-closeout-next-action/);
  assert.match(routes, /\/api\/clippers\/external-next-work-run/);
  assert.match(routes, /\/api\/clippers\/prepare-external-next-work-run/);
  assert.match(routes, /externalCloseoutOperatorQueue/);
  assert.match(routes, /externalCloseoutNextAction/);
  assert.match(routes, /externalCloseoutNextWorkRun/);
  assert.match(routes, /copyPacket/);
  assert.match(routes, /Do not paste passwords/);
  assert.match(routes, /External Closeout Proof Todo/);
  assert.match(routes, /External Go-Live Audit \+ Repair Queue/);
  assert.match(routes, /data-proof-todo-action="load"/);
  assert.match(routes, /data-go-live-audit-action="load"/);
  assert.match(routes, /loadExternalCloseoutProofTodo/);
  assert.match(routes, /loadExternalGoLiveAudit/);
  assert.match(routes, /Operator queue/);
  assert.match(routes, /Repair rows/);
  assert.match(routes, /First repair copy packet/);
  assert.match(routes, /\/api\/clippers\/preview-external-closeout-evidence-import/);
  assert.match(routes, /\/api\/clippers\/apply-external-closeout-evidence-import/);
  assert.match(routes, /\/api\/clippers\/apply-ready-external-closeout-evidence-import/);
  assert.match(routes, /x-clippers-operator-confirm/);
  assert.match(routes, /apply-ready-external-closeout-evidence/);
  assert.match(routes, /Apply ready rows/);
  assert.match(routes, /data-closeout-action="apply-ready"/);
  assert.match(routes, /Operator confirmation header required/);
  assert.match(routes, /await runClipperExternalCloseoutPack\(\)/);
  assert.match(routes, /externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue\(\)/);
  assert.match(routes, /externalCloseoutNextWorkRun: await readClipperExternalCloseoutNextWorkRun\(\)/);
  assert.match(routes, /Failed to prepare clippers external next work run/);

  const ui = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-proof-todo"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-operator-queue"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-batches"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-closeout-next-action"\]/);
  assert.match(ui, /queryKey: \["\/api\/clippers\/external-next-work-run"\]/);
  assert.match(ui, /\/api\/clippers\/prepare-external-next-work-run/);
  assert.match(ui, /data-testid="clippers-external-closeout-proof-todo"/);
  assert.match(ui, /data-testid="clippers-external-closeout-operator-queue"/);
  assert.match(ui, /data-testid="clippers-external-closeout-batches-handoff"/);
  assert.match(ui, /data-testid="clippers-external-closeout-next-action"/);
  assert.match(ui, /data-testid="clippers-external-action-sheet"/);
  assert.match(ui, /External Operator Action Sheet/);
  assert.match(ui, /data-testid="clippers-external-work-run"/);
  assert.match(ui, /data-testid="prepare-clippers-external-next-work-run-button"/);
  assert.match(ui, /visibleExternalNextWorkRun/);
  assert.match(ui, /workSession/);
  assert.match(ui, /nextWorkRunMarkdown/);
  assert.match(ui, /targetMinutes/);
  assert.match(ui, /Apply ready/);
  assert.match(ui, /data-testid="clippers-external-portal-closeout-board"/);
  assert.match(ui, /portalCloseoutBoard/);
  assert.match(ui, /Account setup cards/);
  assert.match(ui, /Developer app cards/);
  assert.match(ui, /Permission request cards/);
  assert.match(ui, /Official source cards/);
  assert.match(ui, /officialSourceCards/);
  assert.match(ui, /data-testid="clippers-external-go-live-audit"/);
  assert.match(ui, /data-testid="clippers-external-go-live-work-blocks"/);
  assert.match(ui, /data-testid="clippers-external-go-live-repair-queue"/);
  assert.match(ui, /\(externalCloseoutPack\.goLiveAudit\.evidenceRepairQueue \|\| \[\]\)\.slice\(0, 8\)/);
  assert.match(ui, /<details/);
  assert.match(ui, /row\.copyPacket/);
  assert.match(ui, /External Go-Live Audit/);
  assert.match(ui, /externalCloseoutNextAction\.copyPacket/);
  assert.match(ui, /Operator Queue/);
  assert.match(ui, /Artifact safety/);
  assert.match(ui, /row\.blockers\.slice\(0, 2\)/);
  assert.match(ui, /data-testid="clippers-external-closeout-evidence-import"/);
  assert.match(ui, /data-testid="preview-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="apply-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="apply-ready-clippers-external-closeout-evidence-import-button"/);
  assert.match(ui, /data-testid="clippers-external-closeout-accepted-rows"/);
  assert.match(ui, /Apply ready/);
  assert.match(ui, /Accepted rows ready for apply/);
  assert.match(ui, /Copy starter/);
  assert.match(ui, /row\.safeProofStarter/);
  assert.match(ui, /x-clippers-operator-confirm/);
  assert.match(ui, /setQueryData\(\["\/api\/clippers\/external-closeout-operator-queue"\]/);
});

test("external closeout pack redacts unsafe official source-card fields", async () => {
  const auditPath = path.join(rootDir, "official-permission-source-audit.json");
  const originalAudit = await readFile(auditPath, "utf8");
  const audit = JSON.parse(originalAudit);
  audit.markdownPath = "https://proof.example/report?access=unsafe-source-audit";
  audit.items[0].sourceStatus = "client_secret";
  audit.items[0].accessMode = "cookie";
  audit.items[0].submitDecision = "api_key";
  audit.items[0].officialUrls = ["https://developers.tiktok.com/doc/content-posting-api-get-started/?access=unsafe-source"];
  audit.items[0].verifiedClaims = ["Official claim with https://example.com/proof?signature=unsafe-source"];

  try {
    await writeFile(auditPath, JSON.stringify(audit, null, 2));
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const actionSheet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.json"), "utf8"));
    const tiktokSourceCard = actionSheet.officialSourceCards.find((card) => card.scope === "video.publish");
    assert.ok(tiktokSourceCard);
    assert.equal(tiktokSourceCard.sourceStatus, "[redacted unsafe official source reference]");
    assert.equal(tiktokSourceCard.accessMode, "[redacted unsafe official source reference]");
    assert.equal(tiktokSourceCard.submitDecision, "[redacted unsafe official source reference]");
    assert.deepEqual(tiktokSourceCard.officialUrls, ["[redacted unsafe official source reference]"]);
    assert.equal(tiktokSourceCard.primaryOfficialUrl, "[redacted unsafe official source reference]");
    assert.equal(tiktokSourceCard.sourceAuditPath, "[redacted unsafe official source reference]");
    assert.deepEqual(tiktokSourceCard.verifiedClaims, ["[redacted unsafe official source reference]"]);

    const actionSheetMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-operator-action-sheet.md"), "utf8");
    assert.doesNotMatch(actionSheetMarkdown, /unsafe-source|unsafe-source-audit|client_secret|api_key|signature=/);
  } finally {
    await writeFile(auditPath, originalAudit);
    const restore = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  }
});

test("external closeout evidence importer rejects placeholders without applying", async () => {
  const packResult = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(packResult.status, 0, packResult.stderr || packResult.stdout);

  const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_invalid_evidence");
  assert.equal(output.applied, 0);
  assert.ok(output.rejected > 0);

  const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
  assert.equal(report.mode, "preview");
  assert.ok(report.rejected.some((row) =>
    row.reason.includes("Proof file todavia contiene placeholders")
    || row.reason.includes("Status ambiguo")
    || row.reason.includes("placeholders")
    || row.reason.includes("needs_real_proof")
  ));
  assert.equal(report.repairSummary.priorityPolicy.activeFirst[0], "tiktok");
  assert.equal(report.repairSummary.nextRepair.platform, "tiktok");
  assert.equal(report.repairSummary.nextRepair.priorityLabel, "TikTok first");
  assert.equal(report.repairQueue[0].platform, "tiktok");
  assert.equal(report.repairQueue[0].priorityLabel, "TikTok first");
  const repairWorkPacket = JSON.parse(await readFile(report.paths.repairWorkPacketJson, "utf8"));
  assert.ok(repairWorkPacket.guardrails.some((guardrail) => guardrail.includes("prioritizes TikTok")));
  assert.equal(repairWorkPacket.groups[0].platform, "tiktok");
  assert.equal(repairWorkPacket.groups[0].lane, "account");
  assert.equal(repairWorkPacket.groups[0].priority, 0);
  assert.equal(repairWorkPacket.groups[0].priorityLabel, "TikTok first");
});

test("TikTok external closeout session surfaces active Metricool MVP proof blockers before deferred backlog", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const now = new Date();
  await utimes(evidenceCsvPath, now, now);
  const validate = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);

  const result = spawnSync(process.execPath, ["script/clippers-tiktok-external-closeout-session.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "needs_tiktok_external_closeout");
  assert.ok(output.tiktokTasks >= 4);
  assert.equal(output.firstTask, "account-proof:sports-daily:tiktok");

  const session = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-external-closeout-session.json"), "utf8"));
  assert.equal(session.source.metricoolMvpReady, false);
  assert.deepEqual(session.source.activeMetricoolAccountIds, ["sports-daily", "meme-radar"]);
  assert.equal(session.source.activeMvpProofRows, 4);
  assert.ok(session.totals.activeTasks >= 4);
  assert.ok(session.totals.deferredTasks >= 0);
  assert.ok(session.totals.account >= 2);
  assert.ok(session.totals.developerApp >= 0);
  assert.ok(session.totals.permission >= 0);
  assert.equal(session.totals.metricoolBridge, 2);
  assert.ok(session.totals.blocked >= 4);
  assert.ok(session.tasks.every((task) => task.closeoutId.includes("tiktok")));
  assert.equal(session.activeTasks.every((task) => task.activeForMetricoolMvp === true), true);
  assert.equal(session.deferredTasks.every((task) => task.deferredForMetricoolMvp === true), true);
  assert.equal(session.tasks[0].closeoutId, "account-proof:sports-daily:tiktok");
  assert.equal(session.tasks.slice(0, 4).every((task) => task.activeForMetricoolMvp === true), true);
  assert.deepEqual(session.tasks.slice(0, 4).map((task) => task.closeoutId), [
    "account-proof:sports-daily:tiktok",
    "metricool-bridge-proof:sports-daily:tiktok",
    "account-proof:meme-radar:tiktok",
    "metricool-bridge-proof:meme-radar:tiktok",
  ]);
  assert.equal(session.tasks[0].proofType, "account_ownership");
  assert.match(session.tasks[0].nextAction, /Confirm the TikTok account\/profile is real and connected/);
  assert.doesNotMatch(session.tasks[0].nextAction, /Create\/verify/);
  assert.equal(session.tasks.find((task) => task.closeoutId === "metricool-bridge-proof:sports-daily:tiktok")?.proofType, "metricool_connection");
  assert.match(session.tasks.find((task) => task.closeoutId === "metricool-bridge-proof:sports-daily:tiktok")?.nextAction || "", /Preview\/Import the bridge CSV/);
  assert.equal(session.tasks.find((task) => task.lane === "developer_app")?.deferredReason, "direct_api_not_required_for_metricool_mvp");
  assert.equal(session.tasks.find((task) => task.closeoutId === "account:streamer-pulse:tiktok")?.deferredReason, "account_not_in_current_metricool_tiktok_mvp");
  assert.match(session.tasks[0].copyPacket, /Do not paste passwords/);
  assert.match(session.tasks[0].csvRowTemplate, /sports-daily/);
  assert.equal(/client_secret=|access_token=|refresh_token=|bearer\s+[a-z0-9._-]+/i.test(session.tasks.map((task) => task.csvRowTemplate).join("\n")), false);
  assert.equal(session.proofLinksFlow.status, "needs_real_proof_links");
  assert.deepEqual(session.proofLinksFlow.checklist.map((item) => item.id), [
    "copy_packet",
    "fill_real_proofs",
    "preview_proof_links",
    "save_and_ingest",
    "load_bridge_csv",
    "preview_bridge_rows",
    "import_bridge_rows",
    "rerun_readiness",
  ]);
  assert.ok(session.proofLinksFlow.checklist.every((item) => item.expectedGate && item.nextButton));
  assert.match(session.proofLinksFlow.checklist.find((item) => item.id === "preview_bridge_rows")?.expectedGate || "", /ready_for_import/);
  assert.match(session.proofLinksFlow.checklist.find((item) => item.id === "rerun_readiness")?.expectedGate || "", /without enabling real publishing/);
  assert.doesNotMatch(JSON.stringify(session.proofLinksFlow), /ready_to_send|realPublishEnabled\s*:\s*true|access_token=|refresh_token=|client_secret=/i);
  assert.match(session.paths.proofLinksPastePacket, /clippers-tiktok-external-closeout-proof-links-paste-packet\.txt$/);
  assert.match(session.paths.proofLinksFilledDrop, /proof-links-paste-packet-filled\.txt$/);
  assert.match(session.proofLinksPastePacket, /sports-daily:tiktok\.accountOwnershipProofUrl=/);
  assert.match(session.proofLinksPastePacket, /sports-daily:tiktok\.metricoolConnectionProofUrl=/);
  assert.match(session.proofLinksPastePacket, /meme-radar:tiktok\.accountOwnershipProofUrl=/);
  assert.match(session.proofLinksPastePacket, /meme-radar:tiktok\.metricoolConnectionProofUrl=/);
  assert.doesNotMatch(session.proofLinksPastePacket, /ready_to_send|realPublishEnabled\s*:\s*true|access_token=|refresh_token=|client_secret=/i);
  assert.match(session.nextStep, /account-proof:sports-daily:tiktok/);

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-external-closeout-session.md"), "utf8");
  assert.match(markdown, /Clippers TikTok External Closeout Session/);
  assert.match(markdown, /account-proof:sports-daily:tiktok/);
  assert.match(markdown, /metricool-bridge-proof:sports-daily:tiktok/);
  assert.match(markdown, /MVP Proof Links Paste Packet/);
  const pastePacket = await readFile(path.join(rootDir, "reports/clippers-tiktok-external-closeout-proof-links-paste-packet.txt"), "utf8");
  assert.equal(pastePacket, session.proofLinksPastePacket);
});

test("TikTok external closeout session blocks stale evidence import reports", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const validate = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);

  const future = new Date(Date.now() + 60_000);
  await utimes(evidenceCsvPath, future, future);
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-external-closeout-session.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "stale_evidence_import_report");
  assert.equal(output.tiktokTasks, 0);

  const session = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-external-closeout-session.json"), "utf8"));
  assert.equal(session.status, "stale_evidence_import_report");
  assert.equal(session.source.freshness.reportIsFresh, false);
  assert.equal(session.tasks.length, 0);
  assert.match(session.nextStep, /Run Validate again/);

  const now = new Date();
  await utimes(evidenceCsvPath, now, now);
  const restore = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  const restoreSession = spawnSync(process.execPath, ["script/clippers-tiktok-external-closeout-session.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(restoreSession.status, 0, restoreSession.stderr || restoreSession.stdout);
});

test("external closeout pack maps filled proof fields into evidence CSV", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const filledProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted in the official portal and proof is stored without secrets.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted in the official portal and proof is stored without secrets.");

  try {
    await writeFile(proofPath, filledProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
    assert.match(evidenceCsv, /developer_app","[^"]*","tiktok","submitted","[^"]*","tiktok-app-123"/);
    assert.match(evidenceCsv, /https:\/\/developers\.tiktok\.com\/apps\/tiktok-app-123/);
    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.blockers.some((blocker) => blocker.includes("app_identifier")), false);
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack blocks proof field secrets before writing reports", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const unsafeProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://developers.tiktok.com/apps/tiktok-app-123?token=unsafe")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted with client_secret accidentally pasted and must be blocked.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://developers.tiktok.com/apps/tiktok-app-123?token=unsafe")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted with client_secret accidentally pasted and must be blocked.");

  try {
    await writeFile(proofPath, unsafeProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const evidenceCsv = await readFile(path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv"), "utf8");
    const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.json"), "utf8"));
    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    assert.equal(JSON.stringify(pack).includes("token=unsafe"), false);
    assert.equal(JSON.stringify(pack).includes("client_secret"), false);
    assert.equal(pack.artifactSafety.status, "blocked_sensitive_artifact");
    assert.ok(pack.artifactSafety.findings.length > 0);
    assert.equal(evidenceCsv.includes("token=unsafe"), false);
    assert.equal(evidenceCsv.includes("client_secret"), false);
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "needs_real_proof");
    assert.ok(row.blockers.some((blocker) => blocker.includes("sensitive token")));
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack keeps unsafe filled proof rows in operator queue", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const unsafeProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://localhost/proof")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted in the official portal but the public URL still needs a real production domain.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace(/- public_base_url: https:\/\/[^\s]+/, "- public_base_url: https://localhost:5010")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://localhost/proof")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted in the official portal but public proof URL still points to localhost.");

  try {
    await writeFile(proofPath, unsafeProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.readyToApply, false);
    assert.ok(row.blockers.some((blocker) => blocker.includes("public_base_url")));
    assert.ok(row.blockers.some((blocker) => blocker.includes("proof URL")));
    const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
    assert.ok(operatorQueue.rows.some((item) => item.id === "developer_app:tiktok"));
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack keeps unsafe local proof paths in operator queue", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const shortLocalProofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/short-local-proof.md");
  const previousProof = await readFile(proofPath, "utf8");
  const unsafeProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", `Proof URL or secure local evidence path: ${shortLocalProofPath}`)
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 submitted")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was submitted in the official portal and local proof is referenced.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- proof: <paste real proof URL or local proof file path>", `- proof: ${shortLocalProofPath}`)
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was submitted in the official portal and local proof is referenced.");

  try {
    await writeFile(shortLocalProofPath, "too short");
    await writeFile(proofPath, unsafeProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.readyToApply, false);
    assert.ok(row.blockers.some((blocker) => blocker.includes("local proof file is too short")));
    const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
    assert.ok(operatorQueue.rows.some((item) => item.id === "developer_app:tiktok"));
  } finally {
    await writeFile(proofPath, previousProof);
    await unlink(shortLocalProofPath).catch(() => undefined);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout pack keeps non-closeout statuses in operator queue", async () => {
  const proofPath = path.join(rootDir, "evidence-drop/external-closeout-proofs/developer_app-tiktok.md");
  const previousProof = await readFile(proofPath, "utf8");
  const rejectedProof = previousProof
    .replace("Status: needs_real_proof", "Status: proof_file_filled")
    .replace("Proof URL or secure local evidence path: <paste real proof URL or secure local evidence path>", "Proof URL or secure local evidence path: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("Portal/ticket/case/profile reference: <paste real reference>", "Portal/ticket/case/profile reference: TikTok app tiktok-app-123 rejected")
    .replace("Operator notes: <write at least one sentence confirming the external portal action is real>", "Operator notes: TikTok developer app was rejected in the official portal and must stay in the operator queue.")
    .replace(/- app_identifier:\s*$/m, "- app_identifier: tiktok-app-123")
    .replace("- status: submitted", "- status: rejected")
    .replace("- proof: <paste real proof URL or local proof file path>", "- proof: https://developers.tiktok.com/apps/tiktok-app-123")
    .replace("- notes: <write one sentence confirming the portal action and where proof lives>", "- notes: TikTok developer app was rejected in the official portal and must stay in the operator queue.");

  try {
    await writeFile(proofPath, rejectedProof);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const proofTodo = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json"), "utf8"));
    const row = proofTodo.rows.find((item) => item.id === "developer_app:tiktok");
    assert.equal(row.proofStatus, "proof_file_filled");
    assert.equal(row.readyToApply, false);
    assert.ok(row.blockers.some((blocker) => blocker.includes("status must be one of submitted, approved")));
    const operatorQueue = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-operator-queue.json"), "utf8"));
    assert.ok(operatorQueue.rows.some((item) => item.id === "developer_app:tiktok"));
  } finally {
    await writeFile(proofPath, previousProof);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout evidence importer previews clean rows for strict apply", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const cleanCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,YouTube channel verified with manager proof and 2FA evidence stored outside repo",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,Evidence from YouTube ticket YT-123 confirms app review submitted without secrets",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,TikTok video.publish scope requested with reviewer note for owned clips approval queue",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, cleanCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "ready_to_apply");
    assert.equal(output.accepted, 3);
    assert.equal(output.rejected, 0);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.equal(report.nextStep.includes("--apply"), true);
    assert.equal(JSON.stringify(report).includes("client_secret"), false);
    assert.equal(JSON.stringify(report).includes("access_token"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout pack blocks stale evidence import reports after CSV changes", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const reportPath = path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousReport = await readFile(reportPath, "utf8").catch(() => null);
  const cleanCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,YouTube channel verified with manager proof and 2FA evidence stored outside repo",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, cleanCsv);
    const preview = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.equal(JSON.parse(preview.stdout).status, "ready_to_apply");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(evidenceCsvPath, `${cleanCsv}\n`);
    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.json"), "utf8"));
    assert.equal(pack.evidenceImportFreshness.status, "stale_report");
    assert.equal(pack.evidenceImportFreshness.reportIsFresh, false);
    const audit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-go-live-audit.json"), "utf8"));
    const evidenceGate = audit.gates.find((gate) => gate.id === "evidence_import");
    assert.equal(evidenceGate.status, "blocked");
    assert.match(evidenceGate.blocker, /stale_evidence_import_report/);
    assert.equal(audit.totals.evidenceAccepted, 0);
    const markdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-pack.md"), "utf8");
    assert.match(markdown, /Freshness: stale_report/);
    assert.match(markdown, /Run Validate again before applying anything/);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousReport === null) await unlink(reportPath).catch(() => undefined);
    else await writeFile(reportPath, previousReport);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("external closeout evidence importer can apply accepted rows while leaving rejected rows blocked", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const accountEvidencePath = path.join(rootDir, "account-evidence/meme-radar-youtube.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousAccountEvidence = await readFile(accountEvidencePath, "utf8").catch(() => null);
  const partialCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,YouTube account verified by Robert with manager access and non-secret proof reference",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,ok",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, partialCsv);
    const preview = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const previewOutput = JSON.parse(preview.stdout);
    assert.equal(previewOutput.status, "partial_ready_to_apply");
    assert.equal(previewOutput.accepted, 1);
    assert.equal(previewOutput.rejected, 1);
    assert.equal(previewOutput.applied, 0);

    const applyReady = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts", "--apply-ready"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(applyReady.status, 0, applyReady.stderr || applyReady.stdout);
    const applyReadyOutput = JSON.parse(applyReady.stdout);
    assert.equal(applyReadyOutput.status, "partial_import_applied");
    assert.equal(applyReadyOutput.accepted, 1);
    assert.equal(applyReadyOutput.rejected, 1);
    assert.equal(applyReadyOutput.applied, 1);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.equal(report.mode, "apply_ready");
    assert.ok(report.nextStep.includes("filas rechazadas restantes"));
    assert.equal(report.repairSummary.status, "needs_repair");
    assert.equal(report.repairSummary.totalRejected, 1);
    assert.ok(report.repairSummary.topReasons.length > 0);
    assert.ok(report.repairSummary.nextStep.includes("Fix CSV row"));
    assert.match(report.repairSummary.nextRepairPacket, /Next evidence repair:/);
    assert.match(report.repairSummary.nextRepairPacket, /Proof file:/);
    assert.match(report.repairSummary.nextRepairPacket, /CSV row template:/);
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /permission/);
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /video\.publish/);
    assert.match(report.repairQueue[0].csvRowTemplate, /permission/);
    assert.match(report.repairQueue[0].csvRowTemplate, /video\.publish/);
    assert.equal(report.paths.repairTemplatesCsv.endsWith("clippers-external-closeout-repair-row-templates.csv"), true);
    const repairTemplatesCsv = await readFile(report.paths.repairTemplatesCsv, "utf8");
    assert.match(repairTemplatesCsv, /source_csv_row,closeout_id,lane,platform,account_id,scope,required_status,proof_path,replacement_csv_row/);
    assert.match(repairTemplatesCsv, /video\.publish/);
    assert.equal(report.paths.repairWorkPacketJson.endsWith("clippers-external-closeout-repair-work-packet.json"), true);
    assert.equal(report.paths.repairWorkPacketMarkdown.endsWith("clippers-external-closeout-repair-work-packet.md"), true);
    const repairWorkPacket = JSON.parse(await readFile(report.paths.repairWorkPacketJson, "utf8"));
    assert.equal(repairWorkPacket.totalItems, report.repairQueue.length);
    assert.ok(repairWorkPacket.groups.length > 0);
    assert.match(JSON.stringify(repairWorkPacket), /video\.publish/);
    assert.equal(/token=|client_secret=|api_key=|session=|bearer\s+[a-z0-9._-]+/i.test(JSON.stringify(repairWorkPacket)), false);
    const accountEvidence = JSON.parse(await readFile(accountEvidencePath, "utf8"));
    assert.equal(accountEvidence.status, "verified");
    assert.match(accountEvidence.notes, /meme-radar-youtube-proof/);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousAccountEvidence === null) await unlink(accountEvidencePath).catch(() => undefined);
    else await writeFile(accountEvidencePath, previousAccountEvidence);
  }
});

test("external closeout evidence importer rejects secrets in persisted fields", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,youtube,submitted,," +
      "sk-secret-test-value,https://app.clipprreview.com?api_key=unsafe," +
      "https://app.clipprreview.com/api/clippers/oauth/youtube/callback," +
      "https://console.cloud.google.com/apis/library/youtube.googleapis.com,," +
      "https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001," +
      "YouTube app review submitted with normal portal proof",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 1);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.equal(JSON.stringify(report).includes("sk-secret-test-value"), false);
    assert.equal(JSON.stringify(report).includes("api_key=unsafe"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects non-closeout statuses with valid proof", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const wrongStatusCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,submitted,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,Submitted account proof is not enough for external closeout until account is verified",
    "developer_app,,youtube,draft,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,Draft app proof is not enough for external closeout until app is submitted or approved",
    "permission,,tiktok,blocked,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,Blocked permission proof is not enough for external closeout until permission is requested or approved",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, wrongStatusCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 3);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("Account closeout status debe ser verified")));
    assert.ok(report.rejected.some((row) => row.reason.includes("Developer app closeout status debe ser submitted o approved")));
    assert.ok(report.rejected.some((row) => row.reason.includes("Permission closeout status debe ser requested o approved")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects weak notes with valid proof", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const weakNotesCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/meme-radar-youtube-proof/view,ok",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,approved",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,<paste notes here>",
    "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,,https://console.cloud.google.com/,https://developers.google.com/youtube/v3/guides/uploading_a_video,https://console.cloud.google.com/apis/credentials,too short",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, weakNotesCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 4);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("al menos 20 caracteres")));
    assert.ok(report.rejected.some((row) => row.reason.includes("ok/yes/done/approved")));
    assert.ok(report.rejected.some((row) => row.reason.includes("placeholder")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer rejects fake accounts scopes and generic notes", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const proofTodoPath = path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousProofTodo = await readFile(proofTodoPath, "utf8").catch(() => null);
  const fakeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,fake-account,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://drive.google.com/file/d/fake-account-proof/view,Fake account verified in official portal with non-secret proof reference",
    "permission,,tiktok,requested,fake.scope,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://developers.tiktok.com/apps/tiktok-prod-001/review,Fictitious scope requested in official portal with non-secret proof reference",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,The proof is attached in external portal and stored externally",
  ].join("\n") + "\n";

  try {
    const proofTodo = JSON.parse(previousProofTodo || "{}");
    proofTodo.rows = [
      ...(Array.isArray(proofTodo.rows) ? proofTodo.rows : []),
      { lane: "account", accountId: "fake-account", platform: "youtube", requiredCsvStatus: "verified" },
      { lane: "permission", platform: "tiktok", scope: "fake.scope", requiredCsvStatus: "requested" },
    ];
    await writeFile(proofTodoPath, JSON.stringify(proofTodo, null, 2));
    await writeFile(evidenceCsvPath, fakeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 3);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("cuentas inventadas")));
    assert.ok(report.rejected.some((row) => row.reason.includes("permiso inventado")));
    assert.ok(report.rejected.some((row) => row.reason.includes("accion externa concreta")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousProofTodo === null) await unlink(proofTodoPath).catch(() => undefined);
    else await writeFile(proofTodoPath, previousProofTodo);
  }
});

test("external closeout evidence importer mirrors strict developer app apply validation", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,youtube,draft,,,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/cloud-resource-manager?project=youtube-prod-001,Draft app still needs the real project id before preview can be ready",
    "developer_app,,tiktok,submitted,,tiktok-prod-001,https://localhost:5010,https://localhost:5010/api/clippers/oauth/tiktok/callback,https://developers.tiktok.com/,,https://developers.tiktok.com/apps/tiktok-prod-001,Submitted app with localhost public base URL must not be ready",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 2);
    assert.equal(output.applied, 0);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("Developer app closeout status debe ser submitted o approved")));
    assert.ok(report.rejected.some((row) => row.reason.includes("public_base_url HTTPS publico real")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer redacts unsafe proof-todo redirect metadata from repair template", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const proofTodoPath = path.join(rootDir, "reports/clippers-external-closeout-proof-todo.json");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const previousProofTodo = await readFile(proofTodoPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "developer_app,,tiktok,submitted,,tiktok-prod-001,https://localhost:5010,https://localhost:5010/api/clippers/oauth/tiktok/callback?token=unsafe,https://developers.tiktok.com/,,https://developers.tiktok.com/apps/tiktok-prod-001,Submitted app with localhost public base URL must not be ready",
  ].join("\n") + "\n";

  try {
    const proofTodo = JSON.parse(previousProofTodo || "{}");
    proofTodo.rows = (Array.isArray(proofTodo.rows) ? proofTodo.rows : []).map((row) => {
      if (row.id !== "developer_app:tiktok") return row;
      return {
        ...row,
        redirectUri: "https://localhost:5010/api/clippers/oauth/tiktok/callback?token=unsafe",
      };
    });
    await writeFile(proofTodoPath, JSON.stringify(proofTodo, null, 2));
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 1);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /developer_app/);
    assert.match(report.repairQueue[0].csvRowTemplate, /developer_app/);
    assert.match(report.repairSummary.nextRepairCsvRowTemplate, /<paste public https base url>/);
    assert.match(report.repairQueue[0].csvRowTemplate, /<paste public https base url>/);
    assert.doesNotMatch(report.repairSummary.nextRepairCsvRowTemplate, /https:\/\/localhost|token=unsafe/);
    assert.doesNotMatch(report.repairSummary.nextRepairPacket, /https:\/\/localhost|token=unsafe/);
    assert.doesNotMatch(report.repairQueue[0].csvRowTemplate, /https:\/\/localhost|token=unsafe/);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    if (previousProofTodo === null) await unlink(proofTodoPath).catch(() => undefined);
    else await writeFile(proofTodoPath, previousProofTodo);
  }
});

test("external closeout evidence importer rejects unsafe remote proof URLs", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);
  const unsafeCsv = [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    "account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,http://localhost:5010/proof,Localhost proof should not count as external evidence",
    "permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://proof.example.com/tiktok-video-publish,Example domain proof should not count as real evidence",
    "account,sports-daily,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://localhost/proof,HTTPS localhost proof should not count as external evidence",
    "account,streamer-pulse,youtube,verified,,,,,https://www.youtube.com/create_channel,,https://127.0.0.1/proof,HTTPS loopback proof should not count as external evidence",
    "permission,,tiktok,requested,video.upload,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,https://[::1]/proof,IPv6 loopback proof should not count as external evidence",
    "permission,,instagram,requested,instagram_content_publish,,,,https://developers.facebook.com/,https://developers.facebook.com/docs/instagram-platform/,https://test/proof,Bare test proof should not count as real evidence",
    "developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,https://console.cloud.google.com/proof?token=unsafe,Proof URL query token should be rejected",
  ].join("\n") + "\n";

  try {
    await writeFile(evidenceCsvPath, unsafeCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_invalid_evidence");
    assert.equal(output.accepted, 0);
    assert.equal(output.rejected, 7);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("HTTPS")));
    assert.ok(report.rejected.some((row) => row.reason.includes("dominio publico real")));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.equal(JSON.stringify(report).includes("token=unsafe"), false);
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
  }
});

test("external closeout evidence importer validates local proof files without symlink escape", async () => {
  const evidenceCsvPath = path.join(rootDir, "evidence-drop/external-closeout-evidence-import.csv");
  const proofDir = path.join(rootDir, "evidence-drop", "test-proofs");
  const cleanProofPath = path.join(proofDir, "clean-proof.md");
  const shortProofPath = path.join(proofDir, "short-proof.md");
  const placeholderProofPath = path.join(proofDir, "stub-proof.md");
  const secretProofPath = path.join(proofDir, "secret-proof.md");
  const queryTokenProofPath = path.join(proofDir, "query-token-proof.md");
  const missingProofPath = path.join(proofDir, "missing-proof.md");
  const symlinkPath = path.join(proofDir, "escape-proof.md");
  const outsideProofPath = path.join("/private/tmp", "clippers-proof-escape.md");
  const previousCsv = await readFile(evidenceCsvPath, "utf8").catch(() => null);

  try {
    await mkdir(proofDir, { recursive: true });
    await writeFile(cleanProofPath, "Robert verified the channel ownership in the official portal on 2026-06-22. Case MC-456 confirms manager access and the approval record matches the external account.");
    await writeFile(shortProofPath, "too short");
    await writeFile(placeholderProofPath, "Status: needs_real_proof\nProof URL: <paste real proof URL or secure local evidence path>\nThis stub must not pass validation.");
    await writeFile(secretProofPath, "Robert verified the channel ownership in the official portal on 2026-06-22. access_token should never be stored here.");
    await writeFile(queryTokenProofPath, "Robert verified the portal action and stored the official ticket reference. The proof link https://platform.example.com/review?token=unsafe should be rejected because signed/tokenized proof URLs must not be stored.");
    await writeFile(outsideProofPath, "This outside workspace file is long enough to prove that symlink escapes must be rejected by realpath validation.");
    await symlink(outsideProofPath, symlinkPath).catch(() => undefined);

    const localCsv = [
      "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
      `account,meme-radar,youtube,verified,,,,,https://www.youtube.com/create_channel,,${cleanProofPath},Clean local proof should preview as accepted`,
      `account,sports-daily,youtube,verified,,,,,https://www.youtube.com/create_channel,,${shortProofPath},Short local proof should be rejected`,
      `account,streamer-pulse,youtube,verified,,,,,https://www.youtube.com/create_channel,,${placeholderProofPath},Stub local proof should be rejected by proof content validation`,
      `permission,,tiktok,requested,video.publish,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,${secretProofPath},Secret local proof should be rejected`,
      `permission,,instagram,requested,instagram_basic,,,,https://developers.facebook.com/,https://developers.facebook.com/docs/instagram-platform/,${queryTokenProofPath},Query-token local proof should be rejected`,
      `permission,,tiktok,requested,video.upload,,,,https://developers.tiktok.com/,https://developers.tiktok.com/doc/content-posting-api-get-started/,${missingProofPath},Missing local proof should be rejected`,
      `developer_app,,youtube,submitted,,youtube-prod-001,https://app.clipprreview.com,https://app.clipprreview.com/api/clippers/oauth/youtube/callback,https://console.cloud.google.com/apis/library/youtube.googleapis.com,,${symlinkPath},Symlink escape should be rejected`,
    ].join("\n") + "\n";

    await writeFile(evidenceCsvPath, localCsv);
    const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "partial_ready_to_apply");
    assert.equal(output.accepted, 1);
    assert.equal(output.rejected, 6);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-external-closeout-evidence-import-report.json"), "utf8"));
    assert.ok(report.rejected.some((row) => row.reason.includes("demasiado corto")));
    assert.ok(report.rejected.some((row) => row.reason.includes("placeholders")));
    assert.ok(report.rejected.some((row) => row.reason.includes("secreto/token/password/cookie")));
    assert.ok(report.rejected.some((row) => row.reason.includes("no existe")));
    assert.ok(report.rejected.some((row) => row.reason.includes("fuera de clippers_workspace")));
  } finally {
    if (previousCsv === null) await unlink(evidenceCsvPath).catch(() => undefined);
    else await writeFile(evidenceCsvPath, previousCsv);
    await unlink(cleanProofPath).catch(() => undefined);
    await unlink(shortProofPath).catch(() => undefined);
    await unlink(placeholderProofPath).catch(() => undefined);
    await unlink(secretProofPath).catch(() => undefined);
    await unlink(queryTokenProofPath).catch(() => undefined);
    await unlink(missingProofPath).catch(() => undefined);
    await unlink(symlinkPath).catch(() => undefined);
    await unlink(outsideProofPath).catch(() => undefined);
  }
});

test("rights registration rejects unsafe Metricool queue state", async () => {
  const originalQueue = await readFile(queuePath, "utf8");
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = false;
    queue.totals = { ...(queue.totals || {}), readyToSend: 1 };
    queue.items = [{ id: "unsafe-test-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /publishMode is not explicitly approval_required|readyToSend items|can send now/);
  } finally {
    await writeFile(queuePath, originalQueue);
  }
});

test("account permission readiness rejects unsafe Metricool queue state", async () => {
  const originalQueue = await readFile(queuePath, "utf8");
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = false;
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 1 };
    queue.items = [{ id: "unsafe-test-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.metricoolReadyLanes, 0);

    const readiness = JSON.parse(await readFile(accountPath, "utf8"));
    assert.equal(readiness.sourceReadiness.guardSafe, false);
    assert.ok(readiness.sourceReadiness.blockers.some((blocker) => blocker.includes("publishMode") || blocker.includes("readyToSend") || blocker.includes("can send now")));
    assert.equal(readiness.activeMvp.approvalRequired, false);
    assert.equal(readiness.activeMvp.requiredApprovalMode, "approval_required");
    assert.equal(readiness.activeMvp.realPublishEnabled, false);
    assert.equal(readiness.activeMvp.requiredRealPublishEnabled, false);
    assert.equal(readiness.activeMvp.readyToSend, 1);
    assert.ok(readiness.activeMvp.safetyBlockers.some((blocker) => blocker.includes("publishMode") || blocker.includes("readyToSend") || blocker.includes("can send now")));
    assert.match(readiness.activeMvp.nextStep, /Fix Metricool safety guard before importing bridge evidence/);
    assert.match(readiness.nextStep, /Fix Metricool safety guard before importing bridge evidence/);
    assert.doesNotMatch(readiness.nextStep, /^Preview\/import real non-secret Metricool bridge evidence/);
    assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.status, "blocked_metricool_safety");
    assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.approvalRequired, false);
    assert.equal(readiness.metricoolMvpEvidence.bridgeProofPack.readyToSend, 1);
    assert.ok(readiness.metricoolMvpEvidence.bridgeProofPack.safetyBlockers.some((blocker) => blocker.includes("publishMode") || blocker.includes("readyToSend") || blocker.includes("can send now")));
    assert.match(readiness.metricoolMvpEvidence.bridgeProofPack.nextStep, /Fix Metricool safety before collecting bridge proof/);
  } finally {
    await writeFile(queuePath, originalQueue);
    if (originalAccount !== null) await writeFile(accountPath, originalAccount);
  }
});

test("operational readiness blocks unsafe Metricool auto-publish state", async () => {
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalQueue = await readFile(queuePath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "auto_after_connection";
    queue.realPublishEnabled = true;
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 1 };
    queue.items = [{ id: "unsafe-operational-item", status: "ready_to_send", canSendNow: true }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.equal(output.metricoolMvpReady, false);
    assert.ok(output.metricoolMvpBlockers > 0);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.mvp.metricoolReady, false);
    assert.ok(report.metricoolMvpBlockers.length > 0);
  } finally {
    await writeFile(queuePath, originalQueue);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("external closeout blocks unsafe Metricool real publish state", async () => {
  const closeoutPath = path.join(rootDir, "reports/clippers-external-closeout-pack.json");
  const batchPath = path.join(rootDir, "reports/clippers-external-closeout-batches.json");
  const auditPath = path.join(rootDir, "reports/clippers-external-go-live-audit.json");
  const originalQueue = await readFile(queuePath, "utf8");
  const originalCloseout = await readFile(closeoutPath, "utf8").catch(() => null);
  const originalBatch = await readFile(batchPath, "utf8").catch(() => null);
  const originalAudit = await readFile(auditPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.status = "approval_required";
    queue.publishMode = "approval_required";
    queue.realPublishEnabled = true;
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 0 };
    queue.items = [{ id: "unsafe-closeout-item", status: "queued_for_approval", canSendNow: false }];
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.goLiveAuditStatus, "blocked_external_actions");

    const closeout = JSON.parse(await readFile(closeoutPath, "utf8"));
    assert.equal(closeout.metricool.publishMode, "approval_required");
    assert.equal(closeout.metricool.readyToSend, 0);
    assert.equal(closeout.metricool.realPublishEnabled, true);
    assert.equal(closeout.batchHandoff.totals.realPublishEnabled, true);
    assert.equal(closeout.goLiveAudit.gates.some((gate) =>
      gate.id === "metricool_publish_mode"
      && gate.status === "blocked"
      && gate.blocker.includes("realPublishEnabled is true")
    ), true);

    const batchHandoff = JSON.parse(await readFile(batchPath, "utf8"));
    assert.equal(batchHandoff.totals.realPublishEnabled, true);
    const batchMarkdown = await readFile(path.join(rootDir, "reports/clippers-external-closeout-batches.md"), "utf8");
    assert.match(batchMarkdown, /Real publish enabled: yes/);
  } finally {
    await writeFile(queuePath, originalQueue);
    if (originalCloseout === null) await unlink(closeoutPath).catch(() => undefined);
    else await writeFile(closeoutPath, originalCloseout);
    if (originalBatch === null) await unlink(batchPath).catch(() => undefined);
    else await writeFile(batchPath, originalBatch);
    if (originalAudit === null) await unlink(auditPath).catch(() => undefined);
    else await writeFile(auditPath, originalAudit);
    spawnSync(process.execPath, ["script/clippers-external-closeout-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("operational readiness rejects stale account readiness when source readiness is blocked", async () => {
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8");
  const originalQueue = await readFile(queuePath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    const queue = JSON.parse(originalQueue);
    queue.sourceReadiness = {
      ...(queue.sourceReadiness || {}),
      status: "blocked",
      totals: { ...(queue.sourceReadiness?.totals || {}), rightsReadyAssets: 0 },
      categories: [],
    };
    queue.totals = { ...(queue.totals || {}), queuedForApproval: 14, readyToSend: 0 };
    queue.status = "approval_required";
    queue.publishMode = "approval_required";
    queue.realPublishEnabled = false;
    await writeFile(queuePath, JSON.stringify(queue, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.metricoolMvpReady, false);
    assert.equal(output.fullDirectApiReady, false);

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.sources.sourceReadinessReady, false);
    assert.ok(report.blockers.some((blocker) => blocker.includes("source readiness")));
  } finally {
    await writeFile(accountPath, originalAccount);
    await writeFile(queuePath, originalQueue);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("operational readiness refreshes stale account permission readiness before reporting", async () => {
  const accountPath = path.join(rootDir, "account-permission-readiness.json");
  const reportPath = path.join(rootDir, "reports/clippers-operational-readiness.json");
  const originalAccount = await readFile(accountPath, "utf8");
  const originalReport = await readFile(reportPath, "utf8").catch(() => null);
  try {
    await writeFile(accountPath, JSON.stringify({
      status: "metricool_mvp_ready",
      totals: {
        accountProfiles: 9,
        verifiedAccounts: 9,
        metricoolReadyLanes: 9,
        directApiReadyLanes: 9,
        developerApps: 3,
        developerAppsApproved: 3,
        permissionGroups: 3,
        permissionGroupsApproved: 3,
      },
      sourceReadiness: {
        localOwnedSourceAssets: 999,
        connectedMetricoolRightsReadyAssets: 999,
        realPublishEnabled: false,
        publishMode: "approval_required",
      },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-operational-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.accounts.directApiReadyLanes, 0);
    assert.equal(report.fullDirectApiReady, false);
    assert.notEqual(report.accounts.verified, 9);
  } finally {
    await writeFile(accountPath, originalAccount);
    if (originalReport !== null) await writeFile(reportPath, originalReport);
  }
});

test("Clippers UI refreshes account permission readiness after evidence activation refresh", async () => {
  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.ok(page.includes("interface ClipperOperationalReadinessSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutPackSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutProofTodoSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutOperatorQueueSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutNextActionSummary"));
  assert.ok(page.includes("interface ClipperExternalCloseoutArtifactSafety"));
  assert.ok(page.includes('queryKey: ["/api/clippers/operational-readiness"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-pack"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-proof-todo"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-operator-queue"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-batches"]'));
  assert.ok(page.includes('queryKey: ["/api/clippers/external-closeout-next-action"]'));
  assert.ok(page.includes('fetch("/api/clippers/prepare-operational-readiness", { method: "POST" })'));
  assert.ok(page.includes('fetch("/api/clippers/prepare-external-closeout-pack", { method: "POST" })'));
  assert.ok(page.includes('data-testid="clippers-operational-readiness"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-pack"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-proof-todo"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-operator-queue"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-batches-handoff"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-next-action"'));
  assert.ok(page.includes('data-testid="clippers-metricool-bridge-evidence-batch"'));
  assert.ok(page.includes('data-testid="clippers-metricool-only-mvp-mode"'));
  assert.ok(page.includes("Metricool-only MVP"));
  assert.ok(page.includes("social APIs backlog"));
  assert.ok(page.includes("Metricool queued/scheduled items are not counted as published"));
  assert.ok(!page.includes('<SelectItem value="auto_after_connection">'));
  assert.ok(page.includes('data-testid="clippers-metricool-artifact-audit"'));
  assert.ok(page.includes("Metricool artifact audit"));
  assert.ok(page.includes('data-testid="prepare-clippers-metricool-100-operator-handoff-button"'));
  assert.ok(page.includes('data-testid="prepare-clippers-tiktok-launch-control-button"'));
  assert.ok(page.includes('data-testid="metricool-100-operator-handoff-panel"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-launch-control-panel"'));
  assert.ok(page.includes('data-testid="metricool-100-operator-console"'));
  assert.ok(page.includes('data-testid="metricool-100-current-batch-workbook"'));
  assert.ok(page.includes('data-testid="metricool-100-current-batch-operator-session"'));
  assert.ok(page.includes('data-testid="metricool-100-current-batch-source-gates"'));
  assert.match(page, /waiting source verification/);
  assert.match(page, /prepared for staged Metricool review/);
  assert.ok(page.includes('data-testid="metricool-100-all-batch-workbooks"'));
  assert.ok(page.includes("/api/clippers/metricool-100-operator-handoff"));
  assert.ok(page.includes("/api/clippers/prepare-metricool-100-operator-handoff"));
  assert.ok(page.includes("/api/clippers/tiktok-launch-control"));
  assert.ok(page.includes("/api/clippers/prepare-tiktok-launch-control"));
  assert.ok(page.includes("TikTok Launch Control"));
  assert.ok(page.includes('data-testid="preview-clippers-metricool-approval-evidence-button"'));
  assert.ok(page.includes('data-testid="clippers-metricool-approval-evidence-preview"'));
  assert.ok(page.includes("/api/clippers/preview-metricool-approval-evidence"));
  assert.ok(page.includes("Batch evidence dir"));
  assert.ok(page.includes("Batch evidence:"));
  assert.ok(page.includes('data-testid="submit-clippers-metricool-bridge-evidence-batch-button"'));
  assert.ok(page.includes("/api/clippers/record-metricool-bridge-evidence-batch"));
  assert.ok(page.includes('data-testid="clippers-external-work-run"'));
  assert.ok(page.includes('data-testid="clippers-external-work-run-steps"'));
  assert.ok(page.includes('data-testid="clippers-external-work-run-portal-sessions"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-work-run-button"'));
  assert.ok(page.includes('data-testid="clippers-external-closeout-repair-summary"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-next-repair-button"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-next-repair-csv-button"'));
  assert.ok(page.includes('data-testid="copy-clippers-external-repair-row-csv-button"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-external-closeout-session"'));
  assert.ok(page.includes('data-testid="prepare-clippers-tiktok-external-closeout-session-button"'));
  assert.ok(page.includes('data-testid="copy-clippers-tiktok-external-task-button"'));
  assert.ok(page.includes('data-testid="copy-clippers-tiktok-mvp-proof-links-packet-button"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-external-proof-links-flow"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-external-proof-links-checklist"'));
  assert.ok(page.includes('queryKey: ["/api/clippers/tiktok-external-closeout-session"]'));
  assert.ok(page.includes('/api/clippers/prepare-tiktok-external-closeout-session'));
  assert.ok(page.includes("Bridge:"));
  assert.ok(page.includes("totals.metricoolBridge"));
  assert.ok(page.includes("Proof type:"));
  assert.ok(page.includes("task.proofType"));
  assert.ok(page.includes("proofLinksPastePacket"));
  assert.ok(page.includes("proofLinksFlow"));
  assert.ok(page.includes("expectedGate"));
  assert.ok(page.includes("nextButton"));
  assert.ok(page.includes("priorityPolicy"));
  assert.ok(page.includes("priorityLabel"));
  assert.ok(page.includes("Active first:"));
  assert.ok(page.includes("row.priorityLabel"));
  assert.ok(page.includes("row.priority === 0"));
  assert.ok(page.includes('data-testid="clippers-full-readiness-gap"'));
  assert.ok(page.includes('data-testid="clippers-metricool-mvp-evidence-only"'));
  assert.ok(page.includes('data-testid="load-clippers-tiktok-metricool-bridge-template-button"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-metricool-bridge-preview"'));
  assert.ok(page.includes('data-testid="clippers-metricool-bridge-required-fields"'));
  assert.ok(page.includes("Public TikTok profile URL"));
  assert.ok(page.includes("Real HTTPS Metricool proof URL"));
  assert.ok(page.includes("20+ character operator notes"));
  assert.ok(page.includes("No passwords, tokens, cookies or private screenshots"));
  assert.ok(page.includes("bridgeEvidenceCsvPath"));
  assert.ok(page.includes("bridgeEvidenceTemplate"));
  assert.ok(page.includes("bridgeEvidencePreviewRows"));
  assert.ok(page.includes("bridgeProofPack"));
  assert.ok(page.includes('data-testid="clippers-tiktok-metricool-bridge-proof-pack"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-metricool-bridge-proof-pack-badge"'));
  assert.ok(page.includes("TikTok Metricool bridge proof pack"));
  assert.ok(page.includes("Safety: approvalRequired="));
  assert.ok(page.includes("Safety blockers:"));
  assert.ok(page.includes("bridgeOperatorCards"));
  assert.ok(page.includes('data-testid="clippers-tiktok-metricool-bridge-operator-cards"'));
  assert.ok(page.includes('data-testid="copy-clippers-tiktok-metricool-bridge-operator-card-button"'));
  assert.ok(page.includes("copyMetricoolBridgeOperatorPacket"));
  assert.ok(page.includes("Bridge packet copiado"));
  assert.ok(page.includes("TikTok lanes ready"));
  assert.ok(page.includes("tiktokMvpAccountCloseout.totals.ready"));
  assert.ok(page.includes("tiktokMvpBlockedLaneSummary"));
  assert.ok(page.includes("Still blocked:"));
  assert.ok(page.includes('data-testid="clippers-tiktok-mvp-account-closeout"'));
  assert.ok(page.includes('data-testid="clippers-tiktok-mvp-evidence-quality"'));
  assert.ok(page.includes('data-testid="clippers-account-evidence-quality"'));
  assert.ok(page.includes("Evidence quality:"));
  assert.ok(page.includes('data-testid="clippers-next-evidence-drop"'));
  assert.ok(page.includes('data-testid="clippers-next-evidence-cards"'));
  assert.ok(page.includes('data-testid="prepare-clippers-external-closeout-pack-button"'));
  assert.ok(page.includes("fullReadinessGap"));
  assert.ok(page.includes("previewCards"));
  assert.ok(page.includes("copyText"));
  assert.ok(page.includes("nextEvidenceDrop"));
  assert.ok(page.includes("metricoolMvpEvidence"));
  assert.ok(page.includes("activeMvp"));
  assert.ok(page.includes('data-testid="clippers-active-tiktok-mvp-now"'));
  assert.ok(page.includes('data-testid="clippers-active-tiktok-mvp-safety-blockers"'));
  assert.ok(page.includes('data-testid="clippers-active-tiktok-mvp-safe"'));
  assert.ok(page.includes("Active TikTok MVP now"));
  assert.ok(page.includes("Safety blocker first"));
  assert.ok(page.includes("Safety clear: Metricool remains approval_required"));
  assert.ok(page.includes("Metricool safety state is incomplete; refresh readiness before operating."));
  assert.ok(page.includes("fix safety guard"));
  assert.ok(page.includes("readyToSend"));
  assert.ok(page.includes("requiredApprovalMode"));
  assert.ok(page.includes("safetyBlockers"));
  assert.ok(page.includes("Bridge evidence CSV:"));
  assert.ok(page.includes('data-testid="clippers-tiktok-mvp-active-badge"'));
  assert.ok(page.includes("TikTok MVP"));
  assert.ok(page.includes("TikTok es el MVP activo"));
  assert.ok(page.includes("Metricool MVP evidence only"));
  assert.ok(page.includes("TikTok MVP account closeout"));
  assert.ok(page.includes("Este bloque no pide developer apps ni permisos directos"));
  assert.ok(page.includes("no social API keys"));
  assert.ok(page.includes("nextRepairCsvRowTemplate"));
  assert.ok(page.includes("csvRowTemplate"));
  assert.ok(page.includes("repairTemplatesCsv"));
  assert.ok(page.includes("repairWorkPacketMarkdown"));
  assert.ok(page.includes("Repair templates CSV"));
  assert.ok(page.includes("Repair work packet"));
  assert.ok(page.includes("/api/clippers/external-closeout-repair-work-packet"));
  assert.ok(page.includes("Operational Readiness"));
  assert.ok(page.includes("External Closeout Pack"));
  assert.ok(page.includes("Copy run"));
  assert.ok(page.includes("more external actions in"));
  assert.ok(page.includes("External closeout"));
  assert.ok(page.includes("Evidence CSV rows"));
  assert.ok(page.includes("Strict import CSV"));
  assert.ok(page.includes("Uses external evidence import schema"));
  assert.ok(page.includes("status.robertNextActions.externalCloseout.proofFilesNeedRealEvidence"));
  assert.ok(page.includes("status.robertNextActions.externalCloseout.operatorQueueItems"));
  assert.ok(page.includes("Direct APIs"));
  assert.ok(page.includes("Direct API backlog"));
  assert.ok(page.includes("Metricool MVP launch mode"));
  assert.ok(page.includes("Metricool MVP check"));
  assert.ok(page.includes("MVP activo por Metricool"));
  assert.ok(page.includes("MVP Metricool pendiente de verificacion"));
  assert.ok(page.includes("APIs directas quedan en backlog"));
  assert.ok(page.includes("no social API keys"));
  assert.ok(page.includes('data-testid="clippers-metricool-operator-run-sheet"'));
  assert.ok(page.includes("Run sheet CSV"));
  assert.ok(page.includes("Ready queue"));
  assert.ok(page.includes('data-testid="clippers-external-portal-closeout-board"'));
  assert.ok(page.includes("more Metricool MVP blockers in"));
  const accountRowsBlock = sliceRequired(
    page,
    "accountPermissionReadiness.accountRows.map((row) =>",
    "Permission gates",
  );
  assert.ok(accountRowsBlock.includes("row.blockers.slice(0, 3)"));
  assert.ok(accountRowsBlock.includes("more account blockers in"));

  const readinessHelperBlock = sliceRequired(
    page,
    "const refreshAccountPermissionReadinessCache = async () =>",
    "const refreshPostConnectActivationState = async",
  );
  assert.ok(readinessHelperBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], readinessData.accountPermissionReadiness)'));

  const activationRefreshBlock = sliceRequired(
    page,
    "const refreshPostConnectActivationState = async",
    "const refreshSourceRunwayState = async",
  );
  assert.ok(activationRefreshBlock.includes("await refreshAccountPermissionReadinessCache()"));
  assert.ok(activationRefreshBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));
  assert.ok(activationRefreshBlock.includes("Readiness pendiente"));

  const credentialRefreshBlock = sliceRequired(
    page,
    "const refreshCredentialOauthRunwayState = async",
    "const runMutation = useMutation",
  );
  assert.ok(credentialRefreshBlock.includes("await refreshAccountPermissionReadinessCache()"));
  assert.ok(credentialRefreshBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));
  assert.ok(credentialRefreshBlock.includes("Readiness pendiente"));

  const postConnectMutationBlock = sliceRequired(
    page,
    "const postConnectActivationSweepMutation = useMutation",
    "const intakeRefreshSweepMutation = useMutation",
  );
  assert.ok(postConnectMutationBlock.includes("void refreshAccountPermissionReadinessCache().catch"));
  assert.ok(postConnectMutationBlock.includes('queryClient.setQueryData(["/api/clippers/account-permission-readiness"], null)'));

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.ok(routes.includes('runClipperJsonScript("script/clippers-operational-readiness.mjs", "Operational readiness")'));
  assert.ok(routes.includes("runClipperExternalCloseoutPack"));
  assert.ok(routes.includes('app.get("/api/clippers/operational-readiness"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-operational-readiness"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-pack"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-external-closeout-pack"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-proof-todo"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-operator-queue"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-batches"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-next-action"'));
  assert.ok(routes.includes('app.get("/api/clippers/tiktok-external-closeout-session"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-tiktok-external-closeout-session"'));
  assert.ok(routes.includes("runClipperTikTokExternalCloseoutSession"));
  assert.ok(routes.includes('app.post("/api/clippers/record-metricool-bridge-evidence-batch"'));
  assert.ok(routes.includes('app.get("/api/clippers/metricool-100-operator-handoff"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-metricool-100-operator-handoff"'));
  assert.ok(routes.includes('runClipperJsonScript("script/clippers-metricool-operator-handoff.mjs"'));
  assert.ok(routes.includes('app.get("/api/clippers/tiktok-launch-control"'));
  assert.ok(routes.includes('app.post("/api/clippers/prepare-tiktok-launch-control"'));
  assert.ok(routes.includes('runClipperJsonScript("script/clippers-tiktok-launch-control.mjs"'));
  assert.ok(routes.includes('app.post("/api/clippers/preview-metricool-approval-evidence"'));
  assert.ok(routes.includes('app.get("/api/clippers/external-closeout-repair-work-packet"'));
  assert.ok(routes.includes("CLIPPER_ROUTE_SCRIPT_TIMEOUT_MS"));
  assert.ok(routes.includes('child.kill("SIGKILL")'));
  assert.ok(routes.includes("detached: true"));
  assert.ok(routes.includes("process.kill(-child.pid"));
  const operationalReadinessScript = await readFile(path.join(process.cwd(), "script/clippers-operational-readiness.mjs"), "utf8");
  assert.ok(operationalReadinessScript.includes("jsonScriptTimeoutMs"));
  assert.ok(operationalReadinessScript.includes("nestedJsonScriptTimeoutMs = 60_000"));
  assert.ok(operationalReadinessScript.includes('child.kill("SIGKILL")'));
  assert.ok(operationalReadinessScript.includes("detached: true"));
  assert.ok(operationalReadinessScript.includes("process.kill(-child.pid"));
  const externalCloseoutScript = await readFile(path.join(process.cwd(), "script/clippers-external-closeout-pack.mjs"), "utf8");
  assert.ok(externalCloseoutScript.includes("jsonScriptTimeoutMs"));
  assert.ok(externalCloseoutScript.includes("nestedJsonScriptTimeoutMs = 90_000"));
  assert.ok(externalCloseoutScript.includes('child.kill("SIGKILL")'));
  assert.ok(externalCloseoutScript.includes("detached: true"));
  assert.ok(externalCloseoutScript.includes("process.kill(-child.pid"));
  const activationRouteBlock = sliceRequired(
    routes,
    'app.post("/api/clippers/run-post-connect-activation-sweep"',
    'app.post("/api/clippers/run-intake-refresh-sweep"',
  );
  assert.ok(activationRouteBlock.includes("status: result.status"));
});

test("owned source generator commands have timeout and process group cleanup", async () => {
  const generatorScripts = [
    "script/clippers-generate-owned-gap-sources.mjs",
    "script/clippers-generate-owned-meme-sources.ts",
    "script/clippers-generate-owned-sports-streamer-sources.ts",
    "script/clippers-generate-owned-weekly-backlog-sources.ts",
  ];

  for (const scriptPath of generatorScripts) {
    const source = await readFile(path.join(process.cwd(), scriptPath), "utf8");
    assert.ok(source.includes("commandTimeoutMs"), `${scriptPath} should define a command timeout`);
    assert.ok(source.includes("detached: true"), `${scriptPath} should run child processes in a process group`);
    assert.ok(source.includes("process.kill(-child.pid"), `${scriptPath} should kill the process group on timeout`);
    assert.ok(source.includes('child.kill("SIGKILL")'), `${scriptPath} should fall back to direct child kill`);
    assert.ok(source.includes("timed out after"), `${scriptPath} should report timeout failures`);
  }
});

test("Metricool 100 operator handoff batches approval-only rows without publishing", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_operator");
  assert.equal(output.rows, 100);
  assert.equal(output.batches, 10);
  assert.equal(output.readyToSend, 0);
  assert.equal(output.sports + output.memes + output.streamers, 100);

  const handoff = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-operator-handoff.json"), "utf8"));
  assert.equal(handoff.status, "ready_for_operator");
  assert.equal(handoff.totals.readyToSend, 0);
  assert.equal(handoff.totals.rows, 100);
  assert.equal(handoff.batches.length, 10);
  assert.equal(handoff.operatorConsole.status, "ready_for_metricool_review");
  assert.equal(handoff.operatorConsole.currentBatchId, "metricool-batch-01");
  assert.equal(handoff.operatorConsole.evidenceCsvStatus, "fill_current_batch_csv_only_after_metricool_review");
  assert.equal(handoff.operatorConsole.publishedRowsCounted, 0);
  assert.ok(handoff.operatorConsole.checklist.some((item) => item.includes("Open Metricool")));
  assert.ok(handoff.operatorConsole.evidenceFields.includes("published_post_url"));
  assert.ok(handoff.operatorConsole.evidenceFields.includes("metricool_approval_url"));
  assert.equal(handoff.operatorConsole.currentBatchWorkbook.status, "ready_for_metricool_review");
  assert.equal(handoff.operatorConsole.currentBatchWorkbook.rows, 10);
  assert.match(handoff.operatorConsole.currentBatchWorkbook.csvPath, /metricool-100-current-batch-workbook\.csv$/);
  assert.match(handoff.operatorConsole.currentBatchWorkbook.markdownPath, /metricool-100-current-batch-workbook\.md$/);
  assert.equal(handoff.operatorConsole.currentBatchOperatorSession.status, "ready_for_operator");
  assert.equal(handoff.operatorConsole.currentBatchOperatorSession.rows, 10);
  assert.deepEqual(handoff.operatorConsole.currentBatchOperatorSession.sourceGateTotals, {
    rows: 10,
    ready: 10,
    blocked: 0,
    pending: 0,
  });
  assert.match(handoff.operatorConsole.currentBatchOperatorSession.csvPath, /metricool-100-current-batch-operator-session\.csv$/);
  assert.match(handoff.operatorConsole.currentBatchOperatorSession.markdownPath, /metricool-100-current-batch-operator-session\.md$/);
  assert.equal(handoff.operatorConsole.batchWorkbooks.length, 10);
  assert.equal(handoff.operatorConsole.batchWorkbooks[0].batchId, "metricool-batch-01");
  assert.equal(handoff.operatorConsole.batchWorkbooks[9].batchId, "metricool-batch-10");
  assert.equal(
    handoff.operatorConsole.batchWorkbooks.reduce((sum, workbook) => sum + workbook.rows, 0),
    100,
  );
  assert.match(handoff.operatorConsole.paths.batchWorkbooksDir, /metricool-100-batch-workbooks$/);
  assert.match(handoff.operatorConsole.paths.batchEvidenceImportsDir, /metricool-100-batch-evidence-imports$/);
  assert.match(handoff.operatorConsole.batchWorkbooks[9].evidenceCsvPath, /metricool-100-batch-evidence-imports\/metricool-batch-10-evidence-import\.csv$/);
  const evidenceCsvHeader = (await readFile(path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv"), "utf8"))
    .split(/\r?\n/)[0]
    .split(",")
    .map((cell) => cell.replaceAll('"', ""));
  assert.deepEqual(
    handoff.operatorConsole.evidenceFields.filter((field) => !field.includes("=") && !evidenceCsvHeader.includes(field)),
    [],
  );
  assert.ok(handoff.guardrails.some((guardrail) => guardrail.includes("approval_required")));
  assert.ok(handoff.guardrails.some((guardrail) => guardrail.includes("queued_for_approval is not published")));
  assert.doesNotMatch(handoff.batches[0].operatorAction, tikTokMetricoolApproveCopyPattern);
  assert.match(handoff.nextStep, /metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
  assert.doesNotMatch(handoff.nextStep, /evidence-drop\/metricool-100-approval-evidence-import\.csv/);
  assert.match(handoff.batches[0].evidenceAction, /metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
  assert.doesNotMatch(handoff.batches[0].evidenceAction, /evidence-drop\/metricool-100-approval-evidence-import\.csv/);

  const markdown = await readFile(path.join(rootDir, "scheduled/metricool-100-operator-handoff.md"), "utf8");
  assert.match(markdown, /Metricool 100 Operator Handoff/);
  assert.match(markdown, /Current batch evidence CSV \(operator fills this\): .*metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
  assert.match(markdown, /Master evidence CSV \(sync target; do not edit directly\): .*evidence-drop\/metricool-100-approval-evidence-import\.csv/);
  assert.match(markdown, /Operator Console/);
  assert.match(markdown, /Evidence fields/);
  assert.match(markdown, /final_status=scheduled, Metricool URL, and real notes/);
  assert.match(markdown, /Batch workbooks/);
  assert.match(markdown, /metricool-batch-10-evidence-import\.csv/);
  assert.match(markdown, /published_post_url/);
  assert.match(markdown, /This file does not publish/);
  assert.match(markdown, /metricool-batch-01/);
  assert.doesNotMatch(markdown, tikTokMetricoolApproveCopyPattern);
  assert.doesNotMatch(markdown, /realPublishEnabled:\s*true|ready_to_send|autopublish/i);

  const workbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json"), "utf8"));
  assert.equal(workbook.status, "ready_for_metricool_review");
  assert.equal(workbook.batchId, "metricool-batch-01");
  assert.equal(workbook.rows.length, 10);
  assert.equal(workbook.rows[0].rank, "1");
  assert.equal(workbook.rows[0].evidenceTemplate.metricool_approval_url, "");
  assert.equal(workbook.rows[0].evidenceTemplate.final_status, "");
  assert.ok(workbook.guardrails.some((guardrail) => guardrail.includes("final_status=scheduled")));
  assert.ok(workbook.evidenceFields.includes("final_status=scheduled|published|rejected"));
  assert.ok(!workbook.evidenceFields.some((field) => field.includes("approved")));
  assert.doesNotMatch(JSON.stringify(workbook), tikTokMetricoolApproveCopyPattern);
  assert.ok(workbook.guardrails.some((guardrail) => guardrail.includes("Do not count")));
  const workbookCsv = await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.csv"), "utf8");
  assert.match(workbookCsv, /published_post_url/);
  assert.match(workbookCsv, /metricool_approval_url/);
  assert.doesNotMatch(workbookCsv, /<[^>]+>/);
  assert.doesNotMatch(workbookCsv, /ready_to_send|autopublish/i);
  const session = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-operator-session.json"), "utf8"));
  assert.equal(session.status, "ready_for_operator");
  assert.equal(session.batchId, "metricool-batch-01");
  assert.equal(session.rows.length, 10);
  assert.equal(session.rows[0].operatorStatus, "needs_metricool_review");
  assert.equal(session.rows[0].evidenceStatus, "waiting_live_post");
  assert.equal(session.rows[0].sourceGate, "ready");
  assert.match(session.rows[0].sourceGateDetail, /bytes/);
  assert.equal(session.rows[0].trackerState, "not_started");
  assert.match(session.rows[0].operatorCopyText, /Queue item: 53467d8f7dad/);
  assert.match(session.rows[0].operatorCopyText, /Before live: use final_status=scheduled/);
  assert.match(session.rows[0].operatorCopyText, /After live: use final_status=published only with exact public TikTok URL/);
  assert.ok(session.rows.every((row) => row.sourceGate === "ready"));
  assert.ok(session.doneCriteria.some((criterion) => criterion.includes("public post URL")));
  const sessionCsv = await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-operator-session.csv"), "utf8");
  assert.match(sessionCsv, /source_gate/);
  assert.match(sessionCsv, /operator_copy_text/);
  assert.match(sessionCsv, /needs_metricool_review/);
  assert.match(sessionCsv, /waiting_live_post/);
  assert.doesNotMatch(sessionCsv, /ready_to_send|autopublish/i);
  const sessionMarkdown = await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-operator-session.md"), "utf8");
  assert.match(sessionMarkdown, /Metricool Current Batch Operator Session/);
  assert.match(sessionMarkdown, /Process only this batch/);
  assert.match(sessionMarkdown, /Batch evidence CSV/);
  assert.match(sessionMarkdown, /Source gate: ready/);
  assert.match(sessionMarkdown, /Queue item: 53467d8f7dad/);
  assert.doesNotMatch(sessionMarkdown, tikTokMetricoolApproveCopyPattern);
  assert.doesNotMatch(sessionMarkdown, /ready_to_send|autopublish/i);

  const finalBatchWorkbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-batch-workbooks/metricool-batch-10-workbook.json"), "utf8"));
  assert.equal(finalBatchWorkbook.status, "ready_for_metricool_review");
  assert.equal(finalBatchWorkbook.batchId, "metricool-batch-10");
  assert.equal(finalBatchWorkbook.rows.length, 10);
  assert.equal(finalBatchWorkbook.rows[0].evidenceTemplate.published_post_url, "");
  assert.match(finalBatchWorkbook.nextStep, /Open Metricool/);
  assert.ok(finalBatchWorkbook.guardrails.some((guardrail) => guardrail.includes("Do not count")));
  const finalBatchWorkbookCsv = await readFile(path.join(rootDir, "scheduled/metricool-100-batch-workbooks/metricool-batch-10-workbook.csv"), "utf8");
  assert.match(finalBatchWorkbookCsv, /published_post_url/);
  assert.match(finalBatchWorkbookCsv, /metricool_approval_url/);
  assert.doesNotMatch(finalBatchWorkbookCsv, /<[^>]+>/);
  assert.doesNotMatch(finalBatchWorkbookCsv, /ready_to_send|autopublish/i);
  const finalBatchEvidenceCsv = await readFile(path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-10-evidence-import.csv"), "utf8");
  const finalBatchEvidenceLines = finalBatchEvidenceCsv.split(/\r?\n/).filter(Boolean);
  assert.equal(finalBatchEvidenceLines.length, 11);
  assert.deepEqual(
    finalBatchEvidenceLines[0].split(",").map((cell) => cell.replaceAll('"', "")),
    evidenceCsvHeader,
  );
  assert.doesNotMatch(finalBatchEvidenceCsv, /<[^>]+>/);
  assert.doesNotMatch(finalBatchEvidenceCsv, /ready_to_send|autopublish/i);
});

test("Metricool 100 operator handoff rolls stale pending schedules forward", async () => {
  const runSheetPath = path.join(rootDir, "scheduled/metricool-100-operator-run-sheet.csv");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const originalRunSheet = await readFile(runSheetPath, "utf8");
  try {
    await writeFile(
      runSheetPath,
      mutateTestCsvRows(originalRunSheet, (cells, index, header) => {
        const publishAtIndex = header.indexOf("publish_at");
        const actionIndex = header.indexOf("metricool_action");
        const sourceFileIndex = header.indexOf("source_file_name");
        const brandIndex = header.indexOf("metricool_brand_name");
        const stalePublishAt = new Date(Date.UTC(2000, 0, 1, 0, index * 20, 0)).toISOString();
        cells[publishAtIndex] = stalePublishAt;
        cells[actionIndex] = `Upload/review ${cells[sourceFileIndex]} in Metricool brand ${cells[brandIndex]}; schedule for ${stalePublishAt}.`;
        return cells;
      }),
    );

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.status, "ready_for_operator");
    assert.equal(handoff.scheduleRollForward.applied, true);
    assert.equal(handoff.scheduleRollForward.reason, "pending_schedules_rolled_forward");
    assert.ok(handoff.scheduleRollForward.rowsAdjusted > 0);
    assert.ok(Date.parse(handoff.scheduleRollForward.firstAfter) > Date.now() + 20 * 60 * 1000);
    assert.equal(handoff.totals.readyToSend, 0);

    const regeneratedRunSheet = await readFile(runSheetPath, "utf8");
    assert.doesNotMatch(regeneratedRunSheet, /2000-01-01T00:00:00\.000Z/);
    const workbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json"), "utf8"));
    assert.ok(workbook.rows.some((row) => Date.parse(row.publishAt) > Date.now() + 20 * 60 * 1000));
    assert.doesNotMatch(JSON.stringify(workbook), /ready_to_send|autopublish/i);
  } finally {
    await writeFile(runSheetPath, originalRunSheet);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff does not roll rows that already have batch evidence", async () => {
  const runSheetPath = path.join(rootDir, "scheduled/metricool-100-operator-run-sheet.csv");
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const originalRunSheet = await readFile(runSheetPath, "utf8");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  const staleEvidencePublishAt = "2000-01-01T00:00:00.000Z";
  const stalePendingPublishAt = "2000-01-01T00:20:00.000Z";
  try {
    await writeFile(
      runSheetPath,
      mutateTestCsvRows(originalRunSheet, (cells, index, header) => {
        if (index > 1) return cells;
        const publishAtIndex = header.indexOf("publish_at");
        const actionIndex = header.indexOf("metricool_action");
        const sourceFileIndex = header.indexOf("source_file_name");
        const brandIndex = header.indexOf("metricool_brand_name");
        const stalePublishAt = index === 0 ? staleEvidencePublishAt : stalePendingPublishAt;
        cells[publishAtIndex] = stalePublishAt;
        cells[actionIndex] = `Upload/review ${cells[sourceFileIndex]} in Metricool brand ${cells[brandIndex]}; schedule for ${stalePublishAt}.`;
        return cells;
      }),
    );
    await writeFile(
      batchEvidencePath,
      mutateTestCsvRows(originalBatchEvidence, (cells, index, header) => {
        if (index !== 0) return cells;
        cells[header.indexOf("scheduled_for")] = staleEvidencePublishAt;
        cells[header.indexOf("metricool_approval_url")] = "https://app.metricool.com/planner/preserve-existing-schedule";
        cells[header.indexOf("published_post_url")] = "";
        cells[header.indexOf("final_status")] = "scheduled";
        cells[header.indexOf("views_24h")] = "";
        cells[header.indexOf("likes_24h")] = "";
        cells[header.indexOf("comments_24h")] = "";
        cells[header.indexOf("shares_24h")] = "";
        cells[header.indexOf("operator_notes")] = "Scheduled in Metricool already; preserve this operator-confirmed row.";
        return cells;
      }),
    );

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const handoff = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-operator-handoff.json"), "utf8"));
    assert.equal(handoff.scheduleRollForward.applied, true);
    assert.ok(handoff.scheduleRollForward.rowsAdjusted >= 1);
    assert.ok(handoff.scheduleRollForward.rowsAdjusted < 100);

    const regeneratedRunSheet = await readFile(runSheetPath, "utf8");
    const rows = regeneratedRunSheet.trimEnd().split(/\r?\n/);
    const header = parseTestCsvLine(rows[0]);
    const publishAtIndex = header.indexOf("publish_at");
    const firstRow = parseTestCsvLine(rows[1]);
    const secondRow = parseTestCsvLine(rows[2]);
    assert.equal(firstRow[publishAtIndex], staleEvidencePublishAt);
    assert.notEqual(secondRow[publishAtIndex], stalePendingPublishAt);
    assert.ok(Date.parse(secondRow[publishAtIndex]) > Date.now() + 20 * 60 * 1000);

    const workbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json"), "utf8"));
    assert.equal(workbook.rows[0].evidenceTemplate.metricool_approval_url, "https://app.metricool.com/planner/preserve-existing-schedule");
    assert.equal(workbook.rows[0].evidenceTemplate.final_status, "scheduled");
    assert.doesNotMatch(JSON.stringify(workbook), /ready_to_send|autopublish/i);
  } finally {
    await writeFile(runSheetPath, originalRunSheet);
    await writeFile(batchEvidencePath, originalBatchEvidence);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff validates all local sources when tracker is missing", async () => {
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const sessionPath = path.join(rootDir, "scheduled/metricool-100-current-batch-operator-session.json");
  const originalTracker = await readFile(trackerPath, "utf8");
  try {
    await writeFile(trackerPath, JSON.stringify({
      status: "missing_tracker_test",
      generatedAt: new Date().toISOString(),
      rows: [],
      totals: { rows: 0 },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "ready_for_operator");

    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.status, "ready_for_operator");
    assert.equal(handoff.operatorConsole.status, "ready_for_metricool_review");
    assert.ok(handoff.batches.every((batch) => batch.status === "ready_for_metricool_review"));
    assert.ok(handoff.operatorConsole.batchWorkbooks.every((workbook) => workbook.status === "ready_for_metricool_review"));
    assert.deepEqual(handoff.operatorConsole.currentBatchOperatorSession.sourceGateTotals, {
      rows: 10,
      ready: 10,
      blocked: 0,
      pending: 0,
    });

    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    assert.equal(session.status, "ready_for_operator");
    assert.ok(session.rows.every((row) => row.sourceGate === "ready"));
    assert.ok(session.rows.every((row) => row.operatorStatus === "needs_metricool_review"));
    assert.match(session.rows[0].sourceGateDetail, /local ftyp probe/);
    const markdown = await readFile(path.join(rootDir, "scheduled/metricool-100-operator-handoff.md"), "utf8");
    assert.match(markdown, /Status: ready_for_metricool_review/);
    assert.doesNotMatch(markdown, /Stop before Metricool/);
    const batchTwoWorkbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-batch-workbooks/metricool-batch-02-workbook.json"), "utf8"));
    assert.equal(batchTwoWorkbook.status, "ready_for_metricool_review");
  } finally {
    await writeFile(trackerPath, originalTracker);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff blocks broken local source paths", async () => {
  const runSheetPath = path.join(rootDir, "scheduled/metricool-100-operator-run-sheet.csv");
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const sessionPath = path.join(rootDir, "scheduled/metricool-100-current-batch-operator-session.json");
  const originalRunSheet = await readFile(runSheetPath, "utf8");
  const originalTracker = await readFile(trackerPath, "utf8");
  try {
    await writeFile(trackerPath, JSON.stringify({
      status: "missing_tracker_test",
      generatedAt: new Date().toISOString(),
      rows: [],
      totals: { rows: 0 },
    }, null, 2));
    await writeFile(
      runSheetPath,
      originalRunSheet.replace(
        "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/memes-owned-01.mp4",
        "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/missing-owned-source.mp4",
      ),
    );

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_source_verification");

    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.status, "blocked_source_verification");
    assert.equal(handoff.operatorConsole.status, "blocked_source_verification");
    assert.equal(handoff.batches[0].status, "blocked_source_verification");
    assert.equal(handoff.operatorConsole.batchWorkbooks[0].status, "blocked_source_verification");
    assert.deepEqual(handoff.operatorConsole.currentBatchOperatorSession.sourceGateTotals, {
      rows: 10,
      ready: 9,
      blocked: 1,
      pending: 0,
    });

    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    assert.equal(session.status, "blocked_source_verification");
    assert.equal(session.rows[0].sourceGate, "blocked_source_file");
    assert.equal(session.rows[0].sourceGateDetail, "source_file_missing");
    assert.match(session.rows[0].operatorCopyText, /Stop before Metricool/);
  } finally {
    await writeFile(runSheetPath, originalRunSheet);
    await writeFile(trackerPath, originalTracker);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff blocks later batches with broken local source paths", async () => {
  const runSheetPath = path.join(rootDir, "scheduled/metricool-100-operator-run-sheet.csv");
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const originalRunSheet = await readFile(runSheetPath, "utf8");
  const originalTracker = await readFile(trackerPath, "utf8");
  try {
    await writeFile(trackerPath, JSON.stringify({ rows: [] }, null, 2));
    await writeFile(
      runSheetPath,
      originalRunSheet.replace(
        "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/sports/sports-owned-09.mp4",
        "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/sports/missing-batch-two-source.mp4",
      ),
    );

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_source_verification");

    const handoff = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-operator-handoff.json"), "utf8"));
    assert.equal(handoff.status, "blocked_source_verification");
    assert.equal(handoff.operatorConsole.status, "blocked_source_verification");
    assert.equal(handoff.batches[0].status, "ready_for_metricool_review");
    assert.equal(handoff.batches[1].status, "blocked_source_verification");
    assert.match(handoff.nextStep, /Stop before scaling beyond batch 01/);
  } finally {
    await writeFile(runSheetPath, originalRunSheet);
    await writeFile(trackerPath, originalTracker);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff does not trust stale tracker over broken local source", async () => {
  const runSheetPath = path.join(rootDir, "scheduled/metricool-100-operator-run-sheet.csv");
  const originalRunSheet = await readFile(runSheetPath, "utf8");
  try {
    await writeFile(
      runSheetPath,
      originalRunSheet.replace(
        "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/memes-owned-01.mp4",
        "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/missing-stale-tracker-source.mp4",
      ),
    );

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_source_verification");

    const session = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-operator-session.json"), "utf8"));
    assert.equal(session.status, "blocked_source_verification");
    assert.equal(session.rows[0].sourceGate, "blocked_source_file");
    assert.equal(session.rows[0].sourceGateDetail, "source_file_missing");
  } finally {
    await writeFile(runSheetPath, originalRunSheet);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff preserves operator-filled batch evidence CSVs", async () => {
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-02-evidence-import.csv");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  try {
    const lines = originalBatchEvidence.trimEnd().split(/\r?\n/);
    const cells = lines[1].split(",");
    cells[9] = "https://app.metricool.com/planner/preserved-batch-two";
    cells[10] = "";
    cells[11] = "scheduled";
    cells[12] = "";
    cells[13] = "";
    cells[14] = "";
    cells[15] = "";
    cells[16] = "Operator scheduled this row in Metricool; preserve this batch CSV evidence.";
    lines[1] = cells.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
    await writeFile(batchEvidencePath, lines.join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const regeneratedBatchEvidence = await readFile(batchEvidencePath, "utf8");
    assert.match(regeneratedBatchEvidence, /https:\/\/app\.metricool\.com\/planner\/preserved-batch-two/);
    assert.match(regeneratedBatchEvidence, /Operator scheduled this row in Metricool; preserve this batch CSV evidence/);
    const batchTwoWorkbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-batch-workbooks/metricool-batch-02-workbook.json"), "utf8"));
    assert.equal(batchTwoWorkbook.rows[0].evidenceTemplate.metricool_approval_url, "https://app.metricool.com/planner/preserved-batch-two");
    assert.equal(batchTwoWorkbook.rows[0].evidenceTemplate.final_status, "scheduled");
  } finally {
    await writeFile(batchEvidencePath, originalBatchEvidence);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff holds current batch after scheduled-only evidence", async () => {
  const batchOneEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalBatchOneEvidence = await readFile(batchOneEvidencePath, "utf8");
  try {
    const lines = originalBatchOneEvidence.trimEnd().split(/\r?\n/);
    const scheduledRows = lines.slice(1).map((line, index) => {
      const cells = line.split(",");
      cells[9] = `https://app.metricool.com/planner/batch-one-scheduled-${index + 1}`;
      cells[10] = "";
      cells[11] = "scheduled";
      cells[12] = "";
      cells[13] = "";
      cells[14] = "";
      cells[15] = "";
      cells[16] = `Scheduled in Metricool batch one row ${index + 1} with operator confirmation.`;
      return cells.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
    });
    await writeFile(batchOneEvidencePath, [lines[0], ...scheduledRows].join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "ready_for_operator");

    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.operatorConsole.currentBatchId, "metricool-batch-01");
    assert.equal(handoff.operatorConsole.completedBatches, 0);
    assert.equal(handoff.operatorConsole.currentBatchEvidenceStatus, "waiting_public_posts");
    assert.equal(handoff.batches[0].evidenceProgress.status, "waiting_public_posts");
    assert.equal(handoff.batches[0].evidenceProgress.totals.scheduled, 10);
    assert.equal(handoff.batches[0].evidenceProgress.totals.readyToImport, 0);
    assert.equal(handoff.operatorConsole.publishedRowsCounted, 0);
    assert.match(handoff.nextStep, /batch metricool-batch-01/);

    const workbook = JSON.parse(await readFile(workbookPath, "utf8"));
    assert.equal(workbook.batchId, "metricool-batch-01");
    assert.equal(workbook.rows.length, 10);
    assert.ok(workbook.rows.every((row) => row.evidenceTemplate.final_status === "scheduled"));
  } finally {
    await writeFile(batchOneEvidencePath, originalBatchOneEvidence);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool 100 operator handoff blocks invalid Metricool URL on published rows", async () => {
  const batchOneEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const originalBatchOneEvidence = await readFile(batchOneEvidencePath, "utf8");
  try {
    const lines = originalBatchOneEvidence.trimEnd().split(/\r?\n/);
    const invalidRows = lines.slice(1).map((line, index) => {
      const cells = line.split(",");
      cells[9] = "https://example.com/not-metricool";
      cells[10] = `https://www.tiktok.com/@sportsdaily/video/12345678901234567${index}`;
      cells[11] = "published";
      cells[12] = "100";
      cells[13] = "10";
      cells[14] = "2";
      cells[15] = "1";
      cells[16] = `Published row ${index + 1} has invalid Metricool URL and must not advance.`;
      return cells.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
    });
    await writeFile(batchOneEvidencePath, [lines[0], ...invalidRows].join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.operatorConsole.currentBatchId, "metricool-batch-01");
    assert.equal(handoff.operatorConsole.completedBatches, 0);
    assert.equal(handoff.batches[0].evidenceProgress.status, "needs_evidence_fix");
    assert.equal(handoff.batches[0].evidenceProgress.totals.needsFix, 10);
    assert.equal(handoff.operatorConsole.publishedRowsCounted, 0);
    assert.doesNotMatch(handoff.nextStep, /batch metricool-batch-02/);
  } finally {
    await writeFile(batchOneEvidencePath, originalBatchOneEvidence);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok launch control reports current Metricool batch without counting placeholders", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-launch-control.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_metricool_review");
  assert.equal(output.rows, 100);
  assert.equal(output.tiktok, 100);
  assert.equal(output.instagram, 0);
  assert.equal(output.youtube, 0);
  assert.equal(output.notStarted, 100);
  assert.equal(output.readyToImport, 0);
  assert.equal(output.currentBatch.id, "metricool-batch-01");
  assert.equal(output.currentBatch.rows, 10);
  assert.deepEqual(output.currentBatch.platforms, ["tiktok"]);

  const control = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-launch-control.json"), "utf8"));
  assert.equal(control.status, "ready_for_metricool_review");
  assert.equal(control.currentBatch.rows, 10);
  assert.equal(control.totals.readyToImport, 0);
  assert.equal(control.totals.notStarted, 100);
  assert.ok(control.guardrails.some((guardrail) => guardrail.includes("TikTok is the only active MVP platform")));
  assert.ok(control.guardrails.some((guardrail) => guardrail.includes("not published until final_status=published")));

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-launch-control.md"), "utf8");
  assert.match(markdown, /Clippers TikTok Launch Control/);
  assert.match(markdown, /Status: ready_for_metricool_review/);
  assert.match(markdown, /TikTok rows: 100/);
  assert.doesNotMatch(markdown, /autopublish|ready_to_send/i);

  const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-launch-control.csv"), "utf8");
  assert.match(csv, /metricool_queue_item_id/);
  assert.match(csv, /waiting_metricool_review/);
  assert.doesNotMatch(csv, /instagram|youtube/i);
});

test("TikTok launch control blocks profile URLs and invalid scheduled evidence", async () => {
  const evidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const lines = originalEvidence.split(/\r?\n/).filter(Boolean);
    const workbook = JSON.parse(await readFile(workbookPath, "utf8"));
    const row = workbook.rows[0];
    const csvRow = (overrides = {}) => [
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.platform,
      row.metricoolBrandName,
      row.metricoolBlogId,
      row.publishAt,
      row.sourcePath,
      row.captionSeed,
      overrides.metricoolApprovalUrl || "",
      overrides.publishedPostUrl || "",
      overrides.finalStatus || "",
      overrides.views24h || "",
      overrides.likes24h || "",
      overrides.comments24h || "",
      overrides.shares24h || "",
      overrides.operatorNotes || "",
    ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
    await writeFile(evidencePath, [
      lines[0],
      csvRow({
        metricoolApprovalUrl: "https://app.metricool.com/planner/launch-control-test",
        publishedPostUrl: "https://www.tiktok.com/@memeradar",
        finalStatus: "published",
        views24h: "100",
        operatorNotes: "Launch control must reject profile URLs before import.",
      }),
      ...lines.slice(2),
    ].join("\n") + "\n");

    const profileResult = spawnSync(process.execPath, ["script/clippers-tiktok-launch-control.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(profileResult.status, 0, profileResult.stderr || profileResult.stdout);
    const profileControl = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-launch-control.json"), "utf8"));
    assert.equal(profileControl.status, "needs_evidence_fix");
    assert.equal(profileControl.totals.readyToImport, 0);
    assert.match(profileControl.rows[0].blocker, /published_post_url_must_be_tiktok/);

    await writeFile(evidencePath, [
      lines[0],
      csvRow({
        finalStatus: "scheduled",
        operatorNotes: "Scheduled row without Metricool URL must fail launch control.",
      }),
      ...lines.slice(2),
    ].join("\n") + "\n");

    const scheduledResult = spawnSync(process.execPath, ["script/clippers-tiktok-launch-control.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(scheduledResult.status, 0, scheduledResult.stderr || scheduledResult.stdout);
    const scheduledControl = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-launch-control.json"), "utf8"));
    assert.equal(scheduledControl.status, "needs_evidence_fix");
    assert.equal(scheduledControl.totals.readyToImport, 0);
    assert.match(scheduledControl.rows[0].blocker, /metricool_approval_url_must_be_metricool_url/);
  } finally {
    await writeFile(evidencePath, originalEvidence);
    spawnSync(process.execPath, ["script/clippers-tiktok-launch-control.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch tracker tracks current batch without counting placeholders", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked_verifier");
  assert.equal(output.sourceStatus, "ready_for_metricool_review");
  assert.equal(output.verifierGate, "fail");
  assert.equal(output.batch, "metricool-batch-01");
  assert.equal(output.rows, 10);
  assert.equal(output.notStarted, 10);
  assert.equal(output.scheduled, 0);
  assert.equal(output.waitingMetrics, 0);
  assert.equal(output.readyToImport, 0);
  assert.equal(output.needsFix, 0);

  const tracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
  assert.equal(tracker.status, "blocked_verifier");
  assert.equal(tracker.sourceStatus, "ready_for_metricool_review");
  assert.equal(tracker.verifierGate.blocking, true);
  assert.match(tracker.nextStep, /Metricool bridge evidence|proof/i);
  assert.equal(tracker.batch.id, "metricool-batch-01");
  assert.equal(tracker.batch.rows, 10);
  assert.deepEqual(tracker.batch.platforms, ["tiktok"]);
  assert.equal(tracker.totals.readyToImport, 0);
  assert.ok(tracker.rows.every((row) => row.state === "not_started"));
  assert.match(tracker.rows[0].operatorCopyText, /Metricool brand:/);
  assert.match(tracker.rows[0].operatorCopyText, /Source file:/);
  assert.match(tracker.rows[0].operatorCopyText, /Caption:/);
  assert.match(tracker.rows[0].operatorCopyText, /After live:/);
  assert.equal(tracker.rows[0].metricoolBrandName, "memes");
  assert.match(tracker.rows[0].sourcePath, /memes-owned-01\.mp4/);
  assert.equal(tracker.rows[0].sourceExists, true);
  assert.ok(tracker.rows[0].sourceBytes > 1024);
  assert.equal(tracker.rows[0].sourceVideoValid, true);
  assert.equal(tracker.rows[0].sourceDurationSeconds, 0);
  assert.equal(tracker.rows[0].sourceProbe, "mp4_signature");
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("Scheduled rows are not counted as published")));
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("public TikTok URL and nonzero 24h metrics")));
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("missing or invalid local source files")));
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("MP4/MOV signature checks")));
  assert.ok(tracker.guardrails.some((guardrail) => guardrail.includes("verifier must pass before opening Metricool")));

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.md"), "utf8");
  assert.match(markdown, /Clippers TikTok Batch Tracker/);
  assert.match(markdown, /Batch: metricool-batch-01/);
  assert.match(markdown, /Verifier gate: fail/);
  assert.match(markdown, /Operator Copy Packets/);
  assert.match(markdown, /Ready to import: 0/);
  assert.doesNotMatch(markdown, /autopublish|ready_to_send/i);

  const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.csv"), "utf8");
  assert.match(csv, /metricool_queue_item_id/);
  assert.match(csv, /operator_copy_text/);
  assert.match(csv, /source_video_valid/);
  assert.match(csv, /source_duration_seconds/);
  assert.match(csv, /source_probe/);
  assert.match(csv, /waiting_metricool_review/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/tiktok-batch-tracker/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-batch-tracker/);
  assert.match(routes, /script\/clippers-tiktok-batch-tracker\.mjs/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-tiktok-batch-tracker-button/);
  assert.match(page, /clippers-tiktok-batch-tracker-panel/);
  assert.match(page, /clippers-tiktok-batch-operator-copy-packet/);
  assert.match(page, /TikTok Batch Tracker/);
});

test("TikTok batch tracker rejects mismatched evidence and missing workbook rows", async () => {
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const evidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const fakeVideoPath = path.join(rootDir, "sources/memes/fake-video-for-test.mp4");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const workbook = JSON.parse(originalWorkbook);
    const row = workbook.rows[0];
    await writeFile(evidencePath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      [
        row.metricoolQueueItemId,
        "sports-daily",
        "Sports Daily Clips",
        "instagram",
        "SPORT",
        "6431687",
        row.publishAt,
        row.sourcePath,
        row.captionSeed,
        "https://app.metricool.com/planner/real",
        "https://www.tiktok.com/@wrong/video/123",
        "published",
        "100",
        "10",
        "1",
        "1",
        "wrong account/platform evidence should not make this row importable",
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","),
    ].join("\n") + "\n");

    const mismatchResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(mismatchResult.status, 0, mismatchResult.stderr || mismatchResult.stdout);
    const mismatchTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(mismatchTracker.status, "needs_evidence_fix");
    assert.equal(mismatchTracker.totals.readyToImport, 0);
    assert.equal(mismatchTracker.totals.needsFix, 1);
    assert.match(mismatchTracker.rows[0].blocker, /evidence_mismatch/);

    await writeFile(evidencePath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      [
        row.metricoolQueueItemId,
        row.accountId,
        row.accountName,
        row.platform,
        row.metricoolBrandName,
        row.metricoolBlogId,
        row.publishAt,
        row.sourcePath,
        row.captionSeed,
        "https://app.metricool.com/planner/real",
        "https://www.tiktok.com/@sportsdaily",
        "published",
        "100",
        "10",
        "1",
        "1",
        "profile URL should not count as an exact public TikTok video URL",
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","),
    ].join("\n") + "\n");
    const profileUrlResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(profileUrlResult.status, 0, profileUrlResult.stderr || profileUrlResult.stdout);
    const profileUrlTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(profileUrlTracker.status, "needs_evidence_fix");
    assert.equal(profileUrlTracker.totals.readyToImport, 0);
    assert.match(profileUrlTracker.rows[0].blocker, /published_post_url_must_be_public_tiktok_url/);

    await writeFile(evidencePath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      [
        row.metricoolQueueItemId,
        row.accountId,
        row.accountName,
        row.platform,
        row.metricoolBrandName,
        row.metricoolBlogId,
        row.publishAt,
        row.sourcePath,
        row.captionSeed,
        "https://example.com/not-metricool",
        "https://www.tiktok.com/@sportsdaily/video/7400000000000000001",
        "published",
        "100",
        "10",
        "1",
        "1",
        "Invalid Metricool proof URL should not make this row importable.",
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","),
    ].join("\n") + "\n");
    const invalidProofResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(invalidProofResult.status, 0, invalidProofResult.stderr || invalidProofResult.stdout);
    const invalidProofTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(invalidProofTracker.status, "needs_evidence_fix");
    assert.equal(invalidProofTracker.totals.readyToImport, 0);
    assert.match(invalidProofTracker.rows[0].blocker, /metricool_approval_url_must_be_metricool_url/);

    const missingSourceWorkbook = JSON.parse(originalWorkbook);
    missingSourceWorkbook.rows[0].sourcePath = "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/missing-source-for-test.mp4";
    await writeFile(workbookPath, JSON.stringify(missingSourceWorkbook, null, 2));
    await writeFile(evidencePath, originalEvidence);
    const missingSourceResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(missingSourceResult.status, 0, missingSourceResult.stderr || missingSourceResult.stdout);
    const missingSourceTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(missingSourceTracker.status, "needs_evidence_fix");
    assert.equal(missingSourceTracker.totals.readyToImport, 0);
    assert.equal(missingSourceTracker.rows[0].sourceExists, false);
    assert.match(missingSourceTracker.rows[0].blocker, /source_file_missing/);

    const fakeVideoWorkbook = JSON.parse(originalWorkbook);
    fakeVideoWorkbook.rows[0].sourcePath = fakeVideoPath;
    await writeFile(fakeVideoPath, `not a real video but it says ftyp here\n${"padding".repeat(400)}`);
    await writeFile(workbookPath, JSON.stringify(fakeVideoWorkbook, null, 2));
    await writeFile(evidencePath, originalEvidence);
    const fakeVideoResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(fakeVideoResult.status, 0, fakeVideoResult.stderr || fakeVideoResult.stdout);
    const fakeVideoTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(fakeVideoTracker.status, "needs_evidence_fix");
    assert.equal(fakeVideoTracker.totals.readyToImport, 0);
    assert.equal(fakeVideoTracker.rows[0].sourceExists, true);
    assert.equal(fakeVideoTracker.rows[0].sourceVideoValid, false);
    assert.match(fakeVideoTracker.rows[0].blocker, /source_file_(probe_failed|not_video)/);

    await writeFile(workbookPath, JSON.stringify({ status: "ready_for_metricool_review", batchId: "metricool-batch-01", rows: [] }, null, 2));
    const missingRowsResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(missingRowsResult.status, 0);
    assert.match(missingRowsResult.stderr, /no rows|must contain 10 rows/i);
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    await writeFile(evidencePath, originalEvidence);
    await unlink(fakeVideoPath).catch(() => {});
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch tracker uses local MP4 signature checks without ffprobe", async () => {
  const fakeBinDir = path.join(rootDir, "tmp/fake-ffprobe-bin");
  const fakeFfprobePath = path.join(fakeBinDir, "ffprobe");
  try {
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeFfprobePath, [
      "#!/bin/sh",
      "echo 'tracker should not execute ffprobe' >&2",
      "exit 99",
    ].join("\n") + "\n");

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH || ""}`,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const tracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(tracker.status, "ready_for_metricool_review");
    assert.equal(tracker.rows[0].sourceVideoValid, true);
    assert.equal(tracker.rows[0].sourceProbe, "mp4_signature");
    assert.equal(tracker.rows[0].sourceDurationSeconds, 0);
    assert.doesNotMatch(tracker.rows[0].blocker, /source_file_probe_failed/);
  } finally {
    await rm(fakeBinDir, { recursive: true, force: true });
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch evidence sync merges only valid current batch rows", async () => {
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const masterEvidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  const originalMasterEvidence = await readFile(masterEvidencePath, "utf8");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  try {
    const placeholderResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(placeholderResult.status, 0, placeholderResult.stderr || placeholderResult.stdout);
    const placeholderOutput = JSON.parse(placeholderResult.stdout);
    assert.equal(placeholderOutput.status, "no_operator_updates");
    assert.equal(placeholderOutput.applied, 0);
    assert.equal(placeholderOutput.untouched, 10);
    assert.equal(placeholderOutput.rejected, 0);
    assert.equal(placeholderOutput.consistency.placeholderAligned, 10);
    assert.equal(placeholderOutput.consistency.conflicts, 0);

    const header = originalBatchEvidence.split(/\r?\n/)[0];
    const originalLines = originalBatchEvidence.split(/\r?\n/).filter(Boolean);
    const first = originalBatchEvidence.split(/\r?\n/)[1].split(",");
    const masterWithEvidenceLines = originalMasterEvidence.split(/\r?\n/).filter(Boolean);
    const masterFirst = masterWithEvidenceLines[1].split(",");
    masterFirst[9] = "https://app.metricool.com/planner/master-existing";
    masterFirst[11] = "scheduled";
    masterFirst[16] = "Existing master evidence must not be overwritten by untouched batch placeholder.";
    await writeFile(masterEvidencePath, [masterWithEvidenceLines[0], masterFirst.join(","), ...masterWithEvidenceLines.slice(2)].join("\n") + "\n");
    await writeFile(batchEvidencePath, originalBatchEvidence);
    const masterPreserveResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(masterPreserveResult.status, 0, masterPreserveResult.stderr || masterPreserveResult.stdout);
    const masterPreserveOutput = JSON.parse(masterPreserveResult.stdout);
    assert.equal(masterPreserveOutput.status, "no_operator_updates");
    assert.equal(masterPreserveOutput.consistency.masterHasOperatorUpdate, 1);
    const masterPreserved = await readFile(masterEvidencePath, "utf8");
    assert.match(masterPreserved, /https:\/\/app\.metricool\.com\/planner\/master-existing/);
    await writeFile(masterEvidencePath, originalMasterEvidence);

    first[9] = "https://app.metricool.com/planner/ok";
    first[11] = "scheduled";
    first[16] = "Scheduled in Metricool without secrets";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const appliedResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(appliedResult.status, 0, appliedResult.stderr || appliedResult.stdout);
    const appliedOutput = JSON.parse(appliedResult.stdout);
    assert.equal(appliedOutput.status, "synced");
    assert.equal(appliedOutput.applied, 1);
    assert.equal(appliedOutput.consistency.needsMasterSync, 1);
    const syncedMaster = await readFile(masterEvidencePath, "utf8");
    assert.match(syncedMaster, /https:\/\/app\.metricool\.com\/planner\/ok/);
    const masterBeforeConflict = syncedMaster;

    const masterConflictLines = masterBeforeConflict.split(/\r?\n/).filter(Boolean);
    const masterConflictFirst = masterConflictLines[1].split(",");
    masterConflictFirst[9] = "https://app.metricool.com/planner/master-conflict";
    masterConflictFirst[11] = "scheduled";
    masterConflictFirst[16] = "Existing master evidence must block conflicting batch evidence.";
    await writeFile(masterEvidencePath, [masterConflictLines[0], masterConflictFirst.join(","), ...masterConflictLines.slice(2)].join("\n") + "\n");
    first[9] = "https://app.metricool.com/planner/batch-conflict";
    first[11] = "scheduled";
    first[16] = "Conflicting batch evidence should not overwrite master.";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const conflictResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(conflictResult.status, 0, conflictResult.stderr || conflictResult.stdout);
    const conflictOutput = JSON.parse(conflictResult.stdout);
    assert.equal(conflictOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(conflictOutput.applied, 0);
    assert.equal(conflictOutput.rejected, 0);
    assert.equal(conflictOutput.consistency.conflicts, 1);
    assert.match(conflictOutput.nextStep, /conflicted/);
    const masterAfterConflict = await readFile(masterEvidencePath, "utf8");
    assert.match(masterAfterConflict, /https:\/\/app\.metricool\.com\/planner\/master-conflict/);
    assert.doesNotMatch(masterAfterConflict, /https:\/\/app\.metricool\.com\/planner\/batch-conflict/);
    await writeFile(masterEvidencePath, originalMasterEvidence);

    first[1] = "wrong-account";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const rejectedResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(rejectedResult.status, 0, rejectedResult.stderr || rejectedResult.stdout);
    const rejectedOutput = JSON.parse(rejectedResult.stdout);
    assert.equal(rejectedOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(rejectedOutput.rejected, 1);

    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.equal(report.status, "blocked_invalid_batch_evidence");
    assert.ok(report.rows.some((row) => row.reason.includes("account_id_mismatch")));
    const masterAfterMismatch = await readFile(masterEvidencePath, "utf8");

    first[1] = "meme-radar";
    first[3] = "tiktok";
    first[9] = "https://app.metricool.com/planner/real";
    first[10] = "https://www.tiktok.com/@sportsdaily";
    first[11] = "published";
    first[12] = "100";
    first[13] = "10";
    first[14] = "1";
    first[15] = "1";
    first[16] = "Profile URL should be rejected before master sync";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const profileUrlResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(profileUrlResult.status, 0, profileUrlResult.stderr || profileUrlResult.stdout);
    const profileUrlOutput = JSON.parse(profileUrlResult.stdout);
    assert.equal(profileUrlOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(profileUrlOutput.rejected, 1);
    assert.equal(await readFile(masterEvidencePath, "utf8"), masterAfterMismatch);
    const profileUrlReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(profileUrlReport.rows.some((row) => row.reason.includes("published_post_url_must_be_public_tiktok_url")));

    first[9] = "https://app.metricool.com/planner/real";
    first[10] = "https://www.tiktok.com/@memeradar/video/1234567890123456789";
    first[11] = "scheduled";
    first[12] = "100";
    first[13] = "";
    first[14] = "";
    first[15] = "";
    first[16] = "Scheduled row with public URL and metrics should be rejected before master sync";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const scheduledLeakResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(scheduledLeakResult.status, 0, scheduledLeakResult.stderr || scheduledLeakResult.stdout);
    const scheduledLeakOutput = JSON.parse(scheduledLeakResult.stdout);
    assert.equal(scheduledLeakOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(scheduledLeakOutput.rejected, 1);
    assert.equal(await readFile(masterEvidencePath, "utf8"), masterAfterMismatch);
    const scheduledLeakReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(scheduledLeakReport.rows.some((row) => row.reason.includes("scheduled_rows_must_not_include_public_url_or_metrics")));

    first[9] = "https://app.metricool.com/planner/real";
    first[10] = "";
    first[11] = "scheduled";
    first[12] = "";
    first[13] = "";
    first[14] = "";
    first[15] = "";
    first[16] = "";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const blankNotesResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(blankNotesResult.status, 0, blankNotesResult.stderr || blankNotesResult.stdout);
    const blankNotesOutput = JSON.parse(blankNotesResult.stdout);
    assert.equal(blankNotesOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(blankNotesOutput.rejected, 1);
    assert.equal(await readFile(masterEvidencePath, "utf8"), masterAfterMismatch);
    const blankNotesReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(blankNotesReport.rows.some((row) => row.reason.includes("operator_notes_min_20_chars")));

    first[9] = "";
    first[10] = "";
    first[11] = "rejected";
    first[12] = "";
    first[13] = "";
    first[14] = "";
    first[15] = "";
    first[16] = "";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const rejectedBlankNotesResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(rejectedBlankNotesResult.status, 0, rejectedBlankNotesResult.stderr || rejectedBlankNotesResult.stdout);
    const rejectedBlankNotesOutput = JSON.parse(rejectedBlankNotesResult.stdout);
    assert.equal(rejectedBlankNotesOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(rejectedBlankNotesOutput.rejected, 1);
    const rejectedBlankNotesReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(rejectedBlankNotesReport.rows.some((row) => row.reason.includes("operator_notes_min_20_chars")));

    const missingSourceWorkbook = JSON.parse(originalWorkbook);
    missingSourceWorkbook.rows[0].sourcePath = "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/missing-source-for-sync-test.mp4";
    await writeFile(workbookPath, JSON.stringify(missingSourceWorkbook, null, 2));
    first[9] = "https://app.metricool.com/planner/real";
    first[11] = "scheduled";
    first[16] = "Scheduled in Metricool with source missing should not sync.";
    await writeFile(batchEvidencePath, [header, first.join(","), ...originalLines.slice(2)].join("\n") + "\n");
    const missingSourceResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(missingSourceResult.status, 0, missingSourceResult.stderr || missingSourceResult.stdout);
    const missingSourceOutput = JSON.parse(missingSourceResult.stdout);
    assert.equal(missingSourceOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(missingSourceOutput.rejected, 1);
    assert.equal(await readFile(masterEvidencePath, "utf8"), masterAfterMismatch);
    const missingSourceReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(missingSourceReport.rows.some((row) => row.reason.includes("source_file_missing")));
    await writeFile(workbookPath, originalWorkbook);

    await writeFile(batchEvidencePath, [header, ...originalLines.slice(1, 9)].join("\n") + "\n");
    const partialBatchResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(partialBatchResult.status, 0, partialBatchResult.stderr || partialBatchResult.stdout);
    const partialBatchOutput = JSON.parse(partialBatchResult.stdout);
    assert.equal(partialBatchOutput.status, "blocked_invalid_batch_evidence");
    assert.ok(partialBatchOutput.rejected > 0);
    const partialBatchReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(partialBatchReport.rows.some((row) => row.reason.includes("batch_row_count_mismatch")));
    assert.ok(partialBatchReport.rows.some((row) => row.reason.includes("missing_batch_ids")));

    await writeFile(batchEvidencePath, [header, originalLines[1], originalLines[1], ...originalLines.slice(3)].join("\n") + "\n");
    const duplicateBatchResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(duplicateBatchResult.status, 0, duplicateBatchResult.stderr || duplicateBatchResult.stdout);
    const duplicateBatchOutput = JSON.parse(duplicateBatchResult.stdout);
    assert.equal(duplicateBatchOutput.status, "blocked_invalid_batch_evidence");
    const duplicateBatchReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(duplicateBatchReport.rows.some((row) => row.reason.includes("duplicate_batch_ids")));
    assert.ok(duplicateBatchReport.rows.some((row) => row.reason.includes("missing_batch_ids")));

    await writeFile(batchEvidencePath, `${header}\n`);
    const headerOnlyResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(headerOnlyResult.status, 0, headerOnlyResult.stderr || headerOnlyResult.stdout);
    const headerOnlyOutput = JSON.parse(headerOnlyResult.stdout);
    assert.equal(headerOnlyOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(headerOnlyOutput.rejected, 1);
    const headerOnlyReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(headerOnlyReport.rows.some((row) => row.metricoolQueueItemId === "__batch_csv__" && row.reason.includes("missing_batch_ids")));

    const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
    assert.match(page, /sync-clippers-tiktok-batch-evidence-button/);
    assert.match(page, /clippers-tiktok-batch-evidence-sync-panel/);
    assert.match(page, /clippers-tiktok-batch-evidence-preview/);
    assert.match(page, /clippers-tiktok-batch-evidence-consistency/);
    const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
    assert.match(routes, /\/api\/clippers\/tiktok-batch-evidence-sync/);
    assert.match(routes, /\/api\/clippers\/sync-tiktok-batch-evidence/);
    assert.match(routes, /metricoolApprovalEvidencePreview/);
  } finally {
    await writeFile(batchEvidencePath, originalBatchEvidence);
    await writeFile(masterEvidencePath, originalMasterEvidence);
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok all-batches evidence sync preserves scheduled prior batch without handoff advance", async () => {
  const batchOneEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const masterEvidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalBatchOneEvidence = await readFile(batchOneEvidencePath, "utf8");
  const originalMasterEvidence = await readFile(masterEvidencePath, "utf8");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  try {
    const lines = originalBatchOneEvidence.trimEnd().split(/\r?\n/);
    const scheduledRows = lines.slice(1).map((line, index) => {
      const cells = parseTestCsvLine(line);
      cells[9] = `https://app.metricool.com/planner/all-batches-prior-batch-${index + 1}`;
      cells[10] = "";
      cells[11] = "scheduled";
      cells[12] = "";
      cells[13] = "";
      cells[14] = "";
      cells[15] = "";
      cells[16] = `Scheduled in Metricool before handoff advanced to the next batch row ${index + 1}.`;
      return renderTestCsvLine(cells);
    });
    await writeFile(batchOneEvidencePath, [lines[0], ...scheduledRows].join("\n") + "\n");
    await writeFile(
      masterEvidencePath,
      mutateTestCsvRows(originalMasterEvidence, (cells, index, header) => {
        if (index >= scheduledRows.length) return cells;
        for (const field of [
          "metricool_approval_url",
          "published_post_url",
          "final_status",
          "views_24h",
          "likes_24h",
          "comments_24h",
          "shares_24h",
          "operator_notes",
        ]) {
          cells[header.indexOf(field)] = "";
        }
        return cells;
      }),
    );

    const handoffResult = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(handoffResult.status, 0, handoffResult.stderr || handoffResult.stdout);
    const heldWorkbook = JSON.parse(await readFile(workbookPath, "utf8"));
    assert.equal(heldWorkbook.batchId, "metricool-batch-01");

    const syncResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);
    const output = JSON.parse(syncResult.stdout);
    assert.equal(output.status, "synced");
    assert.equal(output.mode, "all_batches");
    assert.equal(output.batchesChecked, 10);
    assert.equal(output.batchRows, 100);
    assert.equal(output.applied, 10);
    assert.equal(output.rejected, 0);

    const master = await readFile(masterEvidencePath, "utf8");
    assert.match(master, /https:\/\/app\.metricool\.com\/planner\/all-batches-prior-batch-1/);
    const heldHandoff = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-operator-handoff.json"), "utf8"));
    assert.equal(heldHandoff.operatorConsole.currentBatchId, "metricool-batch-01");
    assert.equal(heldHandoff.batches[0].evidenceProgress.status, "waiting_public_posts");
    const report = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.equal(report.mode, "all_batches");
    assert.equal(report.totals.batchesChecked, 10);
    assert.ok(report.rows.some((row) => row.batchId === "metricool-batch-01" && row.result === "applied"));
    assert.match(report.paths.batchEvidenceDir, /metricool-100-batch-evidence-imports$/);
  } finally {
    await writeFile(batchOneEvidencePath, originalBatchOneEvidence);
    await writeFile(masterEvidencePath, originalMasterEvidence);
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok all-batches evidence sync blocks missing or duplicate master rows", async () => {
  const batchOneEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const masterEvidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const originalBatchOneEvidence = await readFile(batchOneEvidencePath, "utf8");
  const originalMasterEvidence = await readFile(masterEvidencePath, "utf8");
  try {
    const batchLines = originalBatchOneEvidence.trimEnd().split(/\r?\n/);
    const first = batchLines[1].split(",");
    first[9] = "https://app.metricool.com/planner/master-structure-test";
    first[10] = "";
    first[11] = "scheduled";
    first[12] = "";
    first[13] = "";
    first[14] = "";
    first[15] = "";
    first[16] = "Scheduled evidence should not apply when master structure is invalid.";
    await writeFile(batchOneEvidencePath, [batchLines[0], first.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","), ...batchLines.slice(2)].join("\n") + "\n");

    const masterLines = originalMasterEvidence.trimEnd().split(/\r?\n/);
    await writeFile(masterEvidencePath, [masterLines[0], ...masterLines.slice(2)].join("\n") + "\n");
    const missingResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(missingResult.status, 0, missingResult.stderr || missingResult.stdout);
    const missingOutput = JSON.parse(missingResult.stdout);
    assert.equal(missingOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(missingOutput.applied, 0);
    assert.ok(missingOutput.rejected > 0);
    const missingReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(missingReport.rows.some((row) => row.metricoolQueueItemId === "__master_csv__" && row.reason.includes("missing_master_ids")));
    assert.doesNotMatch(await readFile(masterEvidencePath, "utf8"), /master-structure-test/);

    await writeFile(masterEvidencePath, [masterLines[0], masterLines[1], masterLines[1], ...masterLines.slice(2)].join("\n") + "\n");
    const duplicateResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(duplicateResult.status, 0, duplicateResult.stderr || duplicateResult.stdout);
    const duplicateOutput = JSON.parse(duplicateResult.stdout);
    assert.equal(duplicateOutput.status, "blocked_invalid_batch_evidence");
    assert.equal(duplicateOutput.applied, 0);
    const duplicateReport = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json"), "utf8"));
    assert.ok(duplicateReport.rows.some((row) => row.metricoolQueueItemId === "__master_csv__" && row.reason.includes("duplicate_master_ids")));
    assert.doesNotMatch(await readFile(masterEvidencePath, "utf8"), /master-structure-test/);
  } finally {
    await writeFile(batchOneEvidencePath, originalBatchOneEvidence);
    await writeFile(masterEvidencePath, originalMasterEvidence);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch runbook prepares Metricool operator instructions without publishing", async () => {
  const trackerResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(trackerResult.status, 0, trackerResult.stderr || trackerResult.stdout);

  const syncResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);

  const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_metricool_operator");
  assert.equal(output.rows, 10);
  assert.equal(output.notStarted, 10);
  assert.equal(output.readyToImport, 0);
  assert.equal(output.syncApplied, 0);
  assert.equal(output.conflicts, 0);

  const runbook = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-runbook.json"), "utf8"));
  assert.equal(runbook.status, "ready_for_metricool_operator");
  assert.equal(runbook.batch.id, "metricool-batch-01");
  assert.deepEqual(runbook.batch.platforms, ["tiktok"]);
  assert.equal(runbook.totals.rows, 10);
  assert.equal(runbook.totals.readyToImport, 0);
  assert.equal(runbook.operatorSession.batchId, "metricool-batch-01");
  assert.equal(runbook.operatorSession.currentStep, "not_started");
  assert.equal(runbook.operatorSession.nextRow.metricoolQueueItemId, "53467d8f7dad");
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.status, "ready_for_metricool_review");
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.sourceGate.status, "ready");
  assert.doesNotMatch(runbook.operatorSession.nextRow.operatorStep, tikTokMetricoolApproveCopyPattern);
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.approvalEvidenceTemplate.finalStatus, "scheduled");
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.approvalEvidenceTemplate.metricoolApprovalUrl, "<paste real Metricool planner URL after scheduling>");
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.approvalEvidenceTemplate.operatorNotes, "<write real 20+ char operator note after scheduling>");
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.liveEvidenceTemplate.publishedPostUrl, "<paste exact public TikTok video URL after live>");
  assert.doesNotMatch(JSON.stringify(runbook.operatorSession.nextRow.operatorPacket.approvalEvidenceTemplate), /approved_or_scheduled|Approved or scheduled/);
  assert.doesNotMatch(JSON.stringify(runbook.operatorSession.nextRow.operatorPacket), /https:\/\/app\.metricool\.com\/\.\.\.|https:\/\/www\.tiktok\.com\/@handle\/video\/1234567890123456789|Scheduled in Metricool; no public TikTok URL yet/);
  assert.equal(runbook.operatorSession.nextRow.operatorPacket.metricoolFields.brand, "memes");
  assert.ok(runbook.operatorSession.nextRow.operatorPacket.metricoolFields.evidenceCsvPath.includes("metricool-batch-01-evidence-import.csv"));
  assert.ok(runbook.operatorSession.nextRow.operatorPacket.checklist.some((step) => step.includes("Open Metricool brand memes")));
  assert.ok(runbook.rows.every((row) => row.operatorPacket?.metricoolFields?.platform === "tiktok"));
  assert.equal(runbook.operatorSession.copyBlocks.metricoolQueueItemId, "53467d8f7dad");
  assert.ok(runbook.operatorSession.copyBlocks.evidenceCsvPath.includes("metricool-batch-01-evidence-import.csv"));
  assert.match(runbook.operatorSession.evidenceRule, /Record scheduled only/);
  assert.doesNotMatch(runbook.operatorSession.evidenceRule, /approved\/scheduled/);
  assert.deepEqual(runbook.operatorSession.brandQueue.map((row) => row.brand).sort(), ["SPORT", "memes"].sort());
  assert.ok(runbook.operatorSession.nextRow.operatorCopyText.includes("Batch evidence CSV:"));
  assert.match(runbook.operatorSession.nextRow.operatorCopyText, /Before live: record final_status scheduled/);
  assert.doesNotMatch(runbook.operatorSession.nextRow.operatorCopyText, tikTokMetricoolApproveCopyPattern);
  assert.ok(runbook.operatorSession.nextRow.operatorCopyText.includes("metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv"));
  assert.doesNotMatch(runbook.operatorSession.nextRow.operatorCopyText, /evidence-drop\/metricool-100-approval-evidence-import\.csv/);
  assert.ok(runbook.rows.every((row) => row.operatorStep.includes("Metricool")));
  assert.ok(runbook.guardrails.some((guardrail) => guardrail.includes("approval_required")));
  assert.ok(runbook.guardrails.some((guardrail) => guardrail.includes("public TikTok URL")));

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-runbook.md"), "utf8");
  assert.match(markdown, /TikTok Batch 01 Metricool Runbook/);
  assert.match(markdown, /Operator Session/);
  assert.match(markdown, /Copy-Safe Operator Packet/);
  assert.match(markdown, /Packet status: ready_for_metricool_review/);
  assert.match(markdown, /Metricool HTTPS URL/);
  assert.match(markdown, /approval_required/);
  assert.match(markdown, /public TikTok URL/);
  assert.doesNotMatch(markdown, /approve\/schedule|schedule\/approve|approve or schedule|approved or scheduled|approving\/scheduling|approval\/scheduling|autopublish|ready_to_send/i);

  const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-runbook.csv"), "utf8");
  assert.match(csv, /operator_session/);
  assert.match(csv, /operator_step/);
  assert.match(csv, /operator_packet_status/);
  assert.match(csv, /operator_checklist/);
  assert.match(csv, /metricool_queue_item_id/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/tiktok-batch-runbook/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-batch-runbook/);
  assert.match(routes, /script\/clippers-tiktok-batch-runbook\.mjs/);
  assert.match(routes, /script\/clippers-tiktok-batch-evidence-sync\.mjs/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-tiktok-batch-runbook-button/);
  assert.match(page, /clippers-tiktok-batch-runbook-panel/);
  assert.match(page, /clippers-tiktok-operator-session/);
  assert.match(page, /clippers-tiktok-runbook-source-gate/);
  assert.match(page, /clippers-tiktok-runbook-row-source-gate/);
  assert.match(page, /clippers-tiktok-operator-packet/);
  assert.match(page, /Copy-safe Metricool packet/);
  assert.match(page, /Source OK/);
  assert.match(page, /Source blocked/);
  assert.match(page, /Source pending/);
  assert.match(page, /sourceExists === true/);
  assert.match(page, /sourceVideoValid === true/);
  assert.match(page, /Metricool operator session/);
  assert.match(page, /TikTok Batch Runbook/);
});

test("TikTok batch runbook blocks false operator readiness from rejected or conflicted evidence", async () => {
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const syncPath = path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json");
  const runbookPath = path.join(rootDir, "reports/clippers-tiktok-batch-runbook.json");
  const originalTracker = await readFile(trackerPath, "utf8");
  const originalSync = await readFile(syncPath, "utf8");
  const originalRunbook = await readFile(runbookPath, "utf8").catch(() => null);

  try {
    const tracker = JSON.parse(originalTracker);
    tracker.status = "ready_to_import";
    tracker.rows = tracker.rows.map((row) => ({
      ...row,
      state: "rejected",
      blocker: "operator_rejected",
      nextAction: "Replace this row before counting it toward the batch.",
    }));
    tracker.totals = {
      ...tracker.totals,
      notStarted: 0,
      scheduled: 0,
      waitingMetrics: 0,
      readyToImport: 0,
      needsFix: 0,
      rejected: tracker.rows.length,
    };
    const sync = JSON.parse(originalSync);
    sync.status = "blocked";
    sync.totals = { ...(sync.totals || {}), applied: 0, rejected: 1 };
    sync.consistency = { ...(sync.consistency || {}), conflicts: 1 };
    await writeFile(trackerPath, JSON.stringify(tracker, null, 2));
    await writeFile(syncPath, JSON.stringify(sync, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "in_progress");
    assert.equal(output.syncApplied, 0);
    assert.equal(output.conflicts, 1);

    const runbook = JSON.parse(await readFile(runbookPath, "utf8"));
    assert.equal(runbook.status, "in_progress");
    assert.equal(runbook.operatorSession.currentStep, "sync_blocked");
    assert.equal(runbook.operatorSession.nextRow, null);
    assert.equal(runbook.operatorSession.copyBlocks, null);
    assert.equal(runbook.operatorSession.syncBlocker.result, "rejected");
    assert.ok(runbook.operatorSession.syncBlocker.reason);
    assert.match(runbook.operatorSession.nextAction, /Fix batch evidence sync blocker/);
    assert.equal(runbook.totals.syncRejected, 1);
    assert.equal(runbook.totals.conflicts, 1);

    const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-runbook.md"), "utf8");
    assert.match(markdown, /Evidence Sync Blocker/);
    assert.match(markdown, /Batch evidence CSV:/);
    assert.match(markdown, /metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
    assert.doesNotMatch(markdown, /evidence-drop\/metricool-100-approval-evidence-import\.csv/);
  } finally {
    await writeFile(trackerPath, originalTracker);
    await writeFile(syncPath, originalSync);
    if (originalRunbook) await writeFile(runbookPath, originalRunbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch runbook stops Metricool work when sync evidence is rejected but tracker is still operable", async () => {
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const syncPath = path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json");
  const runbookPath = path.join(rootDir, "reports/clippers-tiktok-batch-runbook.json");
  const originalTracker = await readFile(trackerPath, "utf8");
  const originalSync = await readFile(syncPath, "utf8");
  const originalRunbook = await readFile(runbookPath, "utf8").catch(() => null);

  try {
    const tracker = JSON.parse(originalTracker);
    tracker.status = "ready_for_metricool_review";
    tracker.rows = tracker.rows.map((row) => ({
      ...row,
      state: "not_started",
      blocker: "",
      nextAction: "Open Metricool and process this row.",
      sourceExists: true,
      sourceVideoValid: true,
    }));
    tracker.totals = {
      ...tracker.totals,
      notStarted: tracker.rows.length,
      scheduled: 0,
      waitingMetrics: 0,
      readyToImport: 0,
      needsFix: 0,
      rejected: 0,
    };
    const sync = JSON.parse(originalSync);
    sync.status = "blocked_invalid_batch_evidence";
    sync.totals = { ...(sync.totals || {}), applied: 0, rejected: 1 };
    sync.consistency = { ...(sync.consistency || {}), conflicts: 0 };
    sync.rows = [{
      metricoolQueueItemId: "53467d8f7dad",
      result: "rejected",
      reason: "published_post_url_must_be_public_tiktok_url",
      consistency: "needs_master_sync",
    }];
    await writeFile(trackerPath, JSON.stringify(tracker, null, 2));
    await writeFile(syncPath, JSON.stringify(sync, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const runbook = JSON.parse(await readFile(runbookPath, "utf8"));
    assert.equal(runbook.status, "in_progress");
    assert.equal(runbook.operatorSession.currentStep, "sync_blocked");
    assert.equal(runbook.operatorSession.nextRow, null);
    assert.equal(runbook.operatorSession.copyBlocks, null);
    assert.equal(runbook.operatorSession.syncBlocker.metricoolQueueItemId, "53467d8f7dad");
    assert.equal(runbook.operatorSession.syncBlocker.result, "rejected");
    assert.equal(runbook.operatorSession.syncBlocker.reason, "published_post_url_must_be_public_tiktok_url");
    assert.match(runbook.operatorSession.nextAction, /Fix batch evidence sync blocker/);

    const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-runbook.csv"), "utf8");
    assert.match(csv, /published_post_url_must_be_public_tiktok_url/);

    const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
    assert.match(page, /clippers-tiktok-runbook-sync-blocker/);
    assert.match(page, /Evidence sync blocked/);
  } finally {
    await writeFile(trackerPath, originalTracker);
    await writeFile(syncPath, originalSync);
    if (originalRunbook) await writeFile(runbookPath, originalRunbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch runbook gives state-aware packets and blocks ready rows with missing metrics", async () => {
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const syncPath = path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json");
  const runbookPath = path.join(rootDir, "reports/clippers-tiktok-batch-runbook.json");
  const originalTracker = await readFile(trackerPath, "utf8");
  const originalSync = await readFile(syncPath, "utf8");
  const originalRunbook = await readFile(runbookPath, "utf8").catch(() => null);

  try {
    const tracker = JSON.parse(originalTracker);
    tracker.rows = tracker.rows.map((row) => ({
      ...row,
      state: "scheduled",
      blocker: "",
      nextAction: "Wait until TikTok is public, then record exact public video URL and 24h metrics.",
      metricoolApprovalUrl: "https://app.metricool.com/planner/test",
    }));
    tracker.totals = {
      ...tracker.totals,
      notStarted: 0,
      scheduled: tracker.rows.length,
      waitingMetrics: 0,
      readyToImport: 0,
      needsFix: 0,
      rejected: 0,
    };
    const sync = JSON.parse(originalSync);
    sync.status = "synced";
    sync.totals = { ...(sync.totals || {}), applied: 1, rejected: 0 };
    sync.consistency = { ...(sync.consistency || {}), conflicts: 0 };
    await writeFile(trackerPath, JSON.stringify(tracker, null, 2));
    await writeFile(syncPath, JSON.stringify(sync, null, 2));

    const scheduledResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(scheduledResult.status, 0, scheduledResult.stderr || scheduledResult.stdout);
    const scheduledRunbook = JSON.parse(await readFile(runbookPath, "utf8"));
    assert.equal(scheduledRunbook.operatorSession.currentStep, "scheduled");
    assert.equal(scheduledRunbook.operatorSession.nextRow.operatorPacket.status, "waiting_public_tiktok_url");
    assert.ok(scheduledRunbook.operatorSession.nextRow.operatorPacket.checklist.some((step) => step.includes("Do not schedule this row again")));
    assert.doesNotMatch(scheduledRunbook.operatorSession.nextRow.operatorPacket.checklist.join("\n"), /Open Metricool brand|Schedule\/approve/);

    tracker.rows = tracker.rows.map((row, index) => ({
      ...row,
      state: index === 0 ? "ready_to_import" : row.state,
      publishedPostUrl: index === 0 ? "https://www.tiktok.com/@memeradar/video/1234567890123456789" : row.publishedPostUrl,
      views24h: index === 0 ? undefined : row.views24h,
      likes24h: index === 0 ? undefined : row.likes24h,
      comments24h: index === 0 ? undefined : row.comments24h,
      shares24h: index === 0 ? undefined : row.shares24h,
    }));
    tracker.totals = {
      ...tracker.totals,
      notStarted: tracker.rows.length - 1,
      scheduled: 0,
      waitingMetrics: 0,
      readyToImport: 1,
    };
    await writeFile(trackerPath, JSON.stringify(tracker, null, 2));
    const unsafeReadyResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(unsafeReadyResult.status, 0);
    assert.match(unsafeReadyResult.stderr, /unsafe ready_to_import row/);
  } finally {
    await writeFile(trackerPath, originalTracker);
    await writeFile(syncPath, originalSync);
    if (originalRunbook) await writeFile(runbookPath, originalRunbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch runbook refuses stale or invalid source video validation", async () => {
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const syncPath = path.join(rootDir, "reports/clippers-tiktok-batch-evidence-sync.json");
  const runbookPath = path.join(rootDir, "reports/clippers-tiktok-batch-runbook.json");
  const originalTracker = await readFile(trackerPath, "utf8");
  const originalSync = await readFile(syncPath, "utf8");
  const originalRunbook = await readFile(runbookPath, "utf8").catch(() => null);

  try {
    const sync = JSON.parse(originalSync);
    sync.status = "no_operator_updates";
    sync.totals = { ...(sync.totals || {}), applied: 0, rejected: 0 };
    sync.consistency = { ...(sync.consistency || {}), conflicts: 0 };
    await writeFile(syncPath, JSON.stringify(sync, null, 2));

    const invalidVideoTracker = JSON.parse(originalTracker);
    invalidVideoTracker.status = "ready_for_metricool_review";
    invalidVideoTracker.rows = invalidVideoTracker.rows.map((row, index) => ({
      ...row,
      state: "not_started",
      blocker: "waiting_metricool_review",
      sourceExists: true,
      sourceVideoValid: index === 0 ? false : true,
    }));
    await writeFile(trackerPath, JSON.stringify(invalidVideoTracker, null, 2));
    const invalidVideoResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(invalidVideoResult.status, 0, invalidVideoResult.stderr || invalidVideoResult.stdout);
    const invalidVideoRunbook = JSON.parse(await readFile(runbookPath, "utf8"));
    assert.equal(invalidVideoRunbook.status, "in_progress");
    assert.equal(invalidVideoRunbook.operatorSession.nextRow.operatorPacket.status, "blocked_source_file");
    assert.match(invalidVideoRunbook.operatorSession.nextRow.operatorCopyText, /Stop before Metricool/);
    assert.doesNotMatch(invalidVideoRunbook.operatorSession.nextRow.operatorCopyText, /Schedule\/approve|Open Metricool brand/);

    const staleTracker = JSON.parse(originalTracker);
    staleTracker.status = "ready_for_metricool_review";
    staleTracker.rows = staleTracker.rows.map((row, index) => {
      const next = {
        ...row,
        state: "not_started",
        blocker: "waiting_metricool_review",
        sourceExists: true,
      };
      if (index === 0) delete next.sourceVideoValid;
      else next.sourceVideoValid = true;
      return next;
    });
    await writeFile(trackerPath, JSON.stringify(staleTracker, null, 2));
    const staleResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(staleResult.status, 0, staleResult.stderr || staleResult.stdout);
    const staleRunbook = JSON.parse(await readFile(runbookPath, "utf8"));
    assert.equal(staleRunbook.status, "in_progress");
    assert.equal(staleRunbook.operatorSession.nextRow.operatorPacket.status, "pending_source_verification");
    assert.match(staleRunbook.operatorSession.nextRow.operatorCopyText, /Refresh TikTok batch tracker/);
    assert.doesNotMatch(staleRunbook.operatorSession.nextRow.operatorCopyText, /Schedule\/approve|Open Metricool brand/);
  } finally {
    await writeFile(trackerPath, originalTracker);
    await writeFile(syncPath, originalSync);
    if (originalRunbook) await writeFile(runbookPath, originalRunbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP go-live packet combines account closeout and batch runbook safely", async () => {
  for (const script of [
    "script/clippers-account-permission-readiness.mjs",
    "script/clippers-tiktok-batch-evidence-sync.mjs",
    "script/clippers-tiktok-batch-tracker.mjs",
    "script/clippers-tiktok-batch-runbook.mjs",
    "script/clippers-tiktok-evidence-checklist.mjs",
    "script/clippers-goal-completion-audit.mjs",
    "script/clippers-metricool-operator-handoff.mjs",
  ]) {
    const prerequisite = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(prerequisite.status, 0, prerequisite.stderr || prerequisite.stdout);
  }
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "in_progress");
  assert.equal(output.accountReady, 0);
  assert.equal(output.accountRows, 2);
  assert.equal(output.batchRows, 10);
  assert.equal(output.notStarted, 10);
  assert.equal(output.readyToImport, 0);
  assert.equal(output.evidenceMissingApproval, 10);
  assert.equal(output.evidenceReadyForImportPreview, 0);
  assert.equal(output.metricool100Rows, 100);
  assert.equal(output.metricool100ReadyBatches, 0);
  assert.equal(output.metricool100SourceReadyBatches, 10);
  assert.equal(output.metricool100BlockedBatches, 10);
  assert.equal(output.conflicts, 0);
  assert.equal(output.nextQueueItem, "53467d8f7dad");

  const packet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.json"), "utf8"));
  assert.equal(packet.status, "in_progress");
  assert.equal(packet.launchMode, "metricool_approval_required");
  assert.equal(packet.operatingMode.scope, "tiktok_only_metricool_mvp");
  assert.deepEqual(packet.operatingMode.activePlatforms, ["tiktok"]);
  assert.deepEqual(packet.operatingMode.deferredLanes, ["instagram", "youtube", "streamers"]);
  assert.equal(packet.operatingMode.batchOnlyUsesActiveTikTokAccounts, false);
  assert.equal(packet.operatingMode.batchPlatformCheck, "blocked_non_tiktok_or_inactive_account");
  assert.deepEqual(packet.operatingMode.batchPlatforms, ["tiktok"]);
  assert.deepEqual(packet.operatingMode.batchAccountIds, ["meme-radar", "sports-daily"]);
  assert.deepEqual(packet.operatingMode.activeMetricoolBrands, []);
  assert.equal(packet.operatingMode.activeAccounts.length, 0);
  assert.equal(packet.directSocialApisRequired, false);
  assert.equal(packet.realPublishEnabled, false);
  assert.equal(packet.totals.accountReady, 0);
  assert.equal(packet.totals.accountRows, 2);
  assert.equal(packet.totals.activeTikTokAccounts, 0);
  assert.equal(packet.totals.readyToImport, 0);
  assert.equal(packet.totals.evidenceMissingApproval, 10);
  assert.equal(packet.totals.evidenceReadyForImportPreview, 0);
  assert.equal(packet.totals.metricool100Rows, 100);
  assert.equal(packet.totals.metricool100ReadyBatches, 0);
  assert.equal(packet.totals.metricool100SourceReadyBatches, 10);
  assert.equal(packet.totals.metricool100BlockedBatches, 10);
  assert.equal(packet.metricool100.status, "ready_for_operator");
  assert.equal(packet.metricool100.consoleStatus, "ready_for_metricool_review");
  assert.equal(packet.metricool100.rows, 100);
  assert.equal(packet.metricool100.batches, 10);
  assert.equal(packet.metricool100.sourceReadyBatches, 10);
  assert.equal(packet.metricool100.readyBatches, 0);
  assert.equal(packet.metricool100.blockedBatches, 10);
  assert.equal(packet.metricool100.operatorGateOpen, false);
  assert.equal(packet.metricool100.readyToSend, 0);
  assert.equal(packet.metricool100.publishedRowsCounted, 0);
  assert.equal(packet.metricool100.currentBatchId, "metricool-batch-01");
  assert.equal(packet.metricool100.currentBatchSourceGateTotals.ready, 10);
  assert.equal(packet.metricool100.ready, false);
  assert.match(packet.nextStep, /Finish TikTok account ownership\/security evidence/);
  assert.match(packet.nextStep, /Metricool connection proof/);
  assert.doesNotMatch(packet.nextStep, /public TikTok URLs and 24h metrics only after posts are live/);
  assert.equal(packet.sourceStatuses.accountCloseout, "needs_tiktok_account_evidence");
  assert.equal(packet.sourceStatuses.evidenceChecklist, "ready_for_metricool_operator");
  assert.equal(packet.sourceStatuses.metricool100Handoff, "ready_for_operator");
  assert.ok(packet.operatorSteps.some((step) => step.id === "account-closeout" && step.blocker === "tiktok_account_closeout_not_ready"));
  assert.ok(packet.operatorSteps.some((step) => step.id === "live-evidence" && step.action.includes("evidence checklist")));
  assert.ok(packet.guardrails.some((guardrail) => guardrail.includes("realPublishEnabled remains false")));
  assert.ok(packet.guardrails.some((guardrail) => guardrail.includes("Scheduled rows are not counted as published")));
  assert.ok(packet.guardrails.some((guardrail) => guardrail.includes("Direct social APIs are not required")));

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.md"), "utf8");
  assert.match(markdown, /Clippers TikTok MVP Go-Live Packet/);
  assert.match(markdown, /Scope: tiktok_only_metricool_mvp/);
  assert.match(markdown, /Active platforms: tiktok/);
  assert.match(markdown, /Deferred lanes: instagram, youtube, streamers/);
  assert.match(markdown, /Batch platform check: blocked_non_tiktok_or_inactive_account/);
  assert.match(markdown, /Metricool remains approval_required/);
  assert.match(markdown, /Scheduled proof missing: 10/);
  assert.match(markdown, /Metricool 100 Run/);
  assert.match(markdown, /Metricool 100 rows ready: 100/);
  assert.match(markdown, /Metricool 100 operator-ready batches: 0/);
  assert.match(markdown, /Metricool 100 source-ready batches: 10/);
  assert.match(markdown, /Operator-ready batches: 0/);
  assert.match(markdown, /Source-ready batches: 10/);
  assert.match(markdown, /Published rows counted: 0/);
  assert.match(markdown, /public TikTok URLs and 24h metrics/);
  assert.doesNotMatch(markdown, /ready_to_send|auto publish/i);

  const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.csv"), "utf8");
  assert.match(csv, /"section","step","status","owner","scope","active_platforms","active_metricool_brands","deferred_lanes","action","proof","blocker"/);
  assert.match(csv, /tiktok_only_metricool_mvp/);
  assert.match(csv, /instagram\|youtube\|streamers/);
  assert.match(csv, /blocked_non_tiktok_or_inactive_account/);
  assert.match(csv, /metricool-batch/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/tiktok-mvp-go-live-packet/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-mvp-go-live-packet/);
  assert.match(routes, /script\/clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(routes, /script\/clippers-tiktok-evidence-checklist\.mjs/);
  const goLiveGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/tiktok-mvp-go-live-packet"'),
    routes.indexOf('app.get("/api/clippers/tiktok-mvp-readiness-verifier"'),
  );
  assert.doesNotMatch(goLiveGetRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.doesNotMatch(goLiveGetRoute, /runClipperJsonScript|runClipperNodeJson|clippers-tiktok-mvp-go-live-packet\.mjs|clippers-tiktok-evidence-checklist\.mjs/);
  assert.match(goLiveGetRoute, /readClipperTikTokMvpGoLivePacket/);
  const goLivePostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-mvp-go-live-packet"'),
    routes.indexOf('app.post("/api/clippers/prepare-metricool-approval-quick-run"'),
  );
  assert.match(goLivePostRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.match(goLivePostRoute, /--all-batches/);
  assert.match(goLivePostRoute, /clippers-tiktok-evidence-checklist\.mjs/);
  const goLiveScript = await readFile(path.join(process.cwd(), "script/clippers-tiktok-mvp-go-live-packet.mjs"), "utf8");
  assert.match(goLiveScript, /const readOnlyMode = process\.argv\.includes\("--read-only"\)/);
  assert.match(goLiveScript, /if \(!readOnlyMode\) \{[\s\S]*clippers-tiktok-batch-evidence-sync\.mjs[\s\S]*--all-batches/);
  assert.match(goLiveScript, /if \(!readOnlyMode\) \{[\s\S]*writeFile\(outJsonPath/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-tiktok-mvp-go-live-packet-button/);
  assert.match(page, /clippers-tiktok-mvp-go-live-packet-panel/);
  assert.match(page, /clippers-tiktok-mvp-metricool-100-summary/);
  assert.match(page, /Metricool 100 run/);
  assert.match(page, /clippers-tiktok-only-operating-mode/);
  assert.match(page, /TikTok-only operating mode/);
  assert.match(page, /batchOnlyUsesActiveTikTokAccounts/);
  assert.match(page, /Direct social APIs required/);
  assert.match(page, /Metricool approval required/);
  assert.match(page, /TikTok MVP Go-Live Packet/);
  assert.match(page, /Scheduled proof/);
  assert.match(page, /select-tiktok-go-live-next-row-button/);
});

test("TikTok MVP go-live packet stays in progress when Metricool 100 is blocked", async () => {
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const packetPath = path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.json");
  const originalHandoff = await readFile(handoffPath, "utf8");
  const originalPacket = await readFile(packetPath, "utf8");
  try {
    const blockedHandoff = JSON.parse(originalHandoff);
    blockedHandoff.status = "blocked_source_verification";
    blockedHandoff.operatorConsole = {
      ...(blockedHandoff.operatorConsole || {}),
      status: "blocked_source_verification",
    };
    blockedHandoff.batches = (blockedHandoff.batches || []).map((batch, index) => ({
      ...batch,
      status: index === 0 ? "blocked_source_verification" : batch.status,
    }));
    await writeFile(handoffPath, JSON.stringify(blockedHandoff, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs", "--read-only"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "in_progress");
    assert.equal(output.metricool100BlockedBatches, 1);
    assert.equal(await readFile(packetPath, "utf8"), originalPacket);
  } finally {
    await writeFile(handoffPath, originalHandoff);
  }
});

test("TikTok MVP go-live packet refreshes stale account closeout before reporting readiness", async () => {
  const accountCloseoutPath = path.join(rootDir, "tiktok-mvp-account-closeout.json");
  const originalAccountCloseout = await readFile(accountCloseoutPath, "utf8");
  try {
    const staleCloseout = JSON.parse(originalAccountCloseout);
    staleCloseout.status = "needs_tiktok_account_evidence";
    staleCloseout.totals = { ...(staleCloseout.totals || {}), ready: 0, rows: 2 };
    staleCloseout.rows = (staleCloseout.rows || []).map((row) => ({
      ...row,
      status: "needs_account_proof",
      metricoolConnected: false,
    }));
    await writeFile(accountCloseoutPath, JSON.stringify(staleCloseout, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "in_progress");
    assert.equal(output.accountReady, 0);

    const refreshedCloseout = JSON.parse(await readFile(accountCloseoutPath, "utf8"));
    assert.equal(refreshedCloseout.status, "needs_tiktok_account_evidence");
    assert.equal(refreshedCloseout.totals.ready, 0);
  } finally {
    await writeFile(accountCloseoutPath, originalAccountCloseout);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP go-live packet refreshes stale non-TikTok or inactive-account batch artifacts", async () => {
  const runbookPath = path.join(rootDir, "reports/clippers-tiktok-batch-runbook.json");
  const trackerPath = path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json");
  const packetPath = path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.json");
  const originalRunbook = await readFile(runbookPath, "utf8");
  const originalTracker = await readFile(trackerPath, "utf8");
  const originalPacket = await readFile(packetPath, "utf8").catch(() => null);

  try {
    const runbook = JSON.parse(originalRunbook);
    const tracker = JSON.parse(originalTracker);
    runbook.rows[0] = {
      ...runbook.rows[0],
      accountId: "instagram-later",
      accountName: "Instagram Later",
      platform: "instagram",
      metricoolBrandName: "IG",
    };
    tracker.rows[0] = {
      ...tracker.rows[0],
      accountId: "instagram-later",
      accountName: "Instagram Later",
      platform: "instagram",
      metricoolBrandName: "IG",
    };
    await writeFile(runbookPath, JSON.stringify(runbook, null, 2));
    await writeFile(trackerPath, JSON.stringify(tracker, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "in_progress");

    const packet = JSON.parse(await readFile(packetPath, "utf8"));
    assert.equal(packet.status, "in_progress");
    assert.equal(packet.operatingMode.scope, "tiktok_only_metricool_mvp");
    assert.equal(packet.operatingMode.batchOnlyUsesActiveTikTokAccounts, false);
    assert.equal(packet.operatingMode.batchPlatformCheck, "blocked_non_tiktok_or_inactive_account");
    assert.deepEqual(packet.operatingMode.batchPlatforms, ["tiktok"]);
    assert.ok(!packet.operatingMode.batchAccountIds.includes("instagram-later"));
    assert.ok(packet.nextStep.includes("TikTok account ownership/security evidence"));

    const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.md"), "utf8");
    assert.match(markdown, /Batch platform check: blocked_non_tiktok_or_inactive_account/);

    const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.csv"), "utf8");
    assert.match(csv, /"section","step","status","owner","scope","active_platforms","active_metricool_brands","deferred_lanes","action","proof","blocker"/);
    assert.match(csv, /tiktok_only_metricool_mvp/);
    assert.doesNotMatch(csv, /instagram-later/);
    assert.match(csv, /blocked_non_tiktok_or_inactive_account/);

    const inactiveRunbook = JSON.parse(originalRunbook);
    const inactiveTracker = JSON.parse(originalTracker);
    inactiveRunbook.rows[0] = {
      ...inactiveRunbook.rows[0],
      accountId: "inactive-tiktok-account",
      accountName: "Inactive TikTok Account",
      platform: "tiktok",
      metricoolBrandName: "inactive",
    };
    inactiveTracker.rows[0] = {
      ...inactiveTracker.rows[0],
      accountId: "inactive-tiktok-account",
      accountName: "Inactive TikTok Account",
      platform: "tiktok",
      metricoolBrandName: "inactive",
    };
    await writeFile(runbookPath, JSON.stringify(inactiveRunbook, null, 2));
    await writeFile(trackerPath, JSON.stringify(inactiveTracker, null, 2));

    const inactiveResult = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(inactiveResult.status, 0, inactiveResult.stderr || inactiveResult.stdout);
    const inactiveOutput = JSON.parse(inactiveResult.stdout);
    assert.equal(inactiveOutput.status, "in_progress");

    const inactivePacket = JSON.parse(await readFile(packetPath, "utf8"));
    assert.equal(inactivePacket.status, "in_progress");
    assert.equal(inactivePacket.operatingMode.batchOnlyUsesActiveTikTokAccounts, false);
    assert.equal(inactivePacket.operatingMode.batchPlatformCheck, "blocked_non_tiktok_or_inactive_account");
    assert.deepEqual(inactivePacket.operatingMode.batchPlatforms, ["tiktok"]);
    assert.ok(!inactivePacket.operatingMode.batchAccountIds.includes("inactive-tiktok-account"));
  } finally {
    await writeFile(runbookPath, originalRunbook);
    await writeFile(trackerPath, originalTracker);
    if (originalPacket) {
      await writeFile(packetPath, originalPacket);
    }
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-go-live-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok evidence checklist explains missing Metricool evidence without syncing", async () => {
  for (const script of [
    "script/clippers-tiktok-batch-tracker.mjs",
    "script/clippers-tiktok-batch-runbook.mjs",
  ]) {
    const prerequisite = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(prerequisite.status, 0, prerequisite.stderr || prerequisite.stdout);
  }
  const result = spawnSync(process.execPath, ["script/clippers-tiktok-evidence-checklist.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_metricool_operator");
  assert.equal(output.rows, 10);
  assert.equal(output.missingApproval, 10);
  assert.equal(output.readyForImportPreview, 0);

  const checklist = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-evidence-checklist.json"), "utf8"));
  assert.equal(checklist.status, "ready_for_metricool_operator");
  assert.equal(checklist.totals.rows, 10);
  assert.equal(checklist.totals.missingApproval, 10);
  assert.equal(checklist.totals.missingPublicUrl, 0);
	  assert.equal(checklist.totals.readyForImportPreview, 0);
	  assert.match(checklist.paths.html, /clippers-tiktok-evidence-checklist\.html$/);
	  assert.ok(checklist.rows.every((row) => row.missingFields.includes("metricool_approval_url")));
  assert.ok(checklist.guardrails.some((guardrail) => guardrail.includes("read-only")));
  assert.ok(checklist.guardrails.some((guardrail) => guardrail.includes("exact public TikTok video URLs")));
  assert.ok(checklist.guardrails.some((guardrail) => guardrail.includes("For scheduled rows")));
  assert.ok(checklist.guardrails.some((guardrail) => guardrail.includes("Scheduled rows are not published")));
  assert.match(checklist.rows[0].evidenceTemplate, /metricool_approval_url=<paste real Metricool planner URL after scheduling>/);
  assert.match(checklist.rows[0].evidenceTemplate, /operator_notes=<write real 20\+ char operator note after scheduling>/);
  assert.doesNotMatch(checklist.rows[0].evidenceTemplate, /operator_notes=Scheduled in Metricool/);
  assert.match(checklist.rows[0].evidenceTemplate, /published_post_url=\n/);
  assert.match(checklist.rows[0].evidenceTemplate, /views_24h=\n/);
  assert.doesNotMatch(checklist.rows[0].evidenceTemplate, /published_post_url=https:\/\/www\.tiktok\.com\/@handle\/video/);
  assert.match(checklist.rows[0].scheduledCsvTemplate, /"scheduled"/);
  assert.match(checklist.rows[0].scheduledCsvTemplate, /<paste real Metricool planner URL after scheduling>/);
  assert.match(checklist.rows[0].scheduledCsvTemplate, /<write real 20\+ char operator note after scheduling>/);
  assert.doesNotMatch(checklist.rows[0].scheduledCsvTemplate, /"published"|https:\/\/www\.tiktok\.com\/@handle\/video|client_secret=|access_token=|refresh_token=/i);

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-evidence-checklist.md"), "utf8");
  assert.match(markdown, /TikTok Metricool Evidence Checklist/);
  assert.match(markdown, /Read-only checklist/);
  assert.match(markdown, /Scheduled CSV row template/);
  assert.match(markdown, /metricool_approval_url=<paste real Metricool planner URL after scheduling>/);
  assert.doesNotMatch(markdown, /ready_to_send|auto publish/i);

	  const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-evidence-checklist.csv"), "utf8");
	  assert.match(csv, /missing_fields/);
	  assert.match(csv, /scheduled_csv_template/);
	  assert.match(csv, /metricool_approval_url/);

	  const html = await readFile(checklist.paths.html, "utf8");
	  assert.match(html, /TikTok Metricool Evidence Console/);
	  assert.match(html, /Download evidence CSV draft/);
	  assert.match(html, /Copy CSV draft/);
	  assert.match(html, /Copy scheduled CSV row template/);
	  assert.match(html, /This page prepares a CSV only/);
	  assert.equal((html.match(/<article class="row"/g) || []).length, 10);
	  assert.match(html, /"final_status":""/);
	  assert.match(html, /"operator_notes":""/);
	  assert.doesNotMatch(html, /selected>scheduled/);
	  assert.doesNotMatch(html, /Scheduled in Metricool with real operator context/);
	  assert.doesNotMatch(html, /ready_to_send|auto publish/i);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/tiktok-evidence-checklist/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-evidence-checklist/);
  assert.match(routes, /script\/clippers-tiktok-evidence-checklist\.mjs/);
  const checklistGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/tiktok-evidence-checklist"'),
    routes.indexOf('app.get("/api/clippers/tiktok-mvp-go-live-packet"'),
  );
  assert.doesNotMatch(checklistGetRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  const checklistPostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-evidence-checklist"'),
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-operator-cockpit"'),
  );
  assert.doesNotMatch(checklistPostRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-tiktok-evidence-checklist-button/);
  assert.match(page, /clippers-tiktok-evidence-checklist-panel/);
  assert.match(page, /select-tiktok-evidence-checklist-row/);
  assert.match(page, /TikTokEvidenceChecklistSummary[\s\S]*html\?: string/);
  assert.match(page, /Console: \{tiktokEvidenceChecklist\.paths\.html\}/);
});

test("TikTok evidence checklist does not mark mixed batches ready for import preview", async () => {
  const evidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const workbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json"), "utf8"));
  const firstWorkbookRow = workbook.rows[0];
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const lines = originalEvidence.trimEnd().split(/\r?\n/);
    lines[1] = [
      firstWorkbookRow.metricoolQueueItemId,
      firstWorkbookRow.accountId,
      firstWorkbookRow.accountName,
      firstWorkbookRow.platform,
      firstWorkbookRow.metricoolBrandName,
      firstWorkbookRow.metricoolBlogId,
      firstWorkbookRow.publishAt,
      firstWorkbookRow.sourcePath,
      firstWorkbookRow.captionSeed,
      `https://app.metricool.com/planner/${firstWorkbookRow.metricoolQueueItemId}`,
      "https://www.tiktok.com/@memeradar/video/1234567890123456789",
      "published",
      "100",
      "10",
      "2",
      "1",
      "One row is ready but the rest of the batch still needs Metricool evidence.",
    ].join(",");
    await writeFile(evidencePath, lines.join("\n") + "\n");
    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-batch-runbook.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const checklist = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-evidence-checklist.json"), "utf8"));
    assert.equal(checklist.totals.readyForImportPreview, 1);
    assert.equal(checklist.totals.missingApproval, 9);
    assert.equal(checklist.status, "ready_for_metricool_operator");
    assert.notEqual(checklist.status, "ready_for_import_preview");
    assert.match(checklist.rows[0].evidenceTemplate, /final_status=published/);
    assert.doesNotMatch(checklist.rows[0].evidenceTemplate, /final_status=ready_to_import/);
    assert.match(checklist.rows[0].evidenceTemplate, /published_post_url=<existing exact public TikTok video URL>/);
    assert.match(checklist.rows[0].evidenceTemplate, /views_24h=<existing nonzero 24h metrics>/);
	    assert.match(checklist.rows[1].evidenceTemplate, /final_status=<scheduled only after real Metricool scheduling proof>/);
	    assert.match(checklist.rows[1].evidenceTemplate, /metricool_approval_url=<paste real Metricool planner URL after scheduling>/);
    assert.match(checklist.rows[1].evidenceTemplate, /operator_notes=<write real 20\+ char operator note after scheduling>/);
    assert.doesNotMatch(checklist.rows[1].evidenceTemplate, /operator_notes=Scheduled in Metricool/);
    assert.doesNotMatch(checklist.rows[1].evidenceTemplate, /published_post_url=https:\/\/www\.tiktok\.com\/@handle\/video/);
    assert.equal(checklist.rows[0].metricoolApprovalUrl, `https://app.metricool.com/planner/${firstWorkbookRow.metricoolQueueItemId}`);
	    assert.equal(checklist.rows[0].publishedPostUrl, "https://www.tiktok.com/@memeradar/video/1234567890123456789");
	    assert.equal(checklist.rows[0].finalStatus, "published");
	    assert.equal(checklist.rows[0].views24h, 100);
	    assert.equal(checklist.rows[0].operatorNotes, "One row is ready but the rest of the batch still needs Metricool evidence.");
	    const html = await readFile(checklist.paths.html, "utf8");
	    assert.match(html, /https:\/\/app\.metricool\.com\/planner\/53467d8f7dad/);
	    assert.match(html, /https:\/\/www\.tiktok\.com\/@memeradar\/video\/1234567890123456789/);
	    assert.match(html, /One row is ready but the rest of the batch still needs Metricool evidence\./);
	    assert.match(html, /"final_status":"published"/);
	    assert.match(html, /"views_24h":100/);
	  } finally {
    await writeFile(evidencePath, originalEvidence);
    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-batch-runbook.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
    ]) {
      spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
  }
});

test("TikTok evidence checklist keeps scheduled rows free of fake public URL examples", async () => {
  const evidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const workbook = JSON.parse(await readFile(path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json"), "utf8"));
  const firstWorkbookRow = workbook.rows[0];
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const lines = originalEvidence.trimEnd().split(/\r?\n/);
    lines[1] = [
      firstWorkbookRow.metricoolQueueItemId,
      firstWorkbookRow.accountId,
      firstWorkbookRow.accountName,
      firstWorkbookRow.platform,
      firstWorkbookRow.metricoolBrandName,
      firstWorkbookRow.metricoolBlogId,
      firstWorkbookRow.publishAt,
      firstWorkbookRow.sourcePath,
      firstWorkbookRow.captionSeed,
      `https://app.metricool.com/planner/${firstWorkbookRow.metricoolQueueItemId}`,
      "",
      "scheduled",
      "",
      "",
      "",
      "",
      "Scheduled in Metricool after checking the source file and caption.",
    ].join(",");
    await writeFile(evidencePath, lines.join("\n") + "\n");
    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-batch-runbook.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const checklist = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-evidence-checklist.json"), "utf8"));
    assert.equal(checklist.rows[0].state, "scheduled");
    assert.equal(checklist.totals.readyForImportPreview, 0);
    assert.match(checklist.rows[0].evidenceTemplate, /published_post_url=<paste exact public TikTok video URL after live>/);
    assert.match(checklist.rows[0].evidenceTemplate, /operator_notes=<write real 20\+ char note after public URL and metrics are captured>/);
    assert.doesNotMatch(checklist.rows[0].evidenceTemplate, /published_post_url=https:\/\/www\.tiktok\.com\/@handle\/video\/1234567890123456789/);
    assert.doesNotMatch(checklist.rows[0].evidenceTemplate, /operator_notes=Public TikTok URL and 24h metrics captured/);
    const html = await readFile(checklist.paths.html, "utf8");
    assert.doesNotMatch(html, /https:\/\/www\.tiktok\.com\/@handle\/video\/1234567890123456789/);
  } finally {
    await writeFile(evidencePath, originalEvidence);
    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-batch-runbook.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
    ]) {
      spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
  }
});

test("TikTok operator cockpit links upload and evidence consoles without publishing", async () => {
  await withFutureCurrentBatchSchedule(async () => {
  for (const script of [
    "script/clippers-tiktok-batch-evidence-sync.mjs",
    "script/clippers-tiktok-batch-tracker.mjs",
    "script/clippers-tiktok-batch-runbook.mjs",
    "script/clippers-tiktok-evidence-checklist.mjs",
    "script/clippers-metricool-current-batch-upload-pack.mjs",
  ]) {
    const args = script.endsWith("clippers-tiktok-batch-evidence-sync.mjs") ? [script, "--all-batches"] : [script];
    const prerequisite = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(prerequisite.status, 0, prerequisite.stderr || prerequisite.stdout);
  }

  const result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const postScheduleResult = spawnSync(process.execPath, ["script/clippers-tiktok-post-schedule-verifier.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(postScheduleResult.status, 0, postScheduleResult.stderr || postScheduleResult.stdout);
  const postScheduleOutput = JSON.parse(postScheduleResult.stdout);
  assert.equal(postScheduleOutput.status, "needs_metricool_scheduling");
  assert.equal(postScheduleOutput.scheduled, 0);
  assert.equal(postScheduleOutput.readyToImport, 0);
  const closeoutResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-closeout-verifier.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(closeoutResult.status, 0, closeoutResult.stderr || closeoutResult.stdout);
  const closeoutOutput = JSON.parse(closeoutResult.stdout);
  assert.equal(closeoutOutput.status, "blocked_not_scheduled");
  assert.equal(closeoutOutput.nextBatchId, "metricool-batch-02");
  assert.equal(closeoutOutput.readyToImport, 0);
  const nextActionResult = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(nextActionResult.status, 0, nextActionResult.stderr || nextActionResult.stdout);
  const nextActionOutput = JSON.parse(nextActionResult.stdout);
  assert.equal(nextActionOutput.status, "ready_for_metricool_scheduling");
  assert.equal(nextActionOutput.batchId, "metricool-batch-01");
  assert.match(nextActionOutput.nextStep, /schedule every row in Metricool/i);
  const sessionPacketResult = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(sessionPacketResult.status, 0, sessionPacketResult.stderr || sessionPacketResult.stdout);
  const sessionPacketOutput = JSON.parse(sessionPacketResult.stdout);
  assert.equal(sessionPacketOutput.status, "ready_for_metricool_session");
  assert.equal(sessionPacketOutput.batchId, "metricool-batch-01");
  assert.equal(sessionPacketOutput.rows, 10);
  assert.equal(sessionPacketOutput.ready, 10);
  assert.match(sessionPacketOutput.nextStep, /schedule 10 rows/i);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_metricool_operator");
  assert.equal(output.batchId, "metricool-batch-01");
  assert.equal(output.uploadRows, 10);
  assert.equal(output.copiedFiles, 10);
  assert.equal(output.readyToImport, 0);

  const cockpit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit.json"), "utf8"));
  const postScheduleVerifier = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-post-schedule-verifier.json"), "utf8"));
  const closeoutVerifier = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-closeout-verifier.json"), "utf8"));
  const nextAction = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-next-action.json"), "utf8"));
  const sessionPacket = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-session-packet.json"), "utf8"));
  assert.equal(postScheduleVerifier.status, "needs_metricool_scheduling");
  assert.equal(postScheduleVerifier.mode, "tiktok_metricool_post_schedule_verifier");
  assert.equal(postScheduleVerifier.rows.length, 10);
  assert.equal(postScheduleVerifier.totals.notStarted, 10);
  assert.equal(postScheduleVerifier.totals.readyToImport, 0);
  assert.equal(postScheduleVerifier.timeline.publicUrlDueNow, 0);
  assert.equal(postScheduleVerifier.timeline.metricsEligibleNow, 0);
  assert.equal(postScheduleVerifier.rows[0].timeline.status, "not_scheduled");
  assert.ok(postScheduleVerifier.guardrails.some((guardrail) => guardrail.includes("read-only")));
  assert.ok(postScheduleVerifier.guardrails.some((guardrail) => guardrail.includes("Scheduled rows are not published")));
  assert.ok(postScheduleVerifier.guardrails.some((guardrail) => guardrail.includes("24h metrics window")));
  assert.equal(closeoutVerifier.status, "blocked_not_scheduled");
  assert.equal(closeoutVerifier.mode, "tiktok_metricool_batch_closeout_verifier");
  assert.equal(closeoutVerifier.batch.id, "metricool-batch-01");
  assert.equal(closeoutVerifier.nextBatch.id, "metricool-batch-02");
  assert.equal(closeoutVerifier.nextBatchUnlock.status, "blocked_current_batch");
  assert.equal(closeoutVerifier.nextBatchUnlock.canPrepareNextBatch, false);
  assert.equal(closeoutVerifier.nextBatchUnlock.nextBatchId, "metricool-batch-02");
  assert.ok(closeoutVerifier.nextBatchUnlock.blockers.some((blocker) => blocker.includes("not scheduled")));
  assert.equal(closeoutVerifier.rows.length, 10);
  assert.equal(closeoutVerifier.totals.notStarted, 10);
  assert.equal(closeoutVerifier.totals.readyToImport, 0);
  assert.ok(closeoutVerifier.rows.every((row) => row.closeoutGate === "not_scheduled"));
  assert.ok(closeoutVerifier.guardrails.some((guardrail) => guardrail.includes("read-only")));
  assert.ok(closeoutVerifier.guardrails.some((guardrail) => guardrail.includes("Metricool remains approval_required")));
  assert.equal(nextAction.status, "ready_for_metricool_scheduling");
  assert.equal(nextAction.mode, "tiktok_metricool_next_action");
  assert.equal(nextAction.batch.id, "metricool-batch-01");
  assert.equal(nextAction.batch.nextBatchId, "metricool-batch-02");
  assert.equal(nextAction.account.ready, true);
  assert.equal(nextAction.uploadPack.ready, true);
  assert.equal(nextAction.operatorGate.status, "operator_can_schedule_in_metricool_review");
  assert.equal(nextAction.operatorGate.actionAllowed, true);
  assert.equal(nextAction.operatorGate.allowedAction, "schedule_current_batch_in_metricool_approval_required");
  assert.equal(nextAction.operatorGate.approvalRequired, true);
  assert.equal(nextAction.operatorGate.realPublishEnabled, false);
  assert.equal(nextAction.operatorGate.readyToSend, 0);
  assert.equal(nextAction.operatorGate.directSocialApisRequired, false);
  assert.equal(nextAction.operatorGate.scheduledIsPublished, false);
  assert.deepEqual(nextAction.operatorGate.blockedBy, []);
  assert.match(nextAction.operatorGate.nextProofRequired, /final_status=scheduled/);
  assert.match(nextAction.operator.uploadHtml, /metricool-current-batch-upload-pack\/index\.html$/);
  assert.match(nextAction.operator.batchEvidenceCsv, /metricool-batch-01-evidence-import\.csv$/);
  assert.match(nextAction.operator.copyPacket, /TikTok Metricool operator packet/);
  assert.match(nextAction.operator.copyPacket, /Allowed action: schedule_current_batch_in_metricool_approval_required/);
  assert.match(nextAction.operator.copyPacket, /final_status=scheduled/);
  assert.doesNotMatch(nextAction.operator.copyPacket, /client_secret=|access_token=|refresh_token=|bearer\s+[a-z0-9._-]+/i);
  assert.ok(nextAction.tasks.some((task) => task.id === "metricool_schedule" && task.status === "next"));
  assert.ok(nextAction.guardrails.some((guardrail) => guardrail.includes("TikTok-only MVP")));
  assert.ok(nextAction.guardrails.some((guardrail) => guardrail.includes("realPublishEnabled remains false")));
  const nextActionMarkdown = await readFile(nextAction.paths.markdown, "utf8");
  assert.match(nextActionMarkdown, /Operator Packet/);
  assert.match(nextActionMarkdown, /Operator gate: operator_can_schedule_in_metricool_review/);
  assert.match(nextActionMarkdown, /Allowed action: schedule_current_batch_in_metricool_approval_required/);
  assert.match(nextActionMarkdown, /Upload HTML:/);
  assert.match(nextActionMarkdown, /Evidence CSV:/);
  assert.equal(sessionPacket.status, "ready_for_metricool_session");
  assert.equal(sessionPacket.mode, "metricool_current_batch_session_packet");
  assert.equal(sessionPacket.batch.id, "metricool-batch-01");
  assert.equal(sessionPacket.batch.nextBatchId, "metricool-batch-02");
  assert.equal(sessionPacket.batch.rows, 10);
  assert.equal(sessionPacket.totals.rows, 10);
  assert.equal(sessionPacket.totals.ready, 10);
  assert.equal(sessionPacket.totals.blocked, 0);
  assert.deepEqual(sessionPacket.consistencyIssues, []);
  assert.equal(sessionPacket.scheduleFreshness.ok, true);
  assert.equal(sessionPacket.scheduleFreshness.minLeadMinutes, 20);
  assert.ok(sessionPacket.rows.every((row) => row.status === "ready_to_schedule"));
  assert.ok(sessionPacket.rows.every((row) => row.platform === "tiktok"));
  assert.match(sessionPacket.paths.uploadHtml, /metricool-current-batch-upload-pack\/index\.html$/);
  assert.match(sessionPacket.paths.markdown, /clippers-metricool-current-batch-session-packet\.md$/);
  assert.match(sessionPacket.paths.csv, /clippers-metricool-current-batch-session-packet\.csv$/);
  assert.ok(sessionPacket.guardrails.some((guardrail) => guardrail.includes("approval_required")));
  assert.ok(sessionPacket.guardrails.some((guardrail) => guardrail.includes("read-only")));
  assert.ok(sessionPacket.guardrails.some((guardrail) => guardrail.includes("Scheduled evidence is not published evidence")));
  assert.equal(cockpit.status, "ready_for_metricool_operator");
  assert.equal(cockpit.mode, "metricool_tiktok_operator_cockpit");
  assert.equal(cockpit.totals.publishedCounted, 0);
  assert.equal(cockpit.links.length, 5);
  assert.equal(cockpit.operatorRows.length, 10);
  assert.equal(cockpit.operatorChecklist.length, 5);
  assert.ok(cockpit.operatorChecklist.some((step) => step.label.includes("Schedule in Metricool")));
  assert.ok(cockpit.operatorChecklist.some((step) => step.proof.includes("final_status=scheduled")));
  assert.ok(cockpit.operatorChecklist.some((step) => step.proof.includes("final_status=published")));
  assert.ok(cockpit.operatorRows[0].metricoolQueueItemId);
  assert.match(cockpit.operatorRows[0].scheduledEvidenceTemplate, /final_status=scheduled/);
  assert.match(cockpit.operatorRows[0].scheduledEvidenceTemplate, /published_post_url=/);
  assert.doesNotMatch(cockpit.operatorRows[0].scheduledEvidenceTemplate, /final_status=published|https:\/\/www\.tiktok\.com\/@handle\/video/);
  assert.match(cockpit.paths.html, /clippers-tiktok-operator-cockpit\.html$/);
  assert.match(cockpit.paths.uploadHtml, /metricool-current-batch-upload-pack\/index\.html$/);
  assert.match(cockpit.paths.evidenceHtml, /clippers-tiktok-evidence-checklist\.html$/);
  assert.ok(cockpit.guardrails.some((guardrail) => guardrail.includes("never publishes")));
  assert.ok(cockpit.guardrails.some((guardrail) => guardrail.includes("realPublishEnabled remains false")));

  const html = await readFile(cockpit.paths.html, "utf8");
  assert.match(html, /TikTok Metricool Operator Cockpit/);
  assert.match(html, /Upload console/);
  assert.match(html, /Evidence console/);
  assert.match(html, /Current batch rows/);
  assert.match(html, /Start here \/ Empieza aqui/);
  assert.match(html, /Programa en Metricool/);
  assert.match(html, /Scheduled rows are not published rows/);
  assert.match(html, /Scheduled evidence template/);
  assert.match(html, /Local guide only/);
  assert.doesNotMatch(html, /ready_to_send|auto publish/i);

  const csv = await readFile(cockpit.paths.csv, "utf8");
  assert.match(csv, /operator_row/);
  assert.match(csv, /scheduled_evidence_template/);
  assert.doesNotMatch(csv, /final_status=published|https:\/\/www\.tiktok\.com\/@handle\/video/);

  const markdown = await readFile(cockpit.paths.markdown, "utf8");
  assert.match(markdown, /## Start Here/);
  assert.match(markdown, /Abre la consola de upload/);
  assert.match(markdown, /final_status=scheduled with Metricool proof URL/);
  assert.doesNotMatch(markdown, /ready_to_send|auto publish/i);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/tiktok-operator-cockpit/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-operator-cockpit/);
  assert.match(routes, /\/api\/clippers\/tiktok-post-schedule-verifier/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-post-schedule-verifier/);
  assert.match(routes, /\/api\/clippers\/tiktok-batch-closeout-verifier/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-batch-closeout-verifier/);
  assert.match(routes, /\/api\/clippers\/tiktok-next-action/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-next-action/);
  assert.match(routes, /\/api\/clippers\/metricool-current-batch-session-packet/);
  assert.match(routes, /\/api\/clippers\/prepare-metricool-current-batch-session-packet/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-mvp-now-refresh/);
  assert.match(routes, /script\/clippers-tiktok-operator-cockpit\.mjs/);
  assert.match(routes, /script\/clippers-tiktok-post-schedule-verifier\.mjs/);
  assert.match(routes, /script\/clippers-tiktok-batch-closeout-verifier\.mjs/);
  assert.match(routes, /script\/clippers-tiktok-next-action\.mjs/);
  assert.match(routes, /script\/clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(routes, /readClipperTikTokOperatorCockpit/);
  const nextActionGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/tiktok-next-action"'),
    routes.indexOf('app.get("/api/clippers/tiktok-operator-cockpit"'),
  );
  assert.ok(nextActionGetRoute.indexOf("clippers-tiktok-post-schedule-verifier.mjs") < nextActionGetRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(nextActionGetRoute.indexOf("clippers-tiktok-batch-closeout-verifier.mjs") < nextActionGetRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(nextActionGetRoute.indexOf("runClipperTikTokExternalCloseoutSession") < nextActionGetRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(nextActionGetRoute.indexOf("runClipperTikTokMvpProofDoctor") < nextActionGetRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(nextActionGetRoute.indexOf("clippers-tiktok-mvp-readiness-verifier.mjs") < nextActionGetRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(nextActionGetRoute.indexOf("clippers-goal-completion-audit.mjs") < nextActionGetRoute.indexOf("clippers-tiktok-next-action.mjs"));
  const sessionPacketGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/metricool-current-batch-session-packet"'),
    routes.indexOf('app.get("/api/clippers/metricool-approval-quick-run"'),
  );
  assert.match(sessionPacketGetRoute, /clippers-metricool-current-batch-session-packet\.mjs/);
  assert.ok(sessionPacketGetRoute.indexOf("clippers-tiktok-next-action.mjs") < sessionPacketGetRoute.indexOf("clippers-metricool-current-batch-session-packet.mjs"));
  const mvpNowRefreshPostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-mvp-now-refresh"'),
    routes.indexOf('app.post("/api/clippers/prepare-metricool-mvp-launch-pack"'),
  );
  assert.match(mvpNowRefreshPostRoute, /mode: "tiktok_metricool_mvp_now_refresh"/);
  assert.match(mvpNowRefreshPostRoute, /realPublishEnabled: false/);
  assert.match(mvpNowRefreshPostRoute, /directSocialApisRequired: false/);
  assert.match(mvpNowRefreshPostRoute, /prepareClipperMetricool100ApprovalRun/);
  assert.match(mvpNowRefreshPostRoute, /approvalQueueTarget: 100/);
  assert.ok(mvpNowRefreshPostRoute.indexOf("prepareClipperMetricool100ApprovalRun") < mvpNowRefreshPostRoute.indexOf("clippers-metricool-operator-handoff.mjs"));
  assert.match(mvpNowRefreshPostRoute, /clippers-metricool-operator-handoff\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /clippers-tiktok-batch-tracker\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /clippers-tiktok-batch-closeout-verifier\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /clippers-tiktok-next-action\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /clippers-tiktok-operator-cockpit-preflight\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(mvpNowRefreshPostRoute, /readClipperAccountPermissionReadiness/);
  assert.match(mvpNowRefreshPostRoute, /accountPermissionReadiness/);
  assert.ok(mvpNowRefreshPostRoute.indexOf("clippers-goal-completion-audit.mjs") < mvpNowRefreshPostRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(mvpNowRefreshPostRoute.indexOf("clippers-tiktok-next-action.mjs") < mvpNowRefreshPostRoute.indexOf("clippers-metricool-current-batch-session-packet.mjs"));
  assert.doesNotMatch(mvpNowRefreshPostRoute, /recordClipperTikTokBatchEvidenceRow|recordClipperTikTokBatchEvidenceBatch|ready_to_send|auto publish/i);
  const sessionPacketPostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-metricool-current-batch-session-packet"'),
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-mvp-now-refresh"'),
  );
  assert.match(sessionPacketPostRoute, /clippers-tiktok-next-action\.mjs/);
  assert.match(sessionPacketPostRoute, /clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(sessionPacketPostRoute, /metricoolCurrentBatchSessionPacket/);
  assert.ok(sessionPacketPostRoute.indexOf("clippers-tiktok-next-action.mjs") < sessionPacketPostRoute.indexOf("clippers-metricool-current-batch-session-packet.mjs"));
  const evidenceRowRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/record-tiktok-batch-evidence-row"'),
    routes.indexOf('app.post("/api/clippers/record-tiktok-batch-evidence-batch"'),
  );
  assert.match(evidenceRowRoute, /clippers-tiktok-post-schedule-verifier\.mjs/);
  assert.match(evidenceRowRoute, /clippers-tiktok-batch-closeout-verifier\.mjs/);
  assert.match(evidenceRowRoute, /clippers-tiktok-next-action\.mjs/);
  assert.match(evidenceRowRoute, /clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(evidenceRowRoute, /already have operator evidence/);
  assert.match(evidenceRowRoute, /uploadPackRun = \{ status: "blocked"/);
  assert.match(evidenceRowRoute, /tiktokPostScheduleVerifier/);
  assert.match(evidenceRowRoute, /tiktokBatchCloseoutVerifier/);
  assert.match(evidenceRowRoute, /tiktokNextAction/);
  assert.match(evidenceRowRoute, /metricoolCurrentBatchSessionPacket/);
  assert.ok(evidenceRowRoute.indexOf("clippers-goal-completion-audit.mjs") < evidenceRowRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(evidenceRowRoute.indexOf("clippers-tiktok-next-action.mjs") < evidenceRowRoute.indexOf("clippers-metricool-current-batch-session-packet.mjs"));
  const evidenceBatchRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/record-tiktok-batch-evidence-batch"'),
    routes.indexOf('app.post("/api/clippers/preview-metricool-approval-evidence"'),
  );
  assert.match(evidenceBatchRoute, /clippers-tiktok-post-schedule-verifier\.mjs/);
  assert.match(evidenceBatchRoute, /clippers-tiktok-batch-closeout-verifier\.mjs/);
  assert.match(evidenceBatchRoute, /clippers-metricool-operator-handoff\.mjs/);
  assert.match(evidenceBatchRoute, /clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(evidenceBatchRoute, /clippers-metricool-mcp-preflight\.ts/);
  assert.match(evidenceBatchRoute, /clippers-tiktok-next-action\.mjs/);
  assert.match(evidenceBatchRoute, /clippers-metricool-current-batch-session-packet\.mjs/);
  assert.match(evidenceBatchRoute, /clippers-metricool-current-batch-upload-pack\.mjs/);
  assert.match(evidenceBatchRoute, /already have operator evidence/);
  assert.match(evidenceBatchRoute, /uploadPackRun = \{ status: "blocked"/);
  assert.match(evidenceBatchRoute, /tiktokPostScheduleVerifier/);
  assert.match(evidenceBatchRoute, /tiktokBatchCloseoutVerifier/);
  assert.match(evidenceBatchRoute, /metricool100OperatorHandoff/);
  assert.match(evidenceBatchRoute, /tiktokMvpGoLivePacket/);
  assert.match(evidenceBatchRoute, /metricoolMcpPreflight/);
  assert.match(evidenceBatchRoute, /const refreshComplete = refreshStatus === "complete"/);
  assert.match(evidenceBatchRoute, /metricool100OperatorHandoff: refreshComplete \? metricool100OperatorHandoff : null/);
  assert.match(evidenceBatchRoute, /tiktokMvpGoLivePacket: refreshComplete \? tiktokMvpGoLivePacket : null/);
  assert.match(evidenceBatchRoute, /metricoolMcpPreflight: refreshComplete \? metricoolMcpPreflight : null/);
  assert.match(evidenceBatchRoute, /tiktokNextAction/);
  assert.match(evidenceBatchRoute, /metricoolCurrentBatchUploadPack/);
  assert.match(evidenceBatchRoute, /metricoolCurrentBatchSessionPacket/);
  assert.ok(evidenceBatchRoute.indexOf("clippers-metricool-operator-handoff.mjs") < evidenceBatchRoute.indexOf("clippers-tiktok-batch-tracker.mjs"));
  assert.ok(evidenceBatchRoute.indexOf("clippers-tiktok-mvp-go-live-packet.mjs") < evidenceBatchRoute.indexOf("clippers-goal-completion-audit.mjs"));
  assert.ok(evidenceBatchRoute.indexOf("clippers-metricool-mcp-preflight.ts") < evidenceBatchRoute.indexOf("clippers-metricool-current-batch-upload-pack.mjs"));
  assert.ok(evidenceBatchRoute.indexOf("clippers-goal-completion-audit.mjs") < evidenceBatchRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.ok(evidenceBatchRoute.indexOf("clippers-tiktok-next-action.mjs") < evidenceBatchRoute.indexOf("clippers-metricool-current-batch-session-packet.mjs"));
  const cockpitPostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-operator-cockpit"'),
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-mvp-go-live-packet"'),
  );
  assert.doesNotMatch(cockpitPostRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.match(cockpitPostRoute, /uploadPackRun = \{ status: "blocked"/);
  assert.match(cockpitPostRoute, /clippers-tiktok-operator-cockpit\.mjs/);
  assert.match(cockpitPostRoute, /tiktokBatchTracker/);
  assert.match(cockpitPostRoute, /metricoolCurrentBatchUploadPack/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-tiktok-operator-cockpit-button/);
  assert.match(page, /clippers-tiktok-mvp-now-panel/);
  assert.match(page, /prepare-clippers-tiktok-mvp-now-refresh-button/);
  assert.match(page, /\/api\/clippers\/prepare-tiktok-mvp-now-refresh/);
  assert.match(page, /tiktokMvpNowRefreshMutation/);
  assert.match(page, /prepare-clippers-tiktok-post-schedule-verifier-button/);
  assert.match(page, /clippers-tiktok-post-schedule-verifier-panel/);
  assert.match(page, /URL due now/);
  assert.match(page, /Metrics due now/);
  assert.match(page, /Metrics wait/);
  assert.match(page, /Timeline: \{row\.timeline\.status\}/);
  assert.match(page, /\/api\/clippers\/prepare-tiktok-post-schedule-verifier/);
  assert.match(page, /Next batch unlock:/);
  assert.match(page, /hold current batch/);
  assert.match(page, /\["\/api\/clippers\/tiktok-post-schedule-verifier"\], data\.tiktokPostScheduleVerifier/);
  assert.match(page, /prepare-clippers-tiktok-batch-closeout-verifier-button/);
  assert.match(page, /clippers-tiktok-batch-closeout-verifier-panel/);
  assert.match(page, /\/api\/clippers\/prepare-tiktok-batch-closeout-verifier/);
  assert.match(page, /\["\/api\/clippers\/tiktok-batch-closeout-verifier"\], data\.tiktokBatchCloseoutVerifier/);
  assert.match(page, /\["\/api\/clippers\/metricool-100-operator-handoff"\], data\.metricool100OperatorHandoff/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-go-live-packet"\], data\.tiktokMvpGoLivePacket/);
  assert.match(page, /\["\/api\/clippers\/metricool-mcp-preflight"\], data\.metricoolMcpPreflight/);
  assert.match(page, /const refreshComplete = data\.refreshStatus !== "partial_refresh_failed"/);
  assert.match(page, /refreshComplete && data\.metricool100OperatorHandoff/);
  assert.match(page, /refreshComplete && data\.tiktokMvpGoLivePacket/);
  assert.match(page, /if \(!refreshComplete\)/);
  assert.match(page, /queryClient\.removeQueries\(\{ queryKey, exact: true \}\)/);
  assert.match(page, /if \(refreshComplete\) refreshMetricoolCaches\(\)/);
  assert.match(page, /prepare-clippers-tiktok-next-action-button/);
  assert.match(page, /clippers-tiktok-next-action-panel/);
  assert.match(page, /clippers-tiktok-next-action-proof-bridge/);
  assert.match(page, /clippers-tiktok-next-action-external-closeout/);
  assert.match(page, /clippers-tiktok-next-action-proof-doctor/);
  assert.match(page, /copy-clippers-tiktok-next-action-operator-packet/);
  assert.match(page, /Metricool operator packet/);
  assert.match(page, /proofBridgeGate/);
  assert.match(page, /proofLinksChecklist/);
  assert.match(page, /externalCloseout/);
  assert.match(page, /proofDoctor/);
  assert.match(page, /accountPermissionReadiness: ClipperAccountPermissionReadinessSummary/);
  assert.match(page, /\["\/api\/clippers\/account-permission-readiness"\], data\.accountPermissionReadiness/);
  assert.match(page, /getMetricoolBridgeEvidenceClientCheck/);
  assert.match(page, /parseMetricoolBridgeCsvLine/);
  assert.match(page, /metricoolBridgeActiveTikTokMvpLanes/);
  assert.match(page, /sports-daily:tiktok/);
  assert.match(page, /meme-radar:tiktok/);
  assert.match(page, /only sports-daily:tiktok and meme-radar:tiktok are active Metricool MVP lanes/);
  assert.match(page, /isTikTokProfileUrl/);
  assert.match(page, /isMetricoolProofUrl/);
  assert.match(page, /profile_url must be a public TikTok profile URL/);
  assert.match(page, /proof must be a Metricool HTTPS proof URL/);
  assert.match(page, /sk-\[A-Za-z0-9_-\]\{12,\}/);
  assert.match(page, /private\[_ -\]\?key/);
  assert.match(page, /passcode/);
  assert.match(page, /signature/);
  assert.match(page, /0\\.0\\.0\\.0/);
  assert.match(page, /local check blocked/);
  assert.match(page, /reset-clippers-metricool-bridge-evidence-template-button/);
  assert.match(page, /!metricoolBridgeEvidenceClientCheck\.canSubmit/);
  assert.match(page, /real https proof URLs before import/);
  assert.match(page, /metricoolBridgeEvidenceBatch\.totals\.recorded > 0/);
  assert.match(page, /tiktokMvpNowRefreshMutation\.mutate\(\)/);
  assert.match(page, /\/api\/clippers\/prepare-tiktok-next-action/);
  assert.match(page, /\["\/api\/clippers\/tiktok-next-action"\], data\.tiktokNextAction/);
  assert.match(page, /prepare-clippers-metricool-current-batch-session-packet-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-now-session-packet-button/);
  assert.match(page, /clippers-metricool-current-batch-session-packet-panel/);
  assert.match(page, /tiktokMvpSessionPacketBlocked/);
  assert.match(page, /metricoolCurrentBatchSessionPacket\?\.nextStep/);
  assert.match(page, /blocked_schedule_freshness/);
  assert.match(page, /Schedule freshness blocked/);
  assert.match(page, /prepare-clippers-renew-stale-metricool-batch-button/);
  assert.match(page, /Renew batch schedule/);
  const scheduleFreshnessBlock = page.slice(
    page.indexOf("Schedule freshness blocked"),
    page.indexOf("metricoolCurrentBatchSessionPacket.rows.slice"),
  );
  assert.match(scheduleFreshnessBlock, /onClick=\{\(\) => tiktokMvpNowRefreshMutation\.mutate\(\)\}/);
  assert.match(scheduleFreshnessBlock, /prepare-clippers-renew-stale-metricool-batch-button/);
  assert.match(scheduleFreshnessBlock, /Renew batch schedule/);
  assert.match(page, /\/api\/clippers\/prepare-metricool-current-batch-session-packet/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-session-packet"\], data\.metricoolCurrentBatchSessionPacket/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-upload-pack"\], data\.metricoolCurrentBatchUploadPack/);
  assert.match(page, /invalidateQueries\(\{ queryKey: \["\/api\/clippers\/tiktok-post-schedule-verifier"\] \}\)/);
  assert.match(page, /invalidateQueries\(\{ queryKey: \["\/api\/clippers\/tiktok-batch-closeout-verifier"\] \}\)/);
  assert.match(page, /invalidateQueries\(\{ queryKey: \["\/api\/clippers\/tiktok-next-action"\] \}\)/);
  assert.match(page, /invalidateQueries\(\{ queryKey: \["\/api\/clippers\/metricool-current-batch-session-packet"\] \}\)/);
  assert.match(page, /\["\/api\/clippers\/metricool-100-approval-run"\], data\.metricool100ApprovalRun/);
  assert.match(page, /metricoolPublishing: data\.metricoolPublishing/);
  assert.match(page, /metricoolExecutionQueue: data\.metricoolExecutionQueue/);
  assert.match(page, /prepare-clippers-tiktok-mvp-now-cockpit-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-now-upload-button/);
  assert.match(page, /prepare-clippers-tiktok-mvp-now-evidence-button/);
  assert.match(page, /\["\/api\/clippers\/tiktok-operator-cockpit-preflight"\], data\.tiktokOperatorCockpitPreflight/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-readiness-verifier"\], data\.tiktokMvpReadinessVerifier/);
  assert.match(page, /TikTok \+ Metricool only/);
  assert.match(page, /no direct APIs/);
  assert.ok(page.indexOf("const tiktokMvpBlockingStatus") > -1);
  assert.ok(page.indexOf("const tiktokMvpBlockingStatus") < page.indexOf("const tiktokMvpNow ="));
  assert.match(page, /tiktokMvpReadinessVerifier\?\.launchDecision === "blocked_before_metricool"/);
  assert.match(page, /tiktokOperatorCockpitPreflight\?\.status === "blocked"/);
  assert.match(page, /clippers-tiktok-operator-cockpit-panel/);
  assert.match(page, /TikTokOperatorCockpitSummary/);
  assert.match(page, /Operator cockpit/);
  assert.match(page, /\["\/api\/clippers\/tiktok-batch-tracker"\], data\.tiktokBatchTracker/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-upload-pack"\], data\.metricoolCurrentBatchUploadPack/);
  });
});

test("TikTok next action blocks Metricool operator gate when publish safety is unsafe", async () => {
  await withFutureCurrentBatchSchedule(async () => {
    for (const script of [
      "script/clippers-tiktok-post-schedule-verifier.mjs",
      "script/clippers-tiktok-batch-closeout-verifier.mjs",
      "script/clippers-metricool-current-batch-upload-pack.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const approvalRunPath = path.join(rootDir, "scheduled/metricool-100-approval-run.json");
    const originalApprovalRun = await readFile(approvalRunPath, "utf8");
    try {
      const approvalRun = JSON.parse(originalApprovalRun);
      approvalRun.realPublishEnabled = true;
      approvalRun.totals = {
        ...(approvalRun.totals || {}),
        readyToSend: 1,
      };
      await writeFile(approvalRunPath, JSON.stringify(approvalRun, null, 2));

      const nextActionResult = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(nextActionResult.status, 0, nextActionResult.stderr || nextActionResult.stdout);
      const nextAction = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-next-action.json"), "utf8"));
      assert.equal(nextAction.status, "ready_for_metricool_scheduling");
      assert.equal(nextAction.operatorGate.status, "operator_blocked");
      assert.equal(nextAction.operatorGate.actionAllowed, false);
      assert.equal(nextAction.operatorGate.allowedAction, "none");
      assert.equal(nextAction.operatorGate.realPublishEnabled, true);
      assert.equal(nextAction.operatorGate.readyToSend, 1);
      assert.ok(nextAction.operatorGate.blockedBy.includes("real_publish_enabled"));
      assert.ok(nextAction.operatorGate.blockedBy.includes("ready_to_send_not_zero"));
      assert.match(nextAction.nextStep, /Do not open Metricool scheduling/);
      assert.match(nextAction.nextStep, /real_publish_enabled/);
      assert.ok(nextAction.tasks.some((task) => (
        task.id === "metricool_schedule"
        && task.status === "blocked"
        && task.nextAction.includes("real_publish_enabled")
      )));
      assert.match(nextAction.operator.copyPacket, /Do not open Metricool scheduling/);
      assert.doesNotMatch(nextAction.operator.copyPacket, /Upload\/schedule each row/);
    } finally {
      await writeFile(approvalRunPath, originalApprovalRun);
    }
  });
});

test("TikTok MVP refresh returns account readiness and updates UI cache", async () => {
  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const mvpNowRefreshPostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-tiktok-mvp-now-refresh"'),
    routes.indexOf('app.post("/api/clippers/prepare-metricool-mvp-launch-pack"'),
  );
  assert.match(mvpNowRefreshPostRoute, /mode: "tiktok_metricool_mvp_now_refresh"/);
  assert.match(mvpNowRefreshPostRoute, /realPublishEnabled: false/);
  assert.match(mvpNowRefreshPostRoute, /directSocialApisRequired: false/);
  assert.match(mvpNowRefreshPostRoute, /readClipperAccountPermissionReadiness/);
  assert.match(mvpNowRefreshPostRoute, /accountPermissionReadiness/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /accountPermissionReadiness: ClipperAccountPermissionReadinessSummary/);
  assert.match(page, /\["\/api\/clippers\/account-permission-readiness"\], data\.accountPermissionReadiness/);
});

test("Metricool bridge evidence batch returns refreshed TikTok next action payload", async () => {
  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const bridgeEvidenceBatchRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/record-metricool-bridge-evidence-batch"'),
    routes.indexOf('app.post("/api/clippers/prepare-publisher-execution-queue"'),
  );
  assert.match(bridgeEvidenceBatchRoute, /bridgeRefreshStatus: "skipped_no_recorded_rows"/);
  assert.match(bridgeEvidenceBatchRoute, /bridgeRefreshStatus: "refreshed_next_action"/);
  assert.match(bridgeEvidenceBatchRoute, /partial_refresh_failed/);
  assert.match(bridgeEvidenceBatchRoute, /res\.status\(refreshComplete \? 200 : 202\)/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-account-permission-readiness\.mjs/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-tiktok-batch-tracker\.mjs/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-tiktok-evidence-checklist\.mjs/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-tiktok-post-schedule-verifier\.mjs/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-tiktok-batch-closeout-verifier\.mjs/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-goal-completion-audit\.mjs/);
  assert.match(bridgeEvidenceBatchRoute, /clippers-tiktok-next-action\.mjs/);
  assert.ok(bridgeEvidenceBatchRoute.indexOf("clippers-account-permission-readiness.mjs") < bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-batch-tracker.mjs"));
  assert.ok(bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-batch-tracker.mjs") < bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-evidence-checklist.mjs"));
  assert.ok(bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-evidence-checklist.mjs") < bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-post-schedule-verifier.mjs"));
  assert.ok(bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-post-schedule-verifier.mjs") < bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-batch-closeout-verifier.mjs"));
  assert.ok(bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-batch-closeout-verifier.mjs") < bridgeEvidenceBatchRoute.indexOf("clippers-goal-completion-audit.mjs"));
  assert.ok(bridgeEvidenceBatchRoute.indexOf("clippers-goal-completion-audit.mjs") < bridgeEvidenceBatchRoute.indexOf("clippers-tiktok-next-action.mjs"));
  assert.match(bridgeEvidenceBatchRoute, /readClipperAccountPermissionReadiness/);
  assert.match(bridgeEvidenceBatchRoute, /readClipperTikTokBatchTracker/);
  assert.match(bridgeEvidenceBatchRoute, /readClipperTikTokEvidenceChecklist/);
  assert.match(bridgeEvidenceBatchRoute, /readClipperTikTokPostScheduleVerifier/);
  assert.match(bridgeEvidenceBatchRoute, /readClipperTikTokBatchCloseoutVerifier/);
  assert.match(bridgeEvidenceBatchRoute, /readClipperGoalCompletionAudit/);
  assert.match(bridgeEvidenceBatchRoute, /readClipperTikTokNextAction/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(routes, /preview-metricool-bridge-evidence-batch/);
  assert.match(routes, /previewClipperMetricoolBridgeEvidenceBatch/);
  assert.match(page, /preview-clippers-metricool-bridge-evidence-batch-button/);
  assert.match(page, /metricoolBridgeEvidenceBatchPreviewMutation/);
  assert.match(page, /metricoolBridgeEvidenceCurrentPreview/);
  assert.match(page, /metricoolBridgeEvidenceBatchPreview\?\.raw === metricoolBridgeEvidenceBatchText/);
  assert.match(page, /Preview bridge rows/);
  assert.match(page, /No escribe evidencia/);
  assert.match(page, /bridgeRefreshStatus\?: "skipped_no_recorded_rows" \| "refreshed_next_action"/);
  assert.match(page, /refreshStatus\?: "complete" \| "partial_refresh_failed"/);
  assert.match(page, /const refreshComplete = data\.refreshStatus !== "partial_refresh_failed"/);
  assert.match(page, /data\.accountPermissionReadiness/);
  assert.match(page, /data\.tiktokBatchTracker/);
  assert.match(page, /data\.tiktokEvidenceChecklist/);
  assert.match(page, /data\.tiktokPostScheduleVerifier/);
  assert.match(page, /data\.tiktokBatchCloseoutVerifier/);
  assert.match(page, /data\.goalCompletionAudit/);
  assert.match(page, /data\.tiktokNextAction/);
  assert.match(page, /\["\/api\/clippers\/tiktok-next-action"\], data\.tiktokNextAction/);
  assert.match(page, /queryClient\.removeQueries\(\{ queryKey, exact: true \}\)/);
  assert.match(page, /Bridge guardado; refresco pendiente/);
  assert.match(page, /Next action refrescado/);
});

test("TikTok post-schedule verifier exposes public URL and 24h metric capture timeline", async () => {
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  try {
    const workbook = JSON.parse(originalWorkbook);
    const scheduledFor = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const queueItemId = workbook.rows[0].metricoolQueueItemId;
    const earlyMetricsScheduledFor = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const earlyMetricsQueueItemId = workbook.rows[1].metricoolQueueItemId;
    const readyMetricsScheduledFor = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const readyMetricsQueueItemId = workbook.rows[2].metricoolQueueItemId;
    workbook.rows[0].publishAt = scheduledFor;
    workbook.rows[1].publishAt = earlyMetricsScheduledFor;
    workbook.rows[2].publishAt = readyMetricsScheduledFor;
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    await writeFile(
      batchEvidencePath,
      mutateTestCsvRows(originalBatchEvidence, (cells, _index, header) => {
        const queueId = cells[header.indexOf("metricool_queue_item_id")];
        if (queueId === queueItemId) {
          cells[header.indexOf("scheduled_for")] = scheduledFor;
          cells[header.indexOf("metricool_approval_url")] = "https://app.metricool.com/planner/scheduled-proof-001";
          cells[header.indexOf("published_post_url")] = "";
          cells[header.indexOf("final_status")] = "scheduled";
          cells[header.indexOf("views_24h")] = "";
          cells[header.indexOf("likes_24h")] = "";
          cells[header.indexOf("comments_24h")] = "";
          cells[header.indexOf("shares_24h")] = "";
          cells[header.indexOf("operator_notes")] = "Scheduled in Metricool with real approval proof for timeline test.";
        }
        if (queueId === earlyMetricsQueueItemId || queueId === readyMetricsQueueItemId) {
          const isEarlyMetricsRow = queueId === earlyMetricsQueueItemId;
          cells[header.indexOf("scheduled_for")] = isEarlyMetricsRow ? earlyMetricsScheduledFor : readyMetricsScheduledFor;
          cells[header.indexOf("metricool_approval_url")] = "https://app.metricool.com/planner/scheduled-proof-002";
          cells[header.indexOf("published_post_url")] = isEarlyMetricsRow
            ? "https://www.tiktok.com/@sportsdaily/video/7400000000000000099"
            : "https://www.tiktok.com/@memeradar/video/7400000000000000100";
          cells[header.indexOf("final_status")] = "published";
          cells[header.indexOf("views_24h")] = "100";
          cells[header.indexOf("likes_24h")] = "10";
          cells[header.indexOf("comments_24h")] = "2";
          cells[header.indexOf("shares_24h")] = "1";
          cells[header.indexOf("operator_notes")] = "Published row with real TikTok URL and metrics for timeline verification.";
        }
        return cells;
      }),
    );

    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
      "script/clippers-tiktok-post-schedule-verifier.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const verifier = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-post-schedule-verifier.json"), "utf8"));
    const row = verifier.rows.find((item) => item.metricoolQueueItemId === queueItemId);
    const earlyMetricsRow = verifier.rows.find((item) => item.metricoolQueueItemId === earlyMetricsQueueItemId);
    const readyMetricsRow = verifier.rows.find((item) => item.metricoolQueueItemId === readyMetricsQueueItemId);
    assert.equal(verifier.status, "needs_metricool_scheduling");
    assert.equal(verifier.timeline.publicUrlDueNow, 1);
    assert.equal(verifier.timeline.metricsEligibleNow, 0);
    assert.equal(verifier.timeline.metricsNotDueYet, 1);
    assert.equal(verifier.timeline.nextActionAt, earlyMetricsRow.timeline.metricsDueAt);
    assert.equal(row.state, "scheduled");
    assert.equal(row.timeline.status, "capture_public_url_now");
    assert.equal(row.timeline.publicUrlDueNow, true);
    assert.equal(row.timeline.metricsEligibleNow, false);
    assert.match(row.nextAction, /Capture the exact public TikTok video URL now/);
    assert.equal(earlyMetricsRow.state, "waiting_metrics");
    assert.equal(earlyMetricsRow.gate, "waiting_24h_metrics");
    assert.equal(earlyMetricsRow.blocker, "metrics_window_not_open");
    assert.equal(earlyMetricsRow.timeline.status, "wait_until_24h_metrics_window");
    assert.equal(earlyMetricsRow.timeline.metricsEligibleNow, false);
    assert.match(earlyMetricsRow.nextAction, /Wait until .* before capturing 24h metrics/);
    assert.equal(readyMetricsRow.state, "ready_to_import");
    assert.equal(readyMetricsRow.timeline.status, "ready_for_import_review");
    assert.equal(readyMetricsRow.timeline.metricsEligibleNow, true);
    const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-post-schedule-verifier.md"), "utf8");
    assert.match(markdown, /Public URL due now: 1/);
    assert.match(markdown, /Metrics not due yet: 1/);
    assert.match(markdown, /Metrics due at:/);
    const csv = await readFile(path.join(rootDir, "reports/clippers-tiktok-post-schedule-verifier.csv"), "utf8");
    assert.match(csv, /timeline_status/);
    assert.match(csv, /capture_public_url_now/);
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    await writeFile(batchEvidencePath, originalBatchEvidence);
    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
      "script/clippers-tiktok-post-schedule-verifier.mjs",
    ]) {
      spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
  }
});

test("TikTok batch closeout unlocks next batch only after every row clears 24h metric window", async () => {
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const handoffPath = path.join(rootDir, "scheduled/metricool-100-operator-handoff.json");
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const importedMetricsPath = path.join(rootDir, "metrics/metricool-approval-imported-metrics.csv");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  const originalImportedMetrics = await readFile(importedMetricsPath, "utf8").catch(() => null);
  const runCloseout = () => {
    for (const script of [
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
      "script/clippers-tiktok-post-schedule-verifier.mjs",
      "script/clippers-tiktok-batch-closeout-verifier.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    return JSON.parse(readFileSync(path.join(rootDir, "reports/clippers-tiktok-batch-closeout-verifier.json"), "utf8"));
  };
  try {
    const workbook = JSON.parse(originalWorkbook);
    const oldScheduledFor = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const earlyScheduledFor = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    workbook.rows = workbook.rows.map((row, index) => ({
      ...row,
      publishAt: index === 0 ? earlyScheduledFor : oldScheduledFor,
    }));
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    await writeFile(
      batchEvidencePath,
      mutateTestCsvRows(originalBatchEvidence, (cells, index, header) => {
        const workbookRow = workbook.rows[index];
        if (!workbookRow) return cells;
        const scheduledFor = index === 0 ? earlyScheduledFor : oldScheduledFor;
        const handle = workbookRow.accountId === "meme-radar" ? "memeradar" : "sportsdaily";
        cells[header.indexOf("scheduled_for")] = scheduledFor;
        cells[header.indexOf("metricool_approval_url")] = `https://app.metricool.com/planner/closeout-${index + 1}`;
        cells[header.indexOf("published_post_url")] = `https://www.tiktok.com/@${handle}/video/7400000000000000${String(index + 100).padStart(3, "0")}`;
        cells[header.indexOf("final_status")] = "published";
        cells[header.indexOf("views_24h")] = "100";
        cells[header.indexOf("likes_24h")] = "10";
        cells[header.indexOf("comments_24h")] = "2";
        cells[header.indexOf("shares_24h")] = "1";
        cells[header.indexOf("operator_notes")] = "Published with exact TikTok URL and real metrics for closeout verifier.";
        return cells;
      }),
    );

    let closeout = runCloseout();
    assert.equal(closeout.status, "waiting_24h_metrics");
    assert.equal(closeout.nextBatchUnlock.status, "blocked_current_batch");
    assert.equal(closeout.nextBatchUnlock.canPrepareNextBatch, false);
    assert.ok(closeout.nextBatchUnlock.blockers.some((blocker) => blocker.includes("waiting 24h metrics")));

    workbook.rows = workbook.rows.map((row) => ({ ...row, publishAt: oldScheduledFor }));
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    await writeFile(
      batchEvidencePath,
      mutateTestCsvRows(await readFile(batchEvidencePath, "utf8"), (cells, index, header) => {
        if (!workbook.rows[index]) return cells;
        cells[header.indexOf("scheduled_for")] = oldScheduledFor;
        return cells;
      }),
    );
    closeout = runCloseout();
    assert.equal(closeout.status, "waiting_import_apply");
    assert.equal(closeout.nextBatchUnlock.status, "waiting_import_apply");
    assert.equal(closeout.nextBatchUnlock.canPrepareNextBatch, false);
    assert.equal(closeout.nextBatchUnlock.nextBatchId, "metricool-batch-02");
    assert.ok(closeout.nextBatchUnlock.blockers.some((blocker) => blocker.includes("waiting import apply")));
    assert.match(closeout.nextBatchUnlock.nextAction, /import preview\/apply/);
    let handoffResult = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(handoffResult.status, 0, handoffResult.stderr || handoffResult.stdout);
    let handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.operatorConsole.currentBatchId, "metricool-batch-01");
    assert.equal(handoff.batches[0].evidenceProgress.status, "ready_for_import_apply");
    assert.equal(handoff.batches[0].evidenceProgress.totals.importApplied, 0);

    await writeFile(importedMetricsPath, [
      "account_id,platform,clip_id,hook,published_at,views,likes,comments,shares,saves,source_file",
      ...workbook.rows.map((row, index) => [
        row.accountId,
        "tiktok",
        `https://www.tiktok.com/@${row.accountId === "meme-radar" ? "memeradar" : "sportsdaily"}/video/7400000000000000${String(index + 100).padStart(3, "0")}`,
        `import applied row ${index + 1}`,
        oldScheduledFor,
        100,
        10,
        2,
        1,
        0,
        row.sourcePath,
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n") + "\n");
    closeout = runCloseout();
    assert.equal(closeout.status, "waiting_import_apply");
    assert.equal(closeout.nextBatchUnlock.canPrepareNextBatch, false);
    assert.equal(closeout.totals.importApplied, 0);

    await writeFile(importedMetricsPath, [
      "metricool_queue_item_id,account_id,platform,clip_id,hook,published_at,views,likes,comments,shares,saves,source_file",
      ...workbook.rows.map((row, index) => [
        row.metricoolQueueItemId,
        row.accountId,
        "tiktok",
        `https://www.tiktok.com/@${row.accountId === "meme-radar" ? "memeradar" : "sportsdaily"}/video/7400000000000000${String(index + 100).padStart(3, "0")}`,
        `import applied row ${index + 1}`,
        oldScheduledFor,
        100,
        10,
        2,
        1,
        0,
        row.sourcePath,
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n") + "\n");
    closeout = runCloseout();
    assert.equal(closeout.status, "ready_to_close_batch");
    assert.equal(closeout.nextBatchUnlock.status, "ready_after_import_apply");
    assert.equal(closeout.nextBatchUnlock.canPrepareNextBatch, true);
    assert.deepEqual(closeout.nextBatchUnlock.blockers, []);
    handoffResult = spawnSync(process.execPath, ["script/clippers-metricool-operator-handoff.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(handoffResult.status, 0, handoffResult.stderr || handoffResult.stdout);
    handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.operatorConsole.currentBatchId, "metricool-batch-02");
    assert.equal(handoff.batches[0].evidenceProgress.status, "metricool_review_complete");
    assert.equal(handoff.batches[0].evidenceProgress.totals.importApplied, 10);
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    await writeFile(batchEvidencePath, originalBatchEvidence);
    if (originalImportedMetrics === null) await unlink(importedMetricsPath).catch(() => undefined);
    else await writeFile(importedMetricsPath, originalImportedMetrics);
    for (const script of [
      "script/clippers-metricool-operator-handoff.mjs",
      "script/clippers-tiktok-batch-tracker.mjs",
      "script/clippers-tiktok-evidence-checklist.mjs",
      "script/clippers-tiktok-post-schedule-verifier.mjs",
      "script/clippers-tiktok-batch-closeout-verifier.mjs",
    ]) {
      spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
  }
});

test("TikTok operator cockpit preflight validates local operator artifacts", async () => {
  await withFutureCurrentBatchSchedule(async () => {
    const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
    const cockpitRun = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(cockpitRun.status, 0, cockpitRun.stderr || cockpitRun.stdout);
    const result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "ready_for_operator");
    assert.equal(output.batchId, "metricool-batch-01");
    assert.equal(output.failed, 0);
    assert.equal(output.uploadMp4Files, 10);
    assert.equal(output.checks, 15);

    const preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
    assert.equal(preflight.status, "ready_for_operator");
    assert.equal(preflight.totals.failed, 0);
    assert.equal(preflight.totals.uploadMp4Files, 10);
    assert.ok(preflight.checks.some((check) => check.id === "upload_folder_mp4_count" && check.status === "pass"));
    assert.ok(preflight.checks.some((check) => check.id === "upload_pack_status" && check.status === "pass"));
    assert.ok(preflight.checks.some((check) => check.id === "schedule_freshness" && check.status === "pass"));
    assert.ok(preflight.checks.some((check) => check.id === "upload_pack_matches_workbook" && check.status === "pass"));
    assert.ok(preflight.checks.some((check) => check.id === "evidence_csv_schema" && check.status === "pass"));
    assert.ok(preflight.checks.some((check) => check.id === "evidence_csv_current_batch_rows" && check.status === "pass"));
    assert.ok(preflight.checks.some((check) => check.id === "evidence_csv_clean_for_operator" && check.status === "pass"));
    assert.ok(preflight.guardrails.some((guardrail) => guardrail.includes("does not publish")));

    const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.md"), "utf8");
    assert.match(markdown, /TikTok Operator Cockpit Preflight/);
    assert.match(markdown, /Status: ready_for_operator/);
    assert.doesNotMatch(markdown, /ready_to_send|auto publish/i);

    const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
    assert.match(routes, /\/api\/clippers\/tiktok-operator-cockpit-preflight/);
    assert.match(routes, /\/api\/clippers\/prepare-tiktok-operator-cockpit-preflight/);
    assert.match(routes, /script\/clippers-tiktok-operator-cockpit-preflight\.mjs/);
    assert.match(routes, /readClipperTikTokOperatorCockpitPreflight/);
    const preflightPostRoute = routes.slice(
      routes.indexOf('app.post("/api/clippers/prepare-tiktok-operator-cockpit-preflight"'),
      routes.indexOf('app.post("/api/clippers/prepare-tiktok-mvp-go-live-packet"'),
    );
    assert.match(preflightPostRoute, /clippers-tiktok-batch-tracker\.mjs/);
    assert.match(preflightPostRoute, /clippers-tiktok-evidence-checklist\.mjs/);
    assert.match(preflightPostRoute, /clippers-metricool-current-batch-upload-pack\.mjs/);
    assert.match(preflightPostRoute, /uploadPackRun = \{ status: "blocked"/);
    assert.match(preflightPostRoute, /--min-upload-generated-at/);
    assert.doesNotMatch(preflightPostRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);

    const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
    assert.match(page, /prepare-clippers-tiktok-operator-cockpit-preflight-button/);
    assert.match(page, /clippers-tiktok-operator-cockpit-preflight-panel/);
    assert.match(page, /TikTokOperatorCockpitPreflightSummary/);
  });
});

test("Metricool current batch upload pack session packet blocks stale batch mismatches", async () => {
  const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
  const nextActionRun = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(nextActionRun.status, 0, nextActionRun.stderr || nextActionRun.stdout);

  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  try {
    const workbook = JSON.parse(originalWorkbook);
    workbook.batchId = "metricool-batch-stale-test";
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_upload_pack");
    const packet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-session-packet.json"), "utf8"));
    assert.equal(packet.status, "blocked_upload_pack");
    assert.ok(packet.consistencyIssues.includes("upload_pack_workbook_batch_mismatch"));
    assert.equal(packet.totals.ready, 0);
    assert.ok(packet.rows.every((row) => row.status === "blocked"));
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool current batch session packet blocks stale same-batch schedule metadata", async () => {
  const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
  const nextActionRun = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(nextActionRun.status, 0, nextActionRun.stderr || nextActionRun.stdout);

  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  try {
    const workbook = JSON.parse(originalWorkbook);
    workbook.rows[0].publishAt = "2026-07-01T10:00:00.000Z";
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked_upload_pack");
    const packet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-session-packet.json"), "utf8"));
    assert.equal(packet.status, "blocked_upload_pack");
    assert.ok(packet.consistencyIssues.some((issue) => issue.startsWith("upload_pack_workbook_publishAt_mismatch:")));
    assert.equal(packet.totals.ready, 0);
    assert.ok(packet.nextStep.includes("upload_pack_workbook_publishAt_mismatch"));
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool current batch session packet blocks expired same-batch schedule times", async () => {
  await withFutureCurrentBatchSchedule(async () => {
    const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
    const nextActionRun = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(nextActionRun.status, 0, nextActionRun.stderr || nextActionRun.stdout);

    const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
    const uploadPackPath = path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json");
    const originalWorkbook = await readFile(workbookPath, "utf8");
    const originalUploadPack = await readFile(uploadPackPath, "utf8");
    try {
      const workbook = JSON.parse(originalWorkbook);
      const uploadPack = JSON.parse(originalUploadPack);
      const expiredPublishAt = "2000-01-01T00:00:00.000Z";
      workbook.rows[0].publishAt = expiredPublishAt;
      uploadPack.rows[0].publishAt = expiredPublishAt;
      await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
      await writeFile(uploadPackPath, JSON.stringify(uploadPack, null, 2));

      const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "blocked_schedule_freshness");
      const packet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-session-packet.json"), "utf8"));
      assert.equal(packet.status, "blocked_schedule_freshness");
      assert.deepEqual(packet.consistencyIssues, []);
      assert.equal(packet.totals.ready, 0);
      assert.equal(packet.scheduleFreshness.ok, false);
      assert.ok(packet.scheduleFreshness.expiredRows.includes(workbook.rows[0].metricoolQueueItemId));
      assert.ok(packet.guardrails.some((guardrail) => guardrail.includes("20 minutes")));
      assert.match(packet.nextStep, /Regenerate the Metricool 100 operator handoff/);
    } finally {
      await writeFile(workbookPath, originalWorkbook);
      await writeFile(uploadPackPath, originalUploadPack);
      spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
  });
});

test("Metricool current batch session packet blocks invalid and too-soon schedule times", async () => {
  await withFutureCurrentBatchSchedule(async () => {
    const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
    const nextActionRun = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(nextActionRun.status, 0, nextActionRun.stderr || nextActionRun.stdout);

    const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
    const uploadPackPath = path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json");
    const originalWorkbook = await readFile(workbookPath, "utf8");
    const originalUploadPack = await readFile(uploadPackPath, "utf8");
    try {
      for (const scenario of [
        { publishAt: "not-a-date", bucket: "invalidRows" },
        { publishAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), bucket: "tooSoonRows" },
      ] as const) {
        const workbook = JSON.parse(originalWorkbook);
        const uploadPack = JSON.parse(originalUploadPack);
        workbook.rows[0].publishAt = scenario.publishAt;
        uploadPack.rows[0].publishAt = scenario.publishAt;
        await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
        await writeFile(uploadPackPath, JSON.stringify(uploadPack, null, 2));

        const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const packet = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-session-packet.json"), "utf8"));
        assert.equal(packet.status, "blocked_schedule_freshness");
        assert.deepEqual(packet.consistencyIssues, []);
        assert.equal(packet.totals.ready, 0);
        assert.equal(packet.scheduleFreshness.ok, false);
        assert.ok(packet.scheduleFreshness[scenario.bucket].includes(workbook.rows[0].metricoolQueueItemId));
        assert.match(packet.nextStep, /Regenerate the Metricool 100 operator handoff/);
      }
    } finally {
      await writeFile(workbookPath, originalWorkbook);
      await writeFile(uploadPackPath, originalUploadPack);
      spawnSync(process.execPath, ["script/clippers-metricool-current-batch-session-packet.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
    }
  });
});

test("TikTok operator cockpit preflight blocks stale upload pack timestamps", async () => {
  const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
  const cockpitRun = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(cockpitRun.status, 0, cockpitRun.stderr || cockpitRun.stdout);
  const result = spawnSync(process.execPath, [
    "script/clippers-tiktok-operator-cockpit-preflight.mjs",
    "--min-upload-generated-at",
    "2999-01-01T00:00:00.000Z",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "blocked");
  const preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
  assert.ok(preflight.checks.some((check) => check.id === "upload_pack_fresh_for_request" && check.status === "fail"));

  const refresh = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
});

test("TikTok operator cockpit preflight blocks expired schedule times", async () => {
  const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
  const cockpitRun = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(cockpitRun.status, 0, cockpitRun.stderr || cockpitRun.stdout);
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  try {
    const workbook = JSON.parse(originalWorkbook);
    workbook.rows[0].publishAt = "2000-01-01T00:00:00.000Z";
    await writeFile(workbookPath, JSON.stringify(workbook, null, 2));
    const result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    const preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
    assert.ok(preflight.checks.some((check) => check.id === "schedule_freshness" && check.status === "fail" && check.evidence.includes("expired=")));
    assert.match(preflight.nextStep, /Regenerate the Metricool 100 operator handoff/);
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok operator cockpit preflight blocks invalid and too-soon schedule times", async () => {
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  try {
    const invalidWorkbook = JSON.parse(originalWorkbook);
    invalidWorkbook.rows[0].publishAt = "not-a-date";
    await writeFile(workbookPath, JSON.stringify(invalidWorkbook, null, 2));
    let result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    let preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
    assert.ok(preflight.checks.some((check) => check.id === "schedule_freshness" && check.status === "fail" && check.evidence.includes("invalid=")));

    const tooSoonWorkbook = JSON.parse(originalWorkbook);
    tooSoonWorkbook.rows[0].publishAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await writeFile(workbookPath, JSON.stringify(tooSoonWorkbook, null, 2));
    result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
    assert.ok(preflight.checks.some((check) => check.id === "schedule_freshness" && check.status === "fail" && check.evidence.includes("tooSoon=")));
  } finally {
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok operator cockpit preflight blocks malformed upload pack rows", async () => {
  const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
  const uploadPackPath = path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json");
  const originalUploadPack = await readFile(uploadPackPath, "utf8");
  try {
    const uploadPack = JSON.parse(originalUploadPack);
    uploadPack.rows[1] = {
      ...uploadPack.rows[0],
      rank: uploadPack.rows[1].rank,
      sourcePath: "/tmp/not-the-current-source.mp4",
    };
    await writeFile(uploadPackPath, JSON.stringify(uploadPack, null, 2));
    const cockpitRun = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(cockpitRun.status, 0, cockpitRun.stderr || cockpitRun.stdout);
    const result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    const preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
    assert.ok(preflight.checks.some((check) => check.id === "upload_pack_matches_workbook" && check.status === "fail"));
  } finally {
    await writeFile(uploadPackPath, originalUploadPack);
    spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok operator cockpit preflight blocks header-only evidence CSV", async () => {
  const uploadPackRun = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(uploadPackRun.status, 0, uploadPackRun.stderr || uploadPackRun.stdout);
  const cockpitRun = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(cockpitRun.status, 0, cockpitRun.stderr || cockpitRun.stdout);
  const cockpit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit.json"), "utf8"));
  const evidenceCsvPath = cockpit.paths.batchEvidenceCsv;
  const originalEvidenceCsv = await readFile(evidenceCsvPath, "utf8");
  const headerOnlyCsv = originalEvidenceCsv.split(/\r?\n/)[0] + "\n";

  try {
    await writeFile(evidenceCsvPath, headerOnlyCsv);
    const result = spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "blocked");
    assert.ok(output.failed > 0);
    const preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-operator-cockpit-preflight.json"), "utf8"));
    assert.ok(preflight.checks.some((check) => check.id === "evidence_csv_current_batch_rows" && check.status === "fail"));
  } finally {
    await writeFile(evidenceCsvPath, originalEvidenceCsv);
    spawnSync(process.execPath, ["script/clippers-tiktok-operator-cockpit-preflight.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok batch evidence batch paste previews and blocks partial invalid writes", async () => {
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const workbook = JSON.parse(await readFile(workbookPath, "utf8"));
  const batchEvidencePath = workbook.paths.batchEvidenceCsv;
  const applyLockPath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/.tiktok-batch-evidence-apply.lock");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  const firstRow = workbook.rows[0];
  const raw = JSON.stringify([
    {
      metricoolQueueItemId: firstRow.metricoolQueueItemId,
      metricoolApprovalUrl: "https://app.metricool.com/planner",
      finalStatus: "scheduled",
      operatorNotes: "Scheduled in Metricool planner for the current TikTok batch.",
    },
    {
      metricoolQueueItemId: firstRow.metricoolQueueItemId,
      metricoolApprovalUrl: "https://app.metricool.com/planner",
      finalStatus: "scheduled",
      operatorNotes: "ok",
    },
  ]);
  const csvRaw = [
    "metricool_queue_item_id,metricool_approval_url,final_status,operator_notes",
    [
      firstRow.metricoolQueueItemId,
      "https://app.metricool.com/planner",
      "scheduled",
      "Scheduled in Metricool planner for the current TikTok batch.",
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
  ].join("\n");

  try {
    const previewResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `const result = await previewClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(raw)} });`,
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(previewResult.status, 0, previewResult.stderr || previewResult.stdout);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.status, "blocked_validation");
    assert.equal(preview.totals.rows, 2);
    assert.equal(preview.totals.accepted, 1);
    assert.equal(preview.totals.rejected, 1);
    assert.ok(preview.rows.some((row) => row.accepted === false && /operator notes/i.test(row.reason)));

    const csvPreviewResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `const result = await previewClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(csvRaw)} });`,
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(csvPreviewResult.status, 0, csvPreviewResult.stderr || csvPreviewResult.stdout);
    const csvPreview = JSON.parse(csvPreviewResult.stdout);
    assert.equal(csvPreview.status, "ready_to_apply");
    assert.equal(csvPreview.totals.accepted, 1);

    const duplicateRaw = JSON.stringify([
      {
        metricoolQueueItemId: firstRow.metricoolQueueItemId,
        metricoolApprovalUrl: "https://app.metricool.com/planner",
        finalStatus: "scheduled",
        operatorNotes: "Scheduled in Metricool planner for duplicate test row one.",
      },
      {
        metricoolQueueItemId: firstRow.metricoolQueueItemId,
        metricoolApprovalUrl: "https://app.metricool.com/planner",
        finalStatus: "scheduled",
        operatorNotes: "Scheduled in Metricool planner for duplicate test row two.",
      },
    ]);
    const duplicatePreviewResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `const result = await previewClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(duplicateRaw)} });`,
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(duplicatePreviewResult.status, 0, duplicatePreviewResult.stderr || duplicatePreviewResult.stdout);
    const duplicatePreview = JSON.parse(duplicatePreviewResult.stdout);
    assert.equal(duplicatePreview.status, "blocked_validation");
    assert.ok(duplicatePreview.rows.some((row) => row.reason === "duplicate_metricool_queue_item_id_in_batch"));

    const recordResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `const result = await recordClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(raw)} });`,
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(recordResult.status, 0, recordResult.stderr || recordResult.stdout);
    const record = JSON.parse(recordResult.stdout);
    assert.equal(record.status, "blocked_validation");
    assert.equal(record.totals.applied, 0);
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);

    const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
    assert.match(routes, /\/api\/clippers\/preview-tiktok-batch-evidence-batch/);
    assert.match(routes, /previewClipperTikTokBatchEvidenceBatch/);
    assert.match(routes, /\/api\/clippers\/record-tiktok-batch-evidence-batch/);
    assert.match(routes, /recordClipperTikTokBatchEvidenceBatch/);
    const batchRecordRoute = routes.slice(
      routes.indexOf('app.post("/api/clippers/record-tiktok-batch-evidence-batch"'),
      routes.indexOf('app.post("/api/clippers/preview-metricool-approval-evidence"'),
    );
    assert.match(batchRecordRoute, /partial_refresh_failed/);
    assert.match(batchRecordRoute, /res\.status\(refreshStatus === "complete" \? 200 : 202\)/);
    const agentSource = await readFile(path.join(process.cwd(), "server/clippers-agent.ts"), "utf8");
    const batchRecordFunction = agentSource.slice(
      agentSource.indexOf("export async function recordClipperTikTokBatchEvidenceBatch"),
      agentSource.indexOf("function validateTikTokBatchOperatorNotes"),
    );
    const singleRowRecordFunction = agentSource.slice(
      agentSource.indexOf("export async function recordClipperTikTokBatchEvidenceRow"),
      agentSource.indexOf("function parseTikTokBatchEvidenceBatchRows"),
    );
    assert.doesNotMatch(batchRecordFunction, /recordClipperTikTokBatchEvidenceRow\(/);
    assert.match(batchRecordFunction, /writeFile\(tempPath, replacementRaw\)/);
    assert.match(batchRecordFunction, /rename\(tempPath, batchEvidenceCsvPath\)/);
    assert.match(batchRecordFunction, /acquireTikTokBatchEvidenceApplyLock/);
    assert.match(singleRowRecordFunction, /acquireTikTokBatchEvidenceApplyLock/);
    assert.match(singleRowRecordFunction, /writeFile\(tempPath, replacementRaw\)/);
    assert.match(singleRowRecordFunction, /rename\(tempPath, batchEvidenceCsvPath\)/);

    await mkdir(applyLockPath, { recursive: true });
    await writeFile(path.join(applyLockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      purpose: "tiktok_batch_evidence_apply",
    }, null, 2));
    const lockedResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `await recordClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(csvRaw)} });`,
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(lockedResult.status, 0);
    assert.match(lockedResult.stderr, /already running/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);

    const lockedSingleRowResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        `metricoolQueueItemId:${JSON.stringify(firstRow.metricoolQueueItemId)},`,
        "metricoolApprovalUrl:'https://app.metricool.com/planner',",
        "finalStatus:'scheduled',",
        "operatorNotes:'Scheduled in Metricool planner while lock exists.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(lockedSingleRowResult.status, 0);
    assert.match(lockedSingleRowResult.stderr, /already running/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);

    await rm(applyLockPath, { recursive: true, force: true });
    await mkdir(applyLockPath, { recursive: true });
    const freshOwnerlessLockResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `await recordClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(csvRaw)} });`,
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(freshOwnerlessLockResult.status, 0);
    assert.match(freshOwnerlessLockResult.stderr, /already running/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);

    const oldLockDate = new Date("2000-01-01T00:00:00.000Z");
    await utimes(applyLockPath, oldLockDate, oldLockDate);
    const staleOwnerlessLockResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `const result = await recordClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(csvRaw)} });`,
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(staleOwnerlessLockResult.status, 0, staleOwnerlessLockResult.stderr || staleOwnerlessLockResult.stdout);
    const staleOwnerlessLockApply = JSON.parse(staleOwnerlessLockResult.stdout);
    assert.equal(staleOwnerlessLockApply.status, "applied");
    await writeFile(batchEvidencePath, originalBatchEvidence);

    await mkdir(applyLockPath, { recursive: true });
    await writeFile(path.join(applyLockPath, "owner.json"), JSON.stringify({
      pid: 0,
      acquiredAt: "2000-01-01T00:00:00.000Z",
      purpose: "tiktok_batch_evidence_apply",
    }, null, 2));
    const staleLockResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceBatch } from './server/clippers-agent.ts';",
        `const result = await recordClipperTikTokBatchEvidenceBatch({ raw: ${JSON.stringify(csvRaw)} });`,
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(staleLockResult.status, 0, staleLockResult.stderr || staleLockResult.stdout);
    const staleLockApply = JSON.parse(staleLockResult.stdout);
    assert.equal(staleLockApply.status, "applied");
    await rm(applyLockPath, { recursive: true, force: true });

    const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
    assert.match(page, /clippers-tiktok-batch-evidence-batch-panel/);
    assert.match(page, /preview-tiktok-batch-evidence-batch-button/);
    assert.match(page, /apply-tiktok-batch-evidence-batch-button/);
    assert.match(page, /tiktokBatchEvidenceBatchApplyDisabled/);
    assert.match(page, /Preview validates every row first/);
    assert.match(page, /refreshStatus\?: "complete" \| "partial_refresh_failed"/);
    assert.match(page, /Batch evidence guardado; refresco pendiente/);
    assert.match(page, /tiktok-batch-evidence-batch-refresh-warning/);
    assert.match(page, /Evidence was saved, but refresh did not complete/);
  } finally {
    await rm(applyLockPath, { recursive: true, force: true });
    await writeFile(batchEvidencePath, originalBatchEvidence);
  }
});

test("TikTok read endpoints do not sync batch evidence on passive page load", async () => {
  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const runbookGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/tiktok-batch-runbook"'),
    routes.indexOf('app.get("/api/clippers/tiktok-evidence-checklist"'),
  );
  const checklistGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/tiktok-evidence-checklist"'),
    routes.indexOf('app.get("/api/clippers/tiktok-mvp-go-live-packet"'),
  );
  const goLiveGetRoute = routes.slice(
    routes.indexOf('app.get("/api/clippers/tiktok-mvp-go-live-packet"'),
    routes.indexOf('app.get("/api/clippers/metricool-approval-quick-run"'),
  );
  assert.doesNotMatch(runbookGetRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.doesNotMatch(checklistGetRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.doesNotMatch(goLiveGetRoute, /clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.doesNotMatch(goLiveGetRoute, /runClipperJsonScript|runClipperNodeJson|clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(goLiveGetRoute, /readClipperTikTokMvpGoLivePacket/);
  const goLiveScript = await readFile(path.join(process.cwd(), "script/clippers-tiktok-mvp-go-live-packet.mjs"), "utf8");
  assert.match(goLiveScript, /if \(!readOnlyMode\) \{[\s\S]*clippers-tiktok-batch-evidence-sync\.mjs/);
  assert.match(goLiveScript, /if \(!readOnlyMode\) \{[\s\S]*writeFile\(outJsonPath/);
});

test("TikTok batch evidence row recording updates current batch and keeps publish gate strict", async () => {
  const batchEvidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const masterEvidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const workbookPath = path.join(rootDir, "scheduled/metricool-100-current-batch-workbook.json");
  const originalBatchEvidence = await readFile(batchEvidencePath, "utf8");
  const originalMasterEvidence = await readFile(masterEvidencePath, "utf8");
  const originalWorkbook = await readFile(workbookPath, "utf8");
  const currentWorkbookJson = JSON.parse(originalWorkbook);
  const currentFirstWorkbookRow = currentWorkbookJson.rows.find((row) => row.metricoolQueueItemId === "53467d8f7dad");
  const firstScheduledFor = currentFirstWorkbookRow.publishAt;
  try {
    const previewResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "const result = await previewClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'scheduled',",
        "operatorNotes:'Preview only; this should not write evidence.'",
        "});",
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(previewResult.status, 0, previewResult.stderr || previewResult.stdout);
    const previewOutput = JSON.parse(previewResult.stdout);
    assert.equal(previewOutput.accepted, true);
    assert.equal(previewOutput.wouldWrite, false);
    assert.equal(previewOutput.classification, "scheduled");
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);
    assert.equal(await readFile(masterEvidencePath, "utf8"), originalMasterEvidence);

    const rejectedPreviewResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await previewClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "publishedPostUrl:'https://www.tiktok.com/t/ZTShortLink/',",
        "finalStatus:'published',",
        "views24h:'100',",
        "operatorNotes:'Preview short link must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(rejectedPreviewResult.status, 0);
    assert.match(rejectedPreviewResult.stderr, /exact public TikTok video URL/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);
    assert.equal(await readFile(masterEvidencePath, "utf8"), originalMasterEvidence);

    const missingSourceWorkbook = JSON.parse(originalWorkbook);
    missingSourceWorkbook.rows[0].sourcePath = "/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/missing-source-for-preview-test.mp4";
    await writeFile(workbookPath, JSON.stringify(missingSourceWorkbook, null, 2));
    const missingSourcePreviewResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await previewClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'scheduled',",
        "operatorNotes:'Source file missing must block evidence preview.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(missingSourcePreviewResult.status, 0);
    assert.match(missingSourcePreviewResult.stderr, /valid local source file/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), originalBatchEvidence);
    assert.equal(await readFile(masterEvidencePath, "utf8"), originalMasterEvidence);
    await writeFile(workbookPath, originalWorkbook);

    const recordResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "const result = await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'scheduled',",
        "operatorNotes:'Scheduled in Metricool batch test without secrets.'",
        "});",
        "console.log(JSON.stringify(result));",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(recordResult.status, 0, recordResult.stderr || recordResult.stdout);
    const recordOutput = JSON.parse(recordResult.stdout);
    assert.equal(recordOutput.batchId, "metricool-batch-01");
    assert.equal(recordOutput.metricoolQueueItemId, "53467d8f7dad");

    const batchCsv = await readFile(batchEvidencePath, "utf8");
    assert.match(batchCsv, /https:\/\/app\.metricool\.com\/planner\/tiktok-batch-test/);
    assert.match(batchCsv, /Scheduled in Metricool batch test without secrets/);

    const syncResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);
    const syncOutput = JSON.parse(syncResult.stdout);
    assert.equal(syncOutput.status, "synced");
    assert.equal(syncOutput.applied, 1);

    const trackerResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(trackerResult.status, 0, trackerResult.stderr || trackerResult.stdout);
    const tracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(tracker.totals.scheduled, 1);
    assert.equal(tracker.totals.readyToImport, 0);

    const beforeRejectedBatchCsv = await readFile(batchEvidencePath, "utf8");
    const beforeRejectedMasterCsv = await readFile(masterEvidencePath, "utf8");

    const missingApprovalResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "finalStatus:'scheduled',",
        "operatorNotes:'Scheduled status without Metricool URL must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(missingApprovalResult.status, 0);
    assert.match(missingApprovalResult.stderr, /Metricool HTTPS approval URL/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const approvedStatusResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'approved',",
        "operatorNotes:'Approved status should be rejected; use scheduled for TikTok batch.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(approvedStatusResult.status, 0);
    assert.match(approvedStatusResult.stderr, /uses finalStatus=scheduled/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const scheduledWithPublicUrlResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "publishedPostUrl:'https://www.tiktok.com/@memeradar/video/1234567890123456789',",
        "finalStatus:'scheduled',",
        "views24h:'100',",
        "operatorNotes:'Scheduled row with public URL and metrics must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(scheduledWithPublicUrlResult.status, 0);
    assert.match(scheduledWithPublicUrlResult.stderr, /must not include public post URL or 24h metrics/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const weakNotesResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'scheduled',",
        "operatorNotes:'ok'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(weakNotesResult.status, 0);
    assert.match(weakNotesResult.stderr, /real operator notes/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const repeatedGenericNotesResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'scheduled',",
        "operatorNotes:'approved approved approved approved'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(repeatedGenericNotesResult.status, 0);
    assert.match(repeatedGenericNotesResult.stderr, /operator_notes_must_not_be_generic/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const placeholderNotesResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await previewClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricoolApprovalUrl:'https://app.metricool.com/planner/tiktok-batch-test',",
        "finalStatus:'scheduled',",
        "operatorNotes:'<paste notes here after Metricool approval>'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(placeholderNotesResult.status, 0);
    assert.match(placeholderNotesResult.stderr, /operator_notes_must_not_contain_placeholders/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const snakeCaseApprovedResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { previewClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await previewClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "metricool_approval_url:'https://app.metricool.com/planner/tiktok-batch-test',",
        "final_status:'approved',",
        "operator_notes:'Snake case approved status must still be rejected.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(snakeCaseApprovedResult.status, 0);
    assert.match(snakeCaseApprovedResult.stderr, /approved is not accepted/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    await writeFile(batchEvidencePath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      `53467d8f7dad,meme-radar,Meme Radar,tiktok,memes,6431685,${firstScheduledFor},/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/memes-owned-01.mp4,El internet hoy en 7 segundos. #fyp #clips,,<published post URL after live>,scheduled,<views after 24h>,<likes after 24h>,<comments after 24h>,<shares after 24h>,Manual CSV scheduled row without Metricool URL must be needs_fix.`,
    ].join("\n") + "\n");
    const invalidTrackerResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(invalidTrackerResult.status, 0, invalidTrackerResult.stderr || invalidTrackerResult.stdout);
    const invalidTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(invalidTracker.rows.find((row) => row.metricoolQueueItemId === "53467d8f7dad")?.state, "needs_fix");
    assert.match(invalidTracker.rows.find((row) => row.metricoolQueueItemId === "53467d8f7dad")?.blocker || "", /metricool_approval_url_must_be_metricool_url/);
    await writeFile(batchEvidencePath, beforeRejectedBatchCsv);

    await writeFile(batchEvidencePath, [
      "metricool_queue_item_id,account_id,account_name,platform,metricool_brand_name,metricool_blog_id,scheduled_for,source_path,caption_seed,metricool_approval_url,published_post_url,final_status,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
      `53467d8f7dad,meme-radar,Meme Radar,tiktok,memes,6431685,${firstScheduledFor},/Users/robertmanzanilla/Documents/asistente/clippers_workspace/sources/memes/memes-owned-01.mp4,El internet hoy en 7 segundos. #fyp #clips,https://app.metricool.com/planner/tiktok-batch-test,,approved,,,,,Manual approved row should be needs_fix; use scheduled for TikTok batch.`,
    ].join("\n") + "\n");
    const approvedTrackerResult = spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(approvedTrackerResult.status, 0, approvedTrackerResult.stderr || approvedTrackerResult.stdout);
    const approvedTracker = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-batch-tracker.json"), "utf8"));
    assert.equal(approvedTracker.rows.find((row) => row.metricoolQueueItemId === "53467d8f7dad")?.state, "needs_fix");
    assert.match(approvedTracker.rows.find((row) => row.metricoolQueueItemId === "53467d8f7dad")?.blocker || "", /approved_status_not_allowed/);
    await writeFile(batchEvidencePath, beforeRejectedBatchCsv);

    const rejectedResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "publishedPostUrl:'https://www.tiktok.com/@meme-radar',",
        "finalStatus:'published',",
        "views24h:'100',",
        "operatorNotes:'Profile URL must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(rejectedResult.status, 0);
    assert.match(rejectedResult.stderr, /exact public TikTok video URL/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const nonNumericVideoResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "publishedPostUrl:'https://www.tiktok.com/@meme-radar/video/notnumeric',",
        "finalStatus:'published',",
        "views24h:'100',",
        "operatorNotes:'Non numeric video id must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(nonNumericVideoResult.status, 0);
    assert.match(nonNumericVideoResult.stderr, /exact public TikTok video URL/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const searchUrlResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "publishedPostUrl:'https://www.tiktok.com/search?q=clips',",
        "finalStatus:'published',",
        "views24h:'100',",
        "operatorNotes:'Search URL must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(searchUrlResult.status, 0);
    assert.match(searchUrlResult.stderr, /exact public TikTok video URL/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

    const shortLinkResult = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "-e",
      [
        "import { recordClipperTikTokBatchEvidenceRow } from './server/clippers-agent.ts';",
        "await recordClipperTikTokBatchEvidenceRow({",
        "metricoolQueueItemId:'53467d8f7dad',",
        "publishedPostUrl:'https://www.tiktok.com/t/ZTShortLink/',",
        "finalStatus:'published',",
        "views24h:'100',",
        "operatorNotes:'TikTok short redirect URL must fail.'",
        "});",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(shortLinkResult.status, 0);
    assert.match(shortLinkResult.stderr, /exact public TikTok video URL/);
    assert.equal(await readFile(batchEvidencePath, "utf8"), beforeRejectedBatchCsv);
    assert.equal(await readFile(masterEvidencePath, "utf8"), beforeRejectedMasterCsv);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/preview-tiktok-batch-evidence-row/);
  assert.match(routes, /previewClipperTikTokBatchEvidenceRow/);
  assert.match(routes, /\/api\/clippers\/record-tiktok-batch-evidence-row/);
  assert.match(routes, /recordClipperTikTokBatchEvidenceRow/);
  const recordTikTokEvidenceRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/record-tiktok-batch-evidence-row"'),
    routes.indexOf('app.post("/api/clippers/preview-metricool-approval-evidence"'),
  );
  assert.match(recordTikTokEvidenceRoute, /clippers-tiktok-batch-evidence-sync\.mjs", "--all-batches"/);
  assert.match(recordTikTokEvidenceRoute, /clippers-metricool-operator-handoff\.mjs/);
  assert.match(recordTikTokEvidenceRoute, /clippers-tiktok-evidence-checklist\.mjs/);
  assert.match(recordTikTokEvidenceRoute, /clippers-tiktok-launch-control\.mjs/);
  assert.match(recordTikTokEvidenceRoute, /clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.match(recordTikTokEvidenceRoute, /clippers-goal-completion-audit\.mjs/);
  assert.match(recordTikTokEvidenceRoute, /clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(recordTikTokEvidenceRoute, /partial_refresh_failed/);
  assert.match(recordTikTokEvidenceRoute, /res\.status\(refreshStatus === "complete" \? 200 : 202\)/);
  assert.match(recordTikTokEvidenceRoute, /metricool100OperatorHandoff/);
  assert.match(recordTikTokEvidenceRoute, /tiktokLaunchControl/);
  assert.match(recordTikTokEvidenceRoute, /tiktokMvpGoLivePacket/);
  assert.match(recordTikTokEvidenceRoute, /goalCompletionAudit/);
  assert.match(recordTikTokEvidenceRoute, /tiktokMvpReadinessVerifier/);
  const agentSource = await readFile(path.join(process.cwd(), "server/clippers-agent.ts"), "utf8");
  const previewFunction = agentSource.slice(
    agentSource.indexOf("export async function previewClipperTikTokBatchEvidenceRow"),
    agentSource.indexOf("export async function recordClipperMetricoolAccountEvidence"),
  );
  assert.doesNotMatch(previewFunction, /writeDefaultConfigIfMissing|ensureClipperDirs|writeFile\(/);

  const syncScript = await readFile(path.join(process.cwd(), "script/clippers-tiktok-batch-evidence-sync.mjs"), "utf8");
  assert.match(syncScript, /workbook\.batchId/);
  assert.match(syncScript, /\$\{batchId\}-evidence-import\.csv/);
  const runbookScript = await readFile(path.join(process.cwd(), "script/clippers-tiktok-batch-runbook.mjs"), "utf8");
  assert.match(runbookScript, /tracker\.batch\?\.id/);
  assert.match(runbookScript, /\$\{batchId\}-evidence-import\.csv/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /preview-clippers-tiktok-batch-evidence-row-button/);
  assert.match(page, /clippers-tiktok-batch-evidence-row-preview/);
  assert.match(page, /clippers-tiktok-batch-preview-required/);
  assert.match(page, /clippers-tiktok-scheduled-evidence-guardrail/);
  assert.match(page, /Scheduled evidence is only Metricool proof/);
  assert.match(page, /clippers-tiktok-published-evidence-guardrail/);
  assert.match(page, /Published evidence requires an exact public TikTok video URL/);
  assert.match(page, /Preview row is required before saving this TikTok batch evidence/);
  assert.match(page, /clippers-tiktok-batch-notes-required/);
  assert.match(page, /20\+ character operator note/);
  assert.match(page, /selectedMetricoolEvidenceItem\?\.origin !== "tiktok batch"/);
  assert.match(page, /metricoolEvidenceSaveDisabled/);
  assert.match(page, /tiktokBatchEvidencePreviewIsCurrent/);
  assert.match(page, /formFingerprint/);
  assert.match(page, /record-tiktok-batch-evidence-row/);
  assert.match(page, /metricool100OperatorHandoff\?: ClipperMetricool100OperatorHandoffSummary/);
  assert.match(page, /tiktokEvidenceChecklist\?: ClipperTikTokEvidenceChecklistSummary/);
  assert.match(page, /tiktokLaunchControl\?: ClipperTikTokLaunchControlSummary/);
  assert.match(page, /tiktokMvpGoLivePacket\?: ClipperTikTokMvpGoLivePacketSummary/);
  assert.match(page, /goalCompletionAudit\?: ClipperGoalCompletionAuditSummary/);
  assert.match(page, /tiktokMvpReadinessVerifier\?: ClipperTikTokMvpReadinessVerifierSummary/);
  assert.match(page, /refreshStatus\?: "complete" \| "partial_refresh_failed"/);
  assert.match(page, /Evidencia guardada; refresco pendiente/);
  assert.match(page, /\["\/api\/clippers\/metricool-100-operator-handoff"\], data\.metricool100OperatorHandoff/);
  assert.match(page, /\["\/api\/clippers\/tiktok-evidence-checklist"\], data\.tiktokEvidenceChecklist/);
  assert.match(page, /\["\/api\/clippers\/tiktok-launch-control"\], data\.tiktokLaunchControl/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-go-live-packet"\], data\.tiktokMvpGoLivePacket/);
  assert.match(page, /\["\/api\/clippers\/goal-completion-audit"\], data\.goalCompletionAudit/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-readiness-verifier"\], data\.tiktokMvpReadinessVerifier/);
  assert.match(page, /\|\| !selectedMetricoolEvidenceItem/);
  assert.match(page, /setMetricoolEvidenceQueueItemId\(""\)/);
  assert.match(page, /tiktok batch/);
  } finally {
    await writeFile(batchEvidencePath, originalBatchEvidence);
    await writeFile(masterEvidencePath, originalMasterEvidence);
    await writeFile(workbookPath, originalWorkbook);
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-evidence-sync.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-tracker.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-tiktok-batch-runbook.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP readiness verifier gates Metricool operator start without fake publishing", async () => {
  await withFutureCurrentBatchSchedule(async () => {
  for (const script of [
    "script/clippers-account-permission-readiness.mjs",
    "script/clippers-tiktok-batch-evidence-sync.mjs",
    "script/clippers-tiktok-batch-tracker.mjs",
    "script/clippers-tiktok-batch-runbook.mjs",
    "script/clippers-tiktok-evidence-checklist.mjs",
    "script/clippers-metricool-operator-handoff.mjs",
    "script/clippers-tiktok-launch-control.mjs",
    "script/clippers-goal-completion-audit.mjs",
    "script/clippers-tiktok-mvp-go-live-packet.mjs",
  ]) {
    const prerequisite = spawnSync(process.execPath, [script, ...(script.endsWith("batch-evidence-sync.mjs") ? ["--all-batches"] : [])], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(prerequisite.status, 0, prerequisite.stderr || prerequisite.stdout);
  }

  const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-readiness-verifier.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "pass");
  assert.equal(output.launchDecision, "ready_for_metricool_operator");
  assert.equal(output.failed, 0);
  assert.equal(output.currentBatch, "metricool-batch-01");

  const verifier = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-readiness-verifier.json"), "utf8"));
  assert.equal(verifier.status, "pass");
  assert.equal(verifier.scope, "tiktok_only_metricool_mvp");
  assert.equal(verifier.launchDecision, "ready_for_metricool_operator");
  assert.deepEqual(verifier.active.platforms, ["tiktok"]);
  assert.deepEqual(verifier.active.accounts, ["meme-radar", "sports-daily"]);
  assert.deepEqual(verifier.active.metricoolBrands, ["SPORT", "memes"]);
  assert.equal(verifier.active.totalRows, 100);
  assert.equal(verifier.active.readyToImport, 0);
  assert.equal(verifier.active.readyToSend, 0);
  assert.equal(verifier.totals.checks, 8);
  assert.equal(verifier.totals.failed, 0);
  assert.ok(verifier.proofBridgeGate);
  assert.match(verifier.proofBridgeGate.paths.previewGate, /metricool-bridge-preview-gate\.json$/);
  assert.equal(verifier.proofBridgeGate.previewRawStored, false);
  assert.equal(verifier.totals.publishedRowsCounted, 0);
  assert.equal(verifier.totals.currentBatchSourcesReady, 10);
  assert.match(verifier.paths.currentBatchEvidenceCsv, /metricool-batch-01-evidence-import\.csv$/);
  assert.match(verifier.paths.masterEvidenceCsv, /metricool-100-approval-evidence-import\.csv$/);
  assert.notEqual(verifier.paths.currentBatchEvidenceCsv, verifier.paths.masterEvidenceCsv);
  assert.ok(verifier.checks.some((check) => check.id === "approval_required_no_autopublish" && check.evidence.includes("approvalRequired=true")));
  assert.ok(verifier.checks.every((check) => check.status === "pass"));
  assert.ok(verifier.guardrails.some((guardrail) => guardrail.includes("realPublishEnabled must remain false")));
  assert.ok(verifier.externalWorkRemaining.some((item) => item.includes("public TikTok URLs")));

  const markdown = await readFile(path.join(rootDir, "reports/clippers-tiktok-mvp-readiness-verifier.md"), "utf8");
  assert.match(markdown, /Clippers TikTok MVP Readiness Verifier/);
  assert.match(markdown, /Launch decision: ready_for_metricool_operator/);
  assert.match(markdown, /Ready for Metricool operator is not ready to publish/);
  assert.doesNotMatch(markdown, /ready_to_send|auto publish/i);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/tiktok-mvp-readiness-verifier/);
  assert.match(routes, /\/api\/clippers\/prepare-tiktok-mvp-readiness-verifier/);
  assert.match(routes, /script\/clippers-tiktok-mvp-readiness-verifier\.mjs/);
  assert.match(routes, /readClipperTikTokMvpReadinessVerifier/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-tiktok-mvp-readiness-verifier-button/);
  assert.match(page, /clippers-tiktok-mvp-readiness-verifier-panel/);
  assert.match(page, /clippers-tiktok-mvp-proof-bridge-gate/);
  assert.match(page, /TikTok MVP Readiness Verifier/);
  assert.match(page, /currentBatchEvidenceCsv/);
  assert.match(page, /proofBridgeGate/);
  assert.match(page, /previewRawStored/);
  assert.match(page, /proofLinksFlowStatus/);
  assert.match(page, /blockedLanes/);
  assert.match(page, /ready_for_metricool_operator/);
  assert.match(page, /\["\/api\/clippers\/tiktok-mvp-readiness-verifier"\]/);
  });
});

test("TikTok MVP readiness verifier blocks non approval-required artifacts", async () => {
  const approvalRunPath = path.join(rootDir, "scheduled/metricool-100-approval-run.json");
  const packetPath = path.join(rootDir, "reports/clippers-tiktok-mvp-go-live-packet.json");
  const verifierPath = path.join(rootDir, "reports/clippers-tiktok-mvp-readiness-verifier.json");
  const originalApprovalRun = await readFile(approvalRunPath, "utf8");
  const originalPacket = await readFile(packetPath, "utf8");
  const originalVerifier = await readFile(verifierPath, "utf8").catch(() => null);
  try {
    const approvalRun = JSON.parse(originalApprovalRun);
    approvalRun.mode = "direct_publish";
    approvalRun.approvalRequired = false;
    await writeFile(approvalRunPath, JSON.stringify(approvalRun, null, 2));

    const packet = JSON.parse(originalPacket);
    packet.operatingMode = {
      ...(packet.operatingMode || {}),
      metricoolApprovalRequired: false,
    };
    await writeFile(packetPath, JSON.stringify(packet, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-readiness-verifier.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "fail");
    assert.equal(output.launchDecision, "blocked_before_metricool");
    assert.ok(output.failed >= 1);
    assert.match(output.nextStep, /Disable real publishing and keep Metricool in approval_required mode/);

    const verifier = JSON.parse(await readFile(verifierPath, "utf8"));
    const approvalCheck = verifier.checks.find((check) => check.id === "approval_required_no_autopublish");
    assert.equal(approvalCheck.status, "fail");
    assert.match(approvalCheck.blocker, /metricool_not_approval_required/);
    assert.match(approvalCheck.evidence, /approvalRequired=false/);
    assert.match(approvalCheck.evidence, /packetApprovalRequired=false/);
  } finally {
    await writeFile(approvalRunPath, originalApprovalRun);
    await writeFile(packetPath, originalPacket);
    if (originalVerifier) await writeFile(verifierPath, originalVerifier);
    spawnSync(process.execPath, ["script/clippers-tiktok-mvp-readiness-verifier.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("TikTok MVP readiness verifier prioritizes Metricool bridge proof when lanes are blocked", async () => {
  const readinessPath = path.join(rootDir, "account-permission-readiness.json");
  const verifierPath = path.join(rootDir, "reports/clippers-tiktok-mvp-readiness-verifier.json");
  const originalReadiness = await readFile(readinessPath, "utf8");
  const originalVerifier = await readFile(verifierPath, "utf8").catch(() => null);
  try {
    const readiness = JSON.parse(originalReadiness);
    readiness.activeMvp = {
      ...(readiness.activeMvp || {}),
      status: "blocked",
      readyLanes: 0,
      targetLanes: 2,
      platforms: ["tiktok"],
      accountIds: ["sports-daily", "meme-radar"],
    };
    readiness.tiktokMvpAccountCloseout = {
      ...(readiness.tiktokMvpAccountCloseout || {}),
      status: "needs_tiktok_account_evidence",
    };
    readiness.metricoolMvpEvidence = {
      ...(readiness.metricoolMvpEvidence || {}),
      bridgeEvidenceCsvPath: path.join(rootDir, "scheduled/metricool-tiktok-bridge-evidence.csv"),
    };
    await writeFile(readinessPath, JSON.stringify(readiness, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-readiness-verifier.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "fail");
    assert.equal(output.launchDecision, "blocked_before_metricool");
    assert.match(output.nextStep, /Preview\/import real non-secret Metricool bridge evidence/);
    assert.match(output.nextStep, /metricool-tiktok-bridge-evidence\.csv/);
    assert.doesNotMatch(output.nextStep, /^Keep only SPORT and memes TikTok/i);

    const verifier = JSON.parse(await readFile(verifierPath, "utf8"));
    assert.match(verifier.nextStep, /Required fields: public TikTok profile URL/);
    assert.equal(verifier.proofBridgeGate.status, "blocked_needs_real_proofs");
    assert.equal(verifier.proofBridgeGate.blockedLanes, 2);
    assert.match(verifier.proofBridgeGate.paths.bridgeEvidenceCsv, /metricool-tiktok-bridge-evidence\.csv$/);
    assert.doesNotMatch(JSON.stringify(verifier.proofBridgeGate), /ready_to_send|realPublishEnabled\s*:\s*true|access_token=|refresh_token=|client_secret=/i);
    assert.ok(verifier.externalWorkRemaining.some((item) => item.includes("metricool-tiktok-bridge-evidence.csv")));
  } finally {
    await writeFile(readinessPath, originalReadiness);
    if (originalVerifier) await writeFile(verifierPath, originalVerifier);
  }
});

test("TikTok next action surfaces Metricool proof bridge blocker when account lanes are blocked", async () => {
  const readinessPath = path.join(rootDir, "account-permission-readiness.json");
  const verifierPath = path.join(rootDir, "reports/clippers-tiktok-mvp-readiness-verifier.json");
  const nextActionPath = path.join(rootDir, "reports/clippers-tiktok-next-action.json");
  const externalSessionPath = path.join(rootDir, "reports/clippers-tiktok-external-closeout-session.json");
  const originalReadiness = await readFile(readinessPath, "utf8");
  const originalVerifier = await readFile(verifierPath, "utf8").catch(() => null);
  const originalNextAction = await readFile(nextActionPath, "utf8").catch(() => null);
  const originalExternalSession = await readFile(externalSessionPath, "utf8").catch(() => null);
  try {
    const readiness = JSON.parse(originalReadiness);
    readiness.activeMvp = {
      ...(readiness.activeMvp || {}),
      status: "blocked",
      readyLanes: 0,
      targetLanes: 2,
      platforms: ["tiktok"],
      accountIds: ["sports-daily", "meme-radar"],
    };
    readiness.tiktokMvpAccountCloseout = {
      ...(readiness.tiktokMvpAccountCloseout || {}),
      status: "needs_tiktok_account_evidence",
      totals: {
        rows: 2,
        ready: 0,
      },
      rows: [
        { accountId: "sports-daily", platform: "tiktok", status: "needs_metricool_bridge_evidence" },
        { accountId: "meme-radar", platform: "tiktok", status: "needs_metricool_bridge_evidence" },
      ],
    };
    readiness.metricoolMvpEvidence = {
      ...(readiness.metricoolMvpEvidence || {}),
      bridgeEvidenceCsvPath: path.join(rootDir, "scheduled/metricool-tiktok-bridge-evidence.csv"),
    };
    await writeFile(readinessPath, JSON.stringify(readiness, null, 2));

    const externalCloseoutRun = spawnSync(process.execPath, ["script/clippers-tiktok-external-closeout-session.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(externalCloseoutRun.status, 0, externalCloseoutRun.stderr || externalCloseoutRun.stdout);
    const proofDoctorRun = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-proof-doctor.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(proofDoctorRun.status, 0, proofDoctorRun.stderr || proofDoctorRun.stdout);

    const verifierRun = spawnSync(process.execPath, ["script/clippers-tiktok-mvp-readiness-verifier.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(verifierRun.status, 0, verifierRun.stderr || verifierRun.stdout);

    const nextActionRun = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(nextActionRun.status, 0, nextActionRun.stderr || nextActionRun.stdout);
    const output = JSON.parse(nextActionRun.stdout);
    assert.equal(output.status, "blocked_account_or_metricool_connection");
    assert.match(output.nextStep, /Paste real non-secret proof URLs/i);
    assert.match(output.nextStep, /metricool-tiktok-bridge-evidence\.csv/);

    const nextAction = JSON.parse(await readFile(nextActionPath, "utf8"));
    assert.equal(nextAction.status, "blocked_account_or_metricool_connection");
    assert.equal(nextAction.proofBridgeGate.status, "blocked_needs_real_proofs");
    assert.equal(nextAction.proofBridgeGate.blockedLanes, 2);
    assert.equal(nextAction.proofBridgeGate.proofLinksFlowStatus, "needs_real_proof_links");
    assert.match(nextAction.proofBridgeGate.paths.proofLinksPastePacket, /proof-links-paste-packet\.txt$/);
    assert.match(nextAction.proofBridgeGate.paths.bridgeEvidenceCsv, /metricool-tiktok-bridge-evidence\.csv$/);
    assert.ok(nextAction.proofLinksChecklist.length >= 8);
    assert.equal(nextAction.externalCloseout.status, "needs_tiktok_external_closeout");
    assert.equal(nextAction.externalCloseout.activeTasks, 4);
    assert.equal(nextAction.externalCloseout.firstActiveTask.id, "account-proof:sports-daily:tiktok");
    assert.match(nextAction.externalCloseout.firstActiveTask.nextAction, /Confirm the TikTok account\/profile is real and connected/);
    assert.ok(nextAction.externalCloseout.deferredTaskIds.includes("developer_app:tiktok"));
    assert.equal(nextAction.proofDoctor.status, "needs_proof_fix");
    assert.equal(nextAction.proofDoctor.ready, 0);
    assert.equal(nextAction.proofDoctor.lanes, 2);
    assert.equal(nextAction.proofDoctor.fixQueue, 4);
    assert.equal(nextAction.proofDoctor.firstFix.lane, "sports-daily:tiktok");
    assert.match(nextAction.proofDoctor.paths.fixQueueCsv, /proof-fix-queue\.csv$/);
    assert.ok(nextAction.tasks.some((task) => task.id === "proof_bridge" && task.status === "blocked"));
    assert.ok(nextAction.tasks.some((task) => task.id === "external_closeout_proofs" && task.status === "blocked"));
    assert.ok(nextAction.tasks.some((task) => task.id === "proof_doctor_fix_queue" && task.status === "blocked"));
    assert.match(nextAction.operator.copyPacket, /Proof bridge gate: blocked_needs_real_proofs/);
    assert.match(nextAction.operator.copyPacket, /First external blocker: account-proof:sports-daily:tiktok/);
    assert.match(nextAction.operator.copyPacket, /Bridge CSV:/);
    assert.doesNotMatch(JSON.stringify(nextAction.proofBridgeGate), /ready_to_send|realPublishEnabled\s*:\s*true|access_token=|refresh_token=|client_secret=/i);

    const markdown = await readFile(nextAction.paths.markdown, "utf8");
    assert.match(markdown, /Metricool Proof Bridge/);
    assert.match(markdown, /External Proof Closeout/);
    assert.match(markdown, /Proof Doctor/);
    assert.match(markdown, /Proof Links Checklist/);
    assert.match(markdown, /Copy proof links packet/);
  } finally {
    await writeFile(readinessPath, originalReadiness);
    if (originalVerifier) await writeFile(verifierPath, originalVerifier);
    if (originalNextAction) await writeFile(nextActionPath, originalNextAction);
    if (originalExternalSession) await writeFile(externalSessionPath, originalExternalSession);
  }
});

test("TikTok next action treats upload pack totals.blocked as blocked source files", async () => {
  const readinessPath = path.join(rootDir, "account-permission-readiness.json");
  const uploadPackPath = path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json");
  const nextActionPath = path.join(rootDir, "reports/clippers-tiktok-next-action.json");
  const originalReadiness = await readFile(readinessPath, "utf8");
  const originalUploadPack = await readFile(uploadPackPath, "utf8");
  const originalNextAction = await readFile(nextActionPath, "utf8").catch(() => null);
  try {
    const readiness = JSON.parse(originalReadiness);
    readiness.tiktokMvpAccountCloseout = {
      status: "ready_for_metricool_tiktok",
      totals: {
        rows: 2,
        ready: 2,
      },
      rows: [
        { accountId: "sports-daily", platform: "tiktok", status: "ready_for_metricool_tiktok" },
        { accountId: "meme-radar", platform: "tiktok", status: "ready_for_metricool_tiktok" },
      ],
    };
    await writeFile(readinessPath, JSON.stringify(readiness, null, 2));

    const uploadPack = JSON.parse(originalUploadPack);
    uploadPack.totals = {
      ...(uploadPack.totals || {}),
      rows: 10,
      copied: 0,
      blocked: 10,
    };
    delete uploadPack.totals.blockedUploadFiles;
    await writeFile(uploadPackPath, JSON.stringify(uploadPack, null, 2));

    const nextActionRun = spawnSync(process.execPath, ["script/clippers-tiktok-next-action.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(nextActionRun.status, 0, nextActionRun.stderr || nextActionRun.stdout);
    const output = JSON.parse(nextActionRun.stdout);
    assert.equal(output.status, "blocked_upload_pack");
    assert.match(output.nextStep, /fix missing local source files/i);

    const nextAction = JSON.parse(await readFile(nextActionPath, "utf8"));
    assert.equal(nextAction.status, "blocked_upload_pack");
    assert.equal(nextAction.uploadPack.blockedUploadFiles, 10);
    assert.equal(nextAction.operatorGate.actionAllowed, false);
    assert.ok(nextAction.operatorGate.blockedBy.includes("upload_pack_or_source_files"));
    assert.ok(nextAction.tasks.some((task) => task.id === "upload_pack" && task.status === "blocked"));
  } finally {
    await writeFile(readinessPath, originalReadiness);
    await writeFile(uploadPackPath, originalUploadPack);
    if (originalNextAction) await writeFile(nextActionPath, originalNextAction);
  }
});

test("Metricool MCP preflight confirms configured keys without enabling automatic posting", async () => {
  await withFutureCurrentBatchSchedule(async () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "script/clippers-metricool-mcp-preflight.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      METRICOOL_USER_TOKEN: "test-metricool-token",
      METRICOOL_USER_ID: "test-metricool-user",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_operator");
  assert.equal(output.readyForMcp, true);
  assert.equal(output.failed, 0);
  assert.equal(output.currentBatch, "metricool-batch-01");

  const preflight = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-mcp-preflight.json"), "utf8"));
  assert.equal(preflight.status, "ready_for_operator");
  assert.equal(preflight.mode, "metricool_operator_preflight_tiktok_only");
  assert.equal(preflight.metricoolConfig.userTokenConfigured, true);
  assert.equal(preflight.metricoolConfig.userIdConfigured, true);
  assert.equal(preflight.metricoolConfig.readyForMcp, true);
  assert.equal(preflight.active.currentBatchId, "metricool-batch-01");
  assert.equal(preflight.active.readyToImport, 0);
  assert.match(preflight.paths.currentBatchEvidenceCsv, /metricool-batch-01-evidence-import\.csv$/);
  assert.ok(preflight.checks.some((check) => check.id === "automatic_metricool_execution_not_enabled" && check.status === "warn"));
  assert.ok(preflight.guardrails.some((guardrail) => guardrail.includes("Credentials present are not proof")));
  assert.ok(preflight.guardrails.some((guardrail) => guardrail.includes("Missing Metricool MCP/API credentials do not block")));
  assert.doesNotMatch(JSON.stringify(preflight), /test-metricool-token|test-metricool-user/);

  const markdown = await readFile(path.join(rootDir, "reports/clippers-metricool-mcp-preflight.md"), "utf8");
  assert.match(markdown, /Clippers Metricool MCP Preflight/);
  assert.match(markdown, /METRICOOL_USER_TOKEN configured: true/);
  assert.match(markdown, /automatic posting disabled/i);
  assert.doesNotMatch(markdown, /test-metricool-token|test-metricool-user/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/metricool-mcp-preflight/);
  assert.match(routes, /\/api\/clippers\/prepare-metricool-mcp-preflight/);
  assert.match(routes, /clippers-metricool-mcp-preflight\.ts/);
  assert.match(routes, /readClipperMetricoolMcpPreflight/);
  const preflightPostRoute = routes.slice(
    routes.indexOf('app.post("/api/clippers/prepare-metricool-mcp-preflight"'),
    routes.indexOf('app.post("/api/clippers/prepare-metricool-mvp-launch-pack"'),
  );
  assert.match(preflightPostRoute, /clippers-goal-completion-audit\.mjs/);
  assert.match(preflightPostRoute, /clippers-tiktok-mvp-go-live-packet\.mjs/);
  assert.ok(
    preflightPostRoute.indexOf("clippers-goal-completion-audit.mjs") < preflightPostRoute.indexOf("clippers-tiktok-mvp-readiness-verifier.mjs"),
  );
  assert.ok(
    preflightPostRoute.indexOf("clippers-tiktok-mvp-go-live-packet.mjs") < preflightPostRoute.indexOf("clippers-tiktok-mvp-readiness-verifier.mjs"),
  );

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-metricool-mcp-preflight-button/);
  assert.match(page, /clippers-metricool-mcp-preflight-panel/);
  assert.match(page, /Metricool MCP Preflight/);
  assert.match(page, /\["\/api\/clippers\/metricool-mcp-preflight"\]/);
  assert.match(page, /metricoolMcpPreflight\?: ClipperMetricoolMcpPreflightSummary/);
  });
});

test("Metricool current batch upload pack stages the 10 TikTok source files", async () => {
  await withFutureCurrentBatchSchedule(async () => {
  const stalePath = path.join(rootDir, "scheduled/metricool-current-batch-upload-pack/99_stale_old_batch.mp4");
  await writeFile(stalePath, Buffer.from("stale"));
  const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "ready_for_metricool_upload");
  assert.equal(output.batchId, "metricool-batch-01");
  assert.equal(output.rows, 10);
  assert.equal(output.copied, 10);
  assert.equal(output.blocked, 0);

  const pack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json"), "utf8"));
  assert.equal(pack.status, "ready_for_metricool_upload");
  assert.equal(pack.batchId, "metricool-batch-01");
  assert.equal(pack.totals.rows, 10);
  assert.equal(pack.totals.copied, 10);
  assert.equal(pack.totals.blocked, 0);
  assert.equal(pack.totals.staleFiles, 0);
  assert.match(pack.paths.uploadDir, /metricool-current-batch-upload-pack$/);
  assert.match(pack.paths.html, /metricool-current-batch-upload-pack\/index\.html$/);
  assert.match(pack.paths.batchEvidenceCsv, /metricool-batch-01-evidence-import\.csv$/);
  assert.match(pack.paths.evidenceChecklistHtml, /clippers-tiktok-evidence-checklist\.html$/);
  assert.match(pack.paths.evidenceChecklistMarkdown, /clippers-tiktok-evidence-checklist\.md$/);
  assert.ok(pack.rows.every((row) => row.status === "ready_to_upload"));
  assert.ok(pack.rows.every((row) => row.uploadFileName.match(/^\d{2}_[a-z0-9-]+_[a-z0-9-]+_[a-z0-9-]+\.mp4$/)));
  assert.ok(pack.rows.every((row) => row.sourcePath.includes("/clippers_workspace/sources/sports/") || row.sourcePath.includes("/clippers_workspace/sources/memes/")));
  assert.ok(pack.guardrails.some((guardrail) => guardrail.includes("Do not treat copied files as scheduled")));
  const stagedFiles = (await readdir(pack.paths.uploadDir)).filter((fileName) => fileName.endsWith(".mp4"));
  assert.equal(stagedFiles.length, 10);
  assert.ok(!stagedFiles.includes("99_stale_old_batch.mp4"));

  for (const row of pack.rows) {
    const copied = await readFile(row.uploadFilePath);
    assert.ok(copied.length > 1024);
    assert.match(copied.subarray(0, 4096).toString("latin1"), /ftyp/);
  }

  const markdown = await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.md"), "utf8");
  assert.match(markdown, /Metricool Current Batch Upload Pack/);
  assert.match(markdown, /Upload folder:/);
  assert.match(markdown, /Evidence checklist:/);
  assert.match(markdown, /Use final_status=scheduled only after Metricool scheduling proof exists/);
  assert.doesNotMatch(markdown, /ready_to_send|autopublish/i);

  const html = await readFile(pack.paths.html, "utf8");
  assert.match(html, /Metricool Current Batch Upload Pack/);
  assert.match(html, /Evidence checklist:/);
  assert.match(html, /clippers-tiktok-evidence-checklist\.html/);
  assert.match(html, /Copy caption/);
  assert.match(html, /Scheduled evidence helper/);
  assert.match(html, /data-copy-scheduled-evidence/);
  assert.match(html, /isMetricoolUrl/);
  assert.match(html, /metricool_approval_url/);
  assert.match(html, /final_status/);
  assert.match(html, /"scheduled"/);
  assert.match(html, /Blocked: use an HTTPS Metricool URL/);
  assert.match(html, /This page is a local upload aid only/);
  assert.equal((html.match(/<video controls/g) || []).length, 10);
  assert.equal((html.match(/<button type="button" data-copy-scheduled-evidence/g) || []).length, 10);
  assert.doesNotMatch(html, /https:\/\/app\.metricool\.com\/\.\.\./);
  assert.doesNotMatch(html, /ready_to_send|autopublish/i);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/metricool-current-batch-upload-pack/);
  assert.match(routes, /\/api\/clippers\/prepare-metricool-current-batch-upload-pack/);
  assert.match(routes, /clippers-metricool-current-batch-upload-pack\.mjs/);
  assert.match(routes, /readClipperMetricoolCurrentBatchUploadPack/);
  assert.match(routes, /already have operator evidence/);
  assert.match(routes, /res\.status\(202\)\.json/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-metricool-current-batch-upload-pack-button/);
  assert.match(page, /clippers-metricool-current-batch-upload-pack-panel/);
  assert.match(page, /Metricool Current Batch Upload Pack/);
  assert.match(page, /Evidence checklist:/);
  assert.match(page, /Console:/);
  assert.match(page, /\["\/api\/clippers\/metricool-current-batch-upload-pack"\]/);
  assert.match(page, /metricoolCurrentBatchUploadPack\?: ClipperMetricoolCurrentBatchUploadPackSummary/);
  });
});

test("Metricool current batch upload pack blocks rerun after operator evidence exists", async () => {
  const evidencePath = path.join(rootDir, "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv");
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const lines = originalEvidence.trimEnd().split(/\r?\n/);
    const firstData = lines[1].split(",");
    firstData[9] = "https://app.metricool.com/planner/test";
    firstData[11] = "scheduled";
    firstData[16] = "Scheduled in Metricool with real operator context and no live URL yet.";
    lines[1] = firstData.join(",");
    await writeFile(evidencePath, `${lines.join("\n")}\n`);
    const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already have operator evidence/);
    const blockedPack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json"), "utf8"));
    assert.equal(blockedPack.status, "blocked");
    assert.equal(blockedPack.totals.copied, 0);
    assert.equal(blockedPack.rows[0].blocker, "operator_evidence_already_exists");
    const blockedHtml = await readFile(blockedPack.paths.html, "utf8");
    assert.match(blockedHtml, /operator_evidence_already_exists/);
    assert.match(blockedHtml, /Scheduled evidence helper unavailable/);
    assert.doesNotMatch(blockedHtml, /<button type="button" data-copy-scheduled-evidence/);
    assert.equal((blockedHtml.match(/<video controls/g) || []).length, 0);
  } finally {
    await writeFile(evidencePath, originalEvidence);
    spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("Metricool current batch upload pack clears stale ready artifacts when preflight is blocked", async () => {
  const preflightPath = path.join(rootDir, "reports/clippers-metricool-mcp-preflight.json");
  const originalPreflight = await readFile(preflightPath, "utf8");
  try {
    const readyResult = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(readyResult.status, 0, readyResult.stderr || readyResult.stdout);

    const preflight = JSON.parse(originalPreflight);
    preflight.status = "blocked";
    await writeFile(preflightPath, JSON.stringify(preflight, null, 2));
    const result = spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /preflight=blocked/);
    const blockedPack = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-metricool-current-batch-upload-pack.json"), "utf8"));
    assert.equal(blockedPack.status, "blocked");
    assert.equal(blockedPack.totals.copied, 0);
    assert.equal(blockedPack.rows[0].blocker, "verifier_or_preflight_not_ready");
    const blockedHtml = await readFile(blockedPack.paths.html, "utf8");
    assert.match(blockedHtml, /verifier_or_preflight_not_ready/);
    assert.match(blockedHtml, /Scheduled evidence helper unavailable/);
    assert.doesNotMatch(blockedHtml, /<button type="button" data-copy-scheduled-evidence/);
    assert.equal((blockedHtml.match(/<video controls/g) || []).length, 0);
    const stagedFiles = (await readdir(blockedPack.paths.uploadDir)).filter((fileName) => fileName.endsWith(".mp4"));
    assert.equal(stagedFiles.length, 0);
  } finally {
    await writeFile(preflightPath, originalPreflight);
    spawnSync(process.execPath, ["script/clippers-metricool-current-batch-upload-pack.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("goal completion audit keeps TikTok MVP honest while external work remains", async () => {
  const result = spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "tiktok_mvp_ready_external_work_remaining");
  assert.ok(output.ready >= 1);
  assert.ok(output.tiktokMvpReady >= 1);
  assert.ok(output.waitingMetricoolWork >= 1);
  assert.ok(output.needsExternalAction >= 1);
  assert.ok(output.deferred >= 1);

  const audit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-goal-completion-audit.json"), "utf8"));
  assert.equal(audit.status, "tiktok_mvp_ready_external_work_remaining");
  assert.equal(audit.fullGoalStatus, "blocked_external_actions");
  assert.equal(audit.operatingMode.publisher, "metricool");
  assert.deepEqual(audit.operatingMode.activePlatforms, ["tiktok"]);
  assert.deepEqual(audit.operatingMode.activeMetricoolBrands, ["SPORT", "memes"]);
  assert.equal(audit.operatingMode.directSocialApisRequired, false);
  assert.equal(audit.operatingMode.realPublishEnabled, false);
  assert.equal(audit.operatingMode.publishMode, "approval_required");
  assert.ok(audit.operatingMode.deferredPlatforms.includes("instagram"));
  assert.ok(audit.operatingMode.deferredPlatforms.includes("youtube"));
  assert.equal(audit.fullGoal.metricoolMvpReady, true);
  assert.ok(audit.fullGoal.externalProofFilesNeedRealEvidence >= 1);
  assert.equal(audit.fullGoal.tiktokExternalCloseoutTasks, 0);
  assert.equal(audit.fullGoal.tiktokExternalDeferredTasks, 4);
  assert.ok(audit.fullGoal.fullReadinessMissing >= 1);
  assert.equal(audit.fullGoal.allPublishedEvidenceReady, false);
  assert.equal(audit.totals.requirements, 11);
  assert.equal(audit.requirements.find((row) => row.id === "tiktok_metricool_mvp_ready")?.status, "ready");
  assert.equal(audit.requirements.find((row) => row.id === "published_urls_and_metrics")?.status, "waiting_metricool_work");
  assert.equal(audit.requirements.find((row) => row.id === "metricool_operator_evidence_import")?.status, "waiting_metricool_work");
  const tiktokExternalRequirement = audit.requirements.find((row) => row.id === "tiktok_external_closeout_session");
  assert.equal(tiktokExternalRequirement?.status, "ready_for_tiktok_mvp");
  assert.match(tiktokExternalRequirement?.evidence || "", /activeTasks 0/);
  assert.match(tiktokExternalRequirement?.evidence || "", /deferredTasks 4/);
  assert.match(tiktokExternalRequirement?.nextAction || "", /direct API\/account expansion stays deferred/);
  assert.match(audit.currentBatchEvidenceCsv, /metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
  const metricoolEvidenceRequirement = audit.requirements.find((row) => row.id === "metricool_operator_evidence_import");
  assert.match(metricoolEvidenceRequirement?.evidence || "", /current batch evidence CSV .*metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
  assert.match(metricoolEvidenceRequirement?.evidence || "", /master sync target .*evidence-drop\/metricool-100-approval-evidence-import\.csv/);
  assert.match(metricoolEvidenceRequirement?.nextAction || "", /fill only the current batch evidence CSV/);
  assert.ok(audit.requirements.some((row) => row.id === "external_proof_files" && row.status === "needs_external_action"));
  assert.ok(audit.guardrails.some((guardrail) => guardrail.includes("realPublishEnabled=false")));
  assert.notEqual(audit.status, "complete");

  const markdown = await readFile(path.join(rootDir, "reports/clippers-goal-completion-audit.md"), "utf8");
  assert.match(markdown, /Full goal status: blocked_external_actions/);
  assert.match(markdown, /External proof files needing evidence:/);
  assert.match(markdown, /TikTok external active closeout tasks: 0/);
  assert.match(markdown, /TikTok external deferred backlog tasks: 4/);
  assert.match(markdown, /TikTok external account\/app\/permission closeout/);
  assert.match(markdown, /Operating mode: metricool \+ tiktok only/);
  assert.match(markdown, /Deferred platforms: instagram, youtube, twitch/);
  assert.match(markdown, /No marca publicaciones sin URL real/);
  assert.match(markdown, /Metricool en approval_required/);
  assert.match(markdown, /current batch evidence CSV .*metricool-100-batch-evidence-imports\/metricool-batch-01-evidence-import\.csv/);
  assert.match(markdown, /fill only the current batch evidence CSV/);
  assert.doesNotMatch(markdown, /paste public TikTok URLs and 24h metrics into the evidence CSV/i);
  assert.doesNotMatch(markdown, /autopublish|ready_to_send/i);

  const csv = await readFile(path.join(rootDir, "reports/clippers-goal-completion-audit.csv"), "utf8");
  assert.match(csv, /requirement_id/);
  assert.match(csv, /published_urls_and_metrics/);
  assert.match(csv, /waiting_metricool_work/);

  const routes = await readFile(path.join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(routes, /\/api\/clippers\/goal-completion-audit/);
  assert.match(routes, /\/api\/clippers\/prepare-goal-completion-audit/);
  assert.match(routes, /script\/clippers-goal-completion-audit\.mjs/);

  const page = await readFile(path.join(process.cwd(), "client/src/pages/clippers.tsx"), "utf8");
  assert.match(page, /prepare-clippers-goal-completion-audit-button/);
  assert.match(page, /clippers-goal-completion-audit-panel/);
  assert.match(page, /clippers-goal-operating-mode/);
  assert.match(page, /TikTok \+ Metricool only/);
  assert.match(page, /Direct APIs:/);
  assert.match(page, /Goal completion audit/);
  assert.match(page, /Full goal/);
  assert.match(page, /La meta completa sigue pendiente/);
  assert.match(page, /tiktokExternalCloseoutTasks/);
});

test("goal completion audit surfaces unsafe Metricool publish mode", async () => {
  const approvalRunPath = path.join(rootDir, "scheduled/metricool-100-approval-run.json");
  const originalApprovalRun = await readFile(approvalRunPath, "utf8");
  try {
    const approvalRun = JSON.parse(originalApprovalRun);
    approvalRun.realPublishEnabled = true;
    approvalRun.totals = {
      ...(approvalRun.totals || {}),
      readyToSend: 1,
    };
    await writeFile(approvalRunPath, JSON.stringify(approvalRun, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const audit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-goal-completion-audit.json"), "utf8"));
    assert.equal(audit.status, "not_ready");
    assert.equal(audit.operatingMode.realPublishEnabled, true);
    assert.equal(audit.operatingMode.publishMode, "unsafe_or_direct");
    assert.match(audit.operatingMode.note, /Alerta/);
    assert.notEqual(audit.requirements.find((row) => row.id === "no_false_publish")?.status, "ready");
  } finally {
    await writeFile(approvalRunPath, originalApprovalRun);
    spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("goal completion audit rejects partial publish evidence and missing readiness counters", async () => {
  const readinessPath = path.join(rootDir, "account-permission-readiness.json");
  const evidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const originalReadiness = await readFile(readinessPath, "utf8");
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const partialEvidence = [
      "metricool_queue_item_id,account_id,account_name,platform,scheduled_for,metricool_approval_url,final_status,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,notes",
      "metricool-001,sports-daily,Sports Daily Clips,tiktok,2026-06-25T12:00:00.000Z,https://app.metricool.com/planner/1,published,https://www.tiktok.com/@sportsdaily/video/123,100,10,2,1,one real row is not enough for a 100 row completion audit",
    ].join("\n") + "\n";
    await writeFile(evidencePath, partialEvidence);
    await writeFile(readinessPath, JSON.stringify({
      activeMvp: {
        status: "ready",
        readyLanes: 2,
        targetLanes: 2,
        platforms: ["tiktok"],
        accountIds: ["sports-daily", "meme-radar"],
      },
      totals: {
        verifiedAccounts: 0,
        accountProfiles: 0,
        directApiReadyLanes: 9,
        developerAppsApproved: 0,
        developerApps: 0,
        permissionGroupsApproved: 0,
        permissionGroups: 0,
      },
      sourceReadiness: {
        connectedMetricoolRightsReadyAssets: 113,
        localOwnedSourceAssets: 0,
      },
      externalCloseout: {
        proofFilesNeedRealEvidence: 0,
      },
      fullReadinessGap: {
        total: 0,
        missing: 0,
      },
      metricoolMvpEvidence: {
        pendingProfileRows: 0,
      },
    }, null, 2));

    const result = spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const audit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-goal-completion-audit.json"), "utf8"));
    assert.equal(audit.requirements.find((row) => row.id === "published_urls_and_metrics")?.status, "waiting_metricool_work");
    assert.equal(audit.requirements.find((row) => row.id === "metricool_operator_evidence_import")?.status, "waiting_metricool_work");
    assert.equal(audit.requirements.find((row) => row.id === "all_accounts_created_verified")?.status, "needs_external_action");
    assert.equal(audit.requirements.find((row) => row.id === "external_proof_files")?.status, "needs_external_action");
    assert.equal(audit.requirements.find((row) => row.id === "all_permissions_added")?.status, "deferred");
    assert.match(audit.requirements.find((row) => row.id === "published_urls_and_metrics")?.evidence || "", /importable 1\/100/);
  } finally {
    await writeFile(readinessPath, originalReadiness);
    await writeFile(evidencePath, originalEvidence);
    spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-tiktok-launch-control.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});

test("goal completion audit rejects non-post TikTok URLs as importable evidence", async () => {
  const evidencePath = path.join(rootDir, "evidence-drop/metricool-100-approval-evidence-import.csv");
  const originalEvidence = await readFile(evidencePath, "utf8");
  try {
    const profileEvidenceRows = [
      "metricool_queue_item_id,account_id,account_name,platform,scheduled_for,metricool_approval_url,final_status,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,notes",
      ...Array.from({ length: 100 }, (_, index) => [
        `metricool-${String(index + 1).padStart(3, "0")}`,
        index % 2 === 0 ? "sports-daily" : "meme-radar",
        index % 2 === 0 ? "Sports Daily Clips" : "Meme Radar",
        "tiktok",
        "2026-06-25T12:00:00.000Z",
        `https://app.metricool.com/planner/${index + 1}`,
        "published",
        index % 4 === 0
          ? "https://www.tiktok.com/@sportsdaily"
          : index % 4 === 1
            ? "https://www.tiktok.com/search?q=sports"
            : index % 4 === 2
              ? "https://www.tiktok.com/t/ZTShortLink/"
              : "http://www.tiktok.com/@sportsdaily/video/7400000000000000099",
        100,
        10,
        2,
        1,
        "bad tiktok URL should not count as importable evidence",
      ].join(",")),
    ].join("\n") + "\n";
    await writeFile(evidencePath, profileEvidenceRows);

    const result = spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const audit = JSON.parse(await readFile(path.join(rootDir, "reports/clippers-goal-completion-audit.json"), "utf8"));
    assert.equal(audit.requirements.find((row) => row.id === "published_urls_and_metrics")?.status, "waiting_metricool_work");
    assert.match(audit.requirements.find((row) => row.id === "published_urls_and_metrics")?.evidence || "", /importable 0\/100/);
  } finally {
    await writeFile(evidencePath, originalEvidence);
    spawnSync(process.execPath, ["script/clippers-goal-completion-audit.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  }
});
