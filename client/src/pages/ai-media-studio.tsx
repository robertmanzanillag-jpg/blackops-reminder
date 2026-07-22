import { RefreshCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CoreStudioWorkspace, ProductionBatchWorkbench } from "@/features/ai-media-studio/core";
import { DashboardOverview } from "@/features/ai-media-studio/dashboard-overview";
import { ErrorPanel, LoadingPanel } from "@/features/ai-media-studio/feedback";
import { useStudioDashboard } from "@/features/ai-media-studio/hooks";
import { JobList } from "@/features/ai-media-studio/job-list";
import { OperationsWorkspace } from "@/features/ai-media-studio/operations";
import { StudioShell } from "@/features/ai-media-studio/studio-shell";
import { cn } from "@/lib/utils";

function DashboardFallback({ loading, error, onRetry }: { loading: boolean; error?: string; onRetry: () => void }) {
  return (
    <div className="space-y-5">
      <section id="overview" aria-labelledby="overview-heading" className="scroll-mt-24">
        <h2 id="overview-heading" className="sr-only">Today overview</h2>
        {loading ? <LoadingPanel label="Loading studio overview" /> : <ErrorPanel message={error ?? "Studio overview is unavailable"} onRetry={onRetry} />}
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <section id="providers" aria-labelledby="providers-heading" className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h2 id="providers-heading" className="text-base font-semibold text-zinc-100">Provider health</h2>
          <p className="mt-2 text-sm text-zinc-400">{loading ? "Provider status is loading with the studio overview." : "Provider status is unavailable until the overview request recovers."}</p>
        </section>
        <section id="activity" aria-labelledby="activity-heading" className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <h2 id="activity-heading" className="text-base font-semibold text-zinc-100">Recent activity</h2>
          <p className="mt-2 text-sm text-zinc-400">{loading ? "Recent activity is loading." : "Recent activity is unavailable until the overview request recovers."}</p>
        </section>
      </div>
    </div>
  );
}

export default function AiMediaStudioPage() {
  const dashboardQuery = useStudioDashboard();
  const queryClient = useQueryClient();
  const studioFetchCount = useIsFetching({ queryKey: ["ai-media-studio"] });
  const providerIssue = dashboardQuery.data?.providers.some((provider) => provider.status === "offline" || provider.status === "degraded");

  return (
    <StudioShell>
      <header className="mb-7 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between lg:pr-40">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Autonomous content department
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">AI Media Studio</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">Prepare, preview, and monitor vertical media from one provider-neutral workspace.</p>
        </div>
        <Button type="button" variant="outline" className="w-full border-white/10 bg-white/5 text-zinc-200 sm:w-auto" disabled={studioFetchCount > 0} onClick={() => void queryClient.invalidateQueries({ queryKey: ["ai-media-studio"], refetchType: "active" })}>
          <RefreshCcw className={cn("mr-2 h-4 w-4", studioFetchCount > 0 && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          Refresh all studio data
        </Button>
      </header>

      {providerIssue && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-400/[0.07] p-4 text-sm text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>A media provider needs attention. Existing assets and jobs remain available while Kong monitors recovery.</p>
        </div>
      )}

      {dashboardQuery.data ? (
        <DashboardOverview dashboard={dashboardQuery.data} />
      ) : (
        <DashboardFallback loading={dashboardQuery.isLoading} error={dashboardQuery.error?.message} onRetry={() => void dashboardQuery.refetch()} />
      )}

      <div className="mt-10">
        <CoreStudioWorkspace />
      </div>

      <div className="mt-8">
        <ProductionBatchWorkbench />
      </div>

      <section id="jobs" aria-labelledby="jobs-heading" className="mt-8 scroll-mt-24">
        <h2 id="jobs-heading" className="sr-only">Generation jobs</h2>
        <JobList />
      </section>

      <div className="mt-14">
        <OperationsWorkspace />
      </div>
    </StudioShell>
  );
}
