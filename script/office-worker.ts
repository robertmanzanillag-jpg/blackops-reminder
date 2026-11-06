import "../server/env-loader";
import { createOfficeCloudWorker } from "../server/office-cloud-runtime";
import { getSystemUserId } from "../server/user-context";
import { assertOfficeProtocolReady } from "../server/office-protocol";
import pg from "pg";

async function main() {
if (process.env.OFFICE_WORKER_ENABLED !== "true") throw new Error("OFFICE_WORKER_ENABLED=true is required for the dedicated office worker.");
const internalEnabled=process.env.OFFICE_INTERNAL_WORK_ENABLED === "true";
const requireProtocol = internalEnabled || process.env.OFFICE_REVIEW_PROVIDER === "openai" || process.env.OFFICE_WORKER_REVIEW_ONLY === "true" || process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true";
if (requireProtocol && process.env.AGENT_COUNCIL_STORAGE !== "postgres") throw new Error("Dedicated council storage is required.");
const protocolPool = requireProtocol ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 10000, statement_timeout: 15000 }) : undefined;
const checkProtocol = async () => {
  if (protocolPool) await assertOfficeProtocolReady(protocolPool, getSystemUserId(), process.env.OFFICE_EXPECTED_WEB_REVISION || "");
};
try {
await checkProtocol();
let scheduledKongOwner: string | undefined;
if (process.env.OFFICE_KONG_AUDIT_SCHEDULE_ENABLED === "true") {
  try { scheduledKongOwner = getSystemUserId(); }
  catch { console.error("Recurring KONG audits require a configured office owner"); }
}
const reviewOnlyOwner = process.env.OFFICE_WORKER_REVIEW_ONLY === "true" ? getSystemUserId() : undefined;
const runOnce = process.env.OFFICE_WORKER_RUN_ONCE === "true";
if (runOnce && !reviewOnlyOwner) throw new Error("Single-pass workers require OFFICE_WORKER_REVIEW_ONLY=true.");
let academy: Awaited<ReturnType<typeof import("../server/agent-council")["getAgentCouncil"]>> | undefined;
if (internalEnabled || process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true" || reviewOnlyOwner) {
  const module = await import("../server/agent-council");
  module.setAgentCouncilUser(getSystemUserId());
  academy = module.getAgentCouncil();
}
if (process.env.OFFICE_REVIEW_PROVIDER === "openai" && !reviewOnlyOwner) throw new Error("OpenAI requires the owner-scoped review-only worker.");
const execution = reviewOnlyOwner && academy ? (await import("../server/office-execution")).createOfficeExecution(academy) : undefined;
const internalModule=internalEnabled ? await import("../server/office-internal-work"):undefined;
const internal=internalModule && academy && protocolPool ? internalModule.createInternalWorkRunner({council:academy,owner:getSystemUserId(),read:role=>internalModule.readInternalWorkSnapshot(protocolPool,getSystemUserId(),role==="radio"),shouldStop:()=>stopping}):undefined;
const worker = createOfficeCloudWorker({ scheduledKongOwner, reviewOnlyOwner, ...(execution ? { execute: execution.execute, probeClaude: execution.probe, admission: execution.admission } : {}) });
let lastAcademyTick = 0;
let stopping = false;
let consecutiveFailures = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
process.on("message",message=>{if(message && typeof message === "object" && "type" in message && message.type === "office-shutdown") stopping=true;});
process.on("disconnect",()=>{stopping=true;});
const heartbeat = setInterval(() => { void worker.maintain().catch(() => console.error("Office worker maintenance unavailable")); }, 15_000);
const capabilities = setInterval(() => { void worker.refreshCapabilities().catch(() => console.error("Office worker provider checks unavailable")); }, 30_000);
try {
  await worker.refreshCapabilities();
  while (!stopping) {
    try {
      await checkProtocol();
      if (!stopping && academy && Date.now() - lastAcademyTick >= 15 * 60000) {
        lastAcademyTick = Date.now(); await academy.runCycle();
        if (!stopping && process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true") await academy.runAcademyCycle();
        if(internal && !stopping) await internal.tick();
        // The web scheduler is disabled in this deployment. Preserve the
        // scout's durable daily cadence here; it only reads public releases.
        if (!stopping) await academy.runScout();
      }
      if(!stopping) await worker.tick();
      consecutiveFailures = 0;
    }
    catch { consecutiveFailures++; console.error("Office worker cycle unconfirmed; no task will be retried automatically"); if (runOnce || (process.env.OFFICE_WORKER_FAIL_FAST === "true" && consecutiveFailures >= 3)) throw new Error("Persistent execution unconfirmed"); }
    if (runOnce) break;
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
} finally { clearInterval(heartbeat); clearInterval(capabilities); }
} finally { await protocolPool?.end(); }
}
void main().then(() => { const supervised=process.connected; if(supervised) process.disconnect(); if (supervised || process.env.OFFICE_WORKER_RUN_ONCE === "true") process.exit(0); }).catch(() => {
  console.error("Office worker stopped: configuration or persistent execution is unavailable.");
  process.exitCode = 1;
  if (process.env.OFFICE_WORKER_RUN_ONCE === "true" || process.env.OFFICE_WORKER_FAIL_FAST === "true") process.exit(1);
});
