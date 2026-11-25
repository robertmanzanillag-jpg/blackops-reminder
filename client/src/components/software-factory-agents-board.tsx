import { useQuery } from "@tanstack/react-query";
import type { FactoryAgentRow, FactoryAgentsView } from "@shared/software-factory-agents";

// Read-only "who is working now" board. Data: GET /api/software-factory/agents (persisted
// jobs, budget, API authority, owner orders, self-heal ledger). Refreshes every 30 s, no AI.

const endpoint = "/api/software-factory/agents";
const money = (cents: number) => new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(cents / 100);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca");
const elapsed = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);
const BADGE: Record<FactoryAgentRow["state"], [string, string]> = {
  trabajando: ["Trabajando", "bg-emerald-400/15 text-emerald-300 border-emerald-400/30"],
  en_espera: ["En espera", "bg-slate-400/10 text-slate-300 border-slate-400/20"],
  bloqueado: ["Bloqueado", "bg-rose-500/15 text-rose-300 border-rose-400/30"],
};
const GROUPS: Array<[FactoryAgentRow["group"], string]> = [["etapa", "Etapas de la fábrica"], ["ingenieria", "Equipo de ingeniería"], ["control", "Controles"]];

function AgentCard({ row }: { row: FactoryAgentRow }) {
  const [label, cls] = BADGE[row.state];
  return <li className="rounded-lg border border-white/10 p-3 text-sm" data-testid={`factory-agent-${row.id}`} data-state={row.state}>
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium">{row.label}</span>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${cls}`}>{row.state === "trabajando" && <span aria-hidden className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}{label}</span>
    </div>
    {row.current && <p className="mt-1 text-xs">{row.current.stage}{row.current.orderLabel ? ` · ${row.current.orderLabel}` : ""} · hace {elapsed(row.current.elapsedMinutes)}</p>}
    {row.blocked && <p className="mt-1 text-xs text-rose-200">{row.blocked.reason} <span className="text-muted-foreground">({when(row.blocked.at)})</span></p>}
    {row.state !== "trabajando" && <p className="mt-1 text-xs text-muted-foreground">Último completado: {when(row.lastCompletedAt)}{row.queued ? ` · ${row.queued} en cola` : ""}</p>}
    {row.detail && <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>}
  </li>;
}

export function SoftwareFactoryAgentsBoard() {
  const query = useQuery<FactoryAgentsView>({ queryKey: [endpoint], refetchInterval: 30_000, refetchOnWindowFocus: true, retry: false, staleTime: 0 });
  if (query.isPending) return <p role="status" className="text-sm">Cargando agentes de la fábrica…</p>;
  if (query.isError || !query.data) return <p role="alert" className="text-sm">No se pudo leer el estado de los agentes. No se confirma actividad.</p>;
  const d = query.data;
  const working = d.agents.filter(a => a.state === "trabajando").length;
  return <section aria-labelledby="factory-agents" className="space-y-3" data-testid="factory-agents-board">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="factory-agents" className="font-semibold">Agentes de la fábrica · {working} trabajando</h3>
      <span className="text-xs text-muted-foreground">Actualizado {when(d.checkedAt)} · cada 30 s</span>
    </div>
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
      <div className="rounded border border-white/10 p-2"><dt className="text-muted-foreground">Fábrica</dt><dd className="font-medium">{d.paused ? "Pausada" : "Activa"}</dd></div>
      <div className="rounded border border-white/10 p-2"><dt className="text-muted-foreground">API</dt><dd className="font-medium">{d.api.text}</dd></div>
      <div className="rounded border border-white/10 p-2"><dt className="text-muted-foreground">Presupuesto {d.budget.month}</dt><dd className="font-medium">{d.budget.configured ? `${money(d.budget.usedCents)} usado · ${money(d.budget.remainingCents)} libre` : "Sin registrar"}</dd></div>
      <div className="rounded border border-white/10 p-2"><dt className="text-muted-foreground">Admisiones hoy</dt><dd className="font-medium">{d.admissions.today} / {d.admissions.cap ?? "límite sin confirmar"}</dd></div>
      <div className="col-span-2 rounded border border-white/10 p-2"><dt className="text-muted-foreground">Órdenes abiertas{d.openOrders.readable ? ` (${d.openOrders.total})` : ""}</dt>
        <dd>{!d.openOrders.readable ? "No se pudieron leer." : d.openOrders.reasons.length ? d.openOrders.reasons.map(r => `${r.label}: ${r.count}`).join(" · ") : "Ninguna."}</dd></div>
    </dl>
    {!d.jobsListComplete && <p className="text-xs text-muted-foreground">Se muestran los 100 trabajos más recientes.</p>}
    {GROUPS.map(([group, title]) => <div key={group}>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="grid gap-2 sm:grid-cols-2">{d.agents.filter(a => a.group === group).map(row => <AgentCard key={row.id} row={row} />)}</ul>
    </div>)}
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimos PR borrador de la fábrica</h4>
      {d.pullRequests.length ? <ul className="space-y-1 text-sm">{d.pullRequests.map(pr => <li key={pr.url}><a className="underline" href={pr.url} target="_blank" rel="noopener noreferrer">{pr.url.replace("https://github.com/", "")}</a>{pr.orderLabel ? ` · ${pr.orderLabel}` : ""} <span className="text-xs text-muted-foreground">({when(pr.completedAt)})</span></li>)}</ul>
        : <p className="text-sm">Sin PR registrados.</p>}
    </div>
  </section>;
}
