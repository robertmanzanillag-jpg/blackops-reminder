import { createHash } from "node:crypto";
import type { FactoryApiState } from "../server/software-factory-api-budget";
import type { SharedCreditState } from "../server/shared-openai-credit-ledger";

// Pure planning for the factory-ops `api-unknown-resolve` action (docs/factory-api-budget-authority.md).
// A reviewed, append-only resolution of ONE code-owned or validated unknown hold. It settles the hold
// CONSERVATIVELY at its full reserved amount (assumed spent). Never releases, voids, refunds or replays.
// Public job logs: plans carry amounts, statuses and SHA-256 digests only, never ids, keys or evidence text.

/** Quarantined News execution (docs/factory-api-budget-authority.md). Code-owned; never printed. */
export const NEWS_EXECUTION_ID = "2763c249-cd43-4ead-b6a0-111f6d76715a";
export const RESOLUTION_POLICY = "conservative-full-reserved-amount" as const;
/** Orphan mode (`--hold-id=orphan-jobs`): unknown Factory jobs with NO API-ledger reservation at all,
 * settled at $0 on owner evidence (e.g. a guard threw before any provider dispatch). */
export const ORPHAN_JOBS_MODE = "orphan-jobs" as const;
export const ORPHAN_POLICY = "owner-evidence-orphan-job-zero-cost" as const;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Every spelling the hold can have in a ledger: raw id, its digest, or the Office reservation key. */
export function holdNeedles(holdId: string) {
  const digest = sha256(holdId);
  return [holdId, digest, `office:${digest}`];
}
const matches = (values: unknown[], needles: string[]) => values.some(v => typeof v === "string" && needles.some(n => v.includes(n)));

export function parseResolveArgs(argv: string[], evidenceText: string | undefined) {
  let apply = false, holdId: string | undefined, externalUnknownCount: number | undefined;
  for (const arg of argv) {
    if (arg === "--apply" && !apply) { apply = true; continue; }
    const ext = /^--external-unknown-count=(.*)$/s.exec(arg);
    if (ext && externalUnknownCount === undefined) {
      const raw = ext[1].trim();
      if (raw === "") continue;
      if (!/^\d{1,6}$/.test(raw)) throw new Error("EXTERNAL_UNKNOWN_COUNT_INVALID");
      externalUnknownCount = Number(raw); continue;
    }
    const match = /^--hold-id=(.*)$/s.exec(arg);
    if (!match || holdId !== undefined) throw new Error("ARGUMENT_INVALID");
    holdId = match[1].trim();
  }
  // No hold id (or "news"): explicit modes. Empty = every unknown API-ledger reservation.
  if (holdId === "news") holdId = NEWS_EXECUTION_ID;
  const orphanJobs = holdId === ORPHAN_JOBS_MODE;
  if (orphanJobs) holdId = undefined;
  if (!orphanJobs && holdId !== undefined && holdId !== "" && (!identifier.test(holdId) || holdId.length < 8)) throw new Error("HOLD_ID_INVALID");
  if (holdId === "") holdId = undefined;
  const evidence = (evidenceText ?? "").trim();
  if (evidence.length < 20 || evidence.length > 4000) throw new Error("EVIDENCE_INVALID");
  // Orphan settlement at $0 needs the owner's explicit statement that nothing external is unknown.
  if (orphanJobs && externalUnknownCount !== 0) throw new Error("ORPHAN_REQUIRES_EXTERNAL_UNKNOWN_ZERO");
  return { holdId, orphanJobs, externalUnknownCount, apply, evidenceSha256: sha256(evidence), evidenceChars: evidence.length };
}

export type ResolutionStep =
  | { ledger: "shared-credit"; holdSha256: string; key: string; settleMicroUsd: number }
  | { ledger: "api-reservation"; holdSha256: string; reservationKey: string; settleMicroUsd: number }
  | { ledger: "external-checkpoint"; holdSha256: string; checkpointMonth: string; settleMicroUsd: number }
  | { ledger: "factory-job"; holdSha256: string; jobId: string; costCents: number; settleMicroUsd: number; orphan?: true };
/** Unknown Factory job as read from software_factory_jobs (id + its own cents reservation). */
export type UnknownFactoryJob = { id: string; reservedCents: number };

const fullAmount = (r: FactoryApiState["reservations"][number]) => Math.max(r.maximumMicroUsd, r.reportedOverrunMicroUsd ?? 0);

/** Unknown Factory jobs whose API spend is tied (reservation.parent.jobId) to a reservation resolved
 * now or before. A job is resolved only when EVERY child is settled or carries a resolution, at the
 * conservative cost ceil(sum of children microUSD / 10000) cents; never below what children consumed. */
function jobSteps(api: FactoryApiState, planned: Map<string, number>, jobs: UnknownFactoryJob[]) {
  const resolved = new Map((api.resolutions ?? []).filter(r => r.source === "api-reservation").map(r => [r.reservationKey!, r.settledMicroUsd]));
  const steps: ResolutionStep[] = []; let refusal: string | null = null, untied = 0;
  for (const job of jobs) {
    const children = api.reservations.filter(r => r.parent?.jobId === job.id);
    const tied = children.some(r => planned.has(r.key) || resolved.has(r.key));
    if (!tied) { untied++; continue; }
    const amounts = children.map(r => r.status === "settled" ? r.actualMicroUsd! : planned.get(r.key) ?? resolved.get(r.key));
    if (amounts.some(a => a === undefined)) { refusal ??= "JOB_CHILD_UNCONFIRMED"; continue; }
    const micro = amounts.reduce((a, b) => a! + b!, 0)!, costCents = Math.ceil(micro / 10_000);
    if (costCents > job.reservedCents) { refusal ??= "JOB_COST_EXCEEDS_RESERVATION"; continue; }
    steps.push({ ledger: "factory-job", holdSha256: sha256(`factory-job:${job.id}`), jobId: job.id, costCents, settleMicroUsd: micro });
  }
  return { steps, refusal, untied };
}

/** Default mode: every unresolved `unknown` API-ledger reservation, settled at its FULL reserved amount,
 * plus the unknown Factory jobs tied to them. Rows in any other status are never touched. */
export function planAllApiUnknown(input: { api: FactoryApiState; jobs: UnknownFactoryJob[] }) {
  const done = new Set((input.api.resolutions ?? []).map(r => r.reservationKey).filter(Boolean));
  const steps: ResolutionStep[] = input.api.reservations.filter(r => r.status === "unknown" && !done.has(r.key))
    .map(r => ({ ledger: "api-reservation" as const, holdSha256: sha256(r.key), reservationKey: r.key, settleMicroUsd: fullAmount(r) }));
  const planned = new Map(steps.map(s => [(s as { reservationKey: string }).reservationKey, s.settleMicroUsd]));
  const jobs = jobSteps(input.api, planned, input.jobs);
  const all = [...steps, ...jobs.steps];
  return { holdSha256: null as string | null, steps: jobs.refusal ? [] : all, refusal: jobs.refusal, alreadyResolved: !all.length && !jobs.refusal && done.size > 0,
    found: { apiUnknownUnresolved: steps.length, unknownJobs: input.jobs.length, unknownJobsNotTiedToApiLedger: jobs.untied } };
}

/** Orphan mode: unknown Factory jobs that NO API-ledger reservation references (any status, as parent),
 * settled at $0 and releasing their cents reservation. Refuses everything if any API-ledger reservation is
 * unknown/unresolved or any checkpoint still carries an unresolved external unknown: those go through the
 * conservative path first. Jobs referenced by any reservation are never touched here. */
export function planOrphanJobs(input: { api: FactoryApiState; jobs: UnknownFactoryJob[]; externalUnknownCount: number | undefined }) {
  const resolutions = input.api.resolutions ?? [];
  const done = new Set(resolutions.map(r => r.reservationKey).filter(Boolean));
  const apiUnknown = input.api.reservations.filter(r => r.status === "unknown" && !done.has(r.key)).length;
  const externalOpen = input.api.checkpoints.reduce((n, c) => n + Math.max(0, c.externalUnknownReservations -
    resolutions.filter(r => r.source === "external-checkpoint" && r.checkpointMonth === c.month).length), 0);
  const referenced = new Set(input.api.reservations.map(r => r.parent?.jobId).filter((id): id is string => typeof id === "string"));
  const orphans = input.jobs.filter(j => !referenced.has(j.id));
  const found = { unknownJobs: input.jobs.length, orphanJobs: orphans.length, jobsWithApiReservation: input.jobs.length - orphans.length,
    apiUnknownUnresolved: apiUnknown, externalUnknownOpen: externalOpen };
  const base = { holdSha256: null as string | null, steps: [] as ResolutionStep[], refusal: null as string | null, alreadyResolved: false, found, policy: ORPHAN_POLICY };
  if (input.externalUnknownCount !== 0) return { ...base, refusal: "ORPHAN_REQUIRES_EXTERNAL_UNKNOWN_ZERO" };
  if (apiUnknown > 0) return { ...base, refusal: "ORPHAN_API_UNKNOWN_PRESENT" };
  if (externalOpen > 0) return { ...base, refusal: "ORPHAN_EXTERNAL_UNKNOWN_PRESENT" };
  if (!orphans.length) return { ...base, alreadyResolved: true };
  return { ...base, steps: orphans.map(j => ({ ledger: "factory-job" as const, holdSha256: sha256(`factory-job:${j.id}`), jobId: j.id,
    costCents: 0, settleMicroUsd: 0, orphan: true as const, releaseCents: j.reservedCents })) as ResolutionStep[] };
}

/** Finds where the hold actually lives and what a conservative resolution would append. Writes nothing. */
export function planUnknownResolution(input: { holdId: string; shared: SharedCreditState | null; api: FactoryApiState; jobs?: UnknownFactoryJob[] }) {
  const needles = holdNeedles(input.holdId), holdSha256 = sha256(input.holdId);
  const sharedRows = (input.shared?.reservations ?? []).filter(r => matches([r.key, r.unknownEvidenceId, r.settlementEvidenceId], needles));
  const apiRows = input.api.reservations.filter(r => matches([r.key], needles));
  const resolutions = input.api.resolutions ?? [];
  const base = { holdSha256: holdSha256 as string | null, steps: [] as ResolutionStep[], refusal: null as string | null, alreadyResolved: false,
    found: { sharedCredit: sharedRows.map(r => r.status), apiReservation: apiRows.map(r => r.status),
      externalReceipt: resolutions.some(r => r.holdSha256 === holdSha256) } };
  if (sharedRows.length > 1 || apiRows.length > 1) return { ...base, refusal: "HOLD_AMBIGUOUS" };
  const shared = sharedRows[0], api = apiRows[0], steps: ResolutionStep[] = [];
  if (shared?.status === "unknown") steps.push({ ledger: "shared-credit", holdSha256, key: shared.key, settleMicroUsd: shared.reservedMicroUsd });
  if (api) {
    const done = resolutions.some(r => r.reservationKey === api.key);
    if (api.status === "unknown" && !done) steps.push({ ledger: "api-reservation", holdSha256, reservationKey: api.key, settleMicroUsd: fullAmount(api) });
  } else if (shared && !resolutions.some(r => r.holdSha256 === holdSha256)) {
    // Outside the API ledger the hold can only be an external checkpoint liability recorded while it was
    // unknown (shared row created before that reconciliation). Its exact amount comes from the shared row.
    const open = input.api.checkpoints.filter(c => c.reconciledAt >= shared.createdAt &&
      c.externalUnknownReservations > resolutions.filter(r => r.source === "external-checkpoint" && r.checkpointMonth === c.month).length)
      .sort((a, b) => a.month.localeCompare(b.month))[0];
    const stillUnknownOrConservative = shared.status === "unknown" || (shared.status === "settled" && shared.reconciled === true && shared.actualMicroUsd === shared.reservedMicroUsd);
    if (open && stillUnknownOrConservative) {
      if (shared.reservedMicroUsd > open.externalReservedMicroUsd) return { ...base, refusal: "EXTERNAL_RESERVED_BELOW_HOLD" };
      steps.push({ ledger: "external-checkpoint", holdSha256, checkpointMonth: open.month, settleMicroUsd: shared.reservedMicroUsd });
    }
  }
  if (api && input.jobs?.length) {
    const planned = new Map(steps.filter(s => s.ledger === "api-reservation").map(s => [(s as { reservationKey: string }).reservationKey, s.settleMicroUsd]));
    const jobs = jobSteps(input.api, planned, input.jobs);
    if (jobs.refusal) return { ...base, refusal: jobs.refusal };
    steps.push(...jobs.steps);
  }
  if (steps.length) return { ...base, steps };
  const anyUnknownSeen = shared?.status === "unknown" || api?.status === "unknown";
  const resolvedBefore = base.found.externalReceipt || (!!shared && shared.status === "settled" && shared.reconciled === true);
  if (!anyUnknownSeen && resolvedBefore) return { ...base, alreadyResolved: true };
  return { ...base, refusal: shared || api ? "HOLD_NOT_UNKNOWN" : "HOLD_NOT_FOUND" };
}

/** Public view of a plan: ledgers, amounts and digests only (no keys or ids). */
type Plan = { holdSha256: string | null; steps: ResolutionStep[]; refusal: string | null; alreadyResolved: boolean; found: Record<string, unknown>; policy?: ResolutionPolicy };
type ResolutionPolicy = typeof RESOLUTION_POLICY | typeof ORPHAN_POLICY;
export function describePlan(plan: Plan) {
  return { holdSha256: plan.holdSha256, refusal: plan.refusal, alreadyResolved: plan.alreadyResolved, found: plan.found, policy: plan.policy ?? RESOLUTION_POLICY,
    steps: plan.steps.map(s => ({ ledger: s.ledger, holdSha256: s.holdSha256, settleMicroUsd: s.settleMicroUsd,
      ...(s.ledger === "external-checkpoint" ? { checkpointMonth: s.checkpointMonth } : {}),
      ...(s.ledger === "factory-job" ? { costCents: s.costCents, terminalStatus: "failed",
        ...(s.orphan ? { orphan: true, releaseReservedCents: (s as { releaseCents?: number }).releaseCents } : {}) } : {}) })) };
}

export type ResolutionReceipt = { event: "factory_api_unknown_resolution"; holdSha256: string; ledger: ResolutionStep["ledger"];
  settledMicroUsd: number; evidenceSha256: string; resolvedAt: string; policy: ResolutionPolicy };

/** Dry run (apply=false) calls nothing. Apply appends each receipt BEFORE its settlement, then settles
 * through the ledger's own reconciliation path or the API authority's append-only resolution. */
export async function runUnknownResolution(plan: Plan, input: {
  apply: boolean; evidenceSha256: string; at: string;
  appendReceipt: (receipt: ResolutionReceipt) => Promise<void>;
  settleShared: (step: { key: string; actualMicroUsd: number; evidenceId: string }) => Promise<void>;
  resolveApi: (receipt: { holdSha256: string; source: "api-reservation" | "external-checkpoint"; reservationKey?: string;
    checkpointMonth?: string; settledMicroUsd: number; evidenceSha256: string }) => Promise<unknown>;
  /** Existing operator reconciliation: unknown job -> failed at the given cost (executionStopped). */
  reconcileJob?: (step: { jobId: string; actualCostCents: number; reason: string }) => Promise<unknown>;
}) {
  if (input.apply && plan.steps.some(s => s.ledger === "factory-job") && !input.reconcileJob) throw Error("JOB_RECONCILER_REQUIRED");
  if (!input.apply || plan.refusal || !plan.steps.length) return { applied: false, ...describePlan(plan) };
  for (const step of plan.steps) {
    await input.appendReceipt({ event: "factory_api_unknown_resolution", holdSha256: step.holdSha256, ledger: step.ledger,
      settledMicroUsd: step.settleMicroUsd, evidenceSha256: input.evidenceSha256, resolvedAt: input.at, policy: plan.policy ?? RESOLUTION_POLICY });
    if (step.ledger === "shared-credit")
      await input.settleShared({ key: step.key, actualMicroUsd: step.settleMicroUsd, evidenceId: `unknown-resolution:${input.evidenceSha256.slice(0, 48)}` });
    else if (step.ledger === "factory-job")
      await input.reconcileJob!({ jobId: step.jobId, actualCostCents: step.costCents,
        reason: `api-unknown-resolve: ${plan.policy ?? RESOLUTION_POLICY}; evidence sha256 ${input.evidenceSha256}` });
    else await input.resolveApi({ holdSha256: step.holdSha256, source: step.ledger, settledMicroUsd: step.settleMicroUsd, evidenceSha256: input.evidenceSha256,
      ...(step.ledger === "api-reservation" ? { reservationKey: step.reservationKey } : { checkpointMonth: step.checkpointMonth }) });
  }
  return { applied: true, ...describePlan(plan) };
}
