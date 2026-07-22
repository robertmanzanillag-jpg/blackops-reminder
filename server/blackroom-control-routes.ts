import { type Express, type Request, type Response } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BLACKROOM_QUEUE_PATH, pauseBlackRoomAgent, readBlackRoomQueue, startBlackRoomAgent, summarizeBlackRoomQueue, withBlackRoomQueueLock, writeBlackRoomQueue } from "./blackroom-daily-queue";
import {
  isBlackRoomRemoteDeviceOnline,
  mutateBlackRoomRemoteControl,
  appendBlackRoomCeoCommand,
  readBlackRoomRemoteControl,
  recordBlackRoomRemoteHeartbeat,
  setBlackRoomRemoteCommand,
  type BlackRoomRemoteControlState,
} from "./blackroom-remote-control";
import { executeBlackRoomChatMessage } from "./blackroom-chat-service";
import { BlackRoomMetricoolUncertainError, scheduleBlackRoomMetricoolPost } from "./blackroom-metricool-bridge";
import { BLACKROOM_CEO_DAILY_POSTS, BLACKROOM_CEO_REFRESH_MS, buildBlackRoomLearningSlots, collectBlackRoomMetricoolAnalytics } from "./blackroom-growth-ceo";
import { getCurrentUserId } from "./user-context";
import { isConfiguredSingleUserOwner } from "./single-user-owner";

const BLACKROOM_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const BLACKROOM_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const BLACKROOM_UPLOAD_TTL_MS = 30 * 60_000;
const blackRoomUploadDir = path.join(os.tmpdir(), "blackroom-metricool-uploads");
type BlackRoomUpload = {
  filePath: string;
  reservationId: string;
  expiresAt: number;
  ready: boolean;
  totalBytes?: number;
  totalChunks?: number;
  nextChunk?: number;
  chunkSizes?: number[];
};
const blackRoomUploads = new Map<string, BlackRoomUpload>();
let blackRoomCeoRefreshPromise: Promise<void> | null = null;
export const BLACKROOM_PUBLIC_MEDIA_PATHS = ["/api/blackroom-agent/media/:uploadId.mp4", "/api/blackroom-agent/media/:uploadId"] as const;

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function blackRoomLocalDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

async function refreshBlackRoomCeo(force = false): Promise<void> {
  if (blackRoomCeoRefreshPromise) return blackRoomCeoRefreshPromise;
  blackRoomCeoRefreshPromise = (async () => {
    const current = await readBlackRoomRemoteControl();
    const previous = [...current.commands].reverse().find((command) => command.type === "ceo_schedule");
    if (!force && previous && Date.now() - new Date(previous.createdAt).getTime() < BLACKROOM_CEO_REFRESH_MS) return;
    const analytics = await collectBlackRoomMetricoolAnalytics();
    const today = blackRoomLocalDate(new Date());
    const currentTarget = Number((current.device?.queue as any)?.postsPerDay || BLACKROOM_CEO_DAILY_POSTS);
    const posts = Math.max(BLACKROOM_CEO_DAILY_POSTS, Math.min(16, Math.floor(currentTarget)));
    const slotsByDate = Object.fromEntries(Array.from({ length: 14 }, (_, dayIndex) => {
      const targetDate = addUtcDays(today, dayIndex + 1);
      return [targetDate, buildBlackRoomLearningSlots({
        dayIndex,
        posts,
        sampleCount: analytics.sampleCount,
        recommendedTimes: analytics.recommendedTimes,
      })];
    }));
    await mutateBlackRoomRemoteControl((state) => appendBlackRoomCeoCommand(state, {
      id: `blackroom-ceo-${randomUUID()}`,
      type: "ceo_schedule",
      slotsByDate,
      analytics,
      createdAt: analytics.lastCheckedAt,
    }));
  })().finally(() => { blackRoomCeoRefreshPromise = null; });
  return blackRoomCeoRefreshPromise;
}

async function removeBlackRoomUpload(uploadId: string): Promise<void> {
  const upload = blackRoomUploads.get(uploadId);
  if (!upload) return;
  blackRoomUploads.delete(uploadId);
  await unlink(upload.filePath).catch(() => undefined);
}

function cleanupExpiredBlackRoomUploads(): void {
  for (const [uploadId, upload] of blackRoomUploads) {
    if (upload.expiresAt <= Date.now()) void removeBlackRoomUpload(uploadId);
  }
}

async function receiveBlackRoomUpload(request: NodeJS.ReadableStream, filePath: string): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > BLACKROOM_UPLOAD_MAX_BYTES) {
        const error = new Error("BlackRoom upload exceeds Metricool's 500 MB limit") as Error & { status?: number };
        error.status = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, limiter, createWriteStream(filePath, { flags: "wx" }));
  return bytes;
}

async function receiveBlackRoomUploadChunk(request: NodeJS.ReadableStream, filePath: string): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > BLACKROOM_UPLOAD_CHUNK_BYTES) {
        const error = new Error("BlackRoom upload chunk exceeds 4 MB") as Error & { status?: number };
        error.status = 413;
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, limiter, createWriteStream(filePath, { flags: "wx" }));
  return bytes;
}

export function parseBlackRoomMediaRange(value: string | undefined, size: number): { start: number; end: number } | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return false;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return false;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return false;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function blackRoomMediaHeaders(
  uploadId: string,
  size: number,
  range: { start: number; end: number } | null,
  method = "GET",
): Record<string, string> {
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  return {
    "Accept-Ranges": "bytes",
    "Content-Type": "video/mp4",
    "Content-Disposition": `inline; filename="blackroom-${uploadId}.mp4"`,
    "Cache-Control": "public, max-age=300",
    // Replit's deployment proxy rejects large, length-delimited responses even
    // though byte-range requests work. Stream full GETs with chunked encoding;
    // retain Content-Length for HEAD probes and explicit ranges.
    ...((range || method === "HEAD") ? { "Content-Length": String(end - start + 1) } : {}),
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  };
}

async function serveBlackRoomMedia(req: Request, res: Response): Promise<void> {
  cleanupExpiredBlackRoomUploads();
  const upload = blackRoomUploads.get(String(req.params.uploadId || ""));
  if (!upload?.ready) { res.status(404).end(); return; }
  const info = await stat(upload.filePath).catch(() => null);
  if (!info?.isFile()) {
    await removeBlackRoomUpload(String(req.params.uploadId || ""));
    res.status(404).end();
    return;
  }
  const range = parseBlackRoomMediaRange(req.get("range"), info.size);
  if (range === false) {
    res.status(416).set("Content-Range", `bytes */${info.size}`).end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const status = range ? 206 : 200;
  res.status(status).set(blackRoomMediaHeaders(String(req.params.uploadId || ""), info.size, range, req.method));
  if (req.method === "HEAD") { res.end(); return; }
  try {
    await pipeline(createReadStream(upload.filePath, { start, end }), res);
  } catch {
    if (!res.headersSent) res.status(500).end();
  }
}

export function hasValidBlackRoomRemoteToken(authorization: string | undefined, configuredToken = process.env.BLACKROOM_REMOTE_CONTROL_TOKEN): boolean {
  const token = String(configuredToken || "").trim();
  if (token.length < 32 || /replace|example|your[-_ ]?token/i.test(token)) return false;
  const supplied = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function remoteView(state: BlackRoomRemoteControlState) {
  return { ...state, online: isBlackRoomRemoteDeviceOnline(state) };
}

export async function hasBlackRoomChatAccess(req: Request): Promise<boolean> {
  return isConfiguredSingleUserOwner(getCurrentUserId(req));
}

export const blackRoomPage = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BlackRoom Content Agent</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui;background:#020203;color:#fff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#12313a,#07070a 38%,#000);min-height:100vh}.wrap{max-width:1050px;margin:auto;padding:42px 20px}.eyebrow{color:#67e8f9;font-size:12px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:40px;margin:10px 0}.muted{color:#a1a1aa}.card{border:1px solid #ffffff1c;border-radius:18px;background:#09090be8;padding:24px}.top,.controls{display:flex;gap:16px;align-items:center;justify-content:space-between}.badge{border:1px solid #fbbf2444;background:#fbbf2414;color:#fde68a;border-radius:999px;padding:7px 12px}.badge.on{border-color:#6ee7b744;background:#10b98118;color:#a7f3d0}.controls{justify-content:flex-start;margin-top:22px;flex-wrap:wrap}select,button{height:44px;border-radius:10px;border:1px solid #ffffff24;background:#18181b;color:#fff;padding:0 15px}button{cursor:pointer;font-weight:700}.play{background:#a7f3d0;color:#052e24;border:0}.pause{color:#fde68a}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}.stat,.info{border:1px solid #ffffff14;background:#0007;border-radius:12px;padding:15px}.stat small{display:block;color:#71717a;text-transform:uppercase;font-size:10px}.stat strong{font-size:25px}.info{margin-top:14px;font-size:13px;color:#a1a1aa}.channel{color:#67e8f9}.chat{margin-top:22px;border-top:1px solid #ffffff14;padding-top:20px}.messages{display:flex;flex-direction:column;gap:9px;max-height:280px;overflow:auto;margin:12px 0}.msg{max-width:82%;padding:10px 12px;border-radius:12px;background:#18181b;color:#d4d4d8;font-size:14px}.msg.user{align-self:flex-end;background:#164e63;color:#ecfeff}.composer{display:flex;gap:8px}.composer input{flex:1;min-width:0;height:44px;border-radius:10px;border:1px solid #ffffff24;background:#050507;color:#fff;padding:0 13px}@media(max-width:720px){h1{font-size:30px}.top{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:repeat(2,1fr)}.composer{flex-direction:column}}
</style></head><body><main class="wrap"><div class="eyebrow">BlackRoom · TikTok + Facebook + YouTube</div><div class="top"><div><h1>BlackRoom Content Agent</h1><p class="muted">YouTube → edición → Metricool → TikTok + Facebook + YouTube</p></div><div><a class="channel" href="https://www.youtube.com/@blackroom_us" target="_blank">Canal oficial ↗</a> · <a class="channel" href="https://www.facebook.com/profile.php?id=61568193332044" target="_blank">Facebook principal ↗</a></div></div><section class="card"><div class="top"><div><h2>Control del agente</h2><p class="muted">Cantidad flexible, 5 DJs, videos sin repetir, drops y cortes verticales/horizontales.</p></div><span id="badge" class="badge">Cargando…</span></div><div class="controls"><select id="weeks"><option value="1">1 semana</option><option value="2" selected>2 semanas</option><option value="3">3 semanas</option><option value="4">4 semanas</option></select><button id="play" class="play">▶ Iniciar agente</button><button id="pause" class="pause" hidden>Ⅱ Pausar agente</button><button id="refresh">↻ Actualizar</button></div><div class="stats"><div class="stat"><small>En cola</small><strong id="queued">0</strong></div><div class="stat"><small>Procesando</small><strong id="processing">0</strong></div><div class="stat"><small>Reintentos</small><strong id="retry">0</strong></div><div class="stat"><small>Agendados</small><strong id="scheduled">0</strong></div><div class="stat"><small>Completados</small><strong id="completed">0</strong></div></div><div id="device" class="info">Buscando la Mac…</div><div id="experiment" class="info">Experimento 15s · 30s · 60s · 2m · 5m · 10m</div><div id="next" class="info">Leyendo cola…</div><p class="info">Cada clip exige confirmación de TikTok, Facebook y YouTube. Los verticales elegibles van como Shorts; los horizontales o largos van como video normal de YouTube. Facebook enlaza el video completo y la página principal. Los archivos se borran solo después de confirmar las tres cuentas.</p><div class="chat"><h2>Habla con el agente</h2><p class="muted">Ejemplos: “sube 3 videos más hoy”, “sube 12 por día” o pega una URL de YouTube.</p><div id="messages" class="messages"></div><form id="chatForm" class="composer"><input id="chatInput" maxlength="1000" placeholder="Escribe una orden para BlackRoom…"><button id="chatSend" type="submit" class="play">Enviar</button></form></div></section></main><script>
const byId=id=>document.getElementById(id),els={badge:byId('badge'),weeks:byId('weeks'),play:byId('play'),pause:byId('pause'),refresh:byId('refresh'),device:byId('device'),experiment:byId('experiment'),next:byId('next'),messages:byId('messages'),chatForm:byId('chatForm'),chatInput:byId('chatInput'),chatSend:byId('chatSend')},ids=['queued','processing','retry','scheduled','completed'],durations=[15,30,60,120,300,600],labels={15:'15s',30:'30s',60:'60s',120:'2m',300:'5m',600:'10m'};let mutationBusy=false,requestGeneration=0;async function req(path,opt={}){const r=await fetch(path,{credentials:'same-origin',...opt}),contentType=r.headers.get('content-type')||'',d=contentType.includes('application/json')?await r.json():{};if(!r.ok){if(r.status===401)throw new Error('Tu sesión expiró. Abre BlackOps, inicia sesión y vuelve a este panel.');throw new Error(d.error||('Error HTTP '+r.status))}return d}function renderChat(history=[]){els.messages.replaceChildren(...history.map(item=>{const node=document.createElement('div');node.className='msg '+item.role;node.textContent=item.text;return node}));els.messages.scrollTop=els.messages.scrollHeight}function render(d){const s=d.agent,remote=d.remote||{},worker=remote.device?.worker||{},desired=Boolean(remote.desiredEnabled),workerRunning=Boolean(worker.running||worker.workerPid||worker.pid),synced=remote.online&&Number(remote.device?.appliedGeneration||0)>=Number(remote.generation||0)&&Boolean(s.enabled)===desired&&(desired||!workerRunning),working=desired&&synced,pausing=!desired&&remote.online&&!synced;els.badge.textContent=working?'Trabajando de verdad':desired?'Orden en cola':pausing?'Pausando…':'Pausado';els.badge.className='badge'+(working?' on':'');els.play.hidden=desired||pausing;els.pause.hidden=!desired;els.weeks.disabled=desired||pausing||mutationBusy;ids.forEach(id=>byId(id).textContent=s.totals[id]||0);els.device.textContent=synced?(workerRunning?'● Mac conectada · trabajador activo':'● Mac conectada · esperando próximo trabajo'):remote.online?'◌ Mac conectada · aplicando orden…':'○ Mac desconectada · la orden quedará en cola hasta que se encienda';els.experiment.textContent='Objetivo: '+(s.postsPerDay||10)+'/día · '+durations.map(x=>labels[x]+': '+(s.durationSamples[x]||0)).join(' · ')+' · '+s.usedSourceVideos+' videos únicos'+(s.pendingPrioritySources?' · '+s.pendingPrioritySources+' URL prioritaria':'');els.next.textContent=s.nextJob?'Próximo lote: '+s.nextJob.targetDate+' · '+s.nextJob.status+(s.nextJob.lastError?' · último reintento registrado':''):'Pulsa Iniciar agente para comenzar.';renderChat(remote.chatHistory)}function disableActions(value){els.play.disabled=value;els.pause.disabled=value;els.refresh.disabled=value;els.chatInput.disabled=value;els.chatSend.disabled=value}async function refreshStatus(){if(mutationBusy)return;const generation=++requestGeneration;try{const data=await req('/api/blackroom-agent');if(generation===requestGeneration)render(data)}catch(error){if(generation===requestGeneration)els.next.textContent=error.message}}async function mutate(path,opt){if(mutationBusy)return;mutationBusy=true;disableActions(true);const generation=++requestGeneration;try{const data=await req(path,opt);if(generation===requestGeneration)render(data)}catch(error){if(generation===requestGeneration)els.next.textContent=error.message}finally{mutationBusy=false;disableActions(false)}}els.play.onclick=()=>mutate('/api/blackroom-agent/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weeks:Number(els.weeks.value)})});els.pause.onclick=()=>mutate('/api/blackroom-agent/pause',{method:'POST'});els.refresh.onclick=()=>refreshStatus();els.chatForm.onsubmit=async e=>{e.preventDefault();const message=els.chatInput.value.trim();if(!message||mutationBusy)return;mutationBusy=true;disableActions(true);const generation=++requestGeneration;els.next.textContent='Enviando orden…';try{const d=await req('/api/blackroom-agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});if(generation===requestGeneration){els.chatInput.value='';renderChat(d.remote.chatHistory);els.next.textContent=d.reply}}catch(error){if(generation===requestGeneration)els.next.textContent=error.message}finally{mutationBusy=false;disableActions(false);els.chatInput.focus()}};refreshStatus();setInterval(()=>refreshStatus(),15000);
</script></body></html>`;

export function registerBlackRoomControlRoutes(app: Express): void {
  app.get("/blackroom", (_req, res) => res.type("html").set("Cache-Control", "no-store").send(blackRoomPage));
  app.get("/api/blackroom-agent", async (_req, res) => {
    try {
      const remote = await readBlackRoomRemoteControl();
      const localQueue = remote.device?.queue as ReturnType<typeof summarizeBlackRoomQueue> | undefined;
      res.json({ agent: isBlackRoomRemoteDeviceOnline(remote) && localQueue?.totals ? localQueue : summarizeBlackRoomQueue(await readBlackRoomQueue()), remote: remoteView(remote) });
    }
    catch (error: any) { res.status(500).json({ error: error.message || "Failed to read BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/analytics/refresh", async (req, res) => {
    try {
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).json({ error: "Solo el owner puede actualizar los analytics de BlackRoom." });
      await refreshBlackRoomCeo(true);
      const remote = await readBlackRoomRemoteControl();
      res.json({ remote: remoteView(remote) });
    } catch (error: any) { res.status(502).json({ error: error.message || "No pude actualizar los analytics de Metricool" }); }
  });
  app.post("/api/blackroom-agent/start", async (req, res) => {
    try {
      const state = await withBlackRoomQueueLock(BLACKROOM_QUEUE_PATH, async () => {
        const current = await readBlackRoomQueue();
        startBlackRoomAgent(current, Number(req.body?.weeks || 2));
        await writeBlackRoomQueue(current);
        return current;
      });
      const remote = await mutateBlackRoomRemoteControl((current) => setBlackRoomRemoteCommand(current, true, Number(req.body?.weeks || 2)));
      res.json({ agent: summarizeBlackRoomQueue(state), remote: remoteView(remote) });
      void refreshBlackRoomCeo().catch((error) => console.error("[blackroom-ceo] analytics refresh failed:", error instanceof Error ? error.message : error));
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to start BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/pause", async (_req, res) => {
    try {
      const state = await withBlackRoomQueueLock(BLACKROOM_QUEUE_PATH, async () => {
        const current = await readBlackRoomQueue();
        pauseBlackRoomAgent(current);
        await writeBlackRoomQueue(current);
        return current;
      });
      const remote = await mutateBlackRoomRemoteControl((current) => setBlackRoomRemoteCommand(current, false));
      res.json({ agent: summarizeBlackRoomQueue(state), remote: remoteView(remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to pause BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/chat", async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      if (!message || message.length > 1_000) return res.status(400).json({ error: "Escribe un mensaje de hasta 1,000 caracteres." });
      if (!await hasBlackRoomChatAccess(req)) return res.status(403).json({ error: "Solo el owner puede controlar el agente de BlackRoom." });
      const result = await executeBlackRoomChatMessage(message);
      res.json({ reply: result.reply, command: result.command, remote: remoteView(result.remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "No pude procesar la orden de BlackRoom" }); }
  });
  app.get("/api/blackroom-agent/remote", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    try { res.json({ control: remoteView(await readBlackRoomRemoteControl()) }); }
    catch (error: any) { res.status(500).json({ error: error.message || "Failed to read remote command" }); }
  });
  app.post("/api/blackroom-agent/remote", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    try {
      const remote = await mutateBlackRoomRemoteControl((current) => recordBlackRoomRemoteHeartbeat(current, {
        deviceId: req.body?.deviceId,
        queue: req.body?.queue,
        worker: req.body?.worker,
        lastError: req.body?.lastError,
        appliedGeneration: req.body?.appliedGeneration,
      }));
      res.json({ control: remoteView(remote) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to record device heartbeat" }); }
  });
  app.put("/api/blackroom-agent/media/:reservationId", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const reservationId = String(req.params.reservationId || "").trim();
    if (!reservationId || reservationId.length > 300 || !req.is("application/octet-stream")) {
      return res.status(400).json({ error: "A reservation id and MP4 body are required" });
    }
    const declaredSize = Number(req.get("content-length") || 0);
    if (declaredSize > BLACKROOM_UPLOAD_MAX_BYTES) return res.status(413).json({ error: "BlackRoom upload exceeds Metricool's 500 MB limit" });
    cleanupExpiredBlackRoomUploads();
    const uploadId = randomUUID();
    const filePath = path.join(blackRoomUploadDir, `${uploadId}.mp4`);
    try {
      await mkdir(blackRoomUploadDir, { recursive: true });
      const bytes = await receiveBlackRoomUpload(req, filePath);
      if (bytes === 0) { await unlink(filePath).catch(() => undefined); return res.status(400).json({ error: "MP4 body is empty" }); }
      blackRoomUploads.set(uploadId, { filePath, reservationId, expiresAt: Date.now() + BLACKROOM_UPLOAD_TTL_MS, ready: true });
      const publicOrigin = `${req.protocol}://${req.get("host")}`;
      res.status(201).json({ uploadId, mediaUrl: `${publicOrigin}/api/blackroom-agent/media/${uploadId}.mp4` });
    } catch (error: any) {
      await unlink(filePath).catch(() => undefined);
      res.status(error?.status || 500).json({ error: error?.message || "BlackRoom upload failed" });
    }
  });
  app.post("/api/blackroom-agent/media/chunked", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const reservationId = String(req.body?.reservationId || "").trim();
    const totalBytes = Number(req.body?.totalBytes);
    const totalChunks = Number(req.body?.totalChunks);
    const expectedChunks = Math.ceil(totalBytes / BLACKROOM_UPLOAD_CHUNK_BYTES);
    if (!reservationId || reservationId.length > 300 || !Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > BLACKROOM_UPLOAD_MAX_BYTES || !Number.isSafeInteger(totalChunks) || totalChunks !== expectedChunks) {
      return res.status(400).json({ error: "Valid reservationId, totalBytes, and 4 MB chunk count are required" });
    }
    cleanupExpiredBlackRoomUploads();
    const uploadId = randomUUID();
    const filePath = path.join(blackRoomUploadDir, `${uploadId}.mp4`);
    try {
      await mkdir(blackRoomUploadDir, { recursive: true });
      await writeFile(filePath, Buffer.alloc(0), { flag: "wx" });
      blackRoomUploads.set(uploadId, {
        filePath, reservationId, totalBytes, totalChunks, nextChunk: 0, chunkSizes: [], ready: false,
        expiresAt: Date.now() + BLACKROOM_UPLOAD_TTL_MS,
      });
      res.status(201).json({ uploadId, chunkBytes: BLACKROOM_UPLOAD_CHUNK_BYTES });
    } catch (error: any) {
      await unlink(filePath).catch(() => undefined);
      res.status(500).json({ error: error?.message || "BlackRoom chunked upload initialization failed" });
    }
  });
  app.put("/api/blackroom-agent/media/chunked/:uploadId/:index", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const uploadId = String(req.params.uploadId || "");
    const index = Number(req.params.index);
    const upload = blackRoomUploads.get(uploadId);
    const declaredSize = Number(req.get("content-length") || 0);
    if (!upload || upload.ready) return res.status(404).json({ error: "BlackRoom chunked upload not found" });
    if (!req.is("application/octet-stream") || !Number.isSafeInteger(index) || index < 0 || index >= Number(upload.totalChunks) || !Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > BLACKROOM_UPLOAD_CHUNK_BYTES) {
      return res.status(400).json({ error: "A valid 4 MB upload chunk is required" });
    }
    if (index < Number(upload.nextChunk)) {
      if (upload.chunkSizes?.[index] === declaredSize) return res.json({ uploadId, index, accepted: true, duplicate: true });
      return res.status(409).json({ error: "BlackRoom upload chunk conflicts with an accepted chunk" });
    }
    if (index !== upload.nextChunk) return res.status(409).json({ error: "BlackRoom upload chunks must arrive in order" });
    const partPath = `${upload.filePath}.${index}.part`;
    try {
      const bytes = await receiveBlackRoomUploadChunk(req, partPath);
      if (bytes !== declaredSize || Number(upload.totalBytes) < (upload.chunkSizes || []).reduce((sum, size) => sum + size, 0) + bytes) {
        await unlink(partPath).catch(() => undefined);
        return res.status(400).json({ error: "BlackRoom upload chunk size does not match its declaration" });
      }
      await pipeline(createReadStream(partPath), createWriteStream(upload.filePath, { flags: "a" }));
      await unlink(partPath).catch(() => undefined);
      upload.chunkSizes?.push(bytes);
      upload.nextChunk = index + 1;
      upload.expiresAt = Date.now() + BLACKROOM_UPLOAD_TTL_MS;
      res.status(201).json({ uploadId, index, accepted: true });
    } catch (error: any) {
      await unlink(partPath).catch(() => undefined);
      res.status(error?.status || 500).json({ error: error?.message || "BlackRoom upload chunk failed" });
    }
  });
  app.post("/api/blackroom-agent/media/chunked/:uploadId/complete", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const uploadId = String(req.params.uploadId || "");
    const upload = blackRoomUploads.get(uploadId);
    if (!upload || upload.ready) return res.status(404).json({ error: "BlackRoom chunked upload not found" });
    const info = await stat(upload.filePath).catch(() => null);
    if (!info?.isFile() || upload.nextChunk !== upload.totalChunks || info.size !== upload.totalBytes) {
      return res.status(409).json({ error: "BlackRoom chunked upload is incomplete" });
    }
    upload.ready = true;
    upload.expiresAt = Date.now() + BLACKROOM_UPLOAD_TTL_MS;
    const publicOrigin = `${req.protocol}://${req.get("host")}`;
    res.json({ uploadId, mediaUrl: `${publicOrigin}/api/blackroom-agent/media/${uploadId}.mp4` });
  });
  // Register the extension-specific route first; the generic parameter route
  // would otherwise capture `.mp4` as part of the upload id.
  for (const mediaPath of BLACKROOM_PUBLIC_MEDIA_PATHS) {
    app.get(mediaPath, serveBlackRoomMedia);
    app.head(mediaPath, serveBlackRoomMedia);
  }
  app.post("/api/blackroom-agent/metricool/schedule", async (req, res) => {
    if (!hasValidBlackRoomRemoteToken(req.get("authorization"))) return res.status(401).json({ error: "Invalid BlackRoom device token" });
    const uploadId = String(req.body?.uploadId || "");
    const reservationId = String(req.body?.reservationId || "");
    const verifyOnly = req.body?.verifyOnly === true;
    const network = String(req.body?.network || "");
    if (!['tiktok', 'facebook', 'youtube'].includes(network)) return res.status(400).json({ error: "Invalid BlackRoom Metricool network" });
    const upload = verifyOnly ? null : blackRoomUploads.get(uploadId);
    if (!verifyOnly && (!upload?.ready || upload.reservationId !== reservationId)) return res.status(404).json({ error: "BlackRoom upload not found" });
    try {
      const publicOrigin = `${req.protocol}://${req.get("host")}`;
      const receipt = await scheduleBlackRoomMetricoolPost({
        caption: String(req.body?.caption || ""),
        language: req.body?.language === "es" ? "es" : "en",
        sourceVideoId: String(req.body?.sourceVideoId || ""),
        durationSeconds: Number(req.body?.durationSeconds),
        videoFormat: req.body?.videoFormat === "horizontal" ? "horizontal" : "vertical",
        publicationDateTime: String(req.body?.publicationDateTime || ""),
        timezone: String(req.body?.timezone || "America/New_York"),
        mediaUrl: verifyOnly ? "https://localhost.invalid/blackroom-verification-only.mp4" : `${publicOrigin}/api/blackroom-agent/media/${uploadId}.mp4`,
      }, { verifyOnly, networks: [network as "tiktok" | "facebook" | "youtube"] });
      if (!verifyOnly) await removeBlackRoomUpload(uploadId);
      res.status(201).json({ receipt });
    } catch (error: any) {
      const uncertain = error instanceof BlackRoomMetricoolUncertainError || error?.uncertain === true;
      if (!verifyOnly && !uncertain) await removeBlackRoomUpload(uploadId);
      res.status(uncertain ? 409 : 502).json({ error: error.message || "Metricool scheduling failed", uncertain });
    }
  });
  const ceoTimer = setInterval(() => {
    void refreshBlackRoomCeo().catch((error) => console.error("[blackroom-ceo] analytics refresh failed:", error instanceof Error ? error.message : error));
  }, 60 * 60_000);
  ceoTimer.unref();
}
