import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import type { AgentJournalView, JournalDay, JournalTrend } from "@shared/agent-journal";

// Bitácora diaria (GET /api/agents-office/journal): real job records only, no AI calls.
const TREND: Record<JournalTrend, { text: string; className: string }> = {
  mejor: { text: "Mejoró", className: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40" },
  peor: { text: "Empeoró", className: "bg-red-500/20 text-red-200 border-red-400/40" },
  igual: { text: "Igual", className: "bg-sky-500/15 text-sky-200 border-sky-400/30" },
  sin_datos: { text: "Sin datos", className: "bg-slate-500/20 text-slate-300 border-slate-400/30" },
};
const usd = (micro: number | null) => (micro == null ? "—" : `$${(micro / 1e6).toFixed(micro < 10_000 ? 4 : 2)}`);
const dayLine = (d: JournalDay) => `${d.done} hechos · ${d.blocked} bloqueados · éxito ${d.successRate == null ? "—" : `${d.successRate}%`}${d.pointsEarned == null ? "" : ` · ${d.pointsEarned >= 0 ? "+" : ""}${d.pointsEarned} pts`}${d.spentMicroUsd == null ? "" : ` · gasto ${usd(d.spentMicroUsd)} · ${usd(d.costPerSuccessMicroUsd)}/éxito`}`;

export function OfficeJournalPanel() {
  const [open, setOpen] = useState(false);
  const query = useQuery<AgentJournalView>({
    queryKey: ["office-journal"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/agents-office/journal", { credentials: "include", signal });
      if (!response.ok) throw new Error("journal unavailable");
      return response.json();
    },
    enabled: open, retry: false, staleTime: 0, refetchInterval: open ? 60_000 : false,
  });
  const data = query.data;
  return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
    <DialogPrimitive.Trigger asChild>
      <Button className="absolute bottom-40 left-3 z-[110] border border-amber-200/30 bg-slate-950 text-white hover:bg-slate-800" data-testid="open-office-journal">Notas</Button>
    </DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[200] bg-black/60" />
      <DialogPrimitive.Content className="fixed inset-x-0 bottom-0 top-10 z-[201] flex flex-col overflow-hidden rounded-t-xl border border-slate-700 bg-slate-950 text-slate-100 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-4 sm:w-[34rem] sm:rounded-xl" data-testid="office-journal-panel">
        <div className="flex items-center justify-between border-b border-slate-800 p-3">
          <DialogPrimitive.Title className="text-base font-semibold">Notas · bitácora diaria</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800">Cerrar</DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="px-3 pt-2 text-xs text-slate-400">Solo trabajos registrados (UTC). Hoy {data?.today ?? "…"} vs ayer {data?.yesterday ?? "…"}. Sin registro = sin datos, nunca inventado.</DialogPrimitive.Description>
        <div className="space-y-1 p-3" data-testid="journal-summary">
          {data?.companies.map(c => <p key={c.company} className="rounded border border-slate-800 bg-slate-900/60 p-2 text-xs">
            <b>{c.company}</b>: {c.doneToday} hechos hoy (ayer {c.doneYesterday}) · {c.improved} mejoraron · {c.worse} empeoraron{c.spentTodayMicroUsd != null ? ` · gasto hoy ${usd(c.spentTodayMicroUsd)}` : ""}
          </p>)}
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {query.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
          {query.isError && <p className="text-sm text-red-300">No se pudo leer la bitácora.</p>}
          <ul className="space-y-1.5">
            {data?.agents.map(a => <li key={a.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-2" data-testid={`journal-agent-${a.id}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{a.name} <span className="text-[11px] text-slate-500">{a.company}</span></span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${TREND[a.trend].className}`}>{TREND[a.trend].text}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-200">Hoy: {dayLine(a.today)}</p>
              <p className="mt-0.5 text-xs text-slate-400">Ayer: {dayLine(a.yesterday)}</p>
              <p className="mt-0.5 text-xs text-sky-200">{a.points != null ? `${a.points} puntos` : "sin puntos"} · skills aplicadas: {a.skillsApplied}{a.efficiencyTrend ? ` · rendimiento/$ semanal: ${a.efficiencyTrend}` : ""}</p>
              {a.didToday.length ? <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-300">{a.didToday.map(line => <li key={line}>{line}</li>)}</ul>
                : <p className="mt-0.5 text-[11px] text-slate-500">Hoy no hay trabajos registrados.</p>}
            </li>)}
          </ul>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
