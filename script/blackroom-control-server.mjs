import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectDir = process.cwd();
const port = Number(process.env.BLACKROOM_CONTROL_PORT || 5020);

async function agentCommand(command, weeks) {
  const args = ["run", "blackroom:agent", "--", `--${command}`];
  if (weeks) args.push("--weeks", String(weeks));
  const { stdout } = await execFileAsync("npm", args, { cwd: projectDir, maxBuffer: 2_000_000 });
  const jsonStart = stdout.indexOf('{\n  "mode": "blackroom_daily_agent"');
  if (jsonStart < 0) throw new Error("El agente no devolvió un estado válido");
  return JSON.parse(stdout.slice(jsonStart));
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const page = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BlackRoom Content Agent</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#050505;color:#fff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#102a32 0,#07070a 38%,#000 100%);min-height:100vh}.wrap{max-width:1050px;margin:auto;padding:42px 20px}.eyebrow{color:#67e8f9;font-size:12px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:40px;margin:10px 0 8px}.sub{color:#a1a1aa;margin:0 0 28px}.card{border:1px solid #ffffff1c;border-radius:18px;background:#09090be8;padding:24px;box-shadow:0 24px 70px #0008}.top,.controls{display:flex;gap:16px;align-items:center;justify-content:space-between}.badge{border:1px solid #fbbf2444;background:#fbbf2414;color:#fde68a;border-radius:999px;padding:7px 12px;font-size:13px}.badge.on{border-color:#6ee7b744;background:#10b98118;color:#a7f3d0}.desc{color:#a1a1aa;line-height:1.65;max-width:760px}.controls{justify-content:flex-start;margin-top:22px;flex-wrap:wrap}label{font-size:13px;color:#a1a1aa}select,button{height:44px;border-radius:10px;border:1px solid #ffffff24;background:#18181b;color:#fff;padding:0 15px;font-size:14px}button{cursor:pointer;font-weight:700}button.play{background:#a7f3d0;color:#052e24;border:0}button.pause{border-color:#fbbf2455;color:#fde68a}button:disabled{opacity:.45;cursor:not-allowed}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}.stat{border:1px solid #ffffff14;background:#0007;border-radius:12px;padding:15px}.stat small{display:block;color:#71717a;text-transform:uppercase;font-size:10px;letter-spacing:.08em}.stat strong{display:block;font-size:25px;margin-top:7px}.next{margin-top:14px;border:1px solid #ffffff14;border-radius:12px;padding:14px;color:#a1a1aa;font-size:13px}.note{color:#71717a;font-size:12px;line-height:1.6;margin-top:20px}.error{color:#fecaca;border-color:#ef444455;background:#7f1d1d33}.channel{color:#67e8f9;text-decoration:none}@media(max-width:720px){h1{font-size:30px}.top{align-items:flex-start;flex-direction:column}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head><body><main class="wrap"><div class="eyebrow">BlackRoom · TikTok Automation</div><div class="top"><div><h1>BlackRoom Content Agent</h1><p class="sub">YouTube → edición automática → Metricool → TikTok</p></div><a class="channel" href="https://www.youtube.com/@blackroom_us" target="_blank">Canal oficial ↗</a></div>
<section class="card"><div class="top"><div><h2>Control del agente</h2><p class="desc">Prepara 10 posts diarios de 5 DJs, con videos aleatorios, drops, inglés/español y cortes verticales y horizontales diferentes.</p></div><span id="badge" class="badge">Cargando…</span></div>
<div class="controls"><div><label for="weeks">Semanas por preparar</label><br><select id="weeks"><option value="1">1 semana · 70 posts</option><option value="2" selected>2 semanas · 140 posts</option><option value="3">3 semanas · 210 posts</option><option value="4">4 semanas · 280 posts</option></select></div><button id="play" class="play">▶ Iniciar agente</button><button id="pause" class="pause" hidden>Ⅱ Pausar agente</button><button id="refresh">↻ Actualizar</button></div>
<div class="stats"><div class="stat"><small>En cola</small><strong id="queued">0</strong></div><div class="stat"><small>Procesando</small><strong id="processing">0</strong></div><div class="stat"><small>Reintentos</small><strong id="retry">0</strong></div><div class="stat"><small>Agendados</small><strong id="scheduled">0</strong></div><div class="stat"><small>Completados</small><strong id="completed">0</strong></div></div><div id="next" class="next">Leyendo la cola…</div><p class="note">La Mac debe estar encendida y sin suspensión para descargar, editar y cargar. Al pausar se conserva todo el trabajo. Los archivos se borran únicamente después de confirmar la programación en Metricool.</p></section></main>
<script>
const ids=['queued','processing','retry','scheduled','completed'];let busy=false;
async function request(path,options){const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw new Error(data.error||'Error del agente');return data.summary}
function render(s){document.getElementById('badge').textContent=s.enabled?'Trabajando':'Pausado';document.getElementById('badge').className='badge'+(s.enabled?' on':'');document.getElementById('play').hidden=s.enabled;document.getElementById('pause').hidden=!s.enabled;document.getElementById('weeks').disabled=s.enabled;ids.forEach(id=>document.getElementById(id).textContent=s.totals[id]||0);document.getElementById('next').textContent=s.nextJob?'Próximo lote: '+s.nextJob.targetDate+' · '+s.nextJob.status+' · 10 videos cada 90 minutos':'La cola comenzará cuando pulses Iniciar agente.'}
async function run(path,options){if(busy)return;busy=true;try{render(await request(path,options))}catch(error){const next=document.getElementById('next');next.textContent=error.message;next.classList.add('error')}finally{busy=false}}
document.getElementById('play').onclick=()=>run('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weeks:Number(document.getElementById('weeks').value)})});document.getElementById('pause').onclick=()=>run('/api/pause',{method:'POST'});document.getElementById('refresh').onclick=()=>run('/api/status');run('/api/status');setInterval(()=>run('/api/status'),15000);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && ["/", "/blackroom"].includes(url.pathname)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, await agentCommand("status"));
    if (req.method === "POST" && url.pathname === "/api/pause") return json(res, 200, await agentCommand("pause"));
    if (req.method === "POST" && url.pathname === "/api/start") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const weeks = Math.max(1, Math.min(4, Number(JSON.parse(body || "{}").weeks || 2)));
      return json(res, 200, await agentCommand("start", weeks));
    }
    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`[blackroom-control] http://127.0.0.1:${port}/blackroom`));
