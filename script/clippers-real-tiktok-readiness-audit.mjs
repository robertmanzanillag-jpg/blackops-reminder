import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const sourceDropRoot = path.join(workspaceRoot, "source-drop");
const evidenceRoot = path.join(workspaceRoot, "evidence-drop", "real-clip-permissions");
const reportsRoot = path.join(workspaceRoot, "reports");

const manifestHeader = [
  "category",
  "title",
  "url",
  "source",
  "platform",
  "target_file_name",
  "rights_status",
  "evidence_link",
  "priority",
  "notes",
];

function withTimeout(promise, fallback, ms = 750) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timeout)),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((value) => value.trim());
  return rows.slice(1).filter((values) => values.some((value) => String(value || "").trim())).map((values) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function renderCsv(rows) {
  const header = [
    "category",
    "target_file_name",
    "title",
    "url_kind",
    "rights_status",
    "evidence_status",
    "source_file_status",
    "metricool_gate",
    "next_action",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function isExactTikTokVideoUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:"
      && /^(?:www\.)?tiktok\.com$/i.test(url.hostname)
      && /^\/@[^/]+\/video\/\d+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function evidenceFilePathFromLink(link) {
  const value = String(link || "").trim();
  if (!value) return "";
  const workspacePrefix = "/clippers-workspace/";
  const ownerNotePrefix = "owner note path: ";
  const normalized = value.startsWith(ownerNotePrefix) ? value.slice(ownerNotePrefix.length).trim() : value;
  if (normalized.startsWith(workspacePrefix)) return path.join(workspaceRoot, normalized.slice(workspacePrefix.length));
  if (path.isAbsolute(normalized) && normalized.startsWith(`${workspaceRoot}${path.sep}`)) return normalized;
  return "";
}

async function existsFile(filePath) {
  if (!filePath) return false;
  return withTimeout((async () => {
    try {
      const result = await stat(filePath);
      return result.isFile() && result.size > 0;
    } catch {
      return false;
    }
  })(), false);
}

async function hasMp4FilePresent(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== ".mp4") return false;
  return withTimeout((async () => {
    try {
      const result = await stat(filePath);
      return result.isFile() && result.size >= 64;
    } catch {
      return false;
    }
  })(), false);
}

async function readManifest(category) {
  const filePath = path.join(sourceDropRoot, category, "source-drop-manifest.csv");
  return withTimeout((async () => {
    try {
      return parseCsv(await readFile(filePath, "utf8"));
    } catch {
      return [];
    }
  })(), [], 30000);
}

async function readEvidenceFiles() {
  return withTimeout((async () => {
    try {
      return (await readdir(evidenceRoot)).filter((name) => name.endsWith(".md"));
    } catch {
      return [];
    }
  })(), []);
}

async function ensureDir(filePath) {
  return withTimeout(mkdir(filePath, { recursive: true }), undefined, 2000);
}

async function writeReport(filePath, contents) {
  return withTimeout(writeFile(filePath, contents), undefined, 2000);
}

function containedSourceFilePath(category, targetFileName) {
  const baseDir = path.join(sourceDropRoot, category);
  const resolved = path.resolve(baseDir, String(targetFileName || ""));
  if (!resolved.startsWith(`${baseDir}${path.sep}`)) return "";
  return resolved;
}

async function buildAudit() {
  const categories = ["sports", "memes", "streamers"];
  const manifests = [];
  for (const category of categories) {
    const rows = await readManifest(category);
    manifests.push(...rows.map((row) => ({ category, ...row })));
  }
  const evidenceFiles = await readEvidenceFiles();
  const rows = [];
  for (const row of manifests.filter((candidate) => String(candidate.platform || "").toLowerCase() === "tiktok")) {
    const category = row.category || "";
    const url = String(row.url || "").trim();
    const urlKind = isExactTikTokVideoUrl(url)
      ? "exact_tiktok_video"
      : url.startsWith("owned-source://")
        ? "owned_generated_asset"
        : "not_exact_tiktok_video";
    const evidencePath = evidenceFilePathFromLink(row.evidence_link);
    const evidenceExists = await existsFile(evidencePath);
    const sourceFilePath = containedSourceFilePath(category, row.target_file_name || "");
    const sourceFileExists = await hasMp4FilePresent(sourceFilePath);
    const rightsStatus = String(row.rights_status || "").trim();
    const realClipRightsApproved = ["owned_or_permissioned", "owned_source"].includes(rightsStatus);
    const ownedAssetRightsApproved = ["owned_or_permissioned", "owned_source", "recreate_only"].includes(rightsStatus);
    let metricoolGate = "blocked";
    let nextAction = "Add exact TikTok URL, permission proof, and local source MP4.";
    if (urlKind === "owned_generated_asset") {
      metricoolGate = sourceFileExists && evidenceExists && ownedAssetRightsApproved ? "approval_queue_candidate_owned_asset" : "blocked_owned_asset_incomplete";
      nextAction = sourceFileExists && evidenceExists ? "Review as owned/generated asset; not a real viral clip." : "Attach owned source file and production notes.";
    } else if (urlKind === "exact_tiktok_video" && realClipRightsApproved && evidenceExists && sourceFileExists) {
      metricoolGate = "approval_queue_candidate_real_clip";
      nextAction = "Ready for Metricool approval queue only; no autopost.";
    } else if (urlKind === "exact_tiktok_video" && rightsStatus === "recreate_only") {
      nextAction = "Recreate-only cannot use the original TikTok clip; attach owned recreated asset instead.";
    } else if (urlKind === "exact_tiktok_video" && !realClipRightsApproved) {
      nextAction = "Request creator/rightsholder permission before source-drop import.";
    } else if (urlKind === "exact_tiktok_video" && !evidenceExists) {
      nextAction = "Attach local permission evidence file.";
    } else if (urlKind === "exact_tiktok_video" && !sourceFileExists) {
      nextAction = "Add local MP4 source file in source-drop.";
    }
    rows.push({
      category,
      target_file_name: row.target_file_name || "",
      title: row.title || "",
      url_kind: urlKind,
      rights_status: rightsStatus || "missing",
      evidence_status: evidenceExists ? "exists" : "missing",
      source_file_status: sourceFileExists ? "exists" : "missing",
      metricool_gate: metricoolGate,
      next_action: nextAction,
    });
  }
  const totals = {
    tiktokRows: rows.length,
    exactRealClipRows: rows.filter((row) => row.url_kind === "exact_tiktok_video").length,
    ownedGeneratedAssetRows: rows.filter((row) => row.url_kind === "owned_generated_asset").length,
    approvalQueueCandidateRealClips: rows.filter((row) => row.metricool_gate === "approval_queue_candidate_real_clip").length,
    approvalQueueCandidateOwnedAssets: rows.filter((row) => row.metricool_gate === "approval_queue_candidate_owned_asset").length,
    blockedRows: rows.filter((row) => row.metricool_gate.startsWith("blocked")).length,
    permissionEvidenceFiles: evidenceFiles.length,
  };
  const status = totals.approvalQueueCandidateRealClips > 0
    ? "real_clips_ready_for_approval_queue"
    : totals.ownedGeneratedAssetRows > 0
      ? "owned_assets_exist_but_real_clips_missing"
      : "blocked_real_clip_intake";
  return {
    status,
    generatedAt: new Date().toISOString(),
    scope: "TikTok only, Metricool approval queue only, no automatic publishing.",
    totals,
    rows,
  };
}

function renderMarkdown(audit) {
  const lines = [
    "# TikTok Real Clip Readiness Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Status: ${audit.status}`,
    `Scope: ${audit.scope}`,
    "",
    "## Totals",
    "",
    ...Object.entries(audit.totals).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Truth",
    "",
    "- `owned_generated_asset` rows are not real viral clips.",
    "- `approval_queue_candidate_real_clip` requires exact TikTok URL, rights proof, evidence file, and local MP4.",
    "- Metricool remains approval queue only; this audit does not publish anything.",
    "",
    "## Rows",
    "",
    "| category | target | url kind | evidence | source file | gate | next action |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...audit.rows.map((row) => `| ${row.category} | ${row.target_file_name} | ${row.url_kind} | ${row.evidence_status} | ${row.source_file_status} | ${row.metricool_gate} | ${row.next_action.replaceAll("|", "/")} |`),
    "",
  ];
  return lines.join("\n");
}

const audit = await buildAudit();
await ensureDir(reportsRoot);
await writeReport(path.join(reportsRoot, "tiktok-real-clip-readiness.json"), `${JSON.stringify(audit, null, 2)}\n`);
await writeReport(path.join(reportsRoot, "tiktok-real-clip-readiness-summary.json"), `${JSON.stringify({
  status: audit.status,
  generatedAt: audit.generatedAt,
  totals: audit.totals,
}, null, 2)}\n`);
await writeReport(path.join(reportsRoot, "tiktok-real-clip-readiness.csv"), renderCsv(audit.rows));
await writeReport(path.join(reportsRoot, "tiktok-real-clip-readiness.md"), renderMarkdown(audit));
console.log(JSON.stringify({
  status: audit.status,
  totals: audit.totals,
  reports: [
    "clippers_workspace/reports/tiktok-real-clip-readiness.json",
    "clippers_workspace/reports/tiktok-real-clip-readiness.csv",
    "clippers_workspace/reports/tiktok-real-clip-readiness.md",
  ],
}, null, 2));
