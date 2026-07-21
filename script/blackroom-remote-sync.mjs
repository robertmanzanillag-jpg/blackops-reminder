export function planBlackRoomRemoteSync({ control, localEnabled, lastAppliedGeneration }) {
  const generation = Math.max(0, Math.floor(Number(control?.generation || 0)));
  if (generation < lastAppliedGeneration) {
    return { action: "ignore", generation: lastAppliedGeneration };
  }
  const desiredEnabled = Boolean(control?.desiredEnabled);
  if (desiredEnabled !== Boolean(localEnabled)) {
    return { action: desiredEnabled ? "start" : "pause", generation };
  }
  return { action: "none", generation };
}
