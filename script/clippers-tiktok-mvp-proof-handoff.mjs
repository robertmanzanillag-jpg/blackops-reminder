import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "proof-handoff.json");
const outMarkdownPath = path.join(reportsDir, "proof-handoff.md");
const outCollectionCsvPath = path.join(reportsDir, "proof-handoff-collection-packets.csv");
const outPastePacketPath = path.join(reportsDir, "proof-links-paste-packet.txt");

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

function decisionFromArtifacts({ proofDrop, quickFill, importPreview, closeout, wizard }) {
  if (!proofDrop?.readyForQuickFill) {
    return {
      status: "blocked_needs_proof_links",
      nextButton: "save_proof_links",
      nextAction: proofDrop?.nextStep || "Paste the four real SPORT/memes TikTok and Metricool proof URLs, then save proof links.",
    };
  }
  if (!quickFill?.appliedToIntake) {
    return {
      status: "blocked_needs_quick_fill",
      nextButton: "quick_fill",
      nextAction: quickFill?.nextStep || "Run Quick fill after proof links pass validation.",
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
        proofUrlRule: "Must be a real HTTPS metricool.com URL; no passwords, tokens, cookies, recovery codes, signed/temporary URLs, x-amz/signature/expires query params, or private keys.",
        acceptedProof: [
          `Metricool brand/profile ${lane.metricoolBrandName} shows TikTok connected to ${lane.handle}.`,
          "Metricool planner/profile proof URL that does not expose secret account data.",
          "Notes must be 20+ characters and mention Metricool connection proof.",
        ],
        rejectIf: [
          "The URL is not on metricool.com.",
          "The proof is a placeholder, private credential page, screenshot with secrets, signed URL, temporary URL, or contains auth material.",
        ],
        copyPrompt: `Collect Metricool connection proof for ${lane.metricoolBrandName} -> ${lane.handle}. Paste only a real HTTPS metricool.com proof URL into metricoolConnectionProofUrl and keep metricoolNotes at 20+ characters.`,
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

function renderProofLinksPastePacket() {
  return [
    "# TikTok MVP proof-links paste packet",
    "# Fill only real non-secret HTTPS proof URLs. Do not paste passwords, tokens, cookies, recovery codes, signed/temporary URLs, or screenshots with secrets.",
    "# Metricool proof URLs must be https://*.metricool.com/...",
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
    "## Paste Packet",
    "",
    `- Proof links paste packet: ${summary.paths.pastePacketTxt}`,
    "- Paste this packet into the app paste assistant after filling real proof URLs.",
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
  const importPreview = await readJson(path.join(reportsDir, "proof-intake-import.json"), {});
  const closeout = await readJson(path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json"), {});
  const wizard = await readJson(path.join(reportsDir, "closeout-wizard.json"), {});
  const decision = decisionFromArtifacts({ proofDrop, quickFill, importPreview, closeout, wizard });
  const collectionPackets = buildCollectionPackets(proofDrop);
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
    gates: [
      {
        id: "proof_links",
        status: proofDrop?.readyForQuickFill ? "pass" : "blocked",
        detail: `${proofDrop?.lanes?.filter((lane) => lane.readyForQuickFill).length || 0}/${proofDrop?.lanes?.length || 2} lanes have real proof links.`,
      },
      {
        id: "quick_fill",
        status: quickFill?.appliedToIntake ? "pass" : "blocked",
        detail: `${Array.isArray(quickFill?.issues) ? quickFill.issues.length : 0} quick-fill issues.`,
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
    ],
    collectionPackets,
    pastePacketText: renderProofLinksPastePacket(),
    totals: {
      proofIssues: Array.isArray(proofDrop?.issues) ? proofDrop.issues.length : 0,
      quickFillIssues: Array.isArray(quickFill?.issues) ? quickFill.issues.length : 0,
      importFixes: Array.isArray(importPreview?.fixQueue) ? importPreview.fixQueue.length : 0,
      closeoutRejected: Number(closeout?.totals?.rejected || 0),
      proofPacketsNeeded: collectionPackets.filter((packet) => packet.status !== "ready").length,
    },
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      collectionCsv: outCollectionCsvPath,
      pastePacketTxt: outPastePacketPath,
      proofDropJson: path.join(reportsDir, "proof-drop-kit.json"),
      quickFillJson: path.join(reportsDir, "proof-quick-fill.json"),
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
  console.log(JSON.stringify({
    status: summary.status,
    nextButton: summary.nextButton,
    proofIssues: summary.totals.proofIssues,
    quickFillIssues: summary.totals.quickFillIssues,
    importFixes: summary.totals.importFixes,
    closeoutRejected: summary.totals.closeoutRejected,
    proofPacketsNeeded: summary.totals.proofPacketsNeeded,
    reportJsonPath: outJsonPath,
    collectionCsvPath: outCollectionCsvPath,
    pastePacketPath: outPastePacketPath,
    nextAction: summary.nextAction,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
