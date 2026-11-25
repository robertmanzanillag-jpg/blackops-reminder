import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
// Mirrors server/office-roster-status.ts (GET /api/agents-office/roster-status).
type RosterState = "trabajando" | "en_espera" | "bloqueado" | "sin_datos";
type RosterView = { observedAt: string; counts: Record<RosterState, number>; agents: Array<{ id: string; name: string; group: string; job: string; state: RosterState; lastActivityAt: string | null; doing?: string; reason?: string }> };

// Every agent of the company with a status read from persisted records (no AI calls).
const BADGE: Record<RosterState, { text: string; className: string }> = {
  trabajando: { text: "Trabajando", className: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40" },
  en_espera: { text: "En espera", className: "bg-sky-500/15 text-sky-200 border-sky-400/30" },
  bloqueado: { text: "Bloqueado", className: "bg-red-500/20 text-red-200 border-red-400/40" },
  sin_datos: { text: "Sin datos", className: "bg-slate-500/20 text-slate-300 border-slate-400/30" },
};
const ORDER: RosterState[] = ["trabajando", "bloqueado", "en_espera", "sin_datos"];

function ago(value: string | null, now: number) {
  if (!value) return "sin registro";
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}

export function OfficeRosterPanel() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<RosterState | "todos">("todos");
  const query = useQuery<RosterView>({
    queryKey: ["office-roster-status"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/agents-office/roster-status", { credentials: "include", signal });
      if (!response.ok) throw new Error("roster unavailable");
      return response.json();
    },
    enabled: open, retry: false, staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });
  const data = query.data;
  const now = data ? Date.parse(data.observedAt) : Date.now();
  const groups = useMemo(() => {
    const agents = (data?.agents ?? []).filter(agent => filter === "todos" || agent.state === filter)
      .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
    const map = new Map<string, typeof agents>();
    for (const agent of agents) map.set(agent.group, [...(map.get(agent.group) ?? []), agent]);
    return [...map.entries()];
  }, [data, filter]);

  return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Trigger asChild>
      <Button className="absolute bottom-28 left-3 z-[110] border border-sky-200/30 bg-slate-950 text-white hover:bg-slate-800" data-testid="open-office-roster">Todos los agentes</Button>
    </DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/60" />
      <DialogPrimitive.Content className="fixed inset-x-0 bottom-0 top-10 z-[201] flex flex-col overflow-hidden rounded-t-xl border border-slate-700 bg-slate-950 text-slate-100 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-4 sm:w-[30rem] sm:rounded-xl" data-testid="office-roster-panel">
        <div className="flex items-center justify-between border-b border-slate-800 p-3">
          <DialogPrimitive.Title className="text-base font-semibold">Empresa · todos los agentes</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800">Cerrar</DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="px-3 pt-2 text-xs text-slate-400">Estado leído de trabajos y observaciones guardadas. Se actualiza cada 30 s.</DialogPrimitive.Description>
        <div className="flex flex-wrap gap-1.5 p-3">
          {(["todos", ...ORDER] as const).map(key => <button key={key} type="button" onClick={() => setFilter(key)}
            className={`rounded-full border px-2.5 py-1 text-xs ${filter === key ? "border-white/60 bg-white/10" : "border-slate-700"}`}>
            {key === "todos" ? `Todos (${data?.agents.length ?? 0})` : `${BADGE[key].text} (${data?.counts[key] ?? 0})`}
          </button>)}
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {query.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
          {query.isError && <p className="text-sm text-red-300">No se pudo leer el estado de los agentes.</p>}
          {groups.map(([group, agents]) => <section key={group} className="mb-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</h3>
            <ul className="space-y-1.5">
              {agents.map(agent => <li key={agent.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2" data-testid={`roster-agent-${agent.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{agent.name}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${BADGE[agent.state].className}`}>{BADGE[agent.state].text}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">Última actividad: {ago(agent.lastActivityAt, now)}</p>
                {agent.doing && <p className="mt-0.5 text-xs text-emerald-200">Ahora: {agent.doing}</p>}
                {agent.reason && <p className="mt-0.5 text-xs text-red-200">Motivo: {agent.reason}</p>}
              </li>)}
            </ul>
          </section>)}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
