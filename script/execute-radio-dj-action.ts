import { storage } from "../server/storage";
import { executeApprovedPendingAction } from "../server/trust-executor";

async function main(): Promise<void> {
  const [, , actionId, djNameArg] = process.argv;
  const djName = String(djNameArg || "").trim();
  if (!actionId || !djName) {
    throw new Error("Usage: execute-radio-dj-action <pendingActionId> <djName>");
  }

  const action = await storage.getPendingAction(actionId);
  if (!action) throw new Error(`Pending action not found: ${actionId}`);
  if (action.actionType !== "radio_edit.resolve_dj_name") {
    throw new Error(`Unsupported action type: ${action.actionType}`);
  }

  const input = ((action.editedInput || action.input || {}) as Record<string, unknown>) || {};
  const approved = await storage.updatePendingAction(action.id, {
    status: "approved",
    editedInput: { ...input, djName },
    approvedBy: "mac-local-youtube-worker",
    approvedAt: new Date(),
    approvalReason: "Nombre del DJ resuelto automaticamente desde el titulo local",
  });

  await storage.createPendingActionEvent({
    pendingActionId: action.id,
    userId: action.userId,
    actorType: "system",
    actorId: "mac-local-youtube-worker",
    eventType: "approved",
    previousStatus: action.status,
    nextStatus: "approved",
    note: "Nombre del DJ resuelto automaticamente desde el titulo local.",
    metadata: { djName },
  });

  const result = await executeApprovedPendingAction(approved, "mac-local-youtube-worker");
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
