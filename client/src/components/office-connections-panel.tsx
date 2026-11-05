import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Probe = { status: "ready" | "blocked"; reason: string; checkedAt: string; agents?: Array<{ id: string; name: string; state: string; lastRunAt: string | null; blocker?: string | null }> };
type City = { id: string; name: string; currency: string; status: string; categories: Array<{ category: string; state: string; lastRunAt: string | null; nextRunAt: string | null; issues: string[]; evidence: "persisted" | "missing" }> };
type Run = { id: string; key: string; kind: string; status: string; text?: string; createdAt: string; completedAt?: string; sessionId?: string; evidence?: { generatedAt: string; agents: NonNullable<Probe["agents"]>; cities?: City[]; cityCoverageComplete?: boolean }; error?: { reason: string }; review?: { verdict: string; headSha: string } };
const statuses: Record<string, string> = { accepted: "Registrada", running: "En ejecucion", completed: "Completada", blocked: "Bloqueada", failed: "Fallo", unknown: "Resultado sin confirmar" };
const agentStates: Record<string, string> = { healthy: "Evidencia vigente", running: "En ejecucion", attention: "Necesita atencion", stale: "Evidencia antigua", unknown: "Sin evidencia", disabled: "Deshabilitado" };
const categoryNames: Record<string, string> = { clubs: "Clubs", vip: "VIP", restaurants: "Restaurantes", events: "Eventos", sports: "Deportes", experiences: "Experiencias", media: "Imagenes" };

export function OfficeConnectionsPanel() {
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [prUrl, setPrUrl] = useState("");
  // Retain the same key after an uncertain HTTP outcome; no duplicate dispatch.
  const pending = useRef<{ signature: string; key: string } | undefined>(undefined);
  const connections = useQuery<{ claude: Probe; kong: Probe; worker: Probe }>({ queryKey: ["/api/agents-office/connections"], refetchInterval: open ? 30_000 : false });
  const runs = useQuery<Run[]>({ queryKey: ["/api/agents-office/runs"], refetchInterval: open ? 2_000 : false });
  const mutation = useMutation({
    mutationFn: async (input: { kind: string; message?: string; prUrl?: string }) => {
      const signature = JSON.stringify(input);
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      const response = await apiRequest("POST", "/api/agents-office/runs", { ...input, key: pending.current.key });
      return response.json() as Promise<Run>;
    },
    onSuccess: (run) => {
      pending.current = undefined;
      queryClient.setQueryData<Run[]>(["/api/agents-office/runs"], previous => [run, ...(previous || []).filter(item => item.id !== run.id)]);
      void queryClient.invalidateQueries({ queryKey: ["/api/agents-office/runs"] });
    },
  });
  const busy = mutation.isPending || runs.data?.some(run => run.status === "accepted" || run.status === "running");
  const fresh = (probe?: Probe) => !connections.isError && Boolean(probe && Date.now() - Date.parse(probe.checkedAt) >= -30_000 && Date.now() - Date.parse(probe.checkedAt) < 90_000);
  const workerReady = fresh(connections.data?.worker) && connections.data?.worker.status === "ready";
  const enabled = workerReady && fresh(connections.data?.claude) && connections.data?.claude.status === "ready";
  const kongEvidence = runs.data?.find(run => run.kind === "kong_audit" && run.status === "completed" && run.evidence)?.evidence;
  const kongAgents = kongEvidence?.agents || connections.data?.kong.agents;
  const kongEvidenceFresh = kongEvidence
    ? !runs.isError && Date.now() - Date.parse(kongEvidence.generatedAt) >= -30_000 && Date.now() - Date.parse(kongEvidence.generatedAt) < 300_000
    : fresh(connections.data?.kong);
  return (
    <aside className="absolute right-4 top-24 z-[110] w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-cyan-200/25 bg-[#080d18]/95 p-4 text-white shadow-2xl backdrop-blur" aria-label="Conexiones reales de la oficina">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Trabajo real de agentes</h2>
        <Button size="sm" variant="ghost" onClick={() => { if (!open) { void connections.refetch(); void runs.refetch(); } setOpen(!open); }}>{open ? "Minimizar" : "Abrir"}</Button>
      </div>
      {open && <div className="mt-3 max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto pr-1">
        {connections.isError && <p role="alert" className="text-sm text-amber-200">No se pudieron comprobar las conexiones. No se considera conectado ningun agente.</p>}
        {!connections.data && !connections.isError && <p className="text-sm text-slate-300">Comprobando conexiones…</p>}
        {connections.data && (["worker", "claude", "kong"] as const).map(name => <div key={name} className="rounded-xl border border-white/10 p-3">
          <p className="text-sm font-semibold">{name === "claude" ? "Claude" : name === "kong" ? "KONG" : "Ejecutor"} · {fresh(connections.data[name]) && connections.data[name].status === "ready" ? "Acceso verificado" : "Pendiente de conexion"}</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{connections.data[name].reason}</p>
          <p className="text-[10px] text-slate-500">Comprobado: {new Date(connections.data[name].checkedAt).toLocaleString()}</p>
        </div>)}
        {kongAgents?.map(agent => <div key={agent.id} className="rounded-lg border border-white/10 p-2 text-xs">
          <p className="font-semibold">{agent.name} · {kongEvidenceFresh ? (agentStates[agent.state] || agent.state) : "Evidencia caducada"}</p>
          <p className="mt-1 text-slate-400">Ultima ejecucion: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : "Sin evidencia"}</p>
          {agent.blocker && <p className="mt-1 text-amber-200">{agent.blocker}</p>}
        </div>)}
        {kongEvidence?.cities && <section aria-label="Agentes de KONG por ciudad" className="space-y-2">
          <h3 className="text-sm font-semibold">{kongEvidence.cities.length} ciudades · {kongEvidence.cities.reduce((count, city) => count + city.categories.length, 0)} agentes por categoria</h3>
          {kongEvidence.cityCoverageComplete === false && <p className="text-xs text-amber-200">Faltan trabajos registrados. Las categorias sin registro no se consideran funcionando.</p>}
          {kongEvidence.cities.map(city => <details key={city.id} className="rounded-xl border border-white/10 p-2 text-xs">
            <summary className="cursor-pointer font-semibold">{city.name} · {city.currency}</summary>
            <div className="mt-2 space-y-2">{city.categories.map(category => <div key={category.category} className="border-t border-white/10 pt-2">
              <p>{categoryNames[category.category] || category.category} · {kongEvidenceFresh ? (agentStates[category.state] || category.state) : "Evidencia caducada"}</p>
              <p className="mt-1 text-slate-400">Ultima ejecucion: {category.lastRunAt ? new Date(category.lastRunAt).toLocaleString() : "Sin evidencia"}</p>
              <p className="text-slate-400">Proxima: {category.nextRunAt ? new Date(category.nextRunAt).toLocaleString() : "Sin programacion comprobada"}</p>
              {category.issues.map((issue, index) => <p key={index} className="mt-1 text-amber-200">{issue}</p>)}
            </div>)}</div>
          </details>)}
        </section>}
        <div className="space-y-2">
          <label htmlFor="office-live-message" className="text-sm">Hablar con Claude</label>
          <textarea id="office-live-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={16000} className="min-h-20 w-full rounded-lg border border-white/15 bg-black/50 p-2 text-sm" placeholder="Escribe una tarea de analisis o una pregunta" />
          <p className="text-xs text-slate-400">Claude responde de verdad con tu suscripcion. En este flujo analiza texto; no modifica archivos ni envia mensajes.</p>
          <Button disabled={!enabled || busy || !message.trim()} onClick={() => mutation.mutate({ kind: "claude_chat", message: message.trim() })}>Enviar a Claude</Button>
        </div>
        <div className="space-y-2">
          <label htmlFor="office-live-pr" className="text-sm">Revision de cambios por Claude</label>
          <input id="office-live-pr" value={prUrl} onChange={e => setPrUrl(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/50 p-2 text-sm" placeholder="https://github.com/propietario/repo/pull/123" />
          <Button disabled={!enabled || busy || !prUrl.trim()} onClick={() => mutation.mutate({ kind: "claude_review", prUrl: prUrl.trim() })}>Revisar PR</Button>
        </div>
        <div className="space-y-2">
          <Button disabled={busy || !workerReady || !fresh(connections.data?.kong) || connections.data?.kong.status !== "ready"} onClick={() => mutation.mutate({ kind: "kong_audit" })}>Consultar agentes de KONG</Button>
          <p className="text-xs leading-5 text-slate-400">Lee su actividad registrada, bloqueos y ultimos resultados. Esta consulta no inicia lectores de WhatsApp ni cambia eventos o precios.</p>
        </div>
        {mutation.isError && <p role="alert" className="text-sm text-amber-200">No se confirmo el registro de la tarea. Revisa el historial; volver a enviar la misma solicitud conserva su identificador.</p>}
        {runs.isError && <p role="alert" className="text-sm text-amber-200">No se pudo leer el historial de ejecuciones.</p>}
        <section aria-label="Resultados de agentes" className="space-y-3">
          <h3 className="text-sm font-semibold">Ejecuciones comprobables</h3>
          {Array.isArray(runs.data) && runs.data.slice(0, 15).map(run => <article key={run.id} className="rounded-xl border border-white/10 p-3 text-xs">
            <p className="font-semibold">{run.kind === "kong_audit" ? "KONG" : "Claude"} · {statuses[run.status] || run.status}</p>
            <p className="mt-1 text-slate-500">{new Date(run.createdAt).toLocaleString()} · {run.id.slice(0, 8)}</p>
            {run.error && <p className="mt-2 text-amber-200">{run.error.reason}</p>}
            {run.text && <p className="mt-2 whitespace-pre-wrap break-words leading-5 text-slate-200">{run.text}</p>}
            {run.review && <p className="mt-2">Revision: {run.review.verdict} · {run.review.headSha.slice(0, 12)}</p>}
            {run.completedAt && <p className="mt-2 text-slate-500">Finalizo: {new Date(run.completedAt).toLocaleString()}</p>}
          </article>)}
        </section>
      </div>}
    </aside>
  );
}
