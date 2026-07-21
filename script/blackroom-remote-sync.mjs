export function planBlackRoomRemoteSync({ control, localEnabled, localWorkerRunning = false, lastAppliedGeneration }) {
  const generation = Math.max(0, Math.floor(Number(control?.generation || 0)));
  if (generation < lastAppliedGeneration) {
    return { action: "ignore", generation: lastAppliedGeneration };
  }
  const desiredEnabled = Boolean(control?.desiredEnabled);
  if (desiredEnabled && !localEnabled) return { action: "start", generation };
  if (!desiredEnabled && (localEnabled || localWorkerRunning)) return { action: "pause", generation };
  return { action: "none", generation };
}
