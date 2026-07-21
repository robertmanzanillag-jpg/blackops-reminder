import { constants as fsConstants, createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = process.cwd();
const workspaceRoot = process.env.CLIPPERS_WORKSPACE_ROOT || path.join(root, "clippers_workspace");
const reportsDir = path.join(workspaceRoot, "reports");
const scheduledDir = path.join(workspaceRoot, "scheduled");
const quarantineDir = path.join(workspaceRoot, "quarantine");
const batchEvidenceCsvPath = path.join(scheduledDir, "metricool-100-batch-evidence-imports", "metricool-batch-01-evidence-import.csv");
const batchEvidenceLockPath = `${batchEvidenceCsvPath}.lock`;
const masterEvidenceCsvPath = path.join(workspaceRoot, "evidence-drop", "metricool-100-approval-evidence-import.csv");
const sessionPacketJsonPath = path.join(reportsDir, "clippers-metricool-current-batch-session-packet.json");
const operatorAuditLogPath = process.env.CLIPPERS_OPERATOR_AUDIT_LOG_PATH
  || path.join(reportsDir, "clippers-local-operator-audit.jsonl");
const externalEvidenceCsvPath = path.join(workspaceRoot, "evidence-drop", "external-closeout-evidence-import.csv");
const externalProofsDir = path.join(workspaceRoot, "evidence-drop", "external-closeout-proofs");
const realClipPermissionCrmCsvPath = path.join(workspaceRoot, "evidence-drop", "real-clip-permission-outreach.csv");
const realClipPermissionCrmLockPath = `${realClipPermissionCrmCsvPath}.lock`;
const streamerResearchDir = path.join(workspaceRoot, "research");
const streamerBlanketPermissionCsvPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
const humanReviewDecisionsCsvPath = path.join(workspaceRoot, "evidence-drop", "human-review-decisions.csv");
const humanReviewDecisionsLockPath = `${humanReviewDecisionsCsvPath}.lock`;
const realClipIntakeManifestLockPath = path.join(scheduledDir, ".real-clip-intake-manifest.lock");
const currentBatchWorkbookJsonPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const currentBatchUploadPackJsonPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const requestedHost = process.env.HOST || "127.0.0.1";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const host = loopbackHosts.has(requestedHost) || process.env.CLIPPERS_ALLOW_NON_LOOPBACK_HOST === "true"
  ? requestedHost
  : "127.0.0.1";
const port = Number(process.env.PORT || 5010);
const csrfToken = process.env.CLIPPERS_LOCAL_OPERATOR_TOKEN || randomBytes(24).toString("hex");
const autoRollForwardEnabled = process.env.CLIPPERS_AUTO_ROLL_FORWARD === "true";
const autoRollForwardThresholdMinutes = Number(process.env.CLIPPERS_AUTO_ROLL_FORWARD_MIN_LEAD_MINUTES || 45);
const autoRollForwardIntervalMs = Number(process.env.CLIPPERS_AUTO_ROLL_FORWARD_INTERVAL_MS || 60_000);
const operatorTimeZone = process.env.CLIPPERS_OPERATOR_TIME_ZONE || process.env.TZ || "America/New_York";
const operatorAuditTailBytes = Number(process.env.CLIPPERS_OPERATOR_AUDIT_TAIL_BYTES || 256_000);
const artifactReadTimeoutMsCandidate = Number(process.env.CLIPPERS_ARTIFACT_READ_TIMEOUT_MS || 500);
const artifactReadTimeoutMs = Number.isFinite(artifactReadTimeoutMsCandidate) && artifactReadTimeoutMsCandidate > 0
  ? artifactReadTimeoutMsCandidate
  : 500;
const previewConfirmTtlMsCandidate = Number(process.env.CLIPPERS_PREVIEW_CONFIRM_TTL_MS || 10 * 60_000);
const previewConfirmTtlMs = Number.isFinite(previewConfirmTtlMsCandidate) && previewConfirmTtlMsCandidate > 0
  ? previewConfirmTtlMsCandidate
  : 10 * 60_000;
const operatorNowMsOverride = Date.parse(process.env.CLIPPERS_OPERATOR_NOW || "");
const previewConfirmStore = new Map();
const watchdogState = {
  running: false,
  lastCheckedAt: "",
  lastRunAt: "",
  lastStatus: "idle",
  lastReason: "",
};
const refreshScriptPaths = [
  "script/clippers-tiktok-batch-evidence-sync.mjs",
  "script/clippers-tiktok-batch-tracker.mjs",
  "script/clippers-tiktok-evidence-checklist.mjs",
  "script/clippers-tiktok-batch-closeout-verifier.mjs",
  "script/clippers-tiktok-external-closeout-session.mjs",
  "script/clippers-tiktok-next-action.mjs",
  "script/clippers-metricool-current-batch-session-packet.mjs",
  "script/clippers-goal-completion-audit.mjs",
];
const rollForwardScriptPaths = [
  "script/clippers-metricool-operator-handoff.mjs",
  "script/clippers-tiktok-mvp-go-live-packet.mjs",
  "script/clippers-tiktok-launch-control.mjs",
  "script/clippers-goal-completion-audit.mjs",
  "script/clippers-tiktok-mvp-readiness-verifier.mjs",
  "script/clippers-metricool-mcp-preflight.ts",
  "script/clippers-metricool-current-batch-upload-pack.mjs",
  "script/clippers-tiktok-operator-cockpit.mjs",
  "script/clippers-tiktok-operator-cockpit-preflight.mjs",
  ...refreshScriptPaths,
];
const sourceDropMetricoolRefreshScriptPaths = [
  "script/clippers-metricool-operator-handoff.mjs",
  "script/clippers-tiktok-mvp-go-live-packet.mjs",
  "script/clippers-tiktok-launch-control.mjs",
  "script/clippers-goal-completion-audit.mjs",
  "script/clippers-tiktok-mvp-readiness-verifier.mjs",
  "script/clippers-metricool-mcp-preflight.ts",
  "script/clippers-metricool-current-batch-upload-pack.mjs",
  "script/clippers-metricool-current-batch-session-packet.mjs",
  ...refreshScriptPaths,
];
const secretTextPattern = /\b(access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?secret|api[\s_-]?key|password|passcode|cookie|session|bearer|recovery[\s_-]?code|private[\s_-]?key)\b|sk-[A-Za-z0-9_-]{12,}/i;
const secretQueryParamPattern = /(^|[?&;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|session)=/i;
const proofPlaceholderPattern = /<[^>]+>|paste|placeholder|template|todo|tbd|needs_real_proof|example/i;

if (host !== requestedHost) {
  console.warn(`Refusing non-loopback HOST=${requestedHost}; using ${host}. Set CLIPPERS_ALLOW_NON_LOOPBACK_HOST=true to override.`);
}

function localOrigin() {
  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${urlHost}:${port}`;
}

function operatorNowMs() {
  return Number.isFinite(operatorNowMsOverride) ? operatorNowMsOverride : Date.now();
}

const json = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
};

const clipperPageTitles = new Map([
  ["Clippers Source Hunt", ["Descubrir", "Buscar videos virales"]],
  ["Clippers Exact Source Candidate Inbox", ["Descubrir", "Guardar candidato"]],
  ["Clippers Permission CRM", ["Permisos", "Gestionar permisos"]],
  ["Clippers Permission Outreach", ["Permisos", "Pedir permisos"]],
  ["Clippers Permission Request Packets", ["Permisos", "Mensajes para pedir permiso"]],
  ["Clippers 100 Streamer Campaign", ["Permisos", "Campana de 100 streamers"]],
  ["Clippers Real Clip Acquisition", ["Preparar", "Preparar clips"]],
  ["Clippers Real Clip Intake", ["Preparar", "Cargar archivos reales"]],
  ["Clippers Real Clip Intake Validation", ["Preparar", "Validar clips"]],
  ["Clippers Human Review Queue", ["Preparar", "Revisar candidatos"]],
  ["Clippers Source-drop Import", ["Preparar", "Enviar clips a Metricool"]],
  ["Clippers TikTok Batch Now", ["Metricool", "Programar en Metricool"]],
  ["Clippers TikTok Public Metrics Now", ["Optimizar", "Registrar resultados"]],
  ["TikTok Launch Authorization", ["Metricool", "Revisar autorizacion de TikTok"]],
  ["Clippers Metricool Now", ["Metricool", "Proxima accion en Metricool"]],
  ["Streamer Growth CEO", ["Optimizar", "Control de crecimiento a 10K"]],
  ["Clippers Go-Live Gap Resolver", ["Preparar", "Resolver bloqueos"]],
]);

const clipperPageGuides = new Map([
  ["Clippers Source Hunt", "Encuentra videos exactos de creadores originales. Aqui solo investigas; el permiso y el archivo se confirman en los pasos siguientes."],
  ["Clippers Exact Source Candidate Inbox", "Guarda la URL exacta del video y su creador. Esto crea un candidato, pero todavia no autoriza su uso."],
  ["Clippers Permission CRM", "Registra el contacto con cada creador y la evidencia de su respuesta. Nada pasa a Metricool sin prueba valida."],
  ["Clippers Permission Outreach", "Prepara y controla las solicitudes de permiso. Esta pantalla no envia mensajes ni aprueba clips por si sola."],
  ["Clippers Permission Request Packets", "Revisa los mensajes preparados para cada creador antes de enviarlos y guardar la respuesta en Permisos."],
  ["Clippers 100 Streamer Campaign", "Investiga y prioriza 100 creadores para solicitar permiso general. Un candidato o un correo enviado nunca cuenta como autorizacion."],
  ["Clippers Real Clip Acquisition", "Mira que le falta a cada candidato y completa URL, permiso, evidencia y archivo en el orden correcto."],
  ["Clippers Real Clip Intake", "Carga los MP4 reales aprobados para reemplazar los videos de prueba. No se publica nada desde esta pantalla."],
  ["Clippers Real Clip Intake Validation", "Comprueba que cada clip tenga archivo, URL exacta, creador y permiso antes de enviarlo a Metricool."],
  ["Clippers Human Review Queue", "Reproduce cada candidato y registra audio, contexto y material de terceros. Las decisiones son locales y nunca desbloquean Metricool por sí solas."],
  ["Clippers Source-drop Import", "Envia a la cola de Metricool solo los clips reales que superaron todas las validaciones."],
  ["Clippers TikTok Batch Now", "Programa en Metricool los clips aprobados y guarda la evidencia de la programacion."],
  ["Clippers TikTok Public Metrics Now", "Registra las vistas y resultados reales despues de publicar para que el sistema pueda mejorar."],
]);

function polishClipperOperatorPage(body) {
  if (!String(body).includes("<!doctype html") || String(body).includes('class="topbar"')) return body;
  const title = String(body).match(/<title>([^<]+)<\/title>/i)?.[1] || "Clippers";
  const [stage, pageTitle] = clipperPageTitles.get(title) || ["Operacion", title.replace(/^Clippers\s*/i, "") || "Clippers"];
  const pageGuide = clipperPageGuides.get(title);
  const sharedStyles = `<style data-clippers-shared-ui>
    :root{color-scheme:dark;--bg:#0b100e;--surface:#111814;--surface-2:#16201b;--line:#29372f;--muted:#9eaca4;--text:#f4f7f5;--green:#52d98b;--amber:#f3bd62;--blue:#77bdfb}
    *{box-sizing:border-box}html{scroll-behavior:smooth}
    body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;margin:0!important;background:var(--bg)!important;color:var(--text)!important}
    main{max-width:1120px!important;margin:0 auto!important;padding:0 24px 64px!important}
    .operator-nav{min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);margin-bottom:34px}
    .operator-brand{font-size:18px;font-weight:800;color:#fff!important;text-decoration:none}
    .operator-nav-links{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px}.operator-nav-links a{color:#dce7e1!important;text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:7px 10px;font-size:12px}
    .operator-stage{font-size:11px;text-transform:uppercase;color:var(--green);font-weight:800;letter-spacing:.08em;margin-bottom:7px}
    main>h1{font-size:30px!important;line-height:1.15!important;margin:0 0 9px!important;letter-spacing:0!important}
    main>h1+p{max-width:760px;color:var(--muted)!important;margin-bottom:24px!important}
    h2{font-size:18px!important;line-height:1.3;letter-spacing:0!important}p,li{color:#c9d2cd!important;line-height:1.55}a{color:#a8d7ff!important}
    .grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))!important;gap:0!important;margin:18px 0 28px!important;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .grid>.card{border:0!important;border-left:1px solid var(--line)!important;padding:18px 16px!important;margin:0!important;background:transparent!important;border-radius:0!important}.grid>.card:first-child{border-left:0!important;padding-left:0!important}
    .card,.row,.clip,.row-card{border:0!important;border-top:1px solid var(--line)!important;background:transparent!important;border-radius:0!important;padding:22px 0!important;margin:0!important;box-shadow:none!important}
    .card .card,.card .row,.row .card{margin-top:18px!important;padding-top:18px!important}
    .value,.card>strong{font-size:20px!important;font-weight:800!important;color:#fff!important;margin-top:5px!important;overflow-wrap:break-word}
    .label,.eyebrow{font-size:11px!important;text-transform:uppercase!important;color:var(--muted)!important;font-weight:800!important;letter-spacing:.07em!important}
    .actions{display:flex!important;flex-wrap:wrap!important;gap:8px!important;margin:16px 0 26px!important}.actions form{margin:0!important}
    .actions a,.actions button,button{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:40px!important;border:1px solid var(--line)!important;border-radius:6px!important;padding:9px 12px!important;text-decoration:none!important;background:var(--surface-2)!important;color:#e8efeb!important;font:inherit!important;font-weight:700!important;cursor:pointer}.actions a:hover,.actions button:hover,button:hover{border-color:#52635a!important;background:#1b2921!important}button:disabled{opacity:.45!important;cursor:not-allowed!important}
    form{max-width:780px}input,select,textarea{width:100%!important;box-sizing:border-box!important;background:#0d1410!important;color:#eef7f1!important;border:1px solid #3a4c42!important;border-radius:6px!important;padding:10px!important;margin:6px 0!important;font:inherit!important}textarea{min-height:96px;resize:vertical}
    table{width:100%!important;border-collapse:collapse!important;margin-top:12px!important;font-size:13px!important;display:block!important;overflow-x:auto!important}thead,tbody{display:table;width:100%;min-width:720px;table-layout:fixed}th,td{border-top:1px solid var(--line)!important;padding:10px 8px!important;text-align:left!important;vertical-align:top!important;overflow-wrap:anywhere}th{color:var(--muted)!important;font-size:11px!important;text-transform:uppercase!important;letter-spacing:.05em!important}td{color:#edf4f0!important}
    code,pre,.caption,.note{background:#0d1410!important;border:1px solid var(--line)!important;border-radius:6px!important;color:#d9eee2!important}code{padding:2px 5px!important;overflow-wrap:anywhere}pre,.caption,.note{white-space:pre-wrap;word-break:break-word;padding:12px!important;max-width:100%;overflow:auto}.small,small{font-size:12px!important;color:var(--muted)!important}
    details{border-top:1px solid var(--line);padding:10px 0}summary{cursor:pointer;color:#dce7e1!important;font-weight:700}
    @media(max-width:720px){main{padding:0 17px 48px!important}.operator-nav{align-items:flex-start;flex-direction:column;padding:14px 0;margin-bottom:26px}.operator-nav-links{justify-content:flex-start;gap:5px}.operator-nav-links a{padding:7px 8px;font-size:11px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.grid>.card,.grid>.card:first-child{padding:15px 11px!important;border-left:1px solid var(--line)!important}.grid>.card:nth-child(odd){border-left:0!important;padding-left:0!important}.actions{display:grid!important;grid-template-columns:1fr!important}.actions a,.actions button{width:100%!important}.clip-head,.row-head{flex-direction:column!important}main>h1{font-size:26px!important}}
  </style>`;
  const navigation = `<nav class="operator-nav" aria-label="Clippers"><a class="operator-brand" href="/clippers">Clippers</a><div class="operator-nav-links"><a href="/api/clippers/real-clip-source-hunt.html">Buscar videos</a><a href="/api/clippers/streamer-100-campaign.html">100 streamers</a><a href="/api/clippers/real-clip-permission-crm.html">Permisos</a><a href="/api/clippers/real-clip-acquisition-workbench.html">Preparar</a></div></nav><div class="operator-stage">${escapeHtml(stage)}</div>`;
  let polished = String(body)
    .replace("</head>", `${sharedStyles}</head>`)
    .replace(/<main>/i, `<main>${navigation}`)
    .replace(/<h1>[^<]*<\/h1>/i, `<h1>${escapeHtml(pageTitle)}</h1>`);
  if (pageGuide) polished = polished.replace(/(<h1>[^<]*<\/h1>)\s*<p>.*?<\/p>/is, `$1\n  <p>${escapeHtml(pageGuide)}</p>`);
  return polished
    .replaceAll(">Status<", ">Estado<")
    .replaceAll(">Rows<", ">Clips<")
    .replaceAll(">Ready<", ">Listos<")
    .replaceAll(">Blocked<", ">Bloqueados<")
    .replaceAll(">Next action<", ">Siguiente paso<")
    .replaceAll(">Dashboard<", ">Inicio<")
    .replaceAll(">Account<", ">Cuenta<")
    .replaceAll(">Target<", ">Archivo<")
    .replaceAll(">Search<", ">Buscar<")
    .replaceAll(">Reject<", ">Descartar<")
    .replaceAll(">Next<", ">Siguiente<")
    .replaceAll(">Recorded<", ">Registrados<")
    .replaceAll(">Approved CRM<", ">Permisos aprobados<")
    .replaceAll(">Recreate only<", ">Solo recrear<");
}

const html = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(polishClipperOperatorPage(body));
};

const text = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
};

function safeDownloadFilename(filename, fallback = "clippers-download.csv") {
  const cleaned = String(filename || "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

const csv = (res, statusCode, body, filename = "clippers-metricool-upload-checklist.csv") => {
  res.writeHead(statusCode, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${safeDownloadFilename(filename)}"`,
    "cache-control": "no-store",
  });
  res.end(body);
};

const markdown = (res, statusCode, body, filename = "clippers-metricool-operator-brief.md") => {
  res.writeHead(statusCode, {
    "content-type": "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${safeDownloadFilename(filename, "clippers-download.md")}"`,
    "cache-control": "no-store",
  });
  res.end(body);
};

async function readRequestBody(req, maxBytes = 32_000) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Request body too large");
  }
  return body;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, {
      encoding: "utf8",
      signal: AbortSignal.timeout(artifactReadTimeoutMs),
    }));
  } catch {
    return fallback;
  }
}

async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, {
      encoding: "utf8",
      signal: AbortSignal.timeout(artifactReadTimeoutMs),
    });
  } catch {
    return fallback;
  }
}

async function readTextForMutation(filePath, { allowMissing = false } = {}) {
  try {
    const value = await readFile(filePath, {
      encoding: "utf8",
      signal: AbortSignal.timeout(artifactReadTimeoutMs),
    });
    return { ok: true, value };
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return { ok: true, value: "" };
    return { ok: false, value: "", error: "artifact_read_unavailable" };
  }
}

async function readFilePrefix(filePath, maxBytes = 4_096) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), artifactReadTimeoutMs);
  try {
    const chunks = [];
    let bytes = 0;
    const stream = createReadStream(filePath, {
      start: 0,
      end: Math.max(0, maxBytes - 1),
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes >= maxBytes) break;
    }
    return Buffer.concat(chunks, Math.min(bytes, maxBytes));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readTextTail(filePath, maxBytes = 256_000) {
  try {
    const fileStat = await stat(filePath);
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 256_000;
    const start = Math.max(0, fileStat.size - limit);
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(fileStat.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return {
        text: buffer.toString("utf8"),
        bytes: fileStat.size,
        truncated: start > 0,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return { text: "", bytes: 0, truncated: false };
  }
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(raw) {
  const lines = raw.trimEnd().split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines.shift() || "");
  return {
    header,
    rows: lines.map((line) => {
      const cells = parseCsvLine(line);
      return Object.fromEntries(header.map((key, index) => [key, cells[index] || ""]));
    }),
  };
}

function csvCell(value) {
  const textValue = String(value ?? "");
  return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

function renderCsv(header, rows) {
  return [
    header.map(csvCell).join(","),
    ...rows.map((row) => header.map((key) => csvCell(row[key] || "")).join(",")),
  ].join("\n") + "\n";
}

function safeCsvText(value) {
  const textValue = String(value ?? "");
  const formulaPrefix = textValue.match(/^[\s\u0000-\u001f]*[=+\-@]/);
  return formulaPrefix ? `'${textValue.slice(formulaPrefix[0].length - 1)}` : textValue;
}

function workspaceSafeCsvText(value) {
  return safeCsvText(String(value ?? "").split(workspaceRoot).join("/clippers-workspace"));
}

function allowedLocalOrigin(value) {
  if (!value) return true;
  try {
    return new URL(value).origin === localOrigin();
  } catch {
    return false;
  }
}

function validatePostRequest(req, body) {
  const form = new URLSearchParams(body);
  const headerToken = String(req.headers["x-clippers-local-token"] || "");
  const formToken = String(form.get("csrfToken") || "");
  if (headerToken !== csrfToken && formToken !== csrfToken) {
    return { ok: false, statusCode: 403, error: "invalid_or_missing_csrf_token", form };
  }
  if (!allowedLocalOrigin(req.headers.origin) || !allowedLocalOrigin(req.headers.referer)) {
    return { ok: false, statusCode: 403, error: "cross_origin_post_rejected", form };
  }
  return { ok: true, statusCode: 200, form };
}

function isMetricoolUrl(value) {
  const textValue = String(value || "").trim();
  if (!/^https:\/\//i.test(textValue)) return false;
  try {
    const parsed = new URL(textValue);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return hostName === "metricool.com" || hostName.endsWith(".metricool.com");
  } catch {
    return false;
  }
}

function isMetricoolPlannerUrl(value) {
  if (!isMetricoolUrl(value)) return false;
  try {
    const textValue = String(value || "").trim();
    if (secretQueryParamPattern.test(textValue)) return false;
    const parsed = new URL(textValue);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (!["app.metricool.com", "metricool.com"].includes(hostName)) return false;
    if (parsed.search || parsed.hash) return false;
    return /^\/(?:app\/)?(?:planner|calendar|planning|post|posts)(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isTikTokVideoUrl(value) {
  const textValue = String(value || "").trim();
  if (!/^https:\/\//i.test(textValue)) return false;
  try {
    const parsed = new URL(textValue);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (!["tiktok.com", "m.tiktok.com"].includes(hostName)) return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.search || parsed.hash) return false;
    return /^\/@[^/]+\/video\/\d+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function metricValue(value) {
  const textValue = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+$/.test(textValue)) return null;
  const parsed = Number(textValue);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : null;
}

function validateOperatorNotes(value) {
  const notes = String(value || "").trim();
  if (notes.length < 20) return "operator_notes_min_20_chars";
  if (/[\r\n]/.test(notes)) return "operator_notes_must_be_single_line";
  const normalized = notes.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const generic = new Set(["approved", "scheduled", "published", "posted", "ok", "yes", "done", "metricool", "tiktok", "clip", "ready"]);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const concrete = tokens.filter((token) => token.length >= 5 && !generic.has(token));
  if (!concrete.length || generic.has(normalized)) return "operator_notes_must_be_specific";
  if (/<[^>]+>/.test(notes) || /\b(placeholder|paste|todo|tbd|example)\b/i.test(notes)) return "operator_notes_must_not_contain_placeholders";
  return "";
}

function validateScheduledOperatorNotes(value) {
  const baseError = validateOperatorNotes(value);
  if (baseError) return baseError;
  const notes = String(value || "");
  if (/https?:\/\/[^\s]*tiktok\.com[^\s]*/i.test(notes)) return "scheduled_notes_must_not_include_tiktok_url";
  if (/\b(?:views?|likes?|comments?|shares?|vistas?|me\s*gusta|comentarios?|compartidos?)\b\s*[:=]?\s*\d+/i.test(notes)
    || /\b\d+\s*(?:views?|likes?|comments?|shares?|vistas?|me\s*gusta|comentarios?|compartidos?)\b/i.test(notes)) {
    return "scheduled_notes_must_not_include_metrics";
  }
  return "";
}

function hasScheduledEvidence(row) {
  return row.final_status === "scheduled"
    && isMetricoolPlannerUrl(row.metricool_approval_url)
    && !validateScheduledOperatorNotes(row.operator_notes);
}

function hasScheduledProofEvidence(row) {
  return row.final_status === "scheduled"
    || Boolean(String(row.metricool_approval_url || "").trim());
}

function hasPublishedEvidence(row) {
  return row.final_status === "published"
    || Boolean(String(row.published_post_url || "").trim())
    || [row.views_24h, row.likes_24h, row.comments_24h, row.shares_24h].some((value) => String(value || "").trim() !== "");
}

function hasValidPublishedMetricsEvidence(row) {
  return row.final_status === "published" && hasStrictPublishedEvidence(row);
}

function shortHash(value) {
  const textValue = String(value || "").trim();
  return textValue ? createHash("sha256").update(textValue).digest("hex").slice(0, 16) : "";
}

function safeUrlAudit(value) {
  const textValue = String(value || "").trim();
  if (!textValue) return null;
  try {
    const parsed = new URL(textValue);
    return {
      host: parsed.host,
      pathHash: shortHash(parsed.pathname),
      queryPresent: Boolean(parsed.search),
    };
  } catch {
    return { invalid: true, valueHash: shortHash(textValue) };
  }
}

function safeAuditResult(result = {}) {
  return {
    ok: result.ok === true,
    statusCode: result.statusCode || null,
    error: result.error || "",
    metricoolQueueItemId: result.metricoolQueueItemId || "",
    duplicateMetricoolQueueItemId: result.duplicateMetricoolQueueItemId || "",
    imported: result.imported ?? null,
    finalStatus: result.finalStatus || "",
    metricoolQueueItemIds: Array.isArray(result.metricoolQueueItemIds) ? result.metricoolQueueItemIds : [],
  };
}

function prunePreviewConfirmStore() {
  const now = Date.now();
  for (const [token, entry] of previewConfirmStore.entries()) {
    if (!entry || entry.expiresAt <= now) previewConfirmStore.delete(token);
  }
}

function createPreviewConfirmToken(type, rawText) {
  prunePreviewConfirmStore();
  const textValue = String(rawText || "");
  const token = randomBytes(18).toString("hex");
  const expiresAt = Date.now() + previewConfirmTtlMs;
  previewConfirmStore.set(token, {
    type,
    rawText: textValue,
    batchHash: shortHash(textValue),
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  const timeout = setTimeout(() => {
    const entry = previewConfirmStore.get(token);
    if (entry?.expiresAt === expiresAt) previewConfirmStore.delete(token);
  }, previewConfirmTtlMs);
  timeout.unref?.();
  return token;
}

function consumePreviewConfirmToken(token, expectedType) {
  prunePreviewConfirmStore();
  const textToken = String(token || "").trim();
  const entry = previewConfirmStore.get(textToken);
  if (!entry) {
    return { ok: false, statusCode: 410, error: "preview_confirmation_expired_or_used" };
  }
  previewConfirmStore.delete(textToken);
  if (entry.type !== expectedType) {
    return { ok: false, statusCode: 409, error: "preview_confirmation_type_mismatch" };
  }
  return { ok: true, ...entry };
}

async function appendEvidenceAuditLog(action, form, result) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    result: safeAuditResult(result),
    input: {
      metricoolQueueItemId: String(form.get("metricoolQueueItemId") || ""),
      scheduledBatchHash: shortHash(form.get("scheduledEvidenceBatch")),
      publishedBatchHash: shortHash(form.get("publishedEvidenceBatch")),
      metricoolApprovalUrl: safeUrlAudit(form.get("metricoolApprovalUrl")),
      publishedPostUrl: safeUrlAudit(form.get("publishedPostUrl")),
      operatorNotesHash: shortHash(form.get("operatorNotes")),
    },
  };
  try {
    await appendFile(operatorAuditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    return { ok: true, url: workspaceUrlForFilePath(operatorAuditLogPath) };
  } catch (error) {
    console.warn(`Clippers audit log append failed: ${error?.message || error}`);
    return { ok: false, error: error?.message || "audit_log_append_failed" };
  }
}

function buildOperatorAuditSummary(rawLog = "", metadata = {}) {
  const rawLines = String(rawLog || "").split(/\r?\n/).filter((line) => line.trim());
  const lines = metadata.truncated && rawLines.length > 1 ? rawLines.slice(1) : rawLines;
  const parsed = [];
  let invalidLines = metadata.truncated && rawLines.length > lines.length ? 1 : 0;
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      invalidLines += 1;
    }
  }
  const actions = {};
  for (const entry of parsed) {
    const action = String(entry.action || "unknown");
    actions[action] = (actions[action] || 0) + 1;
  }
  const accepted = parsed.filter((entry) => entry.result?.ok === true).length;
  const rejected = parsed.filter((entry) => entry.result?.ok === false).length;
  const last = parsed[parsed.length - 1] || null;
  return {
    status: parsed.length ? invalidLines ? "has_invalid_lines" : "ready" : "empty",
    path: operatorAuditLogPath,
    url: workspaceUrlForFilePath(operatorAuditLogPath),
    bytes: metadata.bytes || 0,
    truncated: metadata.truncated === true,
    summarizedEvents: lines.length,
    events: parsed.length,
    accepted,
    rejected,
    invalidLines,
    actions,
    lastEvent: last ? {
      ts: last.ts || "",
      action: last.action || "",
      ok: last.result?.ok === true,
      statusCode: last.result?.statusCode || null,
      error: last.result?.error || "",
      metricoolQueueItemId: last.result?.metricoolQueueItemId || last.input?.metricoolQueueItemId || "",
    } : null,
    redaction: "Audit stores hashed URLs/notes only; no full URLs, operator notes, CSRF tokens, or secrets.",
  };
}

const fakeEvidenceTextPattern = /\b(?:example\.com|evil\.example|localhost|127\.0\.0\.1|test-proof|preview-proof|confirm-now-proof|unsafe-return-proof|unsafe-confirm-return-proof|live-unsafe-return-proof|live-safe-return-preview|single-preview-proof|batch-secret-token|secret-proof-token|private-fragment)\b/i;
const evidenceFields = ["metricool_approval_url", "published_post_url", "final_status", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_notes"];

function safeEvidenceFinding({ file, rowNumber, queueItemId, field, code, detail }) {
  return {
    file,
    rowNumber,
    queueItemId: queueItemId || "",
    field: field || "",
    code,
    detail,
  };
}

function evidenceRowHasAnyEvidence(row = {}) {
  return evidenceFields.some((field) => String(row[field] || "").trim() !== "");
}

function hasStrictPublishedEvidence(row = {}) {
  return isMetricoolPlannerUrl(row.metricool_approval_url)
    && isTikTokVideoUrl(row.published_post_url)
    && metricValue(row.views_24h) !== null
    && Number(metricValue(row.views_24h)) > 0
    && metricValue(row.likes_24h) !== null
    && metricValue(row.comments_24h) !== null
    && metricValue(row.shares_24h) !== null
    && !validateOperatorNotes(row.operator_notes);
}

function inspectEvidenceRow(row, { file, rowNumber }) {
  const findings = [];
  const queueItemId = String(row.metricool_queue_item_id || "").trim();
  const finalStatus = String(row.final_status || "").trim().toLowerCase();
  for (const field of evidenceFields) {
    const value = String(row[field] || "").trim();
    if (!value) continue;
    if (secretTextPattern.test(value) || secretQueryParamPattern.test(value)) {
      findings.push(safeEvidenceFinding({
        file,
        rowNumber,
        queueItemId,
        field,
        code: "secret_like_evidence_value",
        detail: "Evidence field contains secret-like text or query parameters.",
      }));
    }
    if (proofPlaceholderPattern.test(value)) {
      findings.push(safeEvidenceFinding({
        file,
        rowNumber,
        queueItemId,
        field,
        code: "placeholder_evidence_value",
        detail: "Evidence field still contains placeholder/example text.",
      }));
    }
    if (fakeEvidenceTextPattern.test(value)) {
      findings.push(safeEvidenceFinding({
        file,
        rowNumber,
        queueItemId,
        field,
        code: "test_or_fake_evidence_marker",
        detail: "Evidence field contains a known fake/test marker.",
      }));
    }
  }
  const metricoolUrl = String(row.metricool_approval_url || "").trim();
  if (metricoolUrl && !isMetricoolPlannerUrl(metricoolUrl)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "metricool_approval_url",
      code: "invalid_metricool_planner_url",
      detail: "Metricool proof must be an exact HTTPS Metricool Planner URL with no query or hash.",
    }));
  }
  const publicUrl = String(row.published_post_url || "").trim();
  const publishedFieldsPresent = Boolean(publicUrl)
    || [row.views_24h, row.likes_24h, row.comments_24h, row.shares_24h].some((value) => String(value || "").trim() !== "");
  if (publicUrl && !isTikTokVideoUrl(publicUrl)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "published_post_url",
      code: "invalid_tiktok_video_url",
      detail: "Published proof must be an exact public TikTok video URL with no query or hash.",
    }));
  }
  if (metricoolUrl && !["scheduled", "published"].includes(finalStatus)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "final_status",
      code: "metricool_proof_without_recognized_final_status",
      detail: "Metricool proof requires final_status scheduled or published.",
    }));
  }
  if (publishedFieldsPresent && !["scheduled", "published"].includes(finalStatus)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "final_status",
      code: "published_fields_without_recognized_final_status",
      detail: "Public TikTok URL or metrics require final_status published.",
    }));
  }
  if (finalStatus === "scheduled" && !hasScheduledEvidence(row)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "final_status",
      code: "scheduled_status_without_valid_proof",
      detail: "Scheduled rows require valid Metricool Planner proof and concrete scheduled notes.",
    }));
  }
  if (finalStatus === "scheduled" && (publicUrl || [row.views_24h, row.likes_24h, row.comments_24h, row.shares_24h].some((value) => String(value || "").trim() !== ""))) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "final_status",
      code: "scheduled_status_with_published_fields",
      detail: "Scheduled rows must not include public TikTok URLs or metrics yet.",
    }));
  }
  if (finalStatus === "published" && !hasStrictPublishedEvidence(row)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "final_status",
      code: "published_status_without_complete_public_proof",
      detail: "Published rows require valid Metricool proof, exact TikTok URL, positive views, non-negative metrics, and concrete notes.",
    }));
  }
  if (finalStatus === "published" && !isMetricoolPlannerUrl(metricoolUrl)) {
    findings.push(safeEvidenceFinding({
      file,
      rowNumber,
      queueItemId,
      field: "metricool_approval_url",
      code: "published_status_without_valid_scheduled_proof",
      detail: "Published rows must preserve valid Metricool scheduled proof.",
    }));
  }
  return findings;
}

function buildEvidenceIntegritySummary({ batchEvidenceCsv = "", masterEvidenceCsv = "", operatorAudit = {}, rows = [] }) {
  const batchRows = batchEvidenceCsv ? parseCsv(batchEvidenceCsv).rows : [];
  const masterRows = masterEvidenceCsv ? parseCsv(masterEvidenceCsv).rows : [];
  const batchByQueueId = new Map(batchRows.map((row) => [String(row.metricool_queue_item_id || ""), row]));
  const masterByQueueId = new Map(masterRows.map((row) => [String(row.metricool_queue_item_id || ""), row]));
  const currentQueueIds = new Set(rows.map((row) => String(row.queueItemId || "")).filter(Boolean));
  const findings = [
    ...batchRows.flatMap((row, index) => inspectEvidenceRow(row, { file: "current_batch_evidence_csv", rowNumber: index + 2 })),
    ...masterRows.flatMap((row, index) => inspectEvidenceRow(row, { file: "master_evidence_csv", rowNumber: index + 2 })),
  ];
  const evidenceQueueIds = new Set([
    ...currentQueueIds,
    ...[...batchByQueueId.keys()].filter(Boolean),
  ]);
  for (const queueItemId of evidenceQueueIds) {
    const batchRow = batchByQueueId.get(queueItemId) || {};
    const masterRow = masterByQueueId.get(queueItemId) || {};
    const batchHasEvidence = evidenceRowHasAnyEvidence(batchRow);
    const masterHasEvidence = evidenceRowHasAnyEvidence(masterRow);
    if (!currentQueueIds.has(queueItemId) && batchHasEvidence) {
      findings.push(safeEvidenceFinding({
        file: "current_batch_evidence_csv",
        rowNumber: 0,
        queueItemId,
        field: "",
        code: "stale_batch_evidence_row",
        detail: "Batch evidence contains proof for a row outside the current TikTok session packet.",
      }));
    }
    for (const field of evidenceFields) {
      if (String(batchRow[field] || "") !== String(masterRow[field] || "")) {
        findings.push(safeEvidenceFinding({
          file: "current_batch_vs_master",
          rowNumber: 0,
          queueItemId,
          field,
          code: "batch_master_evidence_mismatch",
          detail: "Current batch and master evidence CSV disagree for this field.",
        }));
      }
    }
  }
  const currentBatchRowsWithEvidence = batchRows.filter(evidenceRowHasAnyEvidence).length;
  const masterCurrentBatchRowsWithEvidence = rows.filter((row) => evidenceRowHasAnyEvidence(masterByQueueId.get(String(row.queueItemId || "")) || {})).length;
  return {
    status: findings.length ? "blocked" : "clean",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    filesChecked: ["current_batch_evidence_csv", "master_evidence_csv", "operator_audit_log"],
    currentBatchRows: batchRows.length,
    masterRows: masterRows.length,
    currentBatchRowsWithEvidence,
    masterCurrentBatchRowsWithEvidence,
    operatorAuditEvents: operatorAudit.events || 0,
    findingsCount: findings.length,
    findings: findings.slice(0, 50),
    nextAction: findings.length
      ? "Fix or remove invalid/fake evidence before continuing Metricool scheduling."
      : "Evidence files are clean. Continue scheduling in Metricool and record only real planner proof.",
    redaction: "Findings do not include full URLs, notes, tokens, or raw evidence values.",
  };
}

function evidenceIntegrityBlockingFindings(status, metricoolQueueItemId = "") {
  const ignoredForWriteGate = new Set(["batch_master_evidence_mismatch"]);
  const targetScopedOnly = new Set(["stale_batch_evidence_row"]);
  const targetQueueItemId = String(metricoolQueueItemId || "").trim();
  return (status.evidenceIntegrity?.findings || []).filter((finding) => {
    if (ignoredForWriteGate.has(finding.code)) return false;
    if (!targetScopedOnly.has(finding.code)) return true;
    return targetQueueItemId && finding.queueItemId === targetQueueItemId;
  });
}

async function atomicWriteFile(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, filePath);
}

async function withEvidenceCsvLock(callback) {
  return withExclusiveFileLock(batchEvidenceLockPath, "batch_evidence_csv_locked", callback);
}

async function withPermissionCrmLock(callback) {
  return withExclusiveFileLock(realClipPermissionCrmLockPath, "permission_crm_locked", callback);
}

async function withHumanReviewDecisionLock(callback) {
  return withExclusiveFileLock(humanReviewDecisionsLockPath, "human_review_decisions_locked", callback);
}

async function withRealClipIntakeManifestLock(callback) {
  return withExclusiveFileLock(realClipIntakeManifestLockPath, "real_clip_intake_manifest_locked", callback);
}

async function withExclusiveFileLock(lockPath, lockedError, callback) {
  let handle = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      handle = await open(lockPath, "wx");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) return { ok: false, statusCode: 423, error: lockedError };
  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

function validateScheduledEvidenceInput(input) {
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const metricoolApprovalUrl = String(input.metricoolApprovalUrl || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  if (!/^[a-z0-9_-]{6,80}$/i.test(metricoolQueueItemId)) {
    return { ok: false, statusCode: 400, error: "invalid_metricool_queue_item_id", metricoolQueueItemId };
  }
  if (!isMetricoolPlannerUrl(metricoolApprovalUrl)) {
    return { ok: false, statusCode: 400, error: "metricool_approval_url_must_be_https_metricool_planner_url", metricoolQueueItemId };
  }
  const noteError = validateScheduledOperatorNotes(operatorNotes);
  if (noteError) return { ok: false, statusCode: 400, error: noteError, metricoolQueueItemId };
  return { ok: true, metricoolQueueItemId, metricoolApprovalUrl, operatorNotes };
}

function assertTikTokEvidenceRow(row, metricoolQueueItemId) {
  if (!isTikTokPlatform(row?.platform)) {
    return {
      ok: false,
      statusCode: 409,
      error: "non_tiktok_metricool_row_deferred",
      metricoolQueueItemId,
      platform: row?.platform || "",
    };
  }
  return { ok: true };
}

function canonicalEvidenceUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function findDuplicateEvidenceUrl(rows, { url, fieldName, metricoolQueueItemId }) {
  const target = canonicalEvidenceUrl(url);
  if (!target) return null;
  return rows.find((row) => {
    if (String(row.metricool_queue_item_id || "") === String(metricoolQueueItemId || "")) return false;
    return canonicalEvidenceUrl(row[fieldName]) === target;
  }) || null;
}

async function readCurrentTikTokQueueItemIds() {
  const sessionPacket = await readJson(sessionPacketJsonPath, {});
  return new Set((sessionPacket.rows || [])
    .filter((row) => isTikTokPlatform(row.platform))
    .map((row) => String(row.metricoolQueueItemId || "").trim())
    .filter(Boolean));
}

function assertCurrentBatchQueueItem(currentQueueItemIds, metricoolQueueItemId) {
  if (!currentQueueItemIds.has(String(metricoolQueueItemId || ""))) {
    return {
      ok: false,
      statusCode: 409,
      error: "metricool_queue_item_not_in_current_tiktok_batch",
      metricoolQueueItemId,
    };
  }
  return { ok: true };
}

function assertScheduleWindowOpenForScheduling(status, metricoolQueueItemId = "") {
  if (status.operatorSummary?.needsRollForward === true) {
    return {
      ok: false,
      statusCode: 409,
      error: "schedule_needs_roll_forward_before_scheduled_proof",
      metricoolQueueItemId,
      leadMinutes: status.operatorSummary?.leadMinutes ?? null,
      scheduleWindowStatus: status.operatorSummary?.scheduleWindowStatus || "unknown",
      deadlineQueueItemId: status.operatorSummary?.deadlineQueueItemId || "",
      nextAction: "Roll forward the batch before recording new Metricool scheduled proof.",
    };
  }
  return { ok: true };
}

function assertUploadPackReadyForScheduling(status, metricoolQueueItemId = "") {
  if (status.uploadPackIntegrity?.status !== "ready") {
    const blockedRow = status.uploadPackIntegrity?.blockedRows?.[0] || {};
    return {
      ok: false,
      statusCode: 409,
      error: "upload_pack_blocked",
      metricoolQueueItemId,
      uploadPackStatus: status.uploadPackIntegrity?.status || "unknown",
      missingFiles: status.uploadPackIntegrity?.missingFiles || 0,
      zeroByteFiles: status.uploadPackIntegrity?.zeroByteFiles || 0,
      blockedQueueItemId: blockedRow.queueItemId || "",
      blockedUploadFileName: blockedRow.uploadFileName || "",
      nextAction: "Fix the local upload pack before recording Metricool scheduled proof.",
    };
  }
  return { ok: true };
}

function assertRealClipIntakeReadyForScheduling(status, metricoolQueueItemId = "") {
  if (status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status)) {
    return {
      ok: false,
      statusCode: 409,
      error: "real_clip_intake_not_ready",
      metricoolQueueItemId,
      readyRows: status.realClipIntakeValidation?.readyRows || 0,
      blockedRows: status.realClipIntakeValidation?.blockedRows || 0,
      nextAction: status.realClipIntakeValidation?.nextAction || "Complete real clip intake before recording Metricool scheduled proof.",
    };
  }
  return { ok: true };
}

function realClipIntakeReadyForScheduling(intakeStatus) {
  return String(intakeStatus || "") === "ready_for_source_drop_import";
}

function assertEvidenceIntegrityClean(status, metricoolQueueItemId = "") {
  const blockingFindings = evidenceIntegrityBlockingFindings(status, metricoolQueueItemId);
  if (blockingFindings.length) {
    return {
      ok: false,
      statusCode: 409,
      error: "evidence_integrity_blocked",
      metricoolQueueItemId,
      findingsCount: blockingFindings.length,
      nextAction: status.evidenceIntegrity?.nextAction || "Fix evidence integrity findings before recording new evidence.",
    };
  }
  return { ok: true };
}

function pendingScheduledProofRows(status) {
  return (status.metricoolSchedulingRunSheet?.rows || [])
    .filter((row) => !row.hasMetricoolScheduledEvidence);
}

function assertScheduledProofDeadlineOrder(status, metricoolQueueItemIds) {
  const submittedIds = metricoolQueueItemIds.map((id) => String(id || "").trim()).filter(Boolean);
  const expectedIds = pendingScheduledProofRows(status)
    .slice(0, submittedIds.length)
    .map((row) => row.queueItemId);
  const mismatchIndex = submittedIds.findIndex((id, index) => id !== expectedIds[index]);
  if (mismatchIndex !== -1 || submittedIds.length !== expectedIds.length) {
    const nextRow = pendingScheduledProofRows(status)[0] || null;
    return {
      ok: false,
      statusCode: 409,
      error: "scheduled_proof_deadline_order_required",
      metricoolQueueItemId: submittedIds[mismatchIndex] || submittedIds[0] || "",
      expectedQueueItemId: expectedIds[mismatchIndex] || nextRow?.queueItemId || "",
      expectedNextQueueItemId: nextRow?.queueItemId || "",
      expectedNextUploadFileName: nextRow?.uploadFileName || "",
      nextAction: "Record Metricool scheduled proof in deadline order. If importing a batch, include the next pending deadline rows as a prefix.",
    };
  }
  return { ok: true };
}

function parseScheduledEvidenceBatchInput(rawText) {
  const lines = String(rawText || "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { ok: false, statusCode: 400, error: "scheduled_batch_empty", records: [] };
  const firstCells = parseCsvLine(lines[0]).map((cell) => cell.trim());
  const hasHeader = firstCells.some((cell) => ["metricool_queue_item_id", "metricoolQueueItemId", "queue_id"].includes(cell));
  const header = hasHeader ? firstCells : ["metricool_queue_item_id", "metricool_approval_url", "operator_notes"];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const records = dataLines.map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] || ""]));
    return {
      line: hasHeader ? index + 2 : index + 1,
      metricoolQueueItemId: row.metricoolQueueItemId || row.metricool_queue_item_id || row.queue_id,
      metricoolApprovalUrl: row.metricoolApprovalUrl || row.metricool_approval_url || row.approval_url,
      operatorNotes: row.operatorNotes || row.operator_notes || row.notes,
    };
  });
  if (!records.length) return { ok: false, statusCode: 400, error: "scheduled_batch_empty", records: [] };
  if (records.length > 10) return { ok: false, statusCode: 400, error: "scheduled_batch_max_10_rows", records: [] };
  return { ok: true, statusCode: 200, records };
}

async function recordScheduledEvidence(input) {
  const validated = validateScheduledEvidenceInput(input);
  if (!validated.ok) return validated;
  const { metricoolQueueItemId, metricoolApprovalUrl, operatorNotes } = validated;

  return withEvidenceCsvLock(async () => {
    const currentQueueItemIds = await readCurrentTikTokQueueItemIds();
    const raw = await readFile(batchEvidenceCsvPath, "utf8");
    const { header, rows } = parseCsv(raw);
    const row = rows.find((candidate) => candidate.metricool_queue_item_id === metricoolQueueItemId);
    if (!row) return { ok: false, statusCode: 404, error: "metricool_queue_item_not_found" };
    const tiktokRow = assertTikTokEvidenceRow(row, metricoolQueueItemId);
    if (!tiktokRow.ok) return tiktokRow;
    const currentBatchRow = assertCurrentBatchQueueItem(currentQueueItemIds, metricoolQueueItemId);
    if (!currentBatchRow.ok) return currentBatchRow;
    if (hasPublishedEvidence(row)) {
      return {
        ok: false,
        statusCode: 409,
        error: "published_evidence_exists_cannot_replace_scheduled_proof",
        metricoolQueueItemId,
      };
    }
    if (hasScheduledProofEvidence(row)) {
      return {
        ok: false,
        statusCode: 409,
        error: "scheduled_evidence_exists_cannot_replace_scheduled_proof",
        metricoolQueueItemId,
      };
    }
    const duplicateUrlRow = findDuplicateEvidenceUrl(rows, {
      url: metricoolApprovalUrl,
      fieldName: "metricool_approval_url",
      metricoolQueueItemId,
    });
    if (duplicateUrlRow) {
      return {
        ok: false,
        statusCode: 409,
        error: "duplicate_metricool_approval_url",
        metricoolQueueItemId,
        duplicateMetricoolQueueItemId: duplicateUrlRow.metricool_queue_item_id || "",
      };
    }
    const status = await buildStatus();
    const uploadPack = assertUploadPackReadyForScheduling(status, metricoolQueueItemId);
    if (!uploadPack.ok) return uploadPack;
    const scheduleWindow = assertScheduleWindowOpenForScheduling(status, metricoolQueueItemId);
    if (!scheduleWindow.ok) return scheduleWindow;
    const deadlineOrder = assertScheduledProofDeadlineOrder(status, [metricoolQueueItemId]);
    if (!deadlineOrder.ok) return deadlineOrder;
    const integrity = assertEvidenceIntegrityClean(status, metricoolQueueItemId);
    if (!integrity.ok) return integrity;
    const realClipIntake = assertRealClipIntakeReadyForScheduling(status, metricoolQueueItemId);
    if (!realClipIntake.ok) return realClipIntake;
    row.metricool_approval_url = metricoolApprovalUrl;
    row.final_status = "scheduled";
    row.operator_notes = operatorNotes;
    row.published_post_url = "";
    row.views_24h = "";
    row.likes_24h = "";
    row.comments_24h = "";
    row.shares_24h = "";
    await atomicWriteFile(batchEvidenceCsvPath, renderCsv(header, rows));
    return {
      ok: true,
      statusCode: 200,
      metricoolQueueItemId,
      finalStatus: "scheduled",
      evidenceCsvUrl: workspaceUrlForFilePath(batchEvidenceCsvPath),
    };
  });
}

async function validateScheduledEvidenceBatch(rawText, { requireExistingRows = false } = {}) {
  const parsed = parseScheduledEvidenceBatchInput(rawText);
  if (!parsed.ok) return parsed;
  const validatedRecords = [];
  const seen = new Set();
  const seenApprovalUrls = new Map();
  for (const record of parsed.records) {
    const validated = validateScheduledEvidenceInput(record);
    if (!validated.ok) {
      return { ...validated, statusCode: 400, line: record.line, ok: false };
    }
    if (seen.has(validated.metricoolQueueItemId)) {
      return { ok: false, statusCode: 400, error: "duplicate_metricool_queue_item_id", metricoolQueueItemId: validated.metricoolQueueItemId, line: record.line };
    }
    const approvalUrlKey = canonicalEvidenceUrl(validated.metricoolApprovalUrl);
    if (seenApprovalUrls.has(approvalUrlKey)) {
      return {
        ok: false,
        statusCode: 400,
        error: "duplicate_metricool_approval_url",
        metricoolQueueItemId: validated.metricoolQueueItemId,
        duplicateMetricoolQueueItemId: seenApprovalUrls.get(approvalUrlKey),
        line: record.line,
      };
    }
    seen.add(validated.metricoolQueueItemId);
    seenApprovalUrls.set(approvalUrlKey, validated.metricoolQueueItemId);
    validatedRecords.push(validated);
  }
  if (requireExistingRows) {
    const currentQueueItemIds = await readCurrentTikTokQueueItemIds();
    const raw = await readFile(batchEvidenceCsvPath, "utf8");
    const { rows } = parseCsv(raw);
    const rowsById = new Map(rows.map((row) => [row.metricool_queue_item_id, row]));
    for (const record of validatedRecords) {
      const row = rowsById.get(record.metricoolQueueItemId);
      if (!row) {
        return { ok: false, statusCode: 404, error: "metricool_queue_item_not_found", metricoolQueueItemId: record.metricoolQueueItemId };
      }
      const tiktokRow = assertTikTokEvidenceRow(row, record.metricoolQueueItemId);
      if (!tiktokRow.ok) return tiktokRow;
      const currentBatchRow = assertCurrentBatchQueueItem(currentQueueItemIds, record.metricoolQueueItemId);
      if (!currentBatchRow.ok) return currentBatchRow;
      if (hasPublishedEvidence(row)) {
        return {
          ok: false,
          statusCode: 409,
          error: "published_evidence_exists_cannot_replace_scheduled_proof",
          metricoolQueueItemId: record.metricoolQueueItemId,
        };
      }
      if (hasScheduledProofEvidence(row)) {
        return {
          ok: false,
          statusCode: 409,
          error: "scheduled_evidence_exists_cannot_replace_scheduled_proof",
          metricoolQueueItemId: record.metricoolQueueItemId,
        };
      }
      const duplicateUrlRow = findDuplicateEvidenceUrl(rows, {
        url: record.metricoolApprovalUrl,
        fieldName: "metricool_approval_url",
        metricoolQueueItemId: record.metricoolQueueItemId,
      });
      if (duplicateUrlRow) {
        return {
          ok: false,
          statusCode: 409,
          error: "duplicate_metricool_approval_url",
          metricoolQueueItemId: record.metricoolQueueItemId,
          duplicateMetricoolQueueItemId: duplicateUrlRow.metricool_queue_item_id || "",
        };
      }
    }
    const status = await buildStatus();
    const uploadPack = assertUploadPackReadyForScheduling(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!uploadPack.ok) return uploadPack;
    const scheduleWindow = assertScheduleWindowOpenForScheduling(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!scheduleWindow.ok) return scheduleWindow;
    const deadlineOrder = assertScheduledProofDeadlineOrder(status, validatedRecords.map((record) => record.metricoolQueueItemId));
    if (!deadlineOrder.ok) return deadlineOrder;
    const integrity = assertEvidenceIntegrityClean(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!integrity.ok) return integrity;
    const realClipIntake = assertRealClipIntakeReadyForScheduling(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!realClipIntake.ok) return realClipIntake;
  }
  return {
    ok: true,
    statusCode: 200,
    records: validatedRecords,
    validated: validatedRecords.length,
    metricoolQueueItemIds: validatedRecords.map((record) => record.metricoolQueueItemId),
  };
}

function buildEvidencePreviewRows(records, status, { finalStatus }) {
  const rowsById = new Map((status.rows || []).map((row) => [row.queueItemId, row]));
  return records.map((record) => {
    const row = rowsById.get(record.metricoolQueueItemId) || {};
    return {
      line: record.line || null,
      metricoolQueueItemId: record.metricoolQueueItemId,
      rank: row.rank || "",
      brand: row.metricoolBrandName || "",
      accountName: row.accountName || "",
      platform: row.platform || "",
      publishAt: row.publishAt || "",
      publishAtLocal: formatOperatorDateTime(row.publishAt),
      uploadFileName: row.uploadFileName || "",
      captionSeed: row.captionSeed || "",
      currentEvidenceState: row.evidenceState || "unknown",
      finalStatus,
    };
  });
}

async function previewScheduledEvidenceBatch(rawText) {
  const result = await validateScheduledEvidenceBatch(rawText, { requireExistingRows: true });
  if (!result.ok) return result;
  const status = await buildStatus();
  return {
    ok: true,
    statusCode: 200,
    preview: true,
    wouldImport: result.validated,
    metricoolQueueItemIds: result.metricoolQueueItemIds,
    rows: buildEvidencePreviewRows(result.records, status, { finalStatus: "scheduled" }),
    writes: false,
  };
}

async function previewScheduledEvidence(input) {
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const metricoolApprovalUrl = String(input.metricoolApprovalUrl || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  return previewScheduledEvidenceBatch(renderCsv(
    ["metricool_queue_item_id", "metricool_approval_url", "operator_notes"],
    [{
      metricool_queue_item_id: metricoolQueueItemId,
      metricool_approval_url: metricoolApprovalUrl,
      operator_notes: operatorNotes,
    }],
  ));
}

async function recordScheduledEvidenceBatch(rawText) {
  const validation = await validateScheduledEvidenceBatch(rawText);
  if (!validation.ok) return validation;
  const validatedRecords = validation.records;

  return withEvidenceCsvLock(async () => {
    const currentQueueItemIds = await readCurrentTikTokQueueItemIds();
    const raw = await readFile(batchEvidenceCsvPath, "utf8");
    const { header, rows } = parseCsv(raw);
    const rowsById = new Map(rows.map((row) => [row.metricool_queue_item_id, row]));
    for (const record of validatedRecords) {
      const row = rowsById.get(record.metricoolQueueItemId);
      if (!row) {
        return { ok: false, statusCode: 404, error: "metricool_queue_item_not_found", metricoolQueueItemId: record.metricoolQueueItemId };
      }
      const tiktokRow = assertTikTokEvidenceRow(row, record.metricoolQueueItemId);
      if (!tiktokRow.ok) return tiktokRow;
      const currentBatchRow = assertCurrentBatchQueueItem(currentQueueItemIds, record.metricoolQueueItemId);
      if (!currentBatchRow.ok) return currentBatchRow;
      if (hasPublishedEvidence(row)) {
        return {
          ok: false,
          statusCode: 409,
          error: "published_evidence_exists_cannot_replace_scheduled_proof",
          metricoolQueueItemId: record.metricoolQueueItemId,
        };
      }
      if (hasScheduledProofEvidence(row)) {
        return {
          ok: false,
          statusCode: 409,
          error: "scheduled_evidence_exists_cannot_replace_scheduled_proof",
          metricoolQueueItemId: record.metricoolQueueItemId,
        };
      }
      const duplicateUrlRow = findDuplicateEvidenceUrl(rows, {
        url: record.metricoolApprovalUrl,
        fieldName: "metricool_approval_url",
        metricoolQueueItemId: record.metricoolQueueItemId,
      });
      if (duplicateUrlRow) {
        return {
          ok: false,
          statusCode: 409,
          error: "duplicate_metricool_approval_url",
          metricoolQueueItemId: record.metricoolQueueItemId,
          duplicateMetricoolQueueItemId: duplicateUrlRow.metricool_queue_item_id || "",
        };
      }
    }
    const status = await buildStatus();
    const uploadPack = assertUploadPackReadyForScheduling(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!uploadPack.ok) return uploadPack;
    const scheduleWindow = assertScheduleWindowOpenForScheduling(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!scheduleWindow.ok) return scheduleWindow;
    const deadlineOrder = assertScheduledProofDeadlineOrder(status, validatedRecords.map((record) => record.metricoolQueueItemId));
    if (!deadlineOrder.ok) return deadlineOrder;
    const integrity = assertEvidenceIntegrityClean(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!integrity.ok) return integrity;
    const realClipIntake = assertRealClipIntakeReadyForScheduling(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!realClipIntake.ok) return realClipIntake;
    for (const record of validatedRecords) {
      const row = rowsById.get(record.metricoolQueueItemId);
      row.metricool_approval_url = record.metricoolApprovalUrl;
      row.final_status = "scheduled";
      row.operator_notes = record.operatorNotes;
      row.published_post_url = "";
      row.views_24h = "";
      row.likes_24h = "";
      row.comments_24h = "";
      row.shares_24h = "";
    }
    await atomicWriteFile(batchEvidenceCsvPath, renderCsv(header, rows));
    return {
      ok: true,
      statusCode: 200,
      imported: validatedRecords.length,
      metricoolQueueItemIds: validatedRecords.map((record) => record.metricoolQueueItemId),
      finalStatus: "scheduled",
      evidenceCsvUrl: workspaceUrlForFilePath(batchEvidenceCsvPath),
    };
  });
}

function validatePublishedEvidenceInput(input) {
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const publishedPostUrl = String(input.publishedPostUrl || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  if (!/^[a-z0-9_-]{6,80}$/i.test(metricoolQueueItemId)) {
    return { ok: false, statusCode: 400, error: "invalid_metricool_queue_item_id", metricoolQueueItemId };
  }
  if (!isTikTokVideoUrl(publishedPostUrl)) {
    return { ok: false, statusCode: 400, error: "published_post_url_must_be_exact_https_tiktok_video_url", metricoolQueueItemId };
  }
  const noteError = validateOperatorNotes(operatorNotes);
  if (noteError) return { ok: false, statusCode: 400, error: noteError, metricoolQueueItemId };
  const metrics = {
    views_24h: metricValue(input.views24h),
    likes_24h: metricValue(input.likes24h),
    comments_24h: metricValue(input.comments24h),
    shares_24h: metricValue(input.shares24h),
  };
  if (Object.values(metrics).some((value) => value === null)) {
    return { ok: false, statusCode: 400, error: "metrics_must_be_non_negative_integers", metricoolQueueItemId };
  }
  if (Number(metrics.views_24h) <= 0) {
    return { ok: false, statusCode: 400, error: "views_24h_must_be_positive", metricoolQueueItemId };
  }
  return { ok: true, metricoolQueueItemId, publishedPostUrl, operatorNotes, metrics };
}

function parsePublishedEvidenceBatchInput(rawText) {
  const lines = String(rawText || "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { ok: false, statusCode: 400, error: "published_batch_empty", records: [] };
  const firstCells = parseCsvLine(lines[0]).map((cell) => cell.trim());
  const hasHeader = firstCells.some((cell) => ["metricool_queue_item_id", "metricoolQueueItemId", "queue_id"].includes(cell));
  const header = hasHeader ? firstCells : ["metricool_queue_item_id", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_notes"];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const records = dataLines.map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] || ""]));
    return {
      line: hasHeader ? index + 2 : index + 1,
      metricoolQueueItemId: row.metricoolQueueItemId || row.metricool_queue_item_id || row.queue_id,
      publishedPostUrl: row.publishedPostUrl || row.published_post_url || row.tiktok_url,
      views24h: row.views24h || row.views_24h,
      likes24h: row.likes24h || row.likes_24h,
      comments24h: row.comments24h || row.comments_24h,
      shares24h: row.shares24h || row.shares_24h,
      operatorNotes: row.operatorNotes || row.operator_notes || row.notes,
    };
  });
  if (!records.length) return { ok: false, statusCode: 400, error: "published_batch_empty", records: [] };
  if (records.length > 10) return { ok: false, statusCode: 400, error: "published_batch_max_10_rows", records: [] };
  return { ok: true, statusCode: 200, records };
}

async function recordPublishedEvidence(input) {
  const validated = validatePublishedEvidenceInput(input);
  if (!validated.ok) return validated;
  const { metricoolQueueItemId, publishedPostUrl, operatorNotes, metrics } = validated;

  return withEvidenceCsvLock(async () => {
    const currentQueueItemIds = await readCurrentTikTokQueueItemIds();
    const raw = await readFile(batchEvidenceCsvPath, "utf8");
    const { header, rows } = parseCsv(raw);
    const row = rows.find((candidate) => candidate.metricool_queue_item_id === metricoolQueueItemId);
    if (!row) return { ok: false, statusCode: 404, error: "metricool_queue_item_not_found" };
    const tiktokRow = assertTikTokEvidenceRow(row, metricoolQueueItemId);
    if (!tiktokRow.ok) return tiktokRow;
    const currentBatchRow = assertCurrentBatchQueueItem(currentQueueItemIds, metricoolQueueItemId);
    if (!currentBatchRow.ok) return currentBatchRow;
    if (hasPublishedEvidence(row)) {
      return {
        ok: false,
        statusCode: 409,
        error: "published_evidence_exists_cannot_replace_published_metrics",
        metricoolQueueItemId,
      };
    }
    if (!hasScheduledEvidence(row)) {
      return { ok: false, statusCode: 409, error: "scheduled_metricool_evidence_required_before_published" };
    }
    const duplicateUrlRow = findDuplicateEvidenceUrl(rows, {
      url: publishedPostUrl,
      fieldName: "published_post_url",
      metricoolQueueItemId,
    });
    if (duplicateUrlRow) {
      return {
        ok: false,
        statusCode: 409,
        error: "duplicate_published_post_url",
        metricoolQueueItemId,
        duplicateMetricoolQueueItemId: duplicateUrlRow.metricool_queue_item_id || "",
      };
    }
    const status = await buildStatus();
    const integrity = assertEvidenceIntegrityClean(status, metricoolQueueItemId);
    if (!integrity.ok) return integrity;
    row.published_post_url = publishedPostUrl;
    row.final_status = "published";
    row.views_24h = metrics.views_24h;
    row.likes_24h = metrics.likes_24h;
    row.comments_24h = metrics.comments_24h;
    row.shares_24h = metrics.shares_24h;
    row.operator_notes = operatorNotes;
    await atomicWriteFile(batchEvidenceCsvPath, renderCsv(header, rows));
    return {
      ok: true,
      statusCode: 200,
      metricoolQueueItemId,
      finalStatus: "published",
      evidenceCsvUrl: workspaceUrlForFilePath(batchEvidenceCsvPath),
    };
  });
}

async function validatePublishedEvidenceBatch(rawText, { requireScheduledRows = false } = {}) {
  const parsed = parsePublishedEvidenceBatchInput(rawText);
  if (!parsed.ok) return parsed;
  const validatedRecords = [];
  const seen = new Set();
  const seenPublishedUrls = new Map();
  for (const record of parsed.records) {
    const validated = validatePublishedEvidenceInput(record);
    if (!validated.ok) {
      return { ...validated, statusCode: 400, line: record.line, ok: false };
    }
    if (seen.has(validated.metricoolQueueItemId)) {
      return { ok: false, statusCode: 400, error: "duplicate_metricool_queue_item_id", metricoolQueueItemId: validated.metricoolQueueItemId, line: record.line };
    }
    const publishedUrlKey = canonicalEvidenceUrl(validated.publishedPostUrl);
    if (seenPublishedUrls.has(publishedUrlKey)) {
      return {
        ok: false,
        statusCode: 400,
        error: "duplicate_published_post_url",
        metricoolQueueItemId: validated.metricoolQueueItemId,
        duplicateMetricoolQueueItemId: seenPublishedUrls.get(publishedUrlKey),
        line: record.line,
      };
    }
    seen.add(validated.metricoolQueueItemId);
    seenPublishedUrls.set(publishedUrlKey, validated.metricoolQueueItemId);
    validatedRecords.push(validated);
  }
  if (requireScheduledRows) {
    const currentQueueItemIds = await readCurrentTikTokQueueItemIds();
    const raw = await readFile(batchEvidenceCsvPath, "utf8");
    const { rows } = parseCsv(raw);
    const rowsById = new Map(rows.map((row) => [row.metricool_queue_item_id, row]));
    for (const record of validatedRecords) {
      const row = rowsById.get(record.metricoolQueueItemId);
      if (!row) {
        return { ok: false, statusCode: 404, error: "metricool_queue_item_not_found", metricoolQueueItemId: record.metricoolQueueItemId };
      }
      const tiktokRow = assertTikTokEvidenceRow(row, record.metricoolQueueItemId);
      if (!tiktokRow.ok) return tiktokRow;
      const currentBatchRow = assertCurrentBatchQueueItem(currentQueueItemIds, record.metricoolQueueItemId);
      if (!currentBatchRow.ok) return currentBatchRow;
      if (hasPublishedEvidence(row)) {
        return {
          ok: false,
          statusCode: 409,
          error: "published_evidence_exists_cannot_replace_published_metrics",
          metricoolQueueItemId: record.metricoolQueueItemId,
        };
      }
      if (!hasScheduledEvidence(row)) {
        return { ok: false, statusCode: 409, error: "scheduled_metricool_evidence_required_before_published", metricoolQueueItemId: record.metricoolQueueItemId };
      }
      const duplicateUrlRow = findDuplicateEvidenceUrl(rows, {
        url: record.publishedPostUrl,
        fieldName: "published_post_url",
        metricoolQueueItemId: record.metricoolQueueItemId,
      });
      if (duplicateUrlRow) {
        return {
          ok: false,
          statusCode: 409,
          error: "duplicate_published_post_url",
          metricoolQueueItemId: record.metricoolQueueItemId,
          duplicateMetricoolQueueItemId: duplicateUrlRow.metricool_queue_item_id || "",
        };
      }
    }
  }
  return {
    ok: true,
    statusCode: 200,
    records: validatedRecords,
    validated: validatedRecords.length,
    metricoolQueueItemIds: validatedRecords.map((record) => record.metricoolQueueItemId),
  };
}

async function previewPublishedEvidenceBatch(rawText) {
  const result = await validatePublishedEvidenceBatch(rawText, { requireScheduledRows: true });
  if (!result.ok) return result;
  const status = await buildStatus();
  return {
    ok: true,
    statusCode: 200,
    preview: true,
    wouldImport: result.validated,
    metricoolQueueItemIds: result.metricoolQueueItemIds,
    rows: buildEvidencePreviewRows(result.records, status, { finalStatus: "published" }),
    writes: false,
  };
}

async function previewPublishedEvidence(input) {
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const publishedPostUrl = String(input.publishedPostUrl || "").trim();
  const views24h = String(input.views24h || "").trim();
  const likes24h = String(input.likes24h || "").trim();
  const comments24h = String(input.comments24h || "").trim();
  const shares24h = String(input.shares24h || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  return previewPublishedEvidenceBatch(renderCsv(
    ["metricool_queue_item_id", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_notes"],
    [{
      metricool_queue_item_id: metricoolQueueItemId,
      published_post_url: publishedPostUrl,
      views_24h: views24h,
      likes_24h: likes24h,
      comments_24h: comments24h,
      shares_24h: shares24h,
      operator_notes: operatorNotes,
    }],
  ));
}

async function recordPublishedEvidenceBatch(rawText) {
  const validation = await validatePublishedEvidenceBatch(rawText);
  if (!validation.ok) return validation;
  const validatedRecords = validation.records;

  return withEvidenceCsvLock(async () => {
    const currentQueueItemIds = await readCurrentTikTokQueueItemIds();
    const raw = await readFile(batchEvidenceCsvPath, "utf8");
    const { header, rows } = parseCsv(raw);
    const rowsById = new Map(rows.map((row) => [row.metricool_queue_item_id, row]));
    for (const record of validatedRecords) {
      const row = rowsById.get(record.metricoolQueueItemId);
      if (!row) {
        return { ok: false, statusCode: 404, error: "metricool_queue_item_not_found", metricoolQueueItemId: record.metricoolQueueItemId };
      }
      const tiktokRow = assertTikTokEvidenceRow(row, record.metricoolQueueItemId);
      if (!tiktokRow.ok) return tiktokRow;
      const currentBatchRow = assertCurrentBatchQueueItem(currentQueueItemIds, record.metricoolQueueItemId);
      if (!currentBatchRow.ok) return currentBatchRow;
      if (hasPublishedEvidence(row)) {
        return {
          ok: false,
          statusCode: 409,
          error: "published_evidence_exists_cannot_replace_published_metrics",
          metricoolQueueItemId: record.metricoolQueueItemId,
        };
      }
      if (!hasScheduledEvidence(row)) {
        return { ok: false, statusCode: 409, error: "scheduled_metricool_evidence_required_before_published", metricoolQueueItemId: record.metricoolQueueItemId };
      }
      const duplicateUrlRow = findDuplicateEvidenceUrl(rows, {
        url: record.publishedPostUrl,
        fieldName: "published_post_url",
        metricoolQueueItemId: record.metricoolQueueItemId,
      });
      if (duplicateUrlRow) {
        return {
          ok: false,
          statusCode: 409,
          error: "duplicate_published_post_url",
          metricoolQueueItemId: record.metricoolQueueItemId,
          duplicateMetricoolQueueItemId: duplicateUrlRow.metricool_queue_item_id || "",
        };
      }
    }
    const status = await buildStatus();
    const integrity = assertEvidenceIntegrityClean(status, validatedRecords[0]?.metricoolQueueItemId || "");
    if (!integrity.ok) return integrity;
    for (const record of validatedRecords) {
      const row = rowsById.get(record.metricoolQueueItemId);
      row.published_post_url = record.publishedPostUrl;
      row.final_status = "published";
      row.views_24h = record.metrics.views_24h;
      row.likes_24h = record.metrics.likes_24h;
      row.comments_24h = record.metrics.comments_24h;
      row.shares_24h = record.metrics.shares_24h;
      row.operator_notes = record.operatorNotes;
    }
    await atomicWriteFile(batchEvidenceCsvPath, renderCsv(header, rows));
    return {
      ok: true,
      statusCode: 200,
      imported: validatedRecords.length,
      metricoolQueueItemIds: validatedRecords.map((record) => record.metricoolQueueItemId),
      finalStatus: "published",
      evidenceCsvUrl: workspaceUrlForFilePath(batchEvidenceCsvPath),
    };
  });
}

function validateExternalProofText(value, fieldName, minLength = 20) {
  const textValue = String(value || "").trim();
  if (textValue.length < minLength) return `${fieldName}_min_${minLength}_chars`;
  if (/[\r\n]{3,}/.test(textValue)) return `${fieldName}_too_many_blank_lines`;
  if (proofPlaceholderPattern.test(textValue)) return `${fieldName}_must_not_contain_placeholders`;
  if (secretTextPattern.test(textValue) || secretQueryParamPattern.test(textValue)) return `${fieldName}_looks_like_secret`;
  return "";
}

async function safeExternalProofPath(proofPath) {
  const normalizedProofPath = String(proofPath || "").startsWith("/clippers-workspace/")
    ? path.join(workspaceRoot, String(proofPath || "").replace(/^\/clippers-workspace\/?/, ""))
    : String(proofPath || "");
  const resolved = path.resolve(normalizedProofPath);
  const evidenceDropRoot = path.join(workspaceRoot, "evidence-drop");
  if (!(resolved === externalProofsDir || resolved.startsWith(externalProofsDir + path.sep))) return "";
  const [evidenceDropStat, externalProofsStat] = await Promise.all([
    lstat(evidenceDropRoot).catch(() => null),
    lstat(externalProofsDir).catch(() => null),
  ]);
  if (evidenceDropStat?.isSymbolicLink() || externalProofsStat?.isSymbolicLink()) return "";
  const [workspaceRealPath, proofsRealPath] = await Promise.all([
    realpath(workspaceRoot).catch(() => ""),
    realpath(externalProofsDir).catch(() => ""),
  ]);
  const proofParentRealPath = await realpath(path.dirname(resolved)).catch(() => "");
  if (!workspaceRealPath || !proofsRealPath || !proofParentRealPath) return "";
  if (proofsRealPath !== workspaceRealPath && !proofsRealPath.startsWith(workspaceRealPath + path.sep)) return "";
  if (!proofParentRealPath.startsWith(proofsRealPath + path.sep) && proofParentRealPath !== proofsRealPath) return "";
  if (!resolved.startsWith(workspaceRoot + path.sep)) return "";
  return resolved;
}

async function recordNextExternalProof(input) {
  const status = await buildStatus();
  const nextRepair = status.externalEvidenceValidation?.nextRepair;
  if (!nextRepair) {
    return { ok: false, statusCode: 409, error: "no_external_repair_available" };
  }
  const expectedCloseoutId = String(input.closeoutId || "").trim();
  if (expectedCloseoutId !== nextRepair.closeoutId) {
    return { ok: false, statusCode: 409, error: "external_repair_mismatch", expectedCloseoutId: nextRepair.closeoutId };
  }
  const proofReference = String(input.proofReference || "").trim();
  const proofDetails = String(input.proofDetails || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  const referenceError = validateExternalProofText(proofReference, "proof_reference", 8);
  if (referenceError) return { ok: false, statusCode: 400, error: referenceError };
  const detailsError = validateExternalProofText(proofDetails, "proof_details", 80);
  if (detailsError) return { ok: false, statusCode: 400, error: detailsError };
  const notesError = validateExternalProofText(operatorNotes, "operator_notes", 20);
  if (notesError) return { ok: false, statusCode: 400, error: notesError };

  const proofPath = await safeExternalProofPath(nextRepair.proofPath);
  if (!proofPath) return { ok: false, statusCode: 403, error: "invalid_external_proof_path" };
  const raw = await readFile(externalEvidenceCsvPath, "utf8");
  const { header, rows } = parseCsv(raw);
  const rowIndex = Number(nextRepair.csvRow) - 2;
  const row = rows[rowIndex];
  if (!row) return { ok: false, statusCode: 404, error: "external_evidence_csv_row_not_found", csvRow: nextRepair.csvRow };
  const rowMatchesRepair = String(row.kind || "") === nextRepair.lane
    && String(row.platform || "") === nextRepair.platform
    && (!nextRepair.requiredStatus || String(row.status || "") === nextRepair.requiredStatus)
    && (!nextRepair.accountId || String(row.account_id || "") === nextRepair.accountId)
    && (!nextRepair.scope || String(row.scope || "") === nextRepair.scope);
  if (!rowMatchesRepair) {
    return { ok: false, statusCode: 409, error: "external_evidence_csv_row_mismatch", csvRow: nextRepair.csvRow };
  }
  const proofBody = [
    `# ${nextRepair.closeoutId}`,
    "",
    `Status: evidence_recorded`,
    `Recorded at: ${new Date().toISOString()}`,
    `Platform: ${nextRepair.platform}`,
    `Lane: ${nextRepair.lane}`,
    nextRepair.accountId ? `Account: ${nextRepair.accountId}` : null,
    nextRepair.scope ? `Scope: ${nextRepair.scope}` : null,
    `Proof reference: ${proofReference}`,
    "",
    "Operator notes:",
    operatorNotes,
    "",
    "Proof details:",
    proofDetails,
    "",
    "Safety note: this file must contain only non-secret external proof and no private authentication material.",
    "",
  ].filter(Boolean).join("\n");

  await atomicWriteFile(proofPath, proofBody);
  row.proof = proofPath;
  row.notes = operatorNotes;
  await atomicWriteFile(externalEvidenceCsvPath, renderCsv(header, rows));

  return {
    ok: true,
    statusCode: 200,
    closeoutId: nextRepair.closeoutId,
    csvRow: nextRepair.csvRow,
    proofUrl: workspaceUrlForFilePath(proofPath),
    evidenceCsvUrl: workspaceUrlForFilePath(externalEvidenceCsvPath),
    nextStep: "Run Preview external evidence, then Apply accepted external evidence if this row is accepted.",
  };
}

function runNodeScript(scriptPath, env = {}, args = [], nodeArgs = []) {
  return new Promise((resolve) => {
    const effectiveNodeArgs = nodeArgs.length > 0
      ? nodeArgs
      : scriptPath.endsWith(".ts")
        ? ["--import", "tsx"]
        : [];
    const child = spawn(process.execPath, [...effectiveNodeArgs, scriptPath, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      resolve({ script: scriptPath, status: "failed", code: null, stdout, stderr: error.message || stderr });
    });
    child.on("close", (code) => {
      resolve({ script: scriptPath, status: code === 0 ? "completed" : "failed", code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function runNodeEval(label, code, env = {}, nodeArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeArgs, "--eval", code], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      resolve({ script: label, status: "failed", code: null, stdout, stderr: error.message || stderr });
    });
    child.on("close", (code) => {
      resolve({ script: label, status: code === 0 ? "completed" : "failed", code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function scrubInternalText(value) {
  const textValue = String(value || "");
  if (!textValue) return "";
  return textValue
    .split(root).join("<app-root>")
    .split(workspaceRoot).join("<clippers-workspace>")
    .replace(/\/Users\/[^\s"',)]+/g, "<local-path>")
    .replace(/\/var\/folders\/[^\s"',)]+/g, "<temp-path>");
}

function scrubStepOutput(step) {
  return {
    ...step,
    stdout: scrubInternalText(step.stdout),
    stderr: scrubInternalText(step.stderr),
  };
}

async function runExternalCloseoutEvidence({ applyReady = false } = {}) {
  if (process.env.CLIPPERS_LOCAL_OPERATOR_STUB_REFRESH === "true") {
    const status = await buildStatus();
    return {
      status: applyReady ? "external_evidence_apply_ready_stubbed" : "external_evidence_preview_stubbed",
      statusCode: 200,
      generatedAt: new Date().toISOString(),
      attemptsApplyReady: applyReady,
      appliesEvidence: false,
      appliedEvidence: false,
      writesPreviewReports: false,
      externalEvidence: status.externalEvidence,
    };
  }
  const result = await runNodeScript(
    "script/clippers-import-external-closeout-evidence.ts",
    { CLIPPERS_WORKSPACE_ROOT: workspaceRoot },
    applyReady ? ["--apply-ready"] : [],
    ["--import", "tsx"],
  );
  let parsedStdout = null;
  try {
    parsedStdout = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {
    parsedStdout = null;
  }
  return {
    status: result.status === "completed"
      ? applyReady ? "external_evidence_apply_ready_completed" : "external_evidence_preview_completed"
      : applyReady ? "external_evidence_apply_ready_failed" : "external_evidence_preview_failed",
    statusCode: result.status === "completed" ? 200 : 500,
    generatedAt: new Date().toISOString(),
    attemptsApplyReady: applyReady,
    appliesEvidence: applyReady,
    appliedEvidence: applyReady && Number(parsedStdout?.applied || 0) > 0,
    writesPreviewReports: result.status === "completed",
    step: result,
    preview: parsedStdout,
  };
}

async function previewExternalCloseoutEvidence() {
  return runExternalCloseoutEvidence({ applyReady: false });
}

async function applyReadyExternalCloseoutEvidence() {
  const result = await runExternalCloseoutEvidence({ applyReady: true });
  if (result.statusCode === 200) {
    result.refresh = await refreshClippersArtifacts();
  }
  return result;
}

async function refreshClippersArtifacts() {
  if (process.env.CLIPPERS_LOCAL_OPERATOR_STUB_REFRESH === "true") {
    const status = await buildStatus();
    return {
      status: "refreshed",
      generatedAt: new Date().toISOString(),
      steps: refreshScriptPaths.map((scriptPath) => ({ script: scriptPath, status: "stubbed", code: 0, stdout: "", stderr: "" })),
      clippers: status,
    };
  }
  const steps = [];
  for (const scriptPath of refreshScriptPaths) {
    const result = await runNodeScript(scriptPath);
    steps.push(result);
    if (result.status !== "completed") break;
  }
  const status = await buildStatus();
  return {
    status: steps.every((step) => step.status === "completed") ? "refreshed" : "failed",
    generatedAt: new Date().toISOString(),
    steps,
    clippers: status,
  };
}

function buildSourceDropMetricoolRefreshPlan(status) {
  const validation = status.realClipIntakeValidation || {
    status: "unknown",
    totalRows: 0,
    readyRows: 0,
    blockedRows: 0,
    rows: [],
  };
  const importAllowed = validation.status === "ready_for_source_drop_import";
  const noRowsNeeded = validation.status === "no_intake_rows";
  const blockers = [
    importAllowed || noRowsNeeded ? null : "real_clip_intake_not_ready",
    validation.blockedRows > 0 ? `blocked_intake_rows_${validation.blockedRows}` : null,
    validation.totalRows > 0 && validation.readyRows !== validation.totalRows ? "not_all_rows_ready_for_source_drop_import" : null,
  ].filter(Boolean);
  return {
    status: importAllowed
      ? "ready_to_import_source_drop"
      : noRowsNeeded
        ? "no_source_drop_import_needed"
        : "blocked_real_clip_intake",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_source_drop_import_refresh",
    metricoolApprovalRequired: status.metricoolApprovalRequired === true,
    realPublishEnabled: status.realPublishEnabled === true,
    canRunImport: importAllowed,
    totalRows: validation.totalRows || 0,
    readyRows: validation.readyRows || 0,
    blockedRows: validation.blockedRows || 0,
    blockers,
    steps: [
      "Validate every current-batch replacement row has a real local MP4, exact TikTok, Twitch, or YouTube source URL, creator/source, owned_or_permissioned rights status, evidence link, and concrete notes.",
      "Import source-drop files through the existing server/clippers-agent.ts importClipperSourceDropFiles flow.",
      "Regenerate Metricool operator handoff, current batch upload pack, and session packet.",
      "Keep Metricool in approval_required mode; do not publish automatically.",
    ],
    nextAction: importAllowed
      ? "Run the guarded source-drop import + Metricool refresh. This creates a new reviewable batch; it still does not auto-publish."
      : noRowsNeeded
        ? "No replacement rows are pending; use the Metricool approval flow only after operator-ready confirms scheduling is allowed."
        : "Complete Real Clip Intake first. The yellow generated files are placeholders and cannot be imported as viral clips.",
  };
}

function buildSourceDropMetricoolRefreshMarkdown(status) {
  const plan = buildSourceDropMetricoolRefreshPlan(status);
  return [
    "# Clippers Source-drop Import + Metricool Refresh",
    "",
    `Generated: ${plan.generatedAt}`,
    `Scope: ${plan.scope}`,
    `Status: ${plan.status}`,
    "",
    "## Counts",
    "",
    `- Total intake rows: ${plan.totalRows}`,
    `- Ready rows: ${plan.readyRows}`,
    `- Blocked rows: ${plan.blockedRows}`,
    `- Can run import: ${plan.canRunImport ? "yes" : "no"}`,
    `- Metricool approval required: ${plan.metricoolApprovalRequired ? "yes" : "no"}`,
    `- Real publish enabled: ${plan.realPublishEnabled ? "yes" : "no"}`,
    `- Blockers: ${plan.blockers.join(", ") || "none"}`,
    "",
    "## Steps",
    "",
    ...plan.steps.map((step) => `- ${step}`),
    "",
    "## Next Action",
    "",
    plan.nextAction,
    "",
    "## Guardrails",
    "",
    "- Generated yellow/text MP4s are safe placeholders, not real viral clips.",
    "- This flow never treats placeholders as creator permission.",
    "- This flow never posts directly to TikTok; Metricool remains approval_required.",
    "",
  ].join("\n");
}

function renderSourceDropMetricoolRefreshPage(status) {
  const plan = buildSourceDropMetricoolRefreshPlan(status);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Source-drop Import</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a,.actions button{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821;color:#eaf7ff;font:inherit}
    .actions button:disabled{opacity:.45;cursor:not-allowed}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff;word-break:break-word}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Source-drop Import + Metricool Refresh</h1>
  <p>Este paso solo se desbloquea cuando todos los placeholders amarillos fueron reemplazados por MP4 reales con URL exacta y prueba de derechos. No publica automaticamente.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(plan.status)}</div></div>
    <div class="card"><div class="label">Ready</div><div class="value">${escapeHtml(plan.readyRows)}/${escapeHtml(plan.totalRows)}</div></div>
    <div class="card"><div class="label">Blocked</div><div class="value">${escapeHtml(plan.blockedRows)}</div></div>
    <div class="card"><div class="label">Publish</div><div class="value">${escapeHtml(plan.realPublishEnabled ? "ON" : "OFF")}</div><p class="small">Metricool approval_required</p></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-intake-validation.html", "Real clip validation")}
    ${link("/api/clippers/source-drop-metricool-refresh.md", "Markdown")}
    <form method="post" action="/api/clippers/source-drop-metricool-refresh/run">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <button type="submit"${plan.canRunImport ? "" : " disabled"}>Run guarded import + refresh</button>
    </form>
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(plan.nextAction)}</p>
    <p class="small">Blockers: ${escapeHtml(plan.blockers.join(", ") || "none")}</p>
  </div>
  <div class="card">
    <div class="label">Steps</div>
    ${plan.steps.map((step) => `<p>${escapeHtml(step)}</p>`).join("")}
  </div>
</main>
</body>
</html>`;
}

async function runSourceDropMetricoolRefresh() {
  const statusBefore = await buildStatus();
  const plan = buildSourceDropMetricoolRefreshPlan(statusBefore);
  if (!plan.canRunImport) {
    return {
      ok: false,
      statusCode: 409,
      ...plan,
      error: plan.status,
    };
  }
  if (process.env.CLIPPERS_LOCAL_OPERATOR_STUB_REFRESH === "true") {
    return {
      ok: true,
      statusCode: 200,
      status: "source_drop_metricool_refresh_stubbed",
      generatedAt: new Date().toISOString(),
      plan,
      steps: [
        { script: "server/clippers-agent.ts#importClipperSourceDropFiles", status: "stubbed", code: 0, stdout: "", stderr: "" },
        ...sourceDropMetricoolRefreshScriptPaths.map((scriptPath) => ({ script: scriptPath, status: "stubbed", code: 0, stdout: "", stderr: "" })),
      ],
      clippers: statusBefore,
    };
  }
  const steps = [];
  const importStep = await runNodeEval(
    "server/clippers-agent.ts#importClipperSourceDropFiles",
    [
      "import { importClipperSourceDropFiles } from './server/clippers-agent.ts';",
      "const result = await importClipperSourceDropFiles();",
      "console.log(JSON.stringify({ sourceDropImport: result.sourceDropImport }, null, 2));",
    ].join("\n"),
    { CLIPPERS_WORKSPACE_ROOT: workspaceRoot },
    ["--import", "tsx"],
  );
  steps.push(importStep);
  let sourceDropImport = null;
  try {
    sourceDropImport = importStep.stdout ? JSON.parse(importStep.stdout).sourceDropImport || null : null;
  } catch {
    sourceDropImport = null;
  }
  const expectedImported = plan.totalRows || 0;
  const importAccepted = importStep.status === "completed"
    && Number(sourceDropImport?.imported || 0) >= expectedImported
    && Number(sourceDropImport?.skipped || 0) === 0;
  if (importAccepted) {
    for (const scriptPath of sourceDropMetricoolRefreshScriptPaths) {
      const step = await runNodeScript(scriptPath, { CLIPPERS_WORKSPACE_ROOT: workspaceRoot });
      steps.push(step);
      if (step.status !== "completed") break;
    }
  }
  const clippers = await buildStatus();
  const ok = importAccepted && steps.every((step) => step.status === "completed");
  return {
    ok,
    statusCode: ok ? 200 : 500,
    status: ok ? "source_drop_metricool_refresh_completed" : importStep.status === "completed" ? "source_drop_import_incomplete" : "source_drop_metricool_refresh_failed",
    generatedAt: new Date().toISOString(),
    plan,
    sourceDropImport: sourceDropImport ? {
      imported: Number(sourceDropImport.imported || 0),
      skipped: Number(sourceDropImport.skipped || 0),
      filesScanned: Number(sourceDropImport.filesScanned || 0),
      manifestRows: Number(sourceDropImport.manifestRows || 0),
      manifestMatched: Number(sourceDropImport.manifestMatched || 0),
      rightsEvidenceWritten: Number(sourceDropImport.rightsEvidenceWritten || 0),
      nextStep: scrubInternalText(sourceDropImport.nextStep),
    } : null,
    steps: steps.map(scrubStepOutput),
    clippers,
  };
}

async function rollForwardPendingSchedules({ leadThresholdMinutes = 20 } = {}) {
  const steps = [];
  const env = { CLIPPERS_ROLL_FORWARD_MIN_LEAD_MINUTES: String(leadThresholdMinutes) };
  for (const scriptPath of rollForwardScriptPaths) {
    const result = await runNodeScript(scriptPath, env);
    steps.push(result);
    if (result.status !== "completed") break;
  }
  const status = await buildStatus();
  return {
    status: steps.every((step) => step.status === "completed") ? "rolled_forward" : "failed",
    generatedAt: new Date().toISOString(),
    steps,
    clippers: status,
  };
}

function buildRollForwardSafetyDecision(status, { requireEnabled = false, leadThresholdMinutes = null } = {}) {
  const leadMinutes = status.operatorSummary?.leadMinutes;
  const blockers = [
    !requireEnabled || autoRollForwardEnabled ? null : "disabled",
    status.realPublishEnabled === false ? null : "real_publish_enabled",
    status.metricoolApprovalRequired === true ? null : "metricool_approval_not_required",
    status.preflight?.failed === 0 ? null : "preflight_failed",
    status.metricoolMvp?.status === "metricool_mvp_ready" ? null : "metricool_mvp_not_ready",
    status.evidence?.rows > 0 ? null : "no_evidence_rows",
    status.evidence?.invalidEvidence === 0 ? null : "invalid_evidence",
    status.evidence?.missingApproval === status.evidence?.rows ? null : "operator_evidence_already_started",
    status.evidence?.readyForImportPreview === 0 ? null : "ready_rows_exist",
    status.scheduled === 0 ? null : "artifact_already_scheduled",
    status.readyToImport === 0 ? null : "artifact_ready_to_import",
    watchdogState.lastStatus === "roll_forward_unverified" ? "last_roll_forward_unverified" : null,
    typeof leadMinutes === "number" ? null : "missing_lead_minutes",
    typeof leadMinutes === "number" && typeof leadThresholdMinutes === "number" && leadMinutes <= leadThresholdMinutes
      ? null
      : typeof leadThresholdMinutes === "number" ? "lead_time_above_threshold" : null,
  ].filter(Boolean);
  return {
    safeToRollForward: blockers.length === 0,
    blockers,
  };
}

function buildWatchdogDecision(status) {
  const decision = buildRollForwardSafetyDecision(status, {
    requireEnabled: true,
    leadThresholdMinutes: autoRollForwardThresholdMinutes,
  });
  return {
    safeToAutoRollForward: decision.safeToRollForward,
    blockers: decision.blockers,
  };
}

function buildWatchdogSummary(status) {
  const decision = buildWatchdogDecision(status);
  const thresholdMinutes = Number.isFinite(autoRollForwardThresholdMinutes) ? autoRollForwardThresholdMinutes : 45;
  const leadMinutes = status.operatorSummary?.leadMinutes;
  const firstPublishMs = Date.parse(status.operatorSummary?.firstPublishAt || "");
  const minutesUntilAutoRollForward = autoRollForwardEnabled && typeof leadMinutes === "number"
    ? leadMinutes - thresholdMinutes
    : null;
  const autoRollForwardThresholdAt = autoRollForwardEnabled && Number.isFinite(firstPublishMs)
    ? new Date(firstPublishMs - thresholdMinutes * 60_000).toISOString()
    : "";
  return {
    enabled: autoRollForwardEnabled,
    thresholdMinutes,
    intervalMs: Number.isFinite(autoRollForwardIntervalMs) ? autoRollForwardIntervalMs : 60_000,
    minutesUntilAutoRollForward,
    autoRollForwardThresholdAt,
    running: watchdogState.running,
    lastCheckedAt: watchdogState.lastCheckedAt,
    lastRunAt: watchdogState.lastRunAt,
    lastStatus: watchdogState.lastStatus,
    lastReason: watchdogState.lastReason,
    ...decision,
    nextAction: decision.safeToAutoRollForward
      ? "Auto roll-forward may refresh local batch times if the schedule gets too close."
      : `Auto roll-forward held: ${decision.blockers.join(", ") || "no action needed"}.`,
  };
}

async function guardedRollForwardPendingSchedules({ leadThresholdMinutes = 20 } = {}) {
  const before = await buildStatus();
  const decision = buildRollForwardSafetyDecision(before, { leadThresholdMinutes });
  if (!decision.safeToRollForward) {
    return {
      status: "blocked",
      statusCode: 409,
      generatedAt: new Date().toISOString(),
      error: "roll_forward_safety_blocked",
      blockers: decision.blockers,
      clippers: before,
    };
  }
  const result = await rollForwardPendingSchedules({ leadThresholdMinutes });
  const afterLeadMinutes = result.clippers?.operatorSummary?.leadMinutes;
  return {
    ...result,
    statusCode: result.status === "rolled_forward" ? 200 : 500,
    verifiedRollForward: typeof before.operatorSummary?.leadMinutes === "number"
      && typeof afterLeadMinutes === "number"
      && afterLeadMinutes > before.operatorSummary.leadMinutes,
    beforeLeadMinutes: before.operatorSummary?.leadMinutes,
    afterLeadMinutes,
  };
}

async function runAutoRollForwardWatchdog() {
  if (!autoRollForwardEnabled || watchdogState.running) return;
  watchdogState.lastCheckedAt = new Date().toISOString();
  const status = await buildStatus();
  const decision = buildWatchdogDecision(status);
  if (!decision.safeToAutoRollForward) {
    watchdogState.lastStatus = "held";
    watchdogState.lastReason = decision.blockers.join(", ");
    return;
  }
  watchdogState.running = true;
  watchdogState.lastStatus = "running";
  watchdogState.lastReason = "lead_time_below_threshold";
  try {
    const result = await guardedRollForwardPendingSchedules({ leadThresholdMinutes: autoRollForwardThresholdMinutes });
    watchdogState.lastRunAt = result.generatedAt;
    watchdogState.lastStatus = result.status === "rolled_forward" && result.verifiedRollForward ? "rolled_forward_verified" : "roll_forward_unverified";
    watchdogState.lastReason = result.verifiedRollForward ? "auto_roll_forward_completed" : (result.error || "auto_roll_forward_not_verified");
  } catch (error) {
    watchdogState.lastStatus = "failed";
    watchdogState.lastReason = error?.message || "auto_roll_forward_error";
  } finally {
    watchdogState.running = false;
  }
}

async function respondMutation(res, form, result) {
  const refreshed = result.ok ? await refreshClippersArtifacts() : null;
  if (refreshed) {
    result.refresh = { status: refreshed.status, generatedAt: refreshed.generatedAt };
    result.nextMetricoolAction = buildNextMetricoolActionJson(refreshed.clippers);
  }
  const returnTo = safeReturnToPath(form.get("returnTo"));
  if (result.ok && returnTo) {
    res.writeHead(303, { location: returnTo, "cache-control": "no-store" });
    res.end();
    return;
  }
  json(res, result.statusCode, result);
}

function safeReturnToPath(value) {
  const returnTo = String(value || "");
  if ([
    "/clippers",
    "/api/clippers/next-metricool-action.html",
    "/api/clippers/tiktok-batch-schedule-now.html",
    "/api/clippers/tiktok-public-metrics-now.html",
    "/api/clippers/real-clip-intake.html",
    "/api/clippers/real-clip-intake-validation.html",
    "/api/clippers/human-review-queue.html",
    "/api/clippers/tiktok-launch-authorization.html",
  ].includes(returnTo)) return returnTo;
  const accountNowMatch = returnTo.match(/^\/api\/clippers\/tiktok-account-now\.html\?accountId=([A-Za-z0-9_-]+)$/);
  if (accountNowMatch && ["sports-daily", "meme-radar"].includes(accountNowMatch[1])) return returnTo;
  return "";
}

function safeWorkspacePath(urlPath) {
  let relative = "";
  try {
    relative = decodeURIComponent(urlPath.replace(/^\/clippers-workspace\/?/, ""));
  } catch {
    return null;
  }
  const resolved = path.resolve(workspaceRoot, relative);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) return null;
  return resolved;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function link(href, label) {
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function workspaceUrlForFilePath(filePath) {
  const textPath = String(filePath || "").trim();
  if (!textPath) return "";
  const resolved = path.resolve(textPath);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return `/clippers-workspace/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function rowPublishTime(row) {
  const timestamp = Date.parse(row.publishAt);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function formatOperatorDateTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: operatorTimeZone,
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function leadMinutesFromNow(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.round((timestamp - operatorNowMs()) / 60_000) : null;
}

function canRecordPublishedMetrics(row) {
  return Boolean(row?.hasMetricoolScheduledEvidence)
    && ["scheduled", "ready_to_import", "published"].includes(String(row?.evidenceState || ""));
}

function isTikTokPlatform(value) {
  return String(value || "").trim().toLowerCase() === "tiktok";
}

function scheduleWindowStatus(leadMinutes) {
  if (typeof leadMinutes !== "number") {
    return {
      status: "unknown",
      label: "Unknown",
      action: "Refresh artifacts before scheduling.",
    };
  }
  if (leadMinutes < 0) {
    return {
      status: "expired",
      label: "Expired",
      action: "Roll forward the batch before scheduling in Metricool.",
    };
  }
  if (leadMinutes < 20) {
    return {
      status: "urgent",
      label: "Urgent",
      action: "Schedule immediately or roll forward if you cannot finish the batch now.",
    };
  }
  if (leadMinutes < 60) {
    return {
      status: "soon",
      label: "Soon",
      action: "Schedule the earliest rows first in Metricool.",
    };
  }
  return {
    status: "ok",
    label: "OK",
    action: "Schedule the batch in Metricool approval_required mode.",
  };
}

function buildMetricoolMvpSummary(accountReadiness = {}, externalCloseout = {}) {
  const activeReadyLanes = accountReadiness.activeMvpReadyLanes || accountReadiness.activeMvp?.readyLanes || 0;
  const activeTargetLanes = accountReadiness.activeMvpTargetLanes || accountReadiness.activeMvp?.targetLanes || 0;
  const activeExternalTasks = externalCloseout.totals?.activeTasks || 0;
  const artifactDirectSocialApisRequired = accountReadiness.directSocialApisRequired === true;
  const artifactReady = !accountReadiness.status || accountReadiness.status === "metricool_mvp_ready";
  const closeoutReady = !externalCloseout.status
    || ["ready", "complete", "no_active_external_tasks", "metricool_mvp_ready_deferred_backlog"].includes(externalCloseout.status);
  const closeoutFresh = externalCloseout.source?.freshness?.reportIsFresh !== false;
  const laneReady = activeTargetLanes > 0 && activeReadyLanes >= activeTargetLanes;
  const activeCloseoutClear = activeExternalTasks === 0;
  const derivedReady = artifactReady && closeoutReady && closeoutFresh && laneReady && activeCloseoutClear;
  const status = derivedReady
    ? "metricool_mvp_ready"
    : "blocked_metricool_mvp_readiness_gap";
  const blockers = [
    laneReady ? null : `active_lanes_${activeReadyLanes}_of_${activeTargetLanes}`,
    activeCloseoutClear ? null : `active_external_tasks_${activeExternalTasks}`,
    artifactReady ? null : `account_readiness_${accountReadiness.status}`,
    closeoutReady ? null : `external_closeout_${externalCloseout.status}`,
    closeoutFresh ? null : "external_closeout_stale",
  ].filter(Boolean);
  return {
    status,
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    directApisDeferred: true,
    artifactDirectSocialApisRequired,
    verifiedAccounts: accountReadiness.verifiedAccounts || accountReadiness.totals?.verifiedAccounts || 0,
    activeReadyLanes,
    activeTargetLanes,
    metricoolReadyLanes: accountReadiness.metricoolReadyLanes || accountReadiness.totals?.metricoolReadyLanes || 0,
    connectedMetricoolRightsReadyAssets: accountReadiness.connectedMetricoolRightsReadyAssets || accountReadiness.sourceReadiness?.connectedMetricoolRightsReadyAssets || 0,
    tiktokMvpCloseoutStatus: accountReadiness.tiktokMvpCloseoutStatus || accountReadiness.tiktokMvpAccountCloseout?.status || "missing",
    tiktokMvpCloseoutReady: accountReadiness.tiktokMvpCloseoutReady || accountReadiness.tiktokMvpAccountCloseout?.totals?.ready || 0,
    tiktokMvpCloseoutRows: accountReadiness.tiktokMvpCloseoutRows || accountReadiness.tiktokMvpAccountCloseout?.totals?.rows || 0,
    externalCloseoutStatus: externalCloseout.status || "missing",
    activeExternalTasks,
    deferredExternalTasks: externalCloseout.totals?.deferredTasks || 0,
    blockers,
    nextStep: derivedReady
      ? "SPORT and memes TikTok are ready for Metricool approval_required operation; direct API permissions stay deferred."
      : `Do not call the TikTok MVP ready until blockers clear: ${blockers.join(", ") || "refresh account readiness"}.`,
  };
}

function buildMetricoolOperatorChecklist(rows, status) {
  const activeRows = [...rows]
    .filter((row) => !row.hasMetricoolScheduledEvidence)
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right));
  const nextRows = activeRows.slice(0, 3).map((row) => ({
    rank: row.rank,
    queueItemId: row.queueItemId,
    accountName: row.accountName,
    metricoolBrandName: row.metricoolBrandName,
    publishAt: row.publishAt,
    uploadFileName: row.uploadFileName,
    captionSeed: row.captionSeed,
    evidenceState: row.evidenceState,
  }));
  const blockers = [
    status.operatorSummary?.needsRollForward ? "schedule_needs_roll_forward" : null,
    status.preflight?.failed > 0 ? "preflight_failed" : null,
    status.metricoolMvp?.status !== "metricool_mvp_ready" ? "metricool_mvp_not_ready" : null,
    status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status) ? "real_clip_intake_not_ready" : null,
    rows.length === 0 ? "no_batch_rows" : null,
    nextRows.length === 0 ? "no_actionable_rows" : null,
    status.evidence?.invalidEvidence > 0 ? "invalid_evidence" : null,
  ].filter(Boolean);
  return {
    status: blockers.length ? "blocked_operator_checklist" : "ready_for_metricool_operator",
    currentBatchId: status.batchId,
    blockers,
    steps: [
      blockers.includes("real_clip_intake_not_ready")
        ? "Complete Real clip intake before opening Metricool or saving scheduled proof."
        : null,
      blockers.includes("real_clip_intake_not_ready")
        ? "Use the Real clip intake pack to add exact TikTok, Twitch, or YouTube source URLs, rights proof, and local source files."
        : blockers.includes("schedule_needs_roll_forward")
        ? "Click Roll forward schedule before opening Metricool."
        : "Open the Upload pack and schedule the earliest deadline rows first.",
      "Use the Metricool brand shown on each row: SPORT for Streamer Highlights, memes for Streamer Reactions.",
      "After each row is scheduled in Metricool, paste the real Metricool planner URL and a concrete note in Save scheduled proof.",
      "Do not enter public TikTok URLs or 24h metrics until the video is live and metrics are real.",
    ].filter(Boolean),
    nextRows,
  };
}

function scheduledProofCsvStarter(rows) {
  const header = ["metricool_queue_item_id", "metricool_approval_url", "operator_notes"];
  const activeRows = [...rows]
    .filter((row) => !row.hasMetricoolScheduledEvidence)
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right));
  return renderCsv(header, activeRows.map((row) => ({
    metricool_queue_item_id: row.queueItemId,
    metricool_approval_url: "<paste real Metricool planner URL after scheduling>",
    operator_notes: `Scheduled manually in Metricool planner for ${row.metricoolBrandName || row.accountName} TikTok row ${row.rank}.`,
  })));
}

function emptyScheduledProofCsvStarter() {
  return renderCsv(["metricool_queue_item_id", "metricool_approval_url", "operator_notes"], []);
}

function nextScheduledProofCsvStarter(rows) {
  const header = ["metricool_queue_item_id", "metricool_approval_url", "operator_notes"];
  const nextRow = [...rows]
    .filter((row) => !row.hasMetricoolScheduledEvidence)
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right))[0];
  return renderCsv(header, nextRow ? [{
    metricool_queue_item_id: nextRow.queueItemId,
    metricool_approval_url: "<paste real Metricool planner URL after scheduling this exact next row>",
    operator_notes: `Scheduled manually in Metricool planner for ${nextRow.metricoolBrandName || nextRow.accountName} TikTok row ${nextRow.rank}.`,
  }] : []);
}

function publishedMetricsCsvStarter(rows) {
  const header = ["metricool_queue_item_id", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_notes"];
  const activeRows = [...rows]
    .filter((row) => canRecordPublishedMetrics(row) && !["ready_to_import", "published"].includes(String(row.evidenceState || "")))
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right));
  return renderCsv(header, activeRows.map((row) => ({
    metricool_queue_item_id: row.queueItemId,
    published_post_url: "<paste exact public TikTok video URL after the post is live>",
    views_24h: "<real views after 24h>",
    likes_24h: "<real likes after 24h>",
    comments_24h: "<real comments after 24h>",
    shares_24h: "<real shares after 24h>",
    operator_notes: `Metrics captured after ${row.metricoolBrandName || row.accountName} TikTok row ${row.rank} was public for 24h.`,
  })));
}

function nextPublishedMetricsCsvStarter(rows) {
  const header = ["metricool_queue_item_id", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_notes"];
  const nextRow = [...rows]
    .filter((row) => canRecordPublishedMetrics(row) && !["ready_to_import", "published"].includes(String(row.evidenceState || "")))
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right))[0];
  return renderCsv(header, nextRow ? [{
    metricool_queue_item_id: nextRow.queueItemId,
    published_post_url: "<paste exact public TikTok video URL after this exact post is live>",
    views_24h: "<real views after 24h>",
    likes_24h: "<real likes after 24h>",
    comments_24h: "<real comments after 24h>",
    shares_24h: "<real shares after 24h>",
    operator_notes: `Metrics captured after ${nextRow.metricoolBrandName || nextRow.accountName} TikTok row ${nextRow.rank} was public for 24h.`,
  }] : []);
}

function buildMetricoolSchedulingRunSheet(rows) {
  const sortedRows = [...rows].sort((left, right) => rowPublishTime(left) - rowPublishTime(right));
  const missingScheduledProof = sortedRows.filter((row) => !row.hasMetricoolScheduledEvidence);
  const runRows = missingScheduledProof.map((row, index) => ({
    order: index + 1,
    rank: row.rank,
    queueItemId: row.queueItemId,
    accountName: row.accountName,
    accountId: row.accountId,
    metricoolBrandName: row.metricoolBrandName,
    platform: row.platform,
    publishAt: row.publishAt,
    publishAtLocal: formatOperatorDateTime(row.publishAt),
    leadMinutes: leadMinutesFromNow(row.publishAt),
    uploadFileName: row.uploadFileName,
    uploadFileUrl: row.uploadFileUrl,
    captionSeed: row.captionSeed,
    evidenceState: row.evidenceState,
    evidenceMissingFields: row.evidenceMissingFields,
    hasMetricoolScheduledEvidence: row.hasMetricoolScheduledEvidence,
    scheduledNoteTemplate: `Scheduled manually in Metricool planner for ${row.metricoolBrandName || row.accountName} TikTok row ${row.rank}.`,
  }));
  const uploadChecklistCsv = renderCsv([
    "order",
    "metricool_queue_item_id",
    "metricool_brand",
    "account_name",
    "platform",
    "publish_at_local",
    "publish_at_iso",
    "upload_file_name",
    "caption_seed",
    "scheduled_note_template",
  ], runRows.map((row) => ({
    order: row.order,
    metricool_queue_item_id: row.queueItemId,
    metricool_brand: row.metricoolBrandName,
    account_name: row.accountName,
    platform: row.platform,
    publish_at_local: row.publishAtLocal,
    publish_at_iso: row.publishAt,
    upload_file_name: row.uploadFileName,
    caption_seed: row.captionSeed,
    scheduled_note_template: row.scheduledNoteTemplate,
  })));
  return {
    status: missingScheduledProof.length ? "needs_metricool_scheduled_proof" : "scheduled_proof_complete",
    operatorTimeZone,
    totalRows: sortedRows.length,
    missingScheduledProof: missingScheduledProof.length,
    scheduledProofRecorded: sortedRows.length - missingScheduledProof.length,
    nextQueueItemId: missingScheduledProof[0]?.queueItemId || "",
    nextRow: missingScheduledProof[0]
      ? runRows.find((row) => row.queueItemId === missingScheduledProof[0]?.queueItemId) || null
      : null,
    nextAction: missingScheduledProof.length
      ? "Schedule rows in this deadline order inside Metricool, then paste each real planner URL into Save scheduled proof."
      : "All current rows have scheduled proof; wait for public TikTok URLs and 24h metrics.",
    uploadChecklistCsv,
    rows: runRows,
  };
}

function buildPublicMetricsRunSheet(rows) {
  const eligibleRows = [...rows]
    .filter((row) => canRecordPublishedMetrics(row))
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right));
  const pendingRows = eligibleRows.filter((row) => !["ready_to_import", "published"].includes(String(row.evidenceState || "")));
  const runRows = pendingRows.map((row, index) => ({
    order: index + 1,
    rank: row.rank,
    queueItemId: row.queueItemId,
    accountName: row.accountName,
    accountId: row.accountId,
    metricoolBrandName: row.metricoolBrandName,
    platform: row.platform,
    publishAt: row.publishAt,
    publishAtLocal: formatOperatorDateTime(row.publishAt),
    uploadFileName: row.uploadFileName,
    uploadFileUrl: row.uploadFileUrl,
    captionSeed: row.captionSeed,
    evidenceState: row.evidenceState,
    evidenceMissingFields: row.evidenceMissingFields,
    nextAction: row.evidenceNextAction || "Wait until the TikTok post is live, then record the exact public TikTok URL and real 24h metrics.",
  }));
  const missingPublicUrl = pendingRows.filter((row) => row.evidenceMissingFields.includes("published_post_url")).length;
  const missingViews = pendingRows.filter((row) => row.evidenceMissingFields.includes("views_24h")).length;
  return {
    status: eligibleRows.length
      ? pendingRows.length ? "needs_public_tiktok_metrics" : "public_metrics_complete"
      : "locked_until_metricool_scheduled_proof",
    eligibleRows: eligibleRows.length,
    lockedRows: rows.length - eligibleRows.length,
    pendingRows: pendingRows.length,
    readyRows: eligibleRows.length - pendingRows.length,
    missingPublicUrl,
    missingViews,
    nextQueueItemId: runRows[0]?.queueItemId || "",
    nextRow: runRows[0] || null,
    nextAction: pendingRows.length
      ? "After the TikTok post is live, record the exact public TikTok video URL and real 24h metrics for the next pending row."
      : eligibleRows.length
        ? "Public TikTok metrics are complete for all eligible rows."
        : "Record Metricool scheduled proof first; public TikTok metrics stay locked until then.",
    rows: runRows,
  };
}

function buildTikTokBatchAccountSummary(rows, uploadPackIntegrity = {}) {
  const uploadRowsByQueueId = new Map((uploadPackIntegrity.rows || []).map((row) => [row.queueItemId, row]));
  const rowsByAccount = new Map();
  for (const row of rows) {
    const accountKey = row.accountId || row.accountName || row.metricoolBrandName || "unknown";
    if (!rowsByAccount.has(accountKey)) {
      rowsByAccount.set(accountKey, {
        accountId: row.accountId || "",
        accountName: row.accountName || "",
        brand: row.metricoolBrandName || "",
        platform: row.platform || "",
        totalRows: 0,
        uploadFilesReady: 0,
        missingUploadFiles: 0,
        scheduledProofRecorded: 0,
        missingScheduledProof: 0,
        publicMetricsEligible: 0,
        pendingPublicMetrics: 0,
        nextQueueItemId: "",
        nextPublishAt: "",
        nextPublishAtLocal: "",
        nextUploadFileName: "",
        nextAction: "",
      });
    }
    const account = rowsByAccount.get(accountKey);
    const uploadRow = uploadRowsByQueueId.get(row.queueItemId) || {};
    account.totalRows += 1;
    if (uploadRow.ok) account.uploadFilesReady += 1;
    else account.missingUploadFiles += 1;
    if (row.hasMetricoolScheduledEvidence) account.scheduledProofRecorded += 1;
    else account.missingScheduledProof += 1;
    if (canRecordPublishedMetrics(row)) {
      account.publicMetricsEligible += 1;
      if (!["ready_to_import", "published"].includes(String(row.evidenceState || ""))) {
        account.pendingPublicMetrics += 1;
      }
    }
  }
  for (const account of rowsByAccount.values()) {
    const nextRow = rows
      .filter((row) => (row.accountId || row.accountName || row.metricoolBrandName || "unknown") === (account.accountId || account.accountName || account.brand || "unknown"))
      .filter((row) => !row.hasMetricoolScheduledEvidence)
      .sort((left, right) => rowPublishTime(left) - rowPublishTime(right))[0];
    if (nextRow) {
      account.nextQueueItemId = nextRow.queueItemId;
      account.nextPublishAt = nextRow.publishAt;
      account.nextPublishAtLocal = formatOperatorDateTime(nextRow.publishAt);
      account.nextUploadFileName = nextRow.uploadFileName;
      account.nextAction = `Schedule ${nextRow.uploadFileName} in Metricool for ${account.brand || account.accountName}.`;
    } else if (account.pendingPublicMetrics > 0) {
      account.nextAction = "Record exact public TikTok URLs and real 24h metrics for scheduled posts.";
    } else {
      account.nextAction = "No pending action for this account in the current batch.";
    }
  }
  const accounts = [...rowsByAccount.values()].sort((left, right) => {
    const leftNext = Date.parse(left.nextPublishAt);
    const rightNext = Date.parse(right.nextPublishAt);
    if (Number.isFinite(leftNext) && Number.isFinite(rightNext)) return leftNext - rightNext;
    if (Number.isFinite(leftNext)) return -1;
    if (Number.isFinite(rightNext)) return 1;
    return left.accountName.localeCompare(right.accountName);
  });
  const totals = accounts.reduce((sum, account) => ({
    accounts: sum.accounts + 1,
    totalRows: sum.totalRows + account.totalRows,
    uploadFilesReady: sum.uploadFilesReady + account.uploadFilesReady,
    missingUploadFiles: sum.missingUploadFiles + account.missingUploadFiles,
    scheduledProofRecorded: sum.scheduledProofRecorded + account.scheduledProofRecorded,
    missingScheduledProof: sum.missingScheduledProof + account.missingScheduledProof,
    publicMetricsEligible: sum.publicMetricsEligible + account.publicMetricsEligible,
    pendingPublicMetrics: sum.pendingPublicMetrics + account.pendingPublicMetrics,
  }), {
    accounts: 0,
    totalRows: 0,
    uploadFilesReady: 0,
    missingUploadFiles: 0,
    scheduledProofRecorded: 0,
    missingScheduledProof: 0,
    publicMetricsEligible: 0,
    pendingPublicMetrics: 0,
  });
  return {
    status: totals.missingUploadFiles > 0
      ? "blocked_upload_pack"
      : totals.missingScheduledProof > 0
        ? "needs_metricool_scheduled_proof"
        : totals.pendingPublicMetrics > 0
          ? "needs_public_tiktok_metrics"
          : totals.totalRows > 0 ? "current_batch_complete" : "no_tiktok_rows",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_current_batch",
    totals,
    accounts,
    nextAction: accounts.find((account) => account.nextQueueItemId)?.nextAction
      || (totals.pendingPublicMetrics > 0
        ? "Record public TikTok metrics for scheduled posts."
        : "Current TikTok batch has no pending account action."),
  };
}

function tiktokBatchAccountSummaryCsv(summary) {
  const csvNumber = (value) => String(Number(value || 0));
  return renderCsv([
    "account_id",
    "brand",
    "account_name",
    "platform",
    "total_rows",
    "upload_files_ready",
    "missing_upload_files",
    "scheduled_proof_recorded",
    "missing_scheduled_proof",
    "public_metrics_eligible",
    "pending_public_metrics",
    "next_queue_item_id",
    "next_publish_at_local",
    "next_publish_at",
    "next_upload_file_name",
    "next_action",
  ], (summary.accounts || []).map((account) => ({
    account_id: account.accountId,
    brand: account.brand,
    account_name: account.accountName,
    platform: account.platform,
    total_rows: csvNumber(account.totalRows),
    upload_files_ready: csvNumber(account.uploadFilesReady),
    missing_upload_files: csvNumber(account.missingUploadFiles),
    scheduled_proof_recorded: csvNumber(account.scheduledProofRecorded),
    missing_scheduled_proof: csvNumber(account.missingScheduledProof),
    public_metrics_eligible: csvNumber(account.publicMetricsEligible),
    pending_public_metrics: csvNumber(account.pendingPublicMetrics),
    next_queue_item_id: account.nextQueueItemId,
    next_publish_at_local: account.nextPublishAtLocal,
    next_publish_at: account.nextPublishAt,
    next_upload_file_name: account.nextUploadFileName,
    next_action: account.nextAction,
  })));
}

function tiktokBatchAccountSummaryMarkdown(summary) {
  const totals = summary.totals || {};
  const lines = [
    "# Clippers TikTok Batch Account Summary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Scope: ${summary.scope}`,
    `Status: ${summary.status}`,
    "",
    "## Totals",
    "",
    `- Accounts: ${totals.accounts || 0}`,
    `- Clips: ${totals.totalRows || 0}`,
    `- Upload files ready: ${totals.uploadFilesReady || 0}/${totals.totalRows || 0}`,
    `- Missing upload files: ${totals.missingUploadFiles || 0}`,
    `- Scheduled proof recorded: ${totals.scheduledProofRecorded || 0}/${totals.totalRows || 0}`,
    `- Missing scheduled proof: ${totals.missingScheduledProof || 0}`,
    `- Public metrics eligible: ${totals.publicMetricsEligible || 0}`,
    `- Pending public metrics: ${totals.pendingPublicMetrics || 0}`,
    "",
    "## Accounts",
    "",
    "| Brand | Account | Clips | Upload ready | Scheduled proof | Public metrics | Next row | Next action |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...(summary.accounts || []).map((account) => `| ${[
      account.brand,
      account.accountName,
      account.totalRows,
      `${account.uploadFilesReady}/${account.totalRows}`,
      `${account.scheduledProofRecorded}/${account.totalRows}`,
      `${account.publicMetricsEligible - account.pendingPublicMetrics}/${account.publicMetricsEligible}`,
      account.nextQueueItemId || "n/a",
      account.nextAction,
    ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
    "",
    "## Next Action",
    "",
    summary.nextAction || "No pending TikTok account action.",
    "",
    "Guardrails: Metricool approval_required only, realPublishEnabled=false, and no planner/public proof URLs are included in this report.",
  ];
  return `${lines.join("\n")}\n`;
}

function buildTikTokAccountQueues(rows, uploadPackIntegrity = {}) {
  const safeMissingField = (field) => ({
    metricool_approval_url: "scheduled_proof",
    published_post_url: "public_tiktok_url",
  }[field] || field);
  const uploadRowsByQueueId = new Map((uploadPackIntegrity.rows || []).map((row) => [row.queueItemId, row]));
  const grouped = new Map();
  for (const row of rows) {
    const accountKey = row.accountId || row.accountName || row.metricoolBrandName || "unknown";
    if (!grouped.has(accountKey)) {
      grouped.set(accountKey, {
        accountId: row.accountId || "",
        accountName: row.accountName || "",
        brand: row.metricoolBrandName || "",
        platform: row.platform || "",
        rows: [],
      });
    }
    const uploadRow = uploadRowsByQueueId.get(row.queueItemId) || {};
    grouped.get(accountKey).rows.push({
      queueItemId: row.queueItemId,
      rank: row.rank,
      accountOrder: 0,
      accountName: row.accountName || "",
      accountId: row.accountId || "",
      brand: row.metricoolBrandName || "",
      platform: row.platform || "",
      publishAt: row.publishAt,
      publishAtLocal: formatOperatorDateTime(row.publishAt),
      uploadFileName: row.uploadFileName,
      uploadFileUrl: row.uploadFileUrl,
      uploadFileReady: uploadRow.ok === true,
      captionSeed: row.captionSeed,
      evidenceState: row.evidenceState,
      missingFields: (row.evidenceMissingFields || []).map(safeMissingField),
      hasMetricoolScheduledEvidence: row.hasMetricoolScheduledEvidence === true,
      scheduledNoteTemplate: `Scheduled manually in Metricool planner for ${row.metricoolBrandName || row.accountName} TikTok row ${row.rank}.`,
    });
  }
  const accounts = [...grouped.values()].map((account) => {
    const sortedRows = account.rows
      .sort((left, right) => rowPublishTime(left) - rowPublishTime(right))
      .map((row, index) => ({ ...row, accountOrder: index + 1 }));
    const pendingScheduledProof = sortedRows.filter((row) => !row.hasMetricoolScheduledEvidence);
    return {
      accountId: account.accountId,
      accountName: account.accountName,
      brand: account.brand,
      platform: account.platform,
      totalRows: sortedRows.length,
      uploadFilesReady: sortedRows.filter((row) => row.uploadFileReady).length,
      missingScheduledProof: pendingScheduledProof.length,
      nextQueueItemId: pendingScheduledProof[0]?.queueItemId || "",
      rows: sortedRows,
    };
  }).sort((left, right) => {
    const leftNext = Date.parse(left.rows.find((row) => !row.hasMetricoolScheduledEvidence)?.publishAt || "");
    const rightNext = Date.parse(right.rows.find((row) => !row.hasMetricoolScheduledEvidence)?.publishAt || "");
    if (Number.isFinite(leftNext) && Number.isFinite(rightNext)) return leftNext - rightNext;
    if (Number.isFinite(leftNext)) return -1;
    if (Number.isFinite(rightNext)) return 1;
    return left.accountName.localeCompare(right.accountName);
  });
  return {
    status: accounts.some((account) => account.missingScheduledProof > 0) ? "needs_metricool_scheduled_proof" : "scheduled_proof_complete",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_account_queues",
    totals: {
      accounts: accounts.length,
      rows: accounts.reduce((sum, account) => sum + account.totalRows, 0),
      uploadFilesReady: accounts.reduce((sum, account) => sum + account.uploadFilesReady, 0),
      missingScheduledProof: accounts.reduce((sum, account) => sum + account.missingScheduledProof, 0),
    },
    accounts,
    guardrails: [
      "Metricool approval_required only.",
      "realPublishEnabled=false.",
      "No Metricool planner proof URLs or public TikTok URLs are included.",
    ],
  };
}

function tiktokAccountQueuesCsv(queues) {
  const csvNumber = (value) => String(Number(value || 0));
  return renderCsv([
    "account_id",
    "brand",
    "account_name",
    "account_order",
    "queue_item_id",
    "rank",
    "platform",
    "publish_at_local",
    "publish_at",
    "upload_file_name",
    "upload_file_ready",
    "evidence_state",
    "missing_fields",
    "scheduled_note_template",
    "caption_seed",
  ], (queues.accounts || []).flatMap((account) => account.rows.map((row) => ({
    account_id: account.accountId,
    brand: account.brand,
    account_name: account.accountName,
    account_order: csvNumber(row.accountOrder),
    queue_item_id: row.queueItemId,
    rank: csvNumber(row.rank),
    platform: row.platform,
    publish_at_local: row.publishAtLocal,
    publish_at: row.publishAt,
    upload_file_name: row.uploadFileName,
    upload_file_ready: row.uploadFileReady ? "true" : "false",
    evidence_state: row.evidenceState,
    missing_fields: row.missingFields.join(";"),
    scheduled_note_template: row.scheduledNoteTemplate,
    caption_seed: row.captionSeed,
  }))));
}

function tiktokAccountQueuesMarkdown(queues) {
  const lines = [
    "# Clippers TikTok Account Queues",
    "",
    `Generated: ${queues.generatedAt}`,
    `Scope: ${queues.scope}`,
    `Status: ${queues.status}`,
    "",
    "Guardrails: Metricool approval_required only, realPublishEnabled=false, no planner/public proof URLs included.",
  ];
  for (const account of queues.accounts || []) {
    lines.push(
      "",
      `## ${account.brand} / ${account.accountName}`,
      "",
      `- Clips: ${account.totalRows}`,
      `- Upload files ready: ${account.uploadFilesReady}/${account.totalRows}`,
      `- Missing scheduled proof: ${account.missingScheduledProof}`,
      `- Next queue item: ${account.nextQueueItemId || "n/a"}`,
      "",
      "| Order | Queue item | Publish local | File | Evidence | Caption |",
      "| ---: | --- | --- | --- | --- | --- |",
      ...account.rows.map((row) => `| ${[
        row.accountOrder,
        row.queueItemId,
        row.publishAtLocal || row.publishAt,
        row.uploadFileName,
        `${row.evidenceState}${row.missingFields.length ? ` (${row.missingFields.join("; ")})` : ""}`,
        row.captionSeed,
      ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildTikTokAccountNextAction(queues, accountId) {
  const requestedAccountId = String(accountId || "").trim();
  if (!requestedAccountId) {
    return {
      ok: false,
      statusCode: 400,
      error: "account_id_required",
      nextAction: "Pass accountId=sports-daily or accountId=meme-radar.",
    };
  }
  const account = (queues.accounts || []).find((candidate) => candidate.accountId === requestedAccountId);
  if (!account) {
    return {
      ok: false,
      statusCode: 404,
      error: "tiktok_account_not_found",
      accountId: requestedAccountId,
      availableAccountIds: (queues.accounts || []).map((candidate) => candidate.accountId).filter(Boolean),
    };
  }
  const nextRow = account.rows.find((row) => !row.hasMetricoolScheduledEvidence) || null;
  const intakeBlocked = queues.status === "blocked_real_clip_intake";
  return {
    ok: true,
    statusCode: 200,
    generatedAt: queues.generatedAt,
    scope: "tiktok_metricool_account_next",
    accountId: account.accountId,
    accountName: account.accountName,
    brand: account.brand,
    platform: account.platform,
    status: intakeBlocked ? "blocked_real_clip_intake" : nextRow ? "schedule_in_metricool" : "no_scheduled_proof_pending",
    totalRows: account.totalRows,
    missingScheduledProof: account.missingScheduledProof,
    uploadFilesReady: account.uploadFilesReady,
    nextRow,
    nextAction: intakeBlocked
      ? "Complete Real clip intake for this account before scheduling anything in Metricool."
      : nextRow
      ? `Schedule ${nextRow.uploadFileName} in Metricool for ${account.brand || account.accountName}, then record the real planner URL through preview.`
      : "No scheduled proof is pending for this TikTok account in the current batch.",
    guardrails: [
      "Metricool approval_required only.",
      "realPublishEnabled=false.",
      "This response does not include Metricool planner proof URLs or public TikTok URLs.",
    ],
  };
}

function tiktokAccountScheduledProofStarter(queues, accountId) {
  const nextAction = buildTikTokAccountNextAction(queues, accountId);
  if (!nextAction.ok) return nextAction;
  const account = (queues.accounts || []).find((candidate) => candidate.accountId === nextAction.accountId);
  const pendingRows = nextAction.status === "blocked_real_clip_intake"
    ? []
    : (account?.rows || []).filter((row) => !row.hasMetricoolScheduledEvidence);
  return {
    ok: true,
    statusCode: 200,
    accountId: account.accountId,
    filename: `clippers-${account.accountId}-scheduled-proof-starter.csv`,
    csv: renderCsv(["metricool_queue_item_id", "metricool_approval_url", "operator_notes"], pendingRows.map((row) => ({
      metricool_queue_item_id: row.queueItemId,
      metricool_approval_url: "<paste real Metricool planner URL after scheduling>",
      operator_notes: row.scheduledNoteTemplate,
    }))),
  };
}

function tiktokAccountNextScheduledProofStarter(queues, accountId) {
  const nextAction = buildTikTokAccountNextAction(queues, accountId);
  if (!nextAction.ok) {
    return minimalTikTokAccountError(nextAction);
  }
  const rows = nextAction.status === "blocked_real_clip_intake" ? [] : nextAction.nextRow ? [{
    metricool_queue_item_id: nextAction.nextRow.queueItemId,
    metricool_approval_url: "<paste real Metricool planner URL after scheduling this exact account row>",
    operator_notes: nextAction.nextRow.scheduledNoteTemplate,
  }] : [];
  return {
    ok: true,
    statusCode: 200,
    accountId: nextAction.accountId,
    filename: `clippers-${nextAction.accountId}-next-scheduled-proof-starter.csv`,
    csv: renderCsv(["metricool_queue_item_id", "metricool_approval_url", "operator_notes"], rows),
  };
}

const uploadChecklistHeader = [
  "order",
  "metricool_queue_item_id",
  "metricool_brand",
  "account_name",
  "platform",
  "publish_at_local",
  "publish_at_iso",
  "upload_file_name",
  "caption_seed",
  "scheduled_note_template",
];

function tiktokAccountNextUploadChecklist(queues, accountId, status = {}) {
  const nextAction = buildTikTokAccountNextAction(queues, accountId);
  if (!nextAction.ok) return minimalTikTokAccountError(nextAction);
  const row = nextAction.nextRow || null;
  const globalNextQueueItemId = status.metricoolSchedulingRunSheet?.nextRow?.queueItemId || status.operatorSummary?.deadlineQueueItemId || "";
  const includeRow = Boolean(row && row.queueItemId === globalNextQueueItemId && status.operatorSummary?.needsRollForward !== true);
  return {
    ok: true,
    statusCode: 200,
    accountId: nextAction.accountId,
    filename: `clippers-${nextAction.accountId}-next-upload-checklist.csv`,
    csv: renderCsv(uploadChecklistHeader, includeRow ? [{
      order: 1,
      metricool_queue_item_id: row.queueItemId,
      metricool_brand: row.brand,
      account_name: row.accountName,
      platform: row.platform,
      publish_at_local: row.publishAtLocal || row.publishAt,
      publish_at_iso: row.publishAt,
      upload_file_name: row.uploadFileName,
      caption_seed: row.captionSeed,
      scheduled_note_template: row.scheduledNoteTemplate,
    }] : []),
  };
}

function currentTikTokAccountId(status = {}) {
  return status.metricoolSchedulingRunSheet?.nextRow?.accountId || "";
}

function currentTikTokNextUploadChecklist(status = {}) {
  const accountId = currentTikTokAccountId(status);
  if (!accountId) {
    return {
      ok: false,
      statusCode: 404,
      error: "current_tiktok_account_not_found",
    };
  }
  const result = tiktokAccountNextUploadChecklist(status.tiktokAccountQueues, accountId, status);
  return result.ok ? { ...result, filename: "clippers-current-tiktok-next-upload-checklist.csv" } : result;
}

function currentTikTokNextScheduledProofStarter(status = {}) {
  const accountId = currentTikTokAccountId(status);
  if (!accountId) {
    return {
      ok: false,
      statusCode: 404,
      error: "current_tiktok_account_not_found",
    };
  }
  const result = tiktokAccountNextScheduledProofStarter(status.tiktokAccountQueues, accountId);
  return result.ok ? { ...result, filename: "clippers-current-tiktok-next-scheduled-proof-starter.csv" } : result;
}

function currentTikTokCaptionText(status = {}) {
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  if (!nextRow) {
    return {
      ok: false,
      statusCode: 404,
      error: "current_tiktok_caption_not_found",
    };
  }
  return {
    ok: true,
    statusCode: 200,
    text: `${nextRow.captionSeed || ""}\n`,
  };
}

function currentTikTokVideoRedirect(status = {}) {
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const uploadFileUrl = String(nextRow?.uploadFileUrl || "");
  if (
    !uploadFileUrl
    || !uploadFileUrl.startsWith("/clippers-workspace/scheduled/metricool-current-batch-upload-pack/")
    || !uploadFileUrl.endsWith(".mp4")
  ) {
    return {
      ok: false,
      statusCode: 404,
      error: "current_tiktok_video_not_found",
    };
  }
  if (status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status)) {
    return {
      ok: false,
      statusCode: 409,
      error: "current_tiktok_video_blocked_until_real_clip_intake_ready",
    };
  }
  return {
    ok: true,
    statusCode: 302,
    location: uploadFileUrl,
  };
}

function renderTikTokBatchScheduleNowPage(status) {
  const rows = status.metricoolSchedulingRunSheet?.rows || [];
  const nextQueueItemId = status.metricoolSchedulingRunSheet?.nextRow?.queueItemId || "";
  const intakeBlocked = status.status === "blocked_real_clip_intake";
  const scheduleReady = status.nextBestAction?.stage === "schedule_in_metricool"
    && !intakeBlocked
    && status.operatorSummary?.needsRollForward !== true
    && status.uploadPackIntegrity?.status === "ready"
    && status.evidenceIntegrity?.status === "clean";
  const rowCards = rows.map((row) => {
    const isNext = row.queueItemId === nextQueueItemId;
    const canPreviewProof = scheduleReady && isNext && !row.hasMetricoolScheduledEvidence;
    return `<section class="clip ${isNext ? "next" : ""}">
      <div class="clip-head">
        <div>
          <div class="eyebrow">${isNext ? "Next deadline" : `Order ${escapeHtml(row.order)}`}</div>
          <h2>${escapeHtml(row.metricoolBrandName)} / ${escapeHtml(row.accountName)}</h2>
        </div>
        <code>${escapeHtml(row.queueItemId)}</code>
      </div>
      <div class="meta">
        <div><span>Publish</span><strong>${escapeHtml(row.publishAtLocal || row.publishAt)}</strong><small>${escapeHtml(row.publishAt)}</small></div>
        <div><span>File</span><strong>${row.uploadFileUrl ? link(row.uploadFileUrl, row.uploadFileName || "MP4") : escapeHtml(row.uploadFileName || "missing")}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(row.evidenceState || "unknown")}</strong><small>${escapeHtml((row.evidenceMissingFields || []).map((field) => ({
          metricool_approval_url: "scheduled_proof",
          published_post_url: "public_tiktok_url",
        }[field] || field)).join(", "))}</small></div>
      </div>
      <div class="caption">${escapeHtml(row.captionSeed || "")}</div>
      <div class="note">${escapeHtml(row.scheduledNoteTemplate || "")}</div>
      ${canPreviewProof ? `<form method="post" action="/api/clippers/evidence/scheduled-preview">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
        <input type="hidden" name="returnTo" value="/api/clippers/tiktok-batch-schedule-now.html" />
        <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
        <input name="metricoolApprovalUrl" placeholder="https://app.metricool.com/..." />
        <textarea name="operatorNotes" placeholder="Real note, 20+ chars.">${escapeHtml(row.scheduledNoteTemplate || "")}</textarea>
        <button type="submit">Preview scheduled proof</button>
      </form>` : `<p class="small">${intakeBlocked ? "Blocked: replace placeholders with approved real TikTok clips before scheduling in Metricool." : isNext ? "Resolve the batch gate before saving proof." : "Schedule/save proof only after earlier deadline rows are done."}</p>`}
    </section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers TikTok Batch Now</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1120px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    h2{font-size:18px;margin:4px 0 0}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .card,.clip{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px}
    .card strong{display:block;font-size:22px;color:#fff;margin-top:4px}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821}
    .clip{margin:12px 0}
    .clip.next{border-color:#4aa6cf;background:#14202a}
    .clip-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .eyebrow,.small,small{font-size:12px;color:#9fb0c4}
    .eyebrow{text-transform:uppercase;letter-spacing:.04em}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:14px 0}
    .meta div{border-top:1px solid #293644;padding-top:8px}
    .meta span{display:block;font-size:12px;color:#9fb0c4}
    .meta strong{display:block;color:#fff;margin:3px 0}
    .caption,.note{border:1px solid #263340;background:#0f141b;border-radius:8px;padding:10px;margin:8px 0}
    .note{color:#c7d0dc}
    input,textarea{box-sizing:border-box;width:100%;border:1px solid #304253;background:#0b1118;color:#eef7ff;border-radius:6px;padding:8px;margin:6px 0;font:inherit}
    textarea{min-height:72px}
    button{border:1px solid #3d6a83;background:#0f3248;border-radius:8px;padding:10px 12px;color:#eaf7ff;font:inherit;cursor:pointer}
  </style>
</head>
<body>
<main>
  <h1>Clippers TikTok Batch Now</h1>
  <p>${intakeBlocked ? "El batch esta bloqueado: los MP4 actuales son placeholders y no deben programarse en Metricool. Primero reemplaza cada fila con un clip real aprobado." : "Una vista para programar la tanda TikTok en Metricool sin usar APIs directas. Solo la fila marcada como Next deadline permite guardar proof preview; las demás esperan su turno."}</p>
  <div class="grid">
    <div class="card">Status<strong>${escapeHtml(status.status)}</strong></div>
    <div class="card">Pending rows<strong>${escapeHtml(rows.length)}</strong></div>
    <div class="card">Upload pack<strong>${escapeHtml(status.uploadPackIntegrity?.readyFiles || 0)}/${escapeHtml(status.uploadPackIntegrity?.totalRows || 0)}</strong></div>
    <div class="card">Scheduled proof missing<strong>${escapeHtml(status.evidence?.missingApproval ?? 0)}</strong></div>
    <div class="card">Metricool approval<strong>${escapeHtml(status.metricoolApprovalRequired ? "required" : "off")}</strong></div>
    <div class="card">realPublishEnabled<strong>${escapeHtml(status.realPublishEnabled ? "true" : "false")}</strong></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/next-metricool-action.html", "Metricool now")}
    ${link("/api/clippers/tiktok-current-account-now.html", "Current TikTok now")}
    ${link("/api/clippers/metricool-upload-checklist.csv", "Upload CSV")}
    ${link("/api/clippers/scheduled-proof-starter.csv", "Proof CSV")}
    ${link("/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html", "Upload pack")}
    ${link("/api/clippers/operator-ready.json", "Ready JSON")}
  </div>
  ${intakeBlocked ? `<section class="clip">
    <div class="clip-head">
      <div>
        <div class="eyebrow">Real clip intake required</div>
        <h2>No programar placeholders</h2>
      </div>
    </div>
    <p>Faltan archivos reales, URLs exactas de TikTok, evidencia de derechos o manifest completo. Cuando el intake este listo, esta pagina volvera a mostrar los formularios de scheduled proof.</p>
    <p>${link("/api/clippers/real-clip-intake.html", "Open real clip intake")} · ${link("/api/clippers/real-clip-source-hunt.html", "Source hunt")} · ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}</p>
  </section>` : `<section class="clip">
    <div class="clip-head">
      <div>
        <div class="eyebrow">Batch proof import</div>
        <h2>Pega varios planner URLs reales</h2>
      </div>
    </div>
    <p>Usa esto solo después de programar esos clips en Metricool y en el mismo orden de deadline. Si una fila falla, no se escribe nada.</p>
    <form method="post" action="/api/clippers/evidence/scheduled-batch-preview">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="returnTo" value="/api/clippers/tiktok-batch-schedule-now.html" />
      <textarea name="scheduledEvidenceBatch" placeholder="Pega aqui el CSV descargado desde Proof CSV despues de reemplazar cada placeholder con el planner URL real de Metricool y una nota concreta."></textarea>
      <button type="submit">Preview scheduled proof batch</button>
    </form>
    <p class="small">${link("/api/clippers/scheduled-proof-starter.csv", "Download full starter CSV")} · ${link("/api/clippers/next-scheduled-proof-starter.csv", "Download next row only")}</p>
  </section>`}
  ${rows.length ? rowCards : `<div class="card"><strong>No pending TikTok rows.</strong><p>All current rows either have scheduled proof or the batch needs refresh.</p></div>`}
  <p class="small">Guardrails: Metricool approval_required only. realPublishEnabled=false. No real Metricool planner URLs or public TikTok URLs are rendered here.</p>
</main>
</body>
</html>`;
}

function renderTikTokPublicMetricsNowPage(status) {
  const rows = status.publicMetricsRunSheet?.rows || [];
  const nextRow = status.publicMetricsRunSheet?.nextRow || null;
  const canRecord = Boolean(nextRow && status.publicMetricsRunSheet?.status === "needs_public_tiktok_metrics");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers TikTok Public Metrics Now</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:980px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    h2{font-size:18px;margin:4px 0 0}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}
    .card,.row-card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:12px 0}
    .card strong{display:block;font-size:22px;color:#fff;margin-top:4px}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821}
    .label,.small,small{font-size:12px;color:#9fb0c4}
    .label{text-transform:uppercase;letter-spacing:.04em}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
    .meta div{border-top:1px solid #293644;padding-top:8px}
    .meta span{display:block;font-size:12px;color:#9fb0c4}
    .meta strong{display:block;color:#fff;margin:3px 0}
    input,textarea{box-sizing:border-box;width:100%;border:1px solid #304253;background:#0b1118;color:#eef7ff;border-radius:6px;padding:8px;margin:6px 0;font:inherit}
    textarea{min-height:72px}
    button{border:1px solid #3d6a83;background:#0f3248;border-radius:8px;padding:10px 12px;color:#eaf7ff;font:inherit;cursor:pointer}
  </style>
</head>
<body>
<main>
  <h1>Clippers TikTok Public Metrics Now</h1>
  <p>Usa esta pantalla solo cuando el post ya este vivo y tengas numeros reales de 24h. No publica, no agenda y no guarda nada sin preview + confirm.</p>
  <div class="grid">
    <div class="card">Status<strong>${escapeHtml(status.publicMetricsRunSheet?.status || "unknown")}</strong></div>
    <div class="card">Eligible<strong>${escapeHtml(status.publicMetricsRunSheet?.eligibleRows || 0)}</strong></div>
    <div class="card">Pending<strong>${escapeHtml(status.publicMetricsRunSheet?.pendingRows || 0)}</strong></div>
    <div class="card">Locked<strong>${escapeHtml(status.publicMetricsRunSheet?.lockedRows || 0)}</strong></div>
    <div class="card">realPublishEnabled<strong>${escapeHtml(status.realPublishEnabled ? "true" : "false")}</strong></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/tiktok-batch-schedule-now.html", "TikTok batch now")}
    ${link("/api/clippers/published-metrics-starter.csv", "Metrics CSV")}
    ${link("/api/clippers/next-published-metrics-starter.csv", "Next metrics CSV")}
    ${link("/api/clippers/operator-ready.json", "Ready JSON")}
  </div>
  ${canRecord ? `<section class="row-card">
    <div class="label">Next public metrics row</div>
    <h2>${escapeHtml(nextRow.metricoolBrandName)} / ${escapeHtml(nextRow.accountName)}</h2>
    <div class="meta">
      <div><span>Queue item</span><strong><code>${escapeHtml(nextRow.queueItemId)}</code></strong></div>
      <div><span>Publish</span><strong>${escapeHtml(nextRow.publishAtLocal || nextRow.publishAt)}</strong><small>${escapeHtml(nextRow.publishAt)}</small></div>
      <div><span>File</span><strong>${nextRow.uploadFileUrl ? link(nextRow.uploadFileUrl, nextRow.uploadFileName || "MP4") : escapeHtml(nextRow.uploadFileName || "missing")}</strong></div>
    </div>
    <form method="post" action="/api/clippers/evidence/published-preview">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="returnTo" value="/api/clippers/tiktok-public-metrics-now.html" />
      <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(nextRow.queueItemId)}" />
      <input name="publishedPostUrl" placeholder="https://www.tiktok.com/@account/video/123..." />
      <input name="views24h" placeholder="views after 24h" />
      <input name="likes24h" placeholder="likes after 24h" />
      <input name="comments24h" placeholder="comments after 24h" />
      <input name="shares24h" placeholder="shares after 24h" />
      <textarea name="operatorNotes" placeholder="Real note, 20+ chars.">Real published metrics captured after TikTok was live for 24h.</textarea>
      <button type="submit">Preview published metrics</button>
    </form>
    <p class="small">Exact HTTPS TikTok video URL required. Views must be positive. This form does not write until confirmation.</p>
  </section>` : `<section class="row-card">
    <div class="label">Locked</div>
    <h2>No public metrics row is ready yet</h2>
    <p>${escapeHtml(status.publicMetricsRunSheet?.nextAction || "Record Metricool scheduled proof first.")}</p>
  </section>`}
  ${rows.length ? `<section class="row-card">
    <div class="label">Pending metrics rows</div>
    ${rows.map((row) => `<p><code>${escapeHtml(row.queueItemId)}</code> ${escapeHtml(row.metricoolBrandName)} / ${escapeHtml(row.accountName)} · ${escapeHtml(row.publishAtLocal || row.publishAt)} · ${escapeHtml(row.evidenceState)}</p>`).join("")}
  </section>` : ""}
  <p class="small">Guardrails: Metricool proof must exist first. realPublishEnabled=false. This page does not render stored planner URLs, public TikTok URLs, or metrics.</p>
</main>
</body>
</html>`;
}

function minimalTikTokAccountError(result = {}) {
  return {
    ok: false,
    statusCode: result.statusCode || 400,
    error: result.error || "tiktok_account_error",
  };
}

function tiktokAccountRunbookMarkdown(queues, accountId) {
  const nextAction = buildTikTokAccountNextAction(queues, accountId);
  if (!nextAction.ok) return nextAction;
  const row = nextAction.nextRow || {};
  const intakeBlocked = nextAction.status === "blocked_real_clip_intake";
  const proofCsvHref = `${localOrigin()}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=${encodeURIComponent(nextAction.accountId)}`;
  const nextProofCsvHref = `${localOrigin()}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=${encodeURIComponent(nextAction.accountId)}`;
  const lines = [
    `# Clippers TikTok Runbook: ${nextAction.brand} / ${nextAction.accountName}`,
    "",
    `Generated: ${nextAction.generatedAt}`,
    `Status: ${nextAction.status}`,
    `Account ID: ${nextAction.accountId}`,
    `Platform: ${nextAction.platform}`,
    `realPublishEnabled: false`,
    `Metricool approval required: true`,
    "",
    "## Next Row",
    "",
    row.queueItemId ? [
      `- Queue item: ${row.queueItemId}`,
      `- Account order: ${row.accountOrder}`,
      `- Publish local: ${row.publishAtLocal || row.publishAt}`,
      `- Publish ISO: ${row.publishAt}`,
      `- Upload file: ${row.uploadFileName}`,
      `- Caption: ${row.captionSeed}`,
      `- Evidence: ${row.evidenceState}${row.missingFields?.length ? ` (${row.missingFields.join(", ")})` : ""}`,
      `- Proof note: ${row.scheduledNoteTemplate}`,
    ].join("\n") : "No scheduled proof row is pending for this account.",
    "",
    intakeBlocked ? "## Do Before Metricool" : "## Do In Metricool",
    "",
    intakeBlocked
      ? [
        "1. Do not open Metricool for this row yet.",
        "2. Replace the placeholder with an approved real TikTok clip.",
        "3. Complete exact URL, local MP4, rights evidence, and source-drop manifest.",
        "4. Refresh the Metricool batch only after real clip intake is ready.",
      ].join("\n")
      : [
        "1. Open Metricool and select the account/brand above.",
        row.uploadFileName ? `2. Upload ${row.uploadFileName}.` : "2. No upload is pending.",
        row.publishAtLocal || row.publishAt ? `3. Use publish time ${row.publishAtLocal || row.publishAt}.` : "3. Confirm no publish time is pending.",
        "4. Keep Metricool in approval_required mode.",
        "5. Copy the real Metricool planner URL only after scheduling.",
        "6. Use the account proof CSV starter below and preview before saving evidence.",
      ].join("\n"),
    "",
    "## Links",
    "",
    `- Account next scheduled proof CSV: ${nextProofCsvHref}`,
    `- Account scheduled proof CSV: ${proofCsvHref}`,
    `- Account next JSON: ${localOrigin()}/api/clippers/tiktok-account-next.json?accountId=${encodeURIComponent(nextAction.accountId)}`,
    `- Account queues CSV: ${localOrigin()}/api/clippers/tiktok-account-queues.csv`,
    `- Operator UI: ${localOrigin()}/clippers`,
    "",
    "## Guardrails",
    "",
    "- Do not paste public TikTok URLs until the post is live.",
    "- Do not enter views, likes, comments, or shares until 24h metrics are real.",
    "- This runbook does not include Metricool planner proof URLs or public TikTok URLs.",
  ].flat();
  return {
    ok: true,
    statusCode: 200,
    accountId: nextAction.accountId,
    filename: `clippers-${nextAction.accountId}-runbook.md`,
    markdown: `${lines.join("\n")}\n`,
  };
}

function metricoolDeadlineQueue(status, { limit = 10 } = {}) {
  return (status.metricoolSchedulingRunSheet?.rows || [])
    .slice(0, limit)
    .map((row) => ({
      order: row.order,
      queueItemId: row.queueItemId,
      brand: row.metricoolBrandName,
      accountName: row.accountName,
      platform: row.platform,
      publishAtLocal: row.publishAtLocal,
      publishAt: row.publishAt,
      leadMinutes: row.leadMinutes,
      uploadFileName: row.uploadFileName,
      uploadFileUrl: row.uploadFileUrl,
      captionSeed: row.captionSeed,
      evidenceState: row.evidenceState,
      missingFields: row.evidenceMissingFields,
      scheduledNoteTemplate: row.scheduledNoteTemplate,
    }));
}

function classifyClipSource(row = {}) {
  const sourcePath = String(row.sourcePath || "");
  const sourceFileName = String(row.sourceFileName || path.basename(sourcePath) || "");
  const sourceText = `${sourcePath} ${sourceFileName}`.toLowerCase();
  if (/(^|[/_-])(sports|memes|streamers)-owned-\d+/.test(sourceText) || sourceText.includes("owned-source://")) {
    return {
      kind: "generated_owned_asset",
      label: "Generated owned source",
      realClip: false,
      detail: "Local text/graphic asset generated to stay rights-safe; not a viral third-party clip.",
    };
  }
  if (sourceText.includes("source-scout-ready")) {
    return {
      kind: "source_scout_asset",
      label: "Source Scout asset",
      realClip: false,
      detail: "Source Scout file requires exact URL, rights proof, and manual reality review before counting as a real clip.",
    };
  }
  if (sourceFileName) {
    return {
      kind: "unverified_external_source",
      label: "Unverified manual/external source file",
      realClip: false,
      detail: "A local file alone is not a real approved clip. It requires an exact URL, rights proof, and source-drop validation before Metricool approval.",
    };
  }
  return {
    kind: "unknown_needs_review",
    label: "Unknown source",
    realClip: false,
    detail: "No original source metadata is attached; do not count this upload-pack file as a real clip.",
  };
}

function canonicalTikTokAccountName(accountId, fallback = "") {
  if (accountId === "sports-daily") return "Streamer Highlights";
  if (accountId === "meme-radar") return "Streamer Reactions";
  return fallback;
}

function buildRealClipGapSummary(rows = [], uploadPackIntegrity = {}) {
  const uploadRowsByQueueId = new Map((uploadPackIntegrity.rows || []).map((row) => [String(row.queueItemId || ""), row]));
  const rowSummaries = rows.map((row) => {
    const source = classifyClipSource(row);
    const uploadRow = uploadRowsByQueueId.get(String(row.queueItemId || "")) || {};
    return {
      queueItemId: row.queueItemId || "",
      rank: row.rank || "",
      accountId: row.accountId || "",
      brand: row.metricoolBrandName || "",
      accountName: canonicalTikTokAccountName(row.accountId, row.accountName || ""),
      platform: row.platform || "",
      publishAt: row.publishAt || "",
      uploadFileName: row.uploadFileName || "",
      sourceFileName: row.sourceFileName || "",
      sourceMetadataPresent: Boolean(row.sourceFileName || row.sourcePath),
      sourceKind: source.kind,
      sourceLabel: source.label,
      realClip: source.realClip,
      uploadOk: uploadRow.ok === true,
      detail: source.detail,
    };
  });
  const generatedOwnedRows = rowSummaries.filter((row) => row.sourceKind === "generated_owned_asset").length;
  const sourceScoutRows = rowSummaries.filter((row) => row.sourceKind === "source_scout_asset").length;
  const realClipRows = rowSummaries.filter((row) => row.realClip).length;
  const totalRows = rowSummaries.length;
  const missingRealClips = Math.max(0, totalRows - realClipRows);
  const status = totalRows === 0
    ? "no_batch_rows"
    : realClipRows === totalRows ? "real_clips_loaded"
      : generatedOwnedRows === totalRows ? "generated_owned_placeholder_batch"
        : "mixed_sources_need_review";
  return {
    status,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_current_batch",
    totalRows,
    realClipRows,
    generatedOwnedRows,
    sourceScoutRows,
    missingRealClips,
    uploadFilesReady: uploadPackIntegrity.readyFiles || 0,
    summary: realClipRows === totalRows
      ? "Every current TikTok row points at a non-generated local source file. Rights/evidence still control Metricool approval."
      : `Current Metricool batch is upload-ready but not real-clip-ready: ${missingRealClips}/${totalRows} rows still use generated/safe placeholder assets or unverified scout files.`,
    nextAction: missingRealClips > 0
      ? "Replace the generated owned assets with real rights-cleared clip files through source-drop, then regenerate the Metricool batch upload pack."
      : "Review rights proof and schedule through Metricool approval_required mode.",
    blockers: [
      missingRealClips > 0 ? `real_clip_sources_missing_${missingRealClips}` : null,
      generatedOwnedRows > 0 ? `generated_owned_assets_in_batch_${generatedOwnedRows}` : null,
      sourceScoutRows > 0 ? `source_scout_assets_need_reality_review_${sourceScoutRows}` : null,
    ].filter(Boolean),
    rows: rowSummaries,
  };
}

function buildRealClipGapMarkdown(status) {
  const gap = status.realClipGap || buildRealClipGapSummary(status.rows || [], status.uploadPackIntegrity || {});
  return [
    "# Clippers Real Clip Gap",
    "",
    `Generated: ${gap.generatedAt}`,
    `Scope: ${gap.scope}`,
    `Status: ${gap.status}`,
    "",
    gap.summary,
    "",
    "## Counts",
    "",
    `- Total TikTok rows: ${gap.totalRows}`,
    `- Real/manual external clip rows: ${gap.realClipRows}`,
    `- Generated owned placeholder rows: ${gap.generatedOwnedRows}`,
    `- Source Scout rows needing reality review: ${gap.sourceScoutRows}`,
    `- Missing real clips: ${gap.missingRealClips}`,
    `- Upload files ready: ${gap.uploadFilesReady}/${gap.totalRows}`,
    "",
    "## Next Action",
    "",
    gap.nextAction,
    "",
    "## Rows",
    "",
    "| Rank | Queue | Account | Source kind | File |",
    "| --- | --- | --- | --- | --- |",
    ...gap.rows.map((row) => `| ${row.rank} | ${row.queueItemId} | ${row.brand} / ${row.accountName} | ${row.sourceKind} | ${row.sourceFileName || row.uploadFileName} |`),
    "",
    "## Guardrails",
    "",
    "- Generated owned assets are safe placeholders, not viral clips.",
    "- Do not count a row as a real clip until the local source file, exact URL, and rights proof are real.",
    "- Keep Metricool in approval_required mode.",
    "",
  ].join("\n");
}

function categoryForRealClipRow(row = {}) {
  const brand = String(row.brand || row.metricoolBrandName || "").toLowerCase();
  const account = String(row.accountName || row.accountId || "").toLowerCase();
  if (brand.includes("sport") || account.includes("sport")) return "sports";
  if (brand.includes("meme") || account.includes("meme")) return "memes";
  if (brand.includes("stream") || account.includes("stream")) return "streamers";
  return "uncategorized";
}

function targetRealClipFileName(row = {}) {
  const category = categoryForRealClipRow(row);
  const queueItemId = String(row.queueItemId || "missing").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "missing";
  return `${category}-real-${queueItemId}.mp4`;
}

function buildRealClipIntakePack(status) {
  const gap = status.realClipGap || buildRealClipGapSummary(status.rows || [], status.uploadPackIntegrity || {});
  const rows = (gap.rows || [])
    .filter((row) => row.realClip !== true)
    .map((row, index) => {
      const category = categoryForRealClipRow(row);
      const targetFileName = targetRealClipFileName(row);
      return {
        order: index + 1,
        rank: row.rank || "",
        queueItemId: row.queueItemId || "",
        category,
        brand: row.brand || "",
        accountId: row.accountId || "",
        accountName: row.accountName || "",
        platform: row.platform || "tiktok",
        publishAt: row.publishAt || "",
        currentUploadFileName: row.uploadFileName || "",
        currentSourceKind: row.sourceKind || "",
        targetSourceDropFile: `source-drop/${category}/${targetFileName}`,
        manifestFile: `source-drop/${category}/source-drop-manifest.csv`,
        targetFileName,
        exactVideoOrPostUrl: "<paste exact TikTok, Twitch clip, or YouTube video URL; not search/explore/channel>",
        creatorOrRightsHolder: "<paste creator/source name>",
        rightsStatus: "review_required",
        evidenceType: "<creator_permission|licensed_asset|owned_source|official_policy_allowlist|recreate_plan_approved>",
        evidenceLink: "<paste proof URL or local proof path>",
        notes: "Replace this starter row with a real source file, exact URL, rights proof, and 20+ character notes before import.",
        aiProcessing: "",
        originalStreamEndedAt: "",
        plannedPublishAt: "",
        contextReviewStatus: "",
        creditText: "",
      };
    });
  const manifestRows = rows.map((row) => ({
    category: safeCsvText(row.category),
    title: safeCsvText(`${row.brand || row.accountName} replacement for queue ${row.queueItemId}`),
    url: safeCsvText(row.exactVideoOrPostUrl),
    source: safeCsvText(row.creatorOrRightsHolder),
    platform: safeCsvText(row.platform),
    target_file_name: safeCsvText(row.targetFileName),
    rights_status: safeCsvText(row.rightsStatus),
    evidence_link: safeCsvText(row.evidenceLink),
    priority: safeCsvText(row.order <= 10 ? "high" : "medium"),
    notes: safeCsvText(row.notes),
    ai_processing: safeCsvText(row.aiProcessing),
    original_stream_ended_at: safeCsvText(row.originalStreamEndedAt),
    planned_publish_at: safeCsvText(row.plannedPublishAt),
    context_review_status: safeCsvText(row.contextReviewStatus),
    credit_text: safeCsvText(row.creditText),
  }));
  const manifestCsv = renderCsv([
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
    "ai_processing",
    "original_stream_ended_at",
    "planned_publish_at",
    "context_review_status",
    "credit_text",
  ], manifestRows);
  return {
    status: rows.length ? "needs_real_clip_intake" : "no_replacement_rows_needed",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_real_clip_replacements",
    totalRows: rows.length,
    targetReplacementFiles: rows.length,
    sourceDropCategories: [...new Set(rows.map((row) => row.category))].filter(Boolean),
    summary: rows.length
      ? `Prepare ${rows.length} real rights-cleared TikTok clip file(s) to replace generated placeholders in the current Metricool batch.`
      : "No generated/unverified source rows need replacement in the current batch.",
    nextAction: rows.length
      ? "Put each real MP4 in the listed source-drop folder, replace all starter placeholders in the manifest with exact URLs and rights proof, then run the source-drop import/Metricool batch refresh."
      : "Review Metricool approval queue and rights evidence before scheduling.",
    guardrails: [
      "Starter placeholders are not evidence.",
      "Do not use search, explore, hashtag, or results URLs as exact clip URLs.",
      "Do not repost third-party clips without written permission, license, owned source, official allowlist, or approved recreate plan.",
      "Keep Metricool approval_required and realPublishEnabled=false.",
    ],
    manifestCsv,
    rows,
  };
}

async function buildLightweightRealClipIntakeStatus() {
  const [sessionPacket, workbook, uploadPackReport] = await Promise.all([
    readJson(sessionPacketJsonPath, {}),
    readJson(currentBatchWorkbookJsonPath, {}),
    readJson(currentBatchUploadPackJsonPath, {}),
  ]);
  const workbookByQueueId = new Map((workbook.rows || []).map((row) => [String(row.metricoolQueueItemId || ""), row]));
  const uploadPackByQueueId = new Map((uploadPackReport.rows || []).map((row) => [String(row.metricoolQueueItemId || ""), row]));
  const sessionRows = Array.isArray(sessionPacket.rows) ? sessionPacket.rows : [];
  const fallbackRows = sessionRows.length
    ? []
    : (Array.isArray(uploadPackReport.rows) && uploadPackReport.rows.length ? uploadPackReport.rows : workbook.rows || []);
  const baseRows = sessionRows.length ? sessionRows : fallbackRows;
  const rows = baseRows.filter((row) => isTikTokPlatform(row.platform || "tiktok")).map((row) => {
    const queueItemId = String(row.metricoolQueueItemId || row.queueItemId || "");
    const workbookRow = workbookByQueueId.get(queueItemId) || {};
    const uploadPackRow = uploadPackByQueueId.get(queueItemId) || {};
    const sourcePath = row.sourcePath || uploadPackRow.sourcePath || workbookRow.sourcePath || "";
    return {
      rank: row.rank || "",
      status: row.status || "",
      queueItemId,
      accountName: row.accountName || uploadPackRow.accountName || workbookRow.accountName || "",
      accountId: row.accountId || uploadPackRow.accountId || workbookRow.accountId || "",
      metricoolBrandName: row.metricoolBrandName || uploadPackRow.metricoolBrandName || workbookRow.metricoolBrandName || "",
      platform: row.platform || uploadPackRow.platform || workbookRow.platform || "tiktok",
      publishAt: row.publishAt || uploadPackRow.publishAt || workbookRow.publishAt || "",
      sourcePath,
      sourceFileName: row.sourceFileName || workbookRow.sourceFileName || path.basename(sourcePath || ""),
      uploadFileName: row.uploadFileName || uploadPackRow.uploadFileName || "",
      uploadFilePath: row.uploadFilePath || uploadPackRow.uploadFilePath || "",
      captionSeed: row.captionSeed || uploadPackRow.captionSeed || workbookRow.captionSeed || "",
    };
  });
  const uploadIntegrityRows = (uploadPackReport.rows || []).map((row) => ({
    queueItemId: row.metricoolQueueItemId || row.queueItemId || "",
    ok: row.status === "ready_to_upload" || row.ok === true,
  }));
  const uploadPackIntegrity = {
    readyFiles: uploadIntegrityRows.filter((row) => row.ok).length,
    rows: uploadIntegrityRows,
  };
  return {
    rows,
    lightweightSource: sessionRows.length ? "session_packet" : "upload_pack_fallback",
    uploadPackIntegrity,
    realClipGap: buildRealClipGapSummary(rows, uploadPackIntegrity),
  };
}

function buildRealClipIntakeMarkdown(status) {
  const pack = buildRealClipIntakePack(status);
  return [
    "# Clippers Real Clip Intake Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Scope: ${pack.scope}`,
    `Status: ${pack.status}`,
    "",
    pack.summary,
    "",
    "## Counts",
    "",
    `- Replacement rows needed: ${pack.totalRows}`,
    `- Source-drop categories: ${pack.sourceDropCategories.join(", ") || "none"}`,
    "",
    "## Next Action",
    "",
    pack.nextAction,
    "",
    "## Replacement Rows",
    "",
    "| Order | Queue | Account | Current source | Put real file here | Manifest |",
    "| --- | --- | --- | --- | --- | --- |",
    ...pack.rows.map((row) => `| ${row.order} | ${row.queueItemId} | ${row.brand} / ${row.accountName} | ${row.currentSourceKind} | ${row.targetSourceDropFile} | ${row.manifestFile} |`),
    "",
    "## Required Manifest Columns",
    "",
    "`category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes,ai_processing,original_stream_ended_at,planned_publish_at,context_review_status,credit_text`",
    "",
    "## Guardrails",
    "",
    ...pack.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Links",
    "",
    `- Manifest CSV starter: ${localOrigin()}/api/clippers/real-clip-intake-manifest.csv`,
    `- Real Clip Gap: ${localOrigin()}/api/clippers/real-clip-gap.md`,
    "",
  ].join("\n");
}

function renderRealClipIntakePage(status) {
  const pack = buildRealClipIntakePack(status);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Real Clip Intake</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a,.actions button{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821;color:#eaf7ff;font:inherit}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff;word-break:break-word}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Clippers Real Clip Intake</h1>
  <p>Esta pantalla existe para reemplazar los placeholders por clips reales con permiso. No descarga, no publica y no convierte placeholders en proof.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(pack.status)}</div></div>
    <div class="card"><div class="label">Replacements</div><div class="value">${escapeHtml(pack.totalRows)}</div></div>
    <div class="card"><div class="label">Mode</div><div class="value">Metricool</div><p class="small">approval_required · realPublishEnabled=false</p></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-intake.md", "Intake MD")}
    ${link("/api/clippers/real-clip-intake-manifest.csv", "Manifest CSV")}
    ${link("/api/clippers/real-clip-closeout-work-packet.md", "Closeout packet")}
    ${link("/api/clippers/real-clip-closeout-work-packet.csv", "Closeout CSV")}
    ${link("/api/clippers/real-clip-gap.md", "Real Clip Gap")}
    <form method="post" action="/api/clippers/real-clip-intake/initialize-source-drop">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <button type="submit">Initialize source-drop workspace</button>
    </form>
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(pack.nextAction)}</p>
  </div>
  <div class="card">
    <div class="label">Replacement rows</div>
    <table>
      <thead><tr><th>Order</th><th>Queue</th><th>Account</th><th>Current</th><th>Put real MP4 here</th><th>Manifest</th></tr></thead>
      <tbody>
        ${pack.rows.map((row) => `<tr>
          <td>${escapeHtml(row.order)}</td>
          <td>${escapeHtml(row.queueItemId)}<div class="small">Rank ${escapeHtml(row.rank)}</div></td>
          <td>${escapeHtml(row.brand)}<div class="small">${escapeHtml(row.accountName)}</div></td>
          <td>${escapeHtml(row.currentSourceKind)}<div class="small">${escapeHtml(row.currentUploadFileName)}</div></td>
          <td><code>${escapeHtml(row.targetSourceDropFile)}</code></td>
          <td><code>${escapeHtml(row.manifestFile)}</code></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Guardrails</div>
    ${pack.guardrails.map((guardrail) => `<p class="small">${escapeHtml(guardrail)}</p>`).join("")}
  </div>
</main>
</body>
</html>`;
}

function hasStarterPlaceholder(value) {
  const textValue = String(value || "").trim();
  return !textValue || /<[^>]+>|placeholder|paste|todo|tbd|example|replace this starter/i.test(textValue);
}

function isExactYouTubeVideoOrShortUrl(value) {
  const raw = String(value || "").trim();
  if (hasStarterPlaceholder(raw) || !/^https:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (parsed.username || parsed.password) return false;
    const videoId = /^[A-Za-z0-9_-]{11}$/;
    if (hostName === "youtu.be") {
      return !parsed.search && !parsed.hash && videoId.test(parsed.pathname.replace(/^\//, "").replace(/\/$/, ""));
    }
    if (!["youtube.com", "m.youtube.com"].includes(hostName) || parsed.hash) return false;
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/);
    if (shortsMatch) return !parsed.search;
    if (parsed.pathname !== "/watch") return false;
    const keys = [...parsed.searchParams.keys()];
    return keys.length === 1 && keys[0] === "v" && videoId.test(parsed.searchParams.get("v") || "");
  } catch {
    return false;
  }
}

function isExactTwitchClipUrl(value) {
  const raw = String(value || "").trim();
  if (hasStarterPlaceholder(raw) || !/^https:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (parsed.username || parsed.password) return false;
    if (parsed.search || parsed.hash) return false;
    if (hostName === "clips.twitch.tv") return /^\/[A-Za-z0-9_-]{4,120}\/?$/.test(parsed.pathname);
    if (["twitch.tv", "m.twitch.tv"].includes(hostName)) {
      return /^\/[A-Za-z0-9_]{3,25}\/clip\/[A-Za-z0-9_-]{4,120}\/?$/.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function isExactSourceVideoOrPostUrl(value) {
  const raw = String(value || "").trim();
  if (hasStarterPlaceholder(raw)) return false;
  return isTikTokVideoUrl(raw) || isExactYouTubeVideoOrShortUrl(raw) || isExactTwitchClipUrl(raw);
}

function sourcePlatformForExactUrl(value) {
  if (isTikTokVideoUrl(value)) return "tiktok";
  if (isExactTwitchClipUrl(value)) return "twitch";
  if (isExactYouTubeVideoOrShortUrl(value)) return "youtube";
  return "unknown";
}

function sourceUrlMatchesCreator(value, source) {
  const expected = campaignHandleKey(source);
  if (!expected) return false;
  try {
    const parsed = new URL(String(value || "").trim());
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (["tiktok.com", "m.tiktok.com"].includes(hostName)) {
      const match = parsed.pathname.match(/^\/@([^/]+)\/video\/[0-9]+\/?$/i);
      return Boolean(match && campaignHandleKey(match[1]) === expected);
    }
    if (["twitch.tv", "m.twitch.tv"].includes(hostName)) {
      const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{3,25})\/clip\/[A-Za-z0-9_-]{4,120}\/?$/);
      return Boolean(match && campaignHandleKey(match[1]) === expected);
    }
    return false;
  } catch {
    return false;
  }
}

function creditIdentifiesCreator(value, source) {
  const credit = String(value || "").trim().toLowerCase();
  const creator = campaignHandleKey(source);
  return creator.length >= 3 && credit.length >= creator.length + 4 && campaignHandleKey(credit).includes(creator);
}

function concreteIntakeNotes(value) {
  return !validateOperatorNotes(value);
}

async function sourceDropContainedPath(category, fileName = "") {
  const safeCategory = String(category || "").replace(/[^A-Za-z0-9_-]/g, "");
  const safeFileName = fileName ? path.basename(String(fileName || "")) : "";
  if (!safeCategory || (fileName && safeFileName !== String(fileName || ""))) {
    return { ok: false, status: "invalid_target_name", category: safeCategory, filePath: "" };
  }
  const sourceDropRoot = path.join(workspaceRoot, "source-drop");
  const categoryDir = path.join(sourceDropRoot, safeCategory);
  const rootLinkStat = await lstat(sourceDropRoot).catch(() => null);
  if (rootLinkStat?.isSymbolicLink()) {
    return { ok: false, status: "source_drop_root_symlink_blocked", category: safeCategory, filePath: "" };
  }
  if (!rootLinkStat) {
    const filePath = safeFileName ? path.join(sourceDropRoot, safeCategory, safeFileName) : "";
    return { ok: true, status: "ready", category: safeCategory, categoryDir: path.join(sourceDropRoot, safeCategory), filePath };
  }
  const workspaceReal = await realpath(workspaceRoot).catch(() => workspaceRoot);
  const rootReal = await realpath(sourceDropRoot).catch(() => sourceDropRoot);
  const expectedRootReal = path.join(workspaceReal, "source-drop");
  if (rootReal !== expectedRootReal) {
    return { ok: false, status: "source_drop_root_outside_workspace", category: safeCategory, filePath: "" };
  }
  const categoryLinkStat = await lstat(categoryDir).catch(() => null);
  if (!categoryLinkStat) {
    return { ok: true, status: "ready", category: safeCategory, categoryDir, filePath: safeFileName ? path.join(categoryDir, safeFileName) : "" };
  }
  if (categoryLinkStat.isSymbolicLink()) {
    return { ok: false, status: "source_drop_category_symlink_or_missing", category: safeCategory, filePath: "" };
  }
  const categoryReal = await realpath(categoryDir).catch(() => null);
  if (!categoryReal || categoryReal !== path.join(rootReal, safeCategory)) {
    return { ok: false, status: "source_drop_category_outside_workspace", category: safeCategory, filePath: "" };
  }
  if (!categoryReal.startsWith(rootReal + path.sep)) {
    return { ok: false, status: "source_drop_category_outside_workspace", category: safeCategory, filePath: "" };
  }
  if (!safeFileName) return { ok: true, status: "ready", category: safeCategory, categoryDir, filePath: "" };
  const filePath = path.join(categoryDir, safeFileName);
  return { ok: true, status: "ready", category: safeCategory, categoryDir, filePath };
}

async function ensureSourceDropCategoryDir(category) {
  const safeCategory = String(category || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeCategory) return { ok: false, status: "invalid_target_name", category: "", categoryDir: "" };
  const sourceDropRoot = path.join(workspaceRoot, "source-drop");
  const rootLinkStat = await lstat(sourceDropRoot).catch(() => null);
  if (rootLinkStat?.isSymbolicLink()) {
    return { ok: false, status: "source_drop_root_symlink_blocked", category: safeCategory, categoryDir: "" };
  }
  await mkdir(sourceDropRoot, { recursive: true });
  const categoryDir = path.join(sourceDropRoot, safeCategory);
  const categoryLinkStat = await lstat(categoryDir).catch(() => null);
  if (categoryLinkStat?.isSymbolicLink()) {
    return { ok: false, status: "source_drop_category_symlink_or_missing", category: safeCategory, categoryDir };
  }
  if (!categoryLinkStat) await mkdir(categoryDir, { recursive: true });
  const contained = await sourceDropContainedPath(safeCategory);
  return contained.ok ? contained : { ...contained, category: safeCategory, categoryDir };
}

async function sourceDropManifestLocation(category) {
  const contained = await sourceDropContainedPath(category);
  if (!contained.ok) return { ok: false, status: contained.status, manifestPath: "" };
  return {
    ok: true,
    status: "ready",
    category: contained.category,
    manifestPath: path.join(contained.categoryDir, "source-drop-manifest.csv"),
  };
}

async function ensureContainedEvidenceDir(...segments) {
  const evidenceRoot = path.join(workspaceRoot, "evidence-drop");
  const rootLinkStat = await lstat(evidenceRoot).catch(() => null);
  if (rootLinkStat?.isSymbolicLink()) {
    return { ok: false, status: "evidence_drop_root_symlink_blocked", dirPath: "" };
  }
  await mkdir(evidenceRoot, { recursive: true });
  const workspaceReal = await realpath(workspaceRoot).catch(() => workspaceRoot);
  const rootReal = await realpath(evidenceRoot).catch(() => evidenceRoot);
  const expectedRootReal = path.join(workspaceReal, "evidence-drop");
  if (path.relative(expectedRootReal, rootReal).startsWith("..") || path.isAbsolute(path.relative(expectedRootReal, rootReal))) {
    return { ok: false, status: "evidence_drop_root_outside_workspace", dirPath: "" };
  }
  const safeSegments = segments.map((segment) => String(segment || "").replace(/[^A-Za-z0-9_-]/g, "")).filter(Boolean);
  const dirPath = path.join(evidenceRoot, ...safeSegments);
  await mkdir(dirPath, { recursive: true });
  const dirReal = await realpath(dirPath).catch(() => null);
  if (!dirReal || (dirReal !== rootReal && !dirReal.startsWith(rootReal + path.sep))) {
    return { ok: false, status: "evidence_drop_dir_outside_workspace", dirPath: "" };
  }
  return { ok: true, status: "ready", dirPath };
}

async function sourceDropVideoStatus(category, fileName) {
  const safeFileName = path.basename(String(fileName || ""));
  if (!safeFileName || safeFileName !== String(fileName || "")) {
    return { ok: false, status: "invalid_target_name", bytes: 0 };
  }
  const contained = await sourceDropContainedPath(category, safeFileName);
  if (!contained.ok) return { ok: false, status: contained.status, bytes: 0 };
  const filePath = contained.filePath;
  const linkStat = await lstat(filePath).catch(() => null);
  if (linkStat?.isSymbolicLink()) return { ok: false, status: "source_file_symlink_blocked", bytes: 0 };
  const fileStat = linkStat?.isFile() ? linkStat : null;
  if (!fileStat?.isFile()) return { ok: false, status: "missing_source_file", bytes: 0 };
  if (fileStat.size < 8192) return { ok: false, status: "source_file_too_small", bytes: fileStat.size };
  const prefix = await readFilePrefix(filePath, Math.min(4096, fileStat.size));
  if (!prefix) return { ok: false, status: "source_file_read_failed", bytes: fileStat.size };
  const signature = prefix.toString("latin1");
  if (!signature.includes("ftyp")) return { ok: false, status: "source_file_not_mp4_like", bytes: fileStat.size };
  return { ok: true, status: "ready", bytes: fileStat.size };
}

function manifestRecordForTarget(manifestRows, targetFileName) {
  const normalizedTarget = String(targetFileName || "").trim().toLowerCase();
  return manifestRows.find((record) => [
    record.target_file_name,
    record.source_file_name,
    record.source_file,
    record.drop_file_name,
    record.drop_file,
  ].some((value) => String(value || "").trim().toLowerCase() === normalizedTarget)) || null;
}

async function buildRealClipIntakeValidation(status) {
  const pack = buildRealClipIntakePack(status);
  const streamerCampaign = await buildStreamer100Campaign();
  const streamerPermissions = campaignPermissionMap(streamerCampaign.permissionLedgerRows);
  const manifestCache = new Map();
  for (const category of new Set(pack.rows.map((row) => row.category))) {
    const manifestLocation = await sourceDropManifestLocation(category);
    const raw = manifestLocation.ok ? await readText(manifestLocation.manifestPath, "") : "";
    manifestCache.set(category, {
      exists: Boolean(raw.trim()),
      locationStatus: manifestLocation.status,
      rows: raw.trim() ? parseCsv(raw).rows : [],
    });
  }
  const rows = await Promise.all(pack.rows.map(async (intakeRow) => {
    const manifest = manifestCache.get(intakeRow.category);
    const record = manifestRecordForTarget(manifest.rows, intakeRow.targetFileName);
    const fileStatus = await sourceDropVideoStatus(intakeRow.category, intakeRow.targetFileName);
    const rightsStatus = String(record?.rights_status || record?.rightsStatus || "").trim();
    const url = String(record?.url || record?.source_url || record?.sourceUrl || "").trim();
    const source = String(record?.source || record?.creator || record?.creator_or_rights_holder || "").trim();
    const evidenceLink = String(record?.evidence_link || record?.evidence || record?.proof_url || record?.proof || "").trim();
    const notes = String(record?.notes || "").trim();
    const creatorPermission = streamerPermissions.get(campaignHandleKey(source));
    const creatorRestrictions = creatorPermission?.restrictions || {};
    const aiProcessing = String(record?.ai_processing || record?.aiProcessing || "").trim().toLowerCase();
    const contextReviewStatus = String(record?.context_review_status || record?.contextReviewStatus || "").trim().toLowerCase();
    const creditText = String(record?.credit_text || record?.creditText || "").trim();
    const streamEndedAt = Date.parse(String(record?.original_stream_ended_at || record?.originalStreamEndedAt || "").trim());
    const plannedPublishAt = Date.parse(String(record?.planned_publish_at || record?.plannedPublishAt || "").trim());
    const canonicalPublishAt = Date.parse(String(intakeRow.publishAt || "").trim());
    const allowedAccountNames = Array.isArray(creatorRestrictions.allowedAccountNames) ? creatorRestrictions.allowedAccountNames : [];
    const requiredDelayMs = Math.max(0, Number(creatorRestrictions.minimumPublishDelayHours || 0)) * 60 * 60 * 1000;
    const plannedPublishMatchesQueue = Number.isFinite(plannedPublishAt)
      && Number.isFinite(canonicalPublishAt)
      && Math.abs(plannedPublishAt - canonicalPublishAt) <= 60_000;
    const minimumPublishDelayVerified = requiredDelayMs === 0 || (
      Number.isFinite(streamEndedAt)
      && Number.isFinite(canonicalPublishAt)
      && plannedPublishMatchesQueue
      && canonicalPublishAt - streamEndedAt >= requiredDelayMs
    );
    const restrictionBlockers = [
      !creatorPermission ? "not_in_blanket_campaign" : null,
      creatorPermission && creatorPermission.permissionStatus !== "approved_blanket" && creatorPermission.permissionStatus !== "denied"
        ? "creator_blanket_permission_not_approved"
        : null,
      creatorPermission?.permissionStatus === "denied" ? "creator_permission_denied" : null,
      creatorPermission?.permissionStatus === "approved_blanket" && creatorRestrictions.noAi && !["none", "ffmpeg_no_ai", "deterministic_ffmpeg_no_ai"].includes(aiProcessing)
        ? "creator_no_ai_processing_not_verified"
        : null,
      creatorPermission?.permissionStatus === "approved_blanket" && creatorRestrictions.contextReviewRequired && contextReviewStatus !== "approved"
        ? "creator_context_review_not_approved"
        : null,
      creatorPermission?.permissionStatus === "approved_blanket" && creatorRestrictions.creatorCreditRequired && !creditIdentifiesCreator(creditText, source)
        ? "creator_credit_text_missing"
        : null,
      creatorPermission?.permissionStatus === "approved_blanket" && allowedAccountNames.length && !allowedAccountNames.includes(intakeRow.accountName)
        ? "creator_account_not_authorized"
        : null,
      creatorPermission?.permissionStatus === "approved_blanket" && requiredDelayMs > 0 && !minimumPublishDelayVerified
        ? "creator_minimum_publish_delay_not_verified"
        : null,
    ].filter(Boolean);
    const evidenceStatus = record ? await realClipEvidenceStatus(evidenceLink) : { ok: false, status: "evidence_link_missing" };
    const blockers = [
      fileStatus.ok ? null : fileStatus.status,
      manifest.locationStatus === "ready" ? null : manifest.locationStatus,
      manifest.exists ? null : "manifest_missing",
      record ? null : "manifest_row_missing",
      record && isExactSourceVideoOrPostUrl(url) ? null : "exact_source_video_or_post_url_missing",
      record && !hasStarterPlaceholder(source) ? null : "creator_or_source_missing",
      record && !hasStarterPlaceholder(source) && isExactSourceVideoOrPostUrl(url) && !sourceUrlMatchesCreator(url, creatorPermission?.handle || source)
        ? "source_url_creator_not_verified"
        : null,
      record && rightsStatus === "owned_or_permissioned" ? null : "rights_status_not_owned_or_permissioned",
      record && evidenceStatus.ok ? null : evidenceStatus.status,
      record && concreteIntakeNotes(notes) ? null : "operator_notes_not_concrete",
      ...restrictionBlockers,
    ].filter(Boolean);
    return {
      order: intakeRow.order,
      queueItemId: intakeRow.queueItemId,
      category: intakeRow.category,
      accountName: intakeRow.accountName,
      brand: intakeRow.brand,
      targetSourceDropFile: intakeRow.targetSourceDropFile,
      manifestFile: intakeRow.manifestFile,
      targetFileName: intakeRow.targetFileName,
      status: blockers.length ? "blocked" : "ready_for_source_drop_import",
      blockers,
      fileStatus: fileStatus.status,
      fileBytes: fileStatus.bytes,
      manifestRowFound: Boolean(record),
      exactUrlOk: Boolean(record && isExactSourceVideoOrPostUrl(url)),
      rightsStatus: rightsStatus || "missing",
      evidenceLinkPresent: Boolean(record && evidenceStatus.ok),
      evidenceStatus: evidenceStatus.status,
      notesOk: Boolean(record && concreteIntakeNotes(notes)),
      creatorPermissionStatus: creatorPermission?.permissionStatus || "not_in_blanket_campaign",
      creatorRestrictions,
      creatorRestrictionChecks: {
        aiProcessing: aiProcessing || "missing",
        contextReviewStatus: contextReviewStatus || "missing",
        creditTextPresent: creditIdentifiesCreator(creditText, source),
        allowedAccount: !allowedAccountNames.length || allowedAccountNames.includes(intakeRow.accountName),
        plannedPublishMatchesQueue,
        minimumPublishDelayVerified,
      },
    };
  }));
  const readyRows = rows.filter((row) => row.status === "ready_for_source_drop_import").length;
  const blockedRows = rows.length - readyRows;
  return {
    status: rows.length === 0 ? "no_intake_rows" : blockedRows ? "blocked" : "ready_for_source_drop_import",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_real_clip_intake_validation",
    totalRows: rows.length,
    readyRows,
    blockedRows,
    summary: blockedRows
      ? `${blockedRows}/${rows.length} real clip intake row(s) are still blocked by missing files, exact URLs, rights proof, or manifest values.`
      : "All real clip intake rows have local MP4 files plus manifest URL/source/rights/evidence fields ready for the next source-drop import review.",
    nextAction: blockedRows
      ? "Fill source-drop files and manifests until every row is ready_for_source_drop_import, then run the source-drop import/Metricool batch refresh."
      : "Run the existing source-drop import flow, then regenerate the Metricool current batch upload pack.",
    rows,
  };
}

function buildRealClipIntakeValidationMarkdown(validation) {
  return [
    "# Clippers Real Clip Intake Validation",
    "",
    `Generated: ${validation.generatedAt}`,
    `Scope: ${validation.scope}`,
    `Status: ${validation.status}`,
    "",
    validation.summary,
    "",
    "## Counts",
    "",
    `- Total rows: ${validation.totalRows}`,
    `- Ready rows: ${validation.readyRows}`,
    `- Blocked rows: ${validation.blockedRows}`,
    "",
    "## Next Action",
    "",
    validation.nextAction,
    "",
    "## Rows",
    "",
    "| Order | Queue | Target file | Status | Blockers |",
    "| --- | --- | --- | --- | --- |",
    ...validation.rows.map((row) => `| ${row.order} | ${row.queueItemId} | ${row.targetSourceDropFile} | ${row.status} | ${row.blockers.join("; ") || "none"} |`),
    "",
    "## Guardrails",
    "",
    "- Ready means ready for source-drop import review, not ready to publish.",
    "- Exact TikTok, Twitch clip, or YouTube video URL, rights status, evidence link, notes, and local MP4 must all be real.",
    "- Keep Metricool approval_required and realPublishEnabled=false.",
    "",
  ].join("\n");
}

function renderRealClipIntakeValidationPage(validation) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Real Clip Intake Validation</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff;word-break:break-word}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Clippers Real Clip Intake Validation</h1>
  <p>Valida que cada reemplazo tenga MP4 local, URL exacta, source, rights_status=owned_or_permissioned, evidence link y notas concretas. No publica ni importa.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(validation.status)}</div></div>
    <div class="card"><div class="label">Ready</div><div class="value">${escapeHtml(validation.readyRows)}/${escapeHtml(validation.totalRows)}</div></div>
    <div class="card"><div class="label">Blocked</div><div class="value">${escapeHtml(validation.blockedRows)}</div></div>
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(validation.nextAction)}</p>
    <p class="small">${link("/api/clippers/real-clip-intake-validation.md", "Validation MD")} · ${link("/api/clippers/real-clip-intake.html", "Intake pack")} · ${link("/api/clippers/real-clip-intake-manifest.csv", "Manifest starter CSV")} · ${link("/api/clippers/real-clip-intake-batch-template.csv", "Batch CSV template")}</p>
  </div>
  <div class="card">
    <div class="label">Batch exact URL + rights proof intake</div>
    <form method="post" action="/api/clippers/real-clip-intake/record-batch">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <textarea name="realClipIntakeBatch" rows="8" placeholder="metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,evidence_link,operator_notes,ai_processing,original_stream_ended_at,planned_publish_at,context_review_status,credit_text"></textarea>
      <button type="submit">Validate and record batch</button>
    </form>
    <p class="small">If any row is invalid, nothing is written. This records manifest proof only; local MP4 files are still required.</p>
  </div>
  <div class="card">
    <div class="label">Rows</div>
    <table>
      <thead><tr><th>Order</th><th>Queue</th><th>Target</th><th>Status</th><th>Blockers</th></tr></thead>
      <tbody>
        ${validation.rows.map((row) => `<tr>
          <td>${escapeHtml(row.order)}</td>
          <td>${escapeHtml(row.queueItemId)}</td>
          <td><code>${escapeHtml(row.targetSourceDropFile)}</code></td>
          <td>${escapeHtml(row.status)}<div class="small">${escapeHtml(row.fileStatus)} · ${escapeHtml(row.fileBytes)} bytes</div></td>
          <td>${escapeHtml(row.blockers.join(", ") || "none")}
            <details>
              <summary>Record exact URL + rights proof</summary>
              <form method="post" action="/api/clippers/real-clip-intake/record">
                <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
                <input type="hidden" name="returnTo" value="/api/clippers/real-clip-intake-validation.html" />
                <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
                <input name="exactVideoOrPostUrl" placeholder="https://www.tiktok.com/@creator/video/1234567890123456789" />
                <input name="creatorOrRightsHolder" placeholder="@creator or rights holder" />
                <input name="evidenceLink" placeholder="https://proof.example/permission or /clippers-workspace/evidence-drop/..." />
                <textarea name="operatorNotes" placeholder="20+ chars. Describe permission/source proof without secrets."></textarea>
                <select name="aiProcessing">
                  <option value="">AI processing (leave blank if unrestricted)</option>
                  <option value="none">None</option>
                  <option value="ffmpeg_no_ai">FFmpeg, no AI</option>
                  <option value="deterministic_ffmpeg_no_ai">Deterministic FFmpeg, no AI</option>
                  <option value="ai_assisted">AI assisted</option>
                </select>
                <input name="originalStreamEndedAt" placeholder="Original stream ended at (ISO 8601, optional)" />
                <input name="plannedPublishAt" placeholder="Planned publish at (ISO 8601, optional)" />
                <select name="contextReviewStatus">
                  <option value="">Context review (leave blank if unrestricted)</option>
                  <option value="not_required">Not required</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <input name="creditText" maxlength="500" placeholder="Exact creator credit text (optional)" />
                <button type="submit">Record intake proof</button>
              </form>
              <p class="small">This only updates the source-drop manifest. A local MP4 is still required before the row can become ready.</p>
            </details>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>`;
}

function validatedOptionalTimestamp(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) return { ok: true, value: "" };
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    return { ok: false, error: `invalid_${fieldName}` };
  }
  return { ok: true, value: normalized, parsed };
}

function validateRealClipIntakeRecordInput(status, input = {}) {
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const exactVideoOrPostUrl = String(input.exactVideoOrPostUrl || "").trim();
  const creatorOrRightsHolder = String(input.creatorOrRightsHolder || "").trim();
  const evidenceLink = String(input.evidenceLink || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  const aiProcessing = String(input.aiProcessing || "").trim().toLowerCase();
  const contextReviewStatus = String(input.contextReviewStatus || "").trim().toLowerCase();
  const creditText = String(input.creditText || "").trim();
  const originalStreamEndedAt = validatedOptionalTimestamp(input.originalStreamEndedAt, "original_stream_ended_at");
  const plannedPublishAt = validatedOptionalTimestamp(input.plannedPublishAt, "planned_publish_at");
  if (!/^[a-z0-9_-]{6,80}$/i.test(metricoolQueueItemId)) {
    return { ok: false, statusCode: 400, error: "invalid_metricool_queue_item_id", metricoolQueueItemId };
  }
  const intakeRow = buildRealClipIntakePack(status).rows.find((row) => row.queueItemId === metricoolQueueItemId);
  if (!intakeRow) {
    return { ok: false, statusCode: 404, error: "real_clip_intake_row_not_found", metricoolQueueItemId };
  }
  if (!isExactSourceVideoOrPostUrl(exactVideoOrPostUrl)) {
    return { ok: false, statusCode: 400, error: "exact_source_video_or_post_url_required", metricoolQueueItemId };
  }
  if (hasStarterPlaceholder(creatorOrRightsHolder) || secretTextPattern.test(creatorOrRightsHolder) || secretQueryParamPattern.test(creatorOrRightsHolder)) {
    return { ok: false, statusCode: 400, error: "creator_or_rights_holder_required", metricoolQueueItemId };
  }
  if (!isAllowedRealClipEvidenceLink(evidenceLink)) {
    return { ok: false, statusCode: 400, error: "valid_rights_evidence_link_required", metricoolQueueItemId };
  }
  const notesError = validateOperatorNotes(operatorNotes);
  if (notesError) return { ok: false, statusCode: 400, error: notesError, metricoolQueueItemId };
  if (aiProcessing && !["none", "ffmpeg_no_ai", "deterministic_ffmpeg_no_ai", "ai_assisted"].includes(aiProcessing)) {
    return { ok: false, statusCode: 400, error: "invalid_ai_processing", metricoolQueueItemId };
  }
  if (!originalStreamEndedAt.ok) return { ok: false, statusCode: 400, error: originalStreamEndedAt.error, metricoolQueueItemId };
  if (!plannedPublishAt.ok) return { ok: false, statusCode: 400, error: plannedPublishAt.error, metricoolQueueItemId };
  if (originalStreamEndedAt.value && plannedPublishAt.value && plannedPublishAt.parsed < originalStreamEndedAt.parsed) {
    return { ok: false, statusCode: 400, error: "planned_publish_at_before_original_stream_ended_at", metricoolQueueItemId };
  }
  if (contextReviewStatus && !["not_required", "pending", "approved", "rejected"].includes(contextReviewStatus)) {
    return { ok: false, statusCode: 400, error: "invalid_context_review_status", metricoolQueueItemId };
  }
  if (creditText && (hasStarterPlaceholder(creditText) || creditText.length > 500 || secretTextPattern.test(creditText) || secretQueryParamPattern.test(creditText))) {
    return { ok: false, statusCode: 400, error: "invalid_credit_text", metricoolQueueItemId };
  }
  return {
    ok: true,
    statusCode: 200,
    intakeRow,
    metricoolQueueItemId,
    exactVideoOrPostUrl,
    creatorOrRightsHolder,
    evidenceLink,
    operatorNotes,
    aiProcessing,
    originalStreamEndedAt: originalStreamEndedAt.value,
    plannedPublishAt: plannedPublishAt.value,
    contextReviewStatus,
    creditText,
  };
}

const realClipIntakeBatchHeader = [
  "metricool_queue_item_id",
  "exact_video_or_post_url",
  "creator_or_rights_holder",
  "evidence_link",
  "operator_notes",
  "ai_processing",
  "original_stream_ended_at",
  "planned_publish_at",
  "context_review_status",
  "credit_text",
];

function realClipIntakeBatchTemplateCsv(status) {
  const pack = buildRealClipIntakePack(status);
  return renderCsv(realClipIntakeBatchHeader, pack.rows.map((row) => ({
    metricool_queue_item_id: safeCsvText(row.queueItemId),
    exact_video_or_post_url: safeCsvText("<paste exact TikTok post, Twitch clip, or YouTube video/Short URL>"),
    creator_or_rights_holder: safeCsvText("<paste creator or rights holder>"),
    evidence_link: safeCsvText(evidenceTemplateUrl(row.queueItemId)),
    operator_notes: safeCsvText("Replace with 20+ chars describing the real permission/source evidence without secrets."),
    ai_processing: "",
    original_stream_ended_at: "",
    planned_publish_at: "",
    context_review_status: "",
    credit_text: "",
  })));
}

function normalizeRealClipIntakeBatchRow(row = {}) {
  return {
    metricoolQueueItemId: row.metricool_queue_item_id || row.metricoolQueueItemId || row.queue_item_id || row.queueItemId || "",
    exactVideoOrPostUrl: row.exact_video_or_post_url || row.exactVideoOrPostUrl || row.url || "",
    creatorOrRightsHolder: row.creator_or_rights_holder || row.creatorOrRightsHolder || row.source || row.creator || "",
    evidenceLink: row.evidence_link || row.evidenceLink || row.proof_url || row.proof || "",
    operatorNotes: row.operator_notes || row.operatorNotes || row.notes || "",
    aiProcessing: row.ai_processing || row.aiProcessing || "",
    originalStreamEndedAt: row.original_stream_ended_at || row.originalStreamEndedAt || "",
    plannedPublishAt: row.planned_publish_at || row.plannedPublishAt || "",
    contextReviewStatus: row.context_review_status || row.contextReviewStatus || "",
    creditText: row.credit_text || row.creditText || "",
  };
}

function buildRealClipManifestRow(validated) {
  const { intakeRow } = validated;
  return {
    category: intakeRow.category,
    title: safeCsvText(`${intakeRow.brand || intakeRow.accountName} permissioned replacement for queue ${intakeRow.queueItemId}`),
    url: safeCsvText(validated.exactVideoOrPostUrl),
    source: safeCsvText(validated.creatorOrRightsHolder),
    platform: sourcePlatformForExactUrl(validated.exactVideoOrPostUrl),
    target_file_name: intakeRow.targetFileName,
    rights_status: "owned_or_permissioned",
    evidence_link: safeCsvText(validated.evidenceLink),
    priority: intakeRow.order <= 10 ? "high" : "medium",
    notes: safeCsvText(validated.operatorNotes),
    ai_processing: safeCsvText(validated.aiProcessing),
    original_stream_ended_at: safeCsvText(validated.originalStreamEndedAt),
    planned_publish_at: safeCsvText(validated.plannedPublishAt),
    context_review_status: safeCsvText(validated.contextReviewStatus),
    credit_text: safeCsvText(validated.creditText),
  };
}

function isAllowedRealClipEvidenceLink(value) {
  const textValue = String(value || "").trim();
  if (hasStarterPlaceholder(textValue)) return false;
  if (secretTextPattern.test(textValue) || secretQueryParamPattern.test(textValue)) return false;
  if (/^https:\/\/[^\s]+$/i.test(textValue)) return true;
  if (textValue.startsWith("/clippers-workspace/evidence-drop/")) {
    const resolved = safeWorkspacePath(textValue);
    const evidenceDropRoot = path.join(workspaceRoot, "evidence-drop");
    return Boolean(resolved && (resolved === evidenceDropRoot || resolved.startsWith(evidenceDropRoot + path.sep)));
  }
  return false;
}

function evidenceTemplateFileName(queueItemId) {
  const safeQueueId = String(queueItemId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "missing";
  return `${safeQueueId}.md`;
}

function evidenceTemplateUrl(queueItemId) {
  return `/clippers-workspace/evidence-drop/real-clip-permissions/${encodeURIComponent(evidenceTemplateFileName(queueItemId))}`;
}

async function realClipEvidenceStatus(value) {
  const textValue = String(value || "").trim();
  if (!isAllowedRealClipEvidenceLink(textValue)) {
    return { ok: false, status: "evidence_link_missing" };
  }
  if (/^https:\/\/[^\s]+$/i.test(textValue)) {
    return { ok: true, status: "https_proof_url" };
  }
  const resolved = safeWorkspacePath(textValue);
  const evidenceDropRoot = path.join(workspaceRoot, "evidence-drop");
  if (!resolved || !(resolved === evidenceDropRoot || resolved.startsWith(evidenceDropRoot + path.sep))) {
    return { ok: false, status: "evidence_path_outside_workspace" };
  }
  const evidenceRootStat = await lstat(evidenceDropRoot).catch(() => null);
  if (evidenceRootStat?.isSymbolicLink()) return { ok: false, status: "evidence_root_symlink_blocked" };
  const linkStat = await lstat(resolved).catch(() => null);
  if (linkStat?.isSymbolicLink()) return { ok: false, status: "evidence_file_symlink_blocked" };
  if (!linkStat?.isFile()) return { ok: false, status: "evidence_file_missing" };
  const workspaceReal = await realpath(workspaceRoot).catch(() => workspaceRoot);
  const evidenceRootReal = await realpath(evidenceDropRoot).catch(() => evidenceDropRoot);
  if (evidenceRootReal !== workspaceReal && !evidenceRootReal.startsWith(workspaceReal + path.sep)) {
    return { ok: false, status: "evidence_root_outside_workspace" };
  }
  const evidenceFileReal = await realpath(resolved).catch(() => null);
  if (!evidenceFileReal || (evidenceFileReal !== evidenceRootReal && !evidenceFileReal.startsWith(evidenceRootReal + path.sep))) {
    return { ok: false, status: "evidence_file_outside_workspace" };
  }
  const raw = await readText(resolved, "");
  const content = raw.trim();
  if (content.length < 80) return { ok: false, status: "evidence_file_too_short" };
  if (hasStarterPlaceholder(content) || proofPlaceholderPattern.test(content)) {
    return { ok: false, status: "evidence_file_placeholder" };
  }
  if (secretTextPattern.test(content) || secretQueryParamPattern.test(content)) {
    return { ok: false, status: "evidence_file_secret_like" };
  }
  return { ok: true, status: "local_evidence_file_ready" };
}

async function recordRealClipIntakeManifestRow(input, { skipLock = false } = {}) {
  if (!skipLock) return withRealClipIntakeManifestLock(() => recordRealClipIntakeManifestRow(input, { skipLock: true }));
  const status = await buildStatus();
  const validated = validateRealClipIntakeRecordInput(status, input);
  if (!validated.ok) return validated;
  const { intakeRow } = validated;
  const categoryDir = await ensureSourceDropCategoryDir(intakeRow.category);
  if (!categoryDir.ok) {
    return { ok: false, statusCode: 409, error: categoryDir.status, metricoolQueueItemId: intakeRow.queueItemId };
  }
  const manifestPath = path.join(categoryDir.categoryDir, "source-drop-manifest.csv");
  const header = [
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
    "ai_processing",
    "original_stream_ended_at",
    "planned_publish_at",
    "context_review_status",
    "credit_text",
  ];
  const manifestRead = await readTextForMutation(manifestPath, { allowMissing: true });
  if (!manifestRead.ok) {
    return {
      ok: false,
      statusCode: 503,
      error: "source_drop_manifest_read_unavailable",
      metricoolQueueItemId: intakeRow.queueItemId,
    };
  }
  const raw = manifestRead.value;
  const parsed = raw.trim() ? parseCsv(raw) : { header, rows: [] };
  const rows = parsed.rows || [];
  const existingIndex = rows.findIndex((row) => String(row.target_file_name || "").trim() === intakeRow.targetFileName);
  const manifestRow = buildRealClipManifestRow(validated);
  if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...manifestRow };
  else rows.push(manifestRow);
  await atomicWriteFile(manifestPath, renderCsv(header, rows));
  const refreshedStatus = await buildStatus();
  const refreshedRow = refreshedStatus.realClipIntakeValidation?.rows?.find((row) => row.queueItemId === intakeRow.queueItemId) || null;
  return {
    ok: true,
    statusCode: 200,
    metricoolQueueItemId: intakeRow.queueItemId,
    manifestUrl: workspaceUrlForFilePath(manifestPath),
    targetSourceDropFile: intakeRow.targetSourceDropFile,
    rowStatus: refreshedRow?.status || "unknown",
    remainingBlockers: refreshedRow?.blockers || [],
    nextAction: refreshedRow?.status === "ready_for_source_drop_import"
      ? "Local source file and rights manifest are ready for source-drop import review. Regenerate the Metricool batch after import."
      : "Manifest updated. Add the real local MP4 file if it is still missing, then re-check validation.",
  };
}

async function recordRealClipIntakeManifestBatch(rawCsv, { skipLock = false } = {}) {
  if (!skipLock) return withRealClipIntakeManifestLock(() => recordRealClipIntakeManifestBatch(rawCsv, { skipLock: true }));
  const status = await buildStatus();
  const parsed = parseCsv(String(rawCsv || ""));
  if (!parsed.header.length || !parsed.rows.length) {
    return { ok: false, statusCode: 400, error: "real_clip_intake_batch_csv_required", rows: 0 };
  }
  const seenQueueIds = new Set();
  const validatedRows = [];
  const errors = [];
  parsed.rows.forEach((row, index) => {
    const input = normalizeRealClipIntakeBatchRow(row);
    const queueId = String(input.metricoolQueueItemId || "").trim();
    if (queueId && seenQueueIds.has(queueId)) {
      errors.push({
        line: index + 2,
        metricoolQueueItemId: queueId,
        error: "duplicate_metricool_queue_item_id",
      });
      return;
    }
    if (queueId) seenQueueIds.add(queueId);
    const validated = validateRealClipIntakeRecordInput(status, input);
    if (!validated.ok) {
      errors.push({
        line: index + 2,
        metricoolQueueItemId: queueId,
        error: validated.error,
      });
      return;
    }
    validatedRows.push({ line: index + 2, validated });
  });
  if (errors.length) {
    return {
      ok: false,
      statusCode: 400,
      error: "real_clip_intake_batch_invalid",
      rows: parsed.rows.length,
      accepted: 0,
      errors,
    };
  }

  const header = [
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
    "ai_processing",
    "original_stream_ended_at",
    "planned_publish_at",
    "context_review_status",
    "credit_text",
  ];
  const categoryGroups = new Map();
  for (const { validated } of validatedRows) {
    const category = validated.intakeRow.category;
    if (!categoryGroups.has(category)) categoryGroups.set(category, []);
    categoryGroups.get(category).push(validated);
  }

  const manifests = [];
  for (const [category, groupRows] of categoryGroups) {
    const categoryDir = await ensureSourceDropCategoryDir(category);
    if (!categoryDir.ok) {
      return {
        ok: false,
        statusCode: 409,
        error: categoryDir.status,
        category,
        accepted: 0,
      };
    }
    const manifestPath = path.join(categoryDir.categoryDir, "source-drop-manifest.csv");
    const manifestRead = await readTextForMutation(manifestPath, { allowMissing: true });
    if (!manifestRead.ok) {
      return {
        ok: false,
        statusCode: 503,
        error: "source_drop_manifest_read_unavailable",
        category,
        accepted: 0,
      };
    }
    const raw = manifestRead.value;
    const parsedManifest = raw.trim() ? parseCsv(raw) : { header, rows: [] };
    const manifestRows = parsedManifest.rows || [];
    for (const validated of groupRows) {
      const manifestRow = buildRealClipManifestRow(validated);
      const existingIndex = manifestRows.findIndex((row) => String(row.target_file_name || "").trim() === validated.intakeRow.targetFileName);
      if (existingIndex >= 0) manifestRows[existingIndex] = { ...manifestRows[existingIndex], ...manifestRow };
      else manifestRows.push(manifestRow);
    }
    manifests.push({ category, manifestPath, rows: manifestRows });
  }

  for (const manifest of manifests) {
    await atomicWriteFile(manifest.manifestPath, renderCsv(header, manifest.rows));
  }

  const refreshedStatus = await buildStatus();
  const rows = validatedRows.map(({ line, validated }) => {
    const refreshedRow = refreshedStatus.realClipIntakeValidation?.rows?.find((row) => row.queueItemId === validated.intakeRow.queueItemId) || null;
    return {
      line,
      metricoolQueueItemId: validated.intakeRow.queueItemId,
      category: validated.intakeRow.category,
      targetSourceDropFile: validated.intakeRow.targetSourceDropFile,
      rowStatus: refreshedRow?.status || "unknown",
      remainingBlockers: refreshedRow?.blockers || [],
    };
  });
  return {
    ok: true,
    statusCode: 200,
    status: "real_clip_intake_batch_recorded",
    rows: parsed.rows.length,
    accepted: rows.length,
    readyRows: rows.filter((row) => row.rowStatus === "ready_for_source_drop_import").length,
    blockedRows: rows.filter((row) => row.rowStatus !== "ready_for_source_drop_import").length,
    manifests: manifests.map((manifest) => ({
      category: manifest.category,
      manifestUrl: workspaceUrlForFilePath(manifest.manifestPath),
    })),
    rowResults: rows,
    nextAction: "Add any missing real MP4 source files, then re-check validation. No Metricool scheduling is unlocked until every row is ready.",
  };
}

async function initializeRealClipSourceDropWorkspace() {
  const status = await buildStatus();
  const pack = buildRealClipIntakePack(status);
  const header = [
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
  const categoryGroups = new Map();
  for (const row of pack.rows) {
    if (!categoryGroups.has(row.category)) categoryGroups.set(row.category, []);
    categoryGroups.get(row.category).push(row);
  }

  const categories = [];
  const pendingWrites = [];
  let manifestRowsAdded = 0;
  let manifestRowsPreserved = 0;
  for (const [category, rows] of categoryGroups) {
    const categoryDir = await ensureSourceDropCategoryDir(category);
    if (!categoryDir.ok) {
      categories.push({
        category,
        status: "blocked",
        error: categoryDir.status,
        rows: rows.length,
        manifestUrl: "",
        targetFiles: rows.map((row) => row.targetSourceDropFile),
      });
      continue;
    }
    const manifestPath = path.join(categoryDir.categoryDir, "source-drop-manifest.csv");
    const manifestRead = await readTextForMutation(manifestPath, { allowMissing: true });
    if (!manifestRead.ok) {
      return {
        ok: false,
        statusCode: 503,
        status: "source_drop_manifest_read_unavailable",
        generatedAt: new Date().toISOString(),
        totalRows: pack.totalRows,
        categories,
        manifestRowsAdded,
        manifestRowsPreserved,
        nextAction: "Retry after the existing source-drop manifest is locally readable; no manifest was overwritten for this category.",
      };
    }
    const raw = manifestRead.value;
    const parsed = raw.trim() ? parseCsv(raw) : { header, rows: [] };
    const manifestRows = (parsed.rows || []).map((record) => Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, workspaceSafeCsvText(value)])
    ));
    const existingTargets = new Set(manifestRows.map((record) => String(record.target_file_name || "").trim()).filter(Boolean));
    let addedForCategory = 0;
    for (const row of rows) {
      if (existingTargets.has(row.targetFileName)) {
        manifestRowsPreserved += 1;
        continue;
      }
      manifestRows.push({
        category: workspaceSafeCsvText(row.category),
        title: workspaceSafeCsvText(`${row.brand || row.accountName} replacement for queue ${row.queueItemId}`),
        url: workspaceSafeCsvText(row.exactVideoOrPostUrl),
        source: workspaceSafeCsvText(row.creatorOrRightsHolder),
        platform: workspaceSafeCsvText(row.platform),
        target_file_name: workspaceSafeCsvText(row.targetFileName),
        rights_status: workspaceSafeCsvText(row.rightsStatus),
        evidence_link: workspaceSafeCsvText(row.evidenceLink),
        priority: workspaceSafeCsvText(row.order <= 10 ? "high" : "medium"),
        notes: workspaceSafeCsvText(row.notes),
      });
      existingTargets.add(row.targetFileName);
      addedForCategory += 1;
      manifestRowsAdded += 1;
    }
    pendingWrites.push({ filePath: manifestPath, content: renderCsv(header, manifestRows) });
    const readmePath = path.join(categoryDir.categoryDir, "README.md");
    pendingWrites.push({ filePath: readmePath, content: [
      `# Clippers source-drop ${category}`,
      "",
      "Put real rights-cleared MP4 files in this folder using the target file names from source-drop-manifest.csv.",
      "",
      "Rules:",
      "- Do not put generated yellow placeholder files here.",
      "- Do not use search/explore/hashtag URLs as exact clip URLs.",
      "- Keep rights_status=review_required until proof is real.",
      "- Change rights_status to owned_or_permissioned only with proof URL/path and concrete notes.",
      "- Metricool stays approval_required; this folder does not publish anything.",
      "",
      "Expected files:",
      ...rows.map((row) => `- ${row.targetFileName} (${row.accountName}, queue ${row.queueItemId})`),
      "",
    ].join("\n") });
    categories.push({
      category,
      status: "initialized",
      rows: rows.length,
      rowsAdded: addedForCategory,
      rowsPreserved: rows.length - addedForCategory,
      manifestUrl: workspaceUrlForFilePath(manifestPath),
      readmeUrl: workspaceUrlForFilePath(readmePath),
      targetFiles: rows.map((row) => row.targetSourceDropFile),
    });
  }

  const evidenceDirResult = await ensureContainedEvidenceDir("real-clip-permissions");
  if (!evidenceDirResult.ok) {
    return {
      ok: false,
      statusCode: 409,
      status: evidenceDirResult.status,
      generatedAt: new Date().toISOString(),
      totalRows: pack.totalRows,
      categories,
      manifestRowsAdded,
      manifestRowsPreserved,
      nextAction: "Fix evidence-drop workspace path before initializing permission evidence folder.",
    };
  }
  const evidenceDir = evidenceDirResult.dirPath;
    const evidenceReadmePath = path.join(evidenceDir, "README.md");
  pendingWrites.push({ filePath: evidenceReadmePath, content: [
    "# Real clip permission evidence",
    "",
    "Store non-secret proof for creator permissions, licenses, official policy allowlists, owned source notes, or approved recreate plans.",
    "",
    "Never store passwords, cookies, OAuth tokens, recovery codes, or private messages with sensitive personal data here.",
    "",
    "Use paths like /clippers-workspace/evidence-drop/real-clip-permissions/<queue-id>.md in source-drop-manifest.csv.",
    "",
  ].join("\n") });
  const evidenceTemplates = [];
  for (const row of pack.rows) {
    const templatePath = path.join(evidenceDir, evidenceTemplateFileName(row.queueItemId));
    const templateRead = await readTextForMutation(templatePath, { allowMissing: true });
    if (!templateRead.ok) {
      return {
        ok: false,
        statusCode: 503,
        status: "permission_evidence_template_read_unavailable",
        generatedAt: new Date().toISOString(),
        totalRows: pack.totalRows,
        categories,
        manifestRowsAdded,
        manifestRowsPreserved,
        nextAction: "Retry after the existing permission evidence template is locally readable; it was not overwritten.",
      };
    }
    const existing = templateRead.value;
    if (!existing.trim()) {
      pendingWrites.push({ filePath: templatePath, content: [
        `# Real clip permission evidence: ${row.queueItemId}`,
        "",
        "Status: TEMPLATE - replace before using as proof",
        `Category: ${row.category}`,
        `Account: ${row.accountName}`,
        `Target source file: ${row.targetSourceDropFile}`,
        "",
        "Required real evidence:",
        "- Exact source URL:",
        "- Creator / rights holder:",
        "- Permission type: creator_permission | licensed_asset | owned_source | official_policy_allowlist | recreate_plan_approved",
        "- Proof reference URL or non-secret summary:",
        "- Credit requirements:",
        "- Date permission was captured:",
        "",
        "Do not store passwords, cookies, OAuth tokens, private messages with sensitive personal data, or screenshots containing secrets.",
        "",
      ].join("\n") });
    }
    evidenceTemplates.push({
      queueItemId: row.queueItemId,
      url: workspaceUrlForFilePath(templatePath),
      status: existing.trim() ? "preserved" : "created",
    });
  }

  for (const pendingWrite of pendingWrites) {
    await atomicWriteFile(pendingWrite.filePath, pendingWrite.content);
  }

  const refreshedStatus = await buildStatus();
  return {
    ok: true,
    statusCode: 200,
    status: "source_drop_workspace_initialized",
    generatedAt: new Date().toISOString(),
    totalRows: pack.totalRows,
    categories,
    manifestRowsAdded,
    manifestRowsPreserved,
    evidenceReadmeUrl: workspaceUrlForFilePath(evidenceReadmePath),
    evidenceTemplates,
    realClipIntakeValidation: refreshedStatus.realClipIntakeValidation || null,
    nextAction: "Replace starter manifest placeholders with exact TikTok, Twitch clip, or YouTube video URLs, creator/source, real evidence links, and put the matching MP4 files in source-drop before running import.",
    guardrails: pack.guardrails,
  };
}

function buildRealClipCloseoutWorkPacket(status) {
  const validation = status.realClipIntakeValidation || { rows: [], status: "unknown", readyRows: 0, blockedRows: 0, totalRows: 0 };
  const rows = (validation.rows || []).map((row) => ({
    order: row.order,
    queueItemId: row.queueItemId,
    category: row.category,
    accountName: row.accountName,
    status: row.status,
    blockers: row.blockers || [],
    targetSourceDropFile: row.targetSourceDropFile,
    manifestFile: row.manifestFile,
    evidenceTemplate: evidenceTemplateUrl(row.queueItemId),
    exactVideoOrPostUrl: "<paste exact https://www.tiktok.com/@creator/video/id URL>",
    creatorOrRightsHolder: "<paste creator or rights holder>",
    rightsStatusRequired: "owned_or_permissioned",
    evidenceLinkRequired: evidenceTemplateUrl(row.queueItemId),
    nextAction: row.status === "ready_for_source_drop_import"
      ? "Ready for source-drop import review; run guarded import + Metricool refresh next."
      : "Add real MP4, exact source URL, creator/source, approved rights status, completed proof evidence, and concrete notes.",
  }));
  return {
    status: validation.status === "ready_for_source_drop_import" ? "ready_for_source_drop_import_review" : "needs_real_clip_closeout",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_real_clip_closeout_work_packet",
    totalRows: validation.totalRows || rows.length,
    readyRows: validation.readyRows || 0,
    blockedRows: validation.blockedRows || 0,
    rows,
    nextAction: rows.some((row) => row.status !== "ready_for_source_drop_import")
      ? "Work each row until blockers are empty, then run Source-drop Import + Metricool Refresh."
      : "Run Source-drop Import + Metricool Refresh; Metricool still stays approval_required.",
    guardrails: [
      "Evidence templates are not proof until placeholders are replaced with real non-secret evidence.",
      "Do not schedule placeholder/yellow generated videos.",
      "Do not use search/explore/hashtag URLs as exact video URLs.",
      "Metricool remains approval_required and realPublishEnabled=false.",
    ],
  };
}

function buildRealClipCloseoutWorkPacketCsv(packet) {
  return renderCsv([
    "order",
    "metricool_queue_item_id",
    "category",
    "account_name",
    "status",
    "blockers",
    "target_source_drop_file",
    "manifest_file",
    "evidence_template",
    "exact_video_or_post_url",
    "creator_or_rights_holder",
    "rights_status_required",
    "evidence_link_required",
    "next_action",
  ], packet.rows.map((row) => ({
    order: workspaceSafeCsvText(row.order),
    metricool_queue_item_id: workspaceSafeCsvText(row.queueItemId),
    category: workspaceSafeCsvText(row.category),
    account_name: workspaceSafeCsvText(row.accountName),
    status: workspaceSafeCsvText(row.status),
    blockers: workspaceSafeCsvText(row.blockers.join(";")),
    target_source_drop_file: workspaceSafeCsvText(row.targetSourceDropFile),
    manifest_file: workspaceSafeCsvText(row.manifestFile),
    evidence_template: workspaceSafeCsvText(row.evidenceTemplate),
    exact_video_or_post_url: workspaceSafeCsvText(row.exactVideoOrPostUrl),
    creator_or_rights_holder: workspaceSafeCsvText(row.creatorOrRightsHolder),
    rights_status_required: workspaceSafeCsvText(row.rightsStatusRequired),
    evidence_link_required: workspaceSafeCsvText(row.evidenceLinkRequired),
    next_action: workspaceSafeCsvText(row.nextAction),
  })));
}

function buildRealClipCloseoutWorkPacketMarkdown(status) {
  const packet = buildRealClipCloseoutWorkPacket(status);
  return [
    "# Clippers Real Clip Closeout Work Packet",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    "",
    `- Total rows: ${packet.totalRows}`,
    `- Ready rows: ${packet.readyRows}`,
    `- Blocked rows: ${packet.blockedRows}`,
    "",
    "## Rows",
    "",
    "| Order | Queue | Category | Source MP4 | Evidence template | Status | Blockers |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...packet.rows.map((row) => `| ${row.order} | ${row.queueItemId} | ${row.category} | ${row.targetSourceDropFile} | ${row.evidenceTemplate} | ${row.status} | ${row.blockers.join("; ") || "none"} |`),
    "",
    "## Next Action",
    "",
    packet.nextAction,
    "",
    "## Guardrails",
    "",
    ...packet.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function outreachSearchBrief(category) {
  if (category === "sports") {
    return "Find recent TikTok sports clips from creators who can grant permission; avoid broadcast/league footage unless official policy allows reuse.";
  }
  if (category === "memes") {
    return "Find recent TikTok meme clips from original creators; avoid repost pages, watermarked reposts, and unclear audio rights.";
  }
  if (category === "streamers") {
    return "Find streamer clips only where creator policy or written permission allows reuse; otherwise use recreate-only.";
  }
  return "Find recent TikTok clips from identifiable creators with permission path.";
}

function outreachMessageTemplate(row = {}) {
  const account = row.accountName || row.brand || "our TikTok page";
  return [
    "Hi <creator>, I run a TikTok clipping page and would like permission to feature this exact video with credit.",
    `Account: ${account}.`,
    "We will not post until you approve. If approved, please reply with written permission and any credit/usage requirements.",
    "If you prefer, we can skip the original and make a recreate-only version instead.",
  ].join(" ");
}

function buildRealClipPermissionOutreachPack(status) {
  const intake = buildRealClipIntakePack(status);
  const rows = intake.rows.map((row) => ({
    order: row.order,
    queueItemId: row.queueItemId,
    category: row.category,
    brand: row.brand,
    accountName: row.accountName,
    targetSourceDropFile: row.targetSourceDropFile,
    targetFileName: row.targetFileName,
    searchBrief: outreachSearchBrief(row.category),
    exactVideoOrPostUrl: "<paste exact https://www.tiktok.com/@creator/video/id URL>",
    creatorHandle: "<paste creator handle>",
    outreachChannel: "<tiktok_dm|email|creator_form|official_policy>",
    outreachStatus: "not_sent",
    permissionStatus: "not_requested",
    evidenceLink: "<paste permission/proof URL or local proof path after approval>",
    recreateFallback: "recreate_only_if_no_permission",
    messageTemplate: outreachMessageTemplate(row),
    nextAction: "Find an exact video/post URL, identify the rights holder, send permission request, and store proof before source-drop import.",
  }));
  const csvOut = renderCsv([
    "order",
    "metricool_queue_item_id",
    "category",
    "account_name",
    "target_source_drop_file",
    "search_brief",
    "exact_video_or_post_url",
    "creator_handle",
    "outreach_channel",
    "outreach_status",
    "permission_status",
    "evidence_link",
    "recreate_fallback",
    "message_template",
    "next_action",
  ], rows.map((row) => ({
    order: row.order,
    metricool_queue_item_id: row.queueItemId,
    category: row.category,
    account_name: row.accountName,
    target_source_drop_file: row.targetSourceDropFile,
    search_brief: row.searchBrief,
    exact_video_or_post_url: row.exactVideoOrPostUrl,
    creator_handle: row.creatorHandle,
    outreach_channel: row.outreachChannel,
    outreach_status: row.outreachStatus,
    permission_status: row.permissionStatus,
    evidence_link: row.evidenceLink,
    recreate_fallback: row.recreateFallback,
    message_template: row.messageTemplate,
    next_action: row.nextAction,
  })));
  return {
    status: rows.length ? "needs_permission_outreach" : "no_permission_outreach_needed",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_real_clip_permission_outreach",
    totalRows: rows.length,
    notSent: rows.filter((row) => row.outreachStatus === "not_sent").length,
    approved: 0,
    summary: rows.length
      ? `Prepare outreach for ${rows.length} real clip replacement row(s). This does not grant permission or mark any clip approved.`
      : "No permission outreach rows are needed for the current batch.",
    nextAction: rows.length
      ? "Use the CSV to track creator outreach. Only move a clip into source-drop as owned_or_permissioned after exact URL, source file, and proof are real."
      : "Continue Metricool approval workflow.",
    guardrails: [
      "Do not mark permission approved from this pack alone.",
      "Do not use public search/explore pages as exact clip URLs.",
      "Do not use broadcast sports footage, repost pages, streamer clips, or copyrighted audio without permission/policy proof.",
      "If permission is not available, choose recreate_only and generate owned source instead.",
    ],
    csv: csvOut,
    rows,
  };
}

function sourceHuntSearchTerms(category) {
  if (category === "sports") return ["sports clip today", "basketball highlight creator", "football reaction clip", "sports commentary clip"];
  if (category === "memes") return ["viral meme today", "funny original creator", "meme trend", "relatable comedy clip"];
  if (category === "streamers") return ["streamer clip permission", "creator clip policy", "stream highlight creator"];
  return ["viral creator clip", "original creator permission"];
}

function sourceHuntRejectRules(category) {
  const common = [
    "Reject search/explore/hashtag/channel pages; intake requires an exact TikTok post, Twitch clip, or YouTube video/Short URL.",
    "Reject repost pages, unclear creator/source, watermarked reuploads, and copied audio with unclear rights.",
    "Reject anything without a permission path, owned source, licensed source, official policy allowlist, or recreate-only plan.",
  ];
  if (category === "sports") {
    return [
      ...common,
      "Reject broadcast, league, TV, or paid sports footage unless the rights holder gives written permission or official reuse policy allows it.",
    ];
  }
  if (category === "memes") {
    return [
      ...common,
      "Prefer original meme creators and simple recreate-only formats where the idea can be remade with owned assets.",
    ];
  }
  return common;
}

function tiktokSearchUrl(term) {
  return `https://www.tiktok.com/search?q=${encodeURIComponent(term)}`;
}

function googleTikTokSearchUrl(term) {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:tiktok.com/@ ${term}`)}`;
}

function buildRealClipSourceHuntPack(status) {
  const validation = status.realClipIntakeValidation || { rows: [] };
  const rows = (validation.rows || []).map((row) => {
    const terms = sourceHuntSearchTerms(row.category);
    const primaryTerm = terms[0] || "viral creator clip";
    const exactUrlMissing = row.blockers?.includes("exact_source_video_or_post_url_missing") === true;
    const proofMissing = row.blockers?.some((blocker) => [
      "creator_or_source_missing",
      "rights_status_not_owned_or_permissioned",
      "evidence_link_missing",
    ].includes(blocker)) === true;
    const sourceFileMissing = row.blockers?.includes("missing_source_file") === true;
    return {
      order: row.order,
      queueItemId: row.queueItemId,
      category: row.category,
      brand: row.brand,
      accountName: row.accountName,
      targetSourceDropFile: row.targetSourceDropFile,
      targetFileName: row.targetFileName,
      status: row.status,
      blockers: row.blockers || [],
      searchTerms: terms,
      tiktokSearchUrl: tiktokSearchUrl(primaryTerm),
      googleTikTokSearchUrl: googleTikTokSearchUrl(primaryTerm),
      requiredExactUrl: "https://www.tiktok.com/@creator/video/0000000000000000000",
      sourceFileRequired: sourceFileMissing ? "yes" : "already_present",
      exactUrlRequired: exactUrlMissing ? "yes" : "already_present",
      permissionProofRequired: proofMissing ? "yes" : "already_present",
      evidenceTemplate: evidenceTemplateUrl(row.queueItemId),
      rejectRules: sourceHuntRejectRules(row.category),
      nextAction: row.status === "ready_for_source_drop_import"
        ? "Already ready for source-drop import review; do not schedule until batch is regenerated."
        : "Find an exact TikTok post, Twitch clip, or YouTube video URL from the original creator, secure proof, place the MP4 in source-drop, then record the batch intake row.",
    };
  });
  const csvRows = rows.map((row) => ({
    order: row.order,
    metricool_queue_item_id: row.queueItemId,
    category: row.category,
    account_name: row.accountName,
    target_source_drop_file: row.targetSourceDropFile,
    search_terms: row.searchTerms.join(" | "),
    tiktok_search_url: row.tiktokSearchUrl,
    google_tiktok_search_url: row.googleTikTokSearchUrl,
    exact_video_or_post_url: "<paste exact TikTok, Twitch clip, or YouTube video URL after finding source>",
    creator_or_rights_holder: "<paste creator or rights holder>",
    evidence_link: row.evidenceTemplate,
    source_file_required: row.sourceFileRequired,
    exact_url_required: row.exactUrlRequired,
    permission_proof_required: row.permissionProofRequired,
    reject_rules: row.rejectRules.join(" | "),
    next_action: row.nextAction,
  }));
  return {
    status: rows.some((row) => row.status !== "ready_for_source_drop_import") ? "needs_real_clip_source_hunt" : "ready_for_source_drop_import_review",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_real_clip_source_hunt",
    totalRows: rows.length,
    blockedRows: rows.filter((row) => row.status !== "ready_for_source_drop_import").length,
    readyRows: rows.filter((row) => row.status === "ready_for_source_drop_import").length,
    accounts: [...new Set(rows.map((row) => row.accountName).filter(Boolean))],
    categories: [...new Set(rows.map((row) => row.category).filter(Boolean))],
    rows,
    csv: renderCsv([
      "order",
      "metricool_queue_item_id",
      "category",
      "account_name",
      "target_source_drop_file",
      "search_terms",
      "tiktok_search_url",
      "google_tiktok_search_url",
      "exact_video_or_post_url",
      "creator_or_rights_holder",
      "evidence_link",
      "source_file_required",
      "exact_url_required",
      "permission_proof_required",
      "reject_rules",
      "next_action",
    ], csvRows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, workspaceSafeCsvText(value)])
    ))),
    nextAction: "Use this pack to find exact creator videos, then use Real Clip Intake Batch to record URL/source/proof. It does not approve or download anything by itself.",
    guardrails: [
      "This pack is a source-hunting worksheet, not proof.",
      "Do not use placeholders, search URLs, or repost pages as exact source.",
      "Do not schedule in Metricool until real clip intake validation passes and the batch is regenerated.",
      "Keep realPublishEnabled=false and Metricool approval_required.",
    ],
  };
}

function buildRealClipSourceHuntMarkdown(status) {
  const pack = buildRealClipSourceHuntPack(status);
  return [
    "# Clippers Real Clip Source Hunt Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Scope: ${pack.scope}`,
    `Status: ${pack.status}`,
    "",
    `- Rows: ${pack.totalRows}`,
    `- Ready rows: ${pack.readyRows}`,
    `- Blocked rows: ${pack.blockedRows}`,
    `- Categories: ${pack.categories.join(", ") || "none"}`,
    "",
    "## Rows",
    "",
    "| Order | Queue | Category | Account | TikTok search | Google search | Target file | Blockers |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...pack.rows.map((row) => `| ${row.order} | ${row.queueItemId} | ${row.category} | ${row.accountName} | ${row.tiktokSearchUrl} | ${row.googleTikTokSearchUrl} | ${row.targetSourceDropFile} | ${row.blockers.join("; ") || "none"} |`),
    "",
    "## Next Action",
    "",
    pack.nextAction,
    "",
    "## Guardrails",
    "",
    ...pack.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderRealClipSourceHuntPage(status) {
  const pack = buildRealClipSourceHuntPack(status);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Source Hunt</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1120px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff;word-break:break-word}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Clippers Source Hunt</h1>
  <p>Busca candidatos reales para SPORT y memes. Esta pantalla no aprueba derechos, no descarga y no publica.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(pack.status)}</div></div>
    <div class="card"><div class="label">Rows</div><div class="value">${escapeHtml(pack.totalRows)}</div></div>
    <div class="card"><div class="label">Ready</div><div class="value">${escapeHtml(pack.readyRows)}</div></div>
    <div class="card"><div class="label">Blocked</div><div class="value">${escapeHtml(pack.blockedRows)}</div></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-source-hunt.csv", "Source hunt CSV")}
    ${link("/api/clippers/real-clip-source-hunt.md", "Markdown")}
    ${link("/api/clippers/real-clip-intake-validation.html", "Intake validation")}
    ${link("/api/clippers/real-clip-intake-batch-template.csv", "Batch intake template")}
    ${link("/api/clippers/real-clip-permission-outreach.html", "Permission outreach")}
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(pack.nextAction)}</p>
  </div>
  <div class="card">
    <div class="label">Rows</div>
    <table>
      <thead><tr><th>Queue</th><th>Account</th><th>Target</th><th>Search</th><th>Reject</th><th>Next</th></tr></thead>
      <tbody>
        ${pack.rows.map((row) => `<tr>
          <td>${escapeHtml(row.queueItemId)}<div class="small">#${escapeHtml(row.order)}</div></td>
          <td>${escapeHtml(row.brand)}<div class="small">${escapeHtml(row.accountName)}</div></td>
          <td><code>${escapeHtml(row.targetSourceDropFile)}</code><div class="small">${escapeHtml(row.blockers.join(", ") || "none")}</div></td>
          <td>${link(row.tiktokSearchUrl, "TikTok search")}<div class="small">${link(row.googleTikTokSearchUrl, "Google TikTok search")}</div><div class="small">${escapeHtml(row.searchTerms.join(" | "))}</div></td>
          <td>${escapeHtml(row.rejectRules.join(" "))}</td>
          <td>${escapeHtml(row.nextAction)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Guardrails</div>
    ${pack.guardrails.map((guardrail) => `<p class="small">${escapeHtml(guardrail)}</p>`).join("")}
  </div>
</main>
</body>
</html>`;
}

function realClipAcquisitionStage(row = {}, crmRow = {}) {
  const blockers = new Set(row.blockers || []);
  const permissionStatus = String(crmRow.permissionStatus || "");
  if (row.status === "ready_for_source_drop_import") return "ready_for_source_drop_import";
  if (blockers.has("exact_source_video_or_post_url_missing")) return "needs_exact_video_url";
  if (blockers.has("creator_or_source_missing")) return "needs_creator_source";
  if (blockers.has("rights_status_not_owned_or_permissioned") || blockers.has("evidence_link_missing")) return "needs_rights_evidence";
  if ([...blockers].some((blocker) => String(blocker).startsWith("evidence_file_"))) return "needs_valid_evidence_file";
  if ([...blockers].some((blocker) => String(blocker).includes("operator_notes"))) return "needs_concrete_notes";
  if (permissionStatus === "requested" || permissionStatus === "contacted") return "waiting_permission_response";
  if (permissionStatus === "approved" || permissionStatus === "owned_source") {
    return blockers.has("missing_source_file") ? "needs_source_file" : "needs_intake_refresh";
  }
  if (blockers.has("missing_source_file")) return "needs_source_file";
  return "needs_review";
}

function realClipAcquisitionNextAction(stage) {
  return {
    ready_for_source_drop_import: "Run source-drop Metricool refresh review; do not schedule until the regenerated batch is produced.",
    needs_exact_video_url: "Use Source Hunt to find an exact TikTok post, Twitch clip, or YouTube video/Short URL; reject search/explore/hashtag/channel pages.",
    needs_creator_source: "Identify the original creator or rights holder before requesting permission.",
    waiting_permission_response: "Follow up with the creator; do not move to source-drop until permission proof is captured.",
    needs_rights_evidence: "Use Permission CRM to record outreach, create local evidence, or choose recreate_only with owned assets.",
    needs_valid_evidence_file: "Fix the local evidence file so it contains real non-secret proof, not a template or placeholder.",
    needs_concrete_notes: "Replace generic notes with concrete 20+ character operator notes for the exact source and permission.",
    needs_source_file: "Place the real approved MP4 in the target source-drop folder using the exact target filename.",
    needs_intake_refresh: "Record or refresh the real clip intake row after proof and source file are in place.",
    needs_review: "Review blockers in Real Clip Intake Validation and complete the missing fields.",
  }[stage] || "Review blockers in Real Clip Intake Validation and complete the missing fields.";
}

async function buildRealClipAcquisitionWorkbench(status) {
  const validation = status.realClipIntakeValidation || { rows: [] };
  const hunt = buildRealClipSourceHuntPack(status);
  const crm = await buildRealClipPermissionCrm(status);
  const huntByQueueId = new Map((hunt.rows || []).map((row) => [String(row.queueItemId || ""), row]));
  const crmByQueueId = new Map((crm.rows || []).map((row) => [String(row.queueItemId || ""), row]));
  const rows = (validation.rows || []).map((row) => {
    const queueItemId = String(row.queueItemId || "");
    const huntRow = huntByQueueId.get(queueItemId) || {};
    const crmRow = crmByQueueId.get(queueItemId) || {};
    const stage = realClipAcquisitionStage(row, crmRow);
    return {
      order: row.order,
      queueItemId,
      category: row.category,
      brand: row.brand,
      accountName: row.accountName,
      status: row.status,
      stage,
      blockers: row.blockers || [],
      targetSourceDropFile: row.targetSourceDropFile,
      targetFileName: row.targetFileName,
      manifestFile: row.manifestFile,
      evidenceTemplate: evidenceTemplateUrl(queueItemId),
      sourceHuntUrl: huntRow.tiktokSearchUrl || "",
      googleHuntUrl: huntRow.googleTikTokSearchUrl || "",
      searchTerms: huntRow.searchTerms || [],
      crmOutreachStatus: crmRow.outreachStatus || "not_recorded",
      crmPermissionStatus: crmRow.permissionStatus || "not_recorded",
      exactVideoOrPostUrl: crmRow.exactVideoOrPostUrl || "",
      creatorOrRightsHolder: crmRow.creatorOrRightsHolder || "",
      evidenceLink: crmRow.evidenceLink || evidenceTemplateUrl(queueItemId),
      nextAction: realClipAcquisitionNextAction(stage),
      recordBatchTemplate: renderCsv([
        "metricool_queue_item_id",
        "exact_video_or_post_url",
        "creator_or_rights_holder",
        "evidence_link",
        "operator_notes",
      ], [{
        metricool_queue_item_id: queueItemId,
        exact_video_or_post_url: crmRow.exactVideoOrPostUrl || "<exact TikTok, Twitch clip, or YouTube video URL>",
        creator_or_rights_holder: crmRow.creatorOrRightsHolder || "<creator or rights holder>",
        evidence_link: crmRow.evidenceLink || evidenceTemplateUrl(queueItemId),
        operator_notes: "Concrete 20+ char note describing permission/source and why this row is safe.",
      }]).trimEnd().split(/\r?\n/)[1] || "",
      rejectRules: huntRow.rejectRules || [],
    };
  });
  const stageCounts = rows.reduce((counts, row) => {
    counts[row.stage] = (counts[row.stage] || 0) + 1;
    return counts;
  }, {});
  const readyRows = rows.filter((row) => row.stage === "ready_for_source_drop_import").length;
  const blockedRows = rows.length - readyRows;
  return {
    status: blockedRows ? "needs_real_clip_acquisition" : "ready_for_source_drop_import_review",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_real_clip_acquisition_workbench",
    totalRows: rows.length,
    readyRows,
    blockedRows,
    stageCounts,
    summary: blockedRows
      ? `${blockedRows}/${rows.length} rows still need exact source, rights evidence, or source files before Metricool.`
      : "All rows are ready for source-drop import review; Metricool remains approval_required.",
    nextAction: rows.find((row) => row.stage !== "ready_for_source_drop_import")?.nextAction || "Run source-drop Metricool refresh review.",
    rows,
    links: {
      sourceHunt: `${localOrigin()}/api/clippers/real-clip-source-hunt.html`,
      permissionCrm: `${localOrigin()}/api/clippers/real-clip-permission-crm.html`,
      realClipIntake: `${localOrigin()}/api/clippers/real-clip-intake.html`,
      closeoutPacket: `${localOrigin()}/api/clippers/real-clip-closeout-work-packet.md`,
      goLiveResolver: `${localOrigin()}/api/clippers/go-live-gap-resolver.html`,
    },
    guardrails: [
      "This workbench does not create permissions or mark clips approved.",
      "Exact URL must be a real TikTok video URL, not search/explore/hashtag.",
      "Approved rows still need a real local MP4 and local/non-secret evidence before source-drop refresh.",
      "Metricool stays approval_required and realPublishEnabled=false.",
    ],
  };
}

function buildRealClipAcquisitionWorkbenchCsv(workbench) {
  return renderCsv([
    "order",
    "metricool_queue_item_id",
    "category",
    "account_name",
    "stage",
    "status",
    "blockers",
    "target_source_drop_file",
    "evidence_template",
    "source_hunt_url",
    "crm_outreach_status",
    "crm_permission_status",
    "exact_video_or_post_url",
    "creator_or_rights_holder",
    "next_action",
    "record_batch_template",
  ], (workbench.rows || []).map((row) => ({
    order: workspaceSafeCsvText(row.order),
    metricool_queue_item_id: workspaceSafeCsvText(row.queueItemId),
    category: workspaceSafeCsvText(row.category),
    account_name: workspaceSafeCsvText(row.accountName),
    stage: workspaceSafeCsvText(row.stage),
    status: workspaceSafeCsvText(row.status),
    blockers: workspaceSafeCsvText(row.blockers.join(";")),
    target_source_drop_file: workspaceSafeCsvText(row.targetSourceDropFile),
    evidence_template: workspaceSafeCsvText(row.evidenceTemplate),
    source_hunt_url: workspaceSafeCsvText(row.sourceHuntUrl),
    crm_outreach_status: workspaceSafeCsvText(row.crmOutreachStatus),
    crm_permission_status: workspaceSafeCsvText(row.crmPermissionStatus),
    exact_video_or_post_url: workspaceSafeCsvText(row.exactVideoOrPostUrl),
    creator_or_rights_holder: workspaceSafeCsvText(row.creatorOrRightsHolder),
    next_action: workspaceSafeCsvText(row.nextAction),
    record_batch_template: workspaceSafeCsvText(row.recordBatchTemplate),
  })));
}

function buildRealClipAcquisitionWorkbenchMarkdown(workbench) {
  return [
    "# Clippers Real Clip Acquisition Workbench",
    "",
    `Generated: ${workbench.generatedAt}`,
    `Status: ${workbench.status}`,
    "",
    `- Total rows: ${workbench.totalRows}`,
    `- Ready rows: ${workbench.readyRows}`,
    `- Blocked rows: ${workbench.blockedRows}`,
    "",
    "## Summary",
    "",
    workbench.summary,
    "",
    "## Next Action",
    "",
    workbench.nextAction,
    "",
    "## Rows",
    "",
    "| Order | Queue | Category | Stage | CRM | Target file | Next action |",
    "| ---: | --- | --- | --- | --- | --- | --- |",
    ...(workbench.rows || []).map((row) => `| ${[
      row.order,
      row.queueItemId,
      row.category,
      row.stage,
      `${row.crmOutreachStatus}/${row.crmPermissionStatus}`,
      row.targetSourceDropFile,
      row.nextAction,
    ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
    "",
    "## Guardrails",
    "",
    ...workbench.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderRealClipAcquisitionWorkbenchPage(workbench) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Real Clip Acquisition</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1180px;margin:0 auto;padding:28px 18px 48px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:18px 0}
    .card,.row{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .value{font-size:24px;font-weight:800;color:#fff}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
    .actions a{border:1px solid #365063;background:#172433;border-radius:8px;padding:10px 12px;text-decoration:none;color:#eaf7ff}
    .row{margin:12px 0}
    .row-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px}
    .meta div{border-top:1px solid #293644;padding-top:8px}
    .small,small{font-size:12px;color:#9fb0c4}
    code,pre{background:#111820;border:1px solid #263340;border-radius:6px;color:#d9f0ff}
    code{padding:2px 5px}
    pre{white-space:pre-wrap;word-break:break-word;padding:10px}
  </style>
</head>
<body>
<main>
  <h1>Real Clip Acquisition</h1>
  <p>${escapeHtml(workbench.summary)}</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(workbench.status)}</div></div>
    <div class="card"><div class="label">Ready</div><div class="value">${escapeHtml(workbench.readyRows)}/${escapeHtml(workbench.totalRows)}</div></div>
    <div class="card"><div class="label">Blocked</div><div class="value">${escapeHtml(workbench.blockedRows)}</div></div>
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(workbench.nextAction)}</p>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-acquisition-workbench.json", "JSON")}
    ${link("/api/clippers/real-clip-acquisition-workbench.md", "Markdown")}
    ${link("/api/clippers/real-clip-acquisition-workbench.csv", "CSV")}
    ${link("/api/clippers/real-clip-source-hunt.html", "Source Hunt")}
    ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}
    ${link("/api/clippers/real-clip-intake.html", "Real Clip Intake")}
    ${link("/api/clippers/go-live-gap-resolver.html", "Go-live Resolver")}
  </div>
  ${(workbench.rows || []).map((row) => `<section class="row" id="${escapeHtml(row.queueItemId)}">
    <div class="row-head">
      <div>
        <div class="label">${escapeHtml(row.category)} · ${escapeHtml(row.accountName)}</div>
        <h2>${escapeHtml(row.stage)}</h2>
      </div>
      <code>${escapeHtml(row.queueItemId)}</code>
    </div>
    <p>${escapeHtml(row.nextAction)}</p>
    <div class="meta">
      <div><span class="small">Target MP4</span><br /><strong>${escapeHtml(row.targetSourceDropFile)}</strong></div>
      <div><span class="small">CRM</span><br /><strong>${escapeHtml(row.crmOutreachStatus)} / ${escapeHtml(row.crmPermissionStatus)}</strong></div>
      <div><span class="small">Evidence</span><br /><strong>${escapeHtml(row.evidenceLink)}</strong></div>
      <div><span class="small">Blockers</span><br /><strong>${escapeHtml(row.blockers.join(", ") || "none")}</strong></div>
    </div>
    <div class="actions">
      ${row.sourceHuntUrl ? link(row.sourceHuntUrl, "TikTok search") : ""}
      ${row.googleHuntUrl ? link(row.googleHuntUrl, "Google/TikTok search") : ""}
      ${link("/api/clippers/real-clip-permission-crm.html", "Record CRM")}
      ${link("/api/clippers/real-clip-intake.html", "Record intake")}
    </div>
    <details>
      <summary>Batch intake starter row</summary>
      <pre>${escapeHtml(row.recordBatchTemplate)}</pre>
    </details>
  </section>`).join("")}
</main>
</body>
</html>`;
}

const realClipPermissionCrmHeader = [
  "metricool_queue_item_id",
  "category",
  "account_name",
  "exact_video_or_post_url",
  "creator_or_rights_holder",
  "outreach_channel",
  "outreach_status",
  "permission_status",
  "evidence_link",
  "operator_notes",
  "updated_at",
];
const allowedOutreachChannels = new Set(["tiktok_dm", "email", "creator_form", "official_policy", "owned_source", "recreate_plan", "other"]);
const allowedOutreachStatuses = new Set(["not_sent", "sent", "responded", "no_response", "blocked", "not_needed"]);
const allowedPermissionStatuses = new Set(["not_requested", "requested", "approved", "denied", "recreate_only", "owned_source"]);
const allowedLocalEvidencePermissionTypes = new Set(["creator_permission", "licensed_asset", "owned_source", "official_policy_allowlist", "recreate_plan_approved"]);

async function readRealClipPermissionCrmRows() {
  const raw = await readText(realClipPermissionCrmCsvPath, "");
  return raw.trim() ? parseCsv(raw).rows : [];
}

async function readRealClipPermissionCrmRowsForMutation() {
  const result = await readTextForMutation(realClipPermissionCrmCsvPath, { allowMissing: true });
  if (!result.ok) return { ok: false, rows: [] };
  return { ok: true, rows: result.value.trim() ? parseCsv(result.value).rows : [] };
}

function latestPermissionCrmByQueueId(rows = []) {
  const byQueueId = new Map();
  for (const row of rows) {
    const queueId = String(row.metricool_queue_item_id || "").trim();
    if (!queueId) continue;
    const previous = byQueueId.get(queueId);
    if (!previous || String(row.updated_at || "") >= String(previous.updated_at || "")) {
      byQueueId.set(queueId, row);
    }
  }
  return byQueueId;
}

async function validateRealClipPermissionCrmInput(status, input = {}) {
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const exactVideoOrPostUrl = String(input.exactVideoOrPostUrl || "").trim();
  const creatorOrRightsHolder = String(input.creatorOrRightsHolder || "").trim();
  const outreachChannel = String(input.outreachChannel || "tiktok_dm").trim();
  const outreachStatus = String(input.outreachStatus || "sent").trim();
  const permissionStatus = String(input.permissionStatus || "requested").trim();
  const evidenceLink = String(input.evidenceLink || "").trim();
  const operatorNotes = String(input.operatorNotes || "").trim();
  if (!/^[a-z0-9_-]{6,80}$/i.test(metricoolQueueItemId)) {
    return { ok: false, statusCode: 400, error: "invalid_metricool_queue_item_id", metricoolQueueItemId };
  }
  const intakeRow = buildRealClipIntakePack(status).rows.find((row) => row.queueItemId === metricoolQueueItemId);
  if (!intakeRow) {
    return { ok: false, statusCode: 404, error: "real_clip_intake_row_not_found", metricoolQueueItemId };
  }
  if (!allowedOutreachChannels.has(outreachChannel)) {
    return { ok: false, statusCode: 400, error: "invalid_outreach_channel", metricoolQueueItemId };
  }
  if (!allowedOutreachStatuses.has(outreachStatus)) {
    return { ok: false, statusCode: 400, error: "invalid_outreach_status", metricoolQueueItemId };
  }
  if (!allowedPermissionStatuses.has(permissionStatus)) {
    return { ok: false, statusCode: 400, error: "invalid_permission_status", metricoolQueueItemId };
  }
  if (exactVideoOrPostUrl && !isExactSourceVideoOrPostUrl(exactVideoOrPostUrl)) {
    return { ok: false, statusCode: 400, error: "exact_source_video_or_post_url_required_when_present", metricoolQueueItemId };
  }
  const needsIdentifiedCreator = !["not_requested"].includes(permissionStatus) || outreachStatus !== "not_sent";
  if (needsIdentifiedCreator && (hasStarterPlaceholder(creatorOrRightsHolder) || secretTextPattern.test(creatorOrRightsHolder) || secretQueryParamPattern.test(creatorOrRightsHolder))) {
    return { ok: false, statusCode: 400, error: "creator_or_rights_holder_required", metricoolQueueItemId };
  }
  const noteError = validateOperatorNotes(operatorNotes);
  if (noteError) return { ok: false, statusCode: 400, error: noteError, metricoolQueueItemId };
  if (secretTextPattern.test(operatorNotes) || secretQueryParamPattern.test(operatorNotes)) {
    return { ok: false, statusCode: 400, error: "operator_notes_secret_like", metricoolQueueItemId };
  }
  if (evidenceLink && !isAllowedRealClipEvidenceLink(evidenceLink)) {
    return { ok: false, statusCode: 400, error: "invalid_evidence_link", metricoolQueueItemId };
  }
  if (permissionStatus === "approved" || permissionStatus === "owned_source") {
    if (!exactVideoOrPostUrl) return { ok: false, statusCode: 400, error: "approved_permission_requires_exact_video_url", metricoolQueueItemId };
    if (!evidenceLink) return { ok: false, statusCode: 400, error: "approved_permission_requires_evidence_link", metricoolQueueItemId };
    if (/^https:\/\/[^\s]+$/i.test(evidenceLink)) {
      return { ok: false, statusCode: 400, error: "approved_permission_requires_local_evidence_file", metricoolQueueItemId };
    }
    const evidenceStatus = await realClipEvidenceStatus(evidenceLink);
    if (!evidenceStatus.ok) {
      return { ok: false, statusCode: 400, error: evidenceStatus.status, metricoolQueueItemId };
    }
  }
  if (permissionStatus === "recreate_only" && !evidenceLink) {
    return { ok: false, statusCode: 400, error: "recreate_only_requires_plan_evidence_link", metricoolQueueItemId };
  }
  return {
    ok: true,
    metricoolQueueItemId,
    intakeRow,
    exactVideoOrPostUrl,
    creatorOrRightsHolder,
    outreachChannel,
    outreachStatus,
    permissionStatus,
    evidenceLink,
    operatorNotes,
  };
}

async function recordRealClipExactSourceCandidate(input = {}, { skipLock = false } = {}) {
  if (!skipLock) {
    return withPermissionCrmLock(() => recordRealClipExactSourceCandidate(input, { skipLock: true }));
  }
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const exactVideoOrPostUrl = String(input.exactVideoOrPostUrl || "").trim();
  const creatorOrRightsHolder = String(input.creatorOrRightsHolder || "").trim();
  if (!isExactSourceVideoOrPostUrl(exactVideoOrPostUrl)) {
    return { ok: false, statusCode: 400, error: "exact_source_video_or_post_url_required", metricoolQueueItemId };
  }
  if (hasStarterPlaceholder(creatorOrRightsHolder) || secretTextPattern.test(creatorOrRightsHolder) || secretQueryParamPattern.test(creatorOrRightsHolder)) {
    return { ok: false, statusCode: 400, error: "creator_or_rights_holder_required", metricoolQueueItemId };
  }
  const crmRead = await readRealClipPermissionCrmRowsForMutation();
  if (!crmRead.ok) return { ok: false, statusCode: 503, error: "permission_crm_read_unavailable", metricoolQueueItemId };
  const existingRows = crmRead.rows;
  const existingRow = existingRows.find((candidate) => String(candidate.metricool_queue_item_id || "").trim() === metricoolQueueItemId);
  if (isProtectedPermissionCrmRow(existingRow)) {
    return { ok: false, statusCode: 409, error: "exact_source_candidate_would_overwrite_permission_crm_state", metricoolQueueItemId };
  }
  const result = await recordRealClipPermissionCrm({
    metricoolQueueItemId,
    exactVideoOrPostUrl,
    creatorOrRightsHolder,
    outreachChannel: "tiktok_dm",
    outreachStatus: "not_sent",
    permissionStatus: "not_requested",
    evidenceLink: "",
    operatorNotes: `Exact source candidate recorded for ${creatorOrRightsHolder}; permission not requested or approved yet.`,
  }, { skipLock: true });
  if (!result.ok) return result;
  return {
    ...result,
    status: "exact_source_candidate_recorded",
    unlocksSourceDrop: false,
    unlocksMetricool: false,
    nextAction: "Use Permission Request Packets to send outreach, then record real permission evidence before source-drop import.",
  };
}

async function recordRealClipExactSourceCandidateBatch(rawCsv, { skipLock = false } = {}) {
  if (!skipLock) {
    return withPermissionCrmLock(() => recordRealClipExactSourceCandidateBatch(rawCsv, { skipLock: true }));
  }
  if (!String(rawCsv || "").trim()) {
    return { ok: false, statusCode: 400, error: "exact_source_candidate_batch_csv_required", rows: 0 };
  }
  let parsed;
  try {
    parsed = parseCsv(String(rawCsv || ""));
  } catch {
    return { ok: false, statusCode: 400, error: "exact_source_candidate_batch_csv_invalid", rows: 0 };
  }
  const normalizedRows = (parsed.rows || []).map((row) => ({
    metricoolQueueItemId: row.metricool_queue_item_id || row.metricoolQueueItemId || row.queue_item_id || row.queueItemId || "",
    exactVideoOrPostUrl: row.exact_video_or_post_url || row.exactVideoOrPostUrl || row.url || "",
    creatorOrRightsHolder: row.creator_or_rights_holder || row.creatorOrRightsHolder || row.creator || row.source || "",
  }));
  if (!normalizedRows.length) {
    return { ok: false, statusCode: 400, error: "exact_source_candidate_batch_empty", rows: 0 };
  }
  const seenQueueIds = new Set();
  for (const row of normalizedRows) {
    const queueId = String(row.metricoolQueueItemId || "").trim();
    if (seenQueueIds.has(queueId)) {
      return { ok: false, statusCode: 400, error: "duplicate_metricool_queue_item_id", metricoolQueueItemId: queueId, rows: normalizedRows.length };
    }
    seenQueueIds.add(queueId);
    if (!isExactSourceVideoOrPostUrl(row.exactVideoOrPostUrl)) {
      return { ok: false, statusCode: 400, error: "exact_source_video_or_post_url_required", metricoolQueueItemId: queueId, rows: normalizedRows.length };
    }
    const creator = String(row.creatorOrRightsHolder || "").trim();
    if (hasStarterPlaceholder(creator) || secretTextPattern.test(creator) || secretQueryParamPattern.test(creator)) {
      return { ok: false, statusCode: 400, error: "creator_or_rights_holder_required", metricoolQueueItemId: queueId, rows: normalizedRows.length };
    }
  }
  const crmRead = await readRealClipPermissionCrmRowsForMutation();
  if (!crmRead.ok) return { ok: false, statusCode: 503, error: "permission_crm_read_unavailable", rows: normalizedRows.length, accepted: 0 };
  const existingRows = crmRead.rows;
  for (const row of normalizedRows) {
    const queueId = String(row.metricoolQueueItemId || "").trim();
    const existingRow = existingRows.find((candidate) => String(candidate.metricool_queue_item_id || "").trim() === queueId);
    if (isProtectedPermissionCrmRow(existingRow)) {
      return { ok: false, statusCode: 409, error: "exact_source_candidate_would_overwrite_permission_crm_state", metricoolQueueItemId: queueId, rows: normalizedRows.length };
    }
  }
  const crmCsv = renderCsv([
    "metricool_queue_item_id",
    "exact_video_or_post_url",
    "creator_or_rights_holder",
    "outreach_channel",
    "outreach_status",
    "permission_status",
    "evidence_link",
    "operator_notes",
  ], normalizedRows.map((row) => ({
    metricool_queue_item_id: row.metricoolQueueItemId,
    exact_video_or_post_url: row.exactVideoOrPostUrl,
    creator_or_rights_holder: row.creatorOrRightsHolder,
    outreach_channel: "tiktok_dm",
    outreach_status: "not_sent",
    permission_status: "not_requested",
    evidence_link: "",
    operator_notes: `Exact source candidate recorded for ${row.creatorOrRightsHolder}; permission not requested or approved yet.`,
  })));
  const result = await recordRealClipPermissionCrmBatch(crmCsv, { skipLock: true });
  if (!result.ok) return result;
  return {
    ...result,
    status: "exact_source_candidate_batch_recorded",
    rows: normalizedRows.length,
    unlocksSourceDrop: false,
    unlocksMetricool: false,
    nextAction: "Use Permission Request Packets to send outreach, then record real permission evidence before source-drop import.",
  };
}

function realClipExactSourceCandidateBatchTemplateCsv(status) {
  const pack = buildRealClipIntakePack(status);
  return renderCsv([
    "metricool_queue_item_id",
    "exact_video_or_post_url",
    "creator_or_rights_holder",
  ], (pack.rows || []).map((row) => ({
    metricool_queue_item_id: workspaceSafeCsvText(row.queueItemId),
    exact_video_or_post_url: "<paste exact https://www.tiktok.com/@creator/video/id URL>",
    creator_or_rights_holder: "<paste creator or rights holder>",
  })));
}

function isProtectedPermissionCrmRow(row) {
  if (!row) return false;
  const permissionStatus = String(row.permission_status || "").trim().toLowerCase();
  const outreachStatus = String(row.outreach_status || "").trim().toLowerCase();
  const evidenceLink = String(row.evidence_link || "").trim();
  return Boolean(evidenceLink)
    || (permissionStatus && permissionStatus !== "not_requested")
    || (outreachStatus && outreachStatus !== "not_sent");
}

function normalizeRealClipPermissionCrmBatchRow(row = {}) {
  return {
    metricoolQueueItemId: row.metricool_queue_item_id || row.metricoolQueueItemId || row.queue_item_id || row.queueItemId || "",
    exactVideoOrPostUrl: row.exact_video_or_post_url || row.exactVideoOrPostUrl || row.url || "",
    creatorOrRightsHolder: row.creator_or_rights_holder || row.creatorOrRightsHolder || row.source || row.creator || "",
    outreachChannel: row.outreach_channel || row.outreachChannel || "tiktok_dm",
    outreachStatus: row.outreach_status || row.outreachStatus || "sent",
    permissionStatus: row.permission_status || row.permissionStatus || "requested",
    evidenceLink: row.evidence_link || row.evidenceLink || row.proof_url || row.proof || "",
    operatorNotes: row.operator_notes || row.operatorNotes || row.notes || "",
  };
}

function buildRealClipPermissionCrmRow(validated) {
  return {
    metricool_queue_item_id: safeCsvText(validated.metricoolQueueItemId),
    category: safeCsvText(validated.intakeRow.category),
    account_name: safeCsvText(validated.intakeRow.accountName),
    exact_video_or_post_url: safeCsvText(validated.exactVideoOrPostUrl),
    creator_or_rights_holder: safeCsvText(validated.creatorOrRightsHolder),
    outreach_channel: safeCsvText(validated.outreachChannel),
    outreach_status: safeCsvText(validated.outreachStatus),
    permission_status: safeCsvText(validated.permissionStatus),
    evidence_link: safeCsvText(validated.evidenceLink),
    operator_notes: safeCsvText(validated.operatorNotes),
    updated_at: new Date().toISOString(),
  };
}

async function recordRealClipPermissionCrm(input = {}, { skipLock = false } = {}) {
  if (!skipLock) {
    return withPermissionCrmLock(() => recordRealClipPermissionCrm(input, { skipLock: true }));
  }
  const status = await buildStatus();
  const validated = await validateRealClipPermissionCrmInput(status, input);
  if (!validated.ok) return validated;
  const evidenceDir = await ensureContainedEvidenceDir();
  if (!evidenceDir.ok) return { ok: false, statusCode: 409, error: evidenceDir.status };
  const crmRead = await readRealClipPermissionCrmRowsForMutation();
  if (!crmRead.ok) return { ok: false, statusCode: 503, error: "permission_crm_read_unavailable" };
  const existingRows = crmRead.rows;
  const row = buildRealClipPermissionCrmRow(validated);
  const existingIndex = existingRows.findIndex((candidate) => String(candidate.metricool_queue_item_id || "") === validated.metricoolQueueItemId);
  if (existingIndex >= 0) existingRows[existingIndex] = { ...existingRows[existingIndex], ...row };
  else existingRows.push(row);
  await atomicWriteFile(realClipPermissionCrmCsvPath, renderCsv(realClipPermissionCrmHeader, existingRows));
  return {
    ok: true,
    statusCode: 200,
    status: "real_clip_permission_crm_recorded",
    metricoolQueueItemId: validated.metricoolQueueItemId,
    permissionStatus: validated.permissionStatus,
    crmUrl: workspaceUrlForFilePath(realClipPermissionCrmCsvPath),
    unlocksSourceDrop: false,
    unlocksMetricool: false,
    nextAction: "CRM updated. To unlock source-drop, still record Real Clip Intake with exact URL, proof, notes, and a local MP4.",
  };
}

async function recordRealClipPermissionCrmBatch(rawCsv, { skipLock = false } = {}) {
  if (!skipLock) {
    return withPermissionCrmLock(() => recordRealClipPermissionCrmBatch(rawCsv, { skipLock: true }));
  }
  const status = await buildStatus();
  const parsed = parseCsv(String(rawCsv || ""));
  if (!parsed.header.length || !parsed.rows.length) {
    return { ok: false, statusCode: 400, error: "real_clip_permission_crm_batch_csv_required", rows: 0 };
  }
  const seenQueueIds = new Set();
  const validatedRows = [];
  const errors = [];
  for (const [index, row] of parsed.rows.entries()) {
    const input = normalizeRealClipPermissionCrmBatchRow(row);
    const queueId = String(input.metricoolQueueItemId || "").trim();
    if (queueId && seenQueueIds.has(queueId)) {
      errors.push({
        line: index + 2,
        metricoolQueueItemId: queueId,
        error: "duplicate_metricool_queue_item_id",
      });
      continue;
    }
    if (queueId) seenQueueIds.add(queueId);
    const validated = await validateRealClipPermissionCrmInput(status, input);
    if (!validated.ok) {
      errors.push({
        line: index + 2,
        metricoolQueueItemId: queueId,
        error: validated.error,
      });
      continue;
    }
    validatedRows.push({ line: index + 2, validated });
  }
  if (errors.length) {
    return {
      ok: false,
      statusCode: 400,
      error: "real_clip_permission_crm_batch_invalid",
      rows: parsed.rows.length,
      accepted: 0,
      errors,
    };
  }
  const evidenceDir = await ensureContainedEvidenceDir();
  if (!evidenceDir.ok) return { ok: false, statusCode: 409, error: evidenceDir.status, accepted: 0 };
  const crmRead = await readRealClipPermissionCrmRowsForMutation();
  if (!crmRead.ok) return { ok: false, statusCode: 503, error: "permission_crm_read_unavailable", accepted: 0 };
  const existingRows = crmRead.rows;
  for (const { validated } of validatedRows) {
    const crmRow = buildRealClipPermissionCrmRow(validated);
    const existingIndex = existingRows.findIndex((candidate) => String(candidate.metricool_queue_item_id || "") === validated.metricoolQueueItemId);
    if (existingIndex >= 0) existingRows[existingIndex] = { ...existingRows[existingIndex], ...crmRow };
    else existingRows.push(crmRow);
  }
  await atomicWriteFile(realClipPermissionCrmCsvPath, renderCsv(realClipPermissionCrmHeader, existingRows));
  return {
    ok: true,
    statusCode: 200,
    status: "real_clip_permission_crm_batch_recorded",
    rows: parsed.rows.length,
    accepted: validatedRows.length,
    crmUrl: workspaceUrlForFilePath(realClipPermissionCrmCsvPath),
    rowResults: validatedRows.map(({ line, validated }) => ({
      line,
      metricoolQueueItemId: validated.metricoolQueueItemId,
      permissionStatus: validated.permissionStatus,
      outreachStatus: validated.outreachStatus,
      unlocksSourceDrop: false,
      unlocksMetricool: false,
    })),
    nextAction: "CRM batch recorded. Final Real Clip Intake and local MP4s are still required before Metricool.",
  };
}

function validateConcreteEvidenceText(value, fieldName) {
  const textValue = String(value || "").trim();
  if (textValue.length < 80) return `${fieldName}_min_80_chars`;
  if (hasStarterPlaceholder(textValue) || proofPlaceholderPattern.test(textValue)) return `${fieldName}_placeholder`;
  if (secretTextPattern.test(textValue) || secretQueryParamPattern.test(textValue)) return `${fieldName}_secret_like`;
  return "";
}

async function createRealClipPermissionEvidenceFile(input = {}) {
  const status = await buildStatus();
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const exactVideoOrPostUrl = String(input.exactVideoOrPostUrl || "").trim();
  const creatorOrRightsHolder = String(input.creatorOrRightsHolder || "").trim();
  const permissionType = String(input.permissionType || "").trim();
  const proofSummary = String(input.proofSummary || "").trim();
  const creditRequirements = String(input.creditRequirements || "Credit creator in caption when required.").trim();
  if (!/^[a-z0-9_-]{6,80}$/i.test(metricoolQueueItemId)) {
    return { ok: false, statusCode: 400, error: "invalid_metricool_queue_item_id", metricoolQueueItemId };
  }
  const intakeRow = buildRealClipIntakePack(status).rows.find((row) => row.queueItemId === metricoolQueueItemId);
  if (!intakeRow) {
    return { ok: false, statusCode: 404, error: "real_clip_intake_row_not_found", metricoolQueueItemId };
  }
  if (!isExactSourceVideoOrPostUrl(exactVideoOrPostUrl)) {
    return { ok: false, statusCode: 400, error: "exact_source_video_or_post_url_required", metricoolQueueItemId };
  }
  if (hasStarterPlaceholder(creatorOrRightsHolder) || secretTextPattern.test(creatorOrRightsHolder) || secretQueryParamPattern.test(creatorOrRightsHolder)) {
    return { ok: false, statusCode: 400, error: "creator_or_rights_holder_required", metricoolQueueItemId };
  }
  if (!allowedLocalEvidencePermissionTypes.has(permissionType)) {
    return { ok: false, statusCode: 400, error: "invalid_permission_type", metricoolQueueItemId };
  }
  const proofError = validateConcreteEvidenceText(proofSummary, "proof_summary");
  if (proofError) return { ok: false, statusCode: 400, error: proofError, metricoolQueueItemId };
  const creditError = validateConcreteEvidenceText(creditRequirements, "credit_requirements");
  if (creditError) return { ok: false, statusCode: 400, error: creditError, metricoolQueueItemId };
  const evidenceDirResult = await ensureContainedEvidenceDir("real-clip-permissions");
  if (!evidenceDirResult.ok) return { ok: false, statusCode: 409, error: evidenceDirResult.status, metricoolQueueItemId };
  const evidencePath = path.join(evidenceDirResult.dirPath, evidenceTemplateFileName(metricoolQueueItemId));
  const linkStat = await lstat(evidencePath).catch(() => null);
  if (linkStat?.isSymbolicLink()) {
    return { ok: false, statusCode: 409, error: "evidence_file_symlink_blocked", metricoolQueueItemId };
  }
  const body = [
    `Real clip permission evidence for queue ${metricoolQueueItemId}`,
    `Category: ${intakeRow.category}`,
    `Account: ${intakeRow.accountName}`,
    `Exact source URL: ${exactVideoOrPostUrl}`,
    `Creator or rights holder: ${creatorOrRightsHolder}`,
    `Permission type: ${permissionType}`,
    `Captured at: ${new Date().toISOString()}`,
    `Target source file: ${intakeRow.targetSourceDropFile}`,
    "",
    "Proof summary:",
    proofSummary,
    "",
    "Credit and usage requirements:",
    creditRequirements,
    "",
    "Operator statement: this file contains only non-secret proof notes and must still be paired with the real local MP4 before Metricool scheduling.",
    "",
  ].join("\n");
  if (secretTextPattern.test(body) || secretQueryParamPattern.test(body)) {
    return { ok: false, statusCode: 400, error: "evidence_body_secret_like", metricoolQueueItemId };
  }
  await atomicWriteFile(evidencePath, body);
  const evidenceLink = workspaceUrlForFilePath(evidencePath);
  const evidenceStatus = await realClipEvidenceStatus(evidenceLink);
  return {
    ok: evidenceStatus.ok,
    statusCode: evidenceStatus.ok ? 200 : 400,
    status: evidenceStatus.ok ? "real_clip_permission_evidence_file_ready" : evidenceStatus.status,
    metricoolQueueItemId,
    evidenceLink,
    permissionType,
    unlocksSourceDrop: false,
    unlocksMetricool: false,
    nextAction: evidenceStatus.ok
      ? "Evidence file is locally valid. Record CRM approved only if permission is real, then complete Real Clip Intake with the MP4."
      : "Evidence file was written but did not pass validation; fix the local evidence text before using it.",
  };
}

function realClipPermissionCrmBatchTemplateCsv(status) {
  const validationRows = status.realClipIntakeValidation?.rows || [];
  return renderCsv([
    "metricool_queue_item_id",
    "exact_video_or_post_url",
    "creator_or_rights_holder",
    "outreach_channel",
    "outreach_status",
    "permission_status",
    "evidence_link",
    "operator_notes",
  ], validationRows.map((row) => ({
    metricool_queue_item_id: safeCsvText(row.queueItemId),
    exact_video_or_post_url: safeCsvText("<paste exact TikTok, Twitch clip, or YouTube video URL after finding source>"),
    creator_or_rights_holder: safeCsvText("<paste creator or rights holder>"),
    outreach_channel: safeCsvText("tiktok_dm"),
    outreach_status: safeCsvText("sent"),
    permission_status: safeCsvText("requested"),
    evidence_link: safeCsvText(""),
    operator_notes: safeCsvText("Replace with 20+ chars describing the outreach attempt without secrets."),
  })));
}

async function buildRealClipPermissionCrm(status) {
  const rows = await readRealClipPermissionCrmRows();
  const latest = latestPermissionCrmByQueueId(rows);
  const validationRows = status.realClipIntakeValidation?.rows || [];
  const mergedRows = validationRows.map((row) => {
    const crm = latest.get(row.queueItemId) || {};
    return {
      queueItemId: row.queueItemId,
      category: row.category,
      accountName: row.accountName,
      targetSourceDropFile: row.targetSourceDropFile,
      intakeStatus: row.status,
      intakeBlockers: row.blockers || [],
      exactVideoOrPostUrl: crm.exact_video_or_post_url || "",
      creatorOrRightsHolder: crm.creator_or_rights_holder || "",
      outreachChannel: crm.outreach_channel || "",
      outreachStatus: crm.outreach_status || "not_sent",
      permissionStatus: crm.permission_status || "not_requested",
      evidenceLink: crm.evidence_link || "",
      updatedAt: crm.updated_at || "",
      crmRecorded: Boolean(crm.metricool_queue_item_id),
      canUseForIntake: false,
      nextAction: row.status === "ready_for_source_drop_import"
        ? "Source-drop intake is ready; CRM is informational."
        : "Use CRM status to manage outreach, then record final Real Clip Intake when proof and MP4 exist.",
    };
  });
  const csvRows = mergedRows.map((row) => ({
    metricool_queue_item_id: row.queueItemId,
    category: row.category,
    account_name: row.accountName,
    target_source_drop_file: row.targetSourceDropFile,
    intake_status: row.intakeStatus,
    outreach_status: row.outreachStatus,
    permission_status: row.permissionStatus,
    exact_video_or_post_url: row.exactVideoOrPostUrl,
    creator_or_rights_holder: row.creatorOrRightsHolder,
    evidence_link: row.evidenceLink,
    updated_at: row.updatedAt,
    next_action: row.nextAction,
  }));
  return {
    status: mergedRows.some((row) => row.permissionStatus === "approved" || row.permissionStatus === "owned_source")
      ? "permission_records_present"
      : "needs_permission_records",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_real_clip_permission_crm",
    totalRows: mergedRows.length,
    recordedRows: mergedRows.filter((row) => row.crmRecorded).length,
    approvedRows: mergedRows.filter((row) => row.permissionStatus === "approved" || row.permissionStatus === "owned_source").length,
    deniedRows: mergedRows.filter((row) => row.permissionStatus === "denied").length,
    recreateOnlyRows: mergedRows.filter((row) => row.permissionStatus === "recreate_only").length,
    rows: mergedRows,
    csv: renderCsv([
      "metricool_queue_item_id",
      "category",
      "account_name",
      "target_source_drop_file",
      "intake_status",
      "outreach_status",
      "permission_status",
      "exact_video_or_post_url",
      "creator_or_rights_holder",
      "evidence_link",
      "updated_at",
      "next_action",
    ], csvRows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, workspaceSafeCsvText(value)])
    ))),
    nextAction: "Record outreach attempts here, then use Real Clip Intake Batch for final source-drop manifest approval. CRM rows alone never unlock Metricool.",
    guardrails: [
      "CRM records are operational notes, not final publishing approval.",
      "Approved CRM status still requires final Real Clip Intake plus a local MP4.",
      "Never store tokens, cookies, passwords, private keys, or sensitive private messages.",
      "Metricool remains approval_required and realPublishEnabled=false.",
    ],
  };
}

function renderRealClipPermissionCrmPage(crm) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Permission CRM</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1120px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821}
    input,select,textarea{width:100%;box-sizing:border-box;background:#0f151c;color:#f4f7fb;border:1px solid #304052;border-radius:6px;padding:8px;margin:4px 0}
    button{border:1px solid #3b5f78;border-radius:8px;padding:8px 10px;background:#132536;color:#eaf7ff}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff;word-break:break-word}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Clippers Permission CRM</h1>
  <p>Registra outreach y respuestas de creators sin desbloquear source-drop ni Metricool automaticamente.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(crm.status)}</div></div>
    <div class="card"><div class="label">Recorded</div><div class="value">${escapeHtml(crm.recordedRows)}/${escapeHtml(crm.totalRows)}</div></div>
    <div class="card"><div class="label">Approved CRM</div><div class="value">${escapeHtml(crm.approvedRows)}</div></div>
    <div class="card"><div class="label">Recreate only</div><div class="value">${escapeHtml(crm.recreateOnlyRows)}</div></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-permission-crm.json", "JSON")}
    ${link("/api/clippers/real-clip-permission-crm.csv", "CSV")}
    ${link("/api/clippers/real-clip-permission-crm-batch-template.csv", "Batch template")}
    ${link("/api/clippers/real-clip-source-hunt.html", "Source hunt")}
    ${link("/api/clippers/real-clip-intake-validation.html", "Intake validation")}
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(crm.nextAction)}</p>
  </div>
  <div class="card">
    <div class="label">Batch CRM import</div>
    <form method="post" action="/api/clippers/real-clip-permission-crm/record-batch">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <textarea name="permissionCrmBatch" rows="8" placeholder="metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,outreach_channel,outreach_status,permission_status,evidence_link,operator_notes"></textarea>
      <button type="submit">Validate and record CRM batch</button>
    </form>
    <p class="small">If any row is invalid, nothing is written. CRM records never unlock source-drop or Metricool by themselves.</p>
  </div>
  <div class="card">
    <div class="label">Rows</div>
    <table>
      <thead><tr><th>Queue</th><th>Account</th><th>CRM</th><th>Target</th><th>Record</th></tr></thead>
      <tbody>
        ${crm.rows.map((row) => `<tr>
          <td>${escapeHtml(row.queueItemId)}<div class="small">${escapeHtml(row.category)}</div></td>
          <td>${escapeHtml(row.accountName)}</td>
          <td>${escapeHtml(row.outreachStatus)} / ${escapeHtml(row.permissionStatus)}<div class="small">${escapeHtml(row.updatedAt || "not recorded")}</div></td>
          <td><code>${escapeHtml(row.targetSourceDropFile)}</code><div class="small">${escapeHtml(row.intakeBlockers.join(", ") || "none")}</div></td>
          <td>
            <form method="post" action="/api/clippers/real-clip-permission-crm/record">
              <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
              <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
              <input name="exactVideoOrPostUrl" placeholder="https://www.tiktok.com/@creator/video/123..." value="${escapeHtml(row.exactVideoOrPostUrl)}" />
              <input name="creatorOrRightsHolder" placeholder="@creator or rights holder" value="${escapeHtml(row.creatorOrRightsHolder)}" />
              <select name="outreachChannel">
                ${[...allowedOutreachChannels].map((value) => `<option value="${escapeHtml(value)}"${row.outreachChannel === value ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}
              </select>
              <select name="outreachStatus">
                ${[...allowedOutreachStatuses].map((value) => `<option value="${escapeHtml(value)}"${row.outreachStatus === value ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}
              </select>
              <select name="permissionStatus">
                ${[...allowedPermissionStatuses].map((value) => `<option value="${escapeHtml(value)}"${row.permissionStatus === value ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}
              </select>
              <input name="evidenceLink" placeholder="https://proof... or /clippers-workspace/evidence-drop/..." value="${escapeHtml(row.evidenceLink)}" />
              <textarea name="operatorNotes" placeholder="20+ chars, concrete non-secret note"></textarea>
              <button type="submit">Record CRM</button>
            </form>
            <details>
              <summary>Create local evidence file</summary>
              <form method="post" action="/api/clippers/real-clip-permission-crm/evidence-file">
                <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
                <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
                <input name="exactVideoOrPostUrl" placeholder="https://www.tiktok.com/@creator/video/123..." value="${escapeHtml(row.exactVideoOrPostUrl)}" />
                <input name="creatorOrRightsHolder" placeholder="@creator or rights holder" value="${escapeHtml(row.creatorOrRightsHolder)}" />
                <select name="permissionType">
                  ${[...allowedLocalEvidencePermissionTypes].map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
                </select>
                <textarea name="proofSummary" placeholder="80+ chars. Summarize the actual permission/license/policy/recreate proof without secrets."></textarea>
                <textarea name="creditRequirements" placeholder="80+ chars. Include credit and usage requirements without secrets."></textarea>
                <button type="submit">Create evidence file</button>
              </form>
            </details>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Guardrails</div>
    ${crm.guardrails.map((guardrail) => `<p class="small">${escapeHtml(guardrail)}</p>`).join("")}
  </div>
</main>
</body>
</html>`;
}

function buildTikTokLaunchAuthorizationCenter(status) {
  const targetAccountIds = new Set(["sports-daily", "meme-radar"]);
  const accountRows = (status.tiktokBatchAccountSummary?.accounts || [])
    .filter((account) => targetAccountIds.has(account.accountId))
    .map((account) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      brand: account.brand,
      platform: "tiktok",
      metricoolStatus: status.metricoolMvp?.status === "metricool_mvp_ready" ? "connected_for_metricool_mvp" : "needs_metricool_confirmation",
      tiktokOnly: true,
      clipsInCurrentBatch: account.totalRows,
      readyForMetricoolScheduling: false,
      blocker: status.realClipIntakeValidation?.status === "ready_for_source_drop_import"
        ? "source_drop_import_required"
        : "real_clip_permissions_and_files_required",
      nextAction: status.realClipIntakeValidation?.status === "ready_for_source_drop_import"
        ? "Run source-drop import and regenerate the Metricool batch before scheduling."
        : "Attach exact source URLs, local source files, rights proof, and concrete notes for this account's rows.",
    }));
  const permissionRows = (status.realClipIntakeValidation?.rows || [])
    .filter((row) => ["sports", "memes"].includes(row.category))
    .map((row) => ({
      queueItemId: row.queueItemId,
      category: row.category,
      brand: row.brand,
      accountName: row.accountName,
      targetSourceDropFile: row.targetSourceDropFile,
      targetFileName: row.targetFileName,
      status: row.status,
      missingSourceFile: row.blockers.includes("missing_source_file"),
      missingExactUrl: row.blockers.includes("exact_source_video_or_post_url_missing"),
      missingCreatorOrSource: row.blockers.includes("creator_or_source_missing"),
      missingRightsProof: row.blockers.includes("evidence_link_missing") || row.blockers.includes("rights_status_not_owned_or_permissioned"),
      rightsStatus: row.rightsStatus,
      blockers: row.blockers,
      nextAction: row.status === "ready_for_source_drop_import"
        ? "Ready for source-drop import review; do not schedule until the batch is regenerated from this approved source."
        : "Find/attach a real MP4, exact source video URL, creator/source, rights_status=owned_or_permissioned, evidence link, and concrete notes.",
    }));
  const blockers = [
    accountRows.length >= 2 ? null : "missing_metricool_tiktok_accounts",
    status.realClipIntakeValidation?.status === "ready_for_source_drop_import" ? null : "real_clip_intake_blocked",
    status.realPublishEnabled === false ? null : "real_publish_enabled_must_stay_false",
    status.metricoolApprovalRequired === true ? null : "metricool_approval_required_missing",
  ].filter(Boolean);
  const csvRows = permissionRows.map((row) => ({
    metricool_queue_item_id: row.queueItemId,
    category: row.category,
    account_name: row.accountName,
    target_source_drop_file: row.targetSourceDropFile,
    target_file_name: row.targetFileName,
    status: row.status,
    missing_source_file: row.missingSourceFile ? "yes" : "no",
    missing_exact_url: row.missingExactUrl ? "yes" : "no",
    missing_creator_or_source: row.missingCreatorOrSource ? "yes" : "no",
    missing_rights_proof: row.missingRightsProof ? "yes" : "no",
    rights_status: row.rightsStatus,
    blockers: row.blockers.join(";"),
    next_action: row.nextAction,
  }));
  return {
    status: blockers.length ? "blocked_external_authorization" : "ready_for_source_drop_import_review",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_metricool_sports_memes_authorization",
    tiktokOnly: true,
    metricoolApprovalRequired: status.metricoolApprovalRequired === true,
    realPublishEnabled: status.realPublishEnabled === true,
    accountsTargeted: 2,
    accountsConnectedForMvp: accountRows.filter((row) => row.metricoolStatus === "connected_for_metricool_mvp").length,
    permissionRows: permissionRows.length,
    permissionRowsReady: permissionRows.filter((row) => row.status === "ready_for_source_drop_import").length,
    blockers,
    accounts: accountRows,
    rows: permissionRows,
    csv: renderCsv([
      "metricool_queue_item_id",
      "category",
      "account_name",
      "target_source_drop_file",
      "target_file_name",
      "status",
      "missing_source_file",
      "missing_exact_url",
      "missing_creator_or_source",
      "missing_rights_proof",
      "rights_status",
      "blockers",
      "next_action",
    ], csvRows),
    nextAction: blockers.length
      ? "Complete exact URL + rights proof + local source file for every permission row. Metricool accounts are treated as connected for the MVP, but scheduling stays blocked until real clip intake passes."
      : "Run source-drop import review, regenerate the Metricool batch, then use Metricool approval_required scheduling.",
    guardrails: [
      "Robert authorized the work, but authorization is not creator permission.",
      "Do not mark a creator permission as approved without proof URL/path and concrete notes.",
      "SPORT and memes are the only TikTok accounts in scope for this MVP.",
      "Metricool remains approval_required and realPublishEnabled=false.",
    ],
  };
}

function buildTikTokLaunchAuthorizationMarkdown(status) {
  const center = buildTikTokLaunchAuthorizationCenter(status);
  return [
    "# TikTok Launch Authorization Center",
    "",
    `Generated: ${center.generatedAt}`,
    `Scope: ${center.scope}`,
    `Status: ${center.status}`,
    "",
    "## Summary",
    "",
    `- TikTok only: ${center.tiktokOnly ? "yes" : "no"}`,
    `- Metricool approval required: ${center.metricoolApprovalRequired ? "yes" : "no"}`,
    `- Real publish enabled: ${center.realPublishEnabled ? "yes" : "no"}`,
    `- Accounts connected for MVP: ${center.accountsConnectedForMvp}/${center.accountsTargeted}`,
    `- Permission rows ready: ${center.permissionRowsReady}/${center.permissionRows}`,
    `- Blockers: ${center.blockers.join(", ") || "none"}`,
    "",
    "## Accounts",
    "",
    "| Account | Brand | Metricool status | Clips | Blocker |",
    "| --- | --- | --- | ---: | --- |",
    ...center.accounts.map((account) => `| ${account.accountName} | ${account.brand} | ${account.metricoolStatus} | ${account.clipsInCurrentBatch} | ${account.blocker} |`),
    "",
    "## Permission Rows",
    "",
    "| Queue | Category | Account | Target file | Status | Blockers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...center.rows.map((row) => `| ${row.queueItemId} | ${row.category} | ${row.accountName} | ${row.targetSourceDropFile} | ${row.status} | ${row.blockers.join("; ") || "none"} |`),
    "",
    "## Next Action",
    "",
    center.nextAction,
    "",
    "## Guardrails",
    "",
    ...center.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderTikTokLaunchAuthorizationPage(status) {
  const center = buildTikTokLaunchAuthorizationCenter(status);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TikTok Launch Authorization</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff;word-break:break-word}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>TikTok Launch Authorization</h1>
  <p>Centro de cuentas y permisos para SPORT y memes en TikTok via Metricool. La autorizacion de Robert permite operar, pero cada clip necesita evidencia real de source/derechos.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(center.status)}</div></div>
    <div class="card"><div class="label">Accounts</div><div class="value">${escapeHtml(center.accountsConnectedForMvp)}/${escapeHtml(center.accountsTargeted)}</div></div>
    <div class="card"><div class="label">Permission rows</div><div class="value">${escapeHtml(center.permissionRowsReady)}/${escapeHtml(center.permissionRows)}</div></div>
    <div class="card"><div class="label">Publish</div><div class="value">${escapeHtml(center.realPublishEnabled ? "ON" : "OFF")}</div><p class="small">Metricool approval_required</p></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/tiktok-launch-authorization.json", "JSON")}
    ${link("/api/clippers/tiktok-launch-authorization.csv", "CSV")}
    ${link("/api/clippers/tiktok-launch-authorization.md", "Markdown")}
    ${link("/api/clippers/real-clip-intake-validation.html", "Real clip validation")}
    ${link("/api/clippers/real-clip-permission-outreach.html", "Permission outreach")}
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(center.nextAction)}</p>
  </div>
  <div class="card">
    <div class="label">Accounts</div>
    <table>
      <thead><tr><th>Account</th><th>Brand</th><th>Metricool</th><th>Clips</th><th>Next action</th></tr></thead>
      <tbody>
        ${center.accounts.map((account) => `<tr>
          <td>${escapeHtml(account.accountName)}<div class="small">${escapeHtml(account.accountId)}</div></td>
          <td>${escapeHtml(account.brand)}</td>
          <td>${escapeHtml(account.metricoolStatus)}</td>
          <td>${escapeHtml(account.clipsInCurrentBatch)}</td>
          <td>${escapeHtml(account.nextAction)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Permission rows</div>
    <table>
      <thead><tr><th>Queue</th><th>Account</th><th>Target</th><th>Status</th><th>Missing</th></tr></thead>
      <tbody>
        ${center.rows.map((row) => `<tr>
          <td>${escapeHtml(row.queueItemId)}</td>
          <td>${escapeHtml(row.brand)}<div class="small">${escapeHtml(row.accountName)}</div></td>
          <td><code>${escapeHtml(row.targetSourceDropFile)}</code></td>
          <td>${escapeHtml(row.status)}<div class="small">${escapeHtml(row.rightsStatus)}</div></td>
          <td>${escapeHtml(row.blockers.join(", ") || "none")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Guardrails</div>
    ${center.guardrails.map((guardrail) => `<p class="small">${escapeHtml(guardrail)}</p>`).join("")}
  </div>
</main>
</body>
</html>`;
}

async function buildRealClipPermissionRequestPackets(status) {
  const workbench = await buildRealClipAcquisitionWorkbench(status);
  const rows = (workbench.rows || []).map((row) => {
    const hasExactUrl = isExactSourceVideoOrPostUrl(row.exactVideoOrPostUrl);
    const hasCreator = row.creatorOrRightsHolder && !hasStarterPlaceholder(row.creatorOrRightsHolder);
    const sendable = hasExactUrl && hasCreator;
    const account = row.accountName || row.brand || "our TikTok page";
    const exactUrl = row.exactVideoOrPostUrl || "<exact source video URL>";
    const creator = row.creatorOrRightsHolder || "<creator>";
    const message = [
      `Hi ${creator}, I run ${account}. This clip is a sample of the content we would like to feature: ${exactUrl}.`,
      "We are requesting written blanket permission to select, edit, caption, crop, publish, and monetize current and future clips from your official streams on our TikTok accounts.",
      "We will credit and tag your official account, follow any duration or caption requirements, remove a post on request, and stop future use if you revoke permission in writing.",
      "Please confirm whether this covers TikTok, commercial/monetized use, edits, and future clips, and include any restrictions or required credit.",
      "We will not post unless you approve in writing.",
    ].join(" ");
    return {
      order: row.order,
      queueItemId: row.queueItemId,
      category: row.category,
      accountName: row.accountName,
      stage: row.stage,
      sendable,
      missing: [
        hasExactUrl ? null : "exact_video_or_post_url",
        hasCreator ? null : "creator_or_rights_holder",
      ].filter(Boolean),
      exactVideoOrPostUrl: row.exactVideoOrPostUrl,
      creatorOrRightsHolder: row.creatorOrRightsHolder,
      outreachChannel: "tiktok_dm",
      permissionStatusToRecord: "requested",
      permissionScope: "blanket_creator_tiktok_commercial",
      evidenceTemplate: row.evidenceTemplate,
      message,
      crmRecordHint: sendable
        ? "After sending, record outreach_status=sent and permission_status=requested in Permission CRM."
        : "Do not send yet; find the exact video URL and creator/rightsholder first.",
      nextAction: sendable
        ? "Send this permission request and record the outreach in Permission CRM."
        : row.nextAction,
    };
  });
  const sendableRows = rows.filter((row) => row.sendable).length;
  return {
    status: sendableRows ? "ready_to_send_some_permission_requests" : "needs_exact_url_and_creator_before_outreach",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_real_clip_permission_request_packets",
    totalRows: rows.length,
    sendableRows,
    blockedRows: rows.length - sendableRows,
    summary: sendableRows
      ? `${sendableRows}/${rows.length} permission request(s) are sendable.`
      : "No permission request is sendable yet because rows still need exact source URLs and creator/rightsholder.",
    nextAction: rows.find((row) => !row.sendable)?.nextAction || "Send permission requests and record CRM outreach.",
    rows,
    guardrails: [
      "Do not send a permission request without an exact source video URL and identified creator/rightsholder.",
      "A sent request is not approval.",
      "Only written approval, owned source proof, license, official policy, or approved recreate plan can unlock intake.",
      "Blanket creator approval may cover future clips, but every clip still needs an exact source URL, a real local source file, and the saved approval evidence.",
      "Never store passwords, cookies, tokens, or private sensitive screenshots as evidence.",
    ],
  };
}

function buildRealClipPermissionRequestPacketsCsv(packet) {
  return renderCsv([
    "order",
    "metricool_queue_item_id",
    "category",
    "account_name",
    "sendable",
    "missing",
    "exact_video_or_post_url",
    "creator_or_rights_holder",
    "outreach_channel",
    "permission_status_to_record",
    "permission_scope",
    "evidence_template",
    "message",
    "crm_record_hint",
    "next_action",
  ], (packet.rows || []).map((row) => ({
    order: workspaceSafeCsvText(row.order),
    metricool_queue_item_id: workspaceSafeCsvText(row.queueItemId),
    category: workspaceSafeCsvText(row.category),
    account_name: workspaceSafeCsvText(row.accountName),
    sendable: row.sendable ? "yes" : "no",
    missing: workspaceSafeCsvText(row.missing.join(";")),
    exact_video_or_post_url: workspaceSafeCsvText(row.exactVideoOrPostUrl),
    creator_or_rights_holder: workspaceSafeCsvText(row.creatorOrRightsHolder),
    outreach_channel: workspaceSafeCsvText(row.outreachChannel),
    permission_status_to_record: workspaceSafeCsvText(row.permissionStatusToRecord),
    permission_scope: workspaceSafeCsvText(row.permissionScope),
    evidence_template: workspaceSafeCsvText(row.evidenceTemplate),
    message: workspaceSafeCsvText(row.message),
    crm_record_hint: workspaceSafeCsvText(row.crmRecordHint),
    next_action: workspaceSafeCsvText(row.nextAction),
  })));
}

function buildRealClipPermissionRequestPacketsMarkdown(packet) {
  return [
    "# Clippers Real Clip Permission Request Packets",
    "",
    `Generated: ${packet.generatedAt}`,
    `Status: ${packet.status}`,
    "",
    `- Total rows: ${packet.totalRows}`,
    `- Sendable rows: ${packet.sendableRows}`,
    `- Blocked rows: ${packet.blockedRows}`,
    "",
    packet.summary,
    "",
    "## Rows",
    "",
    "| Order | Queue | Sendable | Missing | Message | Next action |",
    "| ---: | --- | --- | --- | --- | --- |",
    ...(packet.rows || []).map((row) => `| ${[
      row.order,
      row.queueItemId,
      row.sendable ? "yes" : "no",
      row.missing.join(";") || "none",
      row.message,
      row.nextAction,
    ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
    "",
    "## Guardrails",
    "",
    ...packet.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderRealClipPermissionRequestPacketsPage(packet) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Permission Request Packets</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1120px;margin:0 auto;padding:28px 18px 48px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card,.row{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:12px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:18px 0}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .value{font-size:24px;font-weight:800;color:#fff}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
    .actions a{border:1px solid #365063;background:#172433;border-radius:8px;padding:10px 12px;text-decoration:none;color:#eaf7ff}
    pre{white-space:pre-wrap;word-break:break-word;background:#111820;border:1px solid #263340;border-radius:6px;color:#d9f0ff;padding:10px}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Permission Request Packets</h1>
  <p>${escapeHtml(packet.summary)}</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(packet.status)}</div></div>
    <div class="card"><div class="label">Sendable</div><div class="value">${escapeHtml(packet.sendableRows)}/${escapeHtml(packet.totalRows)}</div></div>
    <div class="card"><div class="label">Blocked</div><div class="value">${escapeHtml(packet.blockedRows)}</div></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-permission-request-packets.json", "JSON")}
    ${link("/api/clippers/real-clip-permission-request-packets.md", "Markdown")}
    ${link("/api/clippers/real-clip-permission-request-packets.csv", "CSV")}
    ${link("/api/clippers/real-clip-acquisition-workbench.html", "Acquisition Workbench")}
    ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}
  </div>
  ${(packet.rows || []).map((row) => `<section class="row">
    <div class="label">${escapeHtml(row.accountName)} · ${escapeHtml(row.category)} · ${escapeHtml(row.sendable ? "sendable" : "blocked")}</div>
    <h2><code>${escapeHtml(row.queueItemId)}</code></h2>
    <p class="small">Missing: ${escapeHtml(row.missing.join(", ") || "none")}</p>
    <pre>${escapeHtml(row.message)}</pre>
    <p>${escapeHtml(row.crmRecordHint)}</p>
  </section>`).join("")}
</main>
</body>
</html>`;
}

async function renderRealClipExactSourceCandidateInboxPage(status) {
  const workbench = await buildRealClipAcquisitionWorkbench(status);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Exact Source Candidate Inbox</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1120px;margin:0 auto;padding:28px 18px 48px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card,.row{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:12px 0}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
    .actions a{border:1px solid #365063;background:#172433;border-radius:8px;padding:10px 12px;text-decoration:none;color:#eaf7ff}
    input,textarea{box-sizing:border-box;width:100%;border:1px solid #304253;background:#0b1118;color:#eef7ff;border-radius:6px;padding:8px;margin:6px 0;font:inherit}
    textarea{min-height:160px;resize:vertical}
    button{border:1px solid #3d6a83;background:#0f3248;border-radius:8px;padding:10px 12px;color:#eaf7ff;font:inherit;cursor:pointer}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .small{font-size:12px;color:#9fb0c4}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
  </style>
</head>
<body>
<main>
  <h1>Exact Source Candidate Inbox</h1>
  <p>Pega URLs exactas de TikTok, clips de Twitch o videos/Shorts de YouTube y el creator/rightsholder por fila. Esto solo guarda leads en CRM; no aprueba derechos, no crea MP4 y no desbloquea Metricool.</p>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-exact-source-candidate-batch-template.csv", "Batch template")}
    ${link("/api/clippers/real-clip-acquisition-workbench.html", "Acquisition Workbench")}
    ${link("/api/clippers/real-clip-permission-request-packets.html", "Permission Request Packets")}
    ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}
  </div>
  <div class="card">
    <div class="label">Guardrail</div>
    <p class="small">Formatos aceptados: post exacto de TikTok, clip exacto de Twitch o video/Short exacto de YouTube. Se rechazan busquedas, hashtags, explore, canales y placeholders.</p>
  </div>
  <div class="card">
    <div class="label">Batch import</div>
    <p class="small">If any row is invalid, nothing is written. This records leads only: permission remains not_requested.</p>
    <form method="post" action="/api/clippers/real-clip-exact-source-candidate/record-batch">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <textarea name="exactSourceCandidateBatch" rows="8" placeholder="metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder"></textarea>
      <button type="submit">Record exact source candidates batch</button>
    </form>
  </div>
  ${(workbench.rows || []).map((row) => `<section class="row">
    <div class="label">${escapeHtml(row.category)} · ${escapeHtml(row.accountName)} · ${escapeHtml(row.stage)}</div>
    <h2><code>${escapeHtml(row.queueItemId)}</code></h2>
    <p class="small">Target: ${escapeHtml(row.targetSourceDropFile)}</p>
    <form method="post" action="/api/clippers/real-clip-exact-source-candidate/record">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
      <input name="exactVideoOrPostUrl" placeholder="https://clips.twitch.tv/ExactClipSlug" value="${escapeHtml(row.exactVideoOrPostUrl || "")}" />
      <input name="creatorOrRightsHolder" placeholder="@creator or rights holder" value="${escapeHtml(row.creatorOrRightsHolder || "")}" />
      <button type="submit">Record exact source candidate</button>
    </form>
    <p class="small">After recording, use Permission Request Packets. This does not mark permission approved.</p>
  </section>`).join("")}
</main>
</body>
</html>`;
}

function buildRealClipPermissionOutreachMarkdown(status) {
  const pack = buildRealClipPermissionOutreachPack(status);
  return [
    "# Clippers Real Clip Permission Outreach Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Scope: ${pack.scope}`,
    `Status: ${pack.status}`,
    "",
    pack.summary,
    "",
    "## Counts",
    "",
    `- Outreach rows: ${pack.totalRows}`,
    `- Not sent: ${pack.notSent}`,
    `- Approved in this pack: ${pack.approved}`,
    "",
    "## Next Action",
    "",
    pack.nextAction,
    "",
    "## Rows",
    "",
    "| Order | Queue | Category | Target file | Outreach status | Permission status |",
    "| --- | --- | --- | --- | --- | --- |",
    ...pack.rows.map((row) => `| ${row.order} | ${row.queueItemId} | ${row.category} | ${row.targetSourceDropFile} | ${row.outreachStatus} | ${row.permissionStatus} |`),
    "",
    "## Guardrails",
    "",
    ...pack.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Links",
    "",
    `- Outreach CSV: ${localOrigin()}/api/clippers/real-clip-permission-outreach.csv`,
    `- Intake validation: ${localOrigin()}/api/clippers/real-clip-intake-validation.html`,
    "",
  ].join("\n");
}

function renderRealClipPermissionOutreachPage(status) {
  const pack = buildRealClipPermissionOutreachPack(status);
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Permission Outreach</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
    .value{font-size:24px;font-weight:800;color:#fff}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
    .actions a{border:1px solid #32475a;border-radius:8px;padding:8px 10px;text-decoration:none;background:#101821}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    .small{font-size:12px;color:#9fb0c4}
  </style>
</head>
<body>
<main>
  <h1>Clippers Permission Outreach</h1>
  <p>Hoja de trabajo para buscar creators, pedir permiso y guardar proof. No concede permisos y no marca ningun clip como aprobado.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(pack.status)}</div></div>
    <div class="card"><div class="label">Rows</div><div class="value">${escapeHtml(pack.totalRows)}</div></div>
    <div class="card"><div class="label">Approved here</div><div class="value">${escapeHtml(pack.approved)}</div></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/real-clip-permission-outreach.csv", "Outreach CSV")}
    ${link("/api/clippers/real-clip-permission-outreach.md", "Outreach MD")}
    ${link("/api/clippers/real-clip-intake-validation.html", "Intake validation")}
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(pack.nextAction)}</p>
  </div>
  <div class="card">
    <div class="label">Rows</div>
    <table>
      <thead><tr><th>Order</th><th>Queue</th><th>Target</th><th>Search brief</th><th>Message template</th></tr></thead>
      <tbody>
        ${pack.rows.map((row) => `<tr>
          <td>${escapeHtml(row.order)}</td>
          <td>${escapeHtml(row.queueItemId)}</td>
          <td>${escapeHtml(row.targetSourceDropFile)}<div class="small">${escapeHtml(row.category)}</div></td>
          <td>${escapeHtml(row.searchBrief)}</td>
          <td>${escapeHtml(row.messageTemplate)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Guardrails</div>
    ${pack.guardrails.map((guardrail) => `<p class="small">${escapeHtml(guardrail)}</p>`).join("")}
  </div>
</main>
</body>
</html>`;
}

async function buildUploadPackIntegrity(rows) {
  const checkedRows = await Promise.all(rows.map(async (row) => {
    const uploadFilePath = String(row.uploadFilePath || "");
    const uploadFileName = row.uploadFileName || path.basename(uploadFilePath);
    const fileStat = uploadFilePath ? await stat(uploadFilePath).catch(() => null) : null;
    const exists = Boolean(fileStat?.isFile());
    const bytes = exists ? Number(fileStat.size || 0) : 0;
    return {
      queueItemId: row.queueItemId,
      rank: row.rank,
      brand: row.metricoolBrandName,
      accountName: row.accountName,
      sourceFileName: row.sourceFileName,
      uploadFileName,
      uploadFileUrl: row.uploadFileUrl,
      exists,
      bytes,
      ok: exists && bytes > 0,
    };
  }));
  const missingFiles = checkedRows.filter((row) => !row.exists).length;
  const zeroByteFiles = checkedRows.filter((row) => row.exists && row.bytes <= 0).length;
  return {
    status: !checkedRows.length
      ? "no_rows"
      : missingFiles || zeroByteFiles ? "blocked_upload_pack" : "ready",
    totalRows: checkedRows.length,
    readyFiles: checkedRows.filter((row) => row.ok).length,
    missingFiles,
    zeroByteFiles,
    totalBytes: checkedRows.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
    blockedRows: checkedRows.filter((row) => !row.ok).slice(0, 10),
    rows: checkedRows,
  };
}

function buildNextBestAction(status) {
  const schedulingRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const publicMetricsRow = status.publicMetricsRunSheet?.nextRow || null;
  const evidenceRows = Number(status.evidence?.rows || 0);
  const missingApproval = Number(status.evidence?.missingApproval || 0);
  const readyForImportPreview = Number(status.evidence?.readyForImportPreview || 0);
  const scheduledEvidenceStarted = (status.rows || []).some((row) => row.hasMetricoolScheduledEvidence);
  const rollForwardAllowedBeforeEvidence = evidenceRows > 0
    && missingApproval === evidenceRows
    && readyForImportPreview === 0
    && !scheduledEvidenceStarted;
  if (status.operatorSummary?.needsRollForward === true && !rollForwardAllowedBeforeEvidence) {
    return {
      stage: "manual_review_schedule_expired",
      title: "Review the expired schedule before adding more proof",
      detail: "Some Metricool evidence already exists, so the local batch cannot be safely rolled forward. Review existing proof and either finish metrics for scheduled rows or start a fresh batch.",
      queueItemId: status.operatorSummary.deadlineQueueItemId || "",
      brand: status.operatorSummary.deadlineMetricoolBrandName || "",
      accountName: status.operatorSummary.deadlineAccountName || "",
      primaryAction: "Open operator",
      primaryHref: "/clippers",
      endpoint: "",
    };
  }
  if (status.uploadPackIntegrity?.status === "blocked_upload_pack") {
    const blockedRow = status.uploadPackIntegrity.blockedRows?.[0] || {};
    return {
      stage: "upload_pack_blocked",
      title: "Fix the local upload pack before Metricool",
      detail: `The upload pack is missing or has empty MP4 files. First blocked file: ${blockedRow.uploadFileName || "unknown file"}.`,
      queueItemId: blockedRow.queueItemId || "",
      brand: blockedRow.brand || "",
      accountName: blockedRow.accountName || "",
      primaryAction: "Open operator",
      primaryHref: "/clippers",
      endpoint: "",
    };
  }
  const realClipValidation = status.realClipIntakeValidation || {};
  const realClipGap = status.realClipGap || {};
  if (realClipValidation.status && !realClipIntakeReadyForScheduling(realClipValidation.status)) {
    return {
      stage: "real_clip_intake_required",
      title: "Replace placeholders with real clips before Metricool",
      detail: realClipValidation.summary || realClipGap.summary || "The current MP4s are generated placeholders, not real viral clips. Add exact source URLs, rights proof, and local source files before scheduling.",
      queueItemId: status.operatorSummary?.deadlineQueueItemId || "",
      brand: status.operatorSummary?.deadlineMetricoolBrandName || "",
      accountName: status.operatorSummary?.deadlineAccountName || "",
      primaryAction: "Open real clip intake",
      primaryHref: "/api/clippers/real-clip-intake.html",
      endpoint: "",
    };
  }
  if (status.operatorSummary?.needsRollForward === true && rollForwardAllowedBeforeEvidence) {
    return {
      stage: "roll_forward_required",
      title: "Roll forward the local batch before recording proof",
      detail: status.operatorSummary.scheduleWindowAction || "The first publish time is too close or expired.",
      queueItemId: status.operatorSummary.deadlineQueueItemId || "",
      brand: status.operatorSummary.deadlineMetricoolBrandName || "",
      accountName: status.operatorSummary.deadlineAccountName || "",
      primaryAction: "Roll forward schedule",
      primaryHref: "",
      endpoint: "/api/clippers/roll-forward",
    };
  }
  if (Number(status.evidence?.missingApproval || 0) > 0 && schedulingRow) {
    return {
      stage: "schedule_in_metricool",
      title: "Schedule the next deadline row in Metricool",
      detail: `Use ${schedulingRow.metricoolBrandName} for ${schedulingRow.accountName}, upload ${schedulingRow.uploadFileName}, then save the real Metricool planner URL.`,
      queueItemId: schedulingRow.queueItemId,
      brand: schedulingRow.metricoolBrandName,
      accountName: schedulingRow.accountName,
      publishAt: schedulingRow.publishAt,
      publishAtLocal: schedulingRow.publishAtLocal,
      primaryAction: "Open upload pack",
      primaryHref: "/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html",
      endpoint: "",
    };
  }
  if (status.publicMetricsRunSheet?.status === "needs_public_tiktok_metrics" && publicMetricsRow) {
    return {
      stage: "record_public_metrics",
      title: "Record the next public TikTok URL and real 24h metrics",
      detail: `Use the exact public TikTok video URL for ${publicMetricsRow.metricoolBrandName} / ${publicMetricsRow.accountName}; views_24h must be positive.`,
      queueItemId: publicMetricsRow.queueItemId,
      brand: publicMetricsRow.metricoolBrandName,
      accountName: publicMetricsRow.accountName,
      publishAt: publicMetricsRow.publishAt,
      publishAtLocal: publicMetricsRow.publishAtLocal,
      primaryAction: "Download published metrics CSV",
      primaryHref: "/api/clippers/published-metrics-starter.csv",
      endpoint: "",
    };
  }
  if (status.publicMetricsRunSheet?.status === "locked_until_metricool_scheduled_proof") {
    return {
      stage: "waiting_scheduled_proof",
      title: "Finish Metricool scheduled proof first",
      detail: "Public TikTok metrics stay locked until each row has a real Metricool planner URL saved.",
      queueItemId: status.operatorSummary?.deadlineQueueItemId || "",
      brand: status.operatorSummary?.deadlineMetricoolBrandName || "",
      accountName: status.operatorSummary?.deadlineAccountName || "",
      primaryAction: "Download scheduled proof CSV",
      primaryHref: "/api/clippers/scheduled-proof-starter.csv",
      endpoint: "",
    };
  }
  return {
    stage: status.goalReadinessAudit?.complete ? "complete" : "review_status",
    title: status.goalReadinessAudit?.complete ? "Goal is complete" : "Review Clippers status",
    detail: status.goalReadinessAudit?.summary || status.nextStep || "Review the operator dashboard for current blockers.",
    queueItemId: "",
    brand: "",
    accountName: "",
    primaryAction: "Open operator",
    primaryHref: "/clippers",
    endpoint: "",
  };
}

function exactTikTokProfileUrl(value, expectedHandle) {
  const match = String(value || "").trim().match(/^https:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,64})\/?$/i);
  return Boolean(match && `@${match[1].toLowerCase()}` === String(expectedHandle || "").trim().toLowerCase());
}

function trustedStreamerGrowthMetrics(input) {
  const source = String(input?.source || "").trim().toLowerCase();
  const measuredAt = String(input?.measuredAt || "").trim();
  const sportsFollowers = Number(input?.sportsFollowers);
  const memesFollowers = Number(input?.memesFollowers);
  const sportsViews30d = Number(input?.sportsViews30d);
  const memesViews30d = Number(input?.memesViews30d);
  const sportsAccountName = String(input?.sportsAccountName || "").trim();
  const memesAccountName = String(input?.memesAccountName || "").trim();
  const published30d = Number(input?.published30d);
  const sportsProfileUrl = String(input?.sportsProfileUrl || "").trim();
  const memesProfileUrl = String(input?.memesProfileUrl || "").trim();
  const measuredAtMs = Date.parse(measuredAt);
  const ageMs = Date.now() - measuredAtMs;
  const trusted = source === "metricool"
    && Number.isInteger(sportsFollowers)
    && sportsFollowers >= 0
    && Number.isInteger(memesFollowers)
    && memesFollowers >= 0
    && Number.isFinite(measuredAtMs)
    && ageMs >= 0
    && ageMs <= 72 * 60 * 60_000
    && input?.publicProfileVerified === true
    && exactTikTokProfileUrl(sportsProfileUrl, "@streamersclipusa")
    && exactTikTokProfileUrl(memesProfileUrl, "@streamersclips")
    && sportsAccountName.toLowerCase() === "streamer highlights"
    && memesAccountName.toLowerCase() === "streamer reactions";
  return {
    trusted,
    source: trusted ? "metricool" : "metricool_not_imported",
    measuredAt: trusted ? measuredAt : "",
    followers: trusted ? Math.min(sportsFollowers, memesFollowers) : null,
    followersByAccount: {
      sports: trusted ? sportsFollowers : null,
      memes: trusted ? memesFollowers : null,
    },
    views30d: trusted && [sportsViews30d, memesViews30d].every((value) => Number.isFinite(value) && value >= 0)
      ? Math.min(Math.round(sportsViews30d), Math.round(memesViews30d))
      : null,
    views30dByAccount: {
      sports: trusted && Number.isFinite(sportsViews30d) && sportsViews30d >= 0 ? Math.round(sportsViews30d) : null,
      memes: trusted && Number.isFinite(memesViews30d) && memesViews30d >= 0 ? Math.round(memesViews30d) : null,
    },
    rebrandConfirmed: source === "metricool"
      && Number.isFinite(measuredAtMs)
      && ageMs >= 0
      && ageMs <= 72 * 60 * 60_000
      && input?.publicProfileVerified === true
      && exactTikTokProfileUrl(sportsProfileUrl, "@streamersclipusa")
      && exactTikTokProfileUrl(memesProfileUrl, "@streamersclips")
      && sportsAccountName.toLowerCase() === "streamer highlights"
      && memesAccountName.toLowerCase() === "streamer reactions",
    accountNames: {
      sportsConnection: sportsAccountName || "SPORT",
      memesConnection: memesAccountName || "memes",
    },
    published30d: trusted && Number.isFinite(published30d) && published30d >= 0 ? Math.round(published30d) : null,
    allowlistedCreators: Math.max(0, Math.round(Number(input?.allowlistedCreators) || 0)),
    weeklyCandidates: Math.max(0, Math.round(Number(input?.weeklyCandidates) || 0)),
    weeklyRightsCleared: Math.max(0, Math.round(Number(input?.weeklyRightsCleared) || 0)),
    weeklyDraftReady: Math.max(0, Math.round(Number(input?.weeklyDraftReady) || 0)),
    weeklyMetricoolQueued: Math.max(0, Math.round(Number(input?.weeklyMetricoolQueued) || 0)),
  };
}

function trustedStreamerRoutingProof(input) {
  const source = String(input?.source || "").trim().toLowerCase();
  const confirmedAt = String(input?.confirmedAt || "").trim();
  const confirmedAtMs = Date.parse(confirmedAt);
  const sportsAccountName = String(input?.sportsAccountName || "").trim();
  const memesAccountName = String(input?.memesAccountName || "").trim();
  const platform = String(input?.platform || "").trim().toLowerCase();
  const sportsProfileUrl = String(input?.sportsProfileUrl || "").trim();
  const memesProfileUrl = String(input?.memesProfileUrl || "").trim();
  const connectionsVerified = ["user_confirmed", "metricool_ui_verified"].includes(source)
    && Number.isFinite(confirmedAtMs)
    && confirmedAtMs <= Date.now() + 5 * 60_000
    && platform === "tiktok"
    && input?.sportsConnected === true
    && input?.memesConnected === true
    && input?.publicProfileVerified === true
    && exactTikTokProfileUrl(sportsProfileUrl, "@streamersclipusa")
    && exactTikTokProfileUrl(memesProfileUrl, "@streamersclips");
  const confirmed = connectionsVerified
    && sportsAccountName.toLowerCase() === "streamer highlights"
    && memesAccountName.toLowerCase() === "streamer reactions";
  return {
    confirmed,
    connectionsVerified,
    source: connectionsVerified ? source : "not_confirmed",
    confirmedAt: confirmed ? confirmedAt : "",
    connectionsVerifiedAt: connectionsVerified ? confirmedAt : "",
    accountNames: {
      sportsConnection: connectionsVerified ? sportsAccountName : "SPORT",
      memesConnection: connectionsVerified ? memesAccountName : "memes",
    },
    profileUrls: {
      sportsConnection: connectionsVerified ? sportsProfileUrl : "",
      memesConnection: connectionsVerified ? memesProfileUrl : "",
    },
  };
}

function safeCampaignHttpsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || hasStarterPlaceholder(raw) || secretQueryParamPattern.test(raw)) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function exactTwitchChannelUrl(value) {
  const safe = safeCampaignHttpsUrl(value);
  if (!safe) return "";
  try {
    const parsed = new URL(safe);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (hostName !== "twitch.tv" || parsed.search || parsed.hash) return "";
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{3,25})\/?$/);
    return match ? `https://www.twitch.tv/${match[1]}` : "";
  } catch {
    return "";
  }
}

function exactCreatorChannel(value) {
  const twitchUrl = exactTwitchChannelUrl(value);
  if (twitchUrl) {
    return {
      url: twitchUrl,
      platform: "twitch",
      handle: new URL(twitchUrl).pathname.split("/").filter(Boolean)[0],
    };
  }
  const safe = safeCampaignHttpsUrl(value);
  if (!safe) return null;
  try {
    const parsed = new URL(safe);
    const hostName = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (parsed.search || parsed.hash) return null;
    if (hostName === "kick.com") {
      const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{3,25})(?:\/(?:about|clips))?\/?$/);
      return match ? { url: `https://kick.com/${match[1]}`, platform: "kick", handle: match[1] } : null;
    }
    if (hostName === "youtube.com") {
      const handleMatch = parsed.pathname.match(/^\/@([A-Za-z0-9_.-]{3,50})\/?$/);
      if (handleMatch) return { url: `https://www.youtube.com/@${handleMatch[1]}`, platform: "youtube", handle: handleMatch[1] };
      const channelMatch = parsed.pathname.match(/^\/channel\/([A-Za-z0-9_-]{10,64})\/?$/);
      if (channelMatch) return { url: `https://www.youtube.com/channel/${channelMatch[1]}`, platform: "youtube", handle: channelMatch[1] };
    }
    return null;
  } catch {
    return null;
  }
}

function campaignCandidateRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["candidates", "streamers", "rows", "creators", "items"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function firstCampaignValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstCampaignArrayUrl(row, keys) {
  for (const key of keys) {
    const values = row?.[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const safe = safeCampaignHttpsUrl(value);
      if (safe) return safe;
    }
  }
  return "";
}

function normalizeCampaignEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email)
    ? email
    : "";
}

function campaignHandleKey(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "");
}

function campaignRowHandleKeys(row) {
  return [...new Set([row?.handle, ...(Array.isArray(row?.outreachHandleKeys) ? row.outreachHandleKeys : [])]
    .map(campaignHandleKey)
    .filter(Boolean))];
}

function campaignPermissionMap(rows) {
  const permissions = new Map();
  for (const row of rows || []) {
    for (const key of campaignRowHandleKeys(row)) permissions.set(key, row);
  }
  return permissions;
}

function campaignRowMatchesHandle(row, handle) {
  return campaignRowHandleKeys(row).includes(campaignHandleKey(handle));
}

function streamerPermissionRestrictions(outreach = {}) {
  const delay = Number.parseInt(String(outreach.min_publish_delay_hours || "").trim(), 10);
  return {
    noAi: String(outreach.no_ai || "").trim().toLowerCase() === "yes",
    minimumPublishDelayHours: Number.isInteger(delay) && delay >= 0 && delay <= 720 ? delay : 0,
    contextReviewRequired: String(outreach.context_review_required || "").trim().toLowerCase() === "yes",
    creatorCreditRequired: String(outreach.creator_credit_required || "").trim().toLowerCase() === "yes",
    allowedAccountNames: String(outreach.allowed_account_names || "")
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function campaignContactUrlFromEvidence(type, value) {
  const safe = safeCampaignHttpsUrl(value);
  if (!safe || !/(inquiry_form|official_(?:instagram|social|x)_profile|public_social_profile|business_email_or_(?:form|bluesky|marshmallow|twitter|vgen))/i.test(String(type || ""))) return "";
  try {
    const hostName = new URL(safe).hostname.replace(/^www\./, "").toLowerCase();
    if (["twitchtracker.com", "betterbanned.com", "streamscharts.com", "twitchmetrics.net"].includes(hostName)) return "";
    return safe;
  } catch {
    return "";
  }
}

function normalizeStreamerCampaignRow(raw, cohort, sourceFile) {
  const channel = exactCreatorChannel(firstCampaignValue(raw, [
    "officialCreatorUrl", "official_creator_url", "officialChannelUrl", "official_channel_url", "officialUrl", "official_url",
    "kickUrl", "kick_url", "kickOfficialUrl", "kick_official_url", "youtubeUrl", "youtube_url", "youtubeOfficialUrl", "youtube_official_url",
    "twitchUrl", "twitch_url", "twitchOfficialUrl", "twitch_official_url", "twitchOfficial", "twitch_official", "officialTwitch", "official_twitch", "officialTwitchUrl", "official_twitch_url", "channelUrl", "channel_url",
  ]));
  const handleFromUrl = channel?.handle || "";
  const rawHandle = firstCampaignValue(raw, ["handle", "handleExact", "handle_exact", "twitchHandle", "twitch_handle", "creator", "name"])
    .replace(/^@/, "")
    .trim();
  const handle = handleFromUrl;
  if (!handle || !channel) return null;
  if (channel.platform !== "twitch" && rawHandle && campaignHandleKey(rawHandle) !== campaignHandleKey(handleFromUrl)) return null;
  const nestedContact = raw?.publicContact && typeof raw.publicContact === "object"
    ? raw.publicContact
    : raw?.contact && typeof raw.contact === "object"
      ? raw.contact
      : {};
  const nestedPolicy = raw?.clipPolicy && typeof raw.clipPolicy === "object" ? raw.clipPolicy : {};
  const contactEvidenceUrl = safeCampaignHttpsUrl(firstCampaignValue(raw, ["contactEvidenceUrl", "contact_evidence_url", "contactEvidence", "contact_evidence", "evidenceUrl", "evidence_url"]))
    || firstCampaignArrayUrl(raw, ["contactEvidenceUrls", "contact_evidence_urls"])
    || safeCampaignHttpsUrl(nestedContact.evidenceUrl);
  const policyEvidenceUrl = safeCampaignHttpsUrl(firstCampaignValue(raw, ["policyEvidenceUrl", "policy_evidence_url", "clipPolicyEvidenceUrl", "clip_policy_evidence_url", "clipsPolicyEvidenceUrl", "clips_policy_evidence_url", "rightsEvidenceUrl", "rights_evidence_url"]))
    || firstCampaignArrayUrl(raw, ["clipPolicyEvidenceUrls", "clip_policy_evidence_urls"])
    || safeCampaignHttpsUrl(nestedPolicy.evidenceUrl || nestedPolicy.creatorEvidenceUrl || nestedPolicy.platformEvidenceUrl);
  const publicBusinessContact = firstCampaignValue(raw, ["publicBusinessContact", "public_business_contact"])
    || String(nestedContact.value || "").trim();
  const contactEmail = normalizeCampaignEmail(firstCampaignValue(raw, ["contactEmail", "contact_email", "businessEmail", "business_email", "email"]) || publicBusinessContact);
  const contactUrl = safeCampaignHttpsUrl(firstCampaignValue(raw, ["contactUrl", "contact_url", "businessContactUrl", "business_contact_url", "contactForm", "contact_form"]) || publicBusinessContact)
    || campaignContactUrlFromEvidence(nestedContact.type, nestedContact.evidenceUrl);
  const requiresHumanVerification = raw?.contactRequiresCaptcha === true
    || raw?.contact_requires_captcha === true
    || nestedContact.requiresHumanVerification === true
    || nestedContact.requires_human_verification === true
    || nestedContact.requiresCaptcha === true;
  const requestedPolicy = firstCampaignValue(raw, ["rightsPolicy", "rights_policy", "policyStatus", "policy_status"])
    || String(nestedPolicy.rightsPolicy || nestedPolicy.rights_policy || "").trim();
  const policySummary = firstCampaignValue(raw, ["policySummary", "policy_summary", "publicClipPolicy", "public_clip_policy", "publicClipsPolicy", "public_clips_policy", "policy"])
    || String(nestedPolicy.summary || "").trim();
  const rightsPolicy = requestedPolicy === "public_blanket_allow" && /(separate|direct|written|business|commercial).{0,50}(approval|permission|required|contact)|larger[- ]scale/i.test(policySummary)
    ? "request_required"
    : new Set(["public_blanket_allow", "request_required", "no_evidence", "forbidden"]).has(requestedPolicy)
      ? requestedPolicy
    : "no_evidence";
  const hasVerifiedContact = Boolean((contactEmail || contactUrl) && contactEvidenceUrl);
  const priority = rightsPolicy === "forbidden"
    ? "exclude"
    : requiresHumanVerification
      ? "human_action_required"
    : hasVerifiedContact && rightsPolicy === "public_blanket_allow"
      ? "policy_review_first"
      : hasVerifiedContact
        ? "outreach_ready"
        : "needs_verified_contact";
  return {
    handle,
    displayName: rawHandle || handle,
    outreachHandleKeys: [...new Set([handle, rawHandle].map(campaignHandleKey).filter(Boolean))],
    creatorUrl: channel.url,
    platform: channel.platform,
    twitchUrl: channel.platform === "twitch" ? channel.url : "",
    cohort,
    sourceFile,
    language: firstCampaignValue(raw, ["language", "idioma"])
      || String(raw?.countryLanguage?.language || raw?.country_language?.language || "").trim(),
    country: firstCampaignValue(raw, ["country", "pais", "region", "countryOrRegion", "country_or_region"])
      || String(raw?.countryLanguage?.country || raw?.country_language?.country || "").trim(),
    category: firstCampaignValue(raw, ["category", "niche", "categoria"]),
    contactEmail,
    contactUrl,
    contactEvidenceUrl,
    requiresHumanVerification,
    rightsPolicy,
    policyEvidenceUrl,
    policySummary,
    risk: typeof raw?.risk === "object" && raw.risk
      ? [raw.risk.level, raw.risk.notes].filter(Boolean).join(": ")
      : [firstCampaignValue(raw, ["risk", "riskNote", "risk_note", "riesgo"]), firstCampaignValue(raw, ["riskNotes", "risk_notes"])].filter(Boolean).join(": "),
    reasonToPrioritize: firstCampaignValue(raw, ["reasonToPrioritize", "reason_to_prioritize", "priorityReason", "priority_reason"]),
    hasVerifiedContact,
    priority,
    permissionStatus: "not_requested",
    canPublish: false,
    permissionScope: "blanket_creator_tiktok_commercial",
    outreachMessage: `Hi ${handle}, we run two TikTok streamer pages and are requesting written blanket permission to select, edit, caption, crop, publish, and monetize current and future clips from your official streams. We will credit/tag you, follow your restrictions, remove posts on request, and stop future use if permission is revoked. Please confirm TikTok, commercial use, edits, future clips, and required credit. We will not post without written approval.`,
  };
}

async function buildStreamer100Campaign() {
  const names = [
    "streamer-cohort-premium.json",
    "streamer-cohort-en-na.json",
    "streamer-cohort-es.json",
    "streamer-cohort-eu.json",
    "streamer-cohort-indie.json",
  ];
  const byHandle = new Map();
  const sourceFiles = [];
  for (const fileName of names) {
    const filePath = path.join(streamerResearchDir, fileName);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
      sourceFiles.push(fileName);
    } catch {
      continue;
    }
    const cohort = fileName.replace(/^streamer-cohort-|\.json$/g, "");
    for (const raw of campaignCandidateRows(parsed)) {
      const row = normalizeStreamerCampaignRow(raw, cohort, fileName);
      if (!row) continue;
      const key = campaignHandleKey(row.handle);
      const previous = byHandle.get(key);
      if (!previous || (!previous.hasVerifiedContact && row.hasVerifiedContact)) byHandle.set(key, row);
    }
  }
  const outreachRaw = await readText(streamerBlanketPermissionCsvPath, "");
  const outreachRows = outreachRaw.trim() ? parseCsv(outreachRaw).rows : [];
  const outreachByHandle = new Map(outreachRows.map((row) => [campaignHandleKey(row.handle), row]));
  const mergedRows = await Promise.all([...byHandle.values()].map(async (row) => {
    const outreach = row.outreachHandleKeys.map((key) => outreachByHandle.get(key)).find(Boolean) || {};
    const claimedOutreachStatus = String(outreach.outreach_status || "not_sent").trim().toLowerCase();
    const outreachEvidenceLink = String(outreach.outreach_evidence_link || "").trim();
    const requestedPermissionStatus = String(outreach.permission_status || "not_requested").trim().toLowerCase();
    const evidenceLink = String(outreach.evidence_link || "").trim();
    const scopeComplete = ["scope_tiktok", "scope_commercial", "scope_edits", "scope_future_clips"]
      .every((key) => String(outreach[key] || "").trim().toLowerCase() === "yes");
    const localEvidenceLink = evidenceLink && !/^https:\/\//i.test(evidenceLink);
    const evidence = localEvidenceLink
      ? await realClipEvidenceStatus(evidenceLink)
      : { ok: false };
    const localOutreachEvidenceLink = outreachEvidenceLink && !/^https?:\/\//i.test(outreachEvidenceLink);
    const outreachEvidence = localOutreachEvidenceLink
      ? await realClipEvidenceStatus(outreachEvidenceLink)
      : { ok: false };
    const responseEvidenceValid = claimedOutreachStatus === "responded" && evidence.ok;
    const blanketApprovalValid = requestedPermissionStatus === "approved_blanket" && scopeComplete && responseEvidenceValid;
    const permissionDeniedValid = requestedPermissionStatus === "denied" && responseEvidenceValid;
    const outreachClaimVerified = ["sent", "delivered"].includes(claimedOutreachStatus)
      ? outreachEvidence.ok
      : claimedOutreachStatus === "responded"
        ? responseEvidenceValid
        : !["bounced", "failed"].includes(claimedOutreachStatus) || outreachEvidence.ok;
    const outreachStatus = outreachClaimVerified
      ? claimedOutreachStatus
      : ["sent", "delivered", "responded", "bounced", "failed"].includes(claimedOutreachStatus)
        ? "unverified_claim"
        : claimedOutreachStatus;
    const outreachEvidenceStatus = ["sent", "delivered"].includes(claimedOutreachStatus)
      ? (outreachEvidence.status || "missing")
      : claimedOutreachStatus === "responded"
        ? (evidence.status || "missing")
        : outreachStatus === "unverified_claim"
          ? (outreachEvidence.status || evidence.status || "missing")
          : "not_required";
    return {
      ...row,
      outreachStatus,
      outreachClaimStatus: claimedOutreachStatus,
      outreachEvidenceLink: outreachEvidence.ok ? outreachEvidenceLink : "",
      outreachEvidenceStatus,
      permissionStatus: blanketApprovalValid
        ? "approved_blanket"
        : requestedPermissionStatus === "approved_blanket"
          ? "approval_evidence_incomplete"
          : requestedPermissionStatus === "denied" && !permissionDeniedValid
            ? "denial_evidence_incomplete"
            : requestedPermissionStatus,
      evidenceLink: responseEvidenceValid ? evidenceLink : "",
      updatedAt: String(outreach.updated_at || "").trim(),
      restrictions: streamerPermissionRestrictions(outreach),
      priority: permissionDeniedValid ? "exclude" : row.priority,
      canPublish: false,
    };
  }));
  const priorityOrder = { policy_review_first: 0, outreach_ready: 1, human_action_required: 2, needs_verified_contact: 3, exclude: 4 };
  const outreachOrder = { sent: 0, responded: 0, delivered: 0, not_sent: 1, "": 1, bounced: 2, failed: 2 };
  const permissionLedgerRows = mergedRows.sort((a, b) => {
    const aOutreach = outreachOrder[a.outreachStatus] ?? 1;
    const bOutreach = outreachOrder[b.outreachStatus] ?? 1;
    if (aOutreach !== bOutreach) return aOutreach - bOutreach;
    const aExcluded = a.priority === "exclude" ? 1 : 0;
    const bExcluded = b.priority === "exclude" ? 1 : 0;
    if (aExcluded !== bExcluded) return aExcluded - bExcluded;
    return (priorityOrder[a.priority] - priorityOrder[b.priority])
      || a.handle.localeCompare(b.handle);
  });
  const rows = permissionLedgerRows.slice(0, 100);
  const premiumRows = permissionLedgerRows.filter((row) => row.cohort === "premium");
  const contactableRows = rows.filter((row) => row.hasVerifiedContact && !["exclude", "human_action_required"].includes(row.priority)).length;
  const excludedRows = rows.filter((row) => row.priority === "exclude").length;
  const outreachSentRows = rows.filter((row) => ["sent", "responded", "delivered"].includes(row.outreachStatus)).length;
  const responsesReceivedRows = rows.filter((row) => row.outreachStatus === "responded").length;
  const blanketApprovedRows = rows.filter((row) => row.permissionStatus === "approved_blanket").length;
  return {
    status: rows.length >= 100 ? "research_complete_outreach_review_required" : "building_100_streamer_research_pool",
    generatedAt: new Date().toISOString(),
    targetStreamers: 100,
    researchedRows: rows.length,
    remainingResearchRows: Math.max(0, 100 - rows.length),
    contactableRows,
    humanActionRequiredRows: rows.filter((row) => row.priority === "human_action_required").length,
    needsVerifiedContactRows: rows.filter((row) => row.priority === "needs_verified_contact").length,
    publicPolicyReviewRows: rows.filter((row) => row.rightsPolicy === "public_blanket_allow").length,
    excludedRows,
    outreachSentRows,
    responsesReceivedRows,
    blanketApprovedRows,
    deniedRows: rows.filter((row) => row.permissionStatus === "denied").length,
    unverifiedOutreachRows: rows.filter((row) => row.outreachStatus === "unverified_claim").length,
    sourceFiles,
    premiumRows,
    rows,
    permissionLedgerRows,
    nextAction: rows.length < 100
      ? `Complete ${100 - rows.length} more verified streamer research rows.`
      : blanketApprovedRows > 0
        ? "Use only approved creators for source review, enforce every creator restriction, and keep monitoring the remaining replies."
        : outreachSentRows >= rows.length
          ? "Monitor creator replies, save every response as local evidence, and keep all clips blocked until written permission is complete."
          : `Send the remaining ${rows.length - outreachSentRows} blanket permission requests in controlled batches and save every response as local evidence.`,
    guardrails: [
      "Research, public contact details, and sent outreach never count as permission.",
      "A public clipping policy must explicitly cover the intended TikTok and commercial use before it can become allowlist evidence.",
      "Blanket approval must be written, locally evidenced, and include TikTok, edits, monetization, future clips, credit, and revocation terms.",
      "Each published clip still requires an exact source URL, a real local source file, and Metricool approval.",
    ],
  };
}

function buildStreamer100CampaignCsv(campaign) {
  return renderCsv([
    "handle", "display_name", "creator_url", "platform", "twitch_url", "cohort", "language", "country", "category", "contact_email", "contact_url",
    "contact_evidence_url", "requires_human_verification", "rights_policy", "policy_evidence_url", "priority", "outreach_status", "outreach_claim_status", "outreach_evidence_link", "permission_status",
    "permission_scope", "evidence_link", "updated_at", "no_ai", "min_publish_delay_hours", "context_review_required",
    "creator_credit_required", "allowed_account_names", "can_publish", "risk", "reason_to_prioritize", "outreach_message",
  ], campaign.rows.map((row) => ({
    handle: workspaceSafeCsvText(row.handle),
    display_name: workspaceSafeCsvText(row.displayName),
    creator_url: workspaceSafeCsvText(row.creatorUrl),
    platform: workspaceSafeCsvText(row.platform),
    twitch_url: workspaceSafeCsvText(row.twitchUrl),
    cohort: workspaceSafeCsvText(row.cohort),
    language: workspaceSafeCsvText(row.language),
    country: workspaceSafeCsvText(row.country),
    category: workspaceSafeCsvText(row.category),
    contact_email: workspaceSafeCsvText(row.contactEmail),
    contact_url: workspaceSafeCsvText(row.contactUrl),
    contact_evidence_url: workspaceSafeCsvText(row.contactEvidenceUrl),
    requires_human_verification: row.requiresHumanVerification ? "yes" : "no",
    rights_policy: workspaceSafeCsvText(row.rightsPolicy),
    policy_evidence_url: workspaceSafeCsvText(row.policyEvidenceUrl),
    priority: workspaceSafeCsvText(row.priority),
    outreach_status: workspaceSafeCsvText(row.outreachStatus),
    outreach_claim_status: workspaceSafeCsvText(row.outreachClaimStatus),
    outreach_evidence_link: workspaceSafeCsvText(row.outreachEvidenceLink),
    permission_status: workspaceSafeCsvText(row.permissionStatus),
    permission_scope: workspaceSafeCsvText(row.permissionScope),
    evidence_link: workspaceSafeCsvText(row.evidenceLink),
    updated_at: workspaceSafeCsvText(row.updatedAt),
    no_ai: row.restrictions?.noAi ? "yes" : "no",
    min_publish_delay_hours: workspaceSafeCsvText(row.restrictions?.minimumPublishDelayHours || 0),
    context_review_required: row.restrictions?.contextReviewRequired ? "yes" : "no",
    creator_credit_required: row.restrictions?.creatorCreditRequired ? "yes" : "no",
    allowed_account_names: workspaceSafeCsvText((row.restrictions?.allowedAccountNames || []).join("|")),
    can_publish: "no",
    risk: workspaceSafeCsvText(row.risk),
    reason_to_prioritize: workspaceSafeCsvText(row.reasonToPrioritize),
    outreach_message: workspaceSafeCsvText(row.outreachMessage),
  })));
}

function renderStreamerCampaignRows(rows) {
  return rows.map((row) => `<tr><td><a href="${escapeHtml(row.creatorUrl)}">${escapeHtml(row.displayName || row.handle)}</a><div class="small">@${escapeHtml(row.handle)} / ${escapeHtml([row.platform, row.country, row.language, row.category].filter(Boolean).join(" / "))}</div></td><td>${escapeHtml(row.cohort)}</td><td>${escapeHtml(row.contactEmail || row.contactUrl || "Falta contacto verificado")}<div class="small">${row.contactEvidenceUrl ? `<a href="${escapeHtml(row.contactEvidenceUrl)}">evidencia</a>` : "sin evidencia"}</div></td><td>${escapeHtml(row.rightsPolicy)}<div class="small">${row.policyEvidenceUrl ? `<a href="${escapeHtml(row.policyEvidenceUrl)}">revisar politica</a>` : "sin politica verificable"}</div></td><td>${escapeHtml(row.priority)}<div class="small">outreach: ${escapeHtml(row.outreachStatus)} / permission: ${escapeHtml(row.permissionStatus)} / publish: blocked</div>${row.outreachEvidenceLink ? `<div class="small"><a href="${escapeHtml(row.outreachEvidenceLink)}">evidencia de envio</a></div>` : ""}${row.permissionStatus === "approved_blanket" ? `<div class="small">restricciones: ${escapeHtml([row.restrictions?.noAi ? "no AI" : "", row.restrictions?.minimumPublishDelayHours ? `${row.restrictions.minimumPublishDelayHours}h delay` : "", row.restrictions?.contextReviewRequired ? "context review" : "", row.restrictions?.creatorCreditRequired ? "credit" : ""].filter(Boolean).join(" / "))}</div>` : ""}</td></tr>`).join("");
}

function renderStreamer100CampaignPage(campaign) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Clippers 100 Streamer Campaign</title></head>
<body><main>
  <h1>Clippers 100 Streamer Campaign</h1>
  <p>Cartera verificable para conseguir permisos generales de clips comerciales en TikTok. Ninguna fila permite publicar hasta guardar aprobacion escrita.</p>
  <div class="grid">
    <div class="card"><div class="label">Investigados</div><div class="value">${escapeHtml(campaign.researchedRows)}/${escapeHtml(campaign.targetStreamers)}</div></div>
    <div class="card"><div class="label">Contacto verificado</div><div class="value">${escapeHtml(campaign.contactableRows)}</div></div>
    <div class="card"><div class="label">Solicitudes enviadas</div><div class="value">${escapeHtml(campaign.outreachSentRows)}</div></div>
    <div class="card"><div class="label">Respuestas</div><div class="value">${escapeHtml(campaign.responsesReceivedRows)}</div></div>
    <div class="card"><div class="label">Permiso general</div><div class="value">${escapeHtml(campaign.blanketApprovedRows)}</div></div>
    <div class="card"><div class="label">Denegados</div><div class="value">${escapeHtml(campaign.deniedRows)}</div></div>
    <div class="card"><div class="label">Publicables</div><div class="value">0</div></div>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/streamer-100-campaign.json", "JSON")}
    ${link("/api/clippers/streamer-100-campaign.csv", "CSV")}
    ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}
  </div>
  <div class="card"><div class="label">Siguiente paso</div><p>${escapeHtml(campaign.nextAction)}</p></div>
  <div class="card"><div class="label">Creadores premium solicitados</div><table><thead><tr><th>Creador</th><th>Cohorte</th><th>Contacto</th><th>Politica</th><th>Estado real</th></tr></thead><tbody>
    ${renderStreamerCampaignRows(campaign.premiumRows)}
  </tbody></table></div>
  <div class="card"><div class="label">Candidatos</div><table><thead><tr><th>Streamer</th><th>Cohorte</th><th>Contacto</th><th>Politica</th><th>Prioridad</th></tr></thead><tbody>
    ${renderStreamerCampaignRows(campaign.rows)}
  </tbody></table></div>
  <div class="card"><div class="label">Controles</div>${campaign.guardrails.map((item) => `<p class="small">${escapeHtml(item)}</p>`).join("")}</div>
</main></body></html>`;
}

function buildStreamerGrowthCeo(status) {
  const targetFollowers = 10_000;
  const metrics = trustedStreamerGrowthMetrics(status.streamerGrowthMetrics);
  const allowlistedCreators = Math.max(0, Number(status.streamer100Campaign?.blanketApprovedRows || 0));
  const routingProof = trustedStreamerRoutingProof(status.streamerGrowthRoutingProof);
  const rebrandConfirmed = metrics.rebrandConfirmed || routingProof.confirmed;
  const sportsMetricoolRows = Number(status.handoff?.sports || 0);
  const memesMetricoolRows = Number(status.handoff?.memes || 0);
  const routingAccountsReady = sportsMetricoolRows > 0 && memesMetricoolRows > 0;
  const progressPercent = metrics.followers === null
    ? null
    : Math.min(100, Number(((metrics.followers / targetFollowers) * 100).toFixed(2)));
  const remainingFollowers = metrics.followers === null ? null : Math.max(0, targetFollowers - metrics.followers);

  let stage = "operate_and_optimize";
  let statusLabel = "operating";
  let title = "Run the daily streamer growth loop";
  let detail = "Scout, rights-check, produce, queue in Metricool, and optimize from real 24h/72h results.";
  let primaryAction = "Open CEO growth control";
  let primaryHref = "/api/clippers/streamer-growth-ceo.html";

  if (!routingAccountsReady) {
    stage = "connect_sport_and_memes_metricool";
    statusLabel = "blocked_external_setup";
    title = "Connect SPORT and memes TikTok in Metricool";
    detail = `${sportsMetricoolRows > 0 ? "SPORT is connected" : "SPORT is missing"}; ${memesMetricoolRows > 0 ? "memes is connected" : "memes is missing"}. Both routing accounts are required for the streamer growth plan.`;
    primaryAction = "Open CEO setup checklist";
  } else if (!rebrandConfirmed) {
    stage = "rebrand_connected_accounts";
    statusLabel = "external_rebrand_required";
    title = "Rebrand the two connected TikTok accounts for streamers";
    detail = "Rename the current SPORT connection to Streamer Highlights and the current memes connection to Streamer Reactions in TikTok, then refresh Metricool. Existing followers are preserved; the content strategy becomes 100% streamers.";
    primaryAction = "Open rebrand checklist";
  } else if (!metrics.trusted) {
    stage = "capture_metricool_baseline";
    statusLabel = "baseline_required";
    title = "Import real SPORT and memes baselines from Metricool";
    detail = "Follower progress is unknown for both accounts. Do not report zero or estimate growth until Metricool provides measured follower counts and 30-day views for SPORT and memes.";
  } else if ((metrics.followers || 0) >= targetFollowers) {
    stage = "verify_monetization_eligibility";
    statusLabel = "target_reached_review_required";
    title = "Verify TikTok monetization eligibility after reaching 10K";
    detail = "The follower target is met. Confirm real 30-day views, region, personal-account status, and original 60+ second content eligibility before counting revenue.";
  } else if (allowlistedCreators < 100) {
    stage = "build_creator_allowlist";
    statusLabel = "building_supply";
    title = "Build the 100-streamer blanket permission allowlist";
    detail = `${allowlistedCreators}/100 verified creators have written blanket permission for commercial TikTok clips. Research and outreach do not count as approval.`;
    primaryHref = "/api/clippers/real-clip-permission-crm.html";
    primaryAction = "Open permission CRM";
  } else if (metrics.weeklyCandidates < 500) {
    stage = "fill_weekly_candidate_pool";
    statusLabel = "building_supply";
    title = "Fill the 500-candidate weekly streamer pool";
    detail = `${metrics.weeklyCandidates}/500 exact Twitch clips are recorded for this week. Search pages and unverifiable URLs never count.`;
    primaryHref = "/api/clippers/real-clip-source-hunt.html";
    primaryAction = "Open source hunt";
  } else if (metrics.weeklyRightsCleared < 150 || metrics.weeklyDraftReady < 100) {
    stage = "produce_weekly_streamer_batch";
    statusLabel = "building_supply";
    title = "Convert permissioned streamer clips into the 100-clip weekly batch";
    detail = `${metrics.weeklyRightsCleared}/150 rights-cleared sources and ${metrics.weeklyDraftReady}/100 final drafts are ready this week.`;
    primaryHref = "/api/clippers/real-clip-acquisition-workbench.html";
    primaryAction = "Open acquisition workbench";
  } else if (metrics.weeklyMetricoolQueued < 100) {
    stage = "queue_streamer_batch_metricool";
    statusLabel = "building_supply";
    title = "Queue the approved 100-clip streamer batch in Metricool";
    detail = `${metrics.weeklyMetricoolQueued}/100 rights-cleared drafts are in the Metricool approval queue. No queued row counts as published.`;
  }

  return {
    status: statusLabel,
    generatedAt: status.generatedAt,
    strategy: "streamer_growth_to_10k",
    account: "Streamer Highlights + Streamer Reactions",
    targetScope: "10k_followers_per_account",
    platform: "tiktok",
    publisher: "metricool",
    ceoOwnsOperations: true,
    realPublishEnabled: false,
    metricoolApprovalRequired: true,
    targetFollowers,
    currentFollowers: metrics.followers,
    remainingFollowers,
    progressPercent,
    progressKnown: metrics.trusted,
    metricsSource: metrics.source,
    measuredAt: metrics.measuredAt,
    routingConfirmation: {
      confirmed: rebrandConfirmed,
      connectionsVerified: metrics.rebrandConfirmed || routingProof.connectionsVerified,
      source: metrics.rebrandConfirmed ? "metricool" : routingProof.source,
      confirmedAt: metrics.rebrandConfirmed ? metrics.measuredAt : routingProof.confirmedAt,
      connectionsVerifiedAt: metrics.rebrandConfirmed ? metrics.measuredAt : routingProof.connectionsVerifiedAt,
      accountNames: routingProof.accountNames,
      profileUrls: routingProof.profileUrls,
    },
    views30d: metrics.views30d,
    followersByAccount: metrics.followersByAccount,
    views30dByAccount: metrics.views30dByAccount,
    published30d: metrics.published30d,
    monetizationGates: {
      followers: { target: 10_000, current: metrics.followers, met: metrics.followers === null ? null : metrics.followers >= 10_000 },
      views30d: { target: 100_000, current: metrics.views30d, met: metrics.views30d === null ? null : metrics.views30d >= 100_000 },
      originalLongForm: { target: "60+ second original high-quality videos", status: "review_required" },
      accountEligibility: { target: "eligible region, personal account, good standing", status: "external_verification_required" },
    },
    weeklyTargets: {
      discoveredClips: 2_000,
      scoredCandidates: 500,
      rightsClearedSources: 150,
      finalClips: 100,
      shortGrowthClips: 70,
      original60SecondClips: 30,
      metricoolApprovalQueue: 100,
      streamerHighlightsClips: 55,
      streamerReactionsClips: 45,
    },
    dailyTargets: [14, 14, 14, 14, 16, 14, 14],
    supply: {
      streamerMetricoolReady: routingAccountsReady,
      routingAccountsReady,
      sportsMetricoolRows,
      memesMetricoolRows,
      allowlistedCreators,
      weeklyCandidates: metrics.weeklyCandidates,
      weeklyRightsCleared: metrics.weeklyRightsCleared,
      weeklyDraftReady: metrics.weeklyDraftReady,
      weeklyMetricoolQueued: metrics.weeklyMetricoolQueued,
    },
    nextAction: {
      stage,
      title,
      detail,
      primaryAction,
      primaryHref,
    },
    accountRouting: [
      {
        account: "Streamer Highlights",
        metricoolConnectionBeforeRebrand: "SPORT",
        connected: sportsMetricoolRows > 0,
        rebrandConfirmed,
        weeklyClips: 55,
        content: "best plays, clutch moments, records, challenges, surprising skills, and high-retention streamer highlights",
      },
      {
        account: "Streamer Reactions",
        metricoolConnectionBeforeRebrand: "memes",
        connected: memesMetricoolRows > 0,
        rebrandConfirmed,
        weeklyClips: 45,
        content: "funny fails, reactions, rage moments, chat jokes, and meme-friendly streamer moments",
      },
    ],
    autonomousLoop: [
      "Scan allowlisted streamer clips and rank exact URLs by recency, views, and engagement.",
      "Reject duplicates, music risk, third-party footage, missing creator identity, and missing permission proof.",
      "Produce 70 short growth clips and 30 original 60+ second formats per week from approved sources.",
      "Prepare captions, schedules, and Metricool approval rows without claiming they are published.",
      "Import real 24h/72h metrics, stop weak formats, and increase winning hooks gradually.",
    ],
    humanGates: [
      ...(rebrandConfirmed ? [] : ["Rename the existing SPORT and memes TikTok profiles to Streamer Highlights and Streamer Reactions, then refresh Metricool."]),
      ...(metrics.trusted ? [] : ["Import the real follower and 30-day view baseline for both TikTok accounts from Metricool."]),
      "Approve each outreach batch before messages are sent to creators.",
      "Approve final Metricool publishing until real publishing is explicitly enabled.",
      "Approve paid creator deals, subscriptions, or any other spend before commitment.",
    ],
    forbidden: [
      "Buying followers, views, likes, comments, or engagement.",
      "Publishing clips without exact source and rights evidence.",
      "Counting queued, scheduled, estimated, or placeholder values as published results.",
      "Claiming Creator Rewards revenue before TikTok eligibility and real payout evidence exist.",
    ],
  };
}

function buildStreamerGrowthCeoMarkdown(ceo) {
  const followerValue = ceo.progressKnown ? String(ceo.currentFollowers) : "unknown - Metricool baseline not imported";
  return `${[
    "# Streamer Growth CEO",
    "",
    `Generated: ${ceo.generatedAt}`,
    `Status: ${ceo.status}`,
    `Strategy: ${ceo.strategy}`,
    `Account: ${ceo.account} / ${ceo.platform} via ${ceo.publisher}`,
    `Followers: ${followerValue}`,
    `Target followers: ${ceo.targetFollowers}`,
    `30-day views: ${ceo.views30d ?? "unknown"}`,
    `realPublishEnabled: ${ceo.realPublishEnabled}`,
    "",
    "## CEO Next Action",
    "",
    `- Stage: ${ceo.nextAction.stage}`,
    `- ${ceo.nextAction.title}`,
    `- ${ceo.nextAction.detail}`,
    "",
    "## Weekly Targets",
    "",
    `- Clips discovered: ${ceo.weeklyTargets.discoveredClips}`,
    `- Scored candidates: ${ceo.weeklyTargets.scoredCandidates}`,
    `- Rights-cleared sources: ${ceo.weeklyTargets.rightsClearedSources}`,
    `- Final clips: ${ceo.weeklyTargets.finalClips}`,
    `- Short growth clips: ${ceo.weeklyTargets.shortGrowthClips}`,
    `- Original 60+ second clips: ${ceo.weeklyTargets.original60SecondClips}`,
    `- Metricool approval queue: ${ceo.weeklyTargets.metricoolApprovalQueue}`,
    `- Streamer Highlights: ${ceo.weeklyTargets.streamerHighlightsClips}`,
    `- Streamer Reactions: ${ceo.weeklyTargets.streamerReactionsClips}`,
    "",
    "## Account Rebrand + Routing",
    "",
    ...ceo.accountRouting.map((row) => `- ${row.metricoolConnectionBeforeRebrand} -> ${row.account}: ${row.weeklyClips}/week; ${row.content}`),
    "",
    "## Autonomous Loop",
    "",
    ...ceo.autonomousLoop.map((row) => `- ${row}`),
    "",
    "## Human Gates",
    "",
    ...ceo.humanGates.map((row) => `- ${row}`),
    "",
    "## Forbidden",
    "",
    ...ceo.forbidden.map((row) => `- ${row}`),
    "",
  ].join("\n")}\n`;
}

function renderStreamerGrowthCeoPage(ceo) {
  const progress = ceo.progressKnown ? `${ceo.currentFollowers}/${ceo.targetFollowers}` : "Unknown";
  const progressWidth = ceo.progressKnown ? Math.max(0, Math.min(100, ceo.progressPercent || 0)) : 0;
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Streamer Growth CEO</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:28px 18px 48px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    h2{font-size:18px;margin:28px 0 8px}
    p,li{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:18px 0}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .value{font-size:24px;font-weight:800;color:#fff}
    .bar{height:10px;background:#222d38;border-radius:5px;overflow:hidden;margin-top:10px}
    .bar span{display:block;height:100%;background:#22c55e;width:${escapeHtml(progressWidth)}%}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
    .actions a{border:1px solid #365063;background:#172433;border-radius:8px;padding:10px 12px;text-decoration:none;color:#eaf7ff}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
  </style>
</head>
<body><main>
  <h1>Streamer Growth CEO</h1>
  <p>Control orgánico de dos cuentas 100% streamers hasta 10K seguidores por cuenta. El CEO prepara y optimiza; Metricool permanece en aprobación manual.</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(ceo.status)}</div></div>
    <div class="card"><div class="label">Follower Progress</div><div class="value">${escapeHtml(progress)}</div><div class="bar"><span></span></div></div>
    <div class="card"><div class="label">30-Day Views</div><div class="value">${escapeHtml(ceo.views30d ?? "Unknown")}</div></div>
    <div class="card"><div class="label">Weekly Final Clips</div><div class="value">${escapeHtml(ceo.supply.weeklyDraftReady)}/${escapeHtml(ceo.weeklyTargets.finalClips)}</div></div>
  </div>
  <div class="card">
    <div class="label">CEO next action</div>
    <p><strong>${escapeHtml(ceo.nextAction.title)}</strong></p>
    <p>${escapeHtml(ceo.nextAction.detail)}</p>
    <p><code>${escapeHtml(ceo.nextAction.stage)}</code></p>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/streamer-growth-ceo.json", "CEO JSON")}
    ${link("/api/clippers/streamer-growth-ceo.md", "CEO report")}
    ${link(ceo.nextAction.primaryHref, ceo.nextAction.primaryAction)}
  </div>
  <h2>Weekly operating targets</h2>
  <table><thead><tr><th>Stage</th><th>Current</th><th>Target</th></tr></thead><tbody>
    <tr><td>Allowlisted creators</td><td>${escapeHtml(ceo.supply.allowlistedCreators)}</td><td>100 blanket approvals</td></tr>
    <tr><td>Exact scored candidates</td><td>${escapeHtml(ceo.supply.weeklyCandidates)}</td><td>${escapeHtml(ceo.weeklyTargets.scoredCandidates)}</td></tr>
    <tr><td>Rights-cleared sources</td><td>${escapeHtml(ceo.supply.weeklyRightsCleared)}</td><td>${escapeHtml(ceo.weeklyTargets.rightsClearedSources)}</td></tr>
    <tr><td>Final drafts</td><td>${escapeHtml(ceo.supply.weeklyDraftReady)}</td><td>${escapeHtml(ceo.weeklyTargets.finalClips)}</td></tr>
    <tr><td>Metricool approval queue</td><td>${escapeHtml(ceo.supply.weeklyMetricoolQueued)}</td><td>${escapeHtml(ceo.weeklyTargets.metricoolApprovalQueue)}</td></tr>
  </tbody></table>
  <h2>Account rebrand + routing</h2>
  <table><thead><tr><th>Current connection</th><th>Streamer brand</th><th>Clips/week</th><th>Content</th></tr></thead><tbody>
    ${ceo.accountRouting.map((row) => `<tr><td>${escapeHtml(row.metricoolConnectionBeforeRebrand)}</td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.weeklyClips)}</td><td>${escapeHtml(row.content)}</td></tr>`).join("")}
  </tbody></table>
  <h2>CEO autonomous loop</h2><ol>${ceo.autonomousLoop.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ol>
  <h2>Human approval gates</h2><ul>${ceo.humanGates.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>
  <h2>Never allowed</h2><ul>${ceo.forbidden.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>
</main></body></html>`;
}

function buildGoLiveGapResolver(status) {
  const intake = status.realClipIntakeValidation || {};
  const gap = status.realClipGap || {};
  const metricool = status.metricoolMvp || {};
  const externalValidation = status.externalEvidenceValidation || {};
  const rows = [
    {
      id: "metricool_tiktok_accounts",
      label: "SPORT + memes TikTok in Metricool",
      status: metricool.status === "metricool_mvp_ready" && Number(metricool.activeReadyLanes || 0) >= Number(metricool.activeTargetLanes || 2)
        ? "ready"
        : "needs_metricool_connection",
      requiredForCurrentMvp: true,
      count: `${metricool.activeReadyLanes || 0}/${metricool.activeTargetLanes || 2}`,
      blocker: "",
      nextAction: metricool.status === "metricool_mvp_ready"
        ? "Keep using Metricool approval_required for TikTok only."
        : "Connect SPORT and memes TikTok profiles inside Metricool and record evidence.",
    },
    {
      id: "real_clip_intake",
      label: "Approved real TikTok clips",
      status: realClipIntakeReadyForScheduling(intake.status) ? "ready" : "blocked",
      requiredForCurrentMvp: true,
      count: `${intake.readyRows || 0}/${intake.totalRows || 0}`,
      blocker: Number(intake.blockedRows || 0) ? `${intake.blockedRows} rows missing real source file, exact URL, rights proof, or manifest values` : "",
      nextAction: realClipIntakeReadyForScheduling(intake.status)
        ? "Run source-drop Metricool refresh before scheduling."
        : "Use Source Hunt, Permission CRM, and Real Clip Intake to replace every placeholder with approved real clips.",
    },
    {
      id: "placeholder_upload_pack",
      label: "Placeholder upload pack lock",
      status: realClipIntakeReadyForScheduling(intake.status) && Number(gap.generatedOwnedRows || 0) === 0 ? "ready" : "blocked",
      requiredForCurrentMvp: true,
      count: `${gap.realClipRows || 0}/${gap.totalRows || 0}`,
      blocker: Number(gap.generatedOwnedRows || 0)
        ? `${gap.generatedOwnedRows} generated placeholder assets in current upload pack`
        : realClipIntakeReadyForScheduling(intake.status) ? "" : "Current upload pack has not passed real clip intake validation",
      nextAction: realClipIntakeReadyForScheduling(intake.status) && Number(gap.generatedOwnedRows || 0) === 0
        ? "Upload pack contains validated source rows; continue with the Metricool approval queue."
        : "Do not schedule the upload pack until it is regenerated from real approved source files and intake validation passes.",
    },
    {
      id: "direct_social_apis",
      label: "Direct TikTok/IG/YT APIs",
      status: "deferred_not_required",
      requiredForCurrentMvp: false,
      count: "0 required",
      blocker: "",
      nextAction: "Do not request direct social API keys for this Metricool MVP unless Robert changes launch mode.",
    },
    {
      id: "other_platform_accounts",
      label: "Instagram + YouTube + streamer account expansion",
      status: "deferred_not_required",
      requiredForCurrentMvp: false,
      count: `${status.deferredOtherPlatformRows || 0} rows`,
      blocker: "",
      nextAction: "Keep parked until TikTok MVP has real clips, Metricool proof, and live metrics.",
    },
    {
      id: "external_evidence_backlog",
      label: "External account/permission evidence backlog",
      status: Number(externalValidation.activeRepairRows || 0) > 0 ? "blocked" : "deferred_or_clean",
      requiredForCurrentMvp: Number(externalValidation.activeRepairRows || 0) > 0,
      count: `${externalValidation.activeRepairRows ?? 0} active / ${externalValidation.deferredRepairRows ?? 0} deferred`,
      blocker: Number(externalValidation.activeRepairRows || 0) ? "Active MVP evidence repair rows remain" : "",
      nextAction: Number(externalValidation.activeRepairRows || 0)
        ? "Repair the active evidence rows before go-live."
        : "Deferred evidence rows are not required for the current TikTok Metricool MVP.",
    },
    {
      id: "metricool_scheduled_proof",
      label: "Metricool scheduled proof",
      status: Number(status.evidence?.missingApproval || 0) > 0 ? "locked" : "ready",
      requiredForCurrentMvp: true,
      count: `${Number(status.evidence?.rows || 0) - Number(status.evidence?.missingApproval || 0)}/${status.evidence?.rows || 0}`,
      blocker: Number(status.evidence?.missingApproval || 0) ? "Locked until real clip intake is ready and rows are scheduled in Metricool" : "",
      nextAction: Number(status.evidence?.missingApproval || 0)
        ? "Do not record scheduled proof until real approved clips replace placeholders."
        : "Wait for public TikTok URLs and 24h metrics.",
    },
  ];
  const blockingRows = rows.filter((row) => row.requiredForCurrentMvp && !["ready", "deferred_or_clean"].includes(row.status));
  const statusLabel = blockingRows.length ? "blocked_real_clip_intake" : "ready_for_metricool_approval_queue";
  return {
    status: statusLabel,
    generatedAt: status.generatedAt,
    scope: "tiktok_metricool_mvp_go_live_gap_resolver",
    currentMvp: "TikTok only via Metricool approval_required",
    canScheduleMetricool: statusLabel === "ready_for_metricool_approval_queue",
    realPublishEnabled: status.realPublishEnabled === true,
    realPublishAllowed: false,
    summary: blockingRows.length
      ? "Current MVP is structurally ready for TikTok + Metricool, but cannot schedule because approved real clip intake is incomplete."
      : "Current MVP can move to Metricool approval queue; keep realPublishEnabled=false.",
    nextAction: blockingRows[0]?.nextAction || "Open Metricool approval queue and record proof after scheduling.",
    blockers: blockingRows.map((row) => row.id),
    rows,
    links: {
      sourceHunt: `${localOrigin()}/api/clippers/real-clip-source-hunt.html`,
      permissionCrm: `${localOrigin()}/api/clippers/real-clip-permission-crm.html`,
      realClipIntake: `${localOrigin()}/api/clippers/real-clip-intake.html`,
      realClipValidation: `${localOrigin()}/api/clippers/real-clip-intake-validation.html`,
      sourceDropRefresh: `${localOrigin()}/api/clippers/source-drop-metricool-refresh.html`,
      dashboard: `${localOrigin()}/clippers`,
    },
  };
}

function buildGoLiveGapResolverCsv(resolver) {
  return renderCsv([
    "id",
    "label",
    "status",
    "required_for_current_mvp",
    "count",
    "blocker",
    "next_action",
  ], (resolver.rows || []).map((row) => ({
    id: row.id,
    label: row.label,
    status: row.status,
    required_for_current_mvp: row.requiredForCurrentMvp ? "yes" : "no",
    count: row.count,
    blocker: row.blocker,
    next_action: row.nextAction,
  })));
}

function buildGoLiveGapResolverMarkdown(resolver) {
  const lines = [
    "# Clippers Go-Live Gap Resolver",
    "",
    `Generated: ${resolver.generatedAt}`,
    `Scope: ${resolver.scope}`,
    `Status: ${resolver.status}`,
    `Current MVP: ${resolver.currentMvp}`,
    `Can schedule Metricool: ${resolver.canScheduleMetricool ? "yes" : "no"}`,
    `realPublishEnabled: ${resolver.realPublishEnabled}`,
    "",
    "## Summary",
    "",
    resolver.summary,
    "",
    "## Next Action",
    "",
    resolver.nextAction,
    "",
    "## Rows",
    "",
    "| ID | Status | Required | Count | Blocker | Next action |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(resolver.rows || []).map((row) => `| ${[
      row.id,
      row.status,
      row.requiredForCurrentMvp ? "yes" : "no",
      row.count,
      row.blocker || "none",
      row.nextAction,
    ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
    "",
    "## Links",
    "",
    `- Source Hunt: ${resolver.links.sourceHunt}`,
    `- Permission CRM: ${resolver.links.permissionCrm}`,
    `- Real Clip Intake: ${resolver.links.realClipIntake}`,
    `- Real Clip Validation: ${resolver.links.realClipValidation}`,
    `- Source-Drop Refresh: ${resolver.links.sourceDropRefresh}`,
    `- Dashboard: ${resolver.links.dashboard}`,
    "",
    "Guardrail: do not count templates, placeholders, screenshots with secrets, or search URLs as permissioned clips.",
  ];
  return `${lines.join("\n")}\n`;
}

function renderGoLiveGapResolverPage(resolver) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Go-Live Gap Resolver</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:1040px;margin:0 auto;padding:28px 18px 48px}
    h1{font-size:30px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    a{color:#85d7ff}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:18px 0}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .value{font-size:24px;font-weight:800;color:#fff}
    .actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
    .actions a{border:1px solid #365063;background:#172433;border-radius:8px;padding:10px 12px;text-decoration:none;color:#eaf7ff}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{border-top:1px solid #293644;padding:9px 8px;text-align:left;vertical-align:top}
    th{color:#9fb0c4;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{color:#edf6ff}
    .small{font-size:12px;color:#9fb0c4}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
  </style>
</head>
<body>
<main>
  <h1>Clippers Go-Live Gap Resolver</h1>
  <p>${escapeHtml(resolver.summary)}</p>
  <div class="grid">
    <div class="card"><div class="label">Status</div><div class="value">${escapeHtml(resolver.status)}</div></div>
    <div class="card"><div class="label">Can Schedule Metricool</div><div class="value">${escapeHtml(resolver.canScheduleMetricool ? "yes" : "no")}</div></div>
    <div class="card"><div class="label">Real Publish</div><div class="value">${escapeHtml(resolver.realPublishAllowed ? "allowed" : "off")}</div></div>
  </div>
  <div class="card">
    <div class="label">Next action</div>
    <p>${escapeHtml(resolver.nextAction)}</p>
  </div>
  <div class="actions">
    ${link("/clippers", "Dashboard")}
    ${link("/api/clippers/go-live-gap-resolver.json", "JSON")}
    ${link("/api/clippers/go-live-gap-resolver.md", "Markdown")}
    ${link("/api/clippers/go-live-gap-resolver.csv", "CSV")}
    ${link("/api/clippers/real-clip-source-hunt.html", "Source Hunt")}
    ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}
    ${link("/api/clippers/real-clip-intake.html", "Real Clip Intake")}
    ${link("/api/clippers/source-drop-metricool-refresh.html", "Source-Drop Refresh")}
  </div>
  <table>
    <thead><tr><th>Gap</th><th>Status</th><th>Required</th><th>Count</th><th>Blocker</th><th>Next Action</th></tr></thead>
    <tbody>
      ${(resolver.rows || []).map((row) => `<tr>
        <td><code>${escapeHtml(row.id)}</code><div class="small">${escapeHtml(row.label)}</div></td>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.requiredForCurrentMvp ? "yes" : "no")}</td>
        <td>${escapeHtml(row.count)}</td>
        <td>${escapeHtml(row.blocker || "none")}</td>
        <td>${escapeHtml(row.nextAction)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</main>
</body>
</html>`;
}

function buildMetricoolOperatorBrief(status) {
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow;
  const deadlineQueue = metricoolDeadlineQueue(status);
  const intakeBlocked = status.status === "blocked_real_clip_intake";
  const lines = [
    "# Clippers TikTok Metricool Operator Brief",
    "",
    `Generated: ${status.generatedAt}`,
    `Batch: ${status.batchId}`,
    `Mode: TikTok only via Metricool approval_required`,
    `Goal complete: ${status.goalReadinessAudit?.complete ? "yes" : "no"}`,
    "",
    "## Guardrails",
    "",
    `- realPublishEnabled: ${status.realPublishEnabled}`,
    `- metricoolApprovalRequired: ${status.metricoolApprovalRequired}`,
    "- Do not paste public TikTok URLs or 24h metrics until the post is live.",
    "- Do not use direct TikTok/Instagram/YouTube APIs for this MVP.",
    "",
    "## Current Status",
    "",
    `- Operator checklist: ${status.metricoolOperatorChecklist?.status || "unknown"}`,
    `- Missing Metricool scheduled proof: ${status.evidence?.missingApproval ?? "n/a"}`,
    `- Deferred non-TikTok rows: ${status.deferredOtherPlatformRows || 0}`,
    `- Run sheet: ${status.metricoolSchedulingRunSheet?.status || "unknown"}`,
    `- Upload pack: ${status.uploadPackIntegrity?.status || "unknown"} (${status.uploadPackIntegrity?.readyFiles || 0}/${status.uploadPackIntegrity?.totalRows || 0} files ready)`,
    `- Audit events: ${status.operatorAudit?.events || 0} (${status.operatorAudit?.accepted || 0} accepted, ${status.operatorAudit?.rejected || 0} rejected)`,
    `- Schedule window: ${status.operatorSummary?.scheduleWindowLabel || "n/a"} (${status.operatorSummary?.leadMinutes ?? "n/a"} lead minutes)`,
    `- Needs roll-forward: ${status.operatorSummary?.needsRollForward ? "yes" : "no"}`,
    `- Ready to schedule now: ${!intakeBlocked && status.metricoolOperatorChecklist?.status === "ready_for_metricool_operator" && !status.operatorSummary?.needsRollForward && status.uploadPackIntegrity?.status === "ready" && Number(status.evidence?.missingApproval || 0) > 0 ? "yes" : "no"}`,
    "",
    intakeBlocked ? "## Next Real Clip Intake Action" : "## Next Metricool Action",
    "",
  ];
  if (intakeBlocked) {
    lines.push(
      `- Queue item: ${status.nextBestAction?.queueItemId || nextRow?.queueItemId || ""}`,
      `- Brand: ${status.nextBestAction?.brand || nextRow?.metricoolBrandName || ""}`,
      `- Account: ${status.nextBestAction?.accountName || nextRow?.accountName || ""}`,
      "",
      "Do not schedule this batch in Metricool yet. Replace placeholders with approved real TikTok clips, complete exact URLs, local MP4 files, rights evidence, and source-drop manifests, then refresh the Metricool batch.",
    );
  } else if (nextRow) {
    lines.push(
      `- Queue item: ${nextRow.queueItemId}`,
      `- Brand: ${nextRow.metricoolBrandName}`,
      `- Account: ${nextRow.accountName}`,
      `- Platform: ${nextRow.platform}`,
      `- Publish local: ${nextRow.publishAtLocal || nextRow.publishAt}`,
      `- Publish ISO: ${nextRow.publishAt}`,
      `- File: ${nextRow.uploadFileName}`,
      `- Caption: ${nextRow.captionSeed}`,
      `- Scheduled proof note: ${nextRow.scheduledNoteTemplate}`,
      "",
      "After scheduling this row in Metricool, paste the real Metricool planner URL into the local operator.",
    );
  } else {
    lines.push("No scheduled-proof row is currently pending. Wait for public TikTok URLs and real 24h metrics.");
  }
  if (deadlineQueue.length) {
    lines.push(
      "",
      "## Deadline Queue",
      "",
      "| Order | Queue item | Brand | Account | Publish local | File | Caption | Proof note |",
      "| ---: | --- | --- | --- | --- | --- | --- | --- |",
      ...deadlineQueue.map((row) => [
        row.order,
        row.queueItemId,
        row.brand,
        row.accountName,
        row.publishAtLocal || row.publishAt,
        row.uploadFileName,
        row.captionSeed,
        row.scheduledNoteTemplate,
      ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")).map((line) => `| ${line} |`),
    );
  }
  lines.push(
    "",
    "## Local Links",
    "",
    `- Operator UI: ${localOrigin()}/clippers`,
    `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    `- Operator report: ${localOrigin()}/api/clippers/operator-report.md`,
    `- Upload checklist CSV: ${localOrigin()}/api/clippers/metricool-upload-checklist.csv`,
    `- Scheduled proof starter CSV: ${localOrigin()}/api/clippers/scheduled-proof-starter.csv`,
    `- Next scheduled proof CSV: ${localOrigin()}/api/clippers/next-scheduled-proof-starter.csv`,
    `- Published metrics starter CSV: ${localOrigin()}/api/clippers/published-metrics-starter.csv`,
    `- Next published metrics CSV: ${localOrigin()}/api/clippers/next-published-metrics-starter.csv`,
    `- Upload pack: ${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
    "",
    "## Next Steps",
    "",
    ...(intakeBlocked
      ? [
        "1. Open real clip intake.",
        "2. Add approved real TikTok MP4 files, exact post URLs, source names, rights evidence, and concrete notes.",
        "3. Refresh the Metricool batch only after every row is ready_for_source_drop_import.",
        "4. Do not schedule placeholder MP4 files.",
      ]
      : [
        "1. Open the upload pack.",
        "2. Schedule rows in Metricool in deadline order.",
        "3. For each scheduled row, save the real Metricool planner URL in the local operator.",
        "4. Wait until posts are live before recording public TikTok URLs and 24h metrics.",
      ]),
  );
  return `${lines.join("\n")}\n`;
}

function buildMetricoolOperatorReport(status) {
  const action = status.nextBestAction || {};
  const queue = metricoolDeadlineQueue(status, { limit: 3 });
  const lines = [
    "# Clippers TikTok Metricool Report",
    "",
    `Generated: ${status.generatedAt}`,
    `Mode: TikTok only via Metricool`,
    `Status: ${status.goalReadinessAudit?.status || "unknown"}`,
    `Goal complete: ${status.goalReadinessAudit?.complete ? "yes" : "no"}`,
    "",
    "## Next Best Action",
    "",
    `- Stage: ${action.stage || "unknown"}`,
    `- Action: ${action.title || "Review operator"}`,
    `- Detail: ${action.detail || ""}`,
    `- Queue item: ${action.queueItemId || "n/a"}`,
    `- Brand/account: ${[action.brand, action.accountName].filter(Boolean).join(" / ") || "n/a"}`,
    action.primaryHref ? `- Link: ${localOrigin()}${action.primaryHref}` : "",
    "",
    "## Progress",
    "",
    `- Metricool scheduled proof missing: ${status.evidence?.missingApproval ?? "n/a"}`,
    `- Public metrics status: ${status.publicMetricsRunSheet?.status || "unknown"}`,
    `- Upload pack: ${status.uploadPackIntegrity?.status || "unknown"} (${status.uploadPackIntegrity?.readyFiles || 0}/${status.uploadPackIntegrity?.totalRows || 0} files ready, missing ${status.uploadPackIntegrity?.missingFiles || 0}, zero-byte ${status.uploadPackIntegrity?.zeroByteFiles || 0})`,
    `- Schedule window: ${status.operatorSummary?.scheduleWindowLabel || "unknown"} (${status.operatorSummary?.leadMinutes ?? "n/a"} lead minutes, roll-forward ${status.operatorSummary?.needsRollForward ? "needed" : "not needed"})`,
    `- Auto roll-forward threshold: ${status.watchdog?.enabled ? `${status.watchdog.thresholdMinutes} min (${status.watchdog.minutesUntilAutoRollForward ?? "n/a"} min until threshold)` : "disabled"}`,
    `- Public metrics pending: ${status.publicMetricsRunSheet?.pendingRows || 0}`,
    `- Ready for import preview: ${status.evidence?.readyForImportPreview || 0}`,
    `- Deferred non-TikTok rows: ${status.deferredOtherPlatformRows || 0}`,
    "",
    "## Guardrails",
    "",
    `- realPublishEnabled: ${status.realPublishEnabled}`,
    `- metricoolApprovalRequired: ${status.metricoolApprovalRequired}`,
    "- Direct social APIs: deferred for this MVP",
    "- Do not enter public TikTok URLs or metrics until the post is live and numbers are real.",
    "",
    "## Next Deadline Rows",
    "",
  ].filter((line) => line !== "");
  if (queue.length) {
    lines.push(
      "| Order | Queue item | Brand | Account | Publish local | File |",
      "| ---: | --- | --- | --- | --- | --- |",
      ...queue.map((row) => `| ${[
        row.order,
        row.queueItemId,
        row.brand,
        row.accountName,
        row.publishAtLocal || row.publishAt,
        row.uploadFileName,
      ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
    );
  } else {
    lines.push("No active deadline rows.");
  }
  lines.push(
    "",
    "## Links",
    "",
    `- Operator UI: ${localOrigin()}/clippers`,
    `- Ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    `- Next Metricool action: ${localOrigin()}/api/clippers/next-metricool-action.md`,
    `- Upload pack: ${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
    `- Scheduled proof CSV: ${localOrigin()}/api/clippers/scheduled-proof-starter.csv`,
    `- Next scheduled proof CSV: ${localOrigin()}/api/clippers/next-scheduled-proof-starter.csv`,
    `- Published metrics CSV: ${localOrigin()}/api/clippers/published-metrics-starter.csv`,
    `- Next published metrics CSV: ${localOrigin()}/api/clippers/next-published-metrics-starter.csv`,
  );
  return `${lines.join("\n")}\n`;
}

function buildNextMetricoolActionPacket(status) {
  const action = status.nextBestAction || {};
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const lines = [
    "# Clippers Next Metricool Action",
    "",
    `Generated: ${status.generatedAt}`,
    `Stage: ${action.stage || "unknown"}`,
    `realPublishEnabled: ${status.realPublishEnabled}`,
    `metricoolApprovalRequired: ${status.metricoolApprovalRequired}`,
    "",
  ];
  if (!nextRow || action.stage !== "schedule_in_metricool") {
    lines.push(
      "## Status",
      "",
      action.title || "No Metricool scheduling row is currently pending.",
      "",
      action.detail || status.metricoolSchedulingRunSheet?.nextAction || "",
      "",
      "## Links",
      "",
      `- Operator UI: ${localOrigin()}/clippers`,
      `- Current TikTok account now: ${localOrigin()}/api/clippers/tiktok-current-account-now.html`,
      `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    );
    return `${lines.join("\n")}\n`;
  }
  if (status.nextBestAction?.stage && status.nextBestAction.stage !== "schedule_in_metricool") {
    lines.push(
      "## Blocked",
      "",
      status.nextBestAction.title || "Current TikTok row is blocked.",
      "",
      status.nextBestAction.detail || "Resolve the current gate before scheduling in Metricool.",
      "",
      "## Links",
      "",
      `- Dashboard: ${localOrigin()}/clippers`,
      `- Real clip intake: ${localOrigin()}/api/clippers/real-clip-intake.html`,
      `- Real clip validation: ${localOrigin()}/api/clippers/real-clip-intake-validation.html`,
      `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    );
    return `${lines.join("\n")}\n`;
  }
  if (status.nextBestAction?.stage && status.nextBestAction.stage !== "schedule_in_metricool") {
    lines.push(
      "## Blocked",
      "",
      status.nextBestAction.title || "Current TikTok row is blocked.",
      "",
      status.nextBestAction.detail || "Resolve the current gate before scheduling in Metricool.",
      "",
      "## Links",
      "",
      `- Dashboard: ${localOrigin()}/clippers`,
      `- Real clip intake: ${localOrigin()}/api/clippers/real-clip-intake.html`,
      `- Real clip validation: ${localOrigin()}/api/clippers/real-clip-intake-validation.html`,
      `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "## Schedule This Row",
    "",
    `- Queue item: ${nextRow.queueItemId}`,
    `- Brand: ${nextRow.metricoolBrandName}`,
    `- Account: ${nextRow.accountName}`,
    `- Platform: ${nextRow.platform}`,
    `- Publish local: ${nextRow.publishAtLocal || nextRow.publishAt}`,
    `- Publish ISO: ${nextRow.publishAt}`,
    `- Lead minutes: ${nextRow.leadMinutes ?? status.operatorSummary?.leadMinutes ?? "n/a"}`,
    `- Schedule window: ${status.operatorSummary?.scheduleWindowLabel || "unknown"} (${status.operatorSummary?.scheduleWindowStatus || "unknown"})`,
    `- Roll-forward needed: ${status.operatorSummary?.needsRollForward ? "yes" : "no"}`,
    `- Upload file: ${nextRow.uploadFileName}`,
    `- Caption: ${nextRow.captionSeed}`,
    `- Proof note: ${nextRow.scheduledNoteTemplate}`,
    "",
    "## Do In Metricool",
    "",
    "1. Open the upload pack.",
    `2. Upload ${nextRow.uploadFileName} to ${nextRow.metricoolBrandName} / ${nextRow.accountName}.`,
    `3. Use publish time ${nextRow.publishAtLocal || nextRow.publishAt}.`,
    "4. Save/schedule it in Metricool approval_required mode.",
    "5. Copy the real Metricool planner URL.",
    "6. Paste that real planner URL into Save scheduled proof for this exact queue item.",
    "",
    "## Guardrails",
    "",
    "- Do not paste TikTok public URLs until the post is live.",
    "- Do not enter views, likes, comments, or shares until 24h metrics are real.",
    "- Do not use direct TikTok/Instagram/YouTube APIs for this MVP.",
    "- This packet is read-only and contains no real planner proof.",
    "",
    "## Links",
    "",
    `- Operator UI: ${localOrigin()}/clippers`,
    `- Current TikTok account now: ${localOrigin()}/api/clippers/tiktok-current-account-now.html`,
    `- Upload pack: ${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
    nextRow.uploadFileUrl ? `- Direct MP4: ${localOrigin()}${nextRow.uploadFileUrl}` : "",
    `- Next scheduled proof CSV: ${localOrigin()}/api/clippers/next-scheduled-proof-starter.csv`,
    `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
  );
  return `${lines.filter((line) => line !== "").join("\n")}\n`;
}

function buildCurrentTikTokActionPacket(status) {
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const lines = [
    "# Clippers Current TikTok Action",
    "",
    `Generated: ${status.generatedAt}`,
    "Scope: TikTok only via Metricool",
    `realPublishEnabled: ${status.realPublishEnabled}`,
    `metricoolApprovalRequired: ${status.metricoolApprovalRequired}`,
    "",
  ];
  if (!nextRow) {
    lines.push(
      "## Status",
      "",
      "No current TikTok scheduling row is pending.",
      "",
      "## Links",
      "",
      `- Dashboard: ${localOrigin()}/clippers`,
      `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    );
    return `${lines.join("\n")}\n`;
  }
  if (status.nextBestAction?.stage && status.nextBestAction.stage !== "schedule_in_metricool") {
    lines.push(
      "## Blocked",
      "",
      status.nextBestAction.title || "Current TikTok row is blocked.",
      "",
      status.nextBestAction.detail || "Resolve the current gate before scheduling in Metricool.",
      "",
      "## Links",
      "",
      `- Dashboard: ${localOrigin()}/clippers`,
      `- Real clip intake: ${localOrigin()}/api/clippers/real-clip-intake.html`,
      `- Real clip validation: ${localOrigin()}/api/clippers/real-clip-intake-validation.html`,
      `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    "## Current Row",
    "",
    `- Queue item: ${nextRow.queueItemId}`,
    `- Brand: ${nextRow.metricoolBrandName}`,
    `- Account: ${nextRow.accountName}`,
    `- Platform: ${nextRow.platform}`,
    `- Publish local: ${nextRow.publishAtLocal || nextRow.publishAt}`,
    `- Publish ISO: ${nextRow.publishAt}`,
    `- Upload file: ${nextRow.uploadFileName}`,
    `- Caption: ${nextRow.captionSeed}`,
    `- Proof note: ${nextRow.scheduledNoteTemplate}`,
    `- Roll-forward needed: ${status.operatorSummary?.needsRollForward ? "yes" : "no"}`,
    "",
    "## Do Now",
    "",
    "1. Open Current TikTok now.",
    "2. Upload the file shown for the current account in Metricool.",
    "3. Keep Metricool in approval_required mode.",
    "4. Copy the real Metricool planner URL after scheduling.",
    "5. Use Current proof CSV or the preview form to save scheduled proof.",
    "",
    "## Links",
    "",
    `- Dashboard: ${localOrigin()}/clippers`,
    `- Current TikTok now: ${localOrigin()}/api/clippers/tiktok-current-account-now.html`,
    `- Current video MP4: ${localOrigin()}/api/clippers/tiktok-current-video.mp4`,
    `- Current upload CSV: ${localOrigin()}/api/clippers/tiktok-current-next-upload-checklist.csv`,
    `- Current proof CSV: ${localOrigin()}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`,
    `- Current caption TXT: ${localOrigin()}/api/clippers/tiktok-current-caption.txt`,
    `- Upload pack: ${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
    `- Operator ready JSON: ${localOrigin()}/api/clippers/operator-ready.json`,
    "",
    "## Guardrails",
    "",
    "- This packet is read-only.",
    "- Do not paste TikTok public URLs until the post is live.",
    "- Do not enter views, likes, comments, or shares until 24h metrics are real.",
    "- This packet does not include real Metricool planner proof or public TikTok URLs.",
  );
  return `${lines.join("\n")}\n`;
}

function buildCurrentTikTokActionJson(status) {
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const scheduleReady = Boolean(nextRow && status.nextBestAction?.stage === "schedule_in_metricool");
  const safeMissingField = (field) => ({
    metricool_approval_url: "scheduled_proof",
    published_post_url: "public_tiktok_url",
  }[field] || field);
  return {
    status: nextRow ? (scheduleReady ? "schedule_in_metricool" : status.nextBestAction?.stage || "current_tiktok_blocked") : "no_current_tiktok_row",
    generatedAt: status.generatedAt,
    scope: "tiktok_metricool_current_action",
    tiktokOnly: status.tiktokOnly,
    realPublishEnabled: status.realPublishEnabled,
    metricoolApprovalRequired: status.metricoolApprovalRequired,
    scheduleReady,
    queueItemId: nextRow?.queueItemId || "",
    brand: nextRow?.metricoolBrandName || "",
    accountName: nextRow?.accountName || "",
    accountId: nextRow?.accountId || "",
    platform: nextRow?.platform || "",
    publishAtLocal: nextRow ? (nextRow.publishAtLocal || nextRow.publishAt) : "",
    publishAt: nextRow?.publishAt || "",
    uploadFileName: nextRow?.uploadFileName || "",
    uploadFileUrl: nextRow?.uploadFileUrl || "",
    captionSeed: nextRow?.captionSeed || "",
    scheduledNoteTemplate: nextRow?.scheduledNoteTemplate || "",
    scheduleWindow: {
      status: status.operatorSummary?.scheduleWindowStatus || "unknown",
      label: status.operatorSummary?.scheduleWindowLabel || "unknown",
      leadMinutes: status.operatorSummary?.leadMinutes ?? null,
      needsRollForward: status.operatorSummary?.needsRollForward === true,
      action: status.operatorSummary?.scheduleWindowAction || "",
    },
    row: nextRow ? {
      queueItemId: nextRow.queueItemId,
      rank: nextRow.rank,
      brand: nextRow.metricoolBrandName,
      accountName: nextRow.accountName,
      accountId: nextRow.accountId,
      platform: nextRow.platform,
      publishAtLocal: nextRow.publishAtLocal || nextRow.publishAt,
      publishAt: nextRow.publishAt,
      uploadFileName: nextRow.uploadFileName,
      uploadFileUrl: nextRow.uploadFileUrl || "",
      captionSeed: nextRow.captionSeed,
      scheduledNoteTemplate: nextRow.scheduledNoteTemplate,
      evidenceState: nextRow.evidenceState,
      missingFields: (nextRow.evidenceMissingFields || []).map(safeMissingField),
    } : null,
    nextAction: nextRow
      ? (scheduleReady
        ? "Open Current TikTok now, schedule the clip in Metricool approval_required mode, then save real planner proof."
        : (status.nextBestAction?.detail || "Resolve the current blocker before scheduling in Metricool."))
      : "No current TikTok scheduling row is pending.",
    links: {
      dashboard: `${localOrigin()}/clippers`,
      currentTikTokNow: `${localOrigin()}/api/clippers/tiktok-current-account-now.html`,
      currentTikTokMarkdown: `${localOrigin()}/api/clippers/tiktok-current-action.md`,
      currentCaptionTxt: `${localOrigin()}/api/clippers/tiktok-current-caption.txt`,
      currentVideoMp4: `${localOrigin()}/api/clippers/tiktok-current-video.mp4`,
      currentUploadCsv: `${localOrigin()}/api/clippers/tiktok-current-next-upload-checklist.csv`,
      currentProofCsv: `${localOrigin()}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`,
      uploadPack: `${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
      operatorReadyJson: `${localOrigin()}/api/clippers/operator-ready.json`,
    },
    guardrails: [
      "Use Metricool only for this TikTok MVP.",
      "Metricool stays approval_required.",
      "realPublishEnabled=false.",
      "Do not paste TikTok public URLs until the post is live.",
      "Do not enter views, likes, comments, or shares until 24h metrics are real.",
      "This JSON does not include real Metricool planner proof or public TikTok URLs.",
    ],
  };
}

function buildNextMetricoolActionJson(status) {
  const action = status.nextBestAction || {};
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const scheduleReady = Boolean(nextRow && action.stage === "schedule_in_metricool");
  return {
    status: scheduleReady ? "schedule_in_metricool" : (action.stage || status.metricoolSchedulingRunSheet?.status || "unknown"),
    generatedAt: status.generatedAt,
    tiktokOnly: status.tiktokOnly,
    realPublishEnabled: status.realPublishEnabled,
    metricoolApprovalRequired: status.metricoolApprovalRequired,
    scheduleReady,
    queueItemId: scheduleReady ? nextRow.queueItemId : "",
    brand: scheduleReady ? nextRow.metricoolBrandName : "",
    accountName: scheduleReady ? nextRow.accountName : "",
    platform: scheduleReady ? nextRow.platform : "",
    publishAtLocal: scheduleReady ? (nextRow.publishAtLocal || nextRow.publishAt) : "",
    publishAt: scheduleReady ? nextRow.publishAt : "",
    uploadFileName: scheduleReady ? nextRow.uploadFileName : "",
    uploadFileUrl: scheduleReady ? (nextRow.uploadFileUrl || "") : "",
    captionSeed: scheduleReady ? nextRow.captionSeed : "",
    scheduledNoteTemplate: scheduleReady ? nextRow.scheduledNoteTemplate : "",
    action: {
      stage: action.stage || "unknown",
      title: action.title || "",
      detail: action.detail || status.metricoolSchedulingRunSheet?.nextAction || "",
      primaryAction: action.primaryAction || "",
      primaryHref: action.primaryHref || "",
    },
    scheduleWindow: {
      status: status.operatorSummary?.scheduleWindowStatus || "unknown",
      label: status.operatorSummary?.scheduleWindowLabel || "unknown",
      leadMinutes: status.operatorSummary?.leadMinutes ?? null,
      needsRollForward: status.operatorSummary?.needsRollForward === true,
      action: status.operatorSummary?.scheduleWindowAction || "",
    },
    row: scheduleReady ? {
      queueItemId: nextRow.queueItemId,
      rank: nextRow.rank,
      brand: nextRow.metricoolBrandName,
      accountName: nextRow.accountName,
      platform: nextRow.platform,
      publishAtLocal: nextRow.publishAtLocal || nextRow.publishAt,
      publishAt: nextRow.publishAt,
      uploadFileName: nextRow.uploadFileName,
      uploadFileUrl: nextRow.uploadFileUrl || "",
      captionSeed: nextRow.captionSeed,
      scheduledNoteTemplate: nextRow.scheduledNoteTemplate,
      evidenceState: nextRow.evidenceState,
      missingFields: nextRow.evidenceMissingFields || [],
    } : null,
    guardrails: [
      "Use Metricool only for this TikTok MVP.",
      "Do not paste TikTok public URLs until the post is live.",
      "Do not enter views, likes, comments, or shares until 24h metrics are real.",
      "Do not treat this JSON as proof of scheduling; proof requires a real Metricool planner URL.",
    ],
    links: {
      operatorUi: `${localOrigin()}/clippers`,
      nextActionHtml: `${localOrigin()}/api/clippers/next-metricool-action.html`,
      uploadPack: `${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
      currentTikTokActionMarkdown: `${localOrigin()}/api/clippers/tiktok-current-action.md`,
      currentTikTokActionJson: `${localOrigin()}/api/clippers/tiktok-current-action.json`,
      currentTikTokCaptionTxt: `${localOrigin()}/api/clippers/tiktok-current-caption.txt`,
      currentTikTokVideoMp4: `${localOrigin()}/api/clippers/tiktok-current-video.mp4`,
      nextMetricoolActionMarkdown: `${localOrigin()}/api/clippers/next-metricool-action.md`,
      nextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/next-scheduled-proof-starter.csv`,
      tiktokBatchAccountSummaryJson: `${localOrigin()}/api/clippers/tiktok-batch-account-summary.json`,
      tiktokBatchAccountSummaryCsv: `${localOrigin()}/api/clippers/tiktok-batch-account-summary.csv`,
      tiktokBatchAccountSummaryMarkdown: `${localOrigin()}/api/clippers/tiktok-batch-account-summary.md`,
      tiktokAccountQueuesJson: `${localOrigin()}/api/clippers/tiktok-account-queues.json`,
      tiktokAccountQueuesCsv: `${localOrigin()}/api/clippers/tiktok-account-queues.csv`,
      tiktokAccountQueuesMarkdown: `${localOrigin()}/api/clippers/tiktok-account-queues.md`,
      tiktokCurrentAccountNowHtml: `${localOrigin()}/api/clippers/tiktok-current-account-now.html`,
      tiktokCurrentNextUploadChecklistCsv: `${localOrigin()}/api/clippers/tiktok-current-next-upload-checklist.csv`,
      tiktokCurrentNextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`,
      tiktokSportsNextJson: `${localOrigin()}/api/clippers/tiktok-account-next.json?accountId=sports-daily`,
      tiktokMemesNextJson: `${localOrigin()}/api/clippers/tiktok-account-next.json?accountId=meme-radar`,
      tiktokSportsNowHtml: `${localOrigin()}/api/clippers/tiktok-account-now.html?accountId=sports-daily`,
      tiktokMemesNowHtml: `${localOrigin()}/api/clippers/tiktok-account-now.html?accountId=meme-radar`,
      tiktokSportsNextUploadChecklistCsv: `${localOrigin()}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=sports-daily`,
      tiktokMemesNextUploadChecklistCsv: `${localOrigin()}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=meme-radar`,
      tiktokSportsNextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily`,
      tiktokMemesNextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=meme-radar`,
      tiktokSportsScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=sports-daily`,
      tiktokMemesScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=meme-radar`,
      tiktokSportsRunbookMarkdown: `${localOrigin()}/api/clippers/tiktok-account-runbook.md?accountId=sports-daily`,
      tiktokMemesRunbookMarkdown: `${localOrigin()}/api/clippers/tiktok-account-runbook.md?accountId=meme-radar`,
      operatorReadyJson: `${localOrigin()}/api/clippers/operator-ready.json`,
    },
  };
}

function renderNextMetricoolActionPage(status) {
  const action = status.nextBestAction || {};
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const scheduleReady = Boolean(nextRow && action.stage === "schedule_in_metricool");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Metricool Now</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:820px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:28px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .value{font-size:22px;font-weight:800;color:#fff}
    .row{display:grid;grid-template-columns:150px 1fr;gap:8px;border-top:1px solid #293644;padding:9px 0}
    .row:first-of-type{border-top:0}
    a{color:#85d7ff}
    input,textarea{box-sizing:border-box;width:100%;border:1px solid #304253;background:#0b1118;color:#eef7ff;border-radius:6px;padding:8px;margin:6px 0;font:inherit}
    textarea{min-height:82px}
    button{border:1px solid #3d6a83;background:#0f3248;border-radius:8px;padding:10px 12px;color:#eaf7ff;font:inherit;cursor:pointer}
    .small{font-size:12px;color:#9fb0c4}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
  </style>
</head>
<body>
<main>
  <h1>Clippers Metricool Now</h1>
  <p>Una sola acción segura para el próximo TikTok. Esta pantalla no publica, no agenda y no guarda evidencia sin pasar primero por preview.</p>
  <div class="card">
    <div class="label">Estado</div>
    <p><strong>${escapeHtml(action.title || status.status)}</strong></p>
    <p>${escapeHtml(action.detail || status.metricoolSchedulingRunSheet?.nextAction || "")}</p>
    <p class="small">TikTok only: ${escapeHtml(status.tiktokOnly ? "yes" : "no")} · Metricool approval required: ${escapeHtml(status.metricoolApprovalRequired ? "yes" : "no")} · realPublishEnabled: ${escapeHtml(status.realPublishEnabled ? "true" : "false")}</p>
  </div>
  ${scheduleReady ? `<div class="card">
    <div class="label">Programa este clip en Metricool</div>
    <div class="row"><div class="small">Queue item</div><div><code>${escapeHtml(nextRow.queueItemId)}</code></div></div>
    <div class="row"><div class="small">Brand</div><div>${escapeHtml(nextRow.metricoolBrandName)}</div></div>
    <div class="row"><div class="small">Cuenta</div><div>${escapeHtml(nextRow.accountName)}</div></div>
    <div class="row"><div class="small">Horario</div><div>${escapeHtml(nextRow.publishAtLocal || nextRow.publishAt)}<div class="small">${escapeHtml(nextRow.publishAt)}</div></div></div>
    <div class="row"><div class="small">Archivo</div><div>${nextRow.uploadFileUrl ? link(nextRow.uploadFileUrl, nextRow.uploadFileName || "MP4") : escapeHtml(nextRow.uploadFileName || "missing")}</div></div>
    <div class="row"><div class="small">Caption</div><div>${escapeHtml(nextRow.captionSeed)}</div></div>
    <div class="row"><div class="small">Nota sugerida</div><div>${escapeHtml(nextRow.scheduledNoteTemplate)}</div></div>
  </div>
  <div class="card">
    <div class="label">Después de programarlo</div>
    <form method="post" action="/api/clippers/evidence/scheduled-preview">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="returnTo" value="/api/clippers/next-metricool-action.html" />
      <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(nextRow.queueItemId)}" />
      <input name="metricoolApprovalUrl" placeholder="https://app.metricool.com/..." />
      <textarea name="operatorNotes" placeholder="Real note, 20+ chars.">${escapeHtml(nextRow.scheduledNoteTemplate)}</textarea>
      <button type="submit">Preview scheduled proof</button>
    </form>
    <p class="small">Solo acepta URLs reales de Metricool Planner. No pegues TikTok URLs ni métricas aquí.</p>
  </div>` : `<div class="card"><div class="value">No hay fila lista para programar ahora.</div><p>${escapeHtml(action.detail || "Revisa el dashboard principal.")}</p></div>`}
  <div class="card">
    <div class="label">Links</div>
    <p>${link("/clippers", "Dashboard principal")} · ${link("/api/clippers/tiktok-current-account-now.html", "Current TikTok now")} · ${link("/api/clippers/tiktok-current-video.mp4", "Current video MP4")} · ${link("/api/clippers/tiktok-current-action.md", "Current TikTok packet")} · ${link("/api/clippers/tiktok-current-action.json", "Current TikTok JSON")} · ${link("/api/clippers/tiktok-current-caption.txt", "Current caption TXT")} · ${link("/api/clippers/next-metricool-action.md", "Packet Markdown")} · ${link("/api/clippers/next-scheduled-proof-starter.csv", "CSV del próximo row")} · ${link("/api/clippers/operator-ready.json", "Ready JSON")}</p>
  </div>
</main>
</body>
</html>`;
}

function renderTikTokAccountMetricoolNowPage(status, accountId) {
  const nextAction = buildTikTokAccountNextAction(status.tiktokAccountQueues, accountId);
  if (!nextAction.ok) return minimalTikTokAccountError(nextAction);
  const row = nextAction.nextRow || null;
  const globalNextQueueItemId = status.metricoolSchedulingRunSheet?.nextRow?.queueItemId || status.operatorSummary?.deadlineQueueItemId || "";
  const isGlobalDeadlineRow = Boolean(row && row.queueItemId === globalNextQueueItemId);
  const scheduleReady = Boolean(row
    && isGlobalDeadlineRow
    && status.nextBestAction?.stage === "schedule_in_metricool"
    && status.operatorSummary?.needsRollForward !== true
    && status.uploadPackIntegrity?.status === "ready"
    && (!status.realClipIntakeValidation?.status || realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status)));
  const blockedMessage = status.operatorSummary?.needsRollForward
    ? "La ventana de publicación necesita roll-forward antes de guardar proof."
    : status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status)
    ? "Estos MP4 son placeholders o no tienen source/permiso validado. Primero completa Real clip intake antes de programar en Metricool."
    : (!isGlobalDeadlineRow
      ? "Hay otro deadline global antes de esta cuenta. Usa el Metricool Now global o la cuenta que aparece como próximo deadline."
      : "El upload pack debe estar ready antes de programar esta cuenta.");
  const accountParam = encodeURIComponent(nextAction.accountId);
  const returnTo = `/api/clippers/tiktok-account-now.html?accountId=${accountParam}`;
  return {
    ok: true,
    statusCode: 200,
    filename: `clippers-${nextAction.accountId}-now.html`,
    html: `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers ${escapeHtml(nextAction.brand)} TikTok Now</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:0;background:#0b0d10;color:#f4f7fb}
    main{max-width:820px;margin:0 auto;padding:26px 18px 44px}
    h1{font-size:28px;line-height:1.1;margin:0 0 8px}
    p{color:#c7d0dc;line-height:1.55}
    .card{border:1px solid #2a3441;background:#151a21;border-radius:8px;padding:16px;margin:14px 0}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9fb0c4}
    .value{font-size:22px;font-weight:800;color:#fff}
    .row{display:grid;grid-template-columns:150px 1fr;gap:8px;border-top:1px solid #293644;padding:9px 0}
    .row:first-of-type{border-top:0}
    a{color:#85d7ff}
    input,textarea{box-sizing:border-box;width:100%;border:1px solid #304253;background:#0b1118;color:#eef7ff;border-radius:6px;padding:8px;margin:6px 0;font:inherit}
    textarea{min-height:82px}
    button{border:1px solid #3d6a83;background:#0f3248;border-radius:8px;padding:10px 12px;color:#eaf7ff;font:inherit;cursor:pointer}
    .small{font-size:12px;color:#9fb0c4}
    code{background:#111820;border:1px solid #263340;border-radius:6px;padding:2px 5px;color:#d9f0ff}
  </style>
</head>
<body>
<main>
  <h1>${escapeHtml(nextAction.brand)} TikTok Now</h1>
  <p>Vista enfocada para programar solo el próximo clip de ${escapeHtml(nextAction.accountName)} en Metricool. No publica, no agenda y no guarda evidencia sin preview.</p>
  <div class="card">
    <div class="label">Cuenta</div>
    <div class="value">${escapeHtml(nextAction.accountName)}</div>
    <p class="small">Account ID: ${escapeHtml(nextAction.accountId)} · Platform: ${escapeHtml(nextAction.platform)} · realPublishEnabled=false · Metricool approval_required=true</p>
  </div>
  ${row ? `<div class="card">
    <div class="label">${scheduleReady ? "Programa este clip en Metricool" : "No programes hasta resolver el bloqueo"}</div>
    <div class="row"><div class="small">Queue item</div><div><code>${escapeHtml(row.queueItemId)}</code></div></div>
    <div class="row"><div class="small">Orden cuenta</div><div>${escapeHtml(row.accountOrder)}</div></div>
    <div class="row"><div class="small">Horario</div><div>${escapeHtml(row.publishAtLocal || row.publishAt)}<div class="small">${escapeHtml(row.publishAt)}</div></div></div>
    <div class="row"><div class="small">Archivo</div><div>${row.uploadFileUrl ? link(row.uploadFileUrl, row.uploadFileName || "MP4") : escapeHtml(row.uploadFileName || "missing")}</div></div>
    <div class="row"><div class="small">Caption</div><div>${escapeHtml(row.captionSeed)}</div></div>
    <div class="row"><div class="small">Evidencia</div><div>${escapeHtml(row.evidenceState)}${row.missingFields?.length ? `<div class="small">${escapeHtml(row.missingFields.join(", "))}</div>` : ""}</div></div>
    <div class="row"><div class="small">Nota proof</div><div>${escapeHtml(row.scheduledNoteTemplate)}</div></div>
  </div>
  ${scheduleReady ? `<div class="card">
    <div class="label">Después de programarlo en Metricool</div>
    <form method="post" action="/api/clippers/evidence/scheduled-preview">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
      <input name="metricoolApprovalUrl" placeholder="https://app.metricool.com/..." />
      <textarea name="operatorNotes" placeholder="Real note, 20+ chars.">${escapeHtml(row.scheduledNoteTemplate)}</textarea>
      <button type="submit">Preview scheduled proof</button>
    </form>
    <p class="small">Solo acepta URLs reales de Metricool Planner. No pegues TikTok URLs ni métricas aquí.</p>
  </div>` : `<div class="card">
    <div class="label">Bloqueado temporalmente</div>
    <p>${escapeHtml(blockedMessage)}</p>
    <p class="small">${link("/api/clippers/real-clip-intake.html", "Real clip intake")} · ${link("/api/clippers/real-clip-intake-validation.html", "Real clip validation")}</p>
  </div>`}` : `<div class="card"><div class="value">No hay scheduled proof pendiente para esta cuenta.</div><p>${escapeHtml(nextAction.nextAction)}</p></div>`}
  <div class="card">
    <div class="label">Links</div>
    <p>${link("/clippers", "Dashboard principal")} · ${link("/api/clippers/tiktok-current-video.mp4", "Current video MP4")} · ${link("/api/clippers/tiktok-current-caption.txt", "Current caption TXT")} · ${link("/api/clippers/tiktok-current-next-upload-checklist.csv", "Current upload CSV")} · ${link("/api/clippers/tiktok-current-next-scheduled-proof-starter.csv", "Current proof CSV")} · ${link(`/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=${accountParam}`, "Next upload CSV")} · ${link(`/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=${accountParam}`, "Next proof CSV")} · ${link(`/api/clippers/tiktok-account-runbook.md?accountId=${accountParam}`, "Runbook")} · ${link(`/api/clippers/tiktok-account-next.json?accountId=${accountParam}`, "Next JSON")}</p>
  </div>
</main>
</body>
</html>`,
  };
}

function renderCurrentTikTokAccountMetricoolNowPage(status) {
  const accountId = currentTikTokAccountId(status);
  if (!accountId) {
    return {
      ok: false,
      statusCode: 404,
      error: "current_tiktok_account_not_found",
    };
  }
  return renderTikTokAccountMetricoolNowPage(status, accountId);
}

function buildOperatorReadySummary(status) {
  const nextRow = status.metricoolSchedulingRunSheet?.nextRow || null;
  const deadlineQueue = metricoolDeadlineQueue(status);
  const realClipIntakeBlocked = status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status);
  const readyToScheduleNow = status.metricoolOperatorChecklist?.status === "ready_for_metricool_operator"
    && status.operatorSummary?.needsRollForward !== true
    && status.uploadPackIntegrity?.status === "ready"
    && !realClipIntakeBlocked
    && Number(status.evidence?.missingApproval || 0) > 0;
  return {
    status: status.goalReadinessAudit?.complete ? "complete" : (realClipIntakeBlocked ? "blocked_real_clip_intake" : "external_actions_required"),
    generatedAt: status.generatedAt,
    tiktokOnly: status.tiktokOnly,
    metricoolApprovalRequired: status.metricoolApprovalRequired,
    realPublishEnabled: status.realPublishEnabled,
    operatorReady: status.metricoolOperatorChecklist?.status === "ready_for_metricool_operator" && !realClipIntakeBlocked,
    goalComplete: status.goalReadinessAudit?.complete === true,
    readyToScheduleNow,
    uploadPackIntegrity: status.uploadPackIntegrity || null,
    realClipGap: status.realClipGap || null,
    realClipIntakeValidation: status.realClipIntakeValidation || null,
    streamerGrowthCeo: status.streamerGrowthCeo || null,
    deferredOtherPlatformRows: status.deferredOtherPlatformRows || 0,
    blockers: status.goalReadinessAudit?.blockers || [],
    nextBestAction: status.nextBestAction || null,
    missingMetricoolScheduledProof: status.evidence?.missingApproval ?? null,
    publicMetricsReady: status.goalReadinessAudit?.rows?.find((row) => row.id === "public_tiktok_metrics")?.status === "ready",
    operatorAudit: {
      status: status.operatorAudit?.status || "unknown",
      events: status.operatorAudit?.events || 0,
      accepted: status.operatorAudit?.accepted || 0,
      rejected: status.operatorAudit?.rejected || 0,
      invalidLines: status.operatorAudit?.invalidLines || 0,
      bytes: status.operatorAudit?.bytes || 0,
      truncated: status.operatorAudit?.truncated === true,
      summarizedEvents: status.operatorAudit?.summarizedEvents || 0,
      lastEvent: status.operatorAudit?.lastEvent || null,
      url: status.operatorAudit?.url || "",
    },
    publicMetrics: {
      status: status.publicMetricsRunSheet?.status || "unknown",
      eligibleRows: status.publicMetricsRunSheet?.eligibleRows || 0,
      lockedRows: status.publicMetricsRunSheet?.lockedRows || 0,
      pendingRows: status.publicMetricsRunSheet?.pendingRows || 0,
      readyRows: status.publicMetricsRunSheet?.readyRows || 0,
      missingPublicUrl: status.publicMetricsRunSheet?.missingPublicUrl || 0,
      missingViews: status.publicMetricsRunSheet?.missingViews || 0,
      nextQueueItemId: status.publicMetricsRunSheet?.nextQueueItemId || "",
      nextAction: status.publicMetricsRunSheet?.nextAction || "",
    },
    tiktokBatchAccountSummary: status.tiktokBatchAccountSummary || null,
    tiktokAccountQueues: status.tiktokAccountQueues || null,
    watchdog: {
      enabled: status.watchdog?.enabled === true,
      thresholdMinutes: status.watchdog?.thresholdMinutes ?? null,
      minutesUntilAutoRollForward: status.watchdog?.minutesUntilAutoRollForward ?? null,
      autoRollForwardThresholdAt: status.watchdog?.autoRollForwardThresholdAt || "",
      lastStatus: status.watchdog?.lastStatus || "",
      lastReason: status.watchdog?.lastReason || "",
      nextAction: status.watchdog?.nextAction || "",
    },
    activeExternalRepairs: status.externalEvidenceValidation?.activeRepairRows ?? null,
    deferredExternalBacklog: status.externalEvidenceValidation?.deferredRepairRows ?? null,
    scheduleWindow: {
      status: status.operatorSummary?.scheduleWindowStatus || "unknown",
      label: status.operatorSummary?.scheduleWindowLabel || "Unknown",
      leadMinutes: status.operatorSummary?.leadMinutes ?? null,
      needsRollForward: status.operatorSummary?.needsRollForward === true,
      action: status.operatorSummary?.scheduleWindowAction || "",
      firstPublishAt: readyToScheduleNow ? status.operatorSummary?.firstPublishAt || "" : "",
      deadlineQueueItemId: readyToScheduleNow ? status.operatorSummary?.deadlineQueueItemId || "" : "",
      deadlinePublishAt: readyToScheduleNow ? status.operatorSummary?.deadlinePublishAt || "" : "",
    },
    deadlineReadiness: {
      okToSchedule: readyToScheduleNow,
      label: status.operatorSummary?.scheduleWindowLabel || "Unknown",
      leadMinutes: status.operatorSummary?.leadMinutes ?? null,
      nextQueueItemId: readyToScheduleNow ? status.nextBestAction?.queueItemId || "" : "",
      nextAction: readyToScheduleNow ? status.nextBestAction?.title || "" : "",
    },
    nextAction: status.metricoolSchedulingRunSheet?.nextAction || status.operatorSummary?.nextAction || "",
    nextMetricoolRow: readyToScheduleNow && nextRow ? {
      queueItemId: nextRow.queueItemId,
      brand: nextRow.metricoolBrandName,
      accountName: nextRow.accountName,
      platform: nextRow.platform,
      publishAtLocal: nextRow.publishAtLocal,
      publishAt: nextRow.publishAt,
      uploadFileName: nextRow.uploadFileName,
      captionSeed: nextRow.captionSeed,
      scheduledNoteTemplate: nextRow.scheduledNoteTemplate,
    } : null,
    metricoolDeadlineQueue: readyToScheduleNow ? deadlineQueue : [],
    links: {
      operatorUi: `${localOrigin()}/clippers`,
      operatorBrief: `${localOrigin()}/api/clippers/operator-brief.md`,
      operatorReport: `${localOrigin()}/api/clippers/operator-report.md`,
      streamerGrowthCeoHtml: `${localOrigin()}/api/clippers/streamer-growth-ceo.html`,
      streamerGrowthCeoJson: `${localOrigin()}/api/clippers/streamer-growth-ceo.json`,
      streamerGrowthCeoMarkdown: `${localOrigin()}/api/clippers/streamer-growth-ceo.md`,
      goalGapsJson: `${localOrigin()}/api/clippers/goal-gaps.json`,
      goalGapsMarkdown: `${localOrigin()}/api/clippers/goal-gaps.md`,
      realClipGapJson: `${localOrigin()}/api/clippers/real-clip-gap.json`,
      realClipGapMarkdown: `${localOrigin()}/api/clippers/real-clip-gap.md`,
      realClipIntakeHtml: `${localOrigin()}/api/clippers/real-clip-intake.html`,
      realClipIntakeMarkdown: `${localOrigin()}/api/clippers/real-clip-intake.md`,
      realClipIntakeManifestCsv: `${localOrigin()}/api/clippers/real-clip-intake-manifest.csv`,
      realClipIntakeBatchTemplateCsv: `${localOrigin()}/api/clippers/real-clip-intake-batch-template.csv`,
      realClipIntakeValidationJson: `${localOrigin()}/api/clippers/real-clip-intake-validation.json`,
      realClipIntakeValidationHtml: `${localOrigin()}/api/clippers/real-clip-intake-validation.html`,
      realClipIntakeValidationMarkdown: `${localOrigin()}/api/clippers/real-clip-intake-validation.md`,
      realClipPermissionOutreachHtml: `${localOrigin()}/api/clippers/real-clip-permission-outreach.html`,
      realClipPermissionOutreachMarkdown: `${localOrigin()}/api/clippers/real-clip-permission-outreach.md`,
      realClipPermissionOutreachCsv: `${localOrigin()}/api/clippers/real-clip-permission-outreach.csv`,
      realClipSourceHuntHtml: `${localOrigin()}/api/clippers/real-clip-source-hunt.html`,
      realClipSourceHuntJson: `${localOrigin()}/api/clippers/real-clip-source-hunt.json`,
      realClipSourceHuntMarkdown: `${localOrigin()}/api/clippers/real-clip-source-hunt.md`,
      realClipSourceHuntCsv: `${localOrigin()}/api/clippers/real-clip-source-hunt.csv`,
      realClipPermissionCrmHtml: `${localOrigin()}/api/clippers/real-clip-permission-crm.html`,
      realClipPermissionCrmJson: `${localOrigin()}/api/clippers/real-clip-permission-crm.json`,
      realClipPermissionCrmCsv: `${localOrigin()}/api/clippers/real-clip-permission-crm.csv`,
      realClipPermissionCrmBatchTemplateCsv: `${localOrigin()}/api/clippers/real-clip-permission-crm-batch-template.csv`,
      realClipCloseoutWorkPacketJson: `${localOrigin()}/api/clippers/real-clip-closeout-work-packet.json`,
      realClipCloseoutWorkPacketMarkdown: `${localOrigin()}/api/clippers/real-clip-closeout-work-packet.md`,
      realClipCloseoutWorkPacketCsv: `${localOrigin()}/api/clippers/real-clip-closeout-work-packet.csv`,
      sourceDropMetricoolRefreshJson: `${localOrigin()}/api/clippers/source-drop-metricool-refresh.json`,
      sourceDropMetricoolRefreshHtml: `${localOrigin()}/api/clippers/source-drop-metricool-refresh.html`,
      sourceDropMetricoolRefreshMarkdown: `${localOrigin()}/api/clippers/source-drop-metricool-refresh.md`,
      tiktokBatchScheduleNowHtml: `${localOrigin()}/api/clippers/tiktok-batch-schedule-now.html`,
      tiktokPublicMetricsNowHtml: `${localOrigin()}/api/clippers/tiktok-public-metrics-now.html`,
      currentTikTokActionMarkdown: `${localOrigin()}/api/clippers/tiktok-current-action.md`,
      currentTikTokActionJson: `${localOrigin()}/api/clippers/tiktok-current-action.json`,
      currentTikTokCaptionTxt: `${localOrigin()}/api/clippers/tiktok-current-caption.txt`,
      currentTikTokVideoMp4: `${localOrigin()}/api/clippers/tiktok-current-video.mp4`,
      nextMetricoolAction: `${localOrigin()}/api/clippers/next-metricool-action.md`,
      nextMetricoolActionJson: `${localOrigin()}/api/clippers/next-metricool-action.json`,
      tiktokBatchAccountSummaryJson: `${localOrigin()}/api/clippers/tiktok-batch-account-summary.json`,
      tiktokBatchAccountSummaryCsv: `${localOrigin()}/api/clippers/tiktok-batch-account-summary.csv`,
      tiktokBatchAccountSummaryMarkdown: `${localOrigin()}/api/clippers/tiktok-batch-account-summary.md`,
      tiktokAccountQueuesJson: `${localOrigin()}/api/clippers/tiktok-account-queues.json`,
      tiktokAccountQueuesCsv: `${localOrigin()}/api/clippers/tiktok-account-queues.csv`,
      tiktokAccountQueuesMarkdown: `${localOrigin()}/api/clippers/tiktok-account-queues.md`,
      tiktokCurrentAccountNowHtml: `${localOrigin()}/api/clippers/tiktok-current-account-now.html`,
      tiktokCurrentNextUploadChecklistCsv: `${localOrigin()}/api/clippers/tiktok-current-next-upload-checklist.csv`,
      tiktokCurrentNextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`,
      tiktokSportsNextJson: `${localOrigin()}/api/clippers/tiktok-account-next.json?accountId=sports-daily`,
      tiktokMemesNextJson: `${localOrigin()}/api/clippers/tiktok-account-next.json?accountId=meme-radar`,
      tiktokSportsNowHtml: `${localOrigin()}/api/clippers/tiktok-account-now.html?accountId=sports-daily`,
      tiktokMemesNowHtml: `${localOrigin()}/api/clippers/tiktok-account-now.html?accountId=meme-radar`,
      tiktokSportsNextUploadChecklistCsv: `${localOrigin()}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=sports-daily`,
      tiktokMemesNextUploadChecklistCsv: `${localOrigin()}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=meme-radar`,
      tiktokSportsNextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily`,
      tiktokMemesNextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=meme-radar`,
      tiktokSportsScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=sports-daily`,
      tiktokMemesScheduledProofStarterCsv: `${localOrigin()}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=meme-radar`,
      tiktokSportsRunbookMarkdown: `${localOrigin()}/api/clippers/tiktok-account-runbook.md?accountId=sports-daily`,
      tiktokMemesRunbookMarkdown: `${localOrigin()}/api/clippers/tiktok-account-runbook.md?accountId=meme-radar`,
      uploadChecklistCsv: `${localOrigin()}/api/clippers/metricool-upload-checklist.csv`,
      scheduledProofStarterCsv: `${localOrigin()}/api/clippers/scheduled-proof-starter.csv`,
      nextScheduledProofStarterCsv: `${localOrigin()}/api/clippers/next-scheduled-proof-starter.csv`,
      publishedMetricsStarterCsv: `${localOrigin()}/api/clippers/published-metrics-starter.csv`,
      nextPublishedMetricsStarterCsv: `${localOrigin()}/api/clippers/next-published-metrics-starter.csv`,
      uploadPack: `${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
    },
  };
}

function buildExternalEvidenceSummary(csvRaw) {
  const parsed = parseCsv(csvRaw || "");
  const rows = parsed.rows || [];
  const counts = rows.reduce((sum, row) => {
    const kind = String(row.kind || "unknown").trim() || "unknown";
    const platform = String(row.platform || "unknown").trim() || "unknown";
    sum.byKind[kind] = (sum.byKind[kind] || 0) + 1;
    sum.byPlatform[platform] = (sum.byPlatform[platform] || 0) + 1;
    return sum;
  }, { byKind: {}, byPlatform: {} });
  const activeRows = rows.map((row, index) => ({
    index: index + 1,
    kind: row.kind || "",
    accountId: row.account_id || "",
    platform: row.platform || "",
    status: row.status || "",
    scope: row.scope || "",
    portalUrl: row.portal_url || "",
    docsUrl: row.docs_url || "",
    proofPath: row.proof || "",
    proofUrl: workspaceUrlForFilePath(row.proof),
    notes: row.notes || "",
  }));
  return {
    status: rows.length ? "needs_real_external_evidence" : "empty",
    rows: rows.length,
    accounts: counts.byKind.account || 0,
    developerApps: counts.byKind.developer_app || 0,
    permissions: counts.byKind.permission || 0,
    tiktok: counts.byPlatform.tiktok || 0,
    instagram: counts.byPlatform.instagram || 0,
    youtube: counts.byPlatform.youtube || 0,
    nextRows: activeRows.slice(0, 5),
    csvStarter: csvRaw || "",
    nextStep: rows.length
      ? "Complete the real external portal action, fill the proof file without secrets, then validate/import external closeout evidence."
      : "No external account or permission evidence rows are queued.",
  };
}

function buildExternalEvidenceValidationSummary(report = {}, externalCloseout = {}) {
  const totals = report.totals || {};
  const repairSummary = report.repairSummary || {};
  const nextRepair = repairSummary.nextRepair || null;
  const repairQueue = Array.isArray(report.repairQueue) ? report.repairQueue : [];
  const closeoutTasks = Array.isArray(externalCloseout.tasks) ? externalCloseout.tasks : [];
  const closeoutTaskById = new Map(closeoutTasks.map((row) => [String(row.closeoutId || ""), row]));
  const nextRepairDetail = nextRepair
    ? repairQueue.find((row) => String(row.closeoutId || "") === String(nextRepair.closeoutId || "")
      || String(row.csvRow || "") === String(nextRepair.csvRow || ""))
    : null;
  const nextCloseoutTask = nextRepair ? closeoutTaskById.get(String(nextRepair.closeoutId || "")) : null;
  return {
    status: report.status || "missing",
    mode: report.mode || "",
    generatedAt: report.generatedAt || "",
    rowsScanned: totals.rowsScanned || 0,
    accepted: totals.accepted || 0,
    rejected: totals.rejected || 0,
    applied: totals.applied || 0,
    topReasons: Array.isArray(repairSummary.topReasons) ? repairSummary.topReasons.slice(0, 3) : [],
    missingFields: Array.isArray(repairSummary.missingFields) ? repairSummary.missingFields.slice(0, 3) : [],
    repairRows: repairQueue.slice(0, 6).map((row) => {
      const closeoutTask = closeoutTaskById.get(String(row.closeoutId || "")) || {};
      const proofPath = row.proofPath || closeoutTask.proofPath || "";
      return {
        csvRow: row.csvRow || closeoutTask.csvRow || "",
        closeoutId: row.closeoutId || closeoutTask.closeoutId || "",
        lane: row.lane || closeoutTask.lane || "",
        platform: row.platform || closeoutTask.platform || "",
        accountId: row.accountId || closeoutTask.accountId || "",
        scope: row.scope || closeoutTask.scope || "",
        requiredStatus: row.requiredStatus || closeoutTask.requiredStatus || "",
        activeForMetricoolMvp: row.activeForMetricoolMvp === true || closeoutTask.activeForMetricoolMvp === true,
        deferredForMetricoolMvp: row.deferredForMetricoolMvp === true || closeoutTask.deferredForMetricoolMvp === true,
        deferredReason: row.deferredReason || closeoutTask.deferredReason || "",
        reason: row.reason || closeoutTask.reason || "",
        priorityLabel: row.priorityLabel || "",
        proofPath,
        proofUrl: workspaceUrlForFilePath(proofPath),
        missingCsvFields: Array.isArray(row.missingCsvFields) ? row.missingCsvFields : [],
        nextStep: row.nextStep || closeoutTask.nextAction || "",
        csvRowTemplate: row.csvRowTemplate || closeoutTask.csvRowTemplate || "",
      };
    }),
    nextRepair: nextRepair ? {
      csvRow: nextRepair.csvRow || "",
      closeoutId: nextRepair.closeoutId || "",
      lane: nextRepair.lane || "",
      platform: nextRepair.platform || "",
      accountId: nextRepair.accountId || nextRepairDetail?.accountId || nextCloseoutTask?.accountId || "",
      scope: nextRepair.scope || nextRepairDetail?.scope || nextCloseoutTask?.scope || "",
      requiredStatus: nextRepair.requiredStatus || nextRepairDetail?.requiredStatus || nextCloseoutTask?.requiredStatus || "",
      activeForMetricoolMvp: nextRepair.activeForMetricoolMvp === true || nextRepairDetail?.activeForMetricoolMvp === true || nextCloseoutTask?.activeForMetricoolMvp === true,
      deferredForMetricoolMvp: nextRepair.deferredForMetricoolMvp === true || nextRepairDetail?.deferredForMetricoolMvp === true || nextCloseoutTask?.deferredForMetricoolMvp === true,
      deferredReason: nextRepair.deferredReason || nextRepairDetail?.deferredReason || nextCloseoutTask?.deferredReason || "",
      reason: nextRepair.reason || "",
      proofPath: nextRepair.proofPath || nextRepairDetail?.proofPath || nextCloseoutTask?.proofPath || "",
      proofUrl: workspaceUrlForFilePath(nextRepair.proofPath || nextRepairDetail?.proofPath || nextCloseoutTask?.proofPath),
      portalUrl: nextRepair.portalUrl || nextRepairDetail?.portalUrl || "",
      missingCsvFields: Array.isArray(nextRepairDetail?.missingCsvFields) ? nextRepairDetail.missingCsvFields : [],
      nextStep: nextRepair.nextStep || nextCloseoutTask?.nextAction || "",
      csvRowTemplate: repairSummary.nextRepairCsvRowTemplate || nextCloseoutTask?.csvRowTemplate || "",
    } : null,
    nextStep: repairSummary.nextStep || report.nextStep || "Run Preview external evidence to generate a repair queue.",
    reportUrl: workspaceUrlForFilePath(report.paths?.markdown),
    repairPacketUrl: workspaceUrlForFilePath(report.paths?.repairWorkPacketMarkdown),
    repairTemplatesUrl: workspaceUrlForFilePath(report.paths?.repairTemplatesCsv),
    activeRepairRows: externalCloseout.totals?.activeTasks ?? repairQueue.filter((row) => row.activeForMetricoolMvp === true).length,
    deferredRepairRows: externalCloseout.totals?.deferredTasks ?? repairQueue.filter((row) => row.deferredForMetricoolMvp === true).length,
  };
}

function buildGoalReadinessAudit(status) {
  const evidenceRows = Number(status.rows?.length || 0);
  const missingApproval = (status.rows || []).filter((row) => !row.hasMetricoolScheduledEvidence).length;
  const readyForImportPreview = (status.rows || []).filter((row) => row.hasValidPublishedMetricsEvidence).length;
  const missingPublicUrl = (status.rows || []).filter((row) => !row.hasValidPublishedUrl).length;
  const missingMetrics = (status.rows || []).filter((row) => !row.hasValid24hMetrics).length;
  const metricoolReady = status.metricoolMvp?.status === "metricool_mvp_ready";
  const evidenceIntegrityClean = status.evidenceIntegrity?.status === "clean";
  const scheduledProofReady = evidenceRows > 0 && missingApproval === 0;
  const publishedMetricsReady = evidenceRows > 0
    && readyForImportPreview === evidenceRows
    && missingPublicUrl === 0
    && missingMetrics === 0;
  const directApisDeferred = status.metricoolMvp?.directSocialApisRequired === false && status.metricoolMvp?.directApisDeferred === true;
  const otherPlatformsDeferred = status.tiktokOnly === true;
  const realPublishSafe = status.realPublishEnabled === false && status.metricoolApprovalRequired === true;
  const realClipIntakeReady = realClipIntakeReadyForScheduling(status.realClipIntakeValidation?.status);
  const readyRealClips = Number(status.realClipIntakeValidation?.readyRows || 0);
  const requiredRealClips = Number(status.realClipIntakeValidation?.totalRows || evidenceRows || 0);
  const blockers = [
    metricoolReady ? null : "metricool_tiktok_mvp_not_ready",
    realClipIntakeReady ? null : `real_clip_intake_not_ready_${readyRealClips}_of_${requiredRealClips}`,
    evidenceIntegrityClean ? null : "evidence_integrity_not_clean",
    scheduledProofReady ? null : `missing_metricool_scheduled_proof_${missingApproval}`,
    publishedMetricsReady ? null : "public_tiktok_urls_or_24h_metrics_not_ready",
    realPublishSafe ? null : "real_publish_guardrail_not_safe",
  ].filter(Boolean);
  return {
    status: blockers.length ? "external_actions_required" : "ready_for_closeout_review",
    complete: blockers.length === 0,
    scope: "tiktok_metricool_only",
    summary: blockers.length
      ? "The TikTok Metricool workflow is configured, but the goal is not complete until real rights-cleared clips pass intake, receive Metricool schedule proof, and produce live TikTok metrics."
      : "TikTok Metricool MVP has local proof, public post proof, and metrics ready for closeout review.",
    blockers,
    rows: [
      {
        id: "metricool_tiktok_mvp",
        label: "TikTok Metricool MVP",
        status: metricoolReady ? "ready" : "blocked",
        detail: metricoolReady
          ? `SPORT and memes TikTok lanes are connected through Metricool (${status.metricoolMvp.activeReadyLanes}/${status.metricoolMvp.activeTargetLanes}).`
          : `Metricool MVP blockers: ${status.metricoolMvp?.blockers?.join(", ") || "refresh account readiness"}.`,
        nextAction: metricoolReady
          ? "Use Metricool approval_required flow; no direct social API keys are needed for this MVP."
          : "Clear Metricool account readiness blockers before scheduling.",
      },
      {
        id: "real_clip_intake",
        label: "Approved real TikTok clips",
        status: realClipIntakeReady ? "ready" : "blocked",
        detail: realClipIntakeReady
          ? `${readyRealClips}/${requiredRealClips} real clip intake rows passed validation.`
          : `${readyRealClips}/${requiredRealClips} real clips passed; generated placeholders never count as real clips.`,
        nextAction: realClipIntakeReady
          ? "Regenerate the Metricool batch from the validated real source files."
          : status.realClipIntakeValidation?.nextAction || "Add exact source URLs, rights proof, and local MP4 source files.",
      },
      {
        id: "evidence_integrity",
        label: "Evidence integrity",
        status: evidenceIntegrityClean ? "ready" : "blocked",
        detail: evidenceIntegrityClean
          ? "Current batch and master evidence passed row-level integrity checks."
          : `${status.evidenceIntegrity?.findingsCount || 0} evidence integrity finding(s) must be resolved.`,
        nextAction: evidenceIntegrityClean
          ? "Continue using exact Metricool and TikTok proof only."
          : status.evidenceIntegrity?.nextAction || "Fix invalid evidence before continuing.",
      },
      {
        id: "metricool_scheduled_proof",
        label: "Metricool scheduled proof",
        status: scheduledProofReady ? "ready" : "blocked",
        detail: scheduledProofReady
          ? "Every current batch row has accepted Metricool planner evidence."
          : `Missing Metricool scheduled proof: ${missingApproval}/${evidenceRows}.`,
        nextAction: scheduledProofReady
          ? "Wait for posts to go live, then capture public TikTok URLs and 24h metrics."
          : "Open Metricool, schedule the current TikTok batch, then paste real Metricool planner URLs into scheduled proof.",
      },
      {
        id: "public_tiktok_metrics",
        label: "Public TikTok URLs + 24h metrics",
        status: publishedMetricsReady ? "ready" : "blocked",
        detail: publishedMetricsReady
          ? "Published TikTok URLs and metrics are ready for import/closeout."
          : `Missing public URL rows: ${missingPublicUrl}; missing metric rows: ${missingMetrics}; ready import preview: ${readyForImportPreview}.`,
        nextAction: "Only record public TikTok video URLs and 24h views after the posts are live.",
      },
      {
        id: "direct_tiktok_apis",
        label: "Direct TikTok APIs",
        status: directApisDeferred ? "deferred_not_required" : "review",
        detail: directApisDeferred
          ? "Deferred because this launch uses Metricool instead of direct social network APIs."
          : "Review direct API requirement flags before changing the launch mode.",
        nextAction: "Do not request TikTok API keys for this Metricool MVP unless Robert explicitly changes the launch mode.",
      },
      {
        id: "other_platforms",
        label: "Instagram + YouTube",
        status: otherPlatformsDeferred ? "deferred_not_required" : "review",
        detail: otherPlatformsDeferred
          ? "Out of scope for the first launch; Robert will connect other accounts later."
          : "Review multi-platform scope before expanding the operator.",
        nextAction: "Keep the operator focused on TikTok until Robert asks to expand.",
      },
      {
        id: "real_publish_guardrail",
        label: "Real publish guardrail",
        status: realPublishSafe ? "safe" : "blocked",
        detail: realPublishSafe
          ? "Metricool remains approval_required and realPublishEnabled=false."
          : "Publishing guardrail is not safe.",
        nextAction: "Keep manual approval in Metricool until Robert explicitly enables real publishing.",
      },
    ],
  };
}

function buildGoalGapsSummary(status) {
  const audit = status.goalReadinessAudit || buildGoalReadinessAudit(status);
  const rows = audit.rows || [];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ready = rows.filter((row) => ["ready", "safe", "deferred_not_required"].includes(row.status)).length;
  const blocked = rows.filter((row) => row.status === "blocked").length;
  const review = rows.filter((row) => row.status === "review").length;
  const nextAction = status.nextBestAction?.stage === "schedule_in_metricool"
    ? "Schedule the next TikTok row in Metricool, then save the real planner proof through preview and confirm."
    : status.nextBestAction?.stage === "record_public_metrics"
      ? "Record the exact public TikTok URL and real 24h metrics through preview and confirm."
      : status.nextBestAction?.detail || audit.summary || "Review Clippers status.";
  return {
    status: audit.complete ? "complete" : "not_complete",
    generatedAt: status.generatedAt,
    scope: audit.scope || "tiktok_metricool_only",
    complete: audit.complete === true,
    summary: audit.summary || "",
    counts: {
      total: rows.length,
      ready,
      blocked,
      review,
      blockers: (audit.blockers || []).length,
    },
    blockers: audit.blockers || [],
    nextAction,
    provenReady: [
      {
        id: "upload_pack",
        label: "Current TikTok upload pack",
        status: status.uploadPackIntegrity?.status === "ready" ? "ready" : "blocked",
        evidence: `${status.uploadPackIntegrity?.readyFiles || 0}/${status.uploadPackIntegrity?.totalRows || 0} local MP4 files ready.`,
      },
      {
        id: "metricool_mvp",
        label: "SPORT + memes TikTok through Metricool",
        status: rowById.get("metricool_tiktok_mvp")?.status || "unknown",
        evidence: rowById.get("metricool_tiktok_mvp")?.detail || "",
      },
      {
        id: "publish_guardrail",
        label: "Manual approval guardrail",
        status: rowById.get("real_publish_guardrail")?.status || "unknown",
        evidence: `realPublishEnabled=${status.realPublishEnabled}; metricoolApprovalRequired=${status.metricoolApprovalRequired}.`,
      },
    ],
    missingExternalProof: [
      {
        id: "metricool_scheduled_proof",
        label: "Real Metricool planner proof",
        status: rowById.get("metricool_scheduled_proof")?.status || "unknown",
        evidence: rowById.get("metricool_scheduled_proof")?.detail || "",
        nextAction: rowById.get("metricool_scheduled_proof")?.nextAction || "",
      },
      {
        id: "public_tiktok_metrics",
        label: "Public TikTok URLs and 24h metrics",
        status: rowById.get("public_tiktok_metrics")?.status || "unknown",
        evidence: rowById.get("public_tiktok_metrics")?.detail || "",
        nextAction: rowById.get("public_tiktok_metrics")?.nextAction || "",
      },
    ],
    deferredScope: [
      {
        id: "direct_tiktok_apis",
        label: "Direct TikTok APIs",
        status: rowById.get("direct_tiktok_apis")?.status || "unknown",
        reason: rowById.get("direct_tiktok_apis")?.detail || "",
      },
      {
        id: "other_platforms",
        label: "Instagram + YouTube",
        status: rowById.get("other_platforms")?.status || "unknown",
        reason: rowById.get("other_platforms")?.detail || "",
      },
    ],
    links: {
      dashboard: `${localOrigin()}/clippers`,
      batchScheduleNow: `${localOrigin()}/api/clippers/tiktok-batch-schedule-now.html`,
      publicMetricsNow: `${localOrigin()}/api/clippers/tiktok-public-metrics-now.html`,
      operatorReady: `${localOrigin()}/api/clippers/operator-ready.json`,
      uploadPack: `${localOrigin()}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html`,
    },
    guardrails: [
      "Do not mark the goal complete until real Metricool planner proof exists for every current TikTok row.",
      "Do not record public TikTok URLs or metrics until posts are live and numbers are real.",
      "Published metrics can only be saved through preview + confirm.",
      "Direct social APIs and non-TikTok platforms remain deferred for this MVP.",
    ],
  };
}

function buildGoalGapsMarkdown(status) {
  const gaps = buildGoalGapsSummary(status);
  const lines = [
    "# Clippers Goal Gaps",
    "",
    `Generated: ${gaps.generatedAt}`,
    `Scope: ${gaps.scope}`,
    `Status: ${gaps.status}`,
    `Complete: ${gaps.complete ? "yes" : "no"}`,
    "",
    gaps.summary,
    "",
    "## Counts",
    "",
    `- Ready/deferred-safe rows: ${gaps.counts.ready}/${gaps.counts.total}`,
    `- Blocked rows: ${gaps.counts.blocked}`,
    `- Blockers: ${gaps.blockers.join(", ") || "none"}`,
    "",
    "## Proven Ready",
    "",
    ...gaps.provenReady.map((row) => `- ${row.label}: ${row.status} - ${row.evidence}`),
    "",
    "## Missing External Proof",
    "",
    ...gaps.missingExternalProof.map((row) => `- ${row.label}: ${row.status} - ${row.evidence} Next: ${row.nextAction}`),
    "",
    "## Deferred Scope",
    "",
    ...gaps.deferredScope.map((row) => `- ${row.label}: ${row.status} - ${row.reason}`),
    "",
    "## Next Action",
    "",
    gaps.nextAction,
    "",
    "## Links",
    "",
    `- Dashboard: ${gaps.links.dashboard}`,
    `- TikTok batch now: ${gaps.links.batchScheduleNow}`,
    `- Public metrics now: ${gaps.links.publicMetricsNow}`,
    `- Operator ready JSON: ${gaps.links.operatorReady}`,
    `- Upload pack: ${gaps.links.uploadPack}`,
    "",
    "## Guardrails",
    "",
    ...gaps.guardrails.map((guardrail) => `- ${guardrail}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function serveFile(res, filePath) {
  const linkStat = await lstat(filePath).catch(() => null);
  if (!linkStat) {
    text(res, 404, "Not found");
    return;
  }
  if (linkStat.isSymbolicLink()) {
    text(res, 403, "Forbidden");
    return;
  }
  const [workspaceRealPath, fileRealPath] = await Promise.all([
    realpath(workspaceRoot).catch(() => ""),
    realpath(filePath).catch(() => ""),
  ]);
  if (!workspaceRealPath || !fileRealPath || (fileRealPath !== workspaceRealPath && !fileRealPath.startsWith(workspaceRealPath + path.sep))) {
    text(res, 403, "Forbidden");
    return;
  }
  const fileStat = await stat(fileRealPath).catch(() => null);
  if (!fileStat?.isFile()) {
    text(res, 404, "Not found");
    return;
  }
  const ext = path.extname(fileRealPath).toLowerCase();
  if (ext === ".mp4" && isCurrentUploadPackFile(fileRealPath)) {
    const intakeStatus = await buildLightweightRealClipIntakeStatus();
    const intakeValidation = await buildRealClipIntakeValidation(intakeStatus);
    if (intakeValidation.status && !realClipIntakeReadyForScheduling(intakeValidation.status)) {
      json(res, 409, {
        ok: false,
        statusCode: 409,
        error: "upload_pack_video_blocked_until_real_clip_intake_ready",
        readyRows: intakeValidation.readyRows || 0,
        blockedRows: intakeValidation.blockedRows || 0,
        nextAction: intakeValidation.nextAction || "Complete real clip intake before opening scheduled upload-pack videos.",
      });
      return;
    }
  }
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".mp4": "video/mp4",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  const stream = createReadStream(fileRealPath);
  stream.on("error", (error) => {
    if (!res.headersSent) {
      json(res, 500, { error: error.message || "Failed to read file" });
      return;
    }
    res.destroy(error);
  });
  stream.pipe(res);
}

function isCurrentUploadPackFile(filePath) {
  const currentUploadPackDir = path.join(scheduledDir, "metricool-current-batch-upload-pack");
  const relative = path.relative(currentUploadPackDir, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  return filePath.includes(`${path.sep}scheduled${path.sep}metricool-current-batch-upload-pack${path.sep}`);
}

async function buildStatus() {
  const [nextAction, sessionPacket, preflight, goalAudit, handoff, evidenceChecklist, accountReadiness, externalCloseout, externalEvidenceCsv, externalEvidenceReport, operatorAuditLog, batchEvidenceCsv, masterEvidenceCsv, workbook, uploadPackReport, streamerGrowthMetrics, streamerGrowthRoutingProof] = await Promise.all([
    readJson(path.join(reportsDir, "clippers-tiktok-next-action.json"), {}),
    readJson(sessionPacketJsonPath, {}),
    readJson(path.join(reportsDir, "clippers-tiktok-operator-cockpit-preflight.json"), {}),
    readJson(path.join(reportsDir, "clippers-goal-completion-audit.json"), {}),
    readJson(path.join(scheduledDir, "metricool-100-operator-handoff.json"), {}),
    readJson(path.join(reportsDir, "clippers-tiktok-evidence-checklist.json"), {}),
    readJson(path.join(workspaceRoot, "account-permission-readiness.json"), {}),
    readJson(path.join(reportsDir, "clippers-tiktok-external-closeout-session.json"), {}),
    readText(path.join(workspaceRoot, "account-permission-next-evidence.csv"), ""),
    readJson(path.join(reportsDir, "clippers-external-closeout-evidence-import-report.json"), {}),
    readTextTail(operatorAuditLogPath, operatorAuditTailBytes),
    readText(batchEvidenceCsvPath, ""),
    readText(masterEvidenceCsvPath, ""),
    readJson(currentBatchWorkbookJsonPath, {}),
    readJson(currentBatchUploadPackJsonPath, {}),
    readJson(path.join(reportsDir, "clippers-streamer-growth-metrics.json"), {}),
    readJson(path.join(reportsDir, "clippers-streamer-account-routing.json"), {}),
  ]);
  const batchEvidenceRows = batchEvidenceCsv ? parseCsv(batchEvidenceCsv).rows : [];
  const batchEvidenceByQueueId = new Map(batchEvidenceRows.map((row) => [String(row.metricool_queue_item_id || ""), row]));
  const evidenceByQueueId = new Map((evidenceChecklist.rows || []).map((row) => [String(row.metricoolQueueItemId || ""), row]));
  const workbookByQueueId = new Map((workbook.rows || []).map((row) => [String(row.metricoolQueueItemId || ""), row]));
  const uploadPackByQueueId = new Map((uploadPackReport.rows || []).map((row) => [String(row.metricoolQueueItemId || ""), row]));
  const allRows = (sessionPacket.rows || []).map((row) => {
    const queueItemId = String(row.metricoolQueueItemId || "");
    const evidence = evidenceByQueueId.get(queueItemId) || {};
    const batchEvidence = batchEvidenceByQueueId.get(queueItemId) || {};
    const workbookRow = workbookByQueueId.get(queueItemId) || {};
    const uploadPackRow = uploadPackByQueueId.get(queueItemId) || {};
    const hasMetricoolScheduledEvidence = hasScheduledEvidence(batchEvidence)
      || hasValidPublishedMetricsEvidence(batchEvidence);
    const hasValidPublishedUrl = isTikTokVideoUrl(batchEvidence.published_post_url);
    const hasValid24hMetrics = metricValue(batchEvidence.views_24h) !== null
      && Number(metricValue(batchEvidence.views_24h)) > 0
      && [batchEvidence.likes_24h, batchEvidence.comments_24h, batchEvidence.shares_24h]
        .every((value) => metricValue(value) !== null);
    return {
      rank: row.rank || "",
      status: row.status || "",
      queueItemId,
      accountName: canonicalTikTokAccountName(row.accountId, row.accountName || ""),
      accountId: row.accountId || "",
      metricoolBrandName: row.metricoolBrandName || "",
      platform: row.platform || "",
      publishAt: row.publishAt || "",
      sourcePath: row.sourcePath || uploadPackRow.sourcePath || workbookRow.sourcePath || "",
      sourceFileName: row.sourceFileName || workbookRow.sourceFileName || path.basename(uploadPackRow.sourcePath || workbookRow.sourcePath || ""),
      uploadFileName: row.uploadFileName || "",
      uploadFilePath: row.uploadFilePath || "",
      uploadFileUrl: workspaceUrlForFilePath(row.uploadFilePath),
      captionSeed: row.captionSeed || "",
      scheduledEvidenceAction: row.scheduledEvidenceAction || "",
      evidenceState: evidence.state || "unknown",
      evidenceBlocker: evidence.blocker || "",
      evidenceMissingFields: evidence.missingFields || [],
      evidenceNextAction: evidence.nextAction || "",
      evidenceTemplate: evidence.evidenceTemplate || "",
      scheduledCsvTemplate: evidence.scheduledCsvTemplate || "",
      hasMetricoolScheduledEvidence,
      hasValidPublishedUrl,
      hasValid24hMetrics,
      hasValidPublishedMetricsEvidence: hasValidPublishedMetricsEvidence(batchEvidence),
    };
  });
  const rows = allRows.filter((row) => isTikTokPlatform(row.platform));
  const deferredOtherPlatformRows = allRows.length - rows.length;
  const deadlineRow = [...rows]
    .filter((row) => !row.hasMetricoolScheduledEvidence)
    .sort((left, right) => rowPublishTime(left) - rowPublishTime(right))[0]
    || null;
  const nextRow = deadlineRow;
  const publishTimes = rows
    .map((row) => Date.parse(row.publishAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const firstPublishAt = publishTimes.length ? new Date(publishTimes[0]).toISOString() : "";
  const leadMinutes = publishTimes.length ? Math.round((publishTimes[0] - operatorNowMs()) / 60_000) : null;
  const window = scheduleWindowStatus(leadMinutes);
  const status = {
    status: nextAction.status || sessionPacket.status || "unknown",
    generatedAt: new Date().toISOString(),
    mode: "clippers_local_operator_server",
    batchId: nextAction.batch?.id || nextAction.batchId || sessionPacket.batch?.id || sessionPacket.batchId || "metricool-batch-01",
    nextStep: nextAction.nextStep || sessionPacket.nextStep || goalAudit.nextStep || "",
    tiktokOnly: true,
    deferredOtherPlatformRows,
    metricoolApprovalRequired: true,
    realPublishEnabled: false,
    scheduled: nextAction.batch?.scheduled ?? nextAction.scheduled ?? 0,
    readyToImport: nextAction.batch?.readyToImport ?? nextAction.readyToImport ?? 0,
    preflight: {
      status: preflight.status || "missing",
      checks: preflight.checks?.length || preflight.checks || 0,
      passed: preflight.totals?.passed ?? preflight.passed ?? 0,
      failed: preflight.totals?.failed ?? preflight.failed ?? 0,
    },
    handoff: {
      status: handoff.status || "missing",
      rows: handoff.totals?.rows || 0,
      sports: handoff.totals?.sports || 0,
      memes: handoff.totals?.memes || 0,
      streamers: handoff.totals?.streamers || 0,
    },
    metricoolMvp: buildMetricoolMvpSummary(accountReadiness, externalCloseout),
    evidence: {
      status: evidenceChecklist.status || "missing",
      rows: evidenceChecklist.totals?.rows || 0,
      missingApproval: evidenceChecklist.totals?.missingApproval || 0,
      missingPublicUrl: evidenceChecklist.totals?.missingPublicUrl || 0,
      missingMetrics: evidenceChecklist.totals?.missingMetrics || 0,
      readyForImportPreview: evidenceChecklist.totals?.readyForImportPreview || 0,
      invalidEvidence: evidenceChecklist.totals?.invalidEvidence || 0,
    },
    operatorAudit: buildOperatorAuditSummary(operatorAuditLog.text, operatorAuditLog),
    operatorSummary: {
      nextQueueItemId: nextRow?.queueItemId || "",
      nextRank: nextRow?.rank || "",
      nextAccountName: nextRow?.accountName || "",
      nextMetricoolBrandName: nextRow?.metricoolBrandName || "",
      nextPublishAt: nextRow?.publishAt || "",
      nextUploadFileName: nextRow?.uploadFileName || "",
      nextCaptionSeed: nextRow?.captionSeed || "",
      nextAction: nextRow?.evidenceNextAction || nextStepText(nextAction, sessionPacket, goalAudit),
      firstPublishAt,
      leadMinutes,
      scheduleWindowStatus: window.status,
      scheduleWindowLabel: window.label,
      scheduleWindowAction: window.action,
      needsRollForward: typeof leadMinutes === "number" ? leadMinutes < 20 : false,
      deadlineQueueItemId: deadlineRow?.queueItemId || "",
      deadlineRank: deadlineRow?.rank || "",
      deadlineAccountName: deadlineRow?.accountName || "",
      deadlineMetricoolBrandName: deadlineRow?.metricoolBrandName || "",
      deadlinePublishAt: deadlineRow?.publishAt || "",
      deadlineUploadFileName: deadlineRow?.uploadFileName || "",
      deadlineCaptionSeed: deadlineRow?.captionSeed || "",
      deadlineAction: deadlineRow?.evidenceNextAction || "",
    },
    paths: {
      cockpit: "/clippers-workspace/reports/clippers-tiktok-operator-cockpit.html",
      uploadPack: "/clippers-workspace/scheduled/metricool-current-batch-upload-pack/index.html",
      runbook: "/clippers-workspace/reports/clippers-tiktok-batch-runbook.md",
      evidenceCsv: "/clippers-workspace/scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv",
      sessionPacket: "/clippers-workspace/reports/clippers-metricool-current-batch-session-packet.md",
      accountReadiness: "/clippers-workspace/account-permission-readiness.md",
      tiktokCloseout: "/clippers-workspace/reports/clippers-tiktok-external-closeout-session.md",
      externalEvidenceCsv: "/clippers-workspace/account-permission-next-evidence.csv",
    },
    rows,
    streamerGrowthMetrics,
    streamerGrowthRoutingProof,
  };
  status.watchdog = buildWatchdogSummary(status);
  status.evidenceIntegrity = buildEvidenceIntegritySummary({
    batchEvidenceCsv,
    masterEvidenceCsv,
    operatorAudit: status.operatorAudit,
    rows,
  });
  status.uploadPackIntegrity = await buildUploadPackIntegrity(rows);
  status.realClipGap = buildRealClipGapSummary(rows, status.uploadPackIntegrity);
  status.realClipIntakeValidation = await buildRealClipIntakeValidation(status);
  const realClipIntakeBlocked = status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status);
  if (realClipIntakeBlocked) {
    status.previousSourceStatus = status.status;
    status.sourceStatus = "blocked_real_clip_intake";
    status.status = "blocked_real_clip_intake";
    status.nextStep = status.realClipIntakeValidation?.nextAction || status.realClipGap?.nextAction || "Complete real clip intake before scheduling in Metricool.";
    applyRealClipIntakeBlockToRows(status);
    applyRealClipIntakeBlockToOperatorSummary(status);
  }
  status.metricoolOperatorChecklist = buildMetricoolOperatorChecklist(rows, status);
  status.scheduledProofCsvStarter = status.operatorSummary.needsRollForward || realClipIntakeBlocked
    ? emptyScheduledProofCsvStarter()
    : scheduledProofCsvStarter(rows);
  status.nextScheduledProofCsvStarter = status.operatorSummary.needsRollForward || realClipIntakeBlocked
    ? emptyScheduledProofCsvStarter()
    : nextScheduledProofCsvStarter(rows);
  status.publishedMetricsCsvStarter = publishedMetricsCsvStarter(rows);
  status.nextPublishedMetricsCsvStarter = nextPublishedMetricsCsvStarter(rows);
  status.metricoolSchedulingRunSheet = buildMetricoolSchedulingRunSheet(rows);
  if (realClipIntakeBlocked) {
    status.metricoolSchedulingRunSheet.status = "blocked_real_clip_intake";
    status.metricoolSchedulingRunSheet.nextAction = status.realClipIntakeValidation?.nextAction || "Complete Real clip intake before scheduling in Metricool.";
  }
  status.publicMetricsRunSheet = buildPublicMetricsRunSheet(rows);
  status.tiktokBatchAccountSummary = buildTikTokBatchAccountSummary(rows, status.uploadPackIntegrity);
  status.tiktokAccountQueues = buildTikTokAccountQueues(rows, status.uploadPackIntegrity);
  if (realClipIntakeBlocked) {
    applyRealClipIntakeBlockToTikTokAccountSummaries(status);
  }
  status.externalEvidence = buildExternalEvidenceSummary(externalEvidenceCsv);
  status.externalEvidenceValidation = buildExternalEvidenceValidationSummary(externalEvidenceReport, externalCloseout);
  status.goalReadinessAudit = buildGoalReadinessAudit(status);
  status.streamer100Campaign = await buildStreamer100Campaign();
  status.streamerGrowthCeo = buildStreamerGrowthCeo(status);
  status.nextBestAction = buildNextBestAction(status);
  status.goLiveGapResolver = buildGoLiveGapResolver(status);
  return stripInternalPathsFromStatus(status);
}

function applyRealClipIntakeBlockToRows(status) {
  const nextAction = status.realClipIntakeValidation?.nextAction || "Complete Real clip intake before scheduling this batch in Metricool.";
  for (const row of status.rows || []) {
    row.previousSourceStatus = row.status || "";
    row.sourceStatus = "blocked_real_clip_intake";
    row.status = "blocked_real_clip_intake";
    row.evidenceBlocker = "real_clip_intake_not_ready";
    row.evidenceNextAction = nextAction;
    row.scheduledEvidenceAction = "Blocked: replace the placeholder with a real approved TikTok clip before scheduling in Metricool.";
  }
}

function applyRealClipIntakeBlockToOperatorSummary(status) {
  if (!status.operatorSummary) return;
  const nextAction = status.realClipIntakeValidation?.nextAction || "Complete Real clip intake before scheduling this batch in Metricool.";
  status.operatorSummary.nextAction = nextAction;
  status.operatorSummary.deadlineAction = nextAction;
  status.operatorSummary.scheduleWindowAction = "Do not schedule placeholders; replace them with approved real clips first.";
}

function applyRealClipIntakeBlockToTikTokAccountSummaries(status) {
  const nextAction = status.realClipIntakeValidation?.nextAction || "Complete Real clip intake before scheduling this batch in Metricool.";
  if (status.tiktokBatchAccountSummary) {
    status.tiktokBatchAccountSummary.status = "blocked_real_clip_intake";
    status.tiktokBatchAccountSummary.nextAction = nextAction;
    for (const account of status.tiktokBatchAccountSummary.accounts || []) {
      account.nextAction = nextAction;
    }
  }
  if (status.tiktokAccountQueues) {
    status.tiktokAccountQueues.status = "blocked_real_clip_intake";
    status.tiktokAccountQueues.guardrails = [
      ...(status.tiktokAccountQueues.guardrails || []),
      "Real clip intake is blocked; do not schedule upload-pack placeholder videos in Metricool.",
    ];
    for (const account of status.tiktokAccountQueues.accounts || []) {
      account.nextAction = nextAction;
    }
  }
}

function nextStepText(nextAction, sessionPacket, goalAudit) {
  return nextAction.nextStep || sessionPacket.nextStep || goalAudit.nextStep || "";
}

function stripInternalPathsFromStatus(status) {
  delete status.streamerGrowthMetrics;
  delete status.streamerGrowthRoutingProof;
  for (const row of status.rows || []) {
    delete row.sourcePath;
    delete row.uploadFilePath;
  }
  for (const row of status.uploadPackIntegrity?.rows || []) {
    delete row.sourcePath;
    delete row.uploadFilePath;
  }
  for (const row of status.uploadPackIntegrity?.blockedRows || []) {
    delete row.sourcePath;
    delete row.uploadFilePath;
  }
  if (status.operatorAudit) {
    delete status.operatorAudit.path;
  }
  return scrubInternalPathsFromStatusValue(status);
}

function scrubInternalPathsFromStatusValue(value) {
  if (typeof value === "string") {
    return value.split(workspaceRoot).join("/clippers-workspace");
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubInternalPathsFromStatusValue(item));
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key === "sourcePath" || key === "uploadFilePath") {
        delete value[key];
        continue;
      }
      value[key] = scrubInternalPathsFromStatusValue(value[key]);
    }
  }
  return value;
}

function verifiedTwitchClipUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(hostname === "twitch.tv" || hostname.endsWith(".twitch.tv"))) return "";
    const exactClipPath = /\/clip\//i.test(url.pathname)
      || (hostname === "clips.twitch.tv" && url.pathname.split("/").filter(Boolean).length === 1);
    return exactClipPath ? url.toString() : "";
  } catch {
    return "";
  }
}

const humanReviewDecisionHeader = [
  "id",
  "creator",
  "title",
  "decision",
  "audio_status",
  "context_status",
  "third_party_status",
  "human_review_confirmed",
  "ai_used",
  "notes",
  "reviewed_at",
];
const allowedHumanReviewDecisions = new Set(["approved_for_intake", "rejected"]);
const allowedHumanReviewCheckStatuses = new Set(["approved", "rejected"]);

async function readHumanReviewDecisions() {
  const evidenceRoot = path.join(workspaceRoot, "evidence-drop");
  const evidenceRootStat = await lstat(evidenceRoot).catch(() => null);
  if (evidenceRootStat?.isSymbolicLink()) return { status: "evidence_drop_root_symlink_blocked", rows: [] };
  const ledgerStat = await lstat(humanReviewDecisionsCsvPath).catch(() => null);
  if (!ledgerStat) return { status: "not_recorded", rows: [] };
  if (ledgerStat.isSymbolicLink()) return { status: "human_review_decisions_symlink_blocked", rows: [] };
  if (!ledgerStat.isFile()) return { status: "human_review_decisions_not_a_file", rows: [] };
  const workspaceReal = await realpath(workspaceRoot).catch(() => workspaceRoot);
  const evidenceRootReal = await realpath(evidenceRoot).catch(() => null);
  const ledgerReal = await realpath(humanReviewDecisionsCsvPath).catch(() => null);
  if (!evidenceRootReal || (evidenceRootReal !== workspaceReal && !evidenceRootReal.startsWith(workspaceReal + path.sep))) {
    return { status: "evidence_drop_root_outside_workspace", rows: [] };
  }
  if (!ledgerReal || (ledgerReal !== evidenceRootReal && !ledgerReal.startsWith(evidenceRootReal + path.sep))) {
    return { status: "human_review_decisions_outside_workspace", rows: [] };
  }
  const raw = await readText(humanReviewDecisionsCsvPath, "");
  return { status: raw.trim() ? "ready" : "empty", rows: raw.trim() ? parseCsv(raw).rows : [] };
}

function latestHumanReviewDecisionById(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    const previous = byId.get(id);
    if (!previous || String(row.reviewed_at || "") >= String(previous.reviewed_at || "")) byId.set(id, row);
  }
  return byId;
}

function humanReviewManifestRejected(row) {
  return /rejected/i.test(row.status) || row.contextReview === "rejected";
}

function validPersistedHumanReviewDecision(decision, reviewRow) {
  if (!decision || !reviewRow || !allowedHumanReviewDecisions.has(String(decision.decision || ""))) return false;
  if (String(decision.human_review_confirmed || "") !== "yes") return false;
  if ([decision.audio_status, decision.context_status, decision.third_party_status]
    .some((value) => !allowedHumanReviewCheckStatuses.has(String(value || "")))) return false;
  const aiUsed = String(decision.ai_used || "");
  if (!["yes", "no"].includes(aiUsed)) return false;
  const notes = String(decision.notes || "").trim();
  if (validateOperatorNotes(notes) || secretTextPattern.test(notes) || secretQueryParamPattern.test(notes)) return false;
  if (decision.decision === "approved_for_intake") {
    if (humanReviewManifestRejected(reviewRow) || !reviewRow.fileReady) return false;
    if ([decision.audio_status, decision.context_status, decision.third_party_status].some((value) => value !== "approved")) return false;
    if (reviewRow.noAiRequired && aiUsed !== "no") return false;
  }
  return true;
}

async function verifiedHumanReviewContactSheet(directoryPath, directory, localFile) {
  if (!localFile) return "";
  const contactSheetName = `${path.parse(localFile).name}__contact-sheet.jpg`;
  const contactSheetPath = path.join(directoryPath, contactSheetName);
  const [quarantineStat, directoryStat, contactSheetStat] = await Promise.all([
    lstat(quarantineDir).catch(() => null),
    lstat(directoryPath).catch(() => null),
    lstat(contactSheetPath).catch(() => null),
  ]);
  if (quarantineStat?.isSymbolicLink() || directoryStat?.isSymbolicLink() || contactSheetStat?.isSymbolicLink()) return "";
  if (!contactSheetStat?.isFile() || contactSheetStat.size < 1_024 || contactSheetStat.size > 5 * 1024 * 1024) return "";
  const file = await open(contactSheetPath, "r").catch(() => null);
  if (!file) return "";
  try {
    const header = Buffer.alloc(3);
    const footer = Buffer.alloc(2);
    const [headerRead, footerRead] = await Promise.all([
      file.read(header, 0, header.length, 0),
      file.read(footer, 0, footer.length, contactSheetStat.size - footer.length),
    ]);
    const isJpeg = headerRead.bytesRead === 3
      && footerRead.bytesRead === 2
      && header[0] === 0xff
      && header[1] === 0xd8
      && header[2] === 0xff
      && footer[0] === 0xff
      && footer[1] === 0xd9;
    if (!isJpeg) return "";
  } finally {
    await file.close().catch(() => {});
  }
  return `/clippers-workspace/quarantine/${encodeURIComponent(directory)}/${encodeURIComponent(contactSheetName)}`;
}

async function buildHumanReviewQueue() {
  const campaign = await buildStreamer100Campaign();
  const permissionByHandle = campaignPermissionMap(campaign.permissionLedgerRows);
  const sources = [
    {
      creator: "sadlights",
      creatorHandle: "sadlights",
      directory: "sadlights-review",
      manifest: "review-manifest.csv",
      normalize: (row) => ({
        title: row.title,
        sourceUrl: row.exact_source_url,
        localFile: row.local_raw_file,
        suggestedTargetFile: row.vertical_intake_file ? path.basename(String(row.vertical_intake_file)) : "",
        sourceAge: row.source_age,
        sourceViews: row.source_views,
        rightsStatus: row.creator_permission === "verified" ? "approved_blanket" : row.creator_permission,
        audioReview: row.audio_review,
        contextReview: row.context_review,
        thirdPartyReview: row.gameplay_rights_review,
        noAiRequired: false,
        status: row.status,
        notes: "Exact Twitch candidate. Verify permission, audio, context, and third-party material before intake.",
      }),
    },
    {
      creator: "ESP Leonidas",
      creatorHandle: "esp_leonidas",
      directory: "esp-leonidas-review",
      manifest: "review-manifest.csv",
      normalize: (row) => ({
        title: row.title,
        sourceUrl: row.source_url,
        localFile: row.local_file,
        suggestedTargetFile: "",
        sourceAge: row.source_posted_at ? `Published ${row.source_posted_at}` : "",
        sourceViews: row.historical_views,
        rightsStatus: row.rights_status,
        audioReview: row.audio_review,
        contextReview: row.intake_status === "rejected_visual_policy_risk" ? "rejected" : "required",
        thirdPartyReview: row.third_party_review,
        noAiRequired: false,
        status: row.intake_status,
        notes: row.notes,
      }),
    },
  ];
  const rows = [];
  for (const source of sources) {
    const directoryPath = path.join(quarantineDir, source.directory);
    const raw = await readText(path.join(directoryPath, source.manifest), "");
    if (!raw) continue;
    for (const manifestRow of parseCsv(raw).rows) {
      const normalized = source.normalize(manifestRow);
      const localFile = path.basename(String(normalized.localFile || ""));
      const filePath = localFile ? path.join(directoryPath, localFile) : "";
      const fileStat = filePath ? await stat(filePath).catch(() => null) : null;
      const contactSheetUrl = fileStat?.isFile()
        ? await verifiedHumanReviewContactSheet(directoryPath, source.directory, localFile)
        : "";
      const creatorPermission = permissionByHandle.get(campaignHandleKey(source.creatorHandle));
      const blanketPermissionVerified = creatorPermission?.permissionStatus === "approved_blanket";
      rows.push({
        id: `${source.directory}:${localFile || normalized.title || rows.length + 1}`,
        creator: source.creator,
        creatorHandle: source.creatorHandle,
        title: normalized.title || "Untitled clip",
        sourceUrl: verifiedTwitchClipUrl(normalized.sourceUrl),
        localFile,
        quarantineDirectory: source.directory,
        suggestedTargetFile: normalized.suggestedTargetFile || "",
        mediaUrl: fileStat?.isFile()
          ? `/clippers-workspace/quarantine/${encodeURIComponent(source.directory)}/${encodeURIComponent(localFile)}`
          : "",
        contactSheetUrl,
        fileReady: Boolean(fileStat?.isFile()),
        fileBytes: fileStat?.isFile() ? fileStat.size : 0,
        evidenceUrl: blanketPermissionVerified ? creatorPermission.evidenceLink : "",
        sourceAge: normalized.sourceAge || "Unknown",
        sourceViews: normalized.sourceViews || "Unknown",
        rightsStatus: blanketPermissionVerified ? "approved_blanket" : "review_required",
        audioReview: normalized.audioReview || "required",
        contextReview: normalized.contextReview || "required",
        thirdPartyReview: normalized.thirdPartyReview || "required",
        noAiRequired: blanketPermissionVerified && creatorPermission.restrictions?.noAi === true,
        restrictionsVerified: blanketPermissionVerified,
        status: normalized.status || "review_required",
        notes: normalized.notes || "Human review required before intake.",
        publishAllowed: false,
      });
    }
  }
  const intakeStatus = await buildLightweightRealClipIntakeStatus();
  const intakeValidation = await buildRealClipIntakeValidation(intakeStatus);
  const validationByQueueId = new Map((intakeValidation.rows || []).map((row) => [row.queueItemId, row]));
  const intakeTargets = buildRealClipIntakePack(intakeStatus).rows.map((row) => ({
    queueItemId: row.queueItemId,
    accountName: row.accountName,
    category: row.category,
    targetFileName: row.targetFileName,
    targetSourceDropFile: row.targetSourceDropFile,
    targetMediaUrl: `/clippers-workspace/source-drop/${encodeURIComponent(row.category)}/${encodeURIComponent(row.targetFileName)}`,
    publishAt: row.publishAt,
    status: validationByQueueId.get(row.queueItemId)?.status || "blocked",
    blockers: validationByQueueId.get(row.queueItemId)?.blockers || [],
  }));
  const targetByFileName = new Map(intakeTargets.map((row) => [row.targetFileName, row]));
  for (const row of rows) {
    const suggestedTarget = targetByFileName.get(row.suggestedTargetFile);
    row.suggestedQueueItemId = suggestedTarget?.queueItemId || "";
    row.suggestedTargetStatus = suggestedTarget?.status || "";
    row.suggestedTargetBlockers = suggestedTarget?.blockers || [];
  }
  const decisionLedger = await readHumanReviewDecisions();
  const decisionsById = latestHumanReviewDecisionById(decisionLedger.rows);
  let invalidDecisionRows = 0;
  for (const row of rows) {
    const storedDecision = decisionsById.get(row.id);
    const decision = validPersistedHumanReviewDecision(storedDecision, row) ? storedDecision : null;
    if (storedDecision && !decision) invalidDecisionRows += 1;
    row.humanDecision = decision?.decision || "pending";
    row.humanReviewComplete = ["approved_for_intake", "rejected"].includes(row.humanDecision);
    row.reviewedAt = decision?.reviewed_at || "";
    row.reviewNotes = decision?.notes || "";
    row.recordedChecks = decision ? {
      audio: decision.audio_status || "",
      context: decision.context_status || "",
      thirdParty: decision.third_party_status || "",
      aiUsed: decision.ai_used || "",
    } : null;
  }
  const approvedRows = rows.filter((row) => row.humanDecision === "approved_for_intake" && !humanReviewManifestRejected(row)).length;
  const rejectedRows = rows.filter((row) => humanReviewManifestRejected(row) || row.humanDecision === "rejected").length;
  const reviewRequiredRows = rows.filter((row) => !humanReviewManifestRejected(row) && !row.humanReviewComplete).length;
  return {
    status: rows.length === 0
      ? "no_review_candidates"
      : reviewRequiredRows > 0
        ? "human_review_required"
        : approvedRows > 0
          ? "human_review_complete_for_intake"
          : "review_complete_no_approved_rows",
    generatedAt: new Date().toISOString(),
    readOnly: false,
    decisionRecordingEnabled: true,
    decisionsUnlockPublishing: false,
    decisionLedgerStatus: decisionLedger.status,
    invalidDecisionRows,
    metricoolApprovalRequired: true,
    realPublishEnabled: false,
    totals: {
      rows: rows.length,
      filesReady: rows.filter((row) => row.fileReady).length,
      reviewRequired: reviewRequiredRows,
      approvedForIntake: approvedRows,
      rejected: rejectedRows,
      noAi: rows.filter((row) => row.noAiRequired).length,
      publishAllowed: 0,
    },
    intakeTargets,
    staleIntakeTargets: intakeTargets.filter((row) => {
      const publishAtMs = Date.parse(String(row.publishAt || ""));
      return !Number.isFinite(publishAtMs) || publishAtMs <= operatorNowMs() + 20 * 60_000;
    }).length,
    rows,
  };
}

async function recordHumanReviewDecision(input = {}, { skipLock = false } = {}) {
  if (!skipLock) {
    const evidenceDir = await ensureContainedEvidenceDir();
    if (!evidenceDir.ok) return { ok: false, statusCode: 409, error: evidenceDir.status, id: String(input.id || "").trim() };
    return withHumanReviewDecisionLock(() => recordHumanReviewDecision(input, { skipLock: true }));
  }
  const id = String(input.id || "").trim();
  const decision = String(input.decision || "").trim();
  const audioStatus = String(input.audioStatus || "").trim();
  const contextStatus = String(input.contextStatus || "").trim();
  const thirdPartyStatus = String(input.thirdPartyStatus || "").trim();
  const humanReviewConfirmed = String(input.humanReviewConfirmed || "").trim();
  const aiUsed = String(input.aiUsed || "").trim();
  const notes = String(input.notes || "").trim();
  const queue = await buildHumanReviewQueue();
  const reviewRow = queue.rows.find((row) => row.id === id);
  if (!reviewRow) return { ok: false, statusCode: 404, error: "human_review_candidate_not_found", id };
  if (!allowedHumanReviewDecisions.has(decision)) {
    return { ok: false, statusCode: 400, error: "invalid_human_review_decision", id };
  }
  if (humanReviewConfirmed !== "yes") {
    return { ok: false, statusCode: 400, error: "human_review_confirmation_required", id };
  }
  if ([audioStatus, contextStatus, thirdPartyStatus].some((value) => !allowedHumanReviewCheckStatuses.has(value))) {
    return { ok: false, statusCode: 400, error: "invalid_human_review_check_status", id };
  }
  const noteError = validateOperatorNotes(notes);
  if (noteError) return { ok: false, statusCode: 400, error: noteError, id };
  if (secretTextPattern.test(notes) || secretQueryParamPattern.test(notes)) {
    return { ok: false, statusCode: 400, error: "human_review_notes_secret_like", id };
  }
  if (!new Set(["yes", "no"]).has(aiUsed)) {
    return { ok: false, statusCode: 400, error: "ai_used_confirmation_required", id };
  }
  if (decision === "approved_for_intake") {
    if (humanReviewManifestRejected(reviewRow)) {
      return { ok: false, statusCode: 409, error: "manifest_rejection_cannot_be_overridden", id };
    }
    if (!reviewRow.fileReady) {
      return { ok: false, statusCode: 409, error: "human_review_source_file_missing", id };
    }
    if ([audioStatus, contextStatus, thirdPartyStatus].some((value) => value !== "approved")) {
      return { ok: false, statusCode: 400, error: "all_human_review_checks_must_be_approved", id };
    }
    if (reviewRow.noAiRequired && aiUsed !== "no") {
      return { ok: false, statusCode: 400, error: "creator_prohibits_ai_processing", id };
    }
  }
  const evidenceDirWithinLock = await ensureContainedEvidenceDir();
  if (!evidenceDirWithinLock.ok) return { ok: false, statusCode: 409, error: evidenceDirWithinLock.status, id };
  const ledgerLinkStat = await lstat(humanReviewDecisionsCsvPath).catch(() => null);
  if (ledgerLinkStat?.isSymbolicLink()) {
    return { ok: false, statusCode: 409, error: "human_review_decisions_symlink_blocked", id };
  }
  const ledgerRead = await readTextForMutation(humanReviewDecisionsCsvPath, { allowMissing: true });
  if (!ledgerRead.ok) return { ok: false, statusCode: 503, error: "human_review_decisions_read_unavailable", id };
  const rows = ledgerRead.value.trim() ? parseCsv(ledgerRead.value).rows : [];
  const reviewedAt = new Date().toISOString();
  const recorded = {
    id: safeCsvText(id),
    creator: safeCsvText(reviewRow.creator),
    title: safeCsvText(reviewRow.title),
    decision,
    audio_status: safeCsvText(audioStatus),
    context_status: safeCsvText(contextStatus),
    third_party_status: safeCsvText(thirdPartyStatus),
    human_review_confirmed: "yes",
    ai_used: aiUsed,
    notes: safeCsvText(notes),
    reviewed_at: reviewedAt,
  };
  const existingIndex = rows.findIndex((row) => String(row.id || "") === id);
  if (existingIndex >= 0) rows[existingIndex] = recorded;
  else rows.push(recorded);
  const evidenceDirBeforeWrite = await ensureContainedEvidenceDir();
  if (!evidenceDirBeforeWrite.ok) return { ok: false, statusCode: 409, error: evidenceDirBeforeWrite.status, id };
  const ledgerBeforeWriteStat = await lstat(humanReviewDecisionsCsvPath).catch(() => null);
  if (ledgerBeforeWriteStat?.isSymbolicLink()) {
    return { ok: false, statusCode: 409, error: "human_review_decisions_symlink_blocked", id };
  }
  await atomicWriteFile(humanReviewDecisionsCsvPath, renderCsv(humanReviewDecisionHeader, rows));
  return {
    ok: true,
    statusCode: 200,
    status: "human_review_decision_recorded",
    id,
    decision,
    reviewedAt,
    unlocksSourceDrop: false,
    unlocksMetricool: false,
    publishAllowed: false,
    nextAction: decision === "approved_for_intake"
      ? "Decision recorded. Complete the separate Real Clip Intake before the Metricool approval queue can consider this source."
      : "Candidate rejected and remains blocked from intake and Metricool.",
  };
}

async function humanReviewSourceFileStatus(row) {
  const safeDirectory = String(row?.quarantineDirectory || "").replace(/[^A-Za-z0-9_-]/g, "");
  const safeFileName = path.basename(String(row?.localFile || ""));
  if (!safeDirectory || !safeFileName || safeFileName !== String(row?.localFile || "")) {
    return { ok: false, status: "invalid_review_source_path", filePath: "", bytes: 0 };
  }
  const quarantineRootStat = await lstat(quarantineDir).catch(() => null);
  if (quarantineRootStat?.isSymbolicLink()) return { ok: false, status: "quarantine_root_symlink_blocked", filePath: "", bytes: 0 };
  const directoryPath = path.join(quarantineDir, safeDirectory);
  const directoryStat = await lstat(directoryPath).catch(() => null);
  if (directoryStat?.isSymbolicLink()) return { ok: false, status: "review_source_directory_symlink_blocked", filePath: "", bytes: 0 };
  const filePath = path.join(directoryPath, safeFileName);
  const fileStat = await lstat(filePath).catch(() => null);
  if (fileStat?.isSymbolicLink()) return { ok: false, status: "review_source_file_symlink_blocked", filePath: "", bytes: 0 };
  if (!fileStat?.isFile()) return { ok: false, status: "review_source_file_missing", filePath: "", bytes: 0 };
  if (fileStat.size < 8192) return { ok: false, status: "review_source_file_too_small", filePath: "", bytes: fileStat.size };
  const quarantineReal = await realpath(quarantineDir).catch(() => null);
  const fileReal = await realpath(filePath).catch(() => null);
  if (!quarantineReal || !fileReal || (fileReal !== quarantineReal && !fileReal.startsWith(quarantineReal + path.sep))) {
    return { ok: false, status: "review_source_file_outside_quarantine", filePath: "", bytes: fileStat.size };
  }
  const prefix = await readFilePrefix(filePath, Math.min(4096, fileStat.size));
  if (!prefix || !prefix.toString("latin1").includes("ftyp")) {
    return { ok: false, status: "review_source_file_not_mp4_like", filePath: "", bytes: fileStat.size };
  }
  return { ok: true, status: "ready", filePath, bytes: fileStat.size };
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function promoteHumanReviewCandidate(input = {}, { skipLock = false } = {}) {
  if (!skipLock) {
    return withHumanReviewDecisionLock(() => withRealClipIntakeManifestLock(
      () => promoteHumanReviewCandidate(input, { skipLock: true }),
    ));
  }
  const id = String(input.id || "").trim();
  const metricoolQueueItemId = String(input.metricoolQueueItemId || "").trim();
  const originalStreamEndedAtInput = String(input.originalStreamEndedAt || "").trim();
  const promotionConfirmed = String(input.promotionConfirmed || "").trim();
  const finalOutputReviewed = String(input.finalOutputReviewed || "").trim();
  if (promotionConfirmed !== "yes") {
    return { ok: false, statusCode: 400, error: "human_review_promotion_confirmation_required", id, metricoolQueueItemId };
  }
  if (finalOutputReviewed !== "yes") {
    return { ok: false, statusCode: 400, error: "human_review_final_output_confirmation_required", id, metricoolQueueItemId };
  }
  const queue = await buildHumanReviewQueue();
  const reviewRow = queue.rows.find((row) => row.id === id);
  if (!reviewRow) return { ok: false, statusCode: 404, error: "human_review_candidate_not_found", id, metricoolQueueItemId };
  if (reviewRow.humanDecision !== "approved_for_intake") {
    return { ok: false, statusCode: 409, error: "human_review_approval_required", id, metricoolQueueItemId };
  }
  const target = queue.intakeTargets.find((row) => row.queueItemId === metricoolQueueItemId);
  if (!target) return { ok: false, statusCode: 404, error: "human_review_intake_target_not_found", id, metricoolQueueItemId };
  if (reviewRow.suggestedQueueItemId && reviewRow.suggestedQueueItemId !== metricoolQueueItemId) {
    return { ok: false, statusCode: 409, error: "human_review_target_does_not_match_candidate_mapping", id, metricoolQueueItemId };
  }
  const publishAtMs = Date.parse(String(target.publishAt || ""));
  if (!Number.isFinite(publishAtMs) || publishAtMs <= operatorNowMs() + 20 * 60_000) {
    return { ok: false, statusCode: 409, error: "human_review_target_schedule_requires_roll_forward", id, metricoolQueueItemId };
  }
  const campaign = await buildStreamer100Campaign();
  const permission = (campaign.permissionLedgerRows || []).find((row) => campaignRowMatchesHandle(row, reviewRow.creatorHandle));
  if (!permission || permission.permissionStatus !== "approved_blanket") {
    return { ok: false, statusCode: 409, error: "creator_blanket_permission_not_approved", id, metricoolQueueItemId };
  }
  if (!sourceUrlMatchesCreator(reviewRow.sourceUrl, permission.handle)) {
    return { ok: false, statusCode: 409, error: "source_url_creator_not_verified", id, metricoolQueueItemId };
  }
  const allowedAccountNames = Array.isArray(permission.restrictions?.allowedAccountNames)
    ? permission.restrictions.allowedAccountNames
    : [];
  if (allowedAccountNames.length && !allowedAccountNames.includes(target.accountName)) {
    return { ok: false, statusCode: 409, error: "creator_account_not_authorized", id, metricoolQueueItemId };
  }
  if (permission.restrictions?.noAi && reviewRow.recordedChecks?.aiUsed !== "no") {
    return { ok: false, statusCode: 409, error: "creator_no_ai_processing_not_verified", id, metricoolQueueItemId };
  }
  const evidenceStatus = await realClipEvidenceStatus(reviewRow.evidenceUrl);
  if (!evidenceStatus.ok) {
    return { ok: false, statusCode: 409, error: evidenceStatus.status, id, metricoolQueueItemId };
  }
  const originalStreamEndedAt = validatedOptionalTimestamp(originalStreamEndedAtInput, "original_stream_ended_at");
  if (!originalStreamEndedAt.ok) {
    return { ok: false, statusCode: 400, error: originalStreamEndedAt.error, id, metricoolQueueItemId };
  }
  const minimumDelayHours = Math.max(0, Number(permission.restrictions?.minimumPublishDelayHours || 0));
  if (minimumDelayHours > 0 && !originalStreamEndedAt.value) {
    return { ok: false, statusCode: 400, error: "original_stream_ended_at_required_for_creator_delay", id, metricoolQueueItemId };
  }
  if (minimumDelayHours > 0 && publishAtMs - originalStreamEndedAt.parsed < minimumDelayHours * 60 * 60 * 1000) {
    return { ok: false, statusCode: 409, error: "creator_minimum_publish_delay_not_met", id, metricoolQueueItemId };
  }
  const sourceStatus = await humanReviewSourceFileStatus(reviewRow);
  if (!sourceStatus.ok) return { ok: false, statusCode: 409, error: sourceStatus.status, id, metricoolQueueItemId };
  const categoryDir = await ensureSourceDropCategoryDir(target.category);
  if (!categoryDir.ok) return { ok: false, statusCode: 409, error: categoryDir.status, id, metricoolQueueItemId };
  const manifestLocation = await sourceDropManifestLocation(target.category);
  if (!manifestLocation.ok) return { ok: false, statusCode: 409, error: manifestLocation.status, id, metricoolQueueItemId };
  const manifestRaw = await readText(manifestLocation.manifestPath, "");
  const existingManifestRow = manifestRaw.trim()
    ? manifestRecordForTarget(parseCsv(manifestRaw).rows, target.targetFileName)
    : null;
  const existingManifestUrl = String(existingManifestRow?.url || "").trim();
  if (isExactSourceVideoOrPostUrl(existingManifestUrl) && existingManifestUrl !== reviewRow.sourceUrl) {
    return { ok: false, statusCode: 409, error: "target_manifest_source_conflict", id, metricoolQueueItemId };
  }
  const destinationPath = path.join(categoryDir.categoryDir, target.targetFileName);
  const destinationStat = await lstat(destinationPath).catch(() => null);
  if (destinationStat?.isSymbolicLink()) {
    return { ok: false, statusCode: 409, error: "target_source_file_symlink_blocked", id, metricoolQueueItemId };
  }
  let copiedSourceFile = false;
  let reusedDerivedTarget = false;
  let derivedTargetAiProcessing = "";
  if (destinationStat?.isFile()) {
    const [sourceHash, destinationHash] = await Promise.all([fileSha256(sourceStatus.filePath), fileSha256(destinationPath)]);
    if (sourceHash !== destinationHash) {
      const existingManifestSource = String(existingManifestRow?.source || existingManifestRow?.creator || existingManifestRow?.creator_or_rights_holder || "").trim();
      const existingManifestEvidence = String(existingManifestRow?.evidence_link || existingManifestRow?.evidence || existingManifestRow?.proof_url || existingManifestRow?.proof || "").trim();
      const existingRightsStatus = String(existingManifestRow?.rights_status || existingManifestRow?.rightsStatus || "").trim();
      const existingAiProcessing = String(existingManifestRow?.ai_processing || existingManifestRow?.aiProcessing || "").trim().toLowerCase();
      const existingNotes = String(existingManifestRow?.notes || "").trim();
      const deterministicDerivedProvenance = ["ffmpeg_no_ai", "deterministic_ffmpeg_no_ai"].includes(existingAiProcessing)
        || /rendered vertically without ai|deterministic ffmpeg/i.test(existingNotes);
      const provenanceAllowsCreator = !permission.restrictions?.noAi || deterministicDerivedProvenance;
      const derivedTargetMapped = existingManifestUrl === reviewRow.sourceUrl
        && campaignHandleKey(existingManifestSource) === campaignHandleKey(reviewRow.creatorHandle)
        && existingManifestEvidence === reviewRow.evidenceUrl
        && existingRightsStatus === "owned_or_permissioned"
        && provenanceAllowsCreator;
      const reviewDerivedTargetMapped = existingManifestUrl === reviewRow.sourceUrl
        && campaignHandleKey(existingManifestSource) === campaignHandleKey(reviewRow.creatorHandle)
        && existingManifestEvidence === reviewRow.evidenceUrl
        && existingRightsStatus === "review_required"
        && deterministicDerivedProvenance;
      if (!derivedTargetMapped && !reviewDerivedTargetMapped) {
        return { ok: false, statusCode: 409, error: "target_derived_file_provenance_missing", id, metricoolQueueItemId };
      }
      const derivedFileStatus = await sourceDropVideoStatus(target.category, target.targetFileName);
      if (!derivedFileStatus.ok) {
        return { ok: false, statusCode: 409, error: derivedFileStatus.status, id, metricoolQueueItemId };
      }
      reusedDerivedTarget = true;
      derivedTargetAiProcessing = existingAiProcessing
        || (deterministicDerivedProvenance ? "deterministic_ffmpeg_no_ai" : "ai_assisted");
    }
  } else if (destinationStat) {
    return { ok: false, statusCode: 409, error: "target_source_path_not_a_file", id, metricoolQueueItemId };
  } else {
    try {
      await copyFile(sourceStatus.filePath, destinationPath, fsConstants.COPYFILE_EXCL);
      copiedSourceFile = true;
    } catch (error) {
      return { ok: false, statusCode: error?.code === "EEXIST" ? 409 : 500, error: error?.code === "EEXIST" ? "target_source_file_conflict" : "review_source_copy_failed", id, metricoolQueueItemId };
    }
  }
  let result;
  try {
    result = await recordRealClipIntakeManifestRow({
      metricoolQueueItemId,
      exactVideoOrPostUrl: reviewRow.sourceUrl,
      creatorOrRightsHolder: reviewRow.creatorHandle,
      evidenceLink: reviewRow.evidenceUrl,
      operatorNotes: reviewRow.reviewNotes,
      aiProcessing: reusedDerivedTarget
        ? derivedTargetAiProcessing
        : (reviewRow.recordedChecks?.aiUsed === "no" ? "none" : "ai_assisted"),
      originalStreamEndedAt: originalStreamEndedAt.value,
      plannedPublishAt: target.publishAt,
      contextReviewStatus: "approved",
      creditText: `Credit: @${reviewRow.creatorHandle}`,
    }, { skipLock: true });
  } catch {
    if (copiedSourceFile) await rm(destinationPath, { force: true }).catch(() => {});
    return { ok: false, statusCode: 500, error: "real_clip_intake_manifest_write_failed", id, metricoolQueueItemId };
  }
  if (!result.ok && copiedSourceFile) await rm(destinationPath, { force: true }).catch(() => {});
  if (!result.ok) return result;
  return {
    ...result,
    status: result.rowStatus === "ready_for_source_drop_import" ? "human_review_promoted_to_intake" : "human_review_promoted_but_intake_blocked",
    sourceFileCopied: copiedSourceFile,
    reusedDerivedTarget,
    humanReviewCandidateId: id,
    unlocksMetricool: false,
    publishAllowed: false,
  };
}

function humanReviewStatusLabel(row) {
  if (humanReviewManifestRejected(row) || row.humanDecision === "rejected") return "Descartado";
  if (row.humanDecision === "approved_for_intake" && row.rightsStatus !== "approved_blanket") return "Contenido revisado · falta permiso";
  if (row.humanDecision === "approved_for_intake") return "Aprobado para intake";
  if (!row.fileReady) return "Falta archivo";
  if (row.rightsStatus !== "approved_blanket") return "Falta permiso verificado";
  return "Revisión humana pendiente";
}

function renderHumanReviewQueuePage(queue) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers Human Review Queue</title>
  <style>
    .review-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-top:1px solid #29372f;border-bottom:1px solid #29372f;margin:22px 0 28px}
    .review-stat{padding:16px;border-left:1px solid #29372f}.review-stat:first-child{border-left:0;padding-left:0}.review-stat strong{display:block;font-size:22px;margin-top:5px}
    .review-list{display:grid;grid-template-columns:1fr 1fr;gap:0 28px}.review-item{border-top:1px solid #29372f;padding:22px 0;min-width:0}
    .review-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px}.review-head h2{margin:0}.review-meta{color:#9eaca4;font-size:12px;margin-top:5px}
    .review-status{border:1px solid #52635a;border-radius:999px;padding:5px 8px;font-size:11px;white-space:nowrap}.review-status.rejected{border-color:#74433e;color:#ff9d95}.review-status.approved{border-color:#3f765a;color:#a8efc6}
    video{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#050806;margin:0 0 13px}
    .review-preview{display:block;margin:0 0 13px}.review-preview span{display:block;color:#9eaca4;font-size:12px;margin-bottom:7px}.review-preview img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#050806}
    .review-checks{display:grid;grid-template-columns:1fr 1fr;gap:7px 18px;margin:13px 0}.review-check{font-size:12px;color:#c9d2cd}.review-check strong{color:#fff}
    .review-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.review-links a{border:1px solid #29372f;border-radius:6px;padding:8px 10px;text-decoration:none;font-size:12px}
    .review-note{font-size:12px;color:#9eaca4;border-left:2px solid #52635a;padding-left:10px;margin-top:13px}
    .review-form{margin-top:16px;border-top:1px solid #29372f;padding-top:13px}.review-form form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.review-form label{font-size:12px;color:#c9d2cd}.review-form select,.review-form textarea{width:100%;margin-top:5px}.review-form textarea{grid-column:1/-1;min-height:76px}.review-form .full{grid-column:1/-1}.review-saved{color:#a8efc6;font-size:12px;margin-top:13px}
    @media(max-width:800px){.review-summary{grid-template-columns:repeat(2,1fr)}.review-stat:nth-child(odd){border-left:0;padding-left:0}.review-list{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <h1>Revisión humana de clips</h1>
  <p>Revisa cada archivo y registra una decisión local. Aprobar aquí solo lo deja listo para el intake separado: no mueve archivos, no habilita Metricool y no publica.</p>
  <div class="review-summary">
    <div class="review-stat"><span class="label">Candidatos</span><strong>${escapeHtml(queue.totals.rows)}</strong></div>
    <div class="review-stat"><span class="label">Archivos</span><strong>${escapeHtml(queue.totals.filesReady)}/${escapeHtml(queue.totals.rows)}</strong></div>
    <div class="review-stat"><span class="label">Por revisar</span><strong>${escapeHtml(queue.totals.reviewRequired)}</strong></div>
    <div class="review-stat"><span class="label">Aprobados</span><strong>${escapeHtml(queue.totals.approvedForIntake)}</strong></div>
    <div class="review-stat"><span class="label">Sin IA</span><strong>${escapeHtml(queue.totals.noAi)}</strong></div>
  </div>
  <div class="actions"><a href="/api/clippers/real-clip-intake.html">Abrir intake después de aprobar</a><a href="/clippers">Volver al inicio</a></div>
  ${queue.staleIntakeTargets ? `<form method="post" action="/api/clippers/roll-forward">
    <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
    <input type="hidden" name="returnTo" value="/api/clippers/human-review-queue.html" />
    <p class="review-note">Las ${escapeHtml(queue.staleIntakeTargets)} filas de destino necesitan un horario futuro antes de promover clips.</p>
    <button type="submit">Actualizar horario local</button>
  </form>` : ""}
  <section class="review-list" aria-label="Candidatos en revisión">
    ${queue.rows.map((row) => {
      const rejected = humanReviewManifestRejected(row) || row.humanDecision === "rejected";
      const approved = row.humanDecision === "approved_for_intake" && !rejected;
      return `<article class="review-item">
        <div class="review-head"><div><h2>${escapeHtml(row.title)}</h2><div class="review-meta">${escapeHtml(row.creator)} · ${escapeHtml(row.sourceAge)} · ${escapeHtml(row.sourceViews)} vistas históricas</div></div><span class="review-status${rejected ? " rejected" : approved ? " approved" : ""}">${escapeHtml(humanReviewStatusLabel(row))}</span></div>
        ${row.contactSheetUrl ? `<a class="review-preview" href="${escapeHtml(row.contactSheetUrl)}" target="_blank" rel="noopener noreferrer"><span>Vista rápida · abre la imagen completa</span><img loading="lazy" src="${escapeHtml(row.contactSheetUrl)}" alt="Seis fotogramas para revisar visualmente ${escapeHtml(row.title)}" /></a>` : ""}
        ${row.mediaUrl ? `<video controls preload="metadata" src="${escapeHtml(row.mediaUrl)}"></video>` : `<p class="review-note">Falta el archivo local.</p>`}
        <div class="review-checks">
          <div class="review-check"><strong>Derechos:</strong> ${escapeHtml(row.rightsStatus)}</div>
          <div class="review-check"><strong>Audio:</strong> ${escapeHtml(row.audioReview)}</div>
          <div class="review-check"><strong>Contexto:</strong> ${escapeHtml(row.contextReview)}</div>
          <div class="review-check"><strong>Terceros:</strong> ${escapeHtml(row.thirdPartyReview)}</div>
          <div class="review-check"><strong>IA:</strong> ${escapeHtml(row.restrictionsVerified ? (row.noAiRequired ? "prohibida" : "sin restricción registrada") : "restricciones sin verificar")}</div>
          <div class="review-check"><strong>Metricool:</strong> bloqueado</div>
        </div>
        <p class="review-note">${escapeHtml(row.notes)}</p>
        ${row.humanReviewComplete ? `<p class="review-saved"><strong>Decisión guardada:</strong> ${escapeHtml(humanReviewStatusLabel(row))} · ${escapeHtml(row.reviewedAt)}<br />${escapeHtml(row.reviewNotes)}</p>` : ""}
        ${approved && row.suggestedQueueItemId ? `<p class="review-note"><strong>Intake:</strong> ${escapeHtml(row.suggestedTargetStatus)}${row.suggestedTargetBlockers.length ? ` · ${escapeHtml(row.suggestedTargetBlockers.join(", "))}` : ""}</p>
        <video controls preload="metadata" src="${escapeHtml(queue.intakeTargets.find((target) => target.queueItemId === row.suggestedQueueItemId)?.targetMediaUrl || "")}"></video>
        <p class="review-note">Resultado vertical asociado. Revísalo completo antes de promover.</p>` : ""}
        <div class="review-links">${row.sourceUrl ? `<a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">Fuente exacta</a>` : ""}${row.evidenceUrl ? `<a href="${escapeHtml(row.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Evidencia de permiso</a>` : `<span class="review-note">Sin evidencia externa de permiso</span>`}</div>
        ${humanReviewManifestRejected(row) ? "" : `<details class="review-form">
          <summary>${row.humanReviewComplete ? "Cambiar decisión" : "Registrar decisión"}</summary>
          <form method="post" action="/api/clippers/human-review-decision">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
            <input type="hidden" name="returnTo" value="/api/clippers/human-review-queue.html" />
            <input type="hidden" name="id" value="${escapeHtml(row.id)}" />
            <label>Decisión<select name="decision" required><option value="approved_for_intake">Aprobar para intake</option><option value="rejected">Descartar</option></select></label>
            <label>Audio<select name="audioStatus" required><option value="approved">Aprobado</option><option value="rejected">Rechazado</option></select></label>
            <label>Contexto<select name="contextStatus" required><option value="approved">Aprobado</option><option value="rejected">Rechazado</option></select></label>
            <label>Material de terceros<select name="thirdPartyStatus" required><option value="approved">Aprobado</option><option value="rejected">Rechazado</option></select></label>
            <label>¿Se usó IA?<select name="aiUsed" required><option value="no">No</option><option value="yes">Sí</option></select></label>
            <label class="full"><input type="checkbox" name="humanReviewConfirmed" value="yes" required /> Confirmo que una persona reprodujo y revisó el clip completo.</label>
            ${row.noAiRequired ? `<p class="review-note full">Este creador prohíbe IA. Solo se acepta “No” en la revisión.</p>` : ""}
            <label class="full">Notas concretas (20+ caracteres)<textarea name="notes" minlength="20" required placeholder="Describe qué verificaste en audio, contexto y terceros."></textarea></label>
            <button class="full" type="submit">Guardar decisión local</button>
          </form>
        </details>`}
        ${approved ? `<details class="review-form">
          <summary>Promover al intake real</summary>
          <form method="post" action="/api/clippers/human-review-promote">
            <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
            <input type="hidden" name="returnTo" value="/api/clippers/human-review-queue.html" />
            <input type="hidden" name="id" value="${escapeHtml(row.id)}" />
            <label class="full">Destino<select name="metricoolQueueItemId" required>
              ${queue.intakeTargets.map((target) => `<option value="${escapeHtml(target.queueItemId)}"${target.queueItemId === row.suggestedQueueItemId ? " selected" : ""}>${escapeHtml(target.accountName)} · ${escapeHtml(target.targetFileName)} · ${escapeHtml(target.publishAt)}</option>`).join("")}
            </select></label>
            <label class="full">Fin del stream original (ISO 8601; obligatorio cuando exista demora mínima)<input name="originalStreamEndedAt" placeholder="2026-07-20T18:30:00Z" /></label>
            <label class="full"><input type="checkbox" name="finalOutputReviewed" value="yes" required /> Revisé completo el resultado vertical asociado y confirmé audio, contexto, terceros y procesamiento sin IA.</label>
            <label class="full"><input type="checkbox" name="promotionConfirmed" value="yes" required /> Confirmo el destino. La acción prepara source-drop e intake, pero no publica.</label>
            <button class="full" type="submit">Promover de forma segura</button>
          </form>
        </details>` : ""}
      </article>`;
    }).join("")}
  </section>
</main></body></html>`;
}

function renderHome(status) {
  const preflightTotal = Number(status.preflight.passed || 0) + Number(status.preflight.failed || 0);
  const nextExternalRepair = status.externalEvidenceValidation.nextRepair;
  const nextExternalRepairIsActive = nextExternalRepair && !nextExternalRepair.deferredForMetricoolMvp;
  const realClipIntakeBlocked = status.realClipIntakeValidation?.status && !realClipIntakeReadyForScheduling(status.realClipIntakeValidation.status);
  const dashboardAction = status.nextBestAction || status.streamerGrowthCeo?.nextAction;
  const metricoolReadyLanes = Number(status.metricoolMvp?.activeReadyLanes || 0);
  const metricoolTargetLanes = Number(status.metricoolMvp?.activeTargetLanes || 0);
  const metricoolAccountsReady = metricoolTargetLanes > 0 && metricoolReadyLanes >= metricoolTargetLanes;
  const baselineKnown = status.streamerGrowthCeo?.progressKnown === true;
  const realClipsReady = Number(status.realClipIntakeValidation?.readyRows || 0);
  const realClipsTotal = Number(status.realClipIntakeValidation?.totalRows || 0);
  const scheduledRows = Number(status.scheduled || 0);
  const measuredRows = Number(status.publicMetricsRunSheet?.readyRows || 0);
  const dashboardCopy = dashboardAction.stage === "real_clip_intake_required"
    ? {
        title: "Reemplaza los videos de prueba por clips reales",
        detail: `${status.realClipIntakeValidation?.blockedRows || 0} clips necesitan URL exacta, permiso y archivo fuente antes de pasar a Metricool.`,
        action: "Cargar clips reales",
      }
    : dashboardAction.stage === "capture_metricool_baseline"
      ? {
          title: "Importa el punto de partida desde Metricool",
          detail: "Faltan los seguidores y vistas reales de ambas cuentas. No se mostrarán estimados.",
          action: "Abrir control de crecimiento",
        }
      : {
          title: dashboardAction.title,
          detail: dashboardAction.detail,
          action: dashboardAction.primaryAction,
        };
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers TikTok Metricool Operator</title>
  <style>
    :root{color-scheme:dark;--bg:#0b100e;--surface:#111814;--surface-2:#16201b;--line:#29372f;--muted:#9eaca4;--text:#f4f7f5;--green:#52d98b;--green-dark:#153723;--amber:#f3bd62;--red:#ff7b72;--blue:#77bdfb}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:var(--bg);color:var(--text)}
    main{max-width:1180px;margin:0 auto;padding:0 24px 72px}
    h1,h2,h3,p{margin-top:0}
    h1{font-size:30px;line-height:1.15;margin-bottom:7px;letter-spacing:0}
    h2{font-size:20px;letter-spacing:0}
    p,li{color:#c9d2cd;line-height:1.55}
    a{color:#a8d7ff}
    .topbar{min-height:62px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:18px}
    .brand{font-weight:800;color:#fff;text-decoration:none;font-size:18px}
    .top-status{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:13px}
    .dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(82,217,139,.12)}
    .dot.pending{background:var(--amber);box-shadow:0 0 0 3px rgba(243,189,98,.12)}
    .hero{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(290px,.75fr);gap:42px;padding:38px 0 32px;align-items:start}
    .hero-copy>p{max-width:680px;margin-bottom:0;color:var(--muted)}
    .eyebrow,.label{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:750;letter-spacing:.08em}
    .action-panel{border-left:3px solid var(--green);padding:3px 0 3px 20px}
    .action-panel h2{font-size:19px;margin:8px 0}
    .action-panel p{font-size:14px;margin-bottom:14px}
    .badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:5px 9px;font-size:12px;color:#d7e0db;background:var(--surface)}
    .primary-link,.secondary-link,button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border-radius:6px;padding:9px 13px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer}
    .primary-link,button{border:1px solid #4fe08b;background:var(--green);color:#07130c}
    .primary-link:hover,button:hover{background:#75e5a4}
    .secondary-link{border:1px solid var(--line);background:var(--surface-2);color:#e8efeb}
    .secondary-link:hover{border-color:#506158}
    .quick-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:18px}
    .workflow-band{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:25px 0;margin-bottom:8px}
    .workflow-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:18px}
    .workflow-head h2{margin-bottom:4px}
    .workflow-head p{font-size:13px;margin-bottom:0;color:var(--muted)}
    .flow{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,1fr)}
    .flow li{position:relative;padding:0 18px 0 28px;min-height:72px;border-left:1px solid var(--line)}
    .flow li:first-child{border-left:0;padding-left:0}
    .flow-index{display:block;color:var(--muted);font-size:11px;font-weight:800;margin-bottom:7px}
    .flow strong{display:block;color:var(--text);font-size:14px;margin-bottom:3px}
    .flow span:last-child{font-size:12px;color:var(--muted)}
    .flow .active strong{color:var(--amber)}
    .flow .done strong{color:var(--green)}
    .grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));margin:0 0 32px;border-bottom:1px solid var(--line)}
    .grid .card{padding:18px 16px;border:0;border-left:1px solid var(--line);min-width:0}
    .grid .card:first-child{border-left:0;padding-left:0}
    .value{font-size:22px;font-weight:800;color:#fff;margin-top:5px;overflow-wrap:anywhere}
    .grid .small{margin:7px 0 0}
    .section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;padding:30px 0 8px}
    .section-heading p{font-size:13px;color:var(--muted);margin:0}
    .card{border:0;border-top:1px solid var(--line);background:transparent;border-radius:0;padding:24px 0;margin:0}
    .card .card{margin-top:20px;padding:20px 0 0}
    .small{font-size:12px;color:var(--muted)}
    .tools{margin:0 0 8px;border-bottom:1px solid var(--line);padding:0 0 22px}
    .tools>summary,.diagnostics>summary,.card>details>summary{list-style:none;cursor:pointer;color:#dbe5df;font-weight:750;padding:12px 0}
    .tools>summary::-webkit-details-marker,.diagnostics>summary::-webkit-details-marker,.card>details>summary::-webkit-details-marker{display:none}
    .tools>summary::after,.diagnostics>summary::after,.card>details>summary::after{content:"+";float:right;color:var(--muted)}
    .tools[open]>summary::after,.diagnostics[open]>summary::after,.card>details[open]>summary::after{content:"-"}
    .diagnostics{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 0 18px}
    .diagnostics>summary{font-size:16px}
    .actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}
    .actions a{border:1px solid var(--line);background:var(--surface);border-radius:6px;padding:10px 12px;text-decoration:none;color:#dbe5df;font-size:13px;overflow-wrap:anywhere}
    .actions form{margin:0}
    .actions button{width:100%;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px;display:block;overflow-x:auto}
    thead,tbody{display:table;width:100%;min-width:720px;table-layout:fixed}
    th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
    td{color:#edf4f0}
    .clip-caption{color:#c7d0dc;max-width:260px}
    details{margin-top:6px}
    summary{cursor:pointer;color:#a8d7ff}
    input,textarea{width:100%;border:1px solid #3a4c42;background:#0d1410;color:#eef7f1;border-radius:6px;padding:10px;margin:6px 0;font:inherit}
    textarea{min-height:86px}
    pre{white-space:pre-wrap;word-break:break-word;background:#0d1410;border:1px solid var(--line);border-radius:6px;padding:12px;color:#dceae2;max-width:100%;overflow:auto}
    code{background:#111a15;border:1px solid var(--line);border-radius:5px;padding:2px 5px;color:#d9eee2}
    .guardrail{border-top:1px solid var(--line);margin-top:24px;padding-top:22px;color:var(--muted);font-size:13px}
    @media(max-width:860px){
      main{padding:0 18px 52px}.hero{grid-template-columns:1fr;gap:25px;padding:30px 0}.flow{grid-template-columns:1fr}.flow li,.flow li:first-child{border-left:2px solid var(--line);padding:0 0 18px 18px;min-height:0}.flow .active{border-color:var(--amber)}.grid{grid-template-columns:repeat(2,1fr)}.grid .card,.grid .card:first-child{padding:15px 12px;border-left:1px solid var(--line)}.grid .card:nth-child(odd){border-left:0;padding-left:0}.actions{grid-template-columns:1fr}.workflow-head{align-items:start;flex-direction:column}.top-status span:last-child{display:none}
    }
  </style>
</head>
<body>
<main>
  <nav class="topbar" aria-label="Navegación principal">
    <a class="brand" href="/clippers">Clippers</a>
    <div class="top-status"><span class="dot${metricoolAccountsReady ? "" : " pending"}" aria-hidden="true"></span><span>${escapeHtml(metricoolAccountsReady ? `${metricoolReadyLanes} cuentas listas para Metricool` : "Conexión pendiente de confirmar")}</span><span class="badge">Aprobación manual</span></div>
  </nav>
  <header class="hero">
    <div class="hero-copy">
      <div class="eyebrow">Centro de operación</div>
      <h1>De video viral a clip publicado</h1>
      <p>Encuentra clips reales, confirma permisos, prepara el archivo y envíalo a Metricool. La app bloquea cualquier video sin fuente o derechos comprobados.</p>
      <nav class="quick-actions" aria-label="Acciones frecuentes">
        <a class="secondary-link" href="/api/clippers/real-clip-source-hunt.html">Buscar videos</a>
        <a class="secondary-link" href="/api/clippers/real-clip-exact-source-candidate.html">Guardar candidato</a>
        <a class="secondary-link" href="/api/clippers/real-clip-permission-crm.html">Gestionar permisos</a>
        <a class="secondary-link" href="/api/clippers/human-review-queue.html">Revisar candidatos</a>
        <a class="secondary-link" href="/api/clippers/real-clip-acquisition-workbench.html">Preparar clips</a>
      </nav>
    </div>
    <section class="action-panel" aria-labelledby="next-action-title">
      <div class="eyebrow">Haz esto ahora</div>
      <h2 id="next-action-title">${escapeHtml(dashboardCopy.title)}</h2>
      <p>${escapeHtml(dashboardCopy.detail)}</p>
      <span class="badge">${escapeHtml([dashboardAction.stage, dashboardAction.brand].filter(Boolean).join(" · "))}</span>
      <div class="quick-actions">
        ${dashboardAction.primaryHref ? `<a class="primary-link" href="${escapeHtml(dashboardAction.primaryHref)}">${escapeHtml(dashboardCopy.action)}</a>` : ""}
        ${dashboardAction.endpoint ? `<form method="post" action="${escapeHtml(dashboardAction.endpoint)}"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" /><button type="submit">${escapeHtml(dashboardCopy.action)}</button></form>` : ""}
        <form method="get" action="/clippers"><button type="submit">Actualizar estado</button></form>
        ${!baselineKnown ? `<a class="secondary-link" href="/api/clippers/streamer-growth-ceo.html">Ver meta 10K y baseline</a>` : ""}
      </div>
    </section>
  </header>
  <section class="workflow-band" aria-labelledby="workflow-title">
    <div class="workflow-head"><div><h2 id="workflow-title">Flujo de trabajo</h2><p>Completa cada etapa en orden. Metricool solo se habilita cuando el clip es real y tiene permiso.</p></div><span class="badge">${escapeHtml(realClipsReady)}/${escapeHtml(realClipsTotal)} clips validados</span></div>
    <ol class="flow">
      <li class="${realClipsReady > 0 ? "done" : "active"}"><span class="flow-index">01</span><strong>Descubrir</strong><span>URL exacta y creador</span></li>
      <li class="${realClipsReady > 0 ? "done" : ""}"><span class="flow-index">02</span><strong>Permisos</strong><span>Evidencia verificable</span></li>
      <li class="${realClipsReady > 0 ? "done" : ""}"><span class="flow-index">03</span><strong>Preparar</strong><span>Archivo fuente real</span></li>
      <li class="${scheduledRows > 0 ? "done" : ""}"><span class="flow-index">04</span><strong>Metricool</strong><span>Aprobación y agenda</span></li>
      <li class="${measuredRows > 0 ? "done" : ""}"><span class="flow-index">05</span><strong>Optimizar</strong><span>Métricas 24h y 72h</span></li>
    </ol>
  </section>
  <div class="grid">
    <div class="card"><div class="label">Cuentas listas</div><div class="value">${escapeHtml(status.metricoolMvp.activeReadyLanes)}/${escapeHtml(status.metricoolMvp.activeTargetLanes)}</div></div>
    <div class="card"><div class="label">Clips reales</div><div class="value">${escapeHtml(realClipsReady)}/${escapeHtml(realClipsTotal)}</div></div>
    <div class="card"><div class="label">En Metricool</div><div class="value">${escapeHtml(scheduledRows)}</div></div>
    <div class="card"><div class="label">Con métricas</div><div class="value">${escapeHtml(measuredRows)}</div></div>
    <div class="card"><div class="label">Meta seguidores</div><div class="value">10K</div><p class="small">por cuenta</p></div>
    <div class="card"><div class="label">Baseline</div><div class="value">${escapeHtml(baselineKnown ? status.streamerGrowthCeo.currentFollowers : "Pendiente")}</div></div>
  </div>
  <details class="tools">
    <summary>Herramientas, reportes y archivos avanzados</summary>
  <div class="actions">
    ${link(status.paths.cockpit, "Operator cockpit")}
    ${link("/clippers-workspace/OPEN_ME.html", "Open Clippers Ops")}
    ${link("/clippers-workspace/reports/index.html", "TikTok ops index")}
    ${link("/clippers-workspace/reports/metricool-owned-tiktok-approval-pack.csv", "Metricool owned CSV")}
    ${link("/clippers-workspace/reports/tiktok-metricool-go-live-handoff.md", "TikTok handoff")}
    ${link(status.paths.uploadPack, "Upload pack")}
    ${link(status.paths.runbook, "Runbook")}
    ${link(status.paths.evidenceCsv, "Evidence CSV")}
    ${link(status.paths.sessionPacket, "Session packet")}
    ${link(status.paths.accountReadiness, "Account readiness")}
    ${link(status.paths.tiktokCloseout, "TikTok closeout")}
    ${link("/api/clippers/tiktok-batch-schedule-now.html", "TikTok batch now")}
    ${link("/api/clippers/tiktok-public-metrics-now.html", "Public metrics now")}
    ${link("/api/clippers/next-metricool-action.html", "Metricool now")}
    ${link("/api/clippers/tiktok-current-action.md", "Current TikTok packet")}
    ${link("/api/clippers/tiktok-current-action.json", "Current TikTok JSON")}
    ${link("/api/clippers/tiktok-current-caption.txt", "Current caption TXT")}
    ${link("/api/clippers/tiktok-current-video.mp4", "Current video MP4")}
    ${link("/api/clippers/next-metricool-action.md", "Next action packet")}
    ${link("/api/clippers/next-metricool-action.json", "Next action JSON")}
    ${link("/api/clippers/tiktok-batch-account-summary.json", "Account summary JSON")}
    ${link("/api/clippers/tiktok-batch-account-summary.csv", "Account summary CSV")}
    ${link("/api/clippers/tiktok-batch-account-summary.md", "Account summary MD")}
    ${link("/api/clippers/tiktok-account-queues.json", "Account queues JSON")}
    ${link("/api/clippers/tiktok-account-queues.csv", "Account queues CSV")}
    ${link("/api/clippers/tiktok-account-queues.md", "Account queues MD")}
    ${link("/api/clippers/tiktok-current-account-now.html", "Current TikTok now")}
    ${link("/api/clippers/tiktok-current-next-upload-checklist.csv", "Current upload CSV")}
    ${link("/api/clippers/tiktok-current-next-scheduled-proof-starter.csv", "Current proof CSV")}
    ${link("/api/clippers/tiktok-account-now.html?accountId=sports-daily", "SPORT now")}
    ${link("/api/clippers/tiktok-account-now.html?accountId=meme-radar", "memes now")}
    ${link("/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=sports-daily", "SPORT next upload CSV")}
    ${link("/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=meme-radar", "memes next upload CSV")}
    ${link("/api/clippers/tiktok-account-next.json?accountId=sports-daily", "SPORT next JSON")}
    ${link("/api/clippers/tiktok-account-next.json?accountId=meme-radar", "memes next JSON")}
    ${link("/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily", "SPORT next proof CSV")}
    ${link("/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=meme-radar", "memes next proof CSV")}
    ${link("/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=sports-daily", "SPORT proof CSV")}
    ${link("/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=meme-radar", "memes proof CSV")}
    ${link("/api/clippers/tiktok-account-runbook.md?accountId=sports-daily", "SPORT runbook")}
    ${link("/api/clippers/tiktok-account-runbook.md?accountId=meme-radar", "memes runbook")}
    ${link("/api/clippers/operator-brief.md", "Operator brief")}
    ${link("/api/clippers/operator-report.md", "Operator report")}
    ${link("/api/clippers/go-live-gap-resolver.html", "Go-live gap resolver")}
    ${link("/api/clippers/go-live-gap-resolver.json", "Go-live gaps JSON")}
    ${link("/api/clippers/go-live-gap-resolver.md", "Go-live gaps MD")}
    ${link("/api/clippers/streamer-growth-ceo.html", "Streamer Growth CEO")}
    ${link("/api/clippers/streamer-growth-ceo.json", "CEO growth JSON")}
    ${link("/api/clippers/streamer-growth-ceo.md", "CEO growth report")}
    ${link("/api/clippers/streamer-100-campaign.html", "100 streamer campaign")}
    ${link("/api/clippers/streamer-100-campaign.json", "100 streamer JSON")}
    ${link("/api/clippers/streamer-100-campaign.csv", "100 streamer CSV")}
    ${link("/api/clippers/goal-gaps.json", "Goal gaps JSON")}
    ${link("/api/clippers/goal-gaps.md", "Goal gaps MD")}
    ${link("/api/clippers/real-clip-gap.json", "Real clip gap JSON")}
    ${link("/api/clippers/real-clip-gap.md", "Real clip gap MD")}
    ${link("/api/clippers/real-clip-intake.html", "Real clip intake")}
    ${link("/api/clippers/real-clip-acquisition-workbench.html", "Real clip acquisition")}
    ${link("/api/clippers/real-clip-exact-source-candidate.html", "Exact source candidates")}
    ${link("/api/clippers/real-clip-intake-manifest.csv", "Real clip manifest CSV")}
    ${link("/api/clippers/real-clip-intake-validation.html", "Real clip validation")}
    ${link("/api/clippers/real-clip-source-hunt.html", "Source hunt")}
    ${link("/api/clippers/real-clip-permission-crm.html", "Permission CRM")}
    ${link("/api/clippers/real-clip-permission-request-packets.html", "Permission request packets")}
    ${link("/api/clippers/real-clip-permission-outreach.html", "Permission outreach")}
    ${link("/api/clippers/tiktok-launch-authorization.html", "TikTok authorization")}
    ${link("/api/clippers/operator-ready.json", "Ready JSON")}
    ${link("/api/clippers/evidence-integrity.json", "Evidence integrity")}
    <form method="post" action="/api/clippers/refresh"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" /><button type="submit">Regenerar reportes</button></form>
    <form method="post" action="/api/clippers/roll-forward"><input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" /><button type="submit">Roll forward schedule</button></form>
  </div>
  </details>
  <div class="section-heading"><div><div class="eyebrow">Operación diaria</div><h2>Qué está bloqueado y cómo resolverlo</h2></div><p>Los detalles técnicos quedan debajo; abre solo la sección que necesites.</p></div>
  <details class="diagnostics">
    <summary>Ver diagnóstico completo, tablas y formularios</summary>
  <div class="card">
    <div class="label">TikTok Ops Index</div>
    <p><strong>generated drafts blocked, real clips blocked</strong> · ${escapeHtml(status.realClipGap?.generatedOwnedRows || 0)} generated draft rows are not eligible for Metricool · ${escapeHtml(status.realClipIntakeValidation?.readyRows || 0)} validated real clips ready.</p>
    <p class="small">Open this first for the current source of truth: ${link("/clippers-workspace/reports/index.html", "TikTok ops index")} · ${link("/clippers-workspace/reports/metricool-owned-tiktok-approval-pack.csv", "Generated draft inventory")} · ${link("/clippers-workspace/reports/tiktok-real-clip-readiness.md", "Real clip audit")}</p>
  </div>
  <div class="card">
    <div class="label">Go-live gap resolver</div>
    <p><strong>${escapeHtml(status.goLiveGapResolver.status)}</strong> · Can schedule Metricool: ${escapeHtml(status.goLiveGapResolver.canScheduleMetricool ? "yes" : "no")}</p>
    <p>${escapeHtml(status.goLiveGapResolver.summary)}</p>
    <p class="small">${escapeHtml(status.goLiveGapResolver.nextAction)} · ${link("/api/clippers/go-live-gap-resolver.html", "Open resolver")}</p>
  </div>
  <div class="card">
    <div class="label">Exact source candidates</div>
    <p><strong>candidate_inbox</strong> · Save exact TikTok, Twitch clip, or YouTube video URL + creator without approving rights.</p>
    <p class="small">Use this after Source Hunt to populate Permission Request Packets. ${link("/api/clippers/real-clip-exact-source-candidate.html", "Open candidate inbox")}</p>
  </div>
  <div class="card">
    <div class="label">Real clip acquisition</div>
    <p><strong>workbench</strong> · One row-by-row path from placeholder to approved source-drop file.</p>
    <p class="small">Use this to work each queue row through source hunt, permission CRM, evidence, source file, and intake validation. ${link("/api/clippers/real-clip-acquisition-workbench.html", "Open acquisition workbench")}</p>
  </div>
  <div class="card">
    <div class="label">Source hunt</div>
    <p><strong>needs_real_clip_source_hunt</strong> · Rows ${escapeHtml(status.realClipIntakeValidation.totalRows)} · Blocked ${escapeHtml(status.realClipIntakeValidation.blockedRows)}</p>
    <p class="small">Use this to find exact creator videos and reject unsafe sources before recording intake. ${link("/api/clippers/real-clip-source-hunt.html", "Open source hunt")}</p>
  </div>
  <div class="card">
    <div class="label">Permission request packets</div>
    <p><strong>permission_requests</strong> · Copy-ready messages only after exact URL + creator are known.</p>
    <p class="small">Use this after Source Hunt; a sent request is not approval. ${link("/api/clippers/real-clip-permission-request-packets.html", "Open request packets")}</p>
  </div>
  <div class="card">
    <div class="label">Permission CRM</div>
    <p><strong>tracks_outreach_only</strong> · Records contact/response/proof status without unlocking publishing.</p>
    <p class="small">Use this after Source Hunt to track creator contact and permission state. ${link("/api/clippers/real-clip-permission-crm.html", "Open permission CRM")}</p>
  </div>
  <div class="card">
    <div class="label">Permission outreach</div>
    <p><strong>needs_permission_outreach</strong> · Permission rows ${escapeHtml(status.realClipGap.missingRealClips)} · Track real responses in Permission CRM.</p>
    <p class="small">Use this to request creator permission before moving any clip into source-drop as owned_or_permissioned. ${link("/api/clippers/real-clip-permission-outreach.html", "Open outreach pack")}</p>
  </div>
  <div class="card">
    <div class="label">Real clip intake validation</div>
    <p><strong>${escapeHtml(status.realClipIntakeValidation.status)}</strong> · Ready ${escapeHtml(status.realClipIntakeValidation.readyRows)}/${escapeHtml(status.realClipIntakeValidation.totalRows)} · Blocked ${escapeHtml(status.realClipIntakeValidation.blockedRows)}</p>
    <p>${escapeHtml(status.realClipIntakeValidation.summary)}</p>
    <p class="small">${escapeHtml(status.realClipIntakeValidation.nextAction)} · ${link("/api/clippers/real-clip-intake-validation.html", "Open validation")}</p>
  </div>
  <div class="card">
    <div class="label">Real clip gap</div>
    <p><strong>${escapeHtml(status.realClipGap.status)}</strong> · Real clips ${escapeHtml(status.realClipGap.realClipRows)}/${escapeHtml(status.realClipGap.totalRows)} · Generated owned placeholders ${escapeHtml(status.realClipGap.generatedOwnedRows)} · Missing real clips ${escapeHtml(status.realClipGap.missingRealClips)}</p>
    <p>${escapeHtml(status.realClipGap.summary)}</p>
    <p class="small">${escapeHtml(status.realClipGap.nextAction)} · ${link("/api/clippers/real-clip-gap.md", "Open markdown")} · ${link("/api/clippers/real-clip-intake.html", "Open intake pack")}</p>
    <table>
      <thead>
        <tr>
          <th>Queue</th>
          <th>Account</th>
          <th>Source kind</th>
          <th>File</th>
        </tr>
      </thead>
      <tbody>
        ${status.realClipGap.rows.map((row) => `<tr>
          <td>${escapeHtml(row.queueItemId)}<div class="small">#${escapeHtml(row.rank)}</div></td>
          <td>${escapeHtml(row.brand)}<div class="small">${escapeHtml(row.accountName)}</div></td>
          <td>${escapeHtml(row.sourceKind)}<div class="small">${escapeHtml(row.detail)}</div></td>
          <td>${escapeHtml(row.sourceFileName || row.uploadFileName || "missing")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Upload pack integrity</div>
    <p><strong>${escapeHtml(status.uploadPackIntegrity.status)}</strong> · ${escapeHtml(status.uploadPackIntegrity.readyFiles)}/${escapeHtml(status.uploadPackIntegrity.totalRows)} files ready · Missing ${escapeHtml(status.uploadPackIntegrity.missingFiles)} · Zero-byte ${escapeHtml(status.uploadPackIntegrity.zeroByteFiles)} · Bytes ${escapeHtml(status.uploadPackIntegrity.totalBytes)}</p>
    <p class="small">Metricool scheduling is blocked if any required local MP4 is missing or empty.</p>
    ${status.uploadPackIntegrity.blockedRows.length ? `<table>
      <thead>
        <tr>
          <th>Queue</th>
          <th>Account</th>
          <th>File</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${status.uploadPackIntegrity.blockedRows.map((row) => `<tr>
          <td>${escapeHtml(row.queueItemId)}<div class="small">#${escapeHtml(row.rank)}</div></td>
          <td>${escapeHtml(row.brand)}<div class="small">${escapeHtml(row.accountName)}</div></td>
          <td>${row.uploadFileUrl ? link(row.uploadFileUrl, row.uploadFileName || "MP4") : escapeHtml(row.uploadFileName || "missing")}</td>
          <td>${escapeHtml(row.exists ? `${row.bytes} bytes` : "missing")}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="small">All required local MP4 files are present and non-empty.</p>`}
  </div>
  <div class="card">
    <div class="label">Siguiente paso</div>
    <p>${escapeHtml(status.nextStep || "Open Metricool and process the current batch.")}</p>
  </div>
  <div class="card">
    <div class="label">TikTok + Metricool MVP</div>
    <p><strong>${escapeHtml(status.metricoolMvp.status)}</strong> · ${escapeHtml(status.metricoolMvp.launchMode)}</p>
    <p>Ready lanes: ${escapeHtml(status.metricoolMvp.activeReadyLanes)}/${escapeHtml(status.metricoolMvp.activeTargetLanes)} · Metricool lanes: ${escapeHtml(status.metricoolMvp.metricoolReadyLanes)} · Rights-ready assets: ${escapeHtml(status.metricoolMvp.connectedMetricoolRightsReadyAssets)}</p>
    <p>External active blockers: ${escapeHtml(status.metricoolMvp.activeExternalTasks)} · Deferred backlog: ${escapeHtml(status.metricoolMvp.deferredExternalTasks)} · Direct APIs: ${escapeHtml(status.metricoolMvp.directSocialApisRequired ? "required" : "deferred")}</p>
    <p>${escapeHtml(status.metricoolMvp.nextStep)}</p>
  </div>
  <div class="card">
    <div class="label">TikTok batch by account</div>
    <p><strong>${escapeHtml(status.tiktokBatchAccountSummary.status)}</strong> · Accounts ${escapeHtml(status.tiktokBatchAccountSummary.totals.accounts)} · Clips ${escapeHtml(status.tiktokBatchAccountSummary.totals.totalRows)} · Upload files ${escapeHtml(status.tiktokBatchAccountSummary.totals.uploadFilesReady)}/${escapeHtml(status.tiktokBatchAccountSummary.totals.totalRows)} · Missing scheduled proof ${escapeHtml(status.tiktokBatchAccountSummary.totals.missingScheduledProof)}</p>
    <p class="small">${escapeHtml(status.tiktokBatchAccountSummary.nextAction)}</p>
    <table>
      <thead>
        <tr>
          <th>Account</th>
          <th>Clips</th>
          <th>Upload</th>
          <th>Scheduled proof</th>
          <th>Public metrics</th>
          <th>Next row</th>
        </tr>
      </thead>
      <tbody>
        ${status.tiktokBatchAccountSummary.accounts.map((account) => `<tr>
          <td>${escapeHtml(account.brand)}<div class="small">${escapeHtml(account.accountName)}</div></td>
          <td>${escapeHtml(account.totalRows)}</td>
          <td>${escapeHtml(account.uploadFilesReady)}/${escapeHtml(account.totalRows)}<div class="small">Missing ${escapeHtml(account.missingUploadFiles)}</div></td>
          <td>${escapeHtml(account.scheduledProofRecorded)}/${escapeHtml(account.totalRows)}<div class="small">Missing ${escapeHtml(account.missingScheduledProof)}</div></td>
          <td>${escapeHtml(account.publicMetricsEligible - account.pendingPublicMetrics)}/${escapeHtml(account.publicMetricsEligible)}<div class="small">Pending ${escapeHtml(account.pendingPublicMetrics)}</div></td>
          <td>${account.nextQueueItemId ? `${escapeHtml(account.nextQueueItemId)}<div class="small">${escapeHtml(account.nextPublishAtLocal || account.nextPublishAt)} · ${escapeHtml(account.nextUploadFileName)}</div>` : escapeHtml(account.nextAction)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Goal readiness audit</div>
    <p><strong>${escapeHtml(status.goalReadinessAudit.status)}</strong> · Scope ${escapeHtml(status.goalReadinessAudit.scope)} · Complete: ${escapeHtml(status.goalReadinessAudit.complete ? "yes" : "no")}</p>
    <p>${escapeHtml(status.goalReadinessAudit.summary)}</p>
    <p class="small">${escapeHtml(status.goalReadinessAudit.blockers.length ? `Blockers: ${status.goalReadinessAudit.blockers.join(", ")}` : "No closeout blockers detected.")}</p>
    <table>
      <thead>
        <tr>
          <th>Check</th>
          <th>Status</th>
          <th>Detail</th>
          <th>Next action</th>
        </tr>
      </thead>
      <tbody>
        ${status.goalReadinessAudit.rows.map((row) => `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${escapeHtml(row.status)}</td>
          <td>${escapeHtml(row.detail)}</td>
          <td>${escapeHtml(row.nextAction)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="label">Evidence audit trail</div>
    <p><strong>${escapeHtml(status.operatorAudit.status)}</strong> · Events ${escapeHtml(status.operatorAudit.events)} · Accepted ${escapeHtml(status.operatorAudit.accepted)} · Rejected ${escapeHtml(status.operatorAudit.rejected)} · Invalid lines ${escapeHtml(status.operatorAudit.invalidLines)}</p>
    <p class="small">Bytes ${escapeHtml(status.operatorAudit.bytes)} · Summarized events ${escapeHtml(status.operatorAudit.summarizedEvents)} · Tail limited: ${escapeHtml(status.operatorAudit.truncated ? "yes" : "no")}</p>
    <p class="small">${escapeHtml(status.operatorAudit.redaction)}</p>
    ${status.operatorAudit.lastEvent ? `<p class="small">Last event: ${escapeHtml(status.operatorAudit.lastEvent.ts)} · ${escapeHtml(status.operatorAudit.lastEvent.action)} · ${escapeHtml(status.operatorAudit.lastEvent.ok ? "accepted" : "rejected")} ${status.operatorAudit.lastEvent.error ? `· ${escapeHtml(status.operatorAudit.lastEvent.error)}` : ""}</p>` : `<p class="small">No evidence mutation attempts recorded yet.</p>`}
    ${status.operatorAudit.url ? `<p class="small">${link(status.operatorAudit.url, "Open local audit JSONL")}</p>` : ""}
  </div>
  <div class="card">
    <div class="label">Evidence integrity</div>
    <p><strong>${escapeHtml(status.evidenceIntegrity.status)}</strong> · Findings ${escapeHtml(status.evidenceIntegrity.findingsCount)} · Current batch evidence rows ${escapeHtml(status.evidenceIntegrity.currentBatchRowsWithEvidence)} · Master current-batch evidence rows ${escapeHtml(status.evidenceIntegrity.masterCurrentBatchRowsWithEvidence)}</p>
    <p>${escapeHtml(status.evidenceIntegrity.nextAction)}</p>
    <p class="small">${escapeHtml(status.evidenceIntegrity.redaction)} · ${link("/api/clippers/evidence-integrity.json", "Open JSON")}</p>
    ${status.evidenceIntegrity.findings.length ? `<table>
      <thead>
        <tr>
          <th>File</th>
          <th>Row</th>
          <th>Queue</th>
          <th>Field</th>
          <th>Code</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        ${status.evidenceIntegrity.findings.map((finding) => `<tr>
          <td>${escapeHtml(finding.file)}</td>
          <td>${escapeHtml(finding.rowNumber)}</td>
          <td>${escapeHtml(finding.queueItemId)}</td>
          <td>${escapeHtml(finding.field)}</td>
          <td>${escapeHtml(finding.code)}</td>
          <td>${escapeHtml(finding.detail)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="small">No fake, placeholder, secret-like, or inconsistent evidence detected.</p>`}
  </div>
  <div class="card">
    <div class="label">External account + permission evidence</div>
    <p><strong>${escapeHtml(status.externalEvidence.status)}</strong> · Rows ${escapeHtml(status.externalEvidence.rows)} · Accounts ${escapeHtml(status.externalEvidence.accounts)} · Apps ${escapeHtml(status.externalEvidence.developerApps)} · Permissions ${escapeHtml(status.externalEvidence.permissions)}</p>
    <p>Platforms: TikTok ${escapeHtml(status.externalEvidence.tiktok)} · Instagram ${escapeHtml(status.externalEvidence.instagram)} · YouTube ${escapeHtml(status.externalEvidence.youtube)}</p>
    <p>${escapeHtml(status.externalEvidence.nextStep)}</p>
    <p><strong>Validation:</strong> ${escapeHtml(status.externalEvidenceValidation.status)} · Accepted ${escapeHtml(status.externalEvidenceValidation.accepted)} · Rejected ${escapeHtml(status.externalEvidenceValidation.rejected)} · Applied ${escapeHtml(status.externalEvidenceValidation.applied)}</p>
    <p class="small">Active MVP repairs: ${escapeHtml(status.externalEvidenceValidation.activeRepairRows)} · Deferred backlog repairs: ${escapeHtml(status.externalEvidenceValidation.deferredRepairRows)}. Deferred rows are not required for the current TikTok Metricool launch.</p>
    <p class="small">${[
      status.externalEvidenceValidation.reportUrl ? link(status.externalEvidenceValidation.reportUrl, "Validation report") : null,
      status.externalEvidenceValidation.repairPacketUrl ? link(status.externalEvidenceValidation.repairPacketUrl, "Repair packet") : null,
      status.externalEvidenceValidation.repairTemplatesUrl ? link(status.externalEvidenceValidation.repairTemplatesUrl, "Repair templates CSV") : null,
    ].filter(Boolean).join(" · ")}</p>
    <p class="small">${link(status.paths.externalEvidenceCsv, "External evidence CSV")} · Never paste passwords, cookies, client secrets, OAuth tokens, recovery codes, or private screenshots.</p>
    <form method="post" action="/api/clippers/external-evidence/preview">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <button type="submit">Preview external evidence</button>
    </form>
    <p class="small">Preview does not apply evidence or mark accounts ready; it may refresh local validation reports under <code>clippers_workspace/reports</code>.</p>
    <form method="post" action="/api/clippers/external-evidence/apply-ready">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <button type="submit">Apply accepted external evidence</button>
    </form>
    <p class="small">Apply accepted only imports rows that pass strict validation. Rejected rows stay blocked and must be repaired with real non-secret proof.</p>
    ${nextExternalRepair ? `<div class="card">
      <div class="label">${escapeHtml(nextExternalRepairIsActive ? "Next evidence repair" : "Deferred evidence backlog")}</div>
      <p><strong>${escapeHtml(nextExternalRepair.closeoutId)}</strong> · CSV row ${escapeHtml(nextExternalRepair.csvRow)} · ${escapeHtml(nextExternalRepair.platform)}</p>
      <p>${escapeHtml(nextExternalRepair.reason)}</p>
      <p class="small">Missing: ${escapeHtml(nextExternalRepair.missingCsvFields.join(", ") || "n/a")}</p>
      <p class="small">Proof: ${nextExternalRepair.proofUrl ? link(nextExternalRepair.proofUrl, path.basename(nextExternalRepair.proofPath)) : escapeHtml(nextExternalRepair.proofPath || "missing")}</p>
      <p>${escapeHtml(nextExternalRepair.nextStep)}</p>
      ${nextExternalRepairIsActive ? `<details>
        <summary>Save non-secret proof for this repair</summary>
        <form method="post" action="/api/clippers/external-evidence/record-next-proof">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <input type="hidden" name="closeoutId" value="${escapeHtml(nextExternalRepair.closeoutId)}" />
          <input name="proofReference" placeholder="Public profile URL, ticket ID, or non-secret proof reference" />
          <textarea name="operatorNotes" placeholder="20+ chars. Confirm the real external action, date, and portal location."></textarea>
          <textarea name="proofDetails" placeholder="80+ chars. Non-secret evidence details only. No passwords, cookies, tokens, recovery codes, or private screenshots."></textarea>
          <button type="submit">Save non-secret proof</button>
        </form>
      </details>` : `<p class="small">This repair is deferred. The current launch path is to schedule SPORT and memes TikTok rows in Metricool and record real planner proof.</p>`}
      <details>
        <summary>Copy repair CSV row</summary>
        <pre>${escapeHtml(nextExternalRepair.csvRowTemplate)}</pre>
      </details>
    </div>` : ""}
    ${status.externalEvidenceValidation.repairRows.length ? `<details>
      <summary>Repair queue priority</summary>
      <table>
        <thead>
          <tr>
            <th>CSV</th>
            <th>Repair</th>
            <th>Missing</th>
            <th>Reason</th>
            <th>Proof</th>
          </tr>
        </thead>
        <tbody>
          ${status.externalEvidenceValidation.repairRows.map((row) => `<tr>
            <td>${escapeHtml(row.csvRow)}<div class="small">${escapeHtml(row.priorityLabel)}</div></td>
            <td>${escapeHtml(row.closeoutId)}<div class="small">${escapeHtml([row.lane, row.platform, row.requiredStatus].filter(Boolean).join(" · "))}</div></td>
            <td>${escapeHtml(row.missingCsvFields.join(", ") || "n/a")}</td>
            <td>${escapeHtml(row.reason)}</td>
            <td>${row.proofUrl ? link(row.proofUrl, path.basename(row.proofPath)) : escapeHtml(row.proofPath || "missing")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </details>` : ""}
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Lane</th>
          <th>Platform</th>
          <th>Proof</th>
          <th>Portal</th>
        </tr>
      </thead>
      <tbody>
        ${status.externalEvidence.nextRows.map((row) => `<tr>
          <td>${escapeHtml(row.index)}</td>
          <td>${escapeHtml(row.kind)}<div class="small">${escapeHtml(row.accountId || row.scope || row.status)}</div></td>
          <td>${escapeHtml(row.platform)}</td>
          <td>${row.proofUrl ? link(row.proofUrl, path.basename(row.proofPath)) : escapeHtml(row.proofPath || "missing")}</td>
          <td>${row.portalUrl ? `<a href="${escapeHtml(row.portalUrl)}">${escapeHtml(row.portalUrl)}</a>` : "n/a"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <details>
      <summary>Copy external evidence CSV starter</summary>
      <p class="small">Use this only after the real account, app, or permission action is completed and the proof file contains non-secret evidence.</p>
      <pre>${escapeHtml(status.externalEvidence.csvStarter)}</pre>
    </details>
  </div>
  <div class="card">
    <div class="label">Metricool operator checklist</div>
    <p><strong>${escapeHtml(status.metricoolOperatorChecklist.status)}</strong> · Batch ${escapeHtml(status.metricoolOperatorChecklist.currentBatchId)}</p>
    <p class="small">${escapeHtml(status.metricoolOperatorChecklist.blockers.length ? `Blocked: ${status.metricoolOperatorChecklist.blockers.join(", ")}` : "No local operator blockers detected.")}</p>
    <ol>
      ${status.metricoolOperatorChecklist.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
    </ol>
    ${status.metricoolSchedulingRunSheet.nextRow ? `<div class="card">
      <div class="label">Next Metricool action</div>
      <p><strong>#${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.rank)} ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.metricoolBrandName)}</strong> · ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.accountName)} · ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.publishAtLocal || status.metricoolSchedulingRunSheet.nextRow.publishAt)}</p>
      <p>${status.metricoolSchedulingRunSheet.nextRow.uploadFileUrl ? link(status.metricoolSchedulingRunSheet.nextRow.uploadFileUrl, status.metricoolSchedulingRunSheet.nextRow.uploadFileName || "MP4") : escapeHtml(status.metricoolSchedulingRunSheet.nextRow.uploadFileName || "missing")} · ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.captionSeed)}</p>
      <p class="small">Queue item: ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.queueItemId)} · Lead min: ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.leadMinutes ?? "n/a")} · ${escapeHtml(status.metricoolSchedulingRunSheet.nextAction)}</p>
      ${realClipIntakeBlocked ? `<p class="small">Scheduled proof is locked until Real clip intake is ready. ${link("/api/clippers/real-clip-intake.html", "Open real clip intake")} · ${link("/api/clippers/real-clip-intake-validation.html", "Open validation")}</p>` : `<details open>
        <summary>Save scheduled proof for next row</summary>
        <form method="post" action="/api/clippers/evidence/scheduled-preview">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <input type="hidden" name="returnTo" value="/clippers" />
          <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.queueItemId)}" />
          <p class="small">Confirm row: ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.queueItemId)} · ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.metricoolBrandName)} / ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.accountName)} · ${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.uploadFileName)}</p>
          <input name="metricoolApprovalUrl" placeholder="https://app.metricool.com/..." />
          <textarea name="operatorNotes" placeholder="Real note, 20+ chars.">${escapeHtml(status.metricoolSchedulingRunSheet.nextRow.scheduledNoteTemplate)}</textarea>
          <button type="submit">Preview scheduled proof</button>
        </form>
      </details>`}
    </div>` : ""}
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Brand</th>
          <th>Publish</th>
          <th>File</th>
          <th>Caption</th>
        </tr>
      </thead>
      <tbody>
        ${status.metricoolOperatorChecklist.nextRows.map((row) => `<tr>
          <td>${escapeHtml(row.rank)}<div class="small">${escapeHtml(row.queueItemId)}</div></td>
          <td>${escapeHtml(row.metricoolBrandName)}<div class="small">${escapeHtml(row.accountName)}</div></td>
          <td>${escapeHtml(row.publishAt)}</td>
          <td>${escapeHtml(row.uploadFileName)}</td>
          <td class="clip-caption">${escapeHtml(row.captionSeed)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <details open>
      <summary>Metricool scheduling run sheet</summary>
      <p><strong>${escapeHtml(status.metricoolSchedulingRunSheet.status)}</strong> · ${escapeHtml(status.metricoolSchedulingRunSheet.scheduledProofRecorded)}/${escapeHtml(status.metricoolSchedulingRunSheet.totalRows)} scheduled proofs recorded · Missing ${escapeHtml(status.metricoolSchedulingRunSheet.missingScheduledProof)} · Time zone ${escapeHtml(status.metricoolSchedulingRunSheet.operatorTimeZone)}</p>
      <p class="small">${escapeHtml(status.metricoolSchedulingRunSheet.nextAction)}</p>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Brand</th>
            <th>Publish</th>
            <th>Asset</th>
            <th>Proof note</th>
          </tr>
        </thead>
        <tbody>
          ${status.metricoolSchedulingRunSheet.rows.map((row) => `<tr>
            <td>${escapeHtml(row.order)}<div class="small">${escapeHtml(row.queueItemId)}</div></td>
            <td>${escapeHtml(row.metricoolBrandName)}<div class="small">${escapeHtml(row.accountName)} · ${escapeHtml(row.platform)}</div></td>
            <td>${escapeHtml(row.publishAtLocal || row.publishAt)}<div class="small">${escapeHtml(row.publishAt)}</div><div class="small">Lead min: ${escapeHtml(row.leadMinutes ?? "n/a")} · ${escapeHtml(row.evidenceState)}</div></td>
            <td>${row.uploadFileUrl ? link(row.uploadFileUrl, row.uploadFileName || "MP4") : escapeHtml(row.uploadFileName || "missing")}<div class="small">${escapeHtml(row.captionSeed)}</div></td>
            <td><code>${escapeHtml(row.scheduledNoteTemplate)}</code><div class="small">${escapeHtml(row.evidenceMissingFields.join(", ") || "clear")}</div></td>
          </tr>`).join("")}
        </tbody>
      </table>
      <details>
        <summary>Copy Metricool upload checklist CSV</summary>
        <p class="small">Use this as the operating sheet while scheduling. It does not prove scheduling; after Metricool accepts each row, paste the real planner URL into scheduled proof. ${link("/api/clippers/metricool-upload-checklist.csv", "Download CSV")}</p>
        <pre>${escapeHtml(status.metricoolSchedulingRunSheet.uploadChecklistCsv)}</pre>
      </details>
    </details>
    <details>
      <summary>Copy scheduled proof CSV starter</summary>
      <p class="small">${realClipIntakeBlocked ? "Locked until Real clip intake is ready. Do not schedule placeholders in Metricool." : "Fill this only after each row is scheduled in Metricool. Replace every placeholder with a real Metricool planner URL and specific note before import."} ${link("/api/clippers/next-scheduled-proof-starter.csv", "Download next row only")} · ${link("/api/clippers/scheduled-proof-starter.csv", "Download full scheduled proof CSV")}</p>
      <p class="small">The next-row CSV contains only the earliest pending deadline row, which is the safest option while scheduling one clip at a time.</p>
      <pre>${escapeHtml(status.nextScheduledProofCsvStarter)}</pre>
    </details>
    <details>
      <summary>Copy full scheduled proof CSV starter</summary>
      <p class="small">Use this for a batch import only after every row in the downloaded order has been scheduled in Metricool.</p>
      <pre>${escapeHtml(status.scheduledProofCsvStarter)}</pre>
    </details>
    <details>
      <summary>Preview scheduled proof batch</summary>
      ${realClipIntakeBlocked ? `<p class="small">Scheduled proof batch preview is locked until Real clip intake passes. ${link("/api/clippers/real-clip-intake-validation.html", "Open validation")}</p>` : `<form method="post" action="/api/clippers/evidence/scheduled-batch-preview">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
        <input type="hidden" name="returnTo" value="/clippers" />
        <textarea name="scheduledEvidenceBatch" placeholder="metricool_queue_item_id,metricool_approval_url,operator_notes&#10;7129d59b5f5e,https://app.metricool.com/planner/real-proof,Scheduled manually in Metricool planner for SPORT TikTok row 2."></textarea>
        <button type="submit">Preview scheduled proof batch</button>
      </form>`}
      <p class="small">Atomic import: if any row is invalid, nothing is written. Use only real HTTPS Metricool URLs and concrete single-line notes.</p>
    </details>
    <details open>
      <summary>Public TikTok metrics run sheet</summary>
      <p><strong>${escapeHtml(status.publicMetricsRunSheet.status)}</strong> · Eligible ${escapeHtml(status.publicMetricsRunSheet.eligibleRows)} · Pending ${escapeHtml(status.publicMetricsRunSheet.pendingRows)} · Ready ${escapeHtml(status.publicMetricsRunSheet.readyRows)} · Locked ${escapeHtml(status.publicMetricsRunSheet.lockedRows)}</p>
      <p class="small">${escapeHtml(status.publicMetricsRunSheet.nextAction)}</p>
      ${status.publicMetricsRunSheet.nextRow ? `<div class="card">
        <div class="label">Next public metrics row</div>
        <p><strong>#${escapeHtml(status.publicMetricsRunSheet.nextRow.rank)} ${escapeHtml(status.publicMetricsRunSheet.nextRow.metricoolBrandName)}</strong> · ${escapeHtml(status.publicMetricsRunSheet.nextRow.accountName)} · ${escapeHtml(status.publicMetricsRunSheet.nextRow.publishAtLocal || status.publicMetricsRunSheet.nextRow.publishAt)}</p>
        <p class="small">Queue item: ${escapeHtml(status.publicMetricsRunSheet.nextRow.queueItemId)} · Missing: ${escapeHtml(status.publicMetricsRunSheet.nextRow.evidenceMissingFields.join(", ") || "clear")}</p>
      </div>` : ""}
      ${status.publicMetricsRunSheet.rows.length ? `<table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Brand</th>
            <th>Publish</th>
            <th>Missing</th>
            <th>Next action</th>
          </tr>
        </thead>
        <tbody>
          ${status.publicMetricsRunSheet.rows.map((row) => `<tr>
            <td>${escapeHtml(row.order)}<div class="small">${escapeHtml(row.queueItemId)}</div></td>
            <td>${escapeHtml(row.metricoolBrandName)}<div class="small">${escapeHtml(row.accountName)}</div></td>
            <td>${escapeHtml(row.publishAtLocal || row.publishAt)}<div class="small">${escapeHtml(row.evidenceState)}</div></td>
            <td>${escapeHtml(row.evidenceMissingFields.join(", ") || "clear")}</td>
            <td>${escapeHtml(row.nextAction)}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
    </details>
    <details>
      <summary>Preview published metrics batch</summary>
      <p class="small">Use only after the TikTok post is live and the 24h numbers are real. ${link("/api/clippers/next-published-metrics-starter.csv", "Download next metrics row only")} · ${link("/api/clippers/published-metrics-starter.csv", "Download full published metrics CSV")}</p>
      <form method="post" action="/api/clippers/evidence/published-batch-preview">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
        <input type="hidden" name="returnTo" value="/clippers" />
        <textarea name="publishedEvidenceBatch" placeholder="metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes&#10;7129d59b5f5e,https://www.tiktok.com/@sportsdaily/video/1234567890123456789,1200,100,8,12,Metrics captured after TikTok video was public for 24h."></textarea>
        <button type="submit">Preview published metrics batch</button>
      </form>
      <p class="small">Requires prior scheduled proof per row. Exact HTTPS TikTok video URLs and positive 24h views are required.</p>
    </details>
  </div>
  <div class="card">
    <div class="label">Local watchdog</div>
    <p><strong>${escapeHtml(status.watchdog.enabled ? "Enabled" : "Disabled")}</strong> · Threshold ${escapeHtml(status.watchdog.thresholdMinutes)} min · Last status: ${escapeHtml(status.watchdog.lastStatus)}</p>
    <p class="small">Auto roll-forward threshold: ${escapeHtml(status.watchdog.autoRollForwardThresholdAt || "n/a")} · Minutes until threshold: ${escapeHtml(status.watchdog.minutesUntilAutoRollForward ?? "n/a")}</p>
    <p>${escapeHtml(status.watchdog.nextAction)}</p>
    <p class="small">It can only roll forward local batch times before evidence starts. It never opens Metricool, never posts, and keeps <code>realPublishEnabled=false</code>.</p>
  </div>
  <div class="card">
    <div class="label">Next row</div>
    <p><strong>#${escapeHtml(status.operatorSummary.nextRank)} ${escapeHtml(status.operatorSummary.nextAccountName)}</strong> · ${escapeHtml(status.operatorSummary.nextMetricoolBrandName)}</p>
    <p>${escapeHtml(status.operatorSummary.nextUploadFileName)} · ${escapeHtml(status.operatorSummary.nextPublishAt)}</p>
    <p>${escapeHtml(status.operatorSummary.nextCaptionSeed)}</p>
    <p>${escapeHtml(status.operatorSummary.nextAction)}</p>
    <p class="small">First publish: ${escapeHtml(status.operatorSummary.firstPublishAt || "n/a")} · Lead minutes: ${escapeHtml(status.operatorSummary.leadMinutes ?? "n/a")}${status.operatorSummary.needsRollForward ? " · Roll forward needed" : ""}</p>
  </div>
  <div class="card">
    <div class="label">Earliest deadline</div>
    <p><strong>#${escapeHtml(status.operatorSummary.deadlineRank)} ${escapeHtml(status.operatorSummary.deadlineAccountName)}</strong> · ${escapeHtml(status.operatorSummary.deadlineMetricoolBrandName)}</p>
    <p>${escapeHtml(status.operatorSummary.deadlineUploadFileName)} · ${escapeHtml(status.operatorSummary.deadlinePublishAt)}</p>
    <p>${escapeHtml(status.operatorSummary.deadlineCaptionSeed)}</p>
    <p>${escapeHtml(status.operatorSummary.deadlineAction || status.operatorSummary.scheduleWindowAction)}</p>
  </div>
  <div class="card">
    <div class="label">Batch actual</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Cuenta</th>
          <th>Horario</th>
          <th>Archivo</th>
          <th>Evidencia</th>
          <th>Caption</th>
        </tr>
      </thead>
      <tbody>
        ${status.rows.map((row) => `<tr>
          <td>${escapeHtml(row.rank)}<div class="small">${escapeHtml(row.status)}</div></td>
          <td>${escapeHtml(row.accountName)}<div class="small">${escapeHtml(row.metricoolBrandName || row.accountId)} · ${escapeHtml(row.platform)}</div></td>
          <td>${escapeHtml(row.publishAt)}</td>
          <td>${row.uploadFileUrl ? link(row.uploadFileUrl, row.uploadFileName || "MP4") : escapeHtml(row.uploadFileName || "missing")}</td>
          <td>
            ${escapeHtml(row.evidenceState)}
            <div class="small">${escapeHtml(row.evidenceMissingFields.join(", ") || row.evidenceBlocker || "clear")}</div>
            <div class="small">${escapeHtml(row.evidenceNextAction)}</div>
            <details>
              <summary>Copy evidence</summary>
              <pre>${escapeHtml(row.evidenceTemplate)}</pre>
              <pre>${escapeHtml(row.scheduledCsvTemplate)}</pre>
            </details>
            ${realClipIntakeBlocked ? `<p class="small">Scheduled proof locked: complete Real clip intake first.</p>` : `<details>
              <summary>Save scheduled proof</summary>
              <form method="post" action="/api/clippers/evidence/scheduled-preview">
                <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
                <input type="hidden" name="returnTo" value="/clippers" />
                <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
                <p class="small">Confirm row: ${escapeHtml(row.queueItemId)} · ${escapeHtml(row.metricoolBrandName || row.accountName)} / ${escapeHtml(row.accountName)} · ${escapeHtml(row.uploadFileName)}</p>
                <input name="metricoolApprovalUrl" placeholder="https://app.metricool.com/..." />
                <textarea name="operatorNotes" placeholder="Real note, 20+ chars. Example: Scheduled manually in Metricool planner for SPORT TikTok.">${escapeHtml(`Scheduled manually in Metricool planner for ${row.metricoolBrandName || row.accountName} TikTok row ${row.rank}.`)}</textarea>
                <button type="submit">Preview scheduled proof</button>
              </form>
            </details>`}
            ${canRecordPublishedMetrics(row) ? `<details>
              <summary>Save published metrics</summary>
              <form method="post" action="/api/clippers/evidence/published-preview">
                <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
                <input type="hidden" name="returnTo" value="/clippers" />
                <input type="hidden" name="metricoolQueueItemId" value="${escapeHtml(row.queueItemId)}" />
                <input name="publishedPostUrl" placeholder="https://www.tiktok.com/@account/video/123..." />
                <input name="views24h" placeholder="views_24h" />
                <input name="likes24h" placeholder="likes_24h" />
                <input name="comments24h" placeholder="comments_24h" />
                <input name="shares24h" placeholder="shares_24h" />
                <textarea name="operatorNotes" placeholder="Real 24h metric note, 20+ chars."></textarea>
                <button type="submit">Preview published metrics</button>
              </form>
            </details>` : `<p class="small">Published metrics locked until Metricool scheduled proof is saved for this row.</p>`}
          </td>
          <td class="clip-caption">${escapeHtml(row.captionSeed)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>
  </details>
  <p class="guardrail">Metricool permanece en <code>approval_required</code>. La publicación automática está desactivada y solo se aceptan URLs, permisos y métricas reales.</p>
</main>
</body>
</html>`;
}

function renderEvidencePreviewPage(result, { title, importLabel, confirmToken = "", confirmType = "", returnTo = "/clippers" }) {
  const ok = result?.ok === true;
  const safeReturnTo = safeReturnToPath(returnTo) || "/clippers";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #1f2933; }
    main { max-width: 1100px; margin: 0 auto; padding: 28px; }
    .card { background: #fff; border: 1px solid #deded8; border-radius: 8px; padding: 18px; margin: 14px 0; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; text-align: left; vertical-align: top; }
    th { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; }
    .small { color: #6b7280; font-size: 13px; }
    .ok { color: #0f766e; font-weight: 700; }
    .error { color: #b42318; font-weight: 700; }
    a, button { color: #1d4ed8; }
  </style>
</head>
<body>
<main>
  <p><a href="${escapeHtml(safeReturnTo)}">Back to Clippers operator</a></p>
  <h1>${escapeHtml(title)}</h1>
  <div class="card">
    <div class="label">Preview result</div>
    <p class="${ok ? "ok" : "error"}">${escapeHtml(ok ? "Valid preview. No evidence was written." : "Preview blocked. Nothing was written.")}</p>
    <p>Would import: ${escapeHtml(result?.wouldImport ?? 0)} · Writes: ${escapeHtml(result?.writes === true ? "true" : "false")}</p>
    ${ok ? `<p class="small">Review these rows, then go back and use ${escapeHtml(importLabel)} only if every row matches the real Metricool/TikTok action.</p>` : `<p class="small">Error: ${escapeHtml(result?.error || "unknown_error")} ${result?.metricoolQueueItemId ? `· Queue item: ${escapeHtml(result.metricoolQueueItemId)}` : ""}</p>`}
    ${ok && confirmToken ? `<form method="post" action="/api/clippers/evidence/confirm-preview">
      <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="returnTo" value="${escapeHtml(safeReturnTo)}" />
      <input type="hidden" name="previewToken" value="${escapeHtml(confirmToken)}" />
      <input type="hidden" name="previewType" value="${escapeHtml(confirmType)}" />
      <button type="submit">Confirm ${escapeHtml(importLabel)}</button>
    </form>
    <p class="small">This confirmation token is local, one-time use, and expires in ${escapeHtml(Math.round(previewConfirmTtlMs / 60_000))} minutes. The submitted batch is kept in server memory only until confirmation or expiry.</p>` : ""}
  </div>
  ${ok && result.rows?.length ? `<div class="card">
    <div class="label">Rows checked</div>
    <table>
      <thead>
        <tr>
          <th>Line</th>
          <th>Queue item</th>
          <th>Brand</th>
          <th>Account</th>
          <th>Publish</th>
          <th>Asset</th>
          <th>Final</th>
        </tr>
      </thead>
      <tbody>
        ${result.rows.map((row) => `<tr>
          <td>${escapeHtml(row.line ?? "n/a")}</td>
          <td>${escapeHtml(row.metricoolQueueItemId)}<div class="small">#${escapeHtml(row.rank)}</div></td>
          <td>${escapeHtml(row.brand)}<div class="small">${escapeHtml(row.platform)}</div></td>
          <td>${escapeHtml(row.accountName)}</td>
          <td>${escapeHtml(row.publishAtLocal || row.publishAt)}<div class="small">${escapeHtml(row.publishAt)}</div></td>
          <td>${escapeHtml(row.uploadFileName)}<div class="small">${escapeHtml(row.captionSeed)}</div></td>
          <td>${escapeHtml(row.finalStatus)}<div class="small">Current: ${escapeHtml(row.currentEvidenceState)}</div></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>` : ""}
  <div class="card">
    <div class="label">Guardrails</div>
    <p class="small">Preview mode never stores submitted URLs, metrics, notes, cookies, passwords, or tokens. Use import only after checking the real external action.</p>
  </div>
</main>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url || "/", localOrigin());
    if (parsed.pathname === "/api/health") {
      json(res, 200, { status: "ok", service: "clippers-local-operator", checkedAt: new Date().toISOString() });
      return;
    }
    if (parsed.pathname === "/api/clippers/status") {
      json(res, 200, await buildStatus());
      return;
    }
    if (parsed.pathname === "/api/clippers/human-review-queue.json" && req.method === "GET") {
      json(res, 200, await buildHumanReviewQueue());
      return;
    }
    if (parsed.pathname === "/api/clippers/human-review-queue.html" && req.method === "GET") {
      html(res, 200, renderHumanReviewQueuePage(await buildHumanReviewQueue()));
      return;
    }
    if (parsed.pathname === "/api/clippers/human-review-decision" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordHumanReviewDecision({
        id: form.get("id"),
        decision: form.get("decision"),
        audioStatus: form.get("audioStatus"),
        contextStatus: form.get("contextStatus"),
        thirdPartyStatus: form.get("thirdPartyStatus"),
        humanReviewConfirmed: form.get("humanReviewConfirmed"),
        aiUsed: form.get("aiUsed"),
        notes: form.get("notes"),
      });
      if (result.ok && safeReturnToPath(form.get("returnTo"))) {
        res.writeHead(303, { location: "/api/clippers/human-review-queue.html", "cache-control": "no-store" });
        res.end();
      } else {
        json(res, result.statusCode || 500, result);
      }
      return;
    }
    if (parsed.pathname === "/api/clippers/human-review-promote" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await promoteHumanReviewCandidate({
        id: form.get("id"),
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        originalStreamEndedAt: form.get("originalStreamEndedAt"),
        finalOutputReviewed: form.get("finalOutputReviewed"),
        promotionConfirmed: form.get("promotionConfirmed"),
      });
      if (result.ok && safeReturnToPath(form.get("returnTo"))) {
        res.writeHead(303, { location: "/api/clippers/human-review-queue.html", "cache-control": "no-store" });
        res.end();
      } else {
        json(res, result.statusCode || 500, result);
      }
      return;
    }
    if (parsed.pathname === "/api/clippers/metricool-upload-checklist.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, status.metricoolSchedulingRunSheet.uploadChecklistCsv);
      return;
    }
    if (parsed.pathname === "/api/clippers/scheduled-proof-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, status.scheduledProofCsvStarter, "clippers-scheduled-proof-starter.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/next-scheduled-proof-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, status.nextScheduledProofCsvStarter, "clippers-next-scheduled-proof-starter.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/published-metrics-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, status.publishedMetricsCsvStarter, "clippers-published-metrics-starter.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/next-published-metrics-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, status.nextPublishedMetricsCsvStarter, "clippers-next-published-metrics-starter.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-batch-account-summary.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.tiktokBatchAccountSummary);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-batch-account-summary.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, tiktokBatchAccountSummaryCsv(status.tiktokBatchAccountSummary), "clippers-tiktok-batch-account-summary.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-batch-account-summary.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, tiktokBatchAccountSummaryMarkdown(status.tiktokBatchAccountSummary), "clippers-tiktok-batch-account-summary.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-queues.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.tiktokAccountQueues);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-queues.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, tiktokAccountQueuesCsv(status.tiktokAccountQueues), "clippers-tiktok-account-queues.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-queues.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, tiktokAccountQueuesMarkdown(status.tiktokAccountQueues), "clippers-tiktok-account-queues.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-next.json" && req.method === "GET") {
      const status = await buildStatus();
      const result = buildTikTokAccountNextAction(status.tiktokAccountQueues, parsed.searchParams.get("accountId"));
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-account-now.html" && req.method === "GET") {
      const status = await buildStatus();
      const result = renderCurrentTikTokAccountMetricoolNowPage(status);
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      html(res, 200, result.html);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-batch-schedule-now.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderTikTokBatchScheduleNowPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-public-metrics-now.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderTikTokPublicMetricsNowPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-next-upload-checklist.csv" && req.method === "GET") {
      const status = await buildStatus();
      const result = currentTikTokNextUploadChecklist(status);
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      csv(res, 200, result.csv, result.filename);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-next-scheduled-proof-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      const result = currentTikTokNextScheduledProofStarter(status);
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      csv(res, 200, status.operatorSummary.needsRollForward ? emptyScheduledProofCsvStarter() : result.csv, result.filename);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-now.html" && req.method === "GET") {
      const status = await buildStatus();
      const result = renderTikTokAccountMetricoolNowPage(status, parsed.searchParams.get("accountId"));
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      html(res, 200, result.html);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-next-upload-checklist.csv" && req.method === "GET") {
      const status = await buildStatus();
      const result = tiktokAccountNextUploadChecklist(status.tiktokAccountQueues, parsed.searchParams.get("accountId"), status);
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      csv(res, 200, result.csv, result.filename);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-scheduled-proof-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      const result = tiktokAccountScheduledProofStarter(status.tiktokAccountQueues, parsed.searchParams.get("accountId"));
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      csv(res, 200, status.operatorSummary.needsRollForward ? emptyScheduledProofCsvStarter() : result.csv, result.filename);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-next-scheduled-proof-starter.csv" && req.method === "GET") {
      const status = await buildStatus();
      const result = tiktokAccountNextScheduledProofStarter(status.tiktokAccountQueues, parsed.searchParams.get("accountId"));
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      csv(res, 200, status.operatorSummary.needsRollForward ? emptyScheduledProofCsvStarter() : result.csv, result.filename);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-account-runbook.md" && req.method === "GET") {
      const status = await buildStatus();
      const result = tiktokAccountRunbookMarkdown(status.tiktokAccountQueues, parsed.searchParams.get("accountId"));
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      markdown(res, 200, result.markdown, result.filename);
      return;
    }
    if (parsed.pathname === "/api/clippers/operator-brief.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildMetricoolOperatorBrief(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/operator-report.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildMetricoolOperatorReport(status), "clippers-metricool-operator-report.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/streamer-growth-ceo.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.streamerGrowthCeo || buildStreamerGrowthCeo(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/streamer-growth-ceo.md" && req.method === "GET") {
      const status = await buildStatus();
      const ceo = status.streamerGrowthCeo || buildStreamerGrowthCeo(status);
      markdown(res, 200, buildStreamerGrowthCeoMarkdown(ceo), "clippers-streamer-growth-ceo.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/streamer-growth-ceo.html" && req.method === "GET") {
      const status = await buildStatus();
      const ceo = status.streamerGrowthCeo || buildStreamerGrowthCeo(status);
      html(res, 200, renderStreamerGrowthCeoPage(ceo));
      return;
    }
    if (parsed.pathname === "/api/clippers/streamer-100-campaign.json" && req.method === "GET") {
      json(res, 200, await buildStreamer100Campaign());
      return;
    }
    if (parsed.pathname === "/api/clippers/streamer-100-campaign.csv" && req.method === "GET") {
      csv(res, 200, buildStreamer100CampaignCsv(await buildStreamer100Campaign()), "clippers-100-streamer-campaign.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/streamer-100-campaign.html" && req.method === "GET") {
      html(res, 200, renderStreamer100CampaignPage(await buildStreamer100Campaign()));
      return;
    }
    if (parsed.pathname === "/api/clippers/go-live-gap-resolver.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.goLiveGapResolver || buildGoLiveGapResolver(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/go-live-gap-resolver.md" && req.method === "GET") {
      const status = await buildStatus();
      const resolver = status.goLiveGapResolver || buildGoLiveGapResolver(status);
      markdown(res, 200, buildGoLiveGapResolverMarkdown(resolver), "clippers-go-live-gap-resolver.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/go-live-gap-resolver.csv" && req.method === "GET") {
      const status = await buildStatus();
      const resolver = status.goLiveGapResolver || buildGoLiveGapResolver(status);
      csv(res, 200, buildGoLiveGapResolverCsv(resolver), "clippers-go-live-gap-resolver.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/go-live-gap-resolver.html" && req.method === "GET") {
      const status = await buildStatus();
      const resolver = status.goLiveGapResolver || buildGoLiveGapResolver(status);
      html(res, 200, renderGoLiveGapResolverPage(resolver));
      return;
    }
    if (parsed.pathname === "/api/clippers/goal-gaps.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, buildGoalGapsSummary(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/goal-gaps.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildGoalGapsMarkdown(status), "clippers-goal-gaps.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-gap.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.realClipGap || buildRealClipGapSummary(status.rows || [], status.uploadPackIntegrity || {}));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-gap.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipGapMarkdown(status), "clippers-real-clip-gap.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake.html" && req.method === "GET") {
      const status = await buildLightweightRealClipIntakeStatus();
      html(res, 200, renderRealClipIntakePage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake.md" && req.method === "GET") {
      const status = await buildLightweightRealClipIntakeStatus();
      markdown(res, 200, buildRealClipIntakeMarkdown(status), "clippers-real-clip-intake.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake-manifest.csv" && req.method === "GET") {
      const status = await buildLightweightRealClipIntakeStatus();
      csv(res, 200, buildRealClipIntakePack(status).manifestCsv, "clippers-real-clip-intake-manifest.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake-batch-template.csv" && req.method === "GET") {
      const status = await buildLightweightRealClipIntakeStatus();
      csv(res, 200, realClipIntakeBatchTemplateCsv(status), "clippers-real-clip-intake-batch-template.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake-validation.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.realClipIntakeValidation || await buildRealClipIntakeValidation(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake-validation.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipIntakeValidationMarkdown(status.realClipIntakeValidation || await buildRealClipIntakeValidation(status)), "clippers-real-clip-intake-validation.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake-validation.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderRealClipIntakeValidationPage(status.realClipIntakeValidation || await buildRealClipIntakeValidation(status)));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-closeout-work-packet.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, buildRealClipCloseoutWorkPacket(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-closeout-work-packet.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipCloseoutWorkPacketMarkdown(status), "clippers-real-clip-closeout-work-packet.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-closeout-work-packet.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, buildRealClipCloseoutWorkPacketCsv(buildRealClipCloseoutWorkPacket(status)), "clippers-real-clip-closeout-work-packet.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/source-drop-metricool-refresh.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, buildSourceDropMetricoolRefreshPlan(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/source-drop-metricool-refresh.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildSourceDropMetricoolRefreshMarkdown(status), "clippers-source-drop-metricool-refresh.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/source-drop-metricool-refresh.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderSourceDropMetricoolRefreshPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/source-drop-metricool-refresh/run" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const result = await runSourceDropMetricoolRefresh();
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake/record" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordRealClipIntakeManifestRow({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        exactVideoOrPostUrl: form.get("exactVideoOrPostUrl"),
        creatorOrRightsHolder: form.get("creatorOrRightsHolder"),
        evidenceLink: form.get("evidenceLink"),
        operatorNotes: form.get("operatorNotes"),
        aiProcessing: form.get("aiProcessing"),
        originalStreamEndedAt: form.get("originalStreamEndedAt"),
        plannedPublishAt: form.get("plannedPublishAt"),
        contextReviewStatus: form.get("contextReviewStatus"),
        creditText: form.get("creditText"),
      });
      const returnTo = safeReturnToPath(form.get("returnTo"));
      if (result.ok && returnTo) {
        res.writeHead(303, { location: returnTo, "cache-control": "no-store" });
        res.end();
        return;
      }
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake/record-batch" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordRealClipIntakeManifestBatch(form.get("realClipIntakeBatch"));
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-intake/initialize-source-drop" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const result = await initializeRealClipSourceDropWorkspace();
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-outreach.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderRealClipPermissionOutreachPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-outreach.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipPermissionOutreachMarkdown(status), "clippers-real-clip-permission-outreach.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-outreach.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, buildRealClipPermissionOutreachPack(status).csv, "clippers-real-clip-permission-outreach.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-request-packets.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderRealClipPermissionRequestPacketsPage(await buildRealClipPermissionRequestPackets(status)));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-request-packets.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, await buildRealClipPermissionRequestPackets(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-request-packets.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipPermissionRequestPacketsMarkdown(await buildRealClipPermissionRequestPackets(status)), "clippers-real-clip-permission-request-packets.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-request-packets.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, buildRealClipPermissionRequestPacketsCsv(await buildRealClipPermissionRequestPackets(status)), "clippers-real-clip-permission-request-packets.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-source-hunt.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderRealClipSourceHuntPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-source-hunt.json" && req.method === "GET") {
      const status = await buildStatus();
      const pack = buildRealClipSourceHuntPack(status);
      const { csv: _csv, ...publicPack } = pack;
      json(res, 200, publicPack);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-source-hunt.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipSourceHuntMarkdown(status), "clippers-real-clip-source-hunt.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-source-hunt.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, buildRealClipSourceHuntPack(status).csv, "clippers-real-clip-source-hunt.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-acquisition-workbench.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderRealClipAcquisitionWorkbenchPage(await buildRealClipAcquisitionWorkbench(status)));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-acquisition-workbench.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, await buildRealClipAcquisitionWorkbench(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-acquisition-workbench.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildRealClipAcquisitionWorkbenchMarkdown(await buildRealClipAcquisitionWorkbench(status)), "clippers-real-clip-acquisition-workbench.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-acquisition-workbench.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, buildRealClipAcquisitionWorkbenchCsv(await buildRealClipAcquisitionWorkbench(status)), "clippers-real-clip-acquisition-workbench.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-exact-source-candidate.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, await renderRealClipExactSourceCandidateInboxPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-exact-source-candidate-batch-template.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, realClipExactSourceCandidateBatchTemplateCsv(status), "clippers-real-clip-exact-source-candidate-batch-template.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-exact-source-candidate/record" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordRealClipExactSourceCandidate({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        exactVideoOrPostUrl: form.get("exactVideoOrPostUrl"),
        creatorOrRightsHolder: form.get("creatorOrRightsHolder"),
      });
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-exact-source-candidate/record-batch" && req.method === "POST") {
      const body = await readRequestBody(req, 256_000);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const result = await recordRealClipExactSourceCandidateBatch(validation.form.get("exactSourceCandidateBatch"));
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderRealClipPermissionCrmPage(await buildRealClipPermissionCrm(status)));
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm.json" && req.method === "GET") {
      const status = await buildStatus();
      const crm = await buildRealClipPermissionCrm(status);
      const { csv: _csv, ...publicCrm } = crm;
      json(res, 200, publicCrm);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, (await buildRealClipPermissionCrm(status)).csv, "clippers-real-clip-permission-crm.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm-batch-template.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, realClipPermissionCrmBatchTemplateCsv(status), "clippers-real-clip-permission-crm-batch-template.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm/record" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordRealClipPermissionCrm({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        exactVideoOrPostUrl: form.get("exactVideoOrPostUrl"),
        creatorOrRightsHolder: form.get("creatorOrRightsHolder"),
        outreachChannel: form.get("outreachChannel"),
        outreachStatus: form.get("outreachStatus"),
        permissionStatus: form.get("permissionStatus"),
        evidenceLink: form.get("evidenceLink"),
        operatorNotes: form.get("operatorNotes"),
      });
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm/evidence-file" && req.method === "POST") {
      const body = await readRequestBody(req, 128_000);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await createRealClipPermissionEvidenceFile({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        exactVideoOrPostUrl: form.get("exactVideoOrPostUrl"),
        creatorOrRightsHolder: form.get("creatorOrRightsHolder"),
        permissionType: form.get("permissionType"),
        proofSummary: form.get("proofSummary"),
        creditRequirements: form.get("creditRequirements"),
      });
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/real-clip-permission-crm/record-batch" && req.method === "POST") {
      const body = await readRequestBody(req, 256_000);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const result = await recordRealClipPermissionCrmBatch(validation.form.get("permissionCrmBatch"));
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-launch-authorization.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderTikTokLaunchAuthorizationPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-launch-authorization.json" && req.method === "GET") {
      const status = await buildStatus();
      const center = buildTikTokLaunchAuthorizationCenter(status);
      const { csv: _csv, ...publicCenter } = center;
      json(res, 200, publicCenter);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-launch-authorization.csv" && req.method === "GET") {
      const status = await buildStatus();
      csv(res, 200, buildTikTokLaunchAuthorizationCenter(status).csv, "clippers-tiktok-launch-authorization.csv");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-launch-authorization.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildTikTokLaunchAuthorizationMarkdown(status), "clippers-tiktok-launch-authorization.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/next-metricool-action.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildNextMetricoolActionPacket(status), "clippers-next-metricool-action.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-action.md" && req.method === "GET") {
      const status = await buildStatus();
      markdown(res, 200, buildCurrentTikTokActionPacket(status), "clippers-current-tiktok-action.md");
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-action.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, buildCurrentTikTokActionJson(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-caption.txt" && req.method === "GET") {
      const status = await buildStatus();
      const result = currentTikTokCaptionText(status);
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      text(res, 200, result.text);
      return;
    }
    if (parsed.pathname === "/api/clippers/tiktok-current-video.mp4" && req.method === "GET") {
      const status = await buildStatus();
      const result = currentTikTokVideoRedirect(status);
      if (!result.ok) {
        json(res, result.statusCode || 400, result);
        return;
      }
      res.writeHead(302, {
        location: result.location,
        "cache-control": "no-store",
      });
      res.end();
      return;
    }
    if (parsed.pathname === "/api/clippers/next-metricool-action.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, buildNextMetricoolActionJson(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/next-metricool-action.html" && req.method === "GET") {
      const status = await buildStatus();
      html(res, 200, renderNextMetricoolActionPage(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/operator-ready.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, buildOperatorReadySummary(status));
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence-integrity.json" && req.method === "GET") {
      const status = await buildStatus();
      json(res, 200, status.evidenceIntegrity);
      return;
    }
    if (parsed.pathname === "/api/clippers/refresh" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      json(res, 200, await refreshClippersArtifacts());
      return;
    }
    if (parsed.pathname === "/api/clippers/roll-forward" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const requestedLeadThresholdMinutes = Number(validation.form.get("leadThresholdMinutes"));
      const leadThresholdMinutes = Number.isFinite(requestedLeadThresholdMinutes)
        ? Math.min(requestedLeadThresholdMinutes, 20)
        : 20;
      const result = await guardedRollForwardPendingSchedules({
        leadThresholdMinutes,
      });
      const returnTo = safeReturnToPath(validation.form.get("returnTo"));
      if (result.status === "rolled_forward" && result.verifiedRollForward === true && returnTo) {
        res.writeHead(303, { location: returnTo, "cache-control": "no-store" });
        res.end();
      } else {
        json(res, result.statusCode || 200, result);
      }
      return;
    }
    if (parsed.pathname === "/api/clippers/external-evidence/preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const result = await previewExternalCloseoutEvidence();
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/external-evidence/apply-ready" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const result = await applyReadyExternalCloseoutEvidence();
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/external-evidence/record-next-proof" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordNextExternalProof({
        closeoutId: form.get("closeoutId"),
        proofReference: form.get("proofReference"),
        proofDetails: form.get("proofDetails"),
        operatorNotes: form.get("operatorNotes"),
      });
      json(res, result.statusCode || 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/scheduled" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordScheduledEvidence({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        metricoolApprovalUrl: form.get("metricoolApprovalUrl"),
        operatorNotes: form.get("operatorNotes"),
      });
      await appendEvidenceAuditLog("scheduled_single", form, result);
      await respondMutation(res, form, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/scheduled-preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const rawScheduledEvidence = renderCsv(
        ["metricool_queue_item_id", "metricool_approval_url", "operator_notes"],
        [{
          metricool_queue_item_id: String(form.get("metricoolQueueItemId") || "").trim(),
          metricool_approval_url: String(form.get("metricoolApprovalUrl") || "").trim(),
          operator_notes: String(form.get("operatorNotes") || "").trim(),
        }],
      );
      const result = await previewScheduledEvidence({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        metricoolApprovalUrl: form.get("metricoolApprovalUrl"),
        operatorNotes: form.get("operatorNotes"),
      });
      const previewReturnTo = safeReturnToPath(form.get("returnTo"));
      if (previewReturnTo) {
        const confirmToken = result.ok ? createPreviewConfirmToken("scheduled", rawScheduledEvidence) : "";
        html(res, 200, renderEvidencePreviewPage(result, {
          title: "Scheduled Proof Preview",
          importLabel: "Save scheduled proof",
          confirmToken,
          confirmType: "scheduled",
          returnTo: previewReturnTo,
        }));
        return;
      }
      json(res, 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/scheduled-batch" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await recordScheduledEvidenceBatch(form.get("scheduledEvidenceBatch"));
      await appendEvidenceAuditLog("scheduled_batch", form, result);
      await respondMutation(res, form, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/scheduled-batch-preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await previewScheduledEvidenceBatch(form.get("scheduledEvidenceBatch"));
      const previewReturnTo = safeReturnToPath(form.get("returnTo"));
      if (previewReturnTo) {
        const confirmToken = result.ok ? createPreviewConfirmToken("scheduled", form.get("scheduledEvidenceBatch")) : "";
        html(res, 200, renderEvidencePreviewPage(result, {
          title: "Scheduled Proof Batch Preview",
          importLabel: "Import scheduled proof batch",
          confirmToken,
          confirmType: "scheduled",
          returnTo: previewReturnTo,
        }));
        return;
      }
      json(res, 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/published" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      json(res, 409, {
        ok: false,
        statusCode: 409,
        error: "published_metrics_preview_confirmation_required",
        nextAction: "Use published metrics preview, review the redacted HTML confirmation, then confirm with the one-time preview token.",
      });
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/published-preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const rawPublishedEvidence = renderCsv(
        ["metricool_queue_item_id", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_notes"],
        [{
          metricool_queue_item_id: String(form.get("metricoolQueueItemId") || "").trim(),
          published_post_url: String(form.get("publishedPostUrl") || "").trim(),
          views_24h: String(form.get("views24h") || "").trim(),
          likes_24h: String(form.get("likes24h") || "").trim(),
          comments_24h: String(form.get("comments24h") || "").trim(),
          shares_24h: String(form.get("shares24h") || "").trim(),
          operator_notes: String(form.get("operatorNotes") || "").trim(),
        }],
      );
      const result = await previewPublishedEvidence({
        metricoolQueueItemId: form.get("metricoolQueueItemId"),
        publishedPostUrl: form.get("publishedPostUrl"),
        views24h: form.get("views24h"),
        likes24h: form.get("likes24h"),
        comments24h: form.get("comments24h"),
        shares24h: form.get("shares24h"),
        operatorNotes: form.get("operatorNotes"),
      });
      const previewReturnTo = safeReturnToPath(form.get("returnTo"));
      if (previewReturnTo) {
        const confirmToken = result.ok ? createPreviewConfirmToken("published", rawPublishedEvidence) : "";
        html(res, 200, renderEvidencePreviewPage(result, {
          title: "Published Metrics Preview",
          importLabel: "Save published metrics",
          confirmToken,
          confirmType: "published",
          returnTo: previewReturnTo,
        }));
        return;
      }
      json(res, 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/published-batch" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      json(res, 409, {
        ok: false,
        statusCode: 409,
        error: "published_metrics_preview_confirmation_required",
        nextAction: "Use published metrics batch preview, review the redacted HTML confirmation, then confirm with the one-time preview token.",
      });
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/published-batch-preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const result = await previewPublishedEvidenceBatch(form.get("publishedEvidenceBatch"));
      const previewReturnTo = safeReturnToPath(form.get("returnTo"));
      if (previewReturnTo) {
        const confirmToken = result.ok ? createPreviewConfirmToken("published", form.get("publishedEvidenceBatch")) : "";
        html(res, 200, renderEvidencePreviewPage(result, {
          title: "Published Metrics Batch Preview",
          importLabel: "Import published metrics batch",
          confirmToken,
          confirmType: "published",
          returnTo: previewReturnTo,
        }));
        return;
      }
      json(res, 200, result);
      return;
    }
    if (parsed.pathname === "/api/clippers/evidence/confirm-preview" && req.method === "POST") {
      const body = await readRequestBody(req);
      const validation = validatePostRequest(req, body);
      if (!validation.ok) {
        json(res, validation.statusCode, validation);
        return;
      }
      const form = validation.form;
      const previewType = String(form.get("previewType") || "");
      const consumed = consumePreviewConfirmToken(form.get("previewToken"), previewType);
      if (!consumed.ok) {
        json(res, consumed.statusCode, consumed);
        return;
      }
      const result = previewType === "scheduled"
        ? await recordScheduledEvidenceBatch(consumed.rawText)
        : previewType === "published"
          ? await recordPublishedEvidenceBatch(consumed.rawText)
          : { ok: false, statusCode: 400, error: "invalid_preview_type" };
      const auditForm = new URLSearchParams();
      auditForm.set(previewType === "scheduled" ? "scheduledEvidenceBatch" : "publishedEvidenceBatch", consumed.rawText);
      await appendEvidenceAuditLog(`${previewType}_batch_confirmed`, auditForm, result);
      await respondMutation(res, form, result);
      return;
    }
    if (parsed.pathname === "/" || parsed.pathname === "/clippers") {
      html(res, 200, renderHome(await buildStatus()));
      return;
    }
    if (parsed.pathname.startsWith("/clippers-workspace/")) {
      const filePath = safeWorkspacePath(parsed.pathname);
      if (!filePath) {
        text(res, 403, "Forbidden");
        return;
      }
      await serveFile(res, filePath);
      return;
    }
    text(res, 404, "Not found");
  } catch (error) {
    json(res, 500, { error: error?.message || "Unexpected Clippers local server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Clippers local operator server running at ${localOrigin()}/clippers`);
});

if (autoRollForwardEnabled) {
  const intervalMs = Number.isFinite(autoRollForwardIntervalMs) && autoRollForwardIntervalMs >= 5_000
    ? autoRollForwardIntervalMs
    : 60_000;
  const interval = setInterval(() => {
    runAutoRollForwardWatchdog().catch((error) => {
      watchdogState.lastStatus = "failed";
      watchdogState.lastReason = error?.message || "auto_roll_forward_error";
    });
  }, intervalMs);
  interval.unref?.();
  runAutoRollForwardWatchdog().catch((error) => {
    watchdogState.lastStatus = "failed";
    watchdogState.lastReason = error?.message || "auto_roll_forward_error";
  });
}
