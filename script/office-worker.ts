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
const reviewOnlyOwner = process.env.OFFICE_WORKER_REVIEW_ONLY === "true" ? getSystemUserId() : undefined;
const runOnce = process.env.OFFICE_WORKER_RUN_ONCE === "true";
if (runOnce && !reviewOnlyOwner) throw new Error("Single-pass workers require OFFICE_WORKER_REVIEW_ONLY=true.");
let academy: Awaited<ReturnType<typeof import("../server/agent-council")["getAgentCouncil"]>> | undefined;
if (process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true" || reviewOnlyOwner) {
  const module = await import("../server/agent-council");
  module.setAgentCouncilUser(getSystemUserId());
  academy = module.getAgentCouncil();
}
if (process.env.OFFICE_REVIEW_PROVIDER === "openai" && !reviewOnlyOwner) throw new Error("OpenAI requires the owner-scoped review-only worker.");
const execution = reviewOnlyOwner && academy ? (await import("../server/office-execution")).createOfficeExecution(academy) : undefined;
const worker = createOfficeCloudWorker({ scheduledKongOwner, reviewOnlyOwner, ...(execution ? { execute: execution.execute, probeClaude: execution.probe, admission: execution.admission } : {}) });
let lastAcademyTick = 0;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const heartbeat = setInterval(() => { void worker.maintain().catch(() => console.error("Office worker maintenance unavailable")); }, 15_000);
const capabilities = setInterval(() => { void worker.refreshCapabilities().catch(() => console.error("Office worker provider checks unavailable")); }, 30_000);
try {
  await worker.refreshCapabilities();
  while (!stopping) {
    try {
      if (academy && Date.now() - lastAcademyTick >= 15 * 60000) {
        lastAcademyTick = Date.now(); await academy.runCycle();
        if (process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true") await academy.runAcademyCycle();
      }
      await worker.tick();
    }
    catch { console.error("Office worker cycle unconfirmed; no task will be retried automatically"); if (runOnce) throw new Error("Single-pass execution unconfirmed"); }
    if (runOnce) break;
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
} finally { clearInterval(heartbeat); clearInterval(capabilities); }
}
void main().then(() => { if (process.env.OFFICE_WORKER_RUN_ONCE === "true") process.exit(0); }).catch(() => {
  console.error("Office worker stopped: configuration or persistent execution is unavailable.");
  process.exitCode = 1;
  if (process.env.OFFICE_WORKER_RUN_ONCE === "true") process.exit(1);
});
