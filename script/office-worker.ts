import "../server/env-loader";
import { createOfficeCloudWorker } from "../server/office-cloud-runtime";
import { getSystemUserId } from "../server/user-context";
import { assertOfficeProtocolReady } from "../server/office-protocol";
import pg from "pg";

async function main() {
if (process.env.OFFICE_WORKER_ENABLED !== "true") throw new Error("OFFICE_WORKER_ENABLED=true is required for the dedicated office worker.");
const internalEnabled=process.env.OFFICE_INTERNAL_WORK_ENABLED === "true";
const roleWorkEnabled=process.env.OFFICE_ROLE_WORK_ENABLED === "true";
const webSourcesEnabled=process.env.OFFICE_WEB_SOURCES_ENABLED === "true";
if(webSourcesEnabled && (!roleWorkEnabled || !process.env.OFFICE_WEB_SOURCE_ORIGIN))throw new Error("Web source origin and role work must be configured together.");
const roleAcademyEnabled=process.env.OFFICE_ROLE_ACADEMY_ENABLED === "true";
const capabilityEnabled=process.env.OFFICE_CAPABILITY_TRAINING_ENABLED === "true";
if(capabilityEnabled && (!roleWorkEnabled || process.env.OFFICE_REVIEW_PROVIDER!=="openai" || !process.env.OPENAI_SHARED_CREDIT_CONFIG))throw new Error("Capability training requires real role audits and shared credit admission.");
if(roleAcademyEnabled && (process.env.OFFICE_REVIEW_PROVIDER!=="openai" || !process.env.OPENAI_SHARED_CREDIT_CONFIG))throw new Error("Role academy requires the verified shared credit ledger.");
const requireProtocol = roleWorkEnabled || roleAcademyEnabled || internalEnabled || process.env.OFFICE_REVIEW_PROVIDER === "openai" || process.env.OFFICE_WORKER_REVIEW_ONLY === "true" || process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true";
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
if (roleWorkEnabled || roleAcademyEnabled || internalEnabled || process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true" || reviewOnlyOwner) {
  const module = await import("../server/agent-council");
  module.setAgentCouncilUser(getSystemUserId());
  academy = module.getAgentCouncil();
}
if (process.env.OFFICE_REVIEW_PROVIDER === "openai" && !reviewOnlyOwner) throw new Error("OpenAI requires the owner-scoped review-only worker.");
const execution = reviewOnlyOwner && academy ? (await import("../server/office-execution")).createOfficeExecution(academy) : undefined;
const internalModule=internalEnabled ? await import("../server/office-internal-work"):undefined;
const internal=internalModule && academy && protocolPool ? internalModule.createInternalWorkRunner({council:academy,owner:getSystemUserId(),read:role=>internalModule.readInternalWorkSnapshot(protocolPool,getSystemUserId(),role==="radio"),shouldStop:()=>stopping}):undefined;
const businessModule=internalEnabled ? await import("../server/office-business-work"):undefined;
const businessWork=businessModule && academy && protocolPool ? businessModule.createBusinessWorkRunner({pool:protocolPool,owner:getSystemUserId(),getGeneration:async role=>businessModule.eligibleBusinessGeneration((await academy!.load()).company.careers[role]),shouldStop:()=>stopping}):undefined;
const editorialWork=businessModule && academy && protocolPool && webSourcesEnabled ? (await import("../server/office-editorial-work")).createEditorialWorkRunner({pool:protocolPool,owner:getSystemUserId(),configuredOwner:getSystemUserId(),getGeneration:async role=>businessModule.eligibleBusinessGeneration((await academy!.load()).company.careers[role]),shouldStop:()=>stopping}):undefined;
const revenueWork=businessModule && academy && protocolPool ? (await import("../server/office-revenue-work")).createRevenueWorkRunner({pool:protocolPool,owner:getSystemUserId(),getGeneration:async role=>businessModule.eligibleBusinessGeneration((await academy!.load()).company.careers[role]),shouldStop:()=>stopping}):undefined;
const roleWork=roleWorkEnabled && academy && protocolPool?(await import("../server/office-role-work")).createRoleWorkRunner({council:academy,owner:getSystemUserId(),read:role=>import("../server/office-role-snapshots").then(module=>module.readRoleSnapshot(protocolPool,getSystemUserId(),role)),...(webSourcesEnabled?{readWeb:(role:import("../server/office-web-role-sources").WebSourceRole)=>import("../server/office-web-role-store").then(module=>module.readStoredWebRoleSource(protocolPool,getSystemUserId(),getSystemUserId(),role))}:{}),shouldStop:()=>stopping}):undefined;
const roleExecution=roleAcademyEnabled && academy?(await import("../server/office-execution")).createOfficeExecution(academy,{...process.env,OPENAI_SHARED_CREDITS_REQUIRED:"true",OFFICE_OPENAI_MAX_OUTPUT_TOKENS:"1536"}):undefined;
const roleAcademy=roleExecution && academy?(await import("../server/office-role-academy")).createRoleAcademyRunner({council:academy,dailyPairs:Number(process.env.OFFICE_ROLE_ACADEMY_DAILY_PAIRS),shouldStop:()=>stopping,run:async(prompt,call)=>{
  const result=await roleExecution.run(prompt,call.executionId);
  if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw new Error("Role academy requires measured OpenAI execution.");
  return result as import("../server/office-openai").OfficeOpenAIResult;
}}):undefined;
const capabilityModule=capabilityEnabled?await import("../server/office-capability-training"):undefined;
const capabilityCredits=capabilityModule?await (await import("../server/shared-openai-credit-runtime")).loadSharedCreditRuntime(process.env,()=>new Date()):undefined;
const capabilityExecution=capabilityCredits && academy?(await import("../server/office-execution")).createOfficeExecution(academy,{...process.env,OPENAI_SHARED_CREDITS_REQUIRED:"true",OFFICE_OPENAI_MAX_OUTPUT_TOKENS:"768"},Date.now,{sharedCredits:capabilityCredits}):undefined;
const capabilityTrainer=capabilityModule && capabilityCredits && capabilityExecution && academy?capabilityModule.createCapabilityTrainer({owner:getSystemUserId(),maxCallsPerDay:Number(process.env.OFFICE_CAPABILITY_MAX_CALLS_PER_DAY),shouldStop:()=>stopping,
 loadWork:async()=>{const state=await academy!.load();return (await import("../server/office-role-work")).parseRoleWork(state.officeExecution?.roleWork,getSystemUserId());},
 transact:async change=>{const saved=await academy!.updateOfficeExecution((state,company)=>{
  const current=capabilityModule.parseCapabilityTraining(state.capabilityTraining,getSystemUserId());
  const next=change(current,Object.fromEntries(Object.entries(company.careers).map(([role,career])=>[role,career.generation])),Boolean(company.academyJobs?.some(j=>j.status==="running") || state.roleAcademy?.jobs.some(j=>j.status==="running")));
  capabilityModule.parseCapabilityTraining(next,getSystemUserId());return {...state,capabilityTraining:next};
 });return saved.capabilityTraining!;},
 run:async(prompt,call)=>{const result=await capabilityExecution.run(prompt,call.executionId);if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw Error("Measured OpenAI execution required");return result as import("../server/office-openai").OfficeOpenAIResult;},
 verifyCost:(await import("../server/office-training-receipts")).createTrainingReceiptReader(capabilityCredits),
}):undefined;
const worker = createOfficeCloudWorker({ scheduledKongOwner, reviewOnlyOwner, ...(execution ? { execute: execution.execute, probeClaude: execution.probe, admission: execution.admission } : {}) });
let lastAcademyTick = 0;
let lastCapabilityTick = 0;
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
        if(businessWork && !stopping) await businessWork.tick();
        if(revenueWork && !stopping) await revenueWork.tick();
        if(webSourcesEnabled && !stopping){try{await (await import("../server/office-web-source-scheduler")).warmOfficeWebSources(process.env.OFFICE_WEB_SOURCE_ORIGIN!);}catch{console.error("Office source host wake unconfirmed; audits will validate stored source freshness independently.");}}
        if(editorialWork && !stopping) await editorialWork.tick();
        if(roleWork && !stopping) await roleWork.tick();
        if(roleAcademy && !stopping) await roleAcademy.tick();
        // The web scheduler is disabled in this deployment. Preserve the
        // scout's durable daily cadence here; it only reads public releases.
        if (!stopping) await academy.runScout();
      }
      if(capabilityTrainer && !stopping && Date.now()-lastCapabilityTick>=60000){lastCapabilityTick=Date.now();await capabilityTrainer.tick();}
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
