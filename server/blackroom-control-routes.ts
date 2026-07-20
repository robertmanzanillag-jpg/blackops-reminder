import type { Express } from "express";
import { pauseBlackRoomAgent, readBlackRoomQueue, startBlackRoomAgent, summarizeBlackRoomQueue, writeBlackRoomQueue } from "./blackroom-daily-queue";

const blackRoomPage = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BlackRoom Content Agent</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui;background:#020203;color:#fff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#12313a,#07070a 38%,#000);min-height:100vh}.wrap{max-width:1050px;margin:auto;padding:42px 20px}.eyebrow{color:#67e8f9;font-size:12px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:40px;margin:10px 0}.muted{color:#a1a1aa}.card{border:1px solid #ffffff1c;border-radius:18px;background:#09090be8;padding:24px}.top,.controls{display:flex;gap:16px;align-items:center;justify-content:space-between}.badge{border:1px solid #fbbf2444;background:#fbbf2414;color:#fde68a;border-radius:999px;padding:7px 12px}.badge.on{border-color:#6ee7b744;background:#10b98118;color:#a7f3d0}.controls{justify-content:flex-start;margin-top:22px;flex-wrap:wrap}select,button{height:44px;border-radius:10px;border:1px solid #ffffff24;background:#18181b;color:#fff;padding:0 15px}button{cursor:pointer;font-weight:700}.play{background:#a7f3d0;color:#052e24;border:0}.pause{color:#fde68a}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}.stat,.info{border:1px solid #ffffff14;background:#0007;border-radius:12px;padding:15px}.stat small{display:block;color:#71717a;text-transform:uppercase;font-size:10px}.stat strong{font-size:25px}.info{margin-top:14px;font-size:13px;color:#a1a1aa}.channel{color:#67e8f9}@media(max-width:720px){h1{font-size:30px}.top{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="wrap"><div class="eyebrow">BlackRoom · TikTok Automation</div><div class="top"><div><h1>BlackRoom Content Agent</h1><p class="muted">YouTube → edición → Metricool → TikTok</p></div><a class="channel" href="https://www.youtube.com/@blackroom_us" target="_blank">Canal oficial ↗</a></div><section class="card"><div class="top"><div><h2>Control del agente</h2><p class="muted">10 posts diarios, 5 DJs, videos sin repetir, drops y cortes verticales/horizontales.</p></div><span id="badge" class="badge">Cargando…</span></div><div class="controls"><select id="weeks"><option value="1">1 semana · 70 posts</option><option value="2" selected>2 semanas · 140 posts</option><option value="3">3 semanas · 210 posts</option><option value="4">4 semanas · 280 posts</option></select><button id="play" class="play">▶ Iniciar agente</button><button id="pause" class="pause" hidden>Ⅱ Pausar agente</button><button id="refresh">↻ Actualizar</button></div><div class="stats"><div class="stat"><small>En cola</small><strong id="queued">0</strong></div><div class="stat"><small>Procesando</small><strong id="processing">0</strong></div><div class="stat"><small>Reintentos</small><strong id="retry">0</strong></div><div class="stat"><small>Agendados</small><strong id="scheduled">0</strong></div><div class="stat"><small>Completados</small><strong id="completed">0</strong></div></div><div id="experiment" class="info">Experimento 15s/30s/60s</div><div id="next" class="info">Leyendo cola…</div><p class="info">Cada video de YouTube se registra y no puede volver a usarse. El agente compara retención, finalización, compartidos, visitas al perfil y seguidores para aprender qué duración genera mayor crecimiento.</p></section></main><script>
const ids=['queued','processing','retry','scheduled','completed'];let busy=false;async function req(path,opt){const r=await fetch(path,opt),d=await r.json();if(!r.ok)throw new Error(d.error||'Error');return d.agent}function render(s){badge.textContent=s.enabled?'Trabajando':'Pausado';badge.className='badge'+(s.enabled?' on':'');play.hidden=s.enabled;pause.hidden=!s.enabled;weeks.disabled=s.enabled;ids.forEach(id=>document.getElementById(id).textContent=s.totals[id]||0);experiment.textContent='15s: '+s.durationSamples[15]+' · 30s: '+s.durationSamples[30]+' · 60s: '+s.durationSamples[60]+' · '+s.usedSourceVideos+' videos únicos';next.textContent=s.nextJob?'Próximo lote: '+s.nextJob.targetDate+' · '+s.nextJob.status:'Pulsa Iniciar agente para comenzar.'}async function run(path,opt){if(busy)return;busy=true;try{render(await req(path,opt))}catch(e){next.textContent=e.message}finally{busy=false}}play.onclick=()=>run('/api/blackroom-agent/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weeks:Number(weeks.value)})});pause.onclick=()=>run('/api/blackroom-agent/pause',{method:'POST'});refresh.onclick=()=>run('/api/blackroom-agent');run('/api/blackroom-agent');setInterval(()=>run('/api/blackroom-agent'),15000);
</script></body></html>`;

export function registerBlackRoomControlRoutes(app: Express): void {
  app.get("/blackroom", (_req, res) => res.type("html").set("Cache-Control", "no-store").send(blackRoomPage));
  app.get("/api/blackroom-agent", async (_req, res) => {
    try { res.json({ agent: summarizeBlackRoomQueue(await readBlackRoomQueue()) }); }
    catch (error: any) { res.status(500).json({ error: error.message || "Failed to read BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/start", async (req, res) => {
    try {
      const state = await readBlackRoomQueue();
      startBlackRoomAgent(state, Number(req.body?.weeks || 2));
      await writeBlackRoomQueue(state);
      res.json({ agent: summarizeBlackRoomQueue(state) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to start BlackRoom agent" }); }
  });
  app.post("/api/blackroom-agent/pause", async (_req, res) => {
    try {
      const state = await readBlackRoomQueue();
      pauseBlackRoomAgent(state);
      await writeBlackRoomQueue(state);
      res.json({ agent: summarizeBlackRoomQueue(state) });
    } catch (error: any) { res.status(500).json({ error: error.message || "Failed to pause BlackRoom agent" }); }
  });
}
