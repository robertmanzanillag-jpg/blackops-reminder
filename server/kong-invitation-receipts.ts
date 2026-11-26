import { createHash } from "node:crypto";
import { advanceCompany } from "../shared/agent-company";
import { applyVitality } from "../shared/agent-vitality";
import type { CouncilState } from "../shared/agent-council";
import { KONG_INVITATION_AGENT_ID as ID, KONG_INVITATION_NAME, kongInvitationReceiptSchema, parseKongInvitationLedger } from "../shared/kong-invitation-agent";

/** Pure CAS callback. No transport, account, queue or sender side effects. */
export function applyKongInvitationReceipt(state: CouncilState, input: unknown, now: number): CouncilState {
  const receipt = kongInvitationReceiptSchema.parse(input);
  if (!Number.isFinite(now) || Date.parse(receipt.observedAt) > now || now - Date.parse(receipt.observedAt) > 2 * 60 * 60_000 || now - Date.parse(receipt.completedAt) > 2 * 60 * 60_000) throw Error("INVITATION_RECEIPT_STALE");
  const sha256 = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
  const prior = parseKongInvitationLedger(state.kongInvitations);
  if (state.kongInvitations !== undefined && !prior) throw Error("INVITATION_RECEIPT_INVALID_STORED_STATE");
  if (prior?.sha256 === sha256) return state;
  const history = state.kongInvitationHistory ?? (prior ? [prior] : []);
  if (!Array.isArray(history) || history.length >= 1000) throw Error("INVITATION_HISTORY_ARCHIVE_REQUIRED");
  if (history.some(entry => entry.receipt.runId === receipt.runId)) throw Error("INVITATION_RECEIPT_CONFLICT");
  const priorSends = new Set(history.flatMap(entry => entry.receipt.gmailReceiptSha256s));
  if (receipt.gmailReceiptSha256s.some(sha => priorSends.has(sha))) throw Error("INVITATION_RECEIPT_DUPLICATE_SEND");
  if (receipt.sequence !== (prior?.receipt.sequence ?? 0) + 1 || receipt.previousReceiptSha256 !== (prior?.sha256 ?? null)) throw Error("INVITATION_RECEIPT_CONFLICT");
  if (prior && (receipt.runId === prior.receipt.runId || Date.parse(receipt.startedAt) < Date.parse(prior.receipt.completedAt) || receipt.cursor < prior.receipt.cursor || receipt.fence < prior.receipt.fence || receipt.revision < prior.receipt.revision)) throw Error("INVITATION_RECEIPT_REGRESSION");
  // The owner attests an evidence manifest, not a cloud executor. A hash-only check earns nothing.
  const work = receipt.reviewed + receipt.admitted + receipt.sent > 0;
  const statuses = { [ID]: { state: work ? "working" as const : "checking" as const, label: `Recibo del coordinador: ${receipt.reviewed} revisados, ${receipt.admitted} admitidos, ${receipt.sent} enviados`, ...(work ? { evidenceId: `invitation:${receipt.evidenceSha256}` } : {}) } };
  const scored = advanceCompany(state.company, { now, statuses, roles: { [ID]: KONG_INVITATION_NAME } }).state;
  const company = applyVitality(scored, { now, exempt: Object.keys(scored.careers).filter(id => id !== ID), names: { [ID]: KONG_INVITATION_NAME }, evidence: work ? [{ agentId: ID, id: `invitation:${receipt.evidenceSha256}`, at: receipt.completedAt, label: statuses[ID].label, clockOnly: true }] : [], kong: { observed: true, agents: [ID], holds: { [ID]: "coordinador externo sin turno ejecutable desde la oficina" }, blockers: {} } }).state;
  const ledger = { receipt, sha256, recordedAt: new Date(now).toISOString() };
  return { ...state, company, kongInvitations: ledger, kongInvitationHistory: [...history, ledger] };
}
