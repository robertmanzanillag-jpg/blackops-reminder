import { RefreshCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateVideoWorkbench } from "@/features/ai-media-studio/create-video-workbench";
import { DashboardOverview } from "@/features/ai-media-studio/dashboard-overview";
import { ErrorPanel, LoadingPanel } from "@/features/ai-media-studio/feedback";
import { useStudioDashboard } from "@/features/ai-media-studio/hooks";
import { JobList } from "@/features/ai-media-studio/job-list";
import { StudioShell } from "@/features/ai-media-studio/studio-shell";
import { cn } from "@/lib/utils";

export default function AiMediaStudioPage() {
  const dashboardQuery = useStudioDashboard();
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
        <Button type="button" variant="outline" className="w-full border-white/10 bg-white/5 text-zinc-200 sm:w-auto" disabled={dashboardQuery.isFetching} onClick={() => dashboardQuery.refetch()}>
          <RefreshCcw className={cn("mr-2 h-4 w-4", dashboardQuery.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          Refresh studio
        </Button>
      </header>

      {providerIssue && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-400/[0.07] p-4 text-sm text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>A media provider needs attention. Existing assets and jobs remain available while Kong monitors recovery.</p>
        </div>
      )}

      {dashboardQuery.isLoading ? (
        <LoadingPanel label="Loading studio overview" />
      ) : dashboardQuery.isError ? (
        <ErrorPanel message={dashboardQuery.error.message} onRetry={() => dashboardQuery.refetch()} />
      ) : dashboardQuery.data ? (
        <DashboardOverview dashboard={dashboardQuery.data} />
      ) : null}

      <section id="create" aria-labelledby="create-heading" className="mt-8 scroll-mt-24">
        <div className="mb-4">
          <h2 id="create-heading" className="text-xl font-semibold text-white">Production desk</h2>
          <p className="mt-1 text-sm text-zinc-400">Launch a provider-neutral 9:16 preview from a reviewed script.</p>
        </div>
        <CreateVideoWorkbench />
      </section>

      <section id="jobs" aria-labelledby="jobs-heading" className="mt-8 scroll-mt-24">
        <h2 id="jobs-heading" className="sr-only">Generation jobs</h2>
        <JobList />
      </section>
    </StudioShell>
  );
}
