import { readFile } from "fs/promises";
import path from "path";
import {
  getClipperStatus,
  recordClipperSourceRights,
} from "../server/clippers-agent";

type OwnedSourceCategory = "sports" | "memes" | "streamers";

interface OwnedSourceRule {
  category: OwnedSourceCategory;
  pattern: RegExp;
  primaryEvidenceFile: string;
  weeklyEvidenceFile: string;
  weeklyStartsAt: number;
  accountLabel: string;
  restrictions: string;
}

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

const rules: OwnedSourceRule[] = [
  {
    category: "sports",
    pattern: /^sports-owned-(\d{2})(?:-\d+)?\.mp4$/,
    primaryEvidenceFile: "owned-sports-production-notes.md",
    weeklyEvidenceFile: "owned-weekly-backlog-production-notes.md",
    weeklyStartsAt: 12,
    accountLabel: "Sports Daily",
    restrictions: "no league footage, broadcast footage, team footage, athlete likenesses, copyrighted music, scraped highlights, or platform-private material",
  },
  {
    category: "memes",
    pattern: /^memes-owned-(\d{2})(?:-\d+)?\.mp4$/,
    primaryEvidenceFile: "owned-meme-production-notes.md",
    weeklyEvidenceFile: "owned-weekly-backlog-production-notes.md",
    weeklyStartsAt: 15,
    accountLabel: "Meme Radar",
    restrictions: "no third-party footage, creator clips, sports broadcasts, streamer clips, licensed music, watermarked reposts, or platform-private material",
  },
  {
    category: "streamers",
    pattern: /^streamers-owned-(\d{2})(?:-\d+)?\.mp4$/,
    primaryEvidenceFile: "owned-streamers-production-notes.md",
    weeklyEvidenceFile: "owned-weekly-backlog-production-notes.md",
    weeklyStartsAt: 10,
    accountLabel: "Streamer Pulse",
    restrictions: "no raw streamer clips, creator likenesses, copyrighted music, cookies, tokens, passwords, private screenshots, or scraped footage",
  },
];

function ruleForAsset(category: string, fileName: string): { rule: OwnedSourceRule; sourceNumber: number } | null {
  const rule = rules.find((item) => item.category === category);
  if (!rule) return null;
  const match = fileName.match(rule.pattern);
  if (!match) return null;
  return { rule, sourceNumber: Number(match[1]) };
}

function evidencePathFor(rule: OwnedSourceRule, sourceNumber: number): string {
  const evidenceFile = sourceNumber >= rule.weeklyStartsAt ? rule.weeklyEvidenceFile : rule.primaryEvidenceFile;
  return path.join(sourceDropDir, rule.category, evidenceFile);
}

function rightsNoteFor(rule: OwnedSourceRule, sourceNumber: number, fileName: string): string {
  const evidencePath = evidencePathFor(rule, sourceNumber);
  return [
    `Owned source generated locally for ${rule.accountLabel};`,
    `owner note path ${evidencePath};`,
    `${rule.restrictions};`,
    `asset ${fileName};`,
    "approved only for draft creation and Metricool approval_required queue review.",
  ].join(" ");
}

async function validateEvidenceFile(rule: OwnedSourceRule, sourceNumber: number): Promise<string | null> {
  const evidencePath = evidencePathFor(rule, sourceNumber);
  const content = await readFile(evidencePath, "utf8").catch(() => "");
  if (!content.trim()) return `${evidencePath} is missing or empty`;
  if (content.trim().length < 120) return `${evidencePath} is too short to prove owned-source restrictions`;
  if (/\b(not owned|not original|not generated|not locally generated|contains third-party|includes third-party|contains copyrighted|includes copyrighted|uses broadcast footage|includes broadcast footage|contains broadcast footage|uses raw streamer|includes raw streamer|contains scraped footage|includes scraped footage)\b/i.test(content)) {
    return `${evidencePath} describes disallowed or non-owned source material`;
  }
  if (!/(status:\s*owned_source|owned source generated locally|original generated|generated locally|created_by:\s*local clippers|source videos are original generated)/i.test(content)) {
    return `${evidencePath} does not describe owned/generated source provenance`;
  }
  if (!/(no third-party|no league footage|no raw streamer|no streamer raw clips|no copyrighted music|no broadcast footage|no scraped footage)/i.test(content)) {
    return `${evidencePath} does not include explicit no-third-party/copyright/raw-footage restrictions`;
  }
  return null;
}

async function main() {
  const status = await getClipperStatus();
  if (status.metricoolExecutionQueue.realPublishEnabled) {
    throw new Error("Metricool realPublishEnabled is true; refusing to record source rights while autopublish may be enabled.");
  }
  const ownedAssets = status.productionQueue.sourceAssets
    .map((asset) => ({ asset, match: ruleForAsset(asset.category, asset.fileName) }))
    .filter((item): item is { asset: typeof status.productionQueue.sourceAssets[number]; match: { rule: OwnedSourceRule; sourceNumber: number } } => Boolean(item.match))
    .sort((left, right) => left.asset.category.localeCompare(right.asset.category) || left.asset.fileName.localeCompare(right.asset.fileName));
  const pendingAssets = ownedAssets.filter(({ asset }) => force || asset.rightsStatus !== "owned_or_permissioned");
  const byCategory = new Map<OwnedSourceCategory, { scanned: number; pending: number; recorded: number }>();
  for (const rule of rules) byCategory.set(rule.category, { scanned: 0, pending: 0, recorded: 0 });

  for (const { asset, match } of ownedAssets) {
    byCategory.get(match.rule.category)!.scanned += 1;
    if (force || asset.rightsStatus !== "owned_or_permissioned") byCategory.get(match.rule.category)!.pending += 1;
  }

  const missingEvidence: string[] = [];
  for (const { asset, match } of pendingAssets) {
    const evidenceProblem = await validateEvidenceFile(match.rule, match.sourceNumber);
    if (evidenceProblem) missingEvidence.push(`${asset.fileName} -> ${evidenceProblem}`);
  }
  if (missingEvidence.length) {
    throw new Error(`Owned source evidence file(s) missing:\n${missingEvidence.join("\n")}`);
  }

  if (!dryRun) {
    for (const { asset, match } of pendingAssets) {
      await recordClipperSourceRights({
        assetId: asset.id,
        rightsStatus: "owned_or_permissioned",
        notes: rightsNoteFor(match.rule, match.sourceNumber, asset.fileName),
      });
      byCategory.get(match.rule.category)!.recorded += 1;
    }
  }

  const refreshed = dryRun ? status : await getClipperStatus();
  const rightsReady = refreshed.productionQueue.sourceAssets
    .filter((asset) => {
      const match = ruleForAsset(asset.category, asset.fileName);
      return match && asset.rightsStatus === "owned_or_permissioned";
    }).length;

  console.log(JSON.stringify({
    dryRun,
    force,
    scanned: ownedAssets.length,
    pending: pendingAssets.length,
    recorded: dryRun ? 0 : pendingAssets.length,
    rightsReady,
    byCategory: Object.fromEntries(byCategory),
    realPublishEnabled: refreshed.metricoolExecutionQueue.realPublishEnabled,
    publishMode: refreshed.metricoolExecutionQueue.publishMode,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
