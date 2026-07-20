import { ExternalLink, Loader2, RefreshCcw, RotateCcw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "./feedback";
import { useStudioJobs, useStudioMutations } from "./hooks";
import type { JobStatus, MediaJob } from "./types";

const statusTone: Record<JobStatus, string> = {
  pending: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  rendering: "border-sky-300/30 bg-sky-400/10 text-sky-100",
  completed: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  failed: "border-red-300/30 bg-red-400/10 text-red-100",
  cancelled: "border-zinc-600 bg-zinc-800 text-zinc-300",
};

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function JobCard({ job }: { job: MediaJob }) {
  const { retry, cancel } = useStudioMutations();
  const retrying = retry.isPending && retry.variables === job.id;
  const cancelling = cancel.isPending && cancel.variables === job.id;
  const active = job.status === "pending" || job.status === "rendering";
  const progress = Math.max(0, Math.min(100, job.progress));

  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-zinc-100">{job.title}</p>
            <Badge variant="outline" className={cn("capitalize", statusTone[job.status])}>{job.status}</Badge>
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">{job.aspectRatio}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">{job.influencerName || "Unassigned influencer"} · {job.language} · attempt {job.attempt}/{job.maxAttempts}</p>
          <div className="mt-3 flex items-center gap-3">
            <Progress value={progress} aria-label={`${job.title} generation progress: ${progress}%`} className="h-1.5 bg-white/10 [&>div]:bg-emerald-300 motion-reduce:[&>div]:transition-none" />
            <span className="w-10 text-right text-xs tabular-nums text-zinc-400">{progress}%</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            <span className="capitalize">{job.stage.replaceAll("_", " ")}</span>
            <span>{money.format(job.actualCostUsd ?? job.estimatedCostUsd)}</span>
            <span>{dateTime.format(new Date(job.updatedAt))}</span>
          </div>
          {job.error && <p className="mt-3 rounded-lg border border-red-300/15 bg-red-400/[0.06] px-3 py-2 text-xs text-red-200" role="alert">{job.error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {job.status === "failed" && (
            <Button type="button" size="sm" variant="outline" className="border-white/10 bg-white/5" disabled={retrying} onClick={() => retry.mutate(job.id)} aria-label={`Retry ${job.title}`}>
              {retrying ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />} Retry
            </Button>
          )}
          {active && (
            <Button type="button" size="sm" variant="outline" className="border-white/10 bg-white/5 text-zinc-300" disabled={cancelling} onClick={() => cancel.mutate(job.id)} aria-label={`Cancel ${job.title}`}>
              {cancelling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square className="mr-2 h-3.5 w-3.5" aria-hidden="true" />} Cancel
            </Button>
          )}
          {job.status === "completed" && job.asset?.url && (
            <a href={job.asset.url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
              Open video <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
      {(retry.isError || cancel.isError) && <p role="alert" className="mt-3 text-xs text-red-300">{retry.error?.message || cancel.error?.message}</p>}
    </li>
  );
}

export function JobList() {
  const jobsQuery = useStudioJobs();
  if (jobsQuery.isLoading) return <LoadingPanel label="Loading generation jobs" />;
  if (jobsQuery.isError) return <ErrorPanel message={jobsQuery.error.message} onRetry={() => jobsQuery.refetch()} />;
  const jobs = jobsQuery.data ?? [];

  return (
    <Card className="border-white/10 bg-white/[0.035] text-white shadow-none">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Generation jobs</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">Active jobs refresh every four seconds.</p>
        </div>
        <Button type="button" size="sm" variant="ghost" className="text-zinc-400 hover:text-white" disabled={jobsQuery.isFetching} onClick={() => jobsQuery.refetch()} aria-label="Refresh generation jobs">
          <RefreshCcw className={cn("h-4 w-4", jobsQuery.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent aria-busy={jobsQuery.isFetching}>
        {jobs.length === 0 ? (
          <EmptyPanel title="No generation jobs" description="Create your first vertical video and its progress will appear here." />
        ) : (
          <ul className="space-y-3">{jobs.map((job) => <JobCard key={job.id} job={job} />)}</ul>
        )}
      </CardContent>
    </Card>
  );
}
