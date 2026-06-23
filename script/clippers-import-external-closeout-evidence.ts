import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { recordClipperLaunchEvidenceBatch } from "../server/clippers-agent";

type CsvRow = Record<string, string>;

const rootDir = path.join(process.cwd(), "clippers_workspace");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv");
const reportsDir = path.join(rootDir, "reports");
const reportJsonPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.json");
const reportMarkdownPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.md");
const reportCsvPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.csv");

const secretPattern = /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|passcode|cookie|session|bearer|recovery[_ -]?code|private[_ -]?key)\b|sk-[A-Za-z0-9_-]{12,}/i;
const placeholderPattern = /<[^>]+>|paste .* proof|submitted_or_approved|requested_or_approved|do not store passwords|placeholder|todo|tbd/i;

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function parseCsv(raw: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter((candidate) => candidate.some((value) => value.trim()));
  const keys = header.map((value) => value.trim());
  return body.map((values) => Object.fromEntries(keys.map((key, index) => [key, values[index]?.trim() || ""])));
}

function looksPlaceholder(value: string): boolean {
  return !value.trim() || placeholderPattern.test(value);
}

function safeOriginFromRedirect(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function rowContainsSecret(row: CsvRow): boolean {
  return Object.values(row).some((value) => typeof value === "string" && secretPattern.test(value));
}

function validateRow(row: CsvRow, index: number): { accepted?: CsvRow; rejected?: Record<string, unknown> } {
  const kind = row.kind?.trim();
  const proof = row.proof?.trim() || "";
  const notes = row.notes?.trim() || "";
  const status = row.status?.trim().toLowerCase() || "";

  if (!["account", "developer_app", "permission"].includes(kind)) {
    return { rejected: { index, kind: kind || "unknown", reason: "kind debe ser account, developer_app o permission." } };
  }
  if (looksPlaceholder(proof)) {
    return { rejected: { index, kind, reason: "Falta proof real. Reemplaza el placeholder con URL de portal, ticket o ruta de evidencia segura." } };
  }
  if (status.includes("_or_")) {
    return { rejected: { index, kind, reason: "Status ambiguo. Usa un status exacto: verified, submitted, approved, requested, rejected o blocked." } };
  }

  if (kind === "account") {
    if (status !== "verified" && status !== "submitted" && status !== "blocked") {
      return { rejected: { index, kind, reason: "Account status debe ser verified, submitted o blocked." } };
    }
    if (!row.account_id || !row.platform) {
      return { rejected: { index, kind, reason: "Account requiere account_id y platform." } };
    }
  }

  if (kind === "developer_app") {
    if (status !== "submitted" && status !== "approved" && status !== "rejected" && status !== "draft") {
      return { rejected: { index, kind, reason: "Developer app status debe ser submitted, approved, rejected o draft." } };
    }
    if ((status === "submitted" || status === "approved") && looksPlaceholder(row.app_identifier || "")) {
      return { rejected: { index, kind, reason: "Developer app requiere app_identifier real para submitted/approved." } };
    }
    const publicBaseUrl = row.public_base_url || safeOriginFromRedirect(row.redirect_uri || "");
    if ((status === "submitted" || status === "approved") && !/^https:\/\//i.test(publicBaseUrl)) {
      return { rejected: { index, kind, reason: "Developer app requiere public_base_url HTTPS real." } };
    }
    row.public_base_url = publicBaseUrl;
  }

  if (kind === "permission") {
    if (status !== "requested" && status !== "approved" && status !== "blocked") {
      return { rejected: { index, kind, reason: "Permission status debe ser requested, approved o blocked." } };
    }
    if (!row.platform || !row.scope) {
      return { rejected: { index, kind, reason: "Permission requiere platform y scope." } };
    }
  }

  if (rowContainsSecret(row)) {
    return { rejected: { index, kind, reason: "La fila parece contener secreto/token/password/cookie en algun campo. No se importa evidencia sensible." } };
  }

  row.notes = [notes, `Proof: ${proof}`].filter(Boolean).join(" | ");
  return { accepted: row };
}

function launchEvidenceCsv(rows: CsvRow[]): string {
  const header = ["kind", "account_id", "platform", "status", "scope", "app_identifier", "public_base_url", "notes"];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvCell(row[key] || "")).join(",")),
  ].join("\n");
}

function renderMarkdown(summary: Record<string, any>): string {
  return [
    "# Clippers External Closeout Evidence Import",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Mode: ${summary.mode}`,
    "",
    "## Totals",
    "",
    `- Rows scanned: ${summary.totals.rowsScanned}`,
    `- Accepted: ${summary.totals.accepted}`,
    `- Rejected: ${summary.totals.rejected}`,
    `- Applied: ${summary.totals.applied}`,
    "",
    "## Rejected",
    "",
    ...(summary.rejected.length ? summary.rejected.map((item: any) => `- Row ${item.index}: ${item.kind} - ${item.reason}`) : ["- None"]),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const raw = await readFile(evidenceCsvPath, "utf8");
  const rows = parseCsv(raw);
  const accepted: CsvRow[] = [];
  const rejected: Record<string, unknown>[] = [];

  rows.forEach((row, index) => {
    const result = validateRow(row, index + 2);
    if (result.accepted) accepted.push(result.accepted);
    if (result.rejected) rejected.push(result.rejected);
  });

  let batchResult: Awaited<ReturnType<typeof recordClipperLaunchEvidenceBatch>> | null = null;
  if (apply && accepted.length && rejected.length === 0) {
    batchResult = await recordClipperLaunchEvidenceBatch({
      strict: true,
      batchText: launchEvidenceCsv(accepted),
    });
  }

  const strictBlocked = Boolean(batchResult?.launchEvidenceBatch.strictBlocked);
  const applied = Boolean(batchResult && !strictBlocked);
  const summary = {
    status: rejected.length || strictBlocked
      ? "blocked_invalid_evidence"
      : applied
        ? "import_applied"
        : accepted.length
          ? "ready_to_apply"
          : "empty",
    mode: apply ? "apply" : "preview",
    generatedAt: new Date().toISOString(),
    paths: {
      sourceCsv: evidenceCsvPath,
      json: reportJsonPath,
      markdown: reportMarkdownPath,
      csv: reportCsvPath,
    },
    totals: {
      rowsScanned: rows.length,
      accepted: accepted.length,
      rejected: rejected.length + (batchResult?.launchEvidenceBatch.rejected.length || 0),
      applied: applied ? accepted.length : 0,
    },
    accepted: accepted.map((row, index) => ({
      index: index + 1,
      kind: row.kind,
      accountId: row.account_id || "",
      platform: row.platform || "",
      status: row.status || "",
      scope: row.scope || "",
    })),
    rejected: [...rejected, ...(batchResult?.launchEvidenceBatch.rejected || [])],
    launchEvidenceBatch: batchResult?.launchEvidenceBatch || null,
    nextStep: rejected.length
      ? "Corrige las filas rechazadas en external-closeout-evidence-import.csv. No se aplico evidencia."
      : apply
        ? applied
          ? "Evidencia importada. Regenera account/operational readiness y revisa que Metricool siga approval_required."
          : "No habia filas aplicables."
        : "Preview limpio. Ejecuta npm run clippers:import-external-closeout-evidence -- --apply para aplicar en modo estricto.",
  };

  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(reportMarkdownPath, renderMarkdown(summary));
  await writeFile(reportCsvPath, [
    "index,kind,account_id,platform,status,scope,result,reason",
    ...summary.accepted.map((row) => [row.index, row.kind, row.accountId, row.platform, row.status, row.scope, "accepted", ""].map(csvCell).join(",")),
    ...summary.rejected.map((row: any) => [row.index || "", row.kind || "", row.accountId || row.account_id || "", row.platform || "", row.status || "", row.scope || "", "rejected", row.reason || ""].map(csvCell).join(",")),
  ].join("\n") + "\n");

  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    rowsScanned: summary.totals.rowsScanned,
    accepted: summary.totals.accepted,
    rejected: summary.totals.rejected,
    applied: summary.totals.applied,
    report: reportJsonPath,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
