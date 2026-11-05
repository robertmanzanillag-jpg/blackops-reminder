import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { selectLatestOfficeKongAudit } from "@/lib/office-city-agents";
import { scoreOfficeKongSnapshot } from "@shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "../../../server/office-kong";

type Probe = { status: "ready" | "blocked"; reason: string; checkedAt: string; agents?: Array<{ id: string; name: string; state: string; lastRunAt: string | null; blocker?: string | null }> };
type Run = { id: string; key: string; kind: string; status: string; source?: "scheduled"; text?: string; createdAt: string; completedAt?: string; sessionId?: string; evidence?: OfficeKongAuditResult["evidence"]; error?: { reason: string }; review?: { verdict: string; headSha: string } };
const statuses: Record<string, string> = { accepted: "Registrada", pending: "Registrada", running: "En ejecucion", completed: "Completada", blocked: "Bloqueada", failed: "Fallo", unknown: "Resultado sin confirmar" };
const agentStates: Record<string, string> = { healthy: "Evidencia vigente", running: "En ejecucion", attention: "Necesita atencion", stale: "Evidencia antigua", unknown: "Sin evidencia", disabled: "Deshabilitado" };
const categoryNames: Record<string, string> = { clubs: "Clubs", vip: "VIP", restaurants: "Restaurantes", events: "Eventos", sports: "Deportes", experiences: "Experiencias", media: "Imagenes" };

export function OfficeConnectionsPanel() {
  const [open, setOpen] = useState(false);
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
  const isActive = (run: Run) => ["accepted", "pending", "running"].includes(run.status);
  const busy = mutation.isPending || runs.data?.some(run => run.source !== "scheduled" && isActive(run));
  const auditBusy = runs.data?.some(run => run.kind === "kong_audit" && isActive(run));
  const fresh = (probe?: Probe) => !connections.isError && Boolean(probe && Date.now() - Date.parse(probe.checkedAt) >= -30_000 && Date.now() - Date.parse(probe.checkedAt) < 90_000);
  const workerReady = fresh(connections.data?.worker) && connections.data?.worker.status === "ready";
  const enabled = workerReady && fresh(connections.data?.claude) && connections.data?.claude.status === "ready";
  const latestAudit = selectLatestOfficeKongAudit(runs.data);
  const kongEvidence = latestAudit?.status === "completed" ? latestAudit.evidence : undefined;
  const supervision = scoreOfficeKongSnapshot(runs.isError ? undefined : kongEvidence);
  const kongAgents = kongEvidence?.agents || connections.data?.kong.agents;
  const kongEvidenceFresh = kongEvidence
    ? !runs.isError && Date.now() - Date.parse(kongEvidence.generatedAt) >= -30_000 && Date.now() - Date.parse(kongEvidence.generatedAt) < 300_000
    : fresh(connections.data?.kong);
  return (
    <aside className={`absolute right-3 top-16 z-[110] rounded-xl border border-cyan-200/25 bg-[#080d18]/95 px-2.5 py-1 text-white shadow-xl backdrop-blur ${open ? "w-[min(340px,calc(100vw-1.5rem))]" : "w-fit"}`} aria-label="Conexiones reales de la oficina">
      <div className="flex items-center justify-between gap-3">
        {open && <h2 className="text-sm font-semibold">Trabajo real de agentes</h2>}
        <Button aria-expanded={open} size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { if (!open) { void connections.refetch(); void runs.refetch(); } setOpen(!open); }}>{open ? "Minimizar" : "Trabajo real"}</Button>
      </div>
      {open && <div className="mt-2 max-h-[34dvh] space-y-3 overflow-y-auto overscroll-contain pb-2 pr-1">
        {connections.isError && <p role="alert" className="text-sm text-amber-200">No se pudieron comprobar las conexiones. No se considera conectado ningun agente.</p>}
        {!connections.data && !connections.isError && <p className="text-sm text-slate-300">Comprobando conexiones…</p>}
        {connections.data && (["worker", "claude", "kong"] as const).map(name => <div key={name} className="rounded-xl border border-white/10 p-3">
          <p className="text-sm font-semibold">{name === "claude" ? "Claude" : name === "kong" ? "KONG" : "Ejecutor"} · {fresh(connections.data[name]) && connections.data[name].status === "ready" ? (name === "claude" ? "Inicio de sesion configurado" : name === "worker" ? "Ejecutor responde" : "Acceso verificado") : "Pendiente de conexion"}</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{connections.data[name].reason}</p>
          <p className="text-[10px] text-slate-500">Comprobado: {new Date(connections.data[name].checkedAt).toLocaleString()}</p>
        </div>)}
        {kongAgents?.map(agent => <div key={agent.id} className="rounded-lg border border-white/10 p-2 text-xs">
          <p className="font-semibold">{agent.name} · {kongEvidenceFresh ? (agentStates[agent.state] || agent.state) : "Evidencia caducada"}</p>
          <p className="mt-1 text-slate-400">Ultima ejecucion: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : "Sin evidencia"}</p>
          {agent.blocker && <p className="mt-1 text-amber-200">{agent.blocker}</p>}
        </div>)}
        <details className="rounded-lg border border-cyan-200/20 p-2 text-xs" data-testid="office-kong-supervisor">
          <summary className="cursor-pointer font-semibold">Supervisor de KONG</summary>
          <p className="mt-2 text-slate-300">Revisa las siete categorías por ciudad. Los puntos se calculan sobre la última auditoría: descuenta fallos, atrasos y trabajos vencidos. Esperar el próximo turno no resta puntos.</p>
          {!supervision.verified && <p className="mt-2 text-amber-200">Sin auditoría vigente. Aún no se pueden asignar puntos.</p>}
          {supervision.verified && <div className="mt-2 space-y-1">
            <p className="text-slate-400">Última revisión: {supervision.snapshotAt ? new Date(supervision.snapshotAt).toLocaleString() : "Sin registro"}</p>
            {supervision.countries.map(country => <p key={country.countryCode}><strong>{country.countryCode}</strong> · {country.points === null ? "Sin puntuación" : `${country.points}/100`} · {country.scoredCategories}/{country.totalCategories} verificados</p>)}
          </div>}
        </details>
        {kongEvidence?.cities && <section aria-label="Agentes de KONG por ciudad" className="space-y-2">
          <h3 className="text-sm font-semibold">{kongEvidence.cities.length} ciudades · {kongEvidence.cities.reduce((count, city) => count + city.categories.length, 0)} agentes por categoria</h3>
          {kongEvidence.cityCoverageComplete === false && <p className="text-xs text-amber-200">Faltan trabajos registrados. Las categorias sin registro no se consideran funcionando.</p>}
          {kongEvidence.cities.map(city => { const score = supervision.cities.find(row => row.id === city.id); return <details key={city.id} className="rounded-xl border border-white/10 p-2 text-xs">
            <summary className="cursor-pointer font-semibold">{city.name} · {city.currency}{score?.points != null ? ` · ${score.points}/100` : ""}</summary>
            <div className="mt-2 space-y-2">{city.categories.map(category => { const grade = score?.categories.find(row => row.category === category.category); return <div key={category.category} className="border-t border-white/10 pt-2">
              <p>{categoryNames[category.category] || category.category} · {!kongEvidenceFresh ? "Evidencia caducada" : category.state === "running" && grade?.state !== "running" ? "Ejecución sin confirmar" : (agentStates[category.state] || category.state)}</p>
              <p className="mt-1 text-slate-400">Ultima ejecucion: {category.lastRunAt ? new Date(category.lastRunAt).toLocaleString() : "Sin evidencia"}</p>
              <p className="text-slate-400">Proxima: {category.nextRunAt ? new Date(category.nextRunAt).toLocaleString() : "Sin programacion comprobada"}</p>
              {grade && <p className="text-slate-400">Supervisor: {grade.points === null ? "Sin puntuación" : `${grade.points}/100${grade.deduction ? ` (−${grade.deduction})` : ""}`} · {grade.reason}</p>}
              {category.issues.map((issue, index) => <p key={index} className="mt-1 text-amber-200">{issue}</p>)}
            </div>; })}</div>
          </details>; })}
        </section>}
        <div className="space-y-2">
          <label htmlFor="office-live-message" className="text-sm">Hablar con Claude</label>
          <textarea id="office-live-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={16000} className="min-h-20 w-full rounded-lg border border-white/15 bg-black/50 p-2 text-sm" placeholder="Escribe una tarea de analisis o una pregunta" />
          <p className="text-xs text-slate-400">Cada respuesta necesita una sesion real registrada de Claude. Este flujo analiza texto; no modifica archivos ni envia mensajes.</p>
          <Button disabled={!enabled || busy || !message.trim()} onClick={() => mutation.mutate({ kind: "claude_chat", message: message.trim() })}>Enviar a Claude</Button>
        </div>
        <div className="space-y-2">
          <label htmlFor="office-live-pr" className="text-sm">Revision de cambios por Claude</label>
          <input id="office-live-pr" value={prUrl} onChange={e => setPrUrl(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/50 p-2 text-sm" placeholder="https://github.com/propietario/repo/pull/123" />
          <Button disabled={!enabled || busy || !prUrl.trim()} onClick={() => mutation.mutate({ kind: "claude_review", prUrl: prUrl.trim() })}>Revisar PR</Button>
        </div>
        <div className="space-y-2">
          <Button disabled={busy || auditBusy || !workerReady || !fresh(connections.data?.kong) || connections.data?.kong.status !== "ready"} onClick={() => mutation.mutate({ kind: "kong_audit" })}>Consultar agentes de KONG</Button>
          <p className="text-xs leading-5 text-slate-400">Lee su actividad registrada, bloqueos y ultimos resultados. Esta consulta no inicia lectores de WhatsApp ni cambia eventos o precios.</p>
        </div>
        {mutation.isError && <p role="alert" className="text-sm text-amber-200">No se confirmo el registro de la tarea. Revisa el historial; volver a enviar la misma solicitud conserva su identificador.</p>}
        {runs.isError && <p role="alert" className="text-sm text-amber-200">No se pudo leer el historial de ejecuciones.</p>}
        <section aria-label="Resultados de agentes" className="space-y-3">
          <h3 className="text-sm font-semibold">Ejecuciones comprobables</h3>
          {Array.isArray(runs.data) && runs.data.slice(0, 15).map(run => <article key={run.id} className="rounded-xl border border-white/10 p-3 text-xs">
            <p className="font-semibold">{run.source === "scheduled" ? "Supervisor KONG" : run.kind === "kong_audit" ? "KONG" : "Claude"} · {statuses[run.status] || run.status}</p>
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
