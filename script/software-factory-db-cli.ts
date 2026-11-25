// Pure helpers shared by script/software-factory-migrate.ts and script/software-factory-status.ts.
// No database access, no env-file loading and no logging here so they can be unit tested.
import { createHash } from "node:crypto";
import { createSoftwareFactorySchemaSql } from "../server/software-factory-store";
import type { SharedCreditState } from "../server/shared-openai-credit-ledger";
import { summarize } from "./shared-credit-grant";

const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Every table created by the prepared factory schema, derived from the SQL itself so it never drifts. */
export function factoryTableNames(sql = createSoftwareFactorySchemaSql()): string[] {
  const names = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi)].map(match => match[1]);
  return [...new Set(names)];
}

export function parseMigrateArgs(argv: string[]): { apply: boolean } {
  if (argv.some(arg => arg !== "--apply") || argv.length > 1) throw new Error("ARGUMENT_INVALID");
  return { apply: argv.includes("--apply") };
}

export function parseStatusArgs(argv: string[], env: Record<string, string | undefined> = process.env): { owner?: string; creditScope?: string } {
  const options: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--(owner|credit-scope)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw new Error("ARGUMENT_INVALID");
    options[match[1]] = match[2];
  }
  const owner = (options.owner ?? env.SOFTWARE_FACTORY_OWNER_ID ?? "").trim() || undefined;
  if (owner !== undefined && owner.length > 500) throw new Error("OWNER_INVALID");
  const creditScope = options["credit-scope"];
  if (creditScope !== undefined && !identifier.test(creditScope)) throw new Error("CREDIT_SCOPE_INVALID");
  return { owner, creditScope };
}

/** Never returns free text: own uppercase codes, CODE_<pg/system code>, CLASS_<ErrorName> or UNKNOWN. */
export function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return `CODE_${code.toUpperCase()}`;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(message)) return message;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(name)) return `CLASS_${name}`;
  }
  return "UNKNOWN";
}

/** Same derivation as the factory and council stores (sha256 of the owner id). */
export const ownerKeyFor = (owner: string) => createHash("sha256").update(owner).digest("hex");
export const creditLedgerOwner = (scope: string) => JSON.stringify(["shared-openai-credit-ledger-v1", scope]);
export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

export function shapeProjects(rows: Array<{ id: unknown; journeys: unknown }>) {
  return rows.map(row => ({
    id: String(row.id),
    journeys: Array.isArray(row.journeys) ? row.journeys.filter((item): item is string => typeof item === "string") : [],
  }));
}

export function shapeJobCounts(rows: Array<{ status: unknown; count: unknown }>) {
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[String(row.status)] = Number(row.count) || 0;
  const running = byStatus.running ?? 0, unknown = byStatus.unknown ?? 0;
  return { byStatus, running, unknown, attentionRequired: running > 0 || unknown > 0 };
}

/** Code-only reason for a stopped job. Earlier every reason that was not
 * exactly [A-Z0-9_:]{1,120} became "UNSPECIFIED", which hid real causes:
 * OpenAI rejections carry a lowercase provider code
 * (FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:insufficient_quota),
 * gate reasons are comma-joined, and long cause chains exceed 120 chars.
 * Free text is still never shown: only code-shaped segments survive. */
export function factoryStoppedReasonCode(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "FACTORY_REASON_NOT_RECORDED";
  if (typeof raw !== "string") return "FACTORY_REASON_NOT_A_CODE";
  if (/^[A-Z0-9_:]{1,120}$/.test(raw)) return raw;
  const parts = raw.split(",").map(p => p.trim()).filter(Boolean);
  if (!parts.length || parts.some(p => p.length > 400 || !/^[A-Za-z0-9_:]+$/.test(p) || !/^[A-Z]/.test(p))) return "FACTORY_REASON_FREE_TEXT";
  const first = parts[0].toUpperCase(), suffix = parts.length > 1 ? `:AND_${parts.length - 1}_MORE` : "";
  return (first.length + suffix.length > 120 ? first.slice(0, 120 - suffix.length).replace(/:+$/, "") : first) + suffix;
}

/** Stopped (blocked/failed) jobs for the operator: kind, status, an uppercase
 * reason code only (free text is dropped), timestamps and whether the job came
 * from an office self-heal order. Never exposes inputs, keys, paths or evidence. */
export function shapeStoppedJobs(rows: Array<{ status: unknown; kind: unknown; reason: unknown; order_id: unknown; created_at: unknown; completed_at: unknown }>) {
  const iso = (v: unknown) => { const t = v instanceof Date ? v.getTime() : Date.parse(String(v ?? "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  return rows.slice(0, 20).filter(r => r.status === "blocked" || r.status === "failed").map(r => ({
    status: r.status as "blocked" | "failed",
    kind: typeof r.kind === "string" && /^[a-z-]{1,40}$/.test(r.kind) ? r.kind : "unknown",
    reason: factoryStoppedReasonCode(r.reason),
    selfHealOrder: typeof r.order_id === "string" && r.order_id.startsWith("ord-sh-"),
    createdAt: iso(r.created_at), completedAt: iso(r.completed_at),
  }));
}

/** Reduces a raw ledger row to the operator summary; never exposes evidence ids or reservation keys. */
export function shapeCreditSummary(raw: string | null, scope: string) {
  if (raw === null) return { provisioned: false as const };
  const state = JSON.parse(raw) as SharedCreditState;
  if (state.grant && state.grant.accountScope !== scope) return { provisioned: true as const, scopeMismatch: true };
  const summary = summarize(state);
  return {
    provisioned: true as const, initialized: state.grant !== null,
    grantId: summary.grantId, expiresAt: summary.expiresAt,
    spentUsd: summary.spentUsd, reservedUsd: summary.reservedUsd, availableUsd: summary.availableUsd,
    uncertain: summary.uncertain, overrun: summary.overrun,
  };
}
