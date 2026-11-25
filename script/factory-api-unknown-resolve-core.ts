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
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Every spelling the hold can have in a ledger: raw id, its digest, or the Office reservation key. */
export function holdNeedles(holdId: string) {
  const digest = sha256(holdId);
  return [holdId, digest, `office:${digest}`];
}
const matches = (values: unknown[], needles: string[]) => values.some(v => typeof v === "string" && needles.some(n => v.includes(n)));

export function parseResolveArgs(argv: string[], evidenceText: string | undefined) {
  let apply = false, holdId: string | undefined;
  for (const arg of argv) {
    if (arg === "--apply" && !apply) { apply = true; continue; }
    const match = /^--hold-id=(.*)$/s.exec(arg);
    if (!match || holdId !== undefined) throw new Error("ARGUMENT_INVALID");
    holdId = match[1].trim();
  }
  if (!holdId) holdId = NEWS_EXECUTION_ID;
  if (!identifier.test(holdId) || holdId.length < 8) throw new Error("HOLD_ID_INVALID");
  const evidence = (evidenceText ?? "").trim();
  if (evidence.length < 20 || evidence.length > 4000) throw new Error("EVIDENCE_INVALID");
  return { holdId, apply, evidenceSha256: sha256(evidence), evidenceChars: evidence.length };
}

export type ResolutionStep =
  | { ledger: "shared-credit"; key: string; settleMicroUsd: number }
  | { ledger: "api-reservation"; reservationKey: string; settleMicroUsd: number }
  | { ledger: "external-checkpoint"; checkpointMonth: string; settleMicroUsd: number };

/** Finds where the hold actually lives and what a conservative resolution would append. Writes nothing. */
export function planUnknownResolution(input: { holdId: string; shared: SharedCreditState | null; api: FactoryApiState }) {
  const needles = holdNeedles(input.holdId), holdSha256 = sha256(input.holdId);
  const sharedRows = (input.shared?.reservations ?? []).filter(r => matches([r.key, r.unknownEvidenceId, r.settlementEvidenceId], needles));
  const apiRows = input.api.reservations.filter(r => matches([r.key], needles));
  const resolutions = input.api.resolutions ?? [];
  const base = { holdSha256, steps: [] as ResolutionStep[], refusal: null as string | null, alreadyResolved: false,
    found: { sharedCredit: sharedRows.map(r => r.status), apiReservation: apiRows.map(r => r.status),
      externalReceipt: resolutions.some(r => r.holdSha256 === holdSha256) } };
  if (sharedRows.length > 1 || apiRows.length > 1) return { ...base, refusal: "HOLD_AMBIGUOUS" };
  const shared = sharedRows[0], api = apiRows[0], steps: ResolutionStep[] = [];
  if (shared?.status === "unknown") steps.push({ ledger: "shared-credit", key: shared.key, settleMicroUsd: shared.reservedMicroUsd });
  if (api) {
    const done = resolutions.some(r => r.reservationKey === api.key);
    if (api.status === "unknown" && !done) steps.push({ ledger: "api-reservation", reservationKey: api.key,
      settleMicroUsd: Math.max(api.maximumMicroUsd, api.reportedOverrunMicroUsd ?? 0) });
  } else if (shared && !resolutions.some(r => r.holdSha256 === holdSha256)) {
    // Outside the API ledger the hold can only be an external checkpoint liability recorded while it was
    // unknown (shared row created before that reconciliation). Its exact amount comes from the shared row.
    const open = input.api.checkpoints.filter(c => c.reconciledAt >= shared.createdAt &&
      c.externalUnknownReservations > resolutions.filter(r => r.source === "external-checkpoint" && r.checkpointMonth === c.month).length)
      .sort((a, b) => a.month.localeCompare(b.month))[0];
    const stillUnknownOrConservative = shared.status === "unknown" || (shared.status === "settled" && shared.reconciled === true && shared.actualMicroUsd === shared.reservedMicroUsd);
    if (open && stillUnknownOrConservative) {
      if (shared.reservedMicroUsd > open.externalReservedMicroUsd) return { ...base, refusal: "EXTERNAL_RESERVED_BELOW_HOLD" };
      steps.push({ ledger: "external-checkpoint", checkpointMonth: open.month, settleMicroUsd: shared.reservedMicroUsd });
    }
  }
  if (steps.length) return { ...base, steps };
  const anyUnknownSeen = shared?.status === "unknown" || api?.status === "unknown";
  const resolvedBefore = base.found.externalReceipt || (!!shared && shared.status === "settled" && shared.reconciled === true);
  if (!anyUnknownSeen && resolvedBefore) return { ...base, alreadyResolved: true };
  return { ...base, refusal: shared || api ? "HOLD_NOT_UNKNOWN" : "HOLD_NOT_FOUND" };
}

/** Public view of a plan: ledgers, amounts and digests only (no keys or ids). */
export function describePlan(plan: ReturnType<typeof planUnknownResolution>) {
  return { holdSha256: plan.holdSha256, refusal: plan.refusal, alreadyResolved: plan.alreadyResolved, found: plan.found, policy: RESOLUTION_POLICY,
    steps: plan.steps.map(s => ({ ledger: s.ledger, settleMicroUsd: s.settleMicroUsd, ...(s.ledger === "external-checkpoint" ? { checkpointMonth: s.checkpointMonth } : {}) })) };
}

export type ResolutionReceipt = { event: "factory_api_unknown_resolution"; holdSha256: string; ledger: ResolutionStep["ledger"];
  settledMicroUsd: number; evidenceSha256: string; resolvedAt: string; policy: typeof RESOLUTION_POLICY };

/** Dry run (apply=false) calls nothing. Apply appends each receipt BEFORE its settlement, then settles
 * through the ledger's own reconciliation path or the API authority's append-only resolution. */
export async function runUnknownResolution(plan: ReturnType<typeof planUnknownResolution>, input: {
  apply: boolean; evidenceSha256: string; at: string;
  appendReceipt: (receipt: ResolutionReceipt) => Promise<void>;
  settleShared: (step: { key: string; actualMicroUsd: number; evidenceId: string }) => Promise<void>;
  resolveApi: (receipt: { holdSha256: string; source: "api-reservation" | "external-checkpoint"; reservationKey?: string;
    checkpointMonth?: string; settledMicroUsd: number; evidenceSha256: string }) => Promise<unknown>;
}) {
  if (!input.apply || plan.refusal || !plan.steps.length) return { applied: false, ...describePlan(plan) };
  for (const step of plan.steps) {
    await input.appendReceipt({ event: "factory_api_unknown_resolution", holdSha256: plan.holdSha256, ledger: step.ledger,
      settledMicroUsd: step.settleMicroUsd, evidenceSha256: input.evidenceSha256, resolvedAt: input.at, policy: RESOLUTION_POLICY });
    if (step.ledger === "shared-credit")
      await input.settleShared({ key: step.key, actualMicroUsd: step.settleMicroUsd, evidenceId: `unknown-resolution:${input.evidenceSha256.slice(0, 48)}` });
    else await input.resolveApi({ holdSha256: plan.holdSha256, source: step.ledger, settledMicroUsd: step.settleMicroUsd, evidenceSha256: input.evidenceSha256,
      ...(step.ledger === "api-reservation" ? { reservationKey: step.reservationKey } : { checkpointMonth: step.checkpointMonth }) });
  }
  return { applied: true, ...describePlan(plan) };
}
