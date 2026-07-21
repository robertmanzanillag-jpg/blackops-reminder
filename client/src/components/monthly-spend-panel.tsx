import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, DollarSign, Gauge, ReceiptText, WalletCards } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type SpendSource = {
  id: string;
  label: string;
  amountUsd: number;
  count: number;
  kind: string;
};

type MonthlySpendReport = {
  month: string;
  currency: "USD";
  budgetUsd: number;
  operatingTargetUsd: number;
  trackedSpendUsd: number;
  projectedMonthUsd: number;
  remainingBudgetUsd: number;
  budgetUsedPct: number;
  projectedBudgetPct: number;
  status: "healthy" | "watch" | "over_budget";
  sources: SpendSource[];
  history: SpendHistoryItem[];
  notes: string[];
};

type SpendHistoryItem = {
  id: string;
  date: string;
  label: string;
  detail: string;
  amountUsd: number;
  sourceId: string;
  sourceLabel: string;
  kind: string;
  status: string;
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function statusCopy(status?: MonthlySpendReport["status"]): { label: string; className: string } {
  if (status === "over_budget") {
    return { label: "Pasado", className: "border-red-400/30 bg-red-500/10 text-red-200" };
  }
  if (status === "watch") {
    return { label: "Cuidar", className: "border-amber-400/30 bg-amber-500/10 text-amber-200" };
  }
  return { label: "Saludable", className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" };
}

function formatSpendDate(value?: string): string {
  if (!value) return "Este mes";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Este mes";
  return new Intl.DateTimeFormat("es-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function MonthlySpendPanel() {
  const { data, isLoading, isError } = useQuery<MonthlySpendReport>({
    queryKey: ["/api/ai-spend/monthly"],
    refetchInterval: 60000,
  });

  const status = statusCopy(data?.status);
  const progress = Math.min(100, Math.max(0, data?.budgetUsedPct || 0));
  const projectedProgress = Math.min(100, Math.max(0, data?.projectedBudgetPct || 0));
  const visibleSources = (data?.sources || []).filter((source) => source.amountUsd > 0 || source.count > 0);
  const visibleHistory = (data?.history || []).slice(0, 8);

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4" data-testid="monthly-spend-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900">
            <WalletCards className="h-5 w-5 text-zinc-300" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Gasto mensual</h2>
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", status.className)}>
                {status.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              AI, automatizaciones y herramientas fijas trackeadas para este mes.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Llevamos</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {isLoading ? "--" : money(data?.trackedSpendUsd || 0)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Budget</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {isLoading ? "--" : money(data?.budgetUsd || 500)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Proyeccion</p>
            <p className="mt-1 text-2xl font-semibold text-white">
              {isLoading ? "--" : money(data?.projectedMonthUsd || 0)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Queda</p>
            <p className={cn("mt-1 text-2xl font-semibold", (data?.remainingBudgetUsd || 0) < 0 ? "text-red-200" : "text-white")}>
              {isLoading ? "--" : money(data?.remainingBudgetUsd || 0)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Usado del budget</span>
            <span>{data?.budgetUsedPct || 0}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-zinc-900" />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Ritmo proyectado</span>
            <span>{data?.projectedBudgetPct || 0}%</span>
          </div>
          <Progress value={projectedProgress} className="h-1.5 bg-zinc-900" />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-300">
            <Gauge className="h-3.5 w-3.5" />
            Fuentes
          </div>
          {isError ? (
            <p className="flex items-center gap-2 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              No se pudo cargar el tracker.
            </p>
          ) : visibleSources.length > 0 ? (
            <div className="space-y-1.5">
              {visibleSources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-zinc-500">{source.label}</span>
                  <span className="shrink-0 text-zinc-200">{money(source.amountUsd)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <DollarSign className="h-3.5 w-3.5" />
              Sin gasto registrado este mes.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-300">
            <ReceiptText className="h-3.5 w-3.5 shrink-0" />
            <span>Historial de gasto</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-600">
            <CalendarClock className="h-3 w-3" />
            <span>{data?.month || "Este mes"}</span>
          </div>
        </div>

        {isError ? (
          <p className="flex items-center gap-2 text-xs text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            No se pudo cargar el historial.
          </p>
        ) : visibleHistory.length > 0 ? (
          <div className="divide-y divide-white/5">
            {visibleHistory.map((entry) => (
              <div key={entry.id} className="grid gap-2 py-2.5 sm:grid-cols-[94px_1fr_auto] sm:items-center">
                <span className="text-[11px] text-zinc-600">{formatSpendDate(entry.date)}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-medium text-zinc-200">{entry.label}</span>
                    <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {entry.sourceLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-600">{entry.detail}</p>
                </div>
                <span className="text-xs font-semibold text-zinc-100 sm:text-right">{money(entry.amountUsd)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <DollarSign className="h-3.5 w-3.5" />
            Todavia no hay movimientos con costo este mes.
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-zinc-600">
        Estimado local: para hacerlo exacto, agrega el usage real de OpenAI/Gemini en las variables de tracking mensual.
      </p>
    </section>
  );
}
