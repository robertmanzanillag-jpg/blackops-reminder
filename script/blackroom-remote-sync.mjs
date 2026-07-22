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

function blackRoomLocalWallClock(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function isValidBlackRoomPublicationDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value;
}

export function summarizeBlackRoomDeliveryLedger(ledger, now = new Date(), timezone = "America/New_York") {
  const currentLocal = blackRoomLocalWallClock(now, timezone);
  let scheduled = 0;
  let completed = 0;
  for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
    const receipts = entry?.networkReceipts && typeof entry.networkReceipts === "object" ? entry.networkReceipts : {};
    const fullyConfirmed = entry?.status === "confirmed"
      && ["tiktok", "facebook", "youtube"].every((network) => Boolean(String(receipts[network] || "").trim()));
    const publicationDateTime = String(entry?.publicationDateTime || "");
    if (!fullyConfirmed || !isValidBlackRoomPublicationDateTime(publicationDateTime)) continue;
    if (publicationDateTime > currentLocal) scheduled += 1;
    else completed += 1;
  }
  return { scheduled, completed, confirmed: scheduled + completed };
}

export function applyBlackRoomDeliveryCounts(queue, delivery) {
  const scheduled = Math.max(0, Math.floor(Number(delivery?.scheduled || 0)));
  const completed = Math.max(0, Math.floor(Number(delivery?.completed || 0)));
  return {
    ...queue,
    totals: { ...(queue?.totals || {}), scheduled, completed },
    delivery: {
      scheduled,
      completed,
      confirmed: Math.max(0, Math.floor(Number(delivery?.confirmed || scheduled + completed))),
    },
  };
}
