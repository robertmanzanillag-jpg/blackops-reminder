import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileCheck2,
  FileText,
  Loader2,
  LockKeyhole,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "../feedback";
import {
  useApproveProductionBatchScripts,
  usePrepareProductionBatchScripts,
  useProductionBatch,
  useProductionBatchLaunchPreflight,
  useProductionBatchSandboxReadiness,
} from "./hooks";
import type { LaunchPreflight, LaunchPreflightGate, ProductionBatch, SandboxReadinessGate } from "./types";

const blockerLabels: Record<ProductionBatch["blockers"][number], string> = {
  script_batch_required: "Script batch preparation required",
  script_approval_required: "Script approval required",
  script_refresh_required: "Source refresh requires new drafts",
  governance_approval_required: "Governance approval required",
  budget_reservation_required: "Budget reservation required",
  sandbox_generation_required: "Sandbox validation required",
  human_launch_approval_required: "Human launch approval required",
};

const launchGateLabels: Record<LaunchPreflightGate["code"], string> = {
  batch_integrity: "Batch integrity",
  plan_window: "Plan window",
  source_eligibility: "Source eligibility",
  provider_binding_local: "Local provider binding",
  governance_coverage: "Governance coverage",
  launch_intent: "Launch intent",
  content_approval: "Content approval",
  policy_kill_switch: "Policy and kill switch",
  provider_live_verification: "Live provider verification",
  maximum_quote: "Maximum cost quote",
  sandbox_proof: "Sandbox proof",
  human_launch_approval: "Human launch approval",
  authority_snapshot: "Authority snapshot",
  budget_admission_capacity: "Budget and admission capacity",
};

const launchGateStateLabels: Record<LaunchPreflightGate["state"], string> = {
  passed: "Passed",
  blocked: "Blocked",
  pending_external: "External setup pending",
  pending_human: "Human decision pending",
  unavailable: "Observation unavailable",
};

const launchNextActions: Record<LaunchPreflightGate["nextActionCode"], { label: string; href?: string }> = {
  none: { label: "No action needed" },
  approve_scripts: { label: "Complete script review", href: "#production-batch" },
  repair_batch: { label: "Repair the production batch", href: "#production-batch" },
  wait_for_plan_window: { label: "Wait for the planned window" },
  repair_source: { label: "Review source eligibility", href: "#production-batch" },
  configure_provider: { label: "Configure the provider roster", href: "#heygen-roster" },
  refresh_provider_credential: { label: "Refresh provider access", href: "#heygen-roster" },
  repair_provider_resources: { label: "Review avatar and voice bindings", href: "#heygen-roster" },
  record_governance: { label: "Complete governance evidence" },
  declare_launch_intent: { label: "Declare launch intent in a separately reviewed step" },
  record_content_approval: { label: "Record content approval in a separately reviewed step" },
  revise_policy: { label: "Review launch policy" },
  disable_kill_switch: { label: "Resolve the active kill switch" },
  verify_provider_live: { label: "Run live provider verification after approval" },
  obtain_maximum_quote: { label: "Obtain a maximum cost quote" },
  run_sandbox: { label: "Run one approved sandbox test" },
  request_human_approval: { label: "Request explicit human launch approval" },
  create_authority_snapshot: { label: "Create an authority snapshot in a separately reviewed step" },
  configure_budget: { label: "Configure an approved budget ceiling" },
  free_capacity: { label: "Free admission capacity" },
  resolve_existing_attempt: { label: "Resolve the existing launch attempt" },
  retry_observation: { label: "Refresh this read-only observation" },
};

function LaunchGateIcon({ state }: { state: LaunchPreflightGate["state"] }) {
  if (state === "passed") return <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />;
  if (state === "blocked") return <AlertCircle className="h-5 w-5 text-red-300" aria-hidden="true" />;
  if (state === "unavailable") return <CircleDashed className="h-5 w-5 text-zinc-400" aria-hidden="true" />;
  return <Clock3 className="h-5 w-5 text-amber-200" aria-hidden="true" />;
}

function LaunchPreflightPanel({
  planId,
  batchId,
  enabled,
}: {
  planId: string;
  batchId: string;
  enabled: boolean;
}) {
  const query = useProductionBatchLaunchPreflight({ planId, batchId, enabled });
  const preflight: LaunchPreflight | undefined = query.data?.preflight;

  return (
    <section id="launch-preflight" aria-labelledby="launch-preflight-heading" className="space-y-4 rounded-xl border border-violet-300/20 bg-violet-400/[0.05] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-200">Launch preflight — read-only · no spend</p>
          <h3 id="launch-preflight-heading" className="mt-2 text-lg font-semibold text-white">Launch gate observation</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300">This check observes launch prerequisites. It cannot create authority, reserve budget, contact a provider, or start generation.</p>
        </div>
        {enabled && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0 border-white/10 bg-white/5"
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            onClick={() => query.refetch().then(() => undefined)}
          >
            <RefreshCcw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            Refresh read-only check
          </Button>
        )}
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="rounded-lg border border-amber-300/20 bg-amber-400/[0.08] p-4 text-sm leading-6 text-amber-100">
        <span className="font-semibold">Script approval is not launch approval and does not authorize spend.</span> Every remaining gate must be satisfied through its own controlled workflow before any later admission decision.
      </div>
      {query.isFetching && !query.isLoading && <p role="status" aria-live="polite" className="text-sm text-violet-100">Refreshing the read-only observation… Existing results remain non-authoritative.</p>}

      {!enabled ? (
        <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">The read-only observation becomes available only after the complete script batch is approved.</p>
      ) : query.isLoading ? (
        <LoadingPanel label="Observing launch gates without side effects" />
      ) : query.isError ? (
        <ErrorPanel message={query.error.message} onRetry={() => query.refetch().then(() => undefined)} />
      ) : preflight ? (
        <div className="space-y-4">
          <div aria-live="polite" aria-atomic="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Status</p><p className="mt-1 font-semibold text-white">{preflight.status === "ready_at_observation" ? "Ready at observation" : preflight.status === "offline_ready_for_external_setup" ? "Offline foundation ready" : "Blocked"}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Passed gates</p><p className="mt-1 font-semibold text-white">{preflight.summary.passedGates}/{preflight.summary.totalGates}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Ready slots</p><p className="mt-1 font-semibold text-white">{preflight.summary.readySlots}/{preflight.summary.requiredSlots}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Generation / spend</p><p className="mt-1 font-semibold text-amber-200">Disabled / unauthorized</p></div>
          </div>
          <p className="text-sm text-zinc-300">Blocked: {preflight.summary.blockedGates} · External setup pending: {preflight.summary.pendingExternalGates} · Human decision pending: {preflight.summary.pendingHumanGates} · Unavailable: {preflight.summary.unavailableGates}</p>
          <ol className="grid gap-3 lg:grid-cols-2" aria-label="Fourteen launch preflight gates">
            {preflight.gates.map((gate, index) => {
              const action = launchNextActions[gate.nextActionCode];
              return (
                <li key={gate.code} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start gap-3">
                    <LaunchGateIcon state={gate.state} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white"><span className="mr-2 text-xs text-zinc-500">{index + 1}/14</span>{launchGateLabels[gate.code]}</p>
                      <p className="mt-1 text-sm text-zinc-300">{launchGateStateLabels[gate.state]} · {gate.readySlots}/{gate.requiredSlots} slots ready</p>
                      <p className="mt-2 text-sm text-zinc-400">Next: {action.href ? <a href={action.href} className="text-violet-200 underline underline-offset-4 hover:text-white">{action.label}</a> : action.label}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

const sandboxGateLabels: Record<SandboxReadinessGate["code"], string> = {
  batch_approval: "Approved batch",
  slot_binding: "Selected slot binding",
  source_eligibility: "Source eligibility",
  provider_binding_local: "Local provider binding",
  governance_coverage: "Governance coverage",
  external_requirements: "External requirements",
};

const sandboxGateStateLabels: Record<SandboxReadinessGate["state"], string> = {
  passed: "Passed",
  blocked: "Blocked",
  pending_external: "External step pending",
};

const externalRequirementLabels = {
  provider_live_verification: "Live provider verification",
  maximum_quote: "Maximum cost quote",
  human_sandbox_cost_approval: "Human sandbox cost approval",
  owned_storage_readiness: "Owned storage readiness",
  callback_readiness: "Callback readiness",
} as const;

function SandboxReadinessPanel({ batch }: { batch: ProductionBatch }) {
  const approvedSlots = batch.groups.flatMap((group) => group.items.flatMap((item) =>
    item.preparation === "draft" && item.script.status === "approved"
      ? [{ group, item }]
      : []));
  const [selectedSlotId, setSelectedSlotId] = useState(approvedSlots[0]?.item.slotId ?? "");
  const approvedSlotsKey = approvedSlots.map(({ item }) => item.slotId).join(":");
  useEffect(() => {
    if (!approvedSlots.some(({ item }) => item.slotId === selectedSlotId)) {
      setSelectedSlotId(approvedSlots[0]?.item.slotId ?? "");
    }
  }, [approvedSlotsKey, selectedSlotId]);
  const selectedSlot = approvedSlots.find(({ item }) => item.slotId === selectedSlotId);
  const query = useProductionBatchSandboxReadiness({
    planId: batch.planId,
    batchId: batch.batchId,
    slotId: selectedSlotId,
    enabled: batch.status === "approved_ready" && Boolean(selectedSlot),
  });
  const packet = query.data?.sandboxReadiness;

  return (
    <section id="one-video-sandbox-readiness" aria-labelledby="one-video-sandbox-readiness-heading" className="space-y-4 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.05] p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">One-video sandbox readiness · read-only</p>
          <h3 id="one-video-sandbox-readiness-heading" className="mt-2 text-lg font-semibold text-white">Inspect one approved public slot</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-300">This packet previews one provider-neutral vertical video and its gates. It cannot contact a provider, start execution, create a render, reserve budget, or spend credits.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0 border-white/10 bg-white/5"
          disabled={!selectedSlot || query.isFetching}
          aria-busy={query.isFetching}
          onClick={() => query.refetch().then(() => undefined)}
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          Refresh readiness packet
        </Button>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="rounded-lg border border-amber-300/30 bg-amber-400/[0.09] p-4 text-sm leading-6 text-amber-100">
        <span className="font-semibold">No spend · No provider call · No execution.</span> Connecting the provider API remains a separate, later approval step.
      </div>

      <div className="max-w-2xl">
        <label htmlFor="sandbox-approved-slot" className="text-sm font-medium text-zinc-100">Approved public slot</label>
        <p id="sandbox-approved-slot-help" className="mt-1 text-xs text-zinc-400">Selection changes only the credentialed read-only packet below.</p>
        <select
          id="sandbox-approved-slot"
          value={selectedSlotId}
          onChange={(event) => setSelectedSlotId(event.currentTarget.value)}
          aria-describedby="sandbox-approved-slot-help"
          className="mt-2 min-h-11 w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          {approvedSlots.map(({ group, item }) => (
            <option key={item.slotId} value={item.slotId}>{group.creatorName} · Video {item.videoNumber} · {item.script.title}</option>
          ))}
        </select>
      </div>

      {query.isFetching && !query.isLoading && <p role="status" aria-live="polite" className="text-sm text-cyan-100">Refreshing the selected slot packet…</p>}
      {query.isLoading ? (
        <LoadingPanel label="Loading the read-only sandbox readiness packet" />
      ) : query.isError ? (
        <ErrorPanel message={query.error.message} onRetry={() => query.refetch().then(() => undefined)} />
      ) : packet ? (
        <div className="space-y-4" aria-live="polite" aria-atomic="true">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <div className="mx-auto flex aspect-[9/16] w-full max-w-[240px] flex-col justify-between rounded-2xl border border-cyan-200/25 bg-gradient-to-b from-cyan-400/15 to-black/30 p-4 shadow-inner" aria-label="Vertical 9 by 16 video preview">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Vertical · 9:16</p><p className="mt-3 text-lg font-semibold text-white">{packet.preview.creatorName}</p><p className="mt-1 text-sm text-zinc-300">Video {packet.preview.videoNumber}</p></div>
              <div><p className="text-xs uppercase tracking-wide text-zinc-500">Hook preview</p><p className="mt-2 text-sm leading-6 text-zinc-100">{packet.preview.script.hook}</p></div>
            </div>
            <dl className="grid content-start gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-zinc-500">Source</dt><dd className="mt-1 text-zinc-100">{packet.preview.source.title} · {packet.preview.source.category.replaceAll("_", " ")}</dd></div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-zinc-500">Video title</dt><dd className="mt-1 text-zinc-100">{packet.preview.script.title}</dd></div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3"><dt className="text-xs uppercase tracking-wide text-zinc-500">Angle</dt><dd className="mt-1 text-zinc-100">{packet.preview.script.angle}</dd></div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3"><dt className="text-xs uppercase tracking-wide text-zinc-500">Call to action</dt><dd className="mt-1 text-zinc-100">{packet.preview.script.cta}</dd></div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-zinc-500">Approved script</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-zinc-100">{packet.preview.script.script}</dd></div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-zinc-500">Caption</dt><dd className="mt-1 whitespace-pre-wrap text-zinc-100">{packet.preview.script.caption}</dd></div>
            </dl>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Packet status</p><p className="mt-1 font-semibold text-white">{packet.status === "locally_ready_for_external_sandbox" ? "Locally ready" : "Blocked"}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Passed gates</p><p className="mt-1 font-semibold text-white">{packet.summary.passedGates}/{packet.summary.totalGates}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Provider / spend</p><p className="mt-1 font-semibold text-amber-200">Not called / unauthorized</p></div>
          </div>

          <ol className="grid gap-3 lg:grid-cols-2" aria-label="Six one-video sandbox readiness gates">
            {packet.gates.map((gate, index) => (
              <li key={gate.code} className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="flex items-start gap-3">
                  {gate.state === "passed" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" /> : gate.state === "blocked" ? <AlertCircle className="h-5 w-5 shrink-0 text-red-300" aria-hidden="true" /> : <Clock3 className="h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" />}
                  <div><p className="font-medium text-white"><span className="mr-2 text-xs text-zinc-500">{index + 1}/6</span>{sandboxGateLabels[gate.code]}</p><p className="mt-1 text-sm text-zinc-300">{sandboxGateStateLabels[gate.state]}</p></div>
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-lg border border-amber-300/20 bg-amber-400/[0.06] p-4">
            <h4 className="font-medium text-amber-100">Required external steps — not performed here</h4>
            <ul className="mt-2 flex flex-wrap gap-2 text-xs">
              {packet.externalRequirements.map((requirement) => <li key={requirement.code} className="rounded-full border border-amber-200/20 px-3 py-1.5 text-amber-100">{externalRequirementLabels[requirement.code]}</li>)}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

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

export function approvalResultMatchesBatch(
  approval: ProductionBatch | undefined,
  batch: ProductionBatch | undefined,
): boolean {
  return Boolean(
    approval
    && batch
    && approval.status === "approved_ready"
    && batch.status === "approved_ready"
    && approval.planId === batch.planId
    && approval.batchId === batch.batchId
    && approval.preparedAt === batch.preparedAt
    && approval.approvedAt === batch.approvedAt,
  );
}

export function ProductionBatchWorkbench() {
  const batchQuery = useProductionBatch();
  const prepare = usePrepareProductionBatchScripts();
  const approve = useApproveProductionBatchScripts();
  const [localError, setLocalError] = useState("");
  const [confirmedMemberIds, setConfirmedMemberIds] = useState<string[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);
  const attemptRef = useRef<string | undefined>(undefined);
  const approvalAttemptRef = useRef<string | undefined>(undefined);
  const reviewedBatchRef = useRef<string | undefined>(undefined);
  const batch = batchQuery.data?.batch;
  const approvalMatchesCurrentBatch = approve.isSuccess
    && approvalResultMatchesBatch(approve.data.batch, batch);

  useEffect(() => {
    const identity = batch
      ? `${batch.planId}:${batch.batchId}:${batch.status}:${batch.preparedAt ?? "unprepared"}`
      : undefined;
    const ownApprovalTransition = Boolean(
      batch
      && batch.status === "approved_ready"
      && (
        (approve.isPending
          && approve.variables.planId === batch.planId
          && approve.variables.input.expectedBatchId === batch.batchId)
        || approvalMatchesCurrentBatch
      ),
    );
    if (reviewedBatchRef.current && reviewedBatchRef.current !== identity) {
      setConfirmedMemberIds([]);
      approvalAttemptRef.current = undefined;
      if (!ownApprovalTransition) approve.reset();
    }
    reviewedBatchRef.current = identity;
  }, [
    approve.data?.batch.approvedAt,
    approve.data?.batch.batchId,
    approve.data?.batch.planId,
    approve.data?.batch.preparedAt,
    approve.isPending,
    approve.isSuccess,
    approve.variables?.input.expectedBatchId,
    approve.variables?.planId,
    approvalMatchesCurrentBatch,
    batch?.approvedAt,
    batch?.batchId,
    batch?.planId,
    batch?.preparedAt,
    batch?.status,
  ]);

  useEffect(() => {
    if (prepare.isSuccess) {
      attemptRef.current = undefined;
      resultRef.current?.focus();
    }
  }, [prepare.isSuccess]);

  useEffect(() => {
    if (approvalMatchesCurrentBatch) {
      approvalAttemptRef.current = undefined;
      setConfirmedMemberIds([]);
      resultRef.current?.focus();
    }
  }, [approvalMatchesCurrentBatch]);

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
  const confirmedMembers = new Set(confirmedMemberIds);
  const allCreatorsConfirmed = batch.groups.length > 0
    && batch.groups.every((group) => confirmedMembers.has(group.memberId));
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
  const confirmCreatorReview = (memberId: string, confirmed: boolean) => {
    setConfirmedMemberIds((current) => confirmed
      ? Array.from(new Set([...current, memberId]))
      : current.filter((id) => id !== memberId));
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
      {approvalMatchesCurrentBatch && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-100">All {batch.plannedVideoCount} scripts were approved as one batch. Governance, budget, sandbox validation, and human launch approval remain closed.</div>}

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
                {batch.status === "draft_ready" && (
                  <li className="rounded-lg border border-sky-300/20 bg-sky-400/[0.06] p-4">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-zinc-100">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5 shrink-0 accent-emerald-400"
                        checked={confirmedMembers.has(group.memberId)}
                        disabled={!group.items.every((item) => item.preparation === "draft" && item.script.selectedVariant !== undefined)}
                        onChange={(event) => confirmCreatorReview(group.memberId, event.currentTarget.checked)}
                      />
                      <span><span className="font-semibold">I reviewed all 10 complete scripts for {group.creatorName}.</span> This confirmation is only for atomic script approval; it grants no launch authority and authorizes no spending.</span>
                    </label>
                  </li>
                )}
              </ol>
            </details>
          </li>
        ))}
      </ul>

      {(batch.status === "draft_ready" || batch.status === "approved_ready") && (
        <div className="rounded-xl border border-sky-300/20 bg-sky-400/[0.06] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-white">Atomic script approval</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-300">This control appears after every creator and complete script. Approval covers this exact batch only; it does not create jobs, reserve budget, contact a provider, or grant launch authority.</p>
            </div>
          </div>
          {batch.status === "draft_ready" ? (
            <div className="mt-4 space-y-4">
              <div role="status" aria-live="polite" aria-atomic="true" className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
                Creator review progress: <span className="font-semibold text-white">{confirmedMemberIds.length}/{batch.groups.length}</span>
              </div>
              <p className="text-sm text-zinc-300">Confirm each creator at the end of their expanded 10-script review. All confirmations reset if the plan, batch, status, or preparation timestamp changes.</p>
              <Button
                type="button"
                className="min-h-11 bg-sky-300 text-zinc-950 hover:bg-sky-200"
                disabled={!allCreatorsConfirmed || !allReviewsAvailable || approve.isPending}
                aria-busy={approve.isPending}
                onClick={approveScripts}
              >
                {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {approve.isPending ? "Approving complete batch…" : `Approve all ${batch.plannedVideoCount} scripts`}
              </Button>
              {!allReviewsAvailable && <p role="alert" className="text-sm text-amber-200">Complete selected-variant content is required for every slot before this batch can be approved.</p>}
              {allReviewsAvailable && !allCreatorsConfirmed && <p className="text-sm text-amber-200">Review and confirm every creator before atomic approval is enabled.</p>}
            </div>
          ) : <p className="mt-4 text-sm font-medium text-emerald-200">Complete script batch approved. Launch and spend authority remain closed and are evaluated separately below.</p>}
        </div>
      )}

      {batch.status === "approved_ready" && (
        <SandboxReadinessPanel key={`${batch.planId}:${batch.batchId}`} batch={batch} />
      )}

      <LaunchPreflightPanel
        planId={batch.planId}
        batchId={batch.batchId}
        enabled={batch.status === "approved_ready"}
      />
    </section>
  );
}
