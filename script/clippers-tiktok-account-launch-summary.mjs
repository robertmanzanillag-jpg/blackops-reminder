import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const accountEvidenceRoot = path.join(workspaceRoot, "account-evidence");
const reportsRoot = path.join(workspaceRoot, "reports");

const accounts = [
  {
    accountId: "sports-daily",
    accountName: "SPORT / Sports Daily",
    category: "sports",
    platform: "tiktok",
    metricoolStatus: "connected_claimed_by_user",
    evidenceFile: "sports-daily-tiktok.json",
    ownedApprovalRows: 42,
  },
  {
    accountId: "meme-radar",
    accountName: "memes / Meme Radar",
    category: "memes",
    platform: "tiktok",
    metricoolStatus: "connected_claimed_by_user",
    evidenceFile: "meme-radar-tiktok.json",
    ownedApprovalRows: 35,
  },
  {
    accountId: "streamer-cuts",
    accountName: "Streamer Cuts",
    category: "streamers",
    platform: "tiktok",
    metricoolStatus: "deferred_until_connected",
    evidenceFile: "streamer-cuts-tiktok.json",
    ownedApprovalRows: 0,
  },
];

function withTimeout(promise, fallback, ms = 1000) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timeout)),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

async function proofStatus(fileName) {
  const filePath = path.join(accountEvidenceRoot, fileName);
  return withTimeout((async () => {
    try {
      const result = await stat(filePath);
      return {
        status: result.isFile() && result.size > 0 ? "proof_file_present" : "proof_file_missing",
        path: path.relative(repoRoot, filePath),
      };
    } catch {
      return {
        status: "proof_file_missing",
        path: path.relative(repoRoot, filePath),
      };
    }
  })(), {
    status: "proof_file_unverified",
    path: path.relative(repoRoot, filePath),
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function renderCsv(rows) {
  const header = [
    "account_id",
    "account_name",
    "category",
    "platform",
    "metricool_status",
    "account_proof_status",
    "owned_approval_rows",
    "launch_gate",
    "next_action",
    "proof_path",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok Account Launch Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    "",
    "## Accounts",
    "",
    "| account | category | status | proof | owned rows | gate | next action |",
    "| --- | --- | --- | --- | ---: | --- | --- |",
    ...summary.rows.map((row) => `| ${row.account_name} | ${row.category} | ${row.metricool_status} | ${row.account_proof_status} | ${row.owned_approval_rows} | ${row.launch_gate} | ${row.next_action.replaceAll("|", "/")} |`),
    "",
    "## Guardrail",
    "",
    "Connected account proof allows owned/generated assets to enter manual Metricool review. It does not approve third-party real clips.",
    "",
  ].join("\n");
}

const rows = [];
for (const account of accounts) {
  const proof = await proofStatus(account.evidenceFile);
  const canReviewOwned = account.metricoolStatus === "connected_claimed_by_user"
    && proof.status === "proof_file_present"
    && account.ownedApprovalRows > 0;
  rows.push({
    account_id: account.accountId,
    account_name: account.accountName,
    category: account.category,
    platform: account.platform,
    metricool_status: account.metricoolStatus,
    account_proof_status: proof.status,
    owned_approval_rows: account.ownedApprovalRows,
    launch_gate: canReviewOwned ? "owned_assets_ready_for_metricool_manual_review" : "blocked_or_deferred",
    next_action: canReviewOwned
      ? "Use metricool-owned-tiktok-approval-pack.csv for manual Metricool review; keep real clips blocked."
      : account.category === "streamers"
        ? "Connect Streamer Cuts TikTok in Metricool and add proof file before adding rows."
        : "Add or verify account evidence before manual Metricool review.",
    proof_path: proof.path,
  });
}

const summary = {
  status: rows.filter((row) => row.launch_gate === "owned_assets_ready_for_metricool_manual_review").length >= 2
    ? "sports_and_memes_tiktok_ready_for_owned_review_streamers_deferred"
    : "blocked_account_proof_missing",
  generatedAt: new Date().toISOString(),
  rows,
};

await mkdir(reportsRoot, { recursive: true });
await writeFile(path.join(reportsRoot, "tiktok-account-launch-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(reportsRoot, "tiktok-account-launch-summary.csv"), renderCsv(rows));
await writeFile(path.join(reportsRoot, "tiktok-account-launch-summary.md"), renderMarkdown(summary));

console.log(JSON.stringify({
  status: summary.status,
  readyOwnedReviewAccounts: rows.filter((row) => row.launch_gate === "owned_assets_ready_for_metricool_manual_review").length,
  rows: rows.length,
  reports: [
    "clippers_workspace/reports/tiktok-account-launch-summary.json",
    "clippers_workspace/reports/tiktok-account-launch-summary.csv",
    "clippers_workspace/reports/tiktok-account-launch-summary.md",
  ],
}, null, 2));
