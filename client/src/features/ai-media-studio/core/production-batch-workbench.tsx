import { useEffect, useRef, useState } from "react";
import { FileCheck2, FileText, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "../feedback";
import { usePrepareProductionBatchScripts, useProductionBatch } from "./hooks";
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

function scriptReadiness(batch: ProductionBatch): string {
  if (batch.status === "draft_ready") return "Draft ready";
  if (batch.status === "stale") return "Refresh required";
  return "Not prepared";
}

export function ProductionBatchWorkbench() {
  const batchQuery = useProductionBatch();
  const prepare = usePrepareProductionBatchScripts();
  const [localError, setLocalError] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const attemptRef = useRef<string | undefined>(undefined);
  const batch = batchQuery.data?.batch;

  useEffect(() => {
    if (prepare.isSuccess) {
      attemptRef.current = undefined;
      resultRef.current?.focus();
    }
  }, [prepare.isSuccess]);

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
  const errorMessage = localError || prepare.error?.message;
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
      {prepare.isSuccess && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border border-sky-300/20 bg-sky-400/[0.07] p-4 text-sm text-sky-100">Draft scripts are stored for all {prepare.data.batch.plannedVideoCount} slots. Generation remains disabled.</div>}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Creators</dt><dd className="mt-2 text-2xl font-semibold">{batch.avatarCount} × {batch.videosPerAvatar}</dd></CardContent></Card>
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Plan slots</dt><dd className="mt-2 text-2xl font-semibold">{batch.plannedVideoCount}</dd></CardContent></Card>
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Draft scripts ready</dt><dd className="mt-2 text-2xl font-semibold">{readyScripts}/{batch.plannedVideoCount}</dd></CardContent></Card>
        <Card className="border-white/10 bg-white/[0.035] text-white shadow-none"><CardContent className="p-4"><dt className="text-xs uppercase tracking-[0.12em] text-zinc-500">Generation allowed</dt><dd className="mt-2 text-2xl font-semibold text-amber-200">{batch.canGenerate ? "Yes" : "No"}</dd></CardContent></Card>
      </dl>

      <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
        <div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-emerald-300" aria-hidden="true" /><h3 className="font-semibold text-white">Durable readiness</h3></div>
        <p className="mt-2 text-sm text-zinc-400">Sources and scripts are stored as canonical Kong records. All downstream launch gates remain visible and closed.</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Production batch blockers">
          {batch.blockers.map((blocker) => <li key={blocker} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-zinc-300">{blockerLabels[blocker]}</li>)}
        </ul>
      </div>

      <ul className="space-y-3" aria-label={`${batch.avatarCount} creator production groups`}>
        {batch.groups.map((group) => (
          <li key={group.memberId}>
            <details className="group rounded-xl border border-white/10 bg-white/[0.035] text-white">
              <summary className="cursor-pointer rounded-xl px-4 py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 sm:px-5">
                <span className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span>{group.creatorName}</span><span className="text-sm font-normal text-zinc-400">10 source slots · {group.items.filter((item) => item.preparation === "draft").length}/10 drafts ready</span></span>
              </summary>
              <ol className="space-y-2 border-t border-white/10 p-4 sm:p-5" aria-label={`${group.creatorName} script slots`}>
                {group.items.map((item) => (
                  <li key={item.slotId} className="grid gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                    <span className="font-semibold text-emerald-200">Video {item.videoNumber}</span>
                    {item.preparation === "draft" ? (
                      <>
                        <span className="min-w-0"><span className="flex items-center gap-2 font-medium text-zinc-200"><FileText className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" /> Source ready</span><span className="mt-1 block truncate text-xs text-zinc-400">{item.source.title} · {item.source.category.replaceAll("_", " ")}</span></span>
                        <span><span className="font-medium text-zinc-200">Script: {scriptReadiness(batch)}</span><span className="mt-1 block truncate text-xs text-zinc-400">{item.script.title} · {item.script.variantCount} variants</span></span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-zinc-400">Source pending preparation</span>
                        <span className="font-medium text-zinc-400">Script: Not prepared</span>
                      </>
                    )}
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
