import type { Express } from "express";
import { OrderEvidenceError, getAgentCouncil, isAgentCouncilEnabled, setAgentCouncilUser } from "./agent-council";
import { getCurrentUserId, getSystemUserId } from "./user-context";
import { agentProbes, summarizeProbe } from "@shared/agent-live-status";
import { createKongSupervisorConversation } from "./kong-supervisor-conversation";
import { registerKongSupervisorRoutes } from "./kong-supervisor-routes";
import {capabilityTrainingSummary,capabilityRunSummary} from "./office-capability-training";

const MANUAL_RUN_MIN_INTERVAL_MS = 60_000;

// Read-only view + a rate-limited manual cycle. Both sit behind requireAppUser (server/index.ts).
export function registerAgentCouncilRoutes(app: Express, dependencies: {
  council?: ReturnType<typeof getAgentCouncil>;
  requestUserId?: typeof getCurrentUserId;
  ownerUserId?: typeof getSystemUserId;
  enabled?: typeof isAgentCouncilEnabled;
} = {}) {
  const councilInstance = () => dependencies.council ?? getAgentCouncil();
  const requestUserId = dependencies.requestUserId ?? getCurrentUserId;
  const ownerUserId = dependencies.ownerUserId ?? getSystemUserId;
  const enabled = dependencies.enabled ?? isAgentCouncilEnabled;
  // Supervisor KONG (PR #315): owner-only chat and read-only readiness review.
  // It reads the Kong video status; it never edits, publishes or runs commercial orders.
  const kongConversation = createKongSupervisorConversation({
    now: () => Date.now(),
    commit: (change) => councilInstance().updateKongSupervision(change),
    read: () => councilInstance().readKongSupervision(),
    readVideoStatus: async () => {
      const { getPromoVideoStatus } = await import("./promo-video-agent");
      const body = await getPromoVideoStatus(ownerUserId());
      return summarizeProbe(agentProbes["kong-videos"], { ok: true, status: 200, body: JSON.parse(JSON.stringify(body ?? null)) });
    },
  });
  registerKongSupervisorRoutes(app, kongConversation, {
    requestUserId: (req) => {
      try {
        return requestUserId(req);
      } catch {
        return null;
      }
    },
    ownerUserId: () => ownerUserId(),
  });

  app.get("/api/agent-council/state", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const view = await councilInstance().view();
      if (requestUserId(req) !== ownerUserId()) {
        view.kongCompany = { version: 1, careers: {}, trainees: [], orders: [], events: [] };
        view.kongLeaderboard = [];
        view.kongPersonalities = {};
        view.kongLastStatuses = {};
        view.kongEvidenceAt = {};
        view.kongObservedAt = null;
        view.kongCollaboration = { verified: false, observedAt: null, totalFindings: 0, exchanges: [] };
      }
      res.json(view);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read agent council" });
    }
  });

  app.get("/api/agent-council/internal-work", async (req,res)=>{
    res.set("Cache-Control","no-store");
    try {
      if(requestUserId(req)!==ownerUserId()) return res.status(403).json({error:"Solo el propietario puede leer los resúmenes internos."});
      const state=await councilInstance().load();
      const academy=(state.company?.academyJobs || []).slice(-20).reverse().map(job=>{
        const trainee=state.company.trainees.find(t=>t.id===job.traineeId);
        const assessment=trainee?.assessments?.find(a=>a.runId===job.id);
        return {id:job.id,agentId:trainee?.forAgentId || "unknown",purpose:trainee?.purpose || "candidate",
          policyCurrentlyApplied:Boolean(trainee && state.officeExecution?.roles.roles[trainee.forAgentId]?.activePolicy?.candidateId === trainee.id),
          status:job.status,startedAt:job.startedAt,reason:job.reason,
          benchmarkId:job.benchmarkId,...(assessment?{assessment:{passed:assessment.passed,quality:assessment.quality,incumbentQuality:assessment.incumbentQuality,completedAt:assessment.completedAt,scope:assessment.scope || "benchmark"}}:{})};
      });
      const radioAcademy=(state.officeExecution?.internalWork?.radioTrainingHistory || []).map(receipt=>({id:receipt.id,agentId:"radio",purpose:"incumbent",status:"completed",startedAt:receipt.appliedAt,
        policyCurrentlyApplied:state.officeExecution?.roles.roles.radio?.activePolicy?.version===receipt.appliedPolicyVersion,
        benchmarkId:receipt.evidence.evaluation.profileId,
        reason:`Solo parser de rangos horarios; misma persona y generación. ${receipt.firstVerifiedRunId?"Primera ejecución con registros guardados verificada.":"Primera ejecución con registros guardados todavía no confirmada."}`,
        assessment:{passed:receipt.evidence.evaluation.qualified,quality:Math.min(...receipt.evidence.evaluation.artifacts.map(a=>a.candidateQuality)),incumbentQuality:Math.min(...receipt.evidence.evaluation.artifacts.map(a=>a.baselineQuality)),scope:"benchmark",completedAt:receipt.appliedAt},
      }));
      const roleWork=(state.officeExecution?.roleWork?.jobs || []).slice(-28).reverse().map(job=>({id:job.id,role:job.role,status:job.status,startedAt:job.startedAt,completedAt:job.completedAt,reason:job.reason,artifactId:job.artifactId,audit:job.audit,webAudit:job.webAudit}));
      const capabilityTraining={policies:capabilityTrainingSummary(state.officeExecution?.capabilityTraining,ownerUserId(),Object.fromEntries(Object.entries(state.company.careers).map(([id,career])=>[id,career.generation]))),runs:(state.officeExecution?.capabilityTraining?.runs || []).slice(-28).reverse().map(capabilityRunSummary)};
      return res.json({...state.officeExecution?.internalWork || {version:1,jobs:[]},roleWork,capabilityTraining,roleAcademy:roleAcademySummary(state.officeExecution?.roleAcademy),academy:[...radioAcademy,...academy].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,20)});
    } catch {return res.status(503).json({error:"No se pudo verificar el trabajo interno."});}
  });

  // CEO channel: Robert writes, the CEO routes the order to the right agents ($0, no AI).
  app.post("/api/agent-company/orders", async (req, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) return res.status(400).json({ error: "Escribe la orden para el CEO." });
      if (text.length > 500) return res.status(400).json({ error: "La orden es muy larga (maximo 500 caracteres)." });
      const council = councilInstance();
      if (req.body?.company !== undefined && !["main", "kong"].includes(req.body.company)) return res.status(400).json({ error: "Empresa no válida." });
      const scope = req.body?.company === "kong" ? "kong" : "main";
      if (scope === "kong" && requestUserId(req) !== ownerUserId()) return res.status(403).json({ error: "Solo el propietario puede gestionar KONG." });
      const state = await council.placeOrder(text, scope);
      res.json({ order: (scope === "kong" ? state.kongCompany : state.company).orders[0] });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo crear la orden" });
    }
  });

  app.post("/api/agent-company/orders/:id/done", async (req, res) => {
    try {
      const raw = (req.body as { evidenceRunId?: unknown } | undefined)?.evidenceRunId;
      const evidenceRunId = typeof raw === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : undefined;
      if (raw !== undefined && raw !== null && raw !== "" && !evidenceRunId) return res.status(400).json({ error: "Evidencia no valida." });
      if (req.body?.company !== undefined && !["main", "kong"].includes(req.body.company)) return res.status(400).json({ error: "Empresa no válida." });
      const scope = req.body?.company === "kong" ? "kong" : "main";
      if (scope === "kong" && requestUserId(req) !== ownerUserId()) return res.status(403).json({ error: "Solo el propietario puede gestionar KONG." });
      const state = await councilInstance().finishOrder(String(req.params.id), evidenceRunId, requestUserId(req), scope);
      res.json({ order: (scope === "kong" ? state.kongCompany : state.company).orders.find((order) => order.id === req.params.id) || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar la orden";
      res.status(error instanceof OrderEvidenceError ? 422 : message === "Orden no encontrada" ? 404 : 500).json({ error: message });
    }
  });

  app.post("/api/agent-council/run", async (req, res) => {
    try {
      if (!enabled()) {
        return res.status(409).json({ error: "El consejo esta apagado (AGENT_COUNCIL_ENABLED=false)." });
      }
      setAgentCouncilUser(ownerUserId());
      const council = councilInstance();
      const current = await council.load();
      const last = current.lastCycleAt ? Date.parse(current.lastCycleAt) : 0;
      if (Date.now() - last < MANUAL_RUN_MIN_INTERVAL_MS) {
        return res.status(429).json({ error: "El consejo acaba de reunirse; espera un minuto." });
      }
      if (requestUserId(req) !== ownerUserId()) return res.status(403).json({ error: "Solo el propietario puede ejecutar el consejo." });
      await council.runCycle({ force: true });
      res.json(await council.view());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run agent council" });
    }
  });
}
import {roleAcademySummary} from "./office-role-academy";
