import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DRIVE_CLIPPERS_MEDIA_FOLDER,
  ensureAppDriveFolderPath,
  ensureDriveFilePublicDownload,
  uploadLocalFileToDriveFolder,
} from "../server/google-drive";
import {
  buildStreamerGrowthCeoPlan,
  resolveAssignmentFinalMediaPath,
  resolveWorkspaceMediaPath,
  validateMetricoolMp4,
  verifyTextEvidence,
} from "./clippers-streamer-growth-ceo.mjs";
import { loadClipperSelectedEnv } from "./clippers-selected-env.mjs";

type Campaign = Record<string, any> & {
  id: string;
  marketplace: string;
  sourceUrl: string;
  rightsEvidencePath: string;
  publicMediaUrls?: Record<string, string>;
  metricoolBlogId?: number;
};

type UploadReceipt = {
  campaignId: string;
  draftFile: string;
  mediaFile: string;
  provider: "google_drive";
  fileId: string;
  mediaUrl: string;
  sha256: string;
  sizeBytes: number;
  uploadedAt: string;
  paidSpendAllowed: false;
};

type UploadDependencies = {
  ensureFolder: (campaignId: string) => Promise<string>;
  uploadFile: (input: { filePath: string; folderId: string; mimeType: string }) => Promise<{ fileId: string }>;
  makePublic: (fileId: string) => Promise<string>;
  verifyPublicUrl: (url: string) => Promise<boolean>;
};

function realValue(value: unknown): string {
  const cleaned = String(value || "").trim();
  if (!cleaned || /^(?:changeme|replace|example|todo|your[-_ ])/i.test(cleaned)) return "";
  return cleaned;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function fileSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function enrichPreparedMedia(workspaceRoot: string, campaigns: Campaign[]) {
  for (const campaign of campaigns) {
    campaign.draftMetadata ||= {};
    for (const draftFile of Array.isArray(campaign.draftFiles) ? campaign.draftFiles : []) {
      const basename = path.basename(draftFile);
      const extension = path.extname(basename);
      const stem = path.basename(basename, extension);
      const metadata = campaign.draftMetadata[basename] ||= {};
      const original = resolveWorkspaceMediaPath(workspaceRoot, draftFile);
      const candidates = [
        { filePath: path.join(path.dirname(original), "subtitled", `${stem}-clean_sentence.mp4`), style: "clean_sentence" },
        { filePath: path.join(path.dirname(original), "subtitled", `${stem}-word_by_word.mp4`), style: "word_by_word" },
        { filePath: original, style: "hook_only" },
      ];
      for (const candidate of candidates) {
        if (await access(candidate.filePath).then(() => true).catch(() => false)) {
          metadata.finalMediaFile = path.relative(workspaceRoot, candidate.filePath);
          metadata.subtitleStyle = candidate.style;
          metadata.requiresTranscript = false;
          metadata.preparationStatus = candidate.style === "hook_only"
            ? "ready_with_campaign_hook"
            : "ready_with_local_subtitles";
          break;
        }
      }
    }
  }
}

export async function verifyPublicMetricoolMediaUrl(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(url, {
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (![200, 206].includes(response.status)) return false;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return contentType.startsWith("video/")
    || contentType.includes("application/octet-stream")
    || contentType.includes("application/mp4");
}

export async function runClipperMetricoolMediaUpload(options: {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: UploadDependencies;
} = {}) {
  const env = options.env || process.env;
  if (env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED !== "true") {
    return { status: "blocked", reason: "explicit_public_media_upload_authorization_required", uploaded: 0 };
  }
  if ((realValue(env.CLIPPERS_PUBLIC_MEDIA_PROVIDER) || "google_drive") !== "google_drive") {
    return { status: "blocked", reason: "unsupported_public_media_provider", uploaded: 0 };
  }
  const expectedBlogId = Number(realValue(env.CLIPPERS_METRICOOL_BLOG_ID));
  if (!Number.isInteger(expectedBlogId) || expectedBlogId <= 0) {
    return { status: "blocked", reason: "metricool_blog_id_missing", uploaded: 0 };
  }

  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const researchDir = path.join(workspaceRoot, "research");
  const reportDir = path.join(workspaceRoot, "reports");
  const campaignsPath = path.join(researchDir, "paid-streamer-campaigns.json");
  const metricsPath = path.join(researchDir, "paid-streamer-campaign-metrics.json");
  const receiptsPath = path.join(reportDir, "metricool-public-media-receipts.json");
  const deliveryLedgerPath = path.join(reportDir, "metricool-autopilot-ledger.json");
  const campaigns = JSON.parse(await readFile(campaignsPath, "utf8").catch(() => "[]")) as Campaign[];
  const metrics = JSON.parse(await readFile(metricsPath, "utf8").catch(() => "[]"));
  const receipts = JSON.parse(await readFile(receiptsPath, "utf8").catch(() => "[]")) as UploadReceipt[];
  const deliveryLedger = JSON.parse(await readFile(deliveryLedgerPath, "utf8").catch(() => "[]"));
  const receiptByDraft = new Map(receipts.map((receipt) => [receipt.draftFile, receipt]));
  const deliveredFiles = new Set((Array.isArray(deliveryLedger) ? deliveryLedger : [])
    .filter((row) => ["scheduled", "published", "verification_pending"].includes(String(row?.status || "").toLowerCase()))
    .map((row) => String(row?.draftFile || "").trim())
    .filter(Boolean));

  await enrichPreparedMedia(workspaceRoot, campaigns);
  for (const campaign of campaigns) {
    campaign.evidenceVerified = await verifyTextEvidence(workspaceRoot, campaign.rightsEvidencePath, [
      campaign.id,
      campaign.marketplace,
      campaign.sourceUrl,
    ]);
  }
  const plan = buildStreamerGrowthCeoPlan({
    campaigns,
    metrics,
    publishingAuthorized: true,
    targetDailyClips: env.CLIPPERS_TARGET_DAILY_CLIPS || 5,
  });
  const dependencies = options.dependencies || {
    ensureFolder: (campaignId) => ensureAppDriveFolderPath([DRIVE_CLIPPERS_MEDIA_FOLDER, campaignId]),
    uploadFile: (input) => uploadLocalFileToDriveFolder(input),
    makePublic: (fileId) => ensureDriveFilePublicDownload({ fileId }),
    verifyPublicUrl: (url) => verifyPublicMetricoolMediaUrl(url),
  };
  const uploaded: UploadReceipt[] = [];
  let skippedDelivered = 0;
  const blocked: Array<{ campaignId: string; draftFile: string | null; reason: string }> = [];

  for (const decision of plan.decisions) {
    const campaign = campaigns.find((row) => row.id === decision.campaignId);
    if (!campaign || !decision.canProduce) {
      blocked.push({
        campaignId: decision.campaignId,
        draftFile: null,
        reason: decision.productionBlockers?.[0] || "campaign_not_eligible",
      });
      continue;
    }
    campaign.publicMediaUrls ||= {};
    campaign.metricoolBlogId = expectedBlogId;
    const folderId = await dependencies.ensureFolder(campaign.id);
    for (const assignment of decision.assignments || []) {
      const draftFile = String(assignment.draftFile || "").trim();
      if (!draftFile) continue;
      if (deliveredFiles.has(draftFile) || deliveredFiles.has(String(assignment.finalMediaFile || "").trim())) {
        skippedDelivered += 1;
        continue;
      }
      const mediaPath = resolveAssignmentFinalMediaPath(workspaceRoot, assignment);
      const validated = await validateMetricoolMp4(workspaceRoot, mediaPath);
      if (!validated) {
        blocked.push({ campaignId: campaign.id, draftFile, reason: "validated_mp4_missing" });
        continue;
      }
      const fileInfo = await stat(validated);
      const sha256 = await fileSha256(validated);
      const mediaFile = path.relative(workspaceRoot, validated);
      const existing = receiptByDraft.get(draftFile);
      if (existing?.sha256 === sha256 && /^https:\/\//i.test(existing.mediaUrl)) {
        let mediaUrl = existing.mediaUrl;
        let reachable = await dependencies.verifyPublicUrl(mediaUrl);
        if (!reachable) {
          mediaUrl = await dependencies.makePublic(existing.fileId);
          reachable = await dependencies.verifyPublicUrl(mediaUrl);
        }
        if (reachable) {
          existing.provider = "google_drive";
          existing.mediaFile = mediaFile;
          existing.sizeBytes = fileInfo.size;
          existing.mediaUrl = mediaUrl;
          receiptByDraft.set(draftFile, existing);
          campaign.publicMediaUrls[draftFile] = mediaUrl;
          campaign.publicMediaUrls[path.basename(draftFile)] = mediaUrl;
          continue;
        }
      }
      const upload = await dependencies.uploadFile({
        filePath: validated,
        folderId,
        mimeType: "video/mp4",
      });
      const mediaUrl = await dependencies.makePublic(upload.fileId);
      if (!await dependencies.verifyPublicUrl(mediaUrl)) {
        blocked.push({ campaignId: campaign.id, draftFile, reason: "public_media_url_unreachable" });
        continue;
      }
      const receipt: UploadReceipt = {
        campaignId: campaign.id,
        draftFile,
        mediaFile,
        provider: "google_drive",
        fileId: upload.fileId,
        mediaUrl,
        sha256,
        sizeBytes: fileInfo.size,
        uploadedAt: new Date().toISOString(),
        paidSpendAllowed: false,
      };
      receiptByDraft.set(draftFile, receipt);
      uploaded.push(receipt);
      campaign.publicMediaUrls[draftFile] = mediaUrl;
      campaign.publicMediaUrls[path.basename(draftFile)] = mediaUrl;
      await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
      await writeJsonAtomic(campaignsPath, campaigns);
    }
  }
  await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
  await writeJsonAtomic(campaignsPath, campaigns);
  return {
    status: blocked.length ? (uploaded.length ? "partial" : "blocked") : "completed",
    provider: "google_drive",
    uploaded: uploaded.length,
    reused: [...receiptByDraft.values()].length - uploaded.length,
    skippedDelivered,
    blocked,
    paidSpendAllowed: false,
    receiptsPath,
  };
}

async function main() {
  loadClipperSelectedEnv(process.env.CLIPPERS_CONFIG_ROOT || process.cwd());
  const result = await runClipperMetricoolMediaUpload();
  console.log(JSON.stringify(result, null, 2));
  if (!["completed", "partial"].includes(result.status)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
