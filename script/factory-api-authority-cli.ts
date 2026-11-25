import { createHash } from "node:crypto";
import type { FactoryApiCheckpoint } from "../server/software-factory-api-budget";

// Pure helpers for the factory-ops API authority actions (status block, api-month-init, api-checkpoint).
// Public job logs: nothing here returns ids, keys, evidence text or connection details.

/** Quarantined News execution (docs/factory-api-budget-authority.md). Code-owned; never printed. */
const NEWS_EXECUTION_ID = "2763c249-cd43-4ead-b6a0-111f6d76715a";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Every spelling the hold can have in a ledger: raw id, its digest, or the Office reservation key. */
export function newsHoldNeedles(): string[] {
  const digest = sha256(NEWS_EXECUTION_ID);
  return [NEWS_EXECUTION_ID, digest, `office:${digest}`];
}

type HoldRow = { key?: unknown; status?: unknown; unknownEvidenceId?: unknown; settlementEvidenceId?: unknown };
const rowMatches = (row: HoldRow, needles: string[]) =>
  [row.key, row.unknownEvidenceId, row.settlementEvidenceId].some(v => typeof v === "string" && needles.some(n => v.includes(n)));

/** Booleans/counts only: is the News hold present in any shared-credit/API ledger, and is it still unknown? */
export function summarizeNewsHold(ledgers: Array<{ reservations?: unknown } | null | undefined>) {
  const needles = newsHoldNeedles();
  let found = 0, unknown = 0, settled = 0;
  for (const ledger of ledgers) {
    const rows = Array.isArray(ledger?.reservations) ? (ledger!.reservations as HoldRow[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || !rowMatches(row, needles)) continue;
      found++;
      if (row.status === "unknown") unknown++;
      if (row.status === "settled") settled++;
    }
  }
  return { found: found > 0, rows: found, stillUnknown: unknown > 0, settledRows: settled };
}

type BudgetStatus = { month: string; fixedMicroUsd: number; spentMicroUsd: number; reservedMicroUsd: number;
  remainingMicroUsd: number | null; configured: boolean; unknown: boolean; paidAdmissionReady: boolean; reason: string;
  reconciliationEvidenceSha256: string | null };
type ApiState = { checkpoints: Array<{ month: string; externalUnknownReservations: number }>; reservations: Array<{ status: string }> };

/** Shape the read-only authority block for `status`. */
export function shapeApiAuthority(input: { tablePresent: boolean; stateRowExists: boolean; monthInitialized: boolean;
  factoryUnknownJob: boolean; status: BudgetStatus; state: ApiState; newsHold: ReturnType<typeof summarizeNewsHold> }) {
  const { status, state } = input;
  return {
    tablePresent: input.tablePresent, stateRowExists: input.stateRowExists, month: status.month,
    monthInitialized: input.monthInitialized, checkpointPresent: state.checkpoints.some(c => c.month === status.month),
    checkpointCount: state.checkpoints.length, evidenceDigestPresent: status.reconciliationEvidenceSha256 !== null,
    fixedMicroUsd: status.fixedMicroUsd, spentMicroUsd: status.spentMicroUsd, reservedMicroUsd: status.reservedMicroUsd,
    remainingMicroUsd: status.remainingMicroUsd,
    unknownHolds: {
      apiReservations: state.reservations.filter(r => r.status === "unknown").length,
      externalCheckpoint: state.checkpoints.reduce((sum, c) => sum + c.externalUnknownReservations, 0),
      factoryJobUnknown: input.factoryUnknownJob,
    },
    unknown: status.unknown, paidAdmissionReady: status.paidAdmissionReady, reason: status.reason,
    newsExecutionHold: input.newsHold,
  };
}

/** Exact decimal USD -> integer microUSD (no floats). */
export function usdToMicro(raw: string, field: string): number {
  const text = raw.trim();
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new Error(`${field}_INVALID`);
  const micro = Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
  if (!Number.isSafeInteger(micro)) throw new Error(`${field}_INVALID`);
  return micro;
}

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
function flags(argv: string[], allowed: string[]) {
  const options: Record<string, string> = {};
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") { if (apply) throw new Error("ARGUMENT_INVALID"); apply = true; continue; }
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(options, match[1])) throw new Error("ARGUMENT_INVALID");
    options[match[1]] = match[2];
  }
  return { options, apply };
}
function requireCurrentMonth(month: string | undefined, now: Date) {
  if (!month || !monthRe.test(month)) throw new Error("MONTH_INVALID");
  if (month !== now.toISOString().slice(0, 7)) throw new Error("MONTH_NOT_CURRENT");
  return month;
}

/** api-month-init: explicit, immutable initializeMonth(owner, month, fixedCents). */
export function parseMonthInitArgs(argv: string[], now = new Date()) {
  const { options, apply } = flags(argv, ["month", "fixed-usd"]);
  const month = requireCurrentMonth(options.month, now);
  if (options["fixed-usd"] === undefined) throw new Error("FIXED_USD_REQUIRED");
  const micro = usdToMicro(options["fixed-usd"], "FIXED_USD");
  if (micro % 10_000 !== 0) throw new Error("FIXED_USD_SUB_CENT");
  const fixedCents = micro / 10_000;
  if (fixedCents > 10_000) throw new Error("FIXED_USD_OVER_LIMIT");
  return { month, fixedCents, apply };
}

/** api-checkpoint: builds the exact checkpointApiMonth input. Evidence text comes from env, never argv/logs. */
export function parseCheckpointArgs(argv: string[], evidenceText: string | undefined, now = new Date()) {
  const { options, apply } = flags(argv, ["month", "external-spent-usd", "external-reserved-usd", "external-unknown-count"]);
  const month = requireCurrentMonth(options.month, now);
  for (const field of ["external-spent-usd", "external-reserved-usd", "external-unknown-count"])
    if (options[field] === undefined || options[field].trim() === "") throw new Error(`${field.toUpperCase().replace(/-/g, "_")}_REQUIRED`);
  if (!/^\d{1,6}$/.test(options["external-unknown-count"].trim())) throw new Error("EXTERNAL_UNKNOWN_COUNT_INVALID");
  const evidence = (evidenceText ?? "").trim();
  if (evidence.length < 20 || evidence.length > 4000) throw new Error("EVIDENCE_INVALID");
  const checkpoint: FactoryApiCheckpoint = {
    month,
    evidenceSha256: sha256(evidence),
    reconciledAt: now.toISOString(),
    externalSpentMicroUsd: usdToMicro(options["external-spent-usd"], "EXTERNAL_SPENT_USD"),
    externalReservedMicroUsd: usdToMicro(options["external-reserved-usd"], "EXTERNAL_RESERVED_USD"),
    externalUnknownReservations: Number(options["external-unknown-count"].trim()),
    complete: true,
  };
  return { checkpoint, evidenceChars: evidence.length, apply };
}

/** Refusals checked before any write; mirrors the doc's News-hold rule and the store's own preconditions. */
export function checkpointRefusal(input: { checkpoint: FactoryApiCheckpoint; monthInitialized: boolean; factoryUnknownJob: boolean;
  existingCheckpoint: unknown; newsHold: ReturnType<typeof summarizeNewsHold> }): string | null {
  const { checkpoint } = input;
  if (!input.monthInitialized) return "FACTORY_MONTH_UNINITIALIZED";
  if (input.factoryUnknownJob) return "FACTORY_UNKNOWN_JOB_PRESENT";
  if (input.existingCheckpoint && JSON.stringify(input.existingCheckpoint) !== JSON.stringify(checkpoint)) return "FACTORY_API_CHECKPOINT_IMMUTABLE";
  if (input.newsHold.stillUnknown && (checkpoint.externalUnknownReservations < 1 || checkpoint.externalReservedMicroUsd < 1))
    return "NEWS_HOLD_MUST_BE_RECORDED_AS_EXTERNAL_UNKNOWN";
  if (checkpoint.externalUnknownReservations > 0 && checkpoint.externalReservedMicroUsd < 1) return "EXTERNAL_UNKNOWN_REQUIRES_RESERVED_AMOUNT";
  return null;
}

/** What a dry run (or apply) prints: amounts, counts and the digest only. */
export function describeCheckpoint(checkpoint: FactoryApiCheckpoint, evidenceChars: number) {
  return { month: checkpoint.month, reconciledAt: checkpoint.reconciledAt, evidenceSha256: checkpoint.evidenceSha256, evidenceChars,
    externalSpentMicroUsd: checkpoint.externalSpentMicroUsd, externalReservedMicroUsd: checkpoint.externalReservedMicroUsd,
    externalUnknownReservations: checkpoint.externalUnknownReservations, complete: true,
    blocksPaidAdmissionPermanently: checkpoint.externalUnknownReservations > 0 };
}
