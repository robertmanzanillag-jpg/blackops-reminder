import { useState } from "react";
import { Ban, FileCheck2, FileText, LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmptyPanel, LoadingPanel } from "../feedback";
import { LoadMoreError, OperationsPageError } from "./feedback";
import { useAutomationPolicy, useSourceReviewMutations, useSources } from "./hooks";
import {
  createSourceActionIdempotencyKey,
  type SourceRightsStatus,
  type SourceScriptPreviewResponse,
  type SourceStatus,
} from "./types";

const sourceStatuses: SourceStatus[] = ["discovered", "accepted", "processing", "ready", "rejected", "archived"];
const rightsStatuses: SourceRightsStatus[] = ["unknown", "owned", "licensed", "restricted", "rejected"];
const inputClass = "mt-2 h-11 w-full rounded-lg border border-white/15 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/30";
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export function AutomationWorkspace() {
  const [status, setStatus] = useState<"all" | SourceStatus>("all");
  const [rightsStatus, setRightsStatus] = useState<"all" | SourceRightsStatus>("all");
  const policyQuery = useAutomationPolicy();
  const sourcesQuery = useSources({ ...(status === "all" ? {} : { status }), ...(rightsStatus === "all" ? {} : { rightsStatus }), limit: 25 });
  const { review, preview } = useSourceReviewMutations();
  const [previews, setPreviews] = useState<Record<string, SourceScriptPreviewResponse>>({});
  const sources = sourcesQuery.data?.pages.flatMap((page) => page.sources) ?? [];
  const policy = policyQuery.data;

  const reviewSource = (sourceItemId: string, contentHash: string, decision: "owned" | "licensed" | "reject") => {
    review.mutate(decision === "reject" ? {
      sourceItemId,
      decision: "reject",
      expectedContentHash: contentHash,
      idempotencyKey: createSourceActionIdempotencyKey("reject", sourceItemId, contentHash),
      reasonCode: "rights_unverified",
    } : {
      sourceItemId,
      decision: "approve",
      expectedContentHash: contentHash,
      idempotencyKey: createSourceActionIdempotencyKey(decision, sourceItemId, contentHash),
      rightsStatus: decision,
    });
  };

  const previewScript = (sourceItemId: string, contentHash: string) => {
    preview.mutate({
      sourceItemId,
      idempotencyKey: createSourceActionIdempotencyKey("preview", sourceItemId, contentHash),
      language: "en",
      variantCount: 3,
    }, {
      onSuccess: (result) => setPreviews((current) => ({ ...current, [sourceItemId]: result })),
    });
  };

  return (
    <section id="automation" aria-labelledby="automation-heading" className="scroll-mt-24 space-y-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Guardrailed orchestration</p><h2 id="automation-heading" className="mt-2 text-2xl font-semibold text-white">Automation policy</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Inspect intake readiness and the effective safety policy. This surface cannot enable automatic publishing or post content.</p></div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardHeader><CardTitle className="text-base">Effective policy preview</CardTitle></CardHeader><CardContent>{policyQuery.isLoading ? <LoadingPanel label="Loading automation policy" /> : policyQuery.isError ? <OperationsPageError message={policyQuery.error.message} onRetry={() => void policyQuery.refetch()} /> : policy ? <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs text-zinc-400">Automatic publishing</p><p className="mt-1 font-medium text-emerald-200">Disabled</p></div><div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs text-zinc-400">Operator approval</p><p className="mt-1 font-medium text-emerald-200">Required</p></div></div><dl className="space-y-3 text-sm"><div><dt className="text-zinc-400">Policy version</dt><dd className="mt-1 font-mono text-xs text-zinc-200">{policy.policyVersion}</dd></div><div><dt className="text-zinc-400">Reason</dt><dd className="mt-1 leading-6 text-zinc-200">{policy.reason}</dd></div><div><dt className="text-zinc-400">Evaluated</dt><dd className="mt-1 text-zinc-200">{dateTime.format(new Date(policy.evaluatedAt))}</dd></div></dl></div> : null}</CardContent></Card>
        <Card className="border-red-300/15 bg-red-400/[0.04] text-white shadow-none"><CardHeader><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-red-200" aria-hidden="true" /><CardTitle className="text-base">Automatic publishing kill switch</CardTitle></div></CardHeader><CardContent><div role="status" className="rounded-xl border border-red-300/20 bg-black/20 p-4"><p className="flex items-center gap-2 font-semibold text-red-100"><LockKeyhole className="h-4 w-4" aria-hidden="true" /> LOCKED ON</p><p className="mt-2 text-sm leading-6 text-zinc-300">Automatic publishing is disabled by the effective policy. This read-only control cannot be disengaged here.</p></div><div className="mt-4 flex min-h-11 items-center justify-center rounded-lg border border-dashed border-white/15 px-4 text-sm text-zinc-400" aria-disabled="true"><Ban className="mr-2 h-4 w-4" aria-hidden="true" /> No enable or post action available</div></CardContent></Card>
      </div>

      <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between"><div><CardTitle className="text-base">Source intake status</CardTitle><p className="mt-1 text-sm text-zinc-400">Rights and moderation must be ready before orchestration can continue.</p></div><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="source-status-filter" className="sr-only">Filter source status</Label><select id="source-status-filter" className={inputClass} value={status} onChange={(event) => setStatus(event.target.value as "all" | SourceStatus)}><option value="all">All statuses</option>{sourceStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><Label htmlFor="source-rights-filter" className="sr-only">Filter source rights</Label><select id="source-rights-filter" className={inputClass} value={rightsStatus} onChange={(event) => setRightsStatus(event.target.value as "all" | SourceRightsStatus)}><option value="all">All rights</option>{rightsStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div></CardHeader><CardContent>{sourcesQuery.isLoading ? <LoadingPanel label="Loading source intake" /> : sourcesQuery.isError && !sourcesQuery.data ? <OperationsPageError message={sourcesQuery.error.message} onRetry={() => void sourcesQuery.refetch()} /> : sources.length === 0 ? <EmptyPanel title="No source items" description="New events, venues, deals, and owned content will appear after safe intake." /> : <><ul className="space-y-3">{sources.map((source) => {
        const reviewable = source.status === "discovered" && source.rightsStatus === "unknown" && source.moderationStatus === "pending";
        const previewable = source.status === "accepted" && (source.rightsStatus === "owned" || source.rightsStatus === "licensed") && source.moderationStatus === "approved";
        const reviewPending = review.isPending && review.variables?.sourceItemId === source.id;
        const previewPending = preview.isPending && preview.variables?.sourceItemId === source.id;
        const sourcePreview = previews[source.id];
        const firstVariant = sourcePreview?.scriptSet.variants[0];
        return <li key={source.id} className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="truncate font-medium text-zinc-100">{source.title ?? `Source ${source.id}`}</p><p className="mt-1 text-xs text-zinc-400">{source.sourceType.replace("_", " ")} · {source.moderationStatus.replace("_", " ")}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-white/15 px-2.5 py-1 text-xs capitalize text-zinc-200">{source.status}</span><span className="rounded-full border border-emerald-300/20 bg-emerald-400/[0.06] px-2.5 py-1 text-xs capitalize text-emerald-200">{source.rightsStatus}</span></div></div>
          {reviewable && <div className="mt-4 border-t border-white/10 pt-4"><p className="mb-2 text-xs text-zinc-400">Operator rights review required. Choose one explicit decision.</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" className="bg-emerald-300 text-zinc-950 hover:bg-emerald-200" disabled={review.isPending} aria-label={`Approve ${source.title ?? source.id} as owned content`} onClick={() => reviewSource(source.id, source.contentHash, "owned")}>{reviewPending && review.variables?.decision === "approve" && review.variables.rightsStatus === "owned" ? "Approving…" : "Approve owned"}</Button><Button type="button" size="sm" variant="outline" className="border-emerald-300/30 bg-emerald-400/[0.06] text-emerald-100" disabled={review.isPending} aria-label={`Approve ${source.title ?? source.id} as licensed content`} onClick={() => reviewSource(source.id, source.contentHash, "licensed")}>{reviewPending && review.variables?.decision === "approve" && review.variables.rightsStatus === "licensed" ? "Approving…" : "Approve licensed"}</Button><Button type="button" size="sm" variant="outline" className="border-red-300/30 bg-red-400/[0.05] text-red-100" disabled={review.isPending} aria-label={`Reject ${source.title ?? source.id} because rights are unverified`} onClick={() => reviewSource(source.id, source.contentHash, "reject")}>{reviewPending && review.variables?.decision === "reject" ? "Rejecting…" : "Reject source"}</Button></div>{review.isError && review.variables?.sourceItemId === source.id && <p role="alert" className="mt-3 text-sm text-red-200">{review.error.message}</p>}</div>}
          {previewable && <div className="mt-4 border-t border-white/10 pt-4"><Button type="button" size="sm" variant="outline" className="border-sky-300/30 bg-sky-400/[0.06] text-sky-100" disabled={preview.isPending} aria-label={`Preview script for ${source.title ?? source.id}`} onClick={() => previewScript(source.id, source.contentHash)}><FileText className="mr-2 h-4 w-4" aria-hidden="true" />{previewPending ? "Preparing preview…" : "Preview script"}</Button>{preview.isError && preview.variables?.sourceItemId === source.id && <p role="alert" className="mt-3 text-sm text-red-200">{preview.error.message}</p>}{sourcePreview && firstVariant && <article aria-label={`Script preview for ${source.title ?? source.id}`} className="mt-3 rounded-lg border border-sky-300/15 bg-sky-400/[0.04] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Deterministic preview · $0 · render blocked</p><h3 className="mt-2 text-sm font-semibold text-zinc-100">{firstVariant.title}</h3><dl className="mt-2 space-y-2 text-sm"><div><dt className="text-xs text-zinc-500">Hook</dt><dd className="mt-1 text-zinc-200">{firstVariant.hook}</dd></div><div><dt className="text-xs text-zinc-500">Caption</dt><dd className="mt-1 text-zinc-300">{firstVariant.caption}</dd></div></dl></article>}</div>}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs text-zinc-400"><span className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-emerald-300" aria-hidden="true" /> Content hash recorded</span><span>{dateTime.format(new Date(source.updatedAt))}</span></div></li>;
      })}</ul>{sourcesQuery.hasNextPage && <Button type="button" variant="outline" className="mt-4 w-full border-white/15 bg-white/5 text-zinc-100" disabled={sourcesQuery.isFetchingNextPage} onClick={() => void sourcesQuery.fetchNextPage()}>{sourcesQuery.isFetchingNextPage ? "Loading more…" : "Load more sources"}</Button>}{sourcesQuery.isFetchNextPageError && <LoadMoreError message={sourcesQuery.error.message} pending={sourcesQuery.isFetchingNextPage} onRetry={() => void sourcesQuery.fetchNextPage()} />}</>}</CardContent></Card>
    </section>
  );
}
