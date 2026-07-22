import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileCheck2, FileText, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "../feedback";
import { useApproveProductionBatchScripts, usePrepareProductionBatchScripts, useProductionBatch } from "./hooks";
import type { ProductionBatch } from "./types";

const blockerLabels: Record<ProductionBatch["blockers"][number], string> = {
  script_batch_required: "Script batch preparation required",
  script_approval_required: "Script approval required",
  script_refresh_required: "Source refresh requires new drafts",
  governance_approval_required: "Governance approval required",
  budget_reservation_required: "Budget reservation required",
  sandbox_generation_required: "Sandbox validation required",
  human_launch_approval_required: "Human launch approval required",
};

export function newProductionBatchAttemptKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure preparation could not be started. Reload and try again.");
  }
  return `production-batch-${crypto.randomUUID()}`;
}

export function newProductionBatchApprovalKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure approval could not be started. Reload and try again.");
  }
  return crypto.randomUUID();
}

function scriptReadiness(batch: ProductionBatch): string {
  if (batch.status === "approved_ready") return "Approved";
  if (batch.status === "draft_ready") return "Draft ready";
  if (batch.status === "stale") return "Refresh required";
  return "Not prepared";
}

export function ProductionBatchWorkbench() {
  const batchQuery = useProductionBatch();
  const prepare = usePrepareProductionBatchScripts();
  const approve = useApproveProductionBatchScripts();
  const [localError, setLocalError] = useState("");
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const attemptRef = useRef<string | undefined>(undefined);
  const approvalAttemptRef = useRef<string | undefined>(undefined);
  const reviewedBatchRef = useRef<string | undefined>(undefined);
  const batch = batchQuery.data?.batch;

  useEffect(() => {
    const identity = batch ? `${batch.planId}:${batch.batchId}` : undefined;
    if (reviewedBatchRef.current && reviewedBatchRef.current !== identity) {
      setApprovalAcknowledged(false);
      approvalAttemptRef.current = undefined;
      approve.reset();
    }
    reviewedBatchRef.current = identity;
  }, [batch?.batchId, batch?.planId]);

  useEffect(() => {
    if (prepare.isSuccess) {
      attemptRef.current = undefined;
      resultRef.current?.focus();
    }
  }, [prepare.isSuccess]);

  useEffect(() => {
    if (approve.isSuccess) {
      approvalAttemptRef.current = undefined;
      setApprovalAcknowledged(false);
      resultRef.current?.focus();
    }
  }, [approve.isSuccess]);

  if (batchQuery.isLoading) {
    return <section id="production-batch" aria-labelledby="production-batch-heading" className="scroll-mt-24"><h2 id="production-batch-heading" className="sr-only">Daily production batch</h2><LoadingPanel label="Loading durable production batch" /></section>;
  }

  if (batchQuery.isError) {
    return <section id="production-batch" aria-labelledby="production-batch-heading" className="scroll-mt-24"><h2 id="production-batch-heading" className="sr-only">Daily production batch</h2><ErrorPanel message={batchQuery.error.message} onRetry={() => batchQuery.refetch().then(() => undefined)} /></section>;
  }

  if (!batch) {
    return (
      <section id="production-batch" aria-labelledby="production-batch-heading" className="scroll-mt-24">
        <h2 id="production-batch-heading" className="mb-4 text-2xl font-semibold text-white">Daily production batch</h2>
        <EmptyPanel title="No durable production batch" description="Configure the 5–10 avatar roster first. Kong will then prepare exactly ten blocked slots per creator." />
      </section>
    );
  }

  const readyScripts = batch.groups.reduce(
    (total, group) => total + group.items.filter((item) => item.preparation === "draft").length,
    0,
  );
  const allReviewsAvailable = batch.groups.every((group) => group.items.every((item) =>
    item.preparation === "draft" && item.script.selectedVariant !== undefined));
  const errorMessage = localError || prepare.error?.message || approve.error?.message;
  const prepareScripts = () => {
    setLocalError("");
    prepare.reset();
    try {
      attemptRef.current ??= newProductionBatchAttemptKey();
      prepare.mutate({
        planId: batch.planId,
        input: { idempotencyKey: attemptRef.current, variantCount: 3 },
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Secure preparation could not be started.");
    }
  };
  const approveScripts = () => {
    setLocalError("");
    prepare.reset();
    approve.reset();
    try {
      approvalAttemptRef.current ??= newProductionBatchApprovalKey();
      approve.mutate({
        planId: batch.planId,
        input: { idempotencyKey: approvalAttemptRef.current, expectedBatchId: batch.batchId },
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Secure approval could not be started.");
    }
  };

  return (
    <section id="production-batch" aria-labelledby="production-batch-heading" className="scroll-mt-24 space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Durable content preparation</p>
          <h2 id="production-batch-heading" className="mt-2 text-2xl font-semibold text-white">Daily production batch</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Review {batch.avatarCount} creators and their ten provider-neutral script slots before any admission or generation step.</p>
        </div>
        <Button
          type="button"
          className="min-h-11 bg-emerald-400 text-zinc-950 hover:bg-emerald-300"
          disabled={prepare.isPending || batch.status !== "not_started"}
          aria-busy={prepare.isPending}
          aria-describedby="production-batch-safety"
          onClick={prepareScripts}
        >
          {prepare.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {prepare.isPending ? "Preparing script batch…"
            : batch.status === "approved_ready" ? "Script batch approved"
              : batch.status === "draft_ready" ? "Script batch prepared"
              : batch.status === "stale" ? "Script refresh requires review"
                : "Prepare script batch — no credits"}
        </Button>
      </div>

      <div id="production-batch-safety" role="status" aria-live="polite" aria-atomic="true" className="flex items-start gap-3 rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-100">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p><span className="font-semibold">Preparation only · Generation disabled · No credits can be spent.</span> This action saves deterministic draft scripts only; it creates no render job, budget reservation, outbox event, or provider request.</p>
      </div>

      {errorMessage && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-400/10 p-4 text-sm text-red-100">{errorMessage}</p>}
      {batch.status === "stale" && <div role="alert" className="rounded-xl border border-amber-300/20 bg-amber-400/[0.08] p-4 text-sm leading-6 text-amber-100"><span className="font-semibold">This batch cannot be approved because its source content changed.</span> Keep it blocked; after the sources are reviewed, create a new durable daily plan from the <a href="#heygen-roster" className="underline underline-offset-4 hover:text-white">avatar roster</a>. No safe in-place refresh is available yet.</div>}
      {prepare.isSuccess && batch.status === "draft_ready" && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border border-sky-300/20 bg-sky-400/[0.07] p-4 text-sm text-sky-100">Draft scripts are stored for all {prepare.data.batch.plannedVideoCount} slots. Generation remains disabled.</div>}
      {approve.isSuccess && batch.status === "approved_ready" && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-100">All {batch.plannedVideoCount} scripts were approved as one batch. Governance, budget, sandbox validation, and human launch approval remain closed.</div>}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Creators</dt><dd className="mt-2 text-2xl font-semibold">{batch.avatarCount} × {batch.videosPerAvatar}</dd></CardContent></Card>
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Plan slots</dt><dd className="mt-2 text-2xl font-semibold">{batch.plannedVideoCount}</dd></CardContent></Card>
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Scripts ready</dt><dd className="mt-2 text-2xl font-semibold">{readyScripts}/{batch.plannedVideoCount}</dd></CardContent></Card>
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Generation allowed</dt><dd className="mt-2 text-2xl font-semibold text-amber-200">{batch.canGenerate ? "Yes" : "No"}</dd></CardContent></Card>
      </dl>

      <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
        <div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-emerald-300" aria-hidden="true" /><h3 className="font-semibold text-white">Durable readiness</h3></div>
        <p className="mt-2 text-sm text-zinc-400">Sources and scripts are stored as canonical Kong records. All downstream launch gates remain visible and closed.</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Production batch blockers">
          {batch.blockers.map((blocker) => <li key={blocker} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-zinc-300">{blockerLabels[blocker]}</li>)}
        </ul>
      </div>

      {(batch.status === "draft_ready" || batch.status === "approved_ready") && (
        <div className="rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-white">Atomic script review</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-300">Approval covers every script in this exact batch. Individual slots cannot be approved separately, and this does not create jobs, reserve budget, or contact a provider.</p>
            </div>
          </div>
          {batch.status === "draft_ready" ? (
            <div className="mt-4 space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-emerald-400"
                  checked={approvalAcknowledged}
                  onChange={(event) => setApprovalAcknowledged(event.currentTarget.checked)}
                />
                <span>I reviewed the complete content for all {batch.plannedVideoCount} scripts and understand this approves the entire batch at once.</span>
              </label>
              <Button
                type="button"
                className="min-h-11 bg-sky-300 text-zinc-950 hover:bg-sky-200"
                disabled={!approvalAcknowledged || !allReviewsAvailable || approve.isPending}
                aria-busy={approve.isPending}
                onClick={approveScripts}
              >
                {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {approve.isPending ? "Approving complete batch…" : `Approve all ${batch.plannedVideoCount} scripts`}
              </Button>
              {!allReviewsAvailable && <p role="alert" className="text-sm text-amber-200">Complete selected-variant content is required for every slot before this batch can be approved.</p>}
            </div>
          ) : <p className="mt-4 text-sm font-medium text-emerald-200">Complete script batch approved. Remaining launch gates are listed above.</p>}
        </div>
      )}

      <ul className="space-y-3" aria-label={`${batch.avatarCount} creator production groups`}>
        {batch.groups.map((group) => (
          <li key={group.memberId}>
            <details className="group rounded-xl border border-white/10 bg-white/[0.035] text-white">
              <summary className="cursor-pointer rounded-xl px-4 py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 sm:px-5">
                <span className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span>{group.creatorName}</span><span className="text-sm font-normal text-zinc-400">10 source slots · {group.items.filter((item) => item.preparation === "draft").length}/10 scripts ready</span></span>
              </summary>
              <ol className="space-y-2 border-t border-white/10 p-4 sm:p-5" aria-label={`${group.creatorName} script slots`}>
                {group.items.map((item) => (
                  <li key={item.slotId} className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm">
                    <div className="grid gap-3 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                    <span className="font-semibold text-emerald-200">Video {item.videoNumber}</span>
                    {item.preparation === "draft" ? (
                      <>
                        <span className="min-w-0"><span className="flex items-center gap-2 font-medium text-zinc-200"><FileText className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" /> Source ready</span><span className="mt-1 block truncate text-xs text-zinc-400">{item.source.title} · {item.source.category.replaceAll("_", " ")}</span></span>
                        <span><span className="font-medium text-zinc-200">Script: {scriptReadiness(batch)}</span><span className="mt-1 block text-xs text-zinc-400">{item.script.title} · {item.script.variantCount} variants</span></span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-zinc-400">Source pending preparation</span>
                        <span className="font-medium text-zinc-400">Script: Not prepared</span>
                      </>
                    )}
                    </div>
                    {item.preparation === "draft" && item.script.selectedVariant ? (
                      <dl className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-2">
                        <div className="md:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Video title</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{item.script.selectedVariant.title}</dd></div>
                        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Angle</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{item.script.selectedVariant.angle}</dd></div>
                        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Hook</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{item.script.selectedVariant.hook}</dd></div>
                        <div className="md:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Script</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-zinc-200">{item.script.selectedVariant.script}</dd></div>
                        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Call to action</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{item.script.selectedVariant.cta}</dd></div>
                        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Caption</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-200">{item.script.selectedVariant.caption}</dd></div>
                        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Hashtags</dt><dd className="mt-1 break-words text-zinc-200">{item.script.selectedVariant.hashtags.join(" ")}</dd></div>
                        <div><dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">SEO keywords</dt><dd className="mt-1 break-words text-zinc-200">{item.script.selectedVariant.seoKeywords.join(", ")}</dd></div>
                      </dl>
                    ) : item.preparation === "draft" ? <p role="alert" className="mt-4 border-t border-white/10 pt-4 text-amber-200">Selected variant review content is unavailable for this slot.</p> : null}
                  </li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
