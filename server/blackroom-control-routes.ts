import type { Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { BLACKROOM_QUEUE_PATH, pauseBlackRoomAgent, readBlackRoomQueue, startBlackRoomAgent, summarizeBlackRoomQueue, withBlackRoomQueueLock, writeBlackRoomQueue } from "./blackroom-daily-queue";
import {
  isBlackRoomRemoteDeviceOnline,
  mutateBlackRoomRemoteControl,
  readBlackRoomRemoteControl,
  recordBlackRoomRemoteHeartbeat,
  setBlackRoomRemoteCommand,
  type BlackRoomRemoteControlState,
} from "./blackroom-remote-control";

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

export const blackRoomPage = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BlackRoom Content Agent</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui;background:#020203;color:#fff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#12313a,#07070a 38%,#000);min-height:100vh}.wrap{max-width:1050px;margin:auto;padding:42px 20px}.eyebrow{color:#67e8f9;font-size:12px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:40px;margin:10px 0}.muted{color:#a1a1aa}.card{border:1px solid #ffffff1c;border-radius:18px;background:#09090be8;padding:24px}.top,.controls{display:flex;gap:16px;align-items:center;justify-content:space-between}.badge{border:1px solid #fbbf2444;background:#fbbf2414;color:#fde68a;border-radius:999px;padding:7px 12px}.badge.on{border-color:#6ee7b744;background:#10b98118;color:#a7f3d0}.controls{justify-content:flex-start;margin-top:22px;flex-wrap:wrap}select,button{height:44px;border-radius:10px;border:1px solid #ffffff24;background:#18181b;color:#fff;padding:0 15px}button{cursor:pointer;font-weight:700}.play{background:#a7f3d0;color:#052e24;border:0}.pause{color:#fde68a}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}.stat,.info{border:1px solid #ffffff14;background:#0007;border-radius:12px;padding:15px}.stat small{display:block;color:#71717a;text-transform:uppercase;font-size:10px}.stat strong{font-size:25px}.info{margin-top:14px;font-size:13px;color:#a1a1aa}.channel{color:#67e8f9}@media(max-width:720px){h1{font-size:30px}.top{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="wrap"><div class="eyebrow">BlackRoom · TikTok Automation</div><div class="top"><div><h1>BlackRoom Content Agent</h1><p class="muted">YouTube → edición → Metricool → TikTok</p></div><a class="channel" href="https://www.youtube.com/@blackroom_us" target="_blank">Canal oficial ↗</a></div><section class="card"><div class="top"><div><h2>Control del agente</h2><p class="muted">10 posts diarios, 5 DJs, videos sin repetir, drops y cortes verticales/horizontales.</p></div><span id="badge" class="badge">Cargando…</span></div><div class="controls"><select id="weeks"><option value="1">1 semana · 70 posts</option><option value="2" selected>2 semanas · 140 posts</option><option value="3">3 semanas · 210 posts</option><option value="4">4 semanas · 280 posts</option></select><button id="play" class="play">▶ Iniciar agente</button><button id="pause" class="pause" hidden>Ⅱ Pausar agente</button><button id="refresh">↻ Actualizar</button></div><div class="stats"><div class="stat"><small>En cola</small><strong id="queued">0</strong></div><div class="stat"><small>Procesando</small><strong id="processing">0</strong></div><div class="stat"><small>Reintentos</small><strong id="retry">0</strong></div><div class="stat"><small>Agendados</small><strong id="scheduled">0</strong></div><div class="stat"><small>Completados</small><strong id="completed">0</strong></div></div><div id="device" class="info">Buscando la Mac…</div><div id="experiment" class="info">Experimento 15s · 30s · 60s · 2m · 5m · 10m</div><div id="next" class="info">Leyendo cola…</div><p class="info">Cada video de YouTube se registra y no puede volver a usarse. El agente compara segundos vistos, retención, finalización, compartidos, visitas al perfil y seguidores para aprender qué duración genera mayor crecimiento.</p></section></main><script>
const ids=['queued','processing','retry','scheduled','completed'],durations=[15,30,60,120,300,600],labels={15:'15s',30:'30s',60:'60s',120:'2m',300:'5m',600:'10m'};let busy=false;async function req(path,opt){const r=await fetch(path,opt),d=await r.json();if(!r.ok){if(r.status===401)throw new Error('Inicia sesión en BlackOps para controlar el agente.');throw new Error(d.error||'Error')}return d}function render(d){const s=d.agent,remote=d.remote||{},desired=Boolean(remote.desiredEnabled),workerRunning=Boolean(remote.device?.worker?.running||remote.device?.worker?.workerPid||remote.device?.worker?.pid),synced=remote.online&&Number(remote.device?.appliedGeneration||0)>=Number(remote.generation||0)&&Boolean(s.enabled)===desired&&(desired||!workerRunning),working=desired&&synced,pausing=!desired&&remote.online&&!synced;badge.textContent=working?'Trabajando':desired?'En cola':pausing?'Pausando…':'Pausado';badge.className='badge'+(working?' on':'');play.hidden=desired||pausing;pause.hidden=!desired;weeks.disabled=desired||pausing;ids.forEach(id=>document.getElementById(id).textContent=s.totals[id]||0);device.textContent=synced?'● Mac conectada · orden sincronizada':remote.online?'◌ Mac conectada · aplicando orden…':'○ Mac desconectada · la orden quedará en cola hasta que se encienda';experiment.textContent=durations.map(x=>labels[x]+': '+(s.durationSamples[x]||0)).join(' · ')+' · '+s.usedSourceVideos+' videos únicos';next.textContent=s.nextJob?'Próximo lote: '+s.nextJob.targetDate+' · '+s.nextJob.status:'Pulsa Iniciar agente para comenzar.'}async function run(path,opt){if(busy)return;busy=true;try{render(await req(path,opt))}catch(e){next.textContent=e.message}finally{busy=false}}play.onclick=()=>run('/api/blackroom-agent/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weeks:Number(weeks.value)})});pause.onclick=()=>run('/api/blackroom-agent/pause',{method:'POST'});refresh.onclick=()=>run('/api/blackroom-agent');run('/api/blackroom-agent');setInterval(()=>run('/api/blackroom-agent'),15000);
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
}
