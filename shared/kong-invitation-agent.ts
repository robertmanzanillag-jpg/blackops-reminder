import { z } from "zod";
import type { AgentLiveStatus } from "./agent-live-status";

export const KONG_INVITATION_AGENT_ID = "kong:dj_invitations";
export const KONG_INVITATION_NAME = "Invitaciones a DJs";
export const KONG_INVITATION_OWNER = "01a122a5-871c-7a23-b2ef-b47f34f29663";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(10000);
const timestamp = z.string().datetime({ offset: true });
// Metadata only: no artist names, recipient addresses, message bodies or credentials.
export const kongInvitationReceiptSchema = z.object({
  version: z.literal(1),
  ownerId: z.literal(KONG_INVITATION_OWNER),
  scopeId: z.literal("kong-dj-invitations"),
  scriptId: z.literal("1sPDzL7uZvToeNr9phm8xD5YrZ5x1EBZMp5Bn-jG4igwY8F01cVKd0_kh"),
  senderAccount: z.literal("kongnightlifeapp@gmail.com"),
  sequence: z.number().int().positive(),
  previousReceiptSha256: hash.nullable(),
  runId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  observedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  provenance: z.enum(["manual", "scheduled"]),
  sourceSha256: z.literal("23c2b33e18227f49bb70aeadc93d1d250241e101af112b2eb2169abdb1fa340c"),
  installedCodeSha256: hash,
  evidenceSha256: hash,
  reviewed: z.number().int().min(0).max(10),
  pending: count,
  excluded: count,
  admitted: z.number().int().min(0).max(10),
  sent: z.number().int().min(0).max(100),
  gmailReceiptSha256s: z.array(hash).max(100),
  senderExecution: z.enum(["none", "original-time-driven"]),
  senderPaused: z.boolean(),
  cursor: count,
  fence: count,
  revision: count,
  scheduler: z.enum(["active", "paused", "unknown"]),
  blocker: z.enum(["none", "validation-pending", "approval-pending", "access-unavailable", "uncertain-action", "technical-preflight"]),
}).strict().superRefine((r, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: "custom", message });
  if (Date.parse(r.startedAt) > Date.parse(r.completedAt) || Date.parse(r.completedAt) > Date.parse(r.observedAt)) add("Invalid receipt timing");
  if (new Set(r.gmailReceiptSha256s).size !== r.gmailReceiptSha256s.length || r.gmailReceiptSha256s.length !== r.sent) add("Each sent invitation needs its own distinct Gmail receipt");
  if (r.sent > 0 && (r.senderExecution !== "original-time-driven" || r.senderPaused)) add("Only the original scheduled sender can prove sends");
  if (r.sent === 0 && r.senderExecution !== "none") add("A paused or zero-send trigger is not send proof");
});
export type KongInvitationReceipt = z.infer<typeof kongInvitationReceiptSchema>;
export type KongInvitationLedger = { receipt: KongInvitationReceipt; sha256: string; recordedAt: string };

export function parseKongInvitationLedger(value: unknown): KongInvitationLedger | undefined {
  const parsed = z.object({ receipt: kongInvitationReceiptSchema, sha256: hash, recordedAt: timestamp }).strict().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function kongInvitationStatus(value: unknown, now: number): AgentLiveStatus {
  const ledger = parseKongInvitationLedger(value);
  const base = { lifePenaltyExempt: true, activity: ["Coordinador local externo; Apps Script conserva el único envío."] };
  if (!ledger) return { ...base, state: "needs-setup", label: "Sin recibo conectado", detail: "Registrar el resultado real del coordinador. Este puesto no inicia ni duplica el envío." };
  const r = ledger.receipt;
  const counts = `Revisados ${r.reviewed} · admitidos ${r.admitted} · enviados ${r.sent} · pendientes ${r.pending}`;
  if (Date.parse(r.observedAt) > now || Date.parse(ledger.recordedAt) > now || now - Date.parse(r.observedAt) > 2 * 60 * 60_000 || now - Date.parse(r.completedAt) > 2 * 60 * 60_000) return { ...base, state: "offline", label: "Recibo sin vigencia", detail: counts };
  return { ...base, state: r.blocker === "none" ? "available" : "needs-setup", label: r.senderPaused ? r.reviewed + r.admitted > 0 ? "Envío pausado · trabajo registrado" : "Envío pausado · sin trabajo nuevo" : r.sent ? "Envíos reportados con recibos" : "Sin envío confirmado", detail: counts,
    activity: [...base.activity, counts, `Último resultado ${r.completedAt}`], problems: r.blocker === "none" ? [] : [`Pendiente: ${r.blocker}`] };
}
