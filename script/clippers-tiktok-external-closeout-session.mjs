import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const evidenceImportPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.json");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv");
const repairWorkPacketPath = path.join(reportsDir, "clippers-external-closeout-repair-work-packet.json");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const tiktokMvpAccountCloseoutPath = path.join(rootDir, "tiktok-mvp-account-closeout.json");
const metricoolBridgeEvidencePath = path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv");
const mvpAccountEvidencePath = path.join(rootDir, "account-permission-mvp-account-evidence.csv");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.csv");
const outProofLinksPastePacketPath = path.join(reportsDir, "clippers-tiktok-external-closeout-proof-links-paste-packet.txt");
const proofLinksFilledDropPath = path.join(rootDir, "proof-drop", "tiktok-mvp", "proof-links-paste-packet-filled.txt");
const proofLinksJsonDropPath = path.join(rootDir, "proof-drop", "tiktok-mvp", "proof-links.json");

async function readJson(filePath, fallback = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function evidenceImportFreshness() {
  const [csvStat, reportStat] = await Promise.all([
    stat(evidenceCsvPath).catch(() => null),
    stat(evidenceImportPath).catch(() => null),
  ]);
  if (!reportStat) {
    return {
      status: "missing_report",
      reportIsFresh: false,
      evidenceCsvMtimeMs: csvStat?.mtimeMs || 0,
      reportMtimeMs: 0,
      nextStep: "Run Validate before preparing the TikTok external closeout session.",
    };
  }
  const reportIsFresh = !csvStat || reportStat.mtimeMs >= csvStat.mtimeMs;
  return {
    status: reportIsFresh ? "fresh" : "stale_report",
    reportIsFresh,
    evidenceCsvMtimeMs: csvStat?.mtimeMs || 0,
    reportMtimeMs: reportStat.mtimeMs,
    nextStep: reportIsFresh
      ? "Evidence import report matches the current external evidence CSV."
      : "External evidence CSV changed after Validate. Run Validate again before using the TikTok session.",
  };
}

function taskAction(row) {
  if (row.lane === "metricool_bridge") {
    return "Add the real non-secret Metricool proof URL or Google Drive/Docs evidence URL and 20+ character notes, then Load/Preview/Import the bridge CSV only after the preview gate is clean.";
  }
  if (row.lane === "account") {
    return "Confirm the TikTok account/profile is real and connected, then add non-secret ownership/security proof and update the CSV row.";
  }
  if (row.lane === "developer_app") {
    return "Open TikTok Developers, submit the public app identifier and callback proof, then update the CSV row.";
  }
  if (row.lane === "permission") {
    return `Request TikTok ${row.scope || "permission"} and add non-secret portal/ticket proof before import.`;
  }
  return row.nextStep || "Complete this TikTok closeout action with real non-secret proof.";
}

function deferralFor(row, activeMetricoolAccountIds) {
  if (row.lane === "developer_app" || row.lane === "permission") {
    return {
      deferred: true,
      reason: "direct_api_not_required_for_metricool_mvp",
      note: "Deferred because TikTok MVP uses Metricool approval_required mode, not direct TikTok API posting.",
    };
  }
  if (row.lane === "account" && row.accountId && !activeMetricoolAccountIds.has(row.accountId)) {
    return {
      deferred: true,
      reason: "account_not_in_current_metricool_tiktok_mvp",
      note: "Deferred because the current TikTok MVP is SPORT and memes through Metricool.",
    };
  }
  return {
    deferred: false,
    reason: "",
    note: "",
  };
}

function copyPacketFor(row, nextAction = taskAction(row)) {
  return [
    `TikTok closeout task: ${row.closeoutId || row.lane}`,
    `CSV row: ${row.csvRow || "?"}`,
    `Lane: ${row.lane}`,
    row.accountId ? `Account: ${row.accountId}` : null,
    row.scope ? `Scope: ${row.scope}` : null,
    `Required status: ${row.requiredStatus || "n/a"}`,
    `Portal: ${row.portalUrl || "n/a"}`,
    row.docsUrl ? `Docs: ${row.docsUrl}` : null,
    `Proof file: ${row.proofPath || "missing"}`,
    `Reason blocked: ${row.reason || "needs real evidence"}`,
    `CSV row template: ${row.csvRowTemplate || row.replacementCsvRow || ""}`,
    `Next: ${nextAction}`,
    "",
    "Do not paste passwords, cookies, client secrets, OAuth tokens, refresh tokens, recovery codes, or private screenshots.",
  ].filter(Boolean).join("\n");
}

function mvpProofTaskCsvRow(row, proofType) {
  if (proofType === "metricool_bridge") {
    return `"${row.accountId}","tiktok","${metricoolBrandNameFor(row)}","","https://www.tiktok.com/${row.handle || ""}","<paste real public Metricool proof URL or Drive/Docs evidence URL>","Replace with a real 20+ character note confirming this TikTok profile is connected in Metricool."`;
  }
  return `"account","${row.accountId}","tiktok","verified","","","","","https://www.tiktok.com/signup","","<paste real public/non-secret ownership proof URL>","Replace with a real 20+ character note confirming the TikTok account ownership and safety setup."`;
}

function metricoolBrandNameFor(row) {
  if (row.accountId === "sports-daily") return "SPORT";
  if (row.accountId === "meme-radar") return "memes";
  return row.metricoolBrandName || row.metricoolBrandOrProfile || row.accountName || "";
}

function activeMetricoolMvpProofRows(tiktokMvpCloseout, metricoolMvpReady) {
  if (metricoolMvpReady) return [];
  const rows = Array.isArray(tiktokMvpCloseout?.rows) ? tiktokMvpCloseout.rows : [];
  return rows
    .map((row, index) => ({ ...row, sourceOrder: index }))
    .filter((row) => row.platform === "tiktok" && row.status !== "ready_for_metricool_tiktok")
    .flatMap((row) => {
      const profileUrl = `https://www.tiktok.com/${row.handle || ""}`;
      const accountTask = {
        closeoutId: `account-proof:${row.accountId}:tiktok`,
        lane: "account",
        accountId: row.accountId,
        platform: "tiktok",
        requiredStatus: "verified",
        csvRow: "mvp-account-evidence",
        proofPath: row.evidencePath || "",
        portalUrl: profileUrl,
        docsUrl: "",
        reason: (row.evidenceQuality?.issues || row.blockers || ["account proof missing"]).join("; "),
        missingCsvFields: ["proof", "notes"],
        csvRowTemplate: mvpProofTaskCsvRow(row, "account"),
        priority: 0,
        sourceOrder: row.sourceOrder,
        proofOrder: 0,
        priorityLabel: "TikTok Metricool MVP proof",
      };
      const bridgeTask = {
        closeoutId: `metricool-bridge-proof:${row.accountId}:tiktok`,
        lane: "metricool_bridge",
        accountId: row.accountId,
        platform: "tiktok",
        requiredStatus: "verified",
        csvRow: "metricool-tiktok-bridge-evidence",
        proofPath: metricoolBridgeEvidencePath,
        portalUrl: "https://app.metricool.com/",
        docsUrl: "",
        reason: "Metricool bridge proof is missing or not imported for this active TikTok MVP account.",
        missingCsvFields: ["profile_url", "proof", "notes"],
        csvRowTemplate: mvpProofTaskCsvRow(row, "metricool_bridge"),
        priority: 0,
        sourceOrder: row.sourceOrder,
        proofOrder: 1,
        priorityLabel: "TikTok Metricool MVP proof",
      };
      return [accountTask, bridgeTask];
    });
}

function renderActiveMvpProofLinksPastePacket(tiktokMvpCloseout) {
  const rows = Array.isArray(tiktokMvpCloseout?.rows) ? tiktokMvpCloseout.rows : [];
  const activeRows = rows.filter((row) => row.platform === "tiktok");
  return [
    "# TikTok MVP proof-links paste packet",
    "# Fill only real non-secret HTTPS proof URLs. Do not paste passwords, tokens, cookies, recovery codes, signed/temporary URLs, or screenshots with secrets.",
    "# Metricool proof URLs must be https://*.metricool.com/... or Google Drive/Docs evidence URLs",
    "# Save the filled copy to clippers_workspace/proof-drop/tiktok-mvp/proof-links-paste-packet-filled.txt or paste it into the Proof Links Assistant.",
    "",
    ...activeRows.flatMap((row) => {
      const key = `${row.accountId}:tiktok`;
      return [
        `${key}.accountOwnershipProofUrl=`,
        `${key}.metricoolConnectionProofUrl=`,
        `${key}.accountNotes=${row.accountName} TikTok ownership and 2FA/security proof verified by Robert without secrets.`,
        `${key}.metricoolNotes=${metricoolBrandNameFor(row)} Metricool connection to ${row.handle} verified by Robert without secrets.`,
        "",
      ];
    }),
  ].join("\n");
}

function proofLinksOperatorChecklist() {
  return [
    {
      id: "copy_packet",
      label: "Copy proof links packet",
      owner: "operator",
      target: outProofLinksPastePacketPath,
      expectedGate: "template_only",
      nextButton: "Copy proof links",
    },
    {
      id: "fill_real_proofs",
      label: "Fill real non-secret proof URLs and notes",
      owner: "robert",
      target: proofLinksFilledDropPath,
      expectedGate: "manual_real_evidence_required",
      nextButton: "Import proof links drop or Parse paste",
    },
    {
      id: "preview_proof_links",
      label: "Preview proof-links and verify all lanes are clean",
      owner: "operator",
      target: "Proof Links Assistant",
      expectedGate: "readyForProofDrop=true",
      nextButton: "Preview proof links",
    },
    {
      id: "save_and_ingest",
      label: "Save proof links and safe-ingest the drop",
      owner: "operator",
      target: proofLinksJsonDropPath,
      expectedGate: "proof-links validation accepted",
      nextButton: "Save proof links, then Safe ingest drop",
    },
    {
      id: "load_bridge_csv",
      label: "Load generated Metricool bridge CSV",
      owner: "operator",
      target: metricoolBridgeEvidencePath,
      expectedGate: "safe CSV loaded with rawStored=false",
      nextButton: "Load bridge CSV",
    },
    {
      id: "preview_bridge_rows",
      label: "Preview Metricool bridge rows",
      owner: "operator",
      target: "metricool-bridge-preview-gate.json",
      expectedGate: "Preview gate ready_for_import and not expired",
      nextButton: "Preview bridge rows",
    },
    {
      id: "import_bridge_rows",
      label: "Import bridge rows only after preview gate is clean",
      owner: "operator",
      target: metricoolBridgeEvidencePath,
      expectedGate: "current previewHash accepted",
      nextButton: "Import bridge rows",
    },
    {
      id: "rerun_readiness",
      label: "Rerun proof doctor and readiness verifier",
      owner: "operator",
      target: "clippers-tiktok-mvp-readiness-verifier",
      expectedGate: "blocked_before_metricool clears without enabling real publishing",
      nextButton: "Proof doctor / Readiness verifier",
    },
  ];
}

function sortableNumber(value, fallback = 999) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function renderMarkdown(summary) {
  return [
    "# Clippers TikTok External Closeout Session",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `TikTok tasks: ${summary.totals.tiktokTasks}`,
    `Active MVP blockers: ${summary.totals.activeTasks}`,
    `Deferred backlog: ${summary.totals.deferredTasks}`,
    "",
    summary.nextStep,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## MVP Proof Links Paste Packet",
    "",
    `- Packet: ${summary.paths.proofLinksPastePacket}`,
    `- Filled drop target: ${summary.paths.proofLinksFilledDrop}`,
    `- Proof links JSON: ${summary.paths.proofLinksJsonDrop}`,
    "",
    "```text",
    summary.proofLinksPastePacket || "",
    "```",
    "",
    "## Tasks",
    "",
    ...(summary.tasks.length ? summary.tasks.map((task) => [
      `### ${task.rank}. ${task.closeoutId}`,
      "",
      `- Lane: ${task.lane}`,
      task.accountId ? `- Account: ${task.accountId}` : null,
      task.scope ? `- Scope: ${task.scope}` : null,
      `- Required status: ${task.requiredStatus}`,
      task.proofType ? `- Proof type: ${task.proofType}` : null,
      `- Active for Metricool MVP: ${task.activeForMetricoolMvp ? "yes" : "no"}`,
      task.deferredReason ? `- Deferred reason: ${task.deferredReason}` : null,
      `- Portal: ${task.portalUrl || "n/a"}`,
      task.docsUrl ? `- Docs: ${task.docsUrl}` : null,
      `- Proof: ${task.proofPath || "missing"}`,
      `- CSV row: ${task.csvRow || "?"}`,
      `- Next: ${task.nextAction}`,
      "",
      "```csv",
      task.csvRowTemplate || "",
      "```",
      "",
    ].filter(Boolean).join("\n")) : ["- No TikTok repair tasks remain."]),
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "closeout_id", "lane", "account_id", "scope", "required_status", "active_for_metricool_mvp", "deferred_reason", "csv_row", "proof_path", "portal_url", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.tasks.map((task) => [
      task.rank,
      task.closeoutId,
      task.lane,
      task.accountId,
      task.scope,
      task.requiredStatus,
      task.activeForMetricoolMvp ? "yes" : "no",
      task.deferredReason,
      task.csvRow,
      task.proofPath,
      task.portalUrl,
      task.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const freshness = await evidenceImportFreshness();
  const [evidenceImport, repairWorkPacket, accountReadiness] = await Promise.all([
    readJson(evidenceImportPath),
    readJson(repairWorkPacketPath),
    readJson(accountReadinessPath),
  ]);
  const tiktokMvpCloseoutFile = await readJson(tiktokMvpAccountCloseoutPath);
  const tiktokMvpCloseout = accountReadiness.tiktokMvpAccountCloseout || tiktokMvpCloseoutFile;
  const activeMetricoolAccountIds = new Set(
    Array.isArray(accountReadiness.activeMvp?.accountIds)
      ? accountReadiness.activeMvp.accountIds.map((accountId) => String(accountId || ""))
      : ["sports-daily", "meme-radar"],
  );
  const metricoolMvpReady = accountReadiness.activeMvp?.status === "ready";
  const activeMvpProofRows = activeMetricoolMvpProofRows(tiktokMvpCloseout, metricoolMvpReady);
  const proofLinksPastePacket = renderActiveMvpProofLinksPastePacket(tiktokMvpCloseout);
  const repairQueue = freshness.reportIsFresh && Array.isArray(evidenceImport.repairQueue) ? evidenceImport.repairQueue : [];
  const coveredActiveMvpAccountRows = new Set(
    activeMvpProofRows
      .filter((row) => row.lane === "account")
      .map((row) => `${row.accountId}:tiktok`),
  );
  const tiktokRows = [
    ...activeMvpProofRows,
    ...repairQueue
    .filter((row) => String(row.platform || "").toLowerCase() === "tiktok")
    .filter((row) => !(row.lane === "account" && coveredActiveMvpAccountRows.has(`${row.accountId}:tiktok`)))
  ].sort((left, right) =>
    sortableNumber(left.priority, 99) - sortableNumber(right.priority, 99) ||
    sortableNumber(left.sourceOrder, 99) - sortableNumber(right.sourceOrder, 99) ||
    sortableNumber(left.proofOrder, 99) - sortableNumber(right.proofOrder, 99) ||
    sortableNumber(left.csvRow, 999) - sortableNumber(right.csvRow, 999) ||
    String(left.closeoutId || "").localeCompare(String(right.closeoutId || "")));
  const tasks = tiktokRows.map((row, index) => {
    const deferral = deferralFor(row, activeMetricoolAccountIds);
    const nextAction = deferral.deferred ? deferral.note : taskAction(row);
    return {
      rank: index + 1,
      closeoutId: row.closeoutId || `${row.lane || "external"}:tiktok:${index + 1}`,
      lane: row.lane || "",
      accountId: row.accountId || "",
      scope: row.scope || "",
      requiredStatus: row.requiredStatus || "",
      csvRow: row.csvRow || null,
      proofPath: row.proofPath || "",
      portalUrl: row.portalUrl || "",
      docsUrl: row.docsUrl || "",
      reason: row.reason || "",
      missingCsvFields: Array.isArray(row.missingCsvFields) ? row.missingCsvFields : [],
      csvRowTemplate: row.csvRowTemplate || "",
      nextAction,
      copyPacket: copyPacketFor(row, nextAction),
      proofType: row.lane === "metricool_bridge" ? "metricool_connection" : row.lane === "account" ? "account_ownership" : "",
      activeForMetricoolMvp: !deferral.deferred,
      deferredForMetricoolMvp: deferral.deferred,
      deferredReason: deferral.reason,
      deferredNote: deferral.note,
    };
  });
  const activeTasks = tasks.filter((task) => task.activeForMetricoolMvp);
  const deferredTasks = tasks.filter((task) => task.deferredForMetricoolMvp);
  const status = activeTasks.length
      ? "needs_tiktok_external_closeout"
      : !freshness.reportIsFresh
        ? "stale_evidence_import_report"
        : deferredTasks.length
          ? "metricool_mvp_ready_deferred_backlog"
          : "complete";
  const summary = {
    generatedAt: new Date().toISOString(),
    status,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      evidenceCsv: evidenceCsvPath,
      evidenceImport: evidenceImportPath,
      repairWorkPacket: repairWorkPacketPath,
      tiktokMvpAccountCloseout: tiktokMvpAccountCloseoutPath,
      mvpAccountEvidence: mvpAccountEvidencePath,
      metricoolBridgeEvidence: metricoolBridgeEvidencePath,
      proofLinksPastePacket: outProofLinksPastePacketPath,
      proofLinksFilledDrop: proofLinksFilledDropPath,
      proofLinksJsonDrop: proofLinksJsonDropPath,
    },
    source: {
      evidenceImportStatus: evidenceImport.status || "missing",
      repairWorkPacketStatus: repairWorkPacket.status || "missing",
      metricoolMvpReady,
      activeMetricoolAccountIds: [...activeMetricoolAccountIds].filter(Boolean),
      activeMvpProofRows: activeMvpProofRows.length,
      freshness,
    },
    totals: {
      tiktokTasks: tasks.length,
      activeTasks: activeTasks.length,
      deferredTasks: deferredTasks.length,
      account: tasks.filter((task) => task.lane === "account").length,
      developerApp: tasks.filter((task) => task.lane === "developer_app").length,
      permission: tasks.filter((task) => task.lane === "permission").length,
      metricoolBridge: tasks.filter((task) => task.lane === "metricool_bridge").length,
      blocked: activeTasks.length,
    },
    tasks,
    activeTasks,
    deferredTasks,
    proofLinksPastePacket,
    proofLinksFlow: {
      status: metricoolMvpReady ? "not_needed" : "needs_real_proof_links",
      pastePacketPath: outProofLinksPastePacketPath,
      filledDropPath: proofLinksFilledDropPath,
      proofLinksJsonPath: proofLinksJsonDropPath,
      nextStep: "Paste real non-secret proof URLs into this packet, then use Proof Links Assistant -> Parse -> Save proof links -> Safe ingest drop.",
      checklist: proofLinksOperatorChecklist(),
      guardrails: [
        "This packet is a template and does not save evidence by itself.",
        "Metricool URLs must be real HTTPS metricool.com URLs or Google Drive/Docs evidence URLs.",
        "Ownership proof URLs must be safe HTTPS URLs without token, signature, session, or expiry query params.",
      ],
    },
    guardrails: [
      "TikTok is first because the current operating mode is TikTok through Metricool.",
      "Direct TikTok API developer apps and posting scopes are deferred while Metricool is the publisher.",
      "This session does not create accounts automatically and does not store secrets.",
      "Only import evidence after the proof file and CSV row contain real non-secret external proof.",
      "Metricool remains approval_required; this session does not publish content.",
    ],
    nextStep: activeTasks[0]
      ? [
        `Complete ${activeTasks[0].closeoutId} first, then rerun Validate and this TikTok session.`,
        !freshness.reportIsFresh ? freshness.nextStep : "",
      ].filter(Boolean).join(" ")
      : !freshness.reportIsFresh
        ? freshness.nextStep
        : metricoolMvpReady
          ? "TikTok SPORT and memes are ready through Metricool. Continue with the current Metricool batch; deferred TikTok direct API/account expansion can wait."
          : "No active TikTok Metricool blockers remain in this session; verify SPORT and memes lanes before scheduling.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  await writeFile(outProofLinksPastePacketPath, proofLinksPastePacket);
  console.log(JSON.stringify({
    status: summary.status,
    tiktokTasks: summary.totals.tiktokTasks,
    firstTask: tasks[0]?.closeoutId || null,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
