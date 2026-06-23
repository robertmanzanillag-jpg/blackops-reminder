import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordClipperLaunchEvidenceBatch } from "../server/clippers-agent";

type CsvRow = Record<string, string>;

const rootDir = path.join(process.cwd(), "clippers_workspace");
const configPath = path.join(rootDir, "config.json");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv");
const reportsDir = path.join(rootDir, "reports");
const reportJsonPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.json");
const reportMarkdownPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.md");
const reportCsvPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.csv");
const proofTodoJsonPath = path.join(reportsDir, "clippers-external-closeout-proof-todo.json");

const secretPattern = /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|passcode|cookie|session|bearer|recovery[_ -]?code|private[_ -]?key)\b|sk-[A-Za-z0-9_-]{12,}/i;
const secretQueryParamPattern = /(^|[?&;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|session)=/i;
const placeholderPattern = /<[^>]+>|paste .* proof|submitted_or_approved|requested_or_approved|do not store passwords|placeholder|todo|tbd/i;
const weakNotesPattern = /^(ok|yes|done|approved|submitted|requested|verified|permissioned|ready|n\/a|na)$/i;
const genericNotesPattern = /^(the\s+)?(valid\s+)?(proof|evidence)\s+((is|was)\s+)?(attached|stored|exists|provided)\b/i;

interface CloseoutValidationIndex {
  accounts: Set<string>;
  developerPlatforms: Set<string>;
  permissions: Set<string>;
  queuedAccounts: Set<string>;
  queuedDeveloperPlatforms: Set<string>;
  queuedPermissions: Set<string>;
}

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

function notesProblem(notes: string): string | null {
  const trimmed = notes.trim();
  if (placeholderPattern.test(trimmed)) return "Notes todavia contienen placeholder.";
  if (weakNotesPattern.test(trimmed)) return "Notes no pueden ser solo ok/yes/done/approved/submitted/requested/verified.";
  if (trimmed.length < 20) return "Notes deben explicar la accion externa con al menos 20 caracteres.";
  if (genericNotesPattern.test(trimmed)) return "Notes deben describir la accion externa concreta, no solo decir que proof/evidence existe.";
  if (secretPattern.test(trimmed) || secretQueryParamPattern.test(trimmed)) return "Notes parecen contener secreto/token/password/cookie.";
  return null;
}

async function buildCloseoutValidationIndex(): Promise<CloseoutValidationIndex> {
  const configRaw = await readFile(configPath, "utf8").catch(() => null);
  const config = configRaw ? JSON.parse(configRaw) : {};
  const configAccounts = new Set<string>();
  const configDeveloperPlatforms = new Set<string>();
  const configPermissions = new Set<string>();
  for (const account of Array.isArray(config.accounts) ? config.accounts : []) {
    const accountId = String(account.id || "").trim().toLowerCase();
    for (const platformAccount of Array.isArray(account.platformAccounts) ? account.platformAccounts : []) {
      const platform = String(platformAccount.platform || "").trim().toLowerCase();
      if (!accountId || !platform) continue;
      configAccounts.add(`${accountId}:${platform}`);
      configDeveloperPlatforms.add(platform);
      for (const scope of Array.isArray(platformAccount.requiredScopes) ? platformAccount.requiredScopes : []) {
        const normalizedScope = String(scope || "").trim();
        if (normalizedScope) configPermissions.add(`${platform}:${normalizedScope}`);
      }
    }
  }

  const raw = await readFile(proofTodoJsonPath, "utf8").catch(() => null);
  const rows = raw ? JSON.parse(raw).rows : [];
  const queuedAccounts = new Set<string>();
  const queuedDeveloperPlatforms = new Set<string>();
  const queuedPermissions = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const lane = String(row.lane || "");
    const platform = String(row.platform || "").trim().toLowerCase();
    const accountId = String(row.accountId || "").trim().toLowerCase();
    const scope = String(row.scope || "").trim();
    if (lane === "account" && accountId && platform) queuedAccounts.add(`${accountId}:${platform}`);
    if (lane === "developer_app" && platform) queuedDeveloperPlatforms.add(platform);
    if (lane === "permission" && platform && scope) queuedPermissions.add(`${platform}:${scope}`);
  }
  return {
    accounts: configAccounts,
    developerPlatforms: configDeveloperPlatforms,
    permissions: configPermissions,
    queuedAccounts,
    queuedDeveloperPlatforms,
    queuedPermissions,
  };
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
  return Object.values(row).some((value) => (
    typeof value === "string" &&
    (secretPattern.test(value) || secretQueryParamPattern.test(value))
  ));
}

function proofRemoteProblem(proof: string): string | null {
  if (!/^https?:\/\//i.test(proof)) return null;
  try {
    const url = new URL(proof);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const singleLabelHost = !hostname.includes(".") && hostname !== "drive.google.com";
    if (url.protocol !== "https:") return "Proof remoto debe usar HTTPS.";
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname === "example" ||
      hostname === "example.com" ||
      hostname.endsWith(".example.com") ||
      hostname === "test" ||
      hostname.endsWith(".example") ||
      hostname === "invalid" ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      singleLabelHost
    ) {
      return "Proof remoto debe usar un dominio publico real, no localhost/example/test.";
    }
    if (secretQueryParamPattern.test(url.search)) return "Proof remoto parece contener token/code/signature en query string.";
    return "";
  } catch {
    return "Proof remoto no es una URL valida.";
  }
}

function isProductionPublicBaseUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      hostname.endsWith(".localhost") ||
      hostname === "example" ||
      hostname === "example.com" ||
      hostname.endsWith(".example.com") ||
      hostname === "test" ||
      hostname.endsWith(".example") ||
      hostname === "invalid" ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      !hostname.includes(".")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveProofPath(proof: string): string | null {
  if (!proof || /^https?:\/\//i.test(proof)) return null;
  const absolute = path.isAbsolute(proof) ? proof : path.resolve(process.cwd(), proof);
  const relative = path.relative(rootDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

async function validateProofReference(proof: string): Promise<string | null> {
  const remoteProblem = proofRemoteProblem(proof);
  if (remoteProblem !== null) return remoteProblem || null;
  const proofPath = resolveProofPath(proof);
  if (!proofPath) return "Proof local debe vivir dentro de clippers_workspace o ser una URL https.";
  const [realRoot, realProof] = await Promise.all([
    realpath(rootDir).catch(() => null),
    realpath(proofPath).catch(() => null),
  ]);
  if (!realRoot || !realProof) return "Proof file no existe o no se puede leer.";
  const realRelative = path.relative(realRoot, realProof);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    return "Proof local resuelve fuera de clippers_workspace.";
  }
  const raw = await readFile(realProof, "utf8").catch(() => null);
  if (!raw) return "Proof file no existe o no se puede leer.";
  if (raw.length < 80) return "Proof file es demasiado corto para demostrar evidencia real.";
  if (placeholderPattern.test(raw) || /needs_real_proof/i.test(raw)) return "Proof file todavia contiene placeholders o needs_real_proof.";
  if (secretPattern.test(raw) || secretQueryParamPattern.test(raw)) return "Proof file parece contener secreto/token/password/cookie.";
  return null;
}

async function validateRow(row: CsvRow, index: number, closeoutIndex: CloseoutValidationIndex): Promise<{ accepted?: CsvRow; rejected?: Record<string, unknown> }> {
  const kind = row.kind?.trim();
  const proof = row.proof?.trim() || "";
  const notes = row.notes?.trim() || "";
  const status = row.status?.trim().toLowerCase() || "";
  const platform = row.platform?.trim().toLowerCase() || "";
  const accountId = row.account_id?.trim().toLowerCase() || "";
  const scope = row.scope?.trim() || "";

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
    if (status !== "verified") {
      return { rejected: { index, kind, reason: "Account closeout status debe ser verified para aplicar evidencia externa." } };
    }
    if (!row.account_id || !row.platform) {
      return { rejected: { index, kind, reason: "Account requiere account_id y platform." } };
    }
    if (!closeoutIndex.accounts.has(`${accountId}:${platform}`) || !closeoutIndex.queuedAccounts.has(`${accountId}:${platform}`)) {
      return { rejected: { index, kind, reason: "Account no existe en la cola external closeout; no se acepta evidencia para cuentas inventadas." } };
    }
  }

  if (kind === "developer_app") {
    if (status !== "submitted" && status !== "approved") {
      return { rejected: { index, kind, reason: "Developer app closeout status debe ser submitted o approved para aplicar evidencia externa." } };
    }
    if (looksPlaceholder(row.app_identifier || "")) {
      return { rejected: { index, kind, reason: "Developer app requiere app_identifier real para preview/apply." } };
    }
    if (!closeoutIndex.developerPlatforms.has(platform) || !closeoutIndex.queuedDeveloperPlatforms.has(platform)) {
      return { rejected: { index, kind, reason: "Developer app platform no existe en la cola external closeout." } };
    }
    const publicBaseUrl = row.public_base_url || safeOriginFromRedirect(row.redirect_uri || "");
    if (!isProductionPublicBaseUrl(publicBaseUrl)) {
      return { rejected: { index, kind, reason: "Developer app requiere public_base_url HTTPS publico real, no localhost/private/example/test." } };
    }
    row.public_base_url = publicBaseUrl;
  }

  if (kind === "permission") {
    if (status !== "requested" && status !== "approved") {
      return { rejected: { index, kind, reason: "Permission closeout status debe ser requested o approved para aplicar evidencia externa." } };
    }
    if (!row.platform || !row.scope) {
      return { rejected: { index, kind, reason: "Permission requiere platform y scope." } };
    }
    if (!closeoutIndex.permissions.has(`${platform}:${scope}`) || !closeoutIndex.queuedPermissions.has(`${platform}:${scope}`)) {
      return { rejected: { index, kind, reason: "Permission scope no existe en la cola external closeout; no se acepta permiso inventado." } };
    }
  }

  if (rowContainsSecret(row)) {
    return { rejected: { index, kind, reason: "La fila parece contener secreto/token/password/cookie en algun campo. No se importa evidencia sensible." } };
  }
  const noteProblem = notesProblem(notes);
  if (noteProblem) {
    return { rejected: { index, kind, reason: noteProblem } };
  }
  const proofProblem = await validateProofReference(proof);
  if (proofProblem) {
    return { rejected: { index, kind, reason: proofProblem } };
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
  const closeoutIndex = await buildCloseoutValidationIndex();
  const accepted: CsvRow[] = [];
  const rejected: Record<string, unknown>[] = [];

  for (const [index, row] of rows.entries()) {
    const result = await validateRow(row, index + 2, closeoutIndex);
    if (result.accepted) accepted.push(result.accepted);
    if (result.rejected) rejected.push(result.rejected);
  }

  let batchResult: Awaited<ReturnType<typeof recordClipperLaunchEvidenceBatch>> | null = null;
  if (apply && accepted.length && rejected.length === 0) {
    batchResult = await recordClipperLaunchEvidenceBatch({
      strict: true,
      batchText: launchEvidenceCsv(accepted),
    });
  }

  const strictBlocked = Boolean(batchResult?.launchEvidenceBatch.strictBlocked);
  const batchRejected = batchResult?.launchEvidenceBatch.rejected.length || 0;
  const applied = Boolean(batchResult && !strictBlocked && batchRejected === 0);
  const summary = {
    status: rejected.length || strictBlocked || batchRejected
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
      rejected: rejected.length + batchRejected,
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
