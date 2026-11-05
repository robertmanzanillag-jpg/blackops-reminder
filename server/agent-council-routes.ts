import type { Express } from "express";
import { OrderEvidenceError, getAgentCouncil, isAgentCouncilEnabled, setAgentCouncilUser } from "./agent-council";
import { getCurrentUserId, getSystemUserId } from "./user-context";
import { agentProbes, summarizeProbe } from "@shared/agent-live-status";
import { createKongSupervisorConversation } from "./kong-supervisor-conversation";
import { registerKongSupervisorRoutes } from "./kong-supervisor-routes";

const MANUAL_RUN_MIN_INTERVAL_MS = 60_000;

// Read-only view + a rate-limited manual cycle. Both sit behind requireAppUser (server/index.ts).
export function registerAgentCouncilRoutes(app: Express) {
  // Supervisor KONG (PR #315): owner-only chat and read-only readiness review.
  // It reads the Kong video status; it never edits, publishes or runs commercial orders.
  const kongConversation = createKongSupervisorConversation({
    now: () => Date.now(),
    commit: (change) => getAgentCouncil().updateKongSupervision(change),
    read: () => getAgentCouncil().readKongSupervision(),
    readVideoStatus: async () => {
      const { getPromoVideoStatus } = await import("./promo-video-agent");
      const body = await getPromoVideoStatus(getSystemUserId());
      return summarizeProbe(agentProbes["kong-videos"], { ok: true, status: 200, body: JSON.parse(JSON.stringify(body ?? null)) });
    },
  });
  registerKongSupervisorRoutes(app, kongConversation, {
    requestUserId: (req) => {
      try {
        return getCurrentUserId(req);
      } catch {
        return null;
      }
    },
    ownerUserId: () => getSystemUserId(),
  });

  app.get("/api/agent-council/state", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await getAgentCouncil().view());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read agent council" });
    }
  });

  // CEO channel: Robert writes, the CEO routes the order to the right agents ($0, no AI).
  app.post("/api/agent-company/orders", async (req, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) return res.status(400).json({ error: "Escribe la orden para el CEO." });
      if (text.length > 500) return res.status(400).json({ error: "La orden es muy larga (maximo 500 caracteres)." });
      const council = getAgentCouncil();
      const state = await council.placeOrder(text);
      res.json({ order: state.company.orders[0] });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo crear la orden" });
    }
  });

  app.post("/api/agent-company/orders/:id/done", async (req, res) => {
    try {
      const raw = (req.body as { evidenceRunId?: unknown } | undefined)?.evidenceRunId;
      const evidenceRunId = typeof raw === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : undefined;
      if (raw !== undefined && raw !== null && raw !== "" && !evidenceRunId) return res.status(400).json({ error: "Evidencia no valida." });
      const state = await getAgentCouncil().finishOrder(String(req.params.id), evidenceRunId, getCurrentUserId(req));
      res.json({ order: state.company.orders.find((order) => order.id === req.params.id) || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar la orden";
      res.status(error instanceof OrderEvidenceError ? 422 : message === "Orden no encontrada" ? 404 : 500).json({ error: message });
    }
  });

  app.post("/api/agent-council/run", async (_req, res) => {
    try {
      if (!isAgentCouncilEnabled()) {
        return res.status(409).json({ error: "El consejo esta apagado (AGENT_COUNCIL_ENABLED=false)." });
      }
      setAgentCouncilUser(getSystemUserId());
      const council = getAgentCouncil();
      const current = await council.load();
      const last = current.lastCycleAt ? Date.parse(current.lastCycleAt) : 0;
      if (Date.now() - last < MANUAL_RUN_MIN_INTERVAL_MS) {
        return res.status(429).json({ error: "El consejo acaba de reunirse; espera un minuto." });
      }
      await council.runCycle({ force: true });
      res.json(await council.view());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run agent council" });
    }
  });
}
