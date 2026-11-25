// CEO alert gate: Robert only hears from the CEO when something is actually wrong, once per
// problem, plus one "resuelto" message when it is fixed. No AI calls: dedupe is by stable key.
//
// Rules (Robert, 2026-11-24):
// - Healthy => silence. No "todo bien" messages from automatic scans.
// - A NEW failure (or a state change) => one message. The same open problem never re-notifies
//   every scan; a fixable one gets at most one reminder per day while still open.
// - Fixable by code => the factory works on it through the existing self-heal path
//   (server/office-self-heal.ts). The message says so.
// - Not fixable by code (missing data, access, secrets) => one message with exactly what Robert
//   must do. Never repeated.
// - When the self-heal entry reaches verified/cleared, or the problem disappears from the scan
//   that reported it => one "resuelto" message (with the PR link when there is one).
// - Fail closed: if the ledger cannot be read or written, nothing automatic is sent.

import type { SelfHealEntry } from "./office-self-heal";

export type CeoProblemKind = "factory" | "owner";

export type CeoProblem = {
  /** Stable dedupe key, unique within its source. */
  key: string;
  /** Who reported it: "app-qa", "cybersecurity", "self-heal". */
  source: string;
  title: string;
  kind: CeoProblemKind;
  /** For kind=owner: exactly what Robert must do. */
  ownerAction?: string;
  /** Optional PR link (factory PR) known at report time. */
  prUrl?: string;
};

export type CeoLedgerEntry = {
  key: string;
  source: string;
  title: string;
  kind: CeoProblemKind;
  status: "open" | "resolved";
  firstNotifiedAt: string;
  lastNotifiedAt: string;
  resolvedAt?: string;
  prUrl?: string;
};

export type CeoAlertLedger = { version: 1; entries: CeoLedgerEntry[] };

export const CEO_ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;
export const CEO_ALERT_MAX_ENTRIES = 300;
const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function emptyCeoAlertLedger(): CeoAlertLedger {
  return { version: 1, entries: [] };
}

/** Strict parse: anything unexpected throws so the caller fails closed (sends nothing). */
export function parseCeoAlertLedger(raw: string | null): CeoAlertLedger {
  if (raw === null) return emptyCeoAlertLedger();
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || (value as any).version !== 1 || !Array.isArray((value as any).entries)) {
    throw new Error("CEO_ALERT_LEDGER_INVALID");
  }
  const entries: CeoLedgerEntry[] = [];
  for (const item of (value as any).entries as unknown[]) {
    const e = item as Record<string, unknown>;
    if (!e || typeof e.key !== "string" || typeof e.source !== "string" || typeof e.title !== "string"
      || (e.kind !== "factory" && e.kind !== "owner") || (e.status !== "open" && e.status !== "resolved")
      || typeof e.firstNotifiedAt !== "string" || typeof e.lastNotifiedAt !== "string") {
      throw new Error("CEO_ALERT_LEDGER_INVALID");
    }
    entries.push(e as unknown as CeoLedgerEntry);
  }
  return { version: 1, entries };
}

const SELF_HEAL_TERMINAL_OK = new Set(["verified", "cleared"]);
const SELF_HEAL_NEEDS_OWNER = new Set(["needs_owner", "escalated"]);

const SELF_HEAL_OWNER_ACTIONS: Record<string, string> = {
  FACTORY_NOT_ADMITTED: "La fábrica no aceptó la orden en 72 h. Revisa que la fábrica esté encendida (software-factory-cloud) y que tenga cupo diario.",
  FACTORY_OUTCOME_UNKNOWN: "No puedo leer el resultado de la fábrica. Revisa la última ejecución de software-factory-cloud en GitHub Actions.",
};

function selfHealOwnerAction(entry: Pick<SelfHealEntry, "status" | "reason">): string {
  if (entry.reason && SELF_HEAL_OWNER_ACTIONS[entry.reason]) return SELF_HEAL_OWNER_ACTIONS[entry.reason];
  if (entry.status === "escalated") return "La fábrica falló 2 intentos. Revisa el PR/orden en la oficina y decide si se reintenta o se arregla a mano.";
  return `La fábrica necesita tu intervención (${entry.reason || "sin código"}). Revisa la oficina (office-status) y la última ejecución de la fábrica.`;
}

export function selfHealPrUrl(entry: Pick<SelfHealEntry, "attempts">): string | undefined {
  for (const attempt of [...(entry.attempts || [])].reverse()) {
    if (attempt?.factory?.prUrl) return attempt.factory.prUrl;
  }
  return undefined;
}

function selfHealTitle(entry: Pick<SelfHealEntry, "role" | "code" | "prNumber" | "testPath">): string {
  const target = entry.prNumber ? ` (PR #${entry.prNumber})` : entry.testPath ? ` (${entry.testPath})` : "";
  return `${entry.role}:${entry.code}${target}`;
}

/** Problems that the self-heal ledger currently has open, plus the keys it has resolved. */
export function selfHealToCeoView(entries: readonly SelfHealEntry[]): { problems: CeoProblem[]; resolved: Map<string, string | undefined> } {
  const problems: CeoProblem[] = [];
  const resolved = new Map<string, string | undefined>();
  const openKeys = new Set<string>();
  for (const entry of entries) {
    const key = `self-heal:${entry.key}`;
    if (SELF_HEAL_TERMINAL_OK.has(entry.status)) continue;
    openKeys.add(key);
    if (SELF_HEAL_NEEDS_OWNER.has(entry.status)) {
      problems.push({ key: `${key}:owner`, source: "self-heal", title: selfHealTitle(entry), kind: "owner", ownerAction: selfHealOwnerAction(entry), prUrl: selfHealPrUrl(entry) });
    } else {
      problems.push({ key, source: "self-heal", title: selfHealTitle(entry), kind: "factory", prUrl: selfHealPrUrl(entry) });
    }
  }
  // Latest episode wins: a key re-opened after a verified episode stays open.
  for (const entry of entries) {
    const key = `self-heal:${entry.key}`;
    if (SELF_HEAL_TERMINAL_OK.has(entry.status) && !openKeys.has(key)) resolved.set(key, selfHealPrUrl(entry));
  }
  return { problems, resolved };
}

export type CeoAlertMessage = { ids: string[]; text: string };
export type CeoAlertPlan = { ledger: CeoAlertLedger; messages: CeoAlertMessage[]; changed: boolean };

export function formatNewProblem(problem: CeoProblem): string {
  if (problem.kind === "factory") {
    return `🔧 Fallo nuevo (${problem.source}): ${problem.title}\nLa fábrica ya tiene la orden de reparación (PR-first). Te escribo de nuevo solo cuando quede resuelto.`
      + (problem.prUrl ? `\nPR: ${problem.prUrl}` : "");
  }
  return `⚠️ Necesito que hagas algo (${problem.source}): ${problem.title}\nQué hacer: ${problem.ownerAction || "revisar el detalle en BlackOps."}\nNo lo puede arreglar la fábrica (falta dato, acceso o secreto).`
    + (problem.source === REMIND_OWNER_SOURCE ? " Te lo recuerdo una vez al día mientras siga abierto." : " No te lo repito.");
}

export function formatReminder(entry: CeoLedgerEntry): string {
  if (entry.kind === "owner") return `⏳ Sigue abierto (${entry.source}): ${entry.title}\nSigue pendiente de tu acción.`;
  return `⏳ Sigue abierto (${entry.source}): ${entry.title}\nLa fábrica sigue trabajando en ello.` + (entry.prUrl ? `\nPR: ${entry.prUrl}` : "");
}

export function formatResolved(entry: CeoLedgerEntry, prUrl?: string): string {
  const link = prUrl || entry.prUrl;
  return `✅ Resuelto (${entry.source}): ${entry.title}` + (link ? `\nPR: ${link}` : "\nYa no aparece en la última revisión.");
}

/** Security threats re-alert once per day while open, even when only Robert can fix them. */
export const REMIND_OWNER_SOURCE = "cybersecurity";

/**
 * Pure planner. `scope` lists the sources whose scan just completed reliably: only entries of
 * those sources can be resolved by absence. `resolvedKeys` (self-heal verified/cleared) resolve
 * explicitly with their PR link. With `delivered`, only changes whose message was actually
 * delivered are recorded; everything else is retried on the next cycle.
 */
export function planCeoAlerts(input: {
  ledger: CeoAlertLedger;
  problems: readonly CeoProblem[];
  scope: readonly string[];
  resolvedKeys?: ReadonlyMap<string, string | undefined>;
  now: number;
  delivered?: ReadonlySet<string>;
}): CeoAlertPlan {
  const iso = new Date(input.now).toISOString();
  const messages: CeoAlertMessage[] = [];
  const ok = (id: string) => !input.delivered || input.delivered.has(id);
  const push = (id: string, text: string) => {
    const same = messages.find((m) => m.text === text);
    if (same) same.ids.push(id); else messages.push({ ids: [id], text });
  };
  let changed = false;
  const entries = input.ledger.entries.map((e) => ({ ...e }));
  const byKey = new Map(entries.map((e) => [`${e.source}\u0000${e.key}`, e]));
  const current = new Set<string>();

  for (const problem of input.problems) {
    const id = `${problem.source}\u0000${problem.key}`;
    if (current.has(id)) continue;
    current.add(id);
    const existing = byKey.get(id);
    if (!existing || existing.status === "resolved") {
      push(id, formatNewProblem(problem));
      if (!ok(id)) continue;
      const entry: CeoLedgerEntry = { key: problem.key, source: problem.source, title: problem.title.slice(0, 200), kind: problem.kind, status: "open", firstNotifiedAt: iso, lastNotifiedAt: iso, ...(problem.prUrl ? { prUrl: problem.prUrl } : {}) };
      if (existing) { Object.assign(existing, entry); delete existing.resolvedAt; } else { entries.push(entry); byKey.set(id, entry); }
      changed = true;
      continue;
    }
    if (problem.prUrl && existing.prUrl !== problem.prUrl) { existing.prUrl = problem.prUrl; changed = true; }
    const reminds = existing.kind === "factory" || existing.source === REMIND_OWNER_SOURCE;
    if (reminds && input.now - Date.parse(existing.lastNotifiedAt) >= CEO_ALERT_REMINDER_MS) {
      push(id, formatReminder(existing));
      if (ok(id)) { existing.lastNotifiedAt = iso; changed = true; }
    }
  }

  const scope = new Set(input.scope);
  for (const entry of entries) {
    if (entry.status !== "open") continue;
    const id = `${entry.source}\u0000${entry.key}`;
    const baseKey = entry.key.replace(/:owner$/, "");
    const explicit = input.resolvedKeys?.has(baseKey) ?? false;
    if (current.has(id) && !explicit) continue;
    if (!explicit && !scope.has(entry.source)) continue;
    const prUrl = explicit ? input.resolvedKeys!.get(baseKey) : undefined;
    push(id, formatResolved(entry, prUrl));
    if (!ok(id)) continue;
    entry.status = "resolved";
    entry.resolvedAt = iso;
    if (prUrl) entry.prUrl = prUrl;
    changed = true;
  }

  const kept = entries
    .filter((e) => e.status === "open" || input.now - Date.parse(e.resolvedAt || e.lastNotifiedAt) < RESOLVED_RETENTION_MS)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1))
    .slice(0, CEO_ALERT_MAX_ENTRIES);
  if (kept.length !== entries.length) changed = true;
  return { ledger: { version: 1, entries: kept }, messages, changed };
}

// ---------------------------------------------------------------------------
// Runtime: durable ledger + Telegram. Fail closed on any storage problem.
// ---------------------------------------------------------------------------

export type CeoAlertGateDeps = {
  /** Read-modify-write of the ledger row, serialized by the store. Throws when unavailable. */
  transact(update: (raw: string | null) => Promise<string>): Promise<unknown>;
  send(text: string): Promise<boolean>;
  now(): number;
};

export type CeoAlertGateResult = { sent: number; planned: number; failed: number; skippedReason?: string };

const reason = (error: unknown) => (error instanceof Error ? error.message.slice(0, 120) : "sin detalle");

export async function runCeoAlertGate(
  input: { problems: readonly CeoProblem[]; scope: readonly string[]; resolvedKeys?: ReadonlyMap<string, string | undefined> },
  deps: CeoAlertGateDeps,
): Promise<CeoAlertGateResult> {
  // Phase 1: read + plan (ledger unchanged). Phase 2 records only what was delivered.
  let messages: CeoAlertMessage[] = [];
  try {
    await deps.transact(async (raw) => {
      messages = planCeoAlerts({ ledger: parseCeoAlertLedger(raw), ...input, now: deps.now() }).messages;
      return raw ?? JSON.stringify(emptyCeoAlertLedger());
    });
  } catch (error) {
    return { sent: 0, planned: 0, failed: 0, skippedReason: `CEO_ALERT_LEDGER_UNAVAILABLE: ${reason(error)}` };
  }
  if (!messages.length) return { sent: 0, planned: 0, failed: 0 };
  const delivered = new Set<string>();
  let sent = 0;
  for (const message of messages) {
    let okSend = false;
    try { okSend = await deps.send(message.text); } catch { okSend = false; }
    if (okSend) { sent++; message.ids.forEach((id) => delivered.add(id)); }
  }
  const failed = messages.length - sent;
  if (!delivered.size) return { sent, planned: messages.length, failed };
  try {
    await deps.transact(async (raw) => JSON.stringify(planCeoAlerts({ ledger: parseCeoAlertLedger(raw), ...input, now: deps.now(), delivered }).ledger));
  } catch (error) {
    // Sent but not recorded: it will be re-sent next cycle (duplicate beats a dropped alert).
    return { sent, planned: messages.length, failed, skippedReason: `CEO_ALERT_LEDGER_WRITE_FAILED: ${reason(error)}` };
  }
  return { sent, planned: messages.length, failed };
}

export const CEO_ALERT_NAMESPACE = (userId: string) => `ceo-alerts:v1:${userId}`;

/** Durable deps for the web process. Requires AGENT_COUNCIL_STORAGE=postgres, otherwise fail closed. */
export async function defaultCeoAlertGateDeps(userId: string, env: NodeJS.ProcessEnv = process.env): Promise<CeoAlertGateDeps | null> {
  if (env.CEO_ALERTS_ENABLED?.trim().toLowerCase() === "false") return null;
  if (env.AGENT_COUNCIL_STORAGE !== "postgres") return null;
  const { getCouncilStore } = await import("./agent-council-store");
  const store = await getCouncilStore();
  return {
    transact: (update) => store.transact(CEO_ALERT_NAMESPACE(userId), update),
    now: () => Date.now(),
    async send(text) {
      const [{ storage }, { sendTelegramPlainMessage }, { hasRealValue }] = await Promise.all([import("./storage"), import("./telegram"), import("./ceo-doctor-cli")]);
      const token = env.TELEGRAM_BOT_TOKEN;
      const config = await storage.getTelegramConfig(userId);
      if (!token || !hasRealValue(token) || !config?.enabled || !config.chatId) return false;
      return sendTelegramPlainMessage(token, config.chatId, text);
    },
  };
}

/** One self-heal → CEO pass: new factory orders, owner-needed states and verified/cleared fixes. */
export async function runSelfHealCeoAlerts(
  input: { selfHealState: unknown; owner: string },
  deps: CeoAlertGateDeps,
): Promise<CeoAlertGateResult> {
  let entries: SelfHealEntry[];
  try {
    const { parseSelfHealState } = await import("./office-self-heal");
    entries = parseSelfHealState(input.selfHealState, input.owner).entries;
  } catch (error) {
    // Unreadable ledger is not "healthy" and not "resolved": send nothing.
    return { sent: 0, planned: 0, failed: 0, skippedReason: `SELF_HEAL_STATE_UNREADABLE: ${error instanceof Error ? error.message.slice(0, 80) : "sin detalle"}` };
  }
  const view = selfHealToCeoView(entries);
  return runCeoAlertGate({ problems: view.problems, scope: ["self-heal"], resolvedKeys: view.resolved }, deps);
}

export const CEO_SELF_HEAL_ALERT_INTERVAL_MS = 15 * 60 * 1000;

/** Web-process scheduler. Reads the office council row (read-only) and its own ledger row. */
export function startCeoSelfHealAlertScheduler(userId: () => string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CEO_ALERTS_ENABLED?.trim().toLowerCase() === "false" || env.AGENT_COUNCIL_STORAGE !== "postgres") return false;
  const tick = async () => {
    const owner = userId();
    const deps = await defaultCeoAlertGateDeps(owner, env);
    if (!deps) return;
    const { getCouncilStore } = await import("./agent-council-store");
    const raw = await (await getCouncilStore()).read(owner);
    if (!raw) return; // no office state yet: nothing to report, nothing to resolve
    const state = JSON.parse(raw) as { officeExecution?: { selfHeal?: unknown } };
    const result = await runSelfHealCeoAlerts({ selfHealState: state.officeExecution?.selfHeal, owner }, deps);
    if (result.skippedReason) console.warn(`[ceo-alerts] ${result.skippedReason}`);
  };
  const run = () => { tick().catch((error) => console.warn("[ceo-alerts] self-heal pass failed:", error instanceof Error ? error.message : error)); };
  setTimeout(run, 90_000).unref?.();
  setInterval(run, CEO_SELF_HEAL_ALERT_INTERVAL_MS).unref?.();
  return true;
}
