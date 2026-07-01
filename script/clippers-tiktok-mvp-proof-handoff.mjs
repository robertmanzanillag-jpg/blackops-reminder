import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "proof-handoff.json");
const outMarkdownPath = path.join(reportsDir, "proof-handoff.md");
const outCollectionCsvPath = path.join(reportsDir, "proof-handoff-collection-packets.csv");
const outPastePacketPath = path.join(reportsDir, "proof-links-paste-packet.txt");
const outJsonStarterPath = path.join(reportsDir, "proof-links-json-starter.json");
const outUnblockBoardCsvPath = path.join(reportsDir, "proof-unblock-board.csv");
const outOneScreenPath = path.join(reportsDir, "proof-fill-one-screen.txt");

const lanes = [
  {
    key: "sports-daily:tiktok",
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdaily",
    profileUrl: "https://www.tiktok.com/@sportsdaily",
    metricoolBrandName: "SPORT",
  },
  {
    key: "meme-radar:tiktok",
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradar",
    profileUrl: "https://www.tiktok.com/@memeradar",
    metricoolBrandName: "memes",
  },
];

function runJson(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    return {
      ok: false,
      status: result.status,
      error: result.stderr || result.stdout || "Command returned no JSON output.",
    };
  }
  try {
    return {
      ok: true,
      data: JSON.parse(result.stdout),
    };
  } catch {
    return {
      ok: false,
      status: result.status,
      error: "Command returned invalid JSON output.",
    };
  }
}

async function readJson(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshGeneratedAt(value, maxAgeMs = 6 * 60 * 60 * 1000) {
  const parsed = timestampMs(value);
  if (!parsed) return false;
  const ageMs = Date.now() - parsed;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function isQuickFillCurrentWithProofRefresh(quickFill = {}, proofRefresh = {}) {
  const quickFillGeneratedAt = timestampMs(quickFill.generatedAt);
  const proofRefreshGeneratedAt = timestampMs(proofRefresh.generatedAt);
  const quickFillIssues = Array.isArray(quickFill.issues) ? quickFill.issues : null;
  return Boolean(
    quickFill.appliedToIntake === true
    && quickFill.status === "applied_to_combined_intake"
    && quickFillIssues
    && quickFillIssues.length === 0
    && isFreshGeneratedAt(quickFill.generatedAt)
    && isFreshGeneratedAt(proofRefresh.generatedAt)
    && quickFillGeneratedAt
    && proofRefreshGeneratedAt
    && quickFill.proofRefreshStatus === proofRefresh.status
  );
}

function decisionFromArtifacts({ proofDrop, quickFill, importPreview, closeout, wizard }) {
  if (!proofDrop?.readyForQuickFill) {
    return {
      status: "blocked_needs_proof_links",
      nextButton: "save_proof_links",
      nextAction: proofDrop?.nextStep || "Paste the two real SPORT/memes Metricool proof URLs, or separate ownership plus Metricool URLs, then save proof links.",
    };
  }
  if (!quickFill?.currentWithProofRefresh) {
    return {
      status: "blocked_needs_quick_fill",
      nextButton: "quick_fill",
      nextAction: quickFill?.nextStep || "Run Quick fill after proof links pass validation, then rerun Proof handoff so the report matches current Proof refresh.",
    };
  }
  if (importPreview?.status !== "ready_to_apply" && importPreview?.status !== "applied") {
    return {
      status: "blocked_needs_import_preview",
      nextButton: "import_preview",
      nextAction: importPreview?.nextStep || "Run Import preview and fix any generated proof intake blockers.",
    };
  }
  if (closeout?.status !== "ready_to_apply" && closeout?.status !== "applied") {
    return {
      status: "blocked_needs_closeout_preview",
      nextButton: "preview_closeout",
      nextAction: closeout?.nextStep || "Run closeout preview and fix any rejected TikTok/Metricool evidence rows.",
    };
  }
  if (wizard?.status === "ready_for_operator_apply_review") {
    return {
      status: "ready_for_operator_apply_review",
      nextButton: "operator_confirmed_apply",
      nextAction: "Operator can apply the validated import/closeout only after manually confirming all proof URLs are real and non-secret. Metricool remains approval_required.",
    };
  }
  return {
    status: "review_required",
    nextButton: "closeout_wizard",
    nextAction: wizard?.nextStep || "Run Closeout wizard to confirm the next safe operator step.",
  };
}

function laneProofState(proofDrop, lane) {
  return (proofDrop?.lanes || []).find((item) => item.key === lane.key) || {};
}

function buildCollectionPackets(proofDrop) {
  return lanes.flatMap((lane) => {
    const state = laneProofState(proofDrop, lane);
    return [
      {
        id: `${lane.accountId}-account-ownership`,
        lane: lane.key,
        accountId: lane.accountId,
        accountName: lane.accountName,
        platform: lane.platform,
        handle: lane.handle,
        field: "accountOwnershipProofUrl",
        status: state.accountProofReady && state.accountNotesReady ? "ready" : "needed",
        proofUrlRule: "Real safe HTTPS URL; no passwords, tokens, cookies, recovery codes, signed/temporary URLs, x-amz/signature/expires query params, or private keys.",
        acceptedProof: [
          `Public/non-secret proof that Robert controls ${lane.handle}.`,
          "Ownership or security screen/ticket stored as a non-secret Drive/doc URL.",
          `Fast path: the same Metricool/Drive proof can be used here if it clearly shows ${lane.metricoolBrandName} connected to ${lane.handle} under Robert control.`,
          "Notes must be 20+ characters and mention ownership/security verification.",
        ],
        rejectIf: [
          "The URL is a placeholder, example.com, search result, password-protected link, or contains credentials.",
          "The proof exposes tokens, cookies, recovery codes, private screenshots, API keys, signed URLs, or temporary query params.",
        ],
        copyPrompt: `Collect ${lane.accountName} TikTok ownership proof for ${lane.handle}. Paste only a real non-secret HTTPS proof URL into accountOwnershipProofUrl and keep accountNotes at 20+ characters.`,
      },
      {
        id: `${lane.accountId}-metricool-connection`,
        lane: lane.key,
        accountId: lane.accountId,
        accountName: lane.accountName,
        platform: lane.platform,
        handle: lane.handle,
        field: "metricoolConnectionProofUrl",
        status: state.metricoolProofReady && state.metricoolNotesReady ? "ready" : "needed",
        proofUrlRule: "Must be a real HTTPS metricool.com URL or Google Drive/Docs evidence URL; no passwords, tokens, cookies, recovery codes, signed/temporary URLs, x-amz/signature/expires query params, or private keys.",
        acceptedProof: [
          `Metricool brand/profile ${lane.metricoolBrandName} shows TikTok connected to ${lane.handle}.`,
          "Metricool planner/profile proof URL that does not expose secret account data.",
          "Notes must be 20+ characters and mention Metricool connection proof.",
        ],
        rejectIf: [
          "The URL is not on metricool.com or Google Drive/Docs.",
          "The proof is a placeholder, private credential page, screenshot with secrets, signed URL, temporary URL, or contains auth material.",
        ],
        copyPrompt: `Collect Metricool connection proof for ${lane.metricoolBrandName} -> ${lane.handle}. Paste only a real HTTPS metricool.com proof URL or Google Drive/Docs evidence URL into metricoolConnectionProofUrl and keep metricoolNotes at 20+ characters.`,
      },
    ];
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function renderCollectionCsv(packets) {
  const header = [
    "id",
    "lane",
    "account_id",
    "account_name",
    "platform",
    "handle",
    "field",
    "status",
    "proof_url_rule",
    "accepted_proof",
    "reject_if",
    "copy_prompt",
  ];
  return [
    header.join(","),
    ...packets.map((packet) => [
      packet.id,
      packet.lane,
      packet.accountId,
      packet.accountName,
      packet.platform,
      packet.handle,
      packet.field,
      packet.status,
      packet.proofUrlRule,
      packet.acceptedProof.join(" | "),
      packet.rejectIf.join(" | "),
      packet.copyPrompt,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function buildUnblockBoard(collectionPackets, gates, goLivePacket = {}) {
  const blockedGates = gates.filter((gate) => gate.status !== "pass").map((gate) => gate.id);
  const missingPackets = collectionPackets.filter((packet) => packet.status !== "ready");
  const missingMetricoolPackets = missingPackets.filter((packet) => packet.field === "metricoolConnectionProofUrl");
  const missingAccountPackets = missingPackets.filter((packet) => packet.field === "accountOwnershipProofUrl");
  const fastPathAvailable = missingPackets.length > 0
    && missingAccountPackets.length === missingMetricoolPackets.length
    && missingMetricoolPackets.length > 0;
  const minimumProofUrlsNeeded = fastPathAvailable ? missingMetricoolPackets.length : missingPackets.length;
  const metricool100 = goLivePacket?.metricool100 || {};
  const metricoolTotals = goLivePacket?.totals || {};
  const sourceReadyBatches = Number(metricool100.sourceReadyBatches ?? metricoolTotals.metricool100SourceReadyBatches ?? 0);
  const readyBatches = Number(metricool100.readyBatches ?? metricoolTotals.metricool100ReadyBatches ?? 0);
  const blockedBatches = Number(metricool100.blockedBatches ?? metricoolTotals.metricool100BlockedBatches ?? 0);
  const rowsCount = Number(metricool100.rows ?? metricoolTotals.metricool100Rows ?? 0);
  const rows = missingPackets.map((packet, index) => {
    const linePrefix = `${packet.lane}.${packet.field}=`;
    return {
      id: packet.id,
      priority: index + 1,
      lane: packet.lane,
      accountName: packet.accountName,
      handle: packet.handle,
      field: packet.field,
      exactPasteLine: linePrefix,
      status: packet.status,
      proofUrlRule: packet.proofUrlRule,
      acceptedProof: packet.acceptedProof,
      rejectIf: packet.rejectIf,
      unlocks: packet.field === "metricoolConnectionProofUrl"
        ? ["Metricool bridge evidence preview", "TikTok MVP readiness verifier account gate"]
        : ["Account ownership evidence preview", "TikTok MVP proof drop quick-fill"],
      operatorAction: packet.copyPrompt,
    };
  });
  const readyRows = collectionPackets.filter((packet) => packet.status === "ready").length;
  return {
    status: rows.length ? "blocked_needs_operator_proof" : "ready_for_proof_drop",
    generatedAt: new Date().toISOString(),
    missingProofs: rows.length,
    minimumProofUrlsNeeded,
    fastPathAvailable,
    readyProofs: readyRows,
    totalProofs: collectionPackets.length,
    blockedGates,
    rows,
    impact: {
      metricool100Rows: rowsCount,
      metricool100SourceReadyBatches: sourceReadyBatches,
      metricool100OperatorReadyBatches: readyBatches,
      metricool100BlockedBatches: blockedBatches,
      note: rows.length
        ? `${rowsCount || "TikTok"} rows are source-ready, but Metricool approval queue stays blocked until ${minimumProofUrlsNeeded} real proof URL(s) are validated.`
        : "All proof links are present; run the proof drop/import preview before any operator apply step.",
    },
    nextAction: rows.length
      ? "Fast path: paste one real Metricool/Drive proof URL per active TikTok lane; the app can reuse it as ownership/control proof when it clearly shows the connected profile. Preview, then save only if validation stays clean."
      : "Run Proof drop and Import preview; Metricool still stays approval_required.",
    guardrails: [
      "Do not paste passwords, tokens, cookies, recovery codes, client secrets, API keys, signed URLs, or private screenshots.",
      "Do not use search/explore/example/placeholder URLs as proof.",
      "Metricool connection proof must be a real HTTPS metricool.com URL or Google Drive/Docs evidence URL.",
      "This board does not apply evidence, schedule posts, publish, or enable direct social APIs.",
    ],
  };
}

function renderUnblockBoardCsv(board) {
  const header = [
    "priority",
    "id",
    "lane",
    "account_name",
    "handle",
    "field",
    "status",
    "exact_paste_line",
    "proof_url_rule",
    "unlocks",
    "operator_action",
  ];
  return [
    header.join(","),
    ...board.rows.map((row) => [
      row.priority,
      row.id,
      row.lane,
      row.accountName,
      row.handle,
      row.field,
      row.status,
      row.exactPasteLine,
      row.proofUrlRule,
      row.unlocks.join(" | "),
      row.operatorAction,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function renderProofLinksPastePacket() {
  return [
    "# TikTok MVP proof-links paste packet",
    "# Fill only real non-secret HTTPS proof URLs. Do not paste passwords, tokens, cookies, recovery codes, signed/temporary URLs, or screenshots with secrets.",
    "# Metricool proof URLs must be https://*.metricool.com/... or Google Drive/Docs evidence URLs",
    "# Fast path: if the Metricool/Drive proof clearly shows the TikTok profile connected under Robert control, you may fill only metricoolConnectionProofUrl and the app will reuse it as ownership/control proof.",
    "",
    ...lanes.flatMap((lane) => [
      `${lane.key}.accountOwnershipProofUrl=`,
      `${lane.key}.metricoolConnectionProofUrl=`,
      `${lane.key}.accountNotes=${lane.accountName} TikTok ownership and 2FA/security proof verified by Robert without secrets.`,
      `${lane.key}.metricoolNotes=${lane.metricoolBrandName} Metricool connection to ${lane.handle} verified by Robert without secrets.`,
      "",
    ]),
  ].join("\n");
}

function buildProofLinksJsonStarter() {
  return {
    lanes: Object.fromEntries(lanes.map((lane) => [lane.key, {
      accountOwnershipProofUrl: "",
      metricoolConnectionProofUrl: "",
      accountNotes: `${lane.accountName} TikTok ownership and 2FA/security proof verified by Robert without secrets.`,
      metricoolNotes: `${lane.metricoolBrandName} Metricool connection to ${lane.handle} verified by Robert without secrets.`,
    }])),
  };
}

function renderOneScreenProofFill(summary) {
  const rows = summary.unblockBoard.rows.length ? summary.unblockBoard.rows : buildUnblockBoard(summary.collectionPackets, summary.gates).rows;
  return [
    "TikTok MVP proof fill - one screen",
    "",
    "Fill these exact lines with real non-secret HTTPS proof URLs:",
    `Minimum real proof URLs needed: ${summary.unblockBoard.minimumProofUrlsNeeded}`,
    `Fast path available: ${summary.unblockBoard.fastPathAvailable}`,
    "",
    ...rows.map((row) => `${row.priority}. ${row.exactPasteLine}    # ${row.accountName} / ${row.field}`),
    "",
    "Required:",
    "- Account ownership proof can be a safe HTTPS Drive/doc/proof URL showing account ownership/security review.",
    "- Metricool connection proof must be a real HTTPS metricool.com URL or Google Drive/Docs evidence URL showing the TikTok profile connected in Metricool.",
    "- Fast path: if the Metricool/Drive proof clearly shows the TikTok profile connected under Robert control, fill the metricoolConnectionProofUrl line and the app can reuse it as ownership/control proof.",
    "- Notes already exist in the paste packet; keep them concrete and 20+ characters.",
    "",
    "Never paste:",
    "- passwords, cookies, access tokens, refresh tokens, recovery codes, client secrets, API keys, signed URLs, temporary URLs, or private screenshots.",
    "- search/explore/example/placeholder URLs.",
    "",
    `Paste packet: ${summary.paths.pastePacketTxt}`,
    `Unblock board CSV: ${summary.paths.unblockBoardCsv}`,
    `Next safe button: ${summary.nextButton}`,
    `Next action: ${summary.nextAction}`,
    "",
    "This file does not apply evidence, schedule posts, publish, or enable direct social APIs.",
    "",
  ].join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Handoff",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Next button: ${summary.nextButton}`,
    "",
    "## Decision",
    "",
    summary.nextAction,
    "",
    "## Gates",
    "",
    ...summary.gates.map((gate) => `- ${gate.id}: ${gate.status} - ${gate.detail}`),
    "",
    "## Collection Packets",
    "",
    ...summary.collectionPackets.map((packet) => [
      `### ${packet.accountName} / ${packet.field}`,
      `- Status: ${packet.status}`,
      `- Rule: ${packet.proofUrlRule}`,
      `- Copy: ${packet.copyPrompt}`,
      "",
    ].join("\n")),
    "## Unblock Board",
    "",
    `- Missing proofs: ${summary.unblockBoard.missingProofs}/${summary.unblockBoard.totalProofs}`,
    `- Minimum real proof URLs needed: ${summary.unblockBoard.minimumProofUrlsNeeded}`,
    `- Fast path available: ${summary.unblockBoard.fastPathAvailable}`,
    `- Quick fill current: ${summary.proofState.quickFillCurrent}`,
    `- Proof refresh fresh: ${summary.proofState.proofRefreshFresh}`,
    `- Source-ready batches: ${summary.unblockBoard.impact.metricool100SourceReadyBatches}`,
    `- Operator-ready batches: ${summary.unblockBoard.impact.metricool100OperatorReadyBatches}`,
    `- Board CSV: ${summary.paths.unblockBoardCsv}`,
    "",
    ...summary.unblockBoard.rows.map((row) => [
      `### ${row.accountName} / ${row.field}`,
      `- Paste line: \`${row.exactPasteLine}\``,
      `- Rule: ${row.proofUrlRule}`,
      `- Unlocks: ${row.unlocks.join(", ")}`,
      "",
    ].join("\n")),
    "## Paste Packet",
    "",
    `- Proof links paste packet: ${summary.paths.pastePacketTxt}`,
    `- Proof links JSON starter: ${summary.paths.jsonStarter}`,
    `- One-screen fill guide: ${summary.paths.oneScreenTxt}`,
    "- Use either the paste packet or JSON starter after filling real proof URLs.",
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const proofDropRun = runJson(["script/clippers-tiktok-mvp-proof-drop-kit.mjs"]);
  const importPreviewRun = runJson(["script/clippers-tiktok-mvp-proof-intake-import.mjs"]);
  const wizardRun = runJson(["script/clippers-tiktok-mvp-closeout-wizard.mjs"]);
  const proofDrop = await readJson(path.join(reportsDir, "proof-drop-kit.json"), {});
  const quickFill = await readJson(path.join(reportsDir, "proof-quick-fill.json"), {});
  const proofRefresh = await readJson(path.join(reportsDir, "proof-refresh.json"), {});
  const importPreview = await readJson(path.join(reportsDir, "proof-intake-import.json"), {});
  const closeout = await readJson(path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json"), {});
  const wizard = await readJson(path.join(reportsDir, "closeout-wizard.json"), {});
  const goLivePacket = await readJson(path.join(rootDir, "reports", "clippers-tiktok-mvp-go-live-packet.json"), {});
  const quickFillCurrent = isQuickFillCurrentWithProofRefresh(quickFill, proofRefresh);
  const quickFillIssuesValid = Array.isArray(quickFill?.issues);
  const quickFillIssues = quickFillIssuesValid ? quickFill.issues.length : 1;
  const proofRefreshFresh = isFreshGeneratedAt(proofRefresh?.generatedAt);
  const quickFillForDecision = {
    ...quickFill,
    currentWithProofRefresh: quickFillCurrent,
    nextStep: quickFillCurrent
      ? quickFill?.nextStep
      : "Quick fill is stale, malformed, or missing against current Proof refresh; rerun Quick fill with real non-secret proof before trusting this handoff.",
  };
  const decision = decisionFromArtifacts({ proofDrop, quickFill: quickFillForDecision, importPreview, closeout, wizard });
  const collectionPackets = buildCollectionPackets(proofDrop);
  const gates = [
    {
      id: "proof_links",
      status: proofDrop?.readyForQuickFill ? "pass" : "blocked",
      detail: `${proofDrop?.lanes?.filter((lane) => lane.readyForQuickFill).length || 0}/${proofDrop?.lanes?.length || 2} lanes have real proof links.`,
    },
    {
      id: "quick_fill",
      status: quickFillCurrent ? "pass" : "blocked",
      detail: quickFillIssuesValid
        ? `${quickFillIssues} quick-fill issues; currentWithProofRefresh=${quickFillCurrent}; proofRefreshStatus=${quickFill?.proofRefreshStatus || "missing"}; currentProofRefresh=${proofRefresh?.status || "missing"}.`
        : "Quick-fill issues report is malformed; rerun Quick fill with real non-secret proof before trusting this handoff.",
    },
    {
      id: "import_preview",
      status: importPreview?.status === "ready_to_apply" || importPreview?.status === "applied" ? "pass" : "blocked",
      detail: `status=${importPreview?.status || "not_run"}, fixQueue=${Array.isArray(importPreview?.fixQueue) ? importPreview.fixQueue.length : 0}.`,
    },
    {
      id: "closeout_preview",
      status: closeout?.status === "ready_to_apply" || closeout?.status === "applied" ? "pass" : "blocked",
      detail: `status=${closeout?.status || "not_run"}, ready=${closeout?.totals?.ready || 0}/${closeout?.totals?.lanes || 2}.`,
    },
    {
      id: "safety",
      status: "pass",
      detail: "This handoff did not apply evidence, publish, schedule, or enable direct social APIs.",
    },
  ];
  const unblockBoard = buildUnblockBoard(collectionPackets, gates, goLivePacket);
  const summary = {
    ...decision,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    runs: {
      proofDropRun,
      importPreviewRun,
      wizardRun,
    },
    proofState: {
      quickFillCurrent,
      quickFillIssues,
      quickFillIssuesValid,
      proofRefreshStatus: proofRefresh?.status || "missing",
      proofRefreshFresh,
      proofRefreshGeneratedAt: proofRefresh?.generatedAt || "missing",
    },
    gates,
    collectionPackets,
    unblockBoard,
    pastePacketText: renderProofLinksPastePacket(),
    jsonStarter: buildProofLinksJsonStarter(),
    totals: {
      proofIssues: Array.isArray(proofDrop?.issues) ? proofDrop.issues.length : 0,
      quickFillIssues,
      quickFillCurrent,
      proofRefreshFresh,
      importFixes: Array.isArray(importPreview?.fixQueue) ? importPreview.fixQueue.length : 0,
      closeoutRejected: Number(closeout?.totals?.rejected || 0),
      proofPacketsNeeded: collectionPackets.filter((packet) => packet.status !== "ready").length,
      minimumProofUrlsNeeded: unblockBoard.minimumProofUrlsNeeded,
      fastPathAvailable: unblockBoard.fastPathAvailable,
    },
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      collectionCsv: outCollectionCsvPath,
      pastePacketTxt: outPastePacketPath,
      jsonStarter: outJsonStarterPath,
      oneScreenTxt: outOneScreenPath,
      unblockBoardCsv: outUnblockBoardCsvPath,
      proofDropJson: path.join(reportsDir, "proof-drop-kit.json"),
      quickFillJson: path.join(reportsDir, "proof-quick-fill.json"),
      proofRefreshJson: path.join(reportsDir, "proof-refresh.json"),
      importJson: path.join(reportsDir, "proof-intake-import.json"),
      closeoutJson: path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json"),
      wizardJson: path.join(reportsDir, "closeout-wizard.json"),
    },
    guardrails: [
      "Proof handoff only refreshes proof drop, quick fill, import preview, and wizard reports.",
      "Proof handoff never applies evidence, publishes, schedules, or enables direct social APIs.",
      "Metricool remains approval_required and realPublishEnabled remains false.",
      "Operator must verify proof URLs are real and non-secret before any apply step.",
    ],
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCollectionCsvPath, renderCollectionCsv(summary.collectionPackets));
  await writeFile(outPastePacketPath, renderProofLinksPastePacket());
  await writeFile(outJsonStarterPath, `${JSON.stringify(summary.jsonStarter, null, 2)}\n`);
  await writeFile(outOneScreenPath, renderOneScreenProofFill(summary));
  await writeFile(outUnblockBoardCsvPath, renderUnblockBoardCsv(summary.unblockBoard));
  console.log(JSON.stringify({
    status: summary.status,
    nextButton: summary.nextButton,
    proofIssues: summary.totals.proofIssues,
    quickFillIssues: summary.totals.quickFillIssues,
    quickFillCurrent: summary.totals.quickFillCurrent,
    proofRefreshFresh: summary.totals.proofRefreshFresh,
    importFixes: summary.totals.importFixes,
    closeoutRejected: summary.totals.closeoutRejected,
    proofPacketsNeeded: summary.totals.proofPacketsNeeded,
    minimumProofUrlsNeeded: summary.totals.minimumProofUrlsNeeded,
    fastPathAvailable: summary.totals.fastPathAvailable,
    reportJsonPath: outJsonPath,
    collectionCsvPath: outCollectionCsvPath,
    pastePacketPath: outPastePacketPath,
    jsonStarterPath: outJsonStarterPath,
    oneScreenPath: outOneScreenPath,
    nextAction: summary.nextAction,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
