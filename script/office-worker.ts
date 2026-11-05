import "../server/env-loader";
import { createOfficeCloudWorker } from "../server/office-cloud-runtime";
import { getSystemUserId } from "../server/user-context";

async function main() {
if (process.env.OFFICE_WORKER_ENABLED !== "true") throw new Error("OFFICE_WORKER_ENABLED=true is required for the dedicated office worker.");
let scheduledKongOwner: string | undefined;
if (process.env.OFFICE_KONG_AUDIT_SCHEDULE_ENABLED === "true") {
  try { scheduledKongOwner = getSystemUserId(); }
  catch { console.error("Recurring KONG audits require a configured office owner"); }
}
const worker = createOfficeCloudWorker({ scheduledKongOwner });
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const heartbeat = setInterval(() => { void worker.maintain().catch(() => console.error("Office worker maintenance unavailable")); }, 15_000);
const capabilities = setInterval(() => { void worker.refreshCapabilities().catch(() => console.error("Office worker provider checks unavailable")); }, 30_000);
try {
  await worker.refreshCapabilities();
  while (!stopping) {
    try { await worker.tick(); }
    catch { console.error("Office worker cycle unconfirmed; no task will be retried automatically"); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
} finally { clearInterval(heartbeat); clearInterval(capabilities); }
}
void main().catch(() => {
  console.error("Office worker stopped: configuration or persistent execution is unavailable.");
  process.exitCode = 1;
});
