import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_CAMPAIGN_ID,
  WHOP_EXPERIENCE_ID,
  cleanupPublishedWhopMedia,
} from "../script/clippers-cleanup-published-whop-media.mjs";

async function exists(filePath) {
  return Boolean(await stat(filePath).catch(() => null));
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-whop-cleanup-"));
  const sourceDir = path.join(root, "source-drop", "streamers", "whop-campaign");
  const draftDir = path.join(root, "drafts", "whop", "campaign");
  const evidenceDir = path.join(root, "evidence-drop", "whop");
  await Promise.all([mkdir(sourceDir, { recursive: true }), mkdir(draftDir, { recursive: true }), mkdir(evidenceDir, { recursive: true })]);

  const campaignId = CANONICAL_CAMPAIGN_ID;
  const draftId = "mac-energy-01";
  const sourcePath = path.join(sourceDir, "content-bank-original.mp4");
  const draftPath = path.join(draftDir, `${draftId}.mp4`);
  const hookPath = path.join(draftDir, `${draftId}-hook.png`);
  const subtitlePath = path.join(draftDir, `${draftId}-subtitles.srt`);
  await Promise.all([
    writeFile(sourcePath, "content-bank-source-original"),
    writeFile(draftPath, "rendered-whop-draft"),
    writeFile(hookPath, "generated-hook"),
    writeFile(subtitlePath, "generated-subtitles"),
  ]);

  const manifestPath = path.join(draftDir, "draft-manifest.json");
  const receiptsPath = path.join(draftDir, "publication-receipts.json");
  const metricoolProofPath = path.join(evidenceDir, "metricool.md");
  const whopSubmissionProofPath = path.join(evidenceDir, "whop.md");
  const publishedPostUrl = "https://www.tiktok.com/@streamersclipusa/video/1234567890123456789";
  const manifest = {
    campaignId,
    whopExperienceId: WHOP_EXPERIENCE_ID,
    destinationAccount: "@streamersclipusa",
    realPublishEnabled: false,
    clips: [{ id: draftId, sourcePath, outputFilename: path.basename(draftPath), targetPath: draftPath, hookPath, subtitlePath }],
  };
  const receipt = {
    draftId,
    draftFilename: path.basename(draftPath),
    campaignId,
    whopExperienceId: WHOP_EXPERIENCE_ID,
    publishedPostUrl,
    publishedAt: "2026-07-22T05:00:00.000Z",
    metricoolStatus: "published",
    whopSubmissionStatus: "submitted",
    metricoolProofPath,
    whopSubmissionProofPath,
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(metricoolProofPath, `Metricool publication proof confirms the public campaign post at ${publishedPostUrl}. This local record was captured after publication completed.`);
  await writeFile(whopSubmissionProofPath, `Whop submission proof confirms campaign ${campaignId}, experience ${WHOP_EXPERIENCE_ID}, received the exact public post ${publishedPostUrl}. Submission status was observed locally.`);
  return { root, sourcePath, draftPath, hookPath, subtitlePath, manifestPath, receiptsPath, metricoolProofPath, whopSubmissionProofPath, publishedPostUrl, manifest, receipt };
}

async function run(item, receipt = item.receipt, execute = true) {
  await writeFile(item.receiptsPath, JSON.stringify([receipt]));
  return cleanupPublishedWhopMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath, execute });
}

test("defaults to dry-run and reports eligible paths without deleting media", async () => {
  const item = await fixture();
  await writeFile(item.receiptsPath, JSON.stringify([item.receipt]));
  const result = await cleanupPublishedWhopMedia({
    workspaceRoot: item.root,
    manifestPath: item.manifestPath,
    receiptsPath: item.receiptsPath,
  });
  assert.equal(result.status, "cleanup_dry_run");
  assert.equal(result.execute, false);
  assert.equal(result.realPublishEnabled, false);
  assert.equal(result.eligible, 1);
  assert.equal(result.deletedFiles, 0);
  assert.ok(await exists(item.draftPath));
  assert.ok(await exists(item.hookPath));
  assert.ok(await exists(item.subtitlePath));
});

test("missing local publication and submission proof blocks execute cleanup", async () => {
  const item = await fixture();
  const result = await run(item, {
    ...item.receipt,
    metricoolProofPath: path.join(item.root, "evidence-drop", "missing-metricool.md"),
    whopSubmissionProofPath: path.join(item.root, "evidence-drop", "missing-whop.md"),
  });
  assert.equal(result.retained, 1);
  assert.deepEqual(result.rows[0].blockers.filter((value) => value.includes("proof")), ["metricool_local_proof_missing", "whop_local_proof_missing"]);
  assert.ok(await exists(item.draftPath));
});

test("missing publication timestamp or Whop experience proof blocks cleanup", async () => {
  const item = await fixture();
  const timestampResult = await run(item, { ...item.receipt, publishedAt: "" });
  assert.ok(timestampResult.rows[0].blockers.includes("verified_publication_timestamp_missing"));
  assert.ok(await exists(item.draftPath));

  await writeFile(item.whopSubmissionProofPath, `Whop submission proof confirms campaign ${CANONICAL_CAMPAIGN_ID} received ${item.publishedPostUrl}, but has no experience identifier.`);
  const proofResult = await run(item);
  assert.ok(proofResult.rows[0].blockers.includes("whop_local_proof_missing"));
  assert.ok(await exists(item.draftPath));
});

test("Whop experience ID cannot substitute for the canonical local campaign ID", async () => {
  const item = await fixture();
  const result = await run(item, { ...item.receipt, campaignId: WHOP_EXPERIENCE_ID });
  assert.ok(result.rows[0].blockers.includes("receipt_campaign_id_mismatch"));
  assert.ok(await exists(item.draftPath));
});

test("mismatched TikTok URL, account, and receipt draft identity block cleanup", async () => {
  const item = await fixture();
  const accountResult = await run(item, { ...item.receipt, publishedPostUrl: "https://www.tiktok.com/@anotheraccount/video/1234567890123456789" });
  assert.ok(accountResult.rows[0].blockers.includes("tiktok_account_mismatch"));
  assert.ok(await exists(item.draftPath));

  const urlResult = await run(item, { ...item.receipt, publishedPostUrl: `${item.publishedPostUrl}?tracking=not-exact` });
  assert.ok(urlResult.rows[0].blockers.includes("exact_tiktok_url_missing"));
  assert.ok(await exists(item.draftPath));

  const identityResult = await run(item, { ...item.receipt, draftId: "different-draft" });
  assert.ok(identityResult.rows[0].blockers.includes("receipt_draft_identity_mismatch"));
  assert.ok(await exists(item.draftPath));
});

test("symlinked and escaping delete targets block the entire draft cleanup", async () => {
  const symlinkItem = await fixture();
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "clippers-whop-outside-"));
  const outsideHook = path.join(outsideDir, "outside-hook.png");
  await writeFile(outsideHook, "outside-generated-hook");
  const linkedHook = path.join(path.dirname(symlinkItem.draftPath), "linked-hook.png");
  await symlink(outsideHook, linkedHook);
  symlinkItem.manifest.clips[0].hookPath = linkedHook;
  await writeFile(symlinkItem.manifestPath, JSON.stringify(symlinkItem.manifest));
  const symlinkResult = await run(symlinkItem);
  assert.ok(symlinkResult.rows[0].blockers.includes("symlink_delete_target"));
  assert.ok(await exists(symlinkItem.draftPath));
  assert.ok(await exists(outsideHook));

  const escapeItem = await fixture();
  const outsideSubtitle = path.join(await mkdtemp(path.join(os.tmpdir(), "clippers-whop-escape-")), "outside-subtitles.srt");
  await writeFile(outsideSubtitle, "outside-subtitles");
  escapeItem.manifest.clips[0].subtitlePath = outsideSubtitle;
  await writeFile(escapeItem.manifestPath, JSON.stringify(escapeItem.manifest));
  const escapeResult = await run(escapeItem);
  assert.ok(escapeResult.rows[0].blockers.includes("delete_target_path_escape"));
  assert.ok(await exists(escapeItem.draftPath));
  assert.ok(await exists(outsideSubtitle));
});

test("successful execute cleanup deletes only generated campaign media and preserves source originals", async () => {
  const item = await fixture();
  const result = await run(item);
  assert.equal(result.status, "cleanup_completed");
  assert.equal(result.realPublishEnabled, false);
  assert.equal(result.deletedFiles, 3);
  assert.deepEqual(new Set(result.deletedPaths), new Set([item.draftPath, item.hookPath, item.subtitlePath]));
  assert.equal(await exists(item.draftPath), false);
  assert.equal(await exists(item.hookPath), false);
  assert.equal(await exists(item.subtitlePath), false);
  assert.ok(await exists(item.sourcePath));
  assert.equal(await readFile(item.sourcePath, "utf8"), "content-bank-source-original");
  const ledger = await readFile(result.ledgerPath, "utf8");
  assert.match(ledger, /cleanup_authorized/);
  assert.match(ledger, /cleanup_completed/);
  assert.match(ledger, /1234567890123456789/);
  assert.match(ledger, new RegExp(CANONICAL_CAMPAIGN_ID));
  assert.match(ledger, new RegExp(WHOP_EXPERIENCE_ID));
});
