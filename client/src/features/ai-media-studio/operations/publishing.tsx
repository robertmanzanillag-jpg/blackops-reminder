import { useState, type FormEvent } from "react";
import { CalendarClock, Check, Loader2, LockKeyhole, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyPanel, LoadingPanel } from "../feedback";
import { LoadMoreError, OperationsPageError } from "./feedback";
import { usePublishingConnections, usePublishingJobs, usePublishingMutations, useReadyPublishingAssets } from "./hooks";
import { scheduledPublishingError, type PublishingJob, type PublishingJobStatus, type SocialPlatform } from "./types";

const platforms: Array<{ value: SocialPlatform; label: string }> = [
  { value: "tiktok", label: "TikTok" }, { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" }, { value: "youtube_shorts", label: "YouTube Shorts" },
];
const statuses: PublishingJobStatus[] = ["pending_approval", "scheduled", "queued", "publishing", "published", "failed", "dead_letter", "cancelled"];
const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30 disabled:opacity-50";
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function idempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `publish-${crypto.randomUUID()}` : `publish-${Date.now()}`;
}

function statusTone(status: PublishingJobStatus) {
  if (status === "published") return "border-emerald-300/30 bg-emerald-400/10 text-emerald-200";
  if (status === "failed" || status === "dead_letter") return "border-red-300/30 bg-red-400/10 text-red-100";
  if (status === "cancelled") return "border-white/15 bg-white/5 text-zinc-300";
  return "border-amber-300/30 bg-amber-400/10 text-amber-100";
}

function PublishingComposer() {
  const { create } = usePublishingMutations();
  const assets = useReadyPublishingAssets();
  const [mediaAssetId, setMediaAssetId] = useState("");
  const [platform, setPlatform] = useState<SocialPlatform>("tiktok");
  const [mode, setMode] = useState<"manual" | "scheduled">("manual");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [error, setError] = useState("");
  const readyAssets = assets.data ?? [];
  const assetsUnavailable = assets.isLoading || assets.isError || readyAssets.length === 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (assets.isLoading) {
      setError("Wait until ready media assets finish loading.");
      return;
    }
    if (assets.isError) {
      setError("Ready media assets could not be loaded. Retry before creating a draft.");
      return;
    }
    if (readyAssets.length === 0) {
      setError("No ready canonical media assets are available.");
      return;
    }
    if (!mediaAssetId.trim() || !readyAssets.some((asset) => asset.id === mediaAssetId.trim())) {
      setError("Select a ready canonical media asset.");
      requestAnimationFrame(() => document.getElementById("publish-asset")?.focus());
      return;
    }
    if (mode === "scheduled") {
      const scheduleError = scheduledPublishingError(scheduledFor);
      if (scheduleError) {
        setError(scheduleError);
        requestAnimationFrame(() => document.getElementById("publish-time")?.focus());
        return;
      }
    }
    const scheduledIso = mode === "scheduled" ? new Date(scheduledFor).toISOString() : null;
    const timezone = mode === "scheduled" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
    const input = {
      mediaAssetId: mediaAssetId.trim(), platform, caption: caption.trim(), title: title.trim() || null,
      hashtags: hashtags.split(/[\s,]+/u).map((value) => value.trim()).filter(Boolean), timezone,
      schedule: { mode, scheduledFor: scheduledIso, timezone },
      idempotencyKey: idempotencyKey(),
    };
    setError("");
    create.mutate(input);
  };

  return (
    <Card className="border-white/10 bg-white/[0.035] text-white shadow-none">
      <CardHeader><CardTitle className="text-base">Create approval draft</CardTitle><p className="text-sm text-zinc-400">Manual and scheduled drafts never publish until an operator approves the immutable preview.</p></CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="publish-asset">Ready media asset</Label>
              <select id="publish-asset" required disabled={assetsUnavailable} aria-describedby="publish-asset-status" className={inputClass} value={mediaAssetId} onChange={(event) => setMediaAssetId(event.target.value)}>
                <option value="">{assets.isLoading ? "Loading ready assets…" : assets.isError ? "Ready assets unavailable" : readyAssets.length === 0 ? "No ready assets available" : "Select a ready asset"}</option>
                {readyAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.kind}</option>)}
              </select>
              {assets.isLoading && <p id="publish-asset-status" role="status" className="mt-2 text-xs text-zinc-400">Loading ready canonical media assets…</p>}
              {assets.isError && <div id="publish-asset-status" role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-200"><span>{assets.error.message}</span><Button type="button" size="sm" variant="outline" onClick={() => void assets.refetch()} disabled={assets.isFetching} className="border-red-300/20 bg-red-400/5 text-red-100">{assets.isFetching ? "Retrying…" : "Retry assets"}</Button></div>}
              {!assets.isLoading && !assets.isError && readyAssets.length === 0 && <p id="publish-asset-status" role="status" className="mt-2 text-xs text-amber-200">No ready canonical media assets are available. Finish an asset before creating a publishing draft.</p>}
              {!assets.isLoading && !assets.isError && readyAssets.length > 0 && <p id="publish-asset-status" className="mt-2 text-xs text-zinc-400">{readyAssets.length} ready {readyAssets.length === 1 ? "asset" : "assets"} available.</p>}
            </div>
            <div><Label htmlFor="publish-platform">Platform</Label><select id="publish-platform" className={inputClass} value={platform} onChange={(event) => setPlatform(event.target.value as SocialPlatform)}>{platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div><Label htmlFor="publish-mode">Publishing mode</Label><select id="publish-mode" className={inputClass} value={mode} onChange={(event) => setMode(event.target.value as "manual" | "scheduled")}><option value="manual">Manual approval</option><option value="scheduled">Scheduled after approval</option><option value="automatic" disabled>Automatic · locked</option></select></div>
            <div><Label htmlFor="publish-time">Scheduled time</Label><input id="publish-time" type="datetime-local" disabled={mode !== "scheduled"} required={mode === "scheduled"} className={inputClass} value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></div>
            <div><Label htmlFor="publish-title">Title</Label><input id="publish-title" className={inputClass} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></div>
          </div>
          <div><Label htmlFor="publish-caption">Caption</Label><Textarea id="publish-caption" className="mt-2 min-h-28 border-white/15 bg-zinc-950 focus-visible:ring-emerald-300" maxLength={2_200} value={caption} onChange={(event) => setCaption(event.target.value)} /></div>
          <div><Label htmlFor="publish-hashtags">Hashtags</Label><input id="publish-hashtags" className={inputClass} value={hashtags} onChange={(event) => setHashtags(event.target.value)} placeholder="#miami #travel" /></div>
          {error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
          {create.isError && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">{create.error.message}</p>}
          {create.isSuccess && <p role="status" className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">Draft {create.data.job.id} created and awaiting its required approval.</p>}
          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-2 text-xs text-zinc-400"><LockKeyhole className="h-4 w-4 text-emerald-300" aria-hidden="true" /> Automatic publishing remains locked.</p><Button type="submit" disabled={create.isPending || assetsUnavailable} className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300">{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />}{create.isPending ? "Creating draft…" : "Create approval draft"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function PublishingJobCard({ job }: { job: PublishingJob }) {
  const mutations = usePublishingMutations();
  const actionError = mutations.approve.error ?? mutations.reject.error ?? mutations.cancel.error ?? mutations.retry.error;
  const pending = mutations.approve.isPending || mutations.reject.isPending || mutations.cancel.isPending || mutations.retry.isPending;
  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-zinc-100">{job.preview.title ?? `Publishing job ${job.id}`}</h3><span className={`rounded-full border px-2.5 py-1 text-xs capitalize ${statusTone(job.status)}`}>{job.status.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm text-zinc-400">{job.platform.replace("_", " ")} · {job.mode} · attempt {job.attempts}/{job.maxAttempts}</p></div>
        <div className="flex flex-wrap gap-2">
          {job.status === "pending_approval" && <><Button type="button" size="sm" className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={pending} onClick={() => mutations.approve.mutate({ id: job.id, previewDigest: job.preview.digest })}><Check className="mr-2 h-4 w-4" aria-hidden="true" /> Approve</Button><Button type="button" size="sm" variant="outline" className="border-red-300/20 bg-red-400/5 text-red-100" disabled={pending} onClick={() => mutations.reject.mutate({ id: job.id, previewDigest: job.preview.digest, reason: "Rejected by operator after immutable preview review" })}><X className="mr-2 h-4 w-4" aria-hidden="true" /> Reject</Button></>}
          {["pending_approval", "scheduled", "queued"].includes(job.status) && <Button type="button" size="sm" variant="outline" className="border-white/15 bg-white/5 text-zinc-200" disabled={pending} onClick={() => mutations.cancel.mutate(job.id)}>Cancel</Button>}
          {(job.status === "failed" || job.status === "dead_letter") && <Button type="button" size="sm" variant="outline" className="border-white/15 bg-white/5 text-zinc-200" disabled={pending} onClick={() => mutations.retry.mutate(job.id)}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry</Button>}
        </div>
      </div>
      <details className="mt-4 rounded-lg border border-white/10 bg-white/[0.025] p-3"><summary className="cursor-pointer text-sm font-medium text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">Immutable publishing preview</summary><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-zinc-500">Asset</dt><dd className="mt-1 break-all text-zinc-200">{job.preview.mediaAssetId}</dd></div><div><dt className="text-zinc-500">Digest</dt><dd className="mt-1 break-all font-mono text-zinc-300">{job.preview.digest}</dd></div><div className="sm:col-span-2"><dt className="text-zinc-500">Caption</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{job.preview.caption || "No caption"}</dd></div><div><dt className="text-zinc-500">Generated</dt><dd className="mt-1 text-zinc-200">{dateTime.format(new Date(job.preview.generatedAt))}</dd></div><div><dt className="text-zinc-500">Scheduled</dt><dd className="mt-1 text-zinc-200">{job.scheduledFor ? dateTime.format(new Date(job.scheduledFor)) : "Not scheduled"}</dd></div></dl></details>
      {job.approval && <p className="mt-3 flex items-center gap-2 text-xs text-zinc-400"><ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" /> {job.approval.decision} by {job.approval.actorId} · evidence bound to preview digest</p>}
      {actionError && <p role="alert" className="mt-3 text-sm text-red-200">{actionError.message}</p>}
    </li>
  );
}

export function PublishingWorkspace() {
  const [platform, setPlatform] = useState<"all" | SocialPlatform>("all");
  const [status, setStatus] = useState<"all" | PublishingJobStatus>("all");
  const jobsQuery = usePublishingJobs({ ...(platform === "all" ? {} : { platform }), ...(status === "all" ? {} : { status }) });
  const connectionsQuery = usePublishingConnections();
  const jobs = jobsQuery.data?.pages.flatMap((page) => page.jobs) ?? [];
  return (
    <section id="publishing" aria-labelledby="publishing-heading" className="scroll-mt-24 space-y-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Approval-gated delivery</p><h2 id="publishing-heading" className="mt-2 text-2xl font-semibold text-white">Publishing</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Prepare manual or scheduled platform jobs. Every submission remains bound to an immutable preview and explicit operator decision.</p></div>
      <PublishingComposer />
      <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardHeader><CardTitle className="text-base">Connection readiness</CardTitle><p className="text-sm text-zinc-400">Readiness metadata only. Credentials and provider-native tokens are never displayed.</p></CardHeader><CardContent>{connectionsQuery.isLoading ? <LoadingPanel label="Checking publishing connections" /> : connectionsQuery.isError ? <OperationsPageError message={connectionsQuery.error.message} onRetry={() => void connectionsQuery.refetch()} /> : !connectionsQuery.data?.connections.length ? <EmptyPanel title="No publishing connections" description="Connect a supported platform before approving a publishing job." /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{connectionsQuery.data.connections.map((connection) => <div key={connection.platform} className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-2"><p className="font-medium capitalize text-zinc-100">{connection.platform.replace("_", " ")}</p><span className="text-xs capitalize text-zinc-400">{connection.status.replace("_", " ")}</span></div><p className="mt-2 text-sm text-zinc-400">{connection.accountLabel ?? "No account label"}</p><p className="mt-2 text-xs leading-5 text-zinc-500">{connection.message}</p></div>)}</div>}</CardContent></Card>
      <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between"><div><CardTitle className="text-base">Publishing queue</CardTitle><p className="mt-1 text-sm text-zinc-400">Approve, reject, cancel, or retry without modifying the stored preview.</p></div><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="publishing-platform-filter" className="sr-only">Filter by platform</Label><select id="publishing-platform-filter" className={inputClass} value={platform} onChange={(event) => setPlatform(event.target.value as "all" | SocialPlatform)}><option value="all">All platforms</option>{platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div><Label htmlFor="publishing-status-filter" className="sr-only">Filter by status</Label><select id="publishing-status-filter" className={inputClass} value={status} onChange={(event) => setStatus(event.target.value as "all" | PublishingJobStatus)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></div></div></CardHeader><CardContent>{jobsQuery.isLoading ? <LoadingPanel label="Loading publishing queue" /> : jobsQuery.isError && !jobsQuery.data ? <OperationsPageError message={jobsQuery.error.message} onRetry={() => void jobsQuery.refetch()} /> : jobs.length === 0 ? <EmptyPanel title="No publishing jobs" description="Create an approval draft to start a provider-neutral publishing workflow." /> : <><ul className="space-y-3">{jobs.map((job) => <PublishingJobCard key={job.id} job={job} />)}</ul>{jobsQuery.hasNextPage && <Button type="button" variant="outline" className="mt-4 w-full border-white/15 bg-white/5 text-zinc-100" disabled={jobsQuery.isFetchingNextPage} onClick={() => void jobsQuery.fetchNextPage()}>{jobsQuery.isFetchingNextPage ? "Loading more…" : "Load more publishing jobs"}</Button>}{jobsQuery.isFetchNextPageError && <LoadMoreError message={jobsQuery.error.message} pending={jobsQuery.isFetchingNextPage} onRetry={() => void jobsQuery.fetchNextPage()} />}</>}</CardContent></Card>
    </section>
  );
}
