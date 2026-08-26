import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { classifyMetricoolCsv, extractMetricoolCsvSamples } from "./blackroom-metricool-csv-bridge.mjs";
import { applyBlackRoomDeliveryCounts, buildBlackRoomPublicationExperiments, planBlackRoomRemoteSync, summarizeBlackRoomDeliveryLedger } from "./blackroom-remote-sync.mjs";

const execFileAsync = promisify(execFile);
const projectDir = process.cwd();
const port = Number(process.env.BLACKROOM_CONTROL_PORT || 5020);
const npmPath = process.env.BLACKROOM_NPM_PATH || "npm";
const workerStatePath = path.join(projectDir, "clippers_workspace/blackroom/agent/worker-state.json");
const workerLedgerPath = path.join(projectDir, "clippers_workspace/blackroom/agent/worker-ledger.json");
const workerActivityPath = path.join(projectDir, "clippers_workspace/blackroom/agent/activity-log.json");
const csvBridgeStatePath = path.join(projectDir, "clippers_workspace/blackroom/agent/metricool-csv-imports.json");
const csvExportDir = path.resolve(process.env.BLACKROOM_METRICOOL_EXPORT_DIR || path.join(homedir(), "Downloads"));
const remoteUrl = String(process.env.BLACKROOM_REMOTE_CONTROL_URL || "https://ROBPLANNER.replit.app").replace(/\/$/, "");
const remoteToken = String(process.env.BLACKROOM_REMOTE_CONTROL_TOKEN || "").trim();
const remotePollMs = Math.max(10_000, Number(process.env.BLACKROOM_REMOTE_POLL_MS || 15_000));
const csvScanMs = Math.max(60_000, Number(process.env.BLACKROOM_METRICOOL_CSV_SCAN_MS || 5 * 60_000));
const controlToken = randomBytes(32).toString("hex");
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
let commandTail = Promise.resolve();
let lastAppliedGeneration = -1;
let nextCsvScanAt = 0;
let csvBridgeStatus = { lastCheckedAt: null, lastImportedAt: null, importedFiles: 0, importedSamples: 0, lastError: null };

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function command(name, options = {}) {
  const args = ["run", "blackroom:agent", "--", `--${name}`];
  if (options.weeks) args.push("--weeks", String(options.weeks));
  if (options.commands) args.push("--commands", Buffer.from(JSON.stringify(options.commands)).toString("base64url"));
  const { stdout } = await execFileAsync(npmPath, args, { cwd: projectDir, maxBuffer: 2_000_000 });
  const start = stdout.indexOf('{\n  "mode": "blackroom_daily_agent"');
  if (start < 0) throw new Error("Estado de cola inválido");
  return JSON.parse(stdout.slice(start)).summary;
}

function serializedCommand(name, options) {
  const next = commandTail.then(() => command(name, options));
  commandTail = next.catch(() => undefined);
  return next;
}

async function workerState() {
  let state;
  try { state = JSON.parse(await readFile(workerStatePath, "utf8")); }
  catch { state = { running: false, pid: null, runs: 0, lastError: null }; }
  try {
    const activity = JSON.parse(await readFile(workerActivityPath, "utf8"));
    return { ...state, csvBridge: csvBridgeStatus, activity: Array.isArray(activity) ? activity.slice(-80) : [] };
  } catch { return { ...state, csvBridge: csvBridgeStatus, activity: [] }; }
}

async function queueWithDeliveryCounts(queue) {
  try {
    const ledger = JSON.parse(await readFile(workerLedgerPath, "utf8"));
    return applyBlackRoomDeliveryCounts(queue, summarizeBlackRoomDeliveryLedger(ledger, new Date(), queue?.timezone));
  } catch {
    return applyBlackRoomDeliveryCounts(queue, { scheduled: 0, completed: 0, confirmed: 0 });
  }
}

async function publicationExperiments() {
  try { return buildBlackRoomPublicationExperiments(JSON.parse(await readFile(workerLedgerPath, "utf8"))); }
  catch { return []; }
}

function wakeWorker() {
  const child = spawn(npmPath, ["run", "blackroom:worker"], { cwd: projectDir, detached: true, stdio: "ignore" });
  child.unref();
}

async function stopWorker() {
  const state = await workerState();
  if (Number.isInteger(state.workerPid) && state.workerPid > 0) {
    try { process.kill(state.workerPid, "SIGTERM"); } catch { /* already stopped */ }
  } else if (state.running && Number.isInteger(state.pid) && state.pid > 0) {
    try { process.kill(-state.pid, "SIGTERM"); } catch { /* legacy state */ }
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const current = await workerState();
    if (!current.running && !current.workerPid && !current.pid) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El trabajador local no confirmó la pausa dentro de 12 segundos");
}

async function remoteRequest(method, body, pathname = "/api/blackroom-agent/remote") {
  const response = await fetch(`${remoteUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${remoteToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Remote control returned ${response.status}`);
  return data;
}

async function syncMetricoolCsvExports(force = false) {
  if (!remoteToken || (!force && Date.now() < nextCsvScanAt)) return csvBridgeStatus;
  nextCsvScanAt = Date.now() + csvScanMs;
  const checkedAt = new Date().toISOString();
  try {
    const previous = JSON.parse(await readFile(csvBridgeStatePath, "utf8").catch(() => '{"files":{}}'));
    const entries = await readdir(csvExportDir, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const changed = [];
    for (const entry of entries) {
      if (!entry.isFile() || !classifyMetricoolCsv(entry.name)) continue;
      const filePath = path.join(csvExportDir, entry.name);
      const info = await stat(filePath);
      if (info.size <= 0 || info.size > 25 * 1024 * 1024) continue;
      const content = await readFile(filePath, "utf8");
      const fingerprint = createHash("sha256").update(content).digest("hex");
      if (previous.files?.[entry.name] === fingerprint) continue;
      const extracted = extractMetricoolCsvSamples(entry.name, content);
      if (extracted?.samples.length) changed.push({ filename: entry.name, fingerprint, ...extracted });
    }
    if (!changed.length) {
      csvBridgeStatus = { ...csvBridgeStatus, lastCheckedAt: checkedAt, lastError: null };
      return csvBridgeStatus;
    }
    const grouped = new Map();
    for (const file of changed) {
      const group = grouped.get(file.network) || { network: file.network, sourceFiles: [], samples: new Map() };
      group.sourceFiles.push(file.filename);
      for (const sample of file.samples) group.samples.set(sample.id, sample);
      grouped.set(file.network, group);
    }
    const imports = [...grouped.values()].map((group) => ({
      network: group.network,
      sourceFiles: group.sourceFiles,
      samples: [...group.samples.values()].slice(-2_000),
    }));
    await remoteRequest("POST", { imports }, "/api/blackroom-agent/analytics/import");
    const files = { ...(previous.files || {}) };
    for (const file of changed) files[file.filename] = file.fingerprint;
    await writeJsonAtomic(csvBridgeStatePath, { version: 1, updatedAt: checkedAt, files });
    const importedSamples = imports.reduce((total, item) => total + item.samples.length, 0);
    csvBridgeStatus = {
      lastCheckedAt: checkedAt,
      lastImportedAt: checkedAt,
      importedFiles: changed.length,
      importedSamples,
      lastError: null,
    };
    console.log(`[blackroom-control] imported ${importedSamples} Metricool CSV samples from ${changed.length} file(s)`);
  } catch (error) {
    csvBridgeStatus = {
      ...csvBridgeStatus,
      lastCheckedAt: checkedAt,
      lastError: error instanceof Error ? error.message : String(error),
    };
    console.error("[blackroom-control] Metricool CSV bridge failed:", csvBridgeStatus.lastError);
  }
  return csvBridgeStatus;
}

async function syncRemoteControl() {
  if (!remoteToken) return;
  let lastError = null;
  let queue;
  try {
    const { control } = await remoteRequest("GET");
    queue = await serializedCommand("status");
    const currentWorker = await workerState();
    if (Number(control.generation || 0) !== lastAppliedGeneration && Array.isArray(control.commands) && control.commands.length) {
      queue = await serializedCommand("remote-config", { commands: control.commands });
      if (control.desiredEnabled && control.commands.at(-1)?.type === "work_now") wakeWorker();
    }
    const plan = planBlackRoomRemoteSync({
      control,
      localEnabled: queue.enabled,
      localWorkerRunning: Boolean(currentWorker.running || currentWorker.workerPid || currentWorker.pid),
      lastAppliedGeneration,
    });
    if (plan.action === "start") {
      queue = await serializedCommand("start", { weeks: control.weeks });
      wakeWorker();
    } else if (plan.action === "pause") {
      queue = await serializedCommand("pause");
      await stopWorker();
    }
    lastAppliedGeneration = plan.generation;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[blackroom-control] remote sync failed:", lastError);
  }
  try {
    queue ||= await serializedCommand("status");
    queue = await queueWithDeliveryCounts(queue);
    await remoteRequest("POST", {
      deviceId: "blackroom-mac",
      queue,
      worker: await workerState(),
      publicationExperiments: await publicationExperiments(),
      lastError,
      appliedGeneration: Math.max(0, lastAppliedGeneration),
    });
  } catch (error) {
    console.error("[blackroom-control] remote heartbeat failed:", error instanceof Error ? error.message : error);
  }
}

function authorized(req) {
  const host = String(req.headers.host || "");
  const origin = String(req.headers.origin || "");
  const fetchSite = String(req.headers["sec-fetch-site"] || "");
  const expected = Buffer.from(controlToken);
  const actual = Buffer.from(String(req.headers["x-blackroom-control"] || ""));
  return allowedHosts.has(host)
    && (!origin || origin === `http://${host}`)
    && (!fetchSite || fetchSite === "same-origin" || fetchSite === "none")
    && actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(req, limit = 8_192) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
  }
  return raw;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

const page = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BlackRoom Agent Local</title><style>:root{color-scheme:dark;font-family:Inter,system-ui;background:#020203;color:#fff}body{margin:0;background:radial-gradient(circle at top,#12313a,#07070a 38%,#000);min-height:100vh}.wrap{max-width:900px;margin:auto;padding:48px 20px}.card{background:#09090be8;border:1px solid #ffffff1c;border-radius:18px;padding:24px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}button,select{height:44px;border:1px solid #ffffff24;border-radius:10px;background:#18181b;color:#fff;padding:0 15px;font-weight:700}.play{background:#a7f3d0;color:#052e24}.badge{padding:7px 12px;border-radius:999px;background:#fbbf2414;color:#fde68a}.on{background:#10b98118;color:#a7f3d0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.stat{border:1px solid #ffffff14;padding:15px;border-radius:12px}.muted{color:#a1a1aa}@media(max-width:600px){.stats{grid-template-columns:1fr}}</style></head><body><main class="wrap"><p style="color:#67e8f9">BLACKROOM · TRABAJADOR LOCAL</p><h1>Agente de contenido</h1><p class="muted">YouTube → edición → Metricool → TikTok + Facebook + YouTube Shorts</p><section class="card"><div class="row"><span id="badge" class="badge">Cargando…</span><select id="weeks"><option value="1">1 semana</option><option value="2" selected>2 semanas</option><option value="3">3 semanas</option><option value="4">4 semanas</option></select><button id="play" class="play">▶ Activar</button><button id="pause">Ⅱ Pausar</button><button id="refresh">↻ Actualizar</button></div><div class="stats"><div class="stat">Lotes en cola<br><strong id="queued">0</strong></div><div class="stat">Editor local activo<br><strong id="running">No</strong></div><div class="stat">Ciclos realizados<br><strong id="runs">0</strong></div></div><p id="detail" class="muted"></p><p class="muted">Prueba 15s, 30s, 1m, 2m, 5m y 10m sin IA. Borra archivos locales solo después de confirmar todos los destinos requeridos en Metricool. La Mac debe permanecer activa durante la edición y el envío.</p></section></main><script>const token=${JSON.stringify(controlToken)};let pending=0;async function api(path,opt={}){opt.headers={...(opt.headers||{}),'X-BlackRoom-Control':token};const r=await fetch(path,opt),d=await r.json();if(!r.ok)throw new Error(d.error||'Error');return d}function render(d){badge.textContent=d.queue.enabled?'Trabajando':'Pausado';badge.className='badge '+(d.queue.enabled?'on':'');queued.textContent=(d.queue.totals.queued||0)+(d.queue.totals.retry||0);running.textContent=d.worker.running?'Sí':'No';runs.textContent=d.worker.runs||0;detail.textContent=d.worker.lastError||('Próximo lote: '+(d.queue.nextJob?.targetDate||'ninguno'))}async function run(path,opt,priority=false){if(pending&&!priority)return;pending++;try{render(await api(path,opt))}catch(e){detail.textContent=e.message}finally{pending--}}play.onclick=()=>run('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weeks:Number(weeks.value)})});pause.onclick=()=>run('/api/pause',{method:'POST'},true);refresh.onclick=()=>run('/api/status');run('/api/status');setInterval(()=>run('/api/status'),10000)</script></body></html>`;

const renderedPage = page.replace('<option value="1">1 semana</option>', '');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (!allowedHosts.has(String(req.headers.host || ""))) return send(res, 403, { error: "Forbidden host" });
    if (req.method === "GET" && ["/", "/blackroom"].includes(url.pathname)) return send(res, 200, renderedPage, "text/html; charset=utf-8");
    if (url.pathname.startsWith("/api/") && !authorized(req)) return send(res, 403, { error: "Forbidden" });
    if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, { queue: await serializedCommand("status"), worker: await workerState() });
    if (req.method === "POST" && url.pathname === "/api/pause") {
      const queue = await serializedCommand("pause");
      await stopWorker();
      return send(res, 200, { queue, worker: await workerState() });
    }
    if (req.method === "POST" && url.pathname === "/api/start") {
      const raw = await readBody(req);
      const weeks = Math.max(2, Math.min(4, Number(JSON.parse(raw || "{}").weeks || 2)));
      const queue = await serializedCommand("start", { weeks }); wakeWorker();
      return send(res, 200, { queue, worker: await workerState() });
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) { return send(res, Number(error?.statusCode || 500), { error: error instanceof Error ? error.message : String(error) }); }
});

async function recoverWorker() {
  try { if ((await serializedCommand("status")).enabled) wakeWorker(); }
  catch (error) { console.error("[blackroom-control] startup recovery failed", error); }
}

server.listen(port, "127.0.0.1", () => console.log(`[blackroom-control] http://127.0.0.1:${port}/blackroom`));
setTimeout(recoverWorker, 1_000);
setInterval(recoverWorker, 60_000).unref();
if (remoteToken) {
  const remoteLoop = async () => {
    await syncMetricoolCsvExports();
    await syncRemoteControl();
    setTimeout(remoteLoop, remotePollMs).unref();
  };
  setTimeout(remoteLoop, 2_000);
} else {
  console.warn("[blackroom-control] BLACKROOM_REMOTE_CONTROL_TOKEN is not configured; Replit control is disabled");
}
