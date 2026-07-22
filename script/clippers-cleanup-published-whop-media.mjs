import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exactTikTokPostPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})\/video\/(\d{8,30})\/?$/i;
export const CANONICAL_CAMPAIGN_ID = "whop-mac-energy-ryan-clavicular-conor-2026-07-22";
export const WHOP_EXPERIENCE_ID = "exp_4f31WKOCZ8uxii";

function isContained(root, candidate, allowRoot = false) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (allowRoot && relative === "")
    || (relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function workspacePath(root, candidate) {
  return path.resolve(root, String(candidate || ""));
}

async function inspectRegularFile(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  if (!isContained(absoluteRoot, absoluteCandidate)) return { path: absoluteCandidate, reason: "path_escape" };

  const relative = path.relative(absoluteRoot, absoluteCandidate);
  let cursor = absoluteRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch(() => null);
    if (!info) return { path: absoluteCandidate, reason: "missing" };
    if (info.isSymbolicLink()) return { path: absoluteCandidate, reason: "symlink" };
  }

  const info = await lstat(absoluteCandidate).catch(() => null);
  if (!info?.isFile()) return { path: absoluteCandidate, reason: info ? "not_regular_file" : "missing" };
  const [rootReal, fileReal] = await Promise.all([realpath(absoluteRoot).catch(() => null), realpath(absoluteCandidate).catch(() => null)]);
  if (!rootReal || !fileReal || !isContained(rootReal, fileReal)) return { path: absoluteCandidate, reason: "path_escape" };
  return { path: absoluteCandidate, reason: null };
}

async function requireRegularFile(root, candidate, label) {
  const inspected = await inspectRegularFile(root, candidate);
  if (inspected.reason) throw new Error(`${label} must be a real local file inside its allowed directory, not a symlink (${inspected.reason}).`);
  return inspected.path;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function localProof(root, proofPath, requiredValues) {
  const evidenceRoot = path.join(root, "evidence-drop");
  const resolved = workspacePath(root, proofPath);
  const inspected = await inspectRegularFile(evidenceRoot, resolved);
  if (inspected.reason) return false;
  const proof = await readFile(inspected.path, "utf8").catch(() => "");
  return proof.length >= 80
    && requiredValues.every((value) => value && proof.includes(String(value)))
    && !/<[^>]+>|placeholder|paste here/i.test(proof);
}

function normalizeAccount(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function clipIdentity(clip) {
  const draftId = String(clip?.id || clip?.draftId || "").trim();
  const draftFilename = path.basename(String(clip?.outputFilename || clip?.targetPath || ""));
  return { draftId, draftFilename };
}

function receiptIdentityMatches(receipt, clip) {
  const expected = clipIdentity(clip);
  const supplied = [
    [receipt?.draftId ?? receipt?.clipId, expected.draftId],
    [receipt?.draftFilename ?? receipt?.outputFilename, expected.draftFilename],
    [receipt?.draftPath ?? receipt?.targetPath, expected.draftFilename, true],
  ].filter(([value]) => String(value || "").trim());
  return supplied.length > 0 && supplied.every(([value, wanted, basename]) => {
    const actual = basename ? path.basename(String(value)) : String(value).trim();
    return Boolean(wanted) && actual === wanted;
  });
}

function candidatePath(root, campaignRoot, value) {
  if (!value) return null;
  if (path.isAbsolute(String(value))) return path.resolve(String(value));
  const workspaceRelative = workspacePath(root, value);
  if (isContained(campaignRoot, workspaceRelative)) return workspaceRelative;
  const campaignRelative = path.resolve(campaignRoot, String(value));
  if (isContained(campaignRoot, campaignRelative)) return campaignRelative;
  return workspaceRelative;
}

function generatedAssetValues(clip) {
  const direct = [clip?.hookPath, clip?.generatedHookPath, clip?.subtitlePath, clip?.subtitlesPath, clip?.generatedSubtitlePath];
  const listed = Array.isArray(clip?.generatedAssetPaths) ? clip.generatedAssetPaths : [];
  const objects = Array.isArray(clip?.generatedAssets)
    ? clip.generatedAssets.map((item) => typeof item === "string" ? item : item?.path)
    : [];
  return [...direct, ...listed, ...objects].filter(Boolean);
}

function isGeneratedHookOrSubtitle(filePath) {
  const parsed = path.parse(String(filePath || ""));
  const stem = parsed.name.toLowerCase();
  const extension = parsed.ext.toLowerCase();
  const hook = /(^|[-_.])hook($|[-_.])/.test(stem) && [".png", ".jpg", ".jpeg", ".webp"].includes(extension);
  const subtitle = /(^|[-_.])(subtitle|subtitles|caption|captions)($|[-_.])/.test(stem) && [".srt", ".vtt", ".ass"].includes(extension);
  return hook || subtitle;
}

async function deletionCandidates(root, campaignRoot, clip) {
  const draftPath = candidatePath(root, campaignRoot, clip?.targetPath || clip?.outputFilename);
  const stem = path.parse(String(clip?.outputFilename || draftPath || "")).name;
  const conventional = stem ? [
    `${stem}-hook.png`,
    `${stem}-subtitles.srt`,
    `${stem}-subtitles.vtt`,
    `${stem}-subtitles.ass`,
  ].map((name) => path.join(campaignRoot, name)) : [];
  const generated = generatedAssetValues(clip)
    .map((value) => candidatePath(root, campaignRoot, value))
    .filter((value) => value && isGeneratedHookOrSubtitle(value));
  const requested = [draftPath, ...generated, ...conventional].filter(Boolean);
  const unique = [...new Set(requested.map((item) => path.resolve(item)))];
  const inspected = [];
  for (const candidate of unique) {
    const result = await inspectRegularFile(campaignRoot, candidate);
    const isDraft = candidate === draftPath;
    if (isDraft && ![".mp4", ".mov", ".m4v", ".webm"].includes(path.extname(candidate).toLowerCase())) {
      inspected.push({ path: candidate, reason: "not_rendered_video", isDraft: true });
      continue;
    }
    if (result.reason === "missing" && !isDraft) continue;
    inspected.push({ ...result, isDraft });
  }
  return inspected;
}

export async function cleanupPublishedWhopMedia({ workspaceRoot, manifestPath, receiptsPath, execute = false }) {
  const root = path.resolve(workspaceRoot);
  const whopDraftsRoot = path.join(root, "drafts", "whop");
  const resolvedManifest = workspacePath(root, manifestPath);
  if (!isContained(whopDraftsRoot, resolvedManifest)) throw new Error("Whop manifest must stay inside the Whop drafts directory.");
  const campaignRoot = path.dirname(resolvedManifest);
  await requireRegularFile(whopDraftsRoot, resolvedManifest, "Whop manifest");

  const resolvedReceipts = workspacePath(root, receiptsPath);
  if (!isContained(campaignRoot, resolvedReceipts)) throw new Error("Whop receipts must stay inside the campaign draft directory.");
  await requireRegularFile(campaignRoot, resolvedReceipts, "Whop receipts");

  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8"));
  const receipts = JSON.parse(await readFile(resolvedReceipts, "utf8"));
  if (!Array.isArray(manifest.clips) || !Array.isArray(receipts)) throw new Error("Invalid Whop draft manifest or publication receipts.");

  const manifestCampaignId = String(manifest.canonicalCampaignId || manifest.localCampaignId || manifest.campaignId || "").trim();
  const manifestExperienceId = String(manifest.whopExperienceId || manifest.experienceId || (manifest.campaignId === WHOP_EXPERIENCE_ID ? manifest.campaignId : "")).trim();
  const configuredAccount = normalizeAccount(manifest.destinationAccount || manifest.account);
  const ledgerPath = path.join(campaignRoot, "cleanup-ledger.jsonl");
  const ledgerInfo = await lstat(ledgerPath).catch(() => null);
  if (ledgerInfo?.isSymbolicLink() || (ledgerInfo && !ledgerInfo.isFile())) {
    throw new Error("Whop cleanup ledger must be a regular local file, not a symlink.");
  }
  const rows = [];
  const identityCounts = new Map();
  for (const clip of manifest.clips) {
    const identity = clipIdentity(clip);
    const key = `${identity.draftId}\u0000${identity.draftFilename}`;
    identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
  }

  for (const clip of manifest.clips) {
    const identity = clipIdentity(clip);
    const identityKey = `${identity.draftId}\u0000${identity.draftFilename}`;
    const matchingReceipts = receipts.filter((receipt) => receiptIdentityMatches(receipt, clip));
    const ambiguousIdentity = identityCounts.get(identityKey) !== 1 || matchingReceipts.length !== 1;
    const receipt = ambiguousIdentity ? null : matchingReceipts[0];
    const publishedPostUrl = String(receipt?.publishedPostUrl || "").trim();
    const postMatch = exactTikTokPostPattern.exec(publishedPostUrl);
    const accountMatches = Boolean(postMatch && configuredAccount && postMatch[1].toLowerCase() === configuredAccount);
    const publishedAtMs = Date.parse(String(receipt?.publishedAt || ""));
    const publicationTimestampReady = Number.isFinite(publishedAtMs) && publishedAtMs <= Date.now();
    const metricoolProofReady = Boolean(receipt && await localProof(root, receipt.metricoolProofPath, ["Metricool", publishedPostUrl]));
    const receiptCampaignMatches = receipt?.campaignId === CANONICAL_CAMPAIGN_ID;
    const receiptExperienceMatches = receipt?.whopExperienceId === WHOP_EXPERIENCE_ID;
    const manifestCampaignMatches = manifestCampaignId === CANONICAL_CAMPAIGN_ID && manifestExperienceId === WHOP_EXPERIENCE_ID;
    const whopProofReady = Boolean(receipt && await localProof(root, receipt.whopSubmissionProofPath, ["Whop", CANONICAL_CAMPAIGN_ID, WHOP_EXPERIENCE_ID, publishedPostUrl]));
    const candidates = await deletionCandidates(root, campaignRoot, clip);
    const unsafeCandidate = candidates.find((candidate) => candidate.reason);
    const draftCandidate = candidates.find((candidate) => candidate.isDraft);
    const actualDraftHash = draftCandidate && !draftCandidate.reason ? await sha256(draftCandidate.path) : null;
    const manifestHashMatches = !clip?.draftSha256 || clip.draftSha256 === actualDraftHash;
    const receiptHashMatches = !receipt?.draftSha256 || receipt.draftSha256 === actualDraftHash;

    const blockers = [
      ambiguousIdentity ? "receipt_draft_identity_mismatch" : null,
      !manifestCampaignMatches ? "manifest_campaign_id_mismatch" : null,
      !receiptCampaignMatches ? "receipt_campaign_id_mismatch" : null,
      !receiptExperienceMatches ? "whop_experience_id_mismatch" : null,
      !postMatch ? "exact_tiktok_url_missing" : null,
      postMatch && !accountMatches ? "tiktok_account_mismatch" : null,
      receipt?.metricoolStatus !== "published" ? "metricool_status_not_published" : null,
      !publicationTimestampReady ? "verified_publication_timestamp_missing" : null,
      !metricoolProofReady ? "metricool_local_proof_missing" : null,
      receipt?.whopSubmissionStatus !== "submitted" ? "whop_status_not_submitted" : null,
      !whopProofReady ? "whop_local_proof_missing" : null,
      unsafeCandidate?.reason === "symlink" ? "symlink_delete_target" : null,
      unsafeCandidate?.reason === "path_escape" ? "delete_target_path_escape" : null,
      unsafeCandidate?.reason && !["symlink", "path_escape"].includes(unsafeCandidate.reason) ? "draft_delete_target_missing_or_invalid" : null,
      !manifestHashMatches ? "draft_hash_mismatch" : null,
      !receiptHashMatches ? "receipt_draft_hash_mismatch" : null,
    ].filter(Boolean);

    if (blockers.length > 0) {
      rows.push({ draftId: identity.draftId, draftFilename: identity.draftFilename, status: "retained_blocked", blockers, deletedPaths: [] });
      continue;
    }

    const targets = candidates.map((candidate) => candidate.path);
    const hashes = Object.fromEntries(await Promise.all(targets.map(async (target) => [target, await sha256(target)])));
    const deletedPaths = [];
    if (execute) {
      const ledgerRecord = {
        campaignId: CANONICAL_CAMPAIGN_ID,
        whopExperienceId: WHOP_EXPERIENCE_ID,
        draftId: identity.draftId,
        draftFilename: identity.draftFilename,
        publishedPostUrl,
        publishedAt: receipt.publishedAt,
        metricoolStatus: receipt.metricoolStatus,
        whopSubmissionStatus: receipt.whopSubmissionStatus,
        hashes,
        authorizedPaths: targets,
      };
      await appendFile(ledgerPath, `${JSON.stringify({ ...ledgerRecord, status: "cleanup_authorized", recordedAt: new Date().toISOString() })}\n`);
      for (const target of targets) {
        const rechecked = await inspectRegularFile(campaignRoot, target);
        if (rechecked.reason || await sha256(target) !== hashes[target]) {
          throw new Error(`Cleanup target changed after verification: ${target}`);
        }
        await unlink(target);
        deletedPaths.push(target);
      }
      await appendFile(ledgerPath, `${JSON.stringify({ ...ledgerRecord, status: "cleanup_completed", deletedPaths, recordedAt: new Date().toISOString() })}\n`);
    }
    rows.push({
      draftId: identity.draftId,
      draftFilename: identity.draftFilename,
      status: execute ? "deleted_after_verified_publish" : "eligible_dry_run",
      blockers: [],
      deletedPaths,
      eligiblePaths: execute ? undefined : targets,
    });
  }

  const deletedPaths = rows.flatMap((row) => row.deletedPaths);
  return {
    status: execute ? "cleanup_completed" : "cleanup_dry_run",
    execute,
    realPublishEnabled: false,
    eligible: rows.filter((row) => ["eligible_dry_run", "deleted_after_verified_publish"].includes(row.status)).length,
    retained: rows.filter((row) => row.status === "retained_blocked").length,
    deletedFiles: deletedPaths.length,
    deletedPaths,
    ledgerPath,
    blockers: [...new Set(rows.flatMap((row) => row.blockers))],
    rows,
  };
}

async function main() {
  const workspaceRoot = path.resolve(process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const manifestPath = path.join(workspaceRoot, "drafts", "whop", "mac-energy-2026-07-22", "draft-manifest.json");
  const receiptsPath = path.join(path.dirname(manifestPath), "publication-receipts.json");
  const result = await cleanupPublishedWhopMedia({
    workspaceRoot,
    manifestPath,
    receiptsPath,
    execute: process.argv.includes("--execute"),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
