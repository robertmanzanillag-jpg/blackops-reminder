import type { Express } from "express";
import { getAgentCouncil, isAgentCouncilEnabled, setAgentCouncilUser } from "./agent-council";
import { getSystemUserId } from "./user-context";

const MANUAL_RUN_MIN_INTERVAL_MS = 60_000;

// Read-only view + a rate-limited manual cycle. Both sit behind requireAppUser (server/index.ts).
export function registerAgentCouncilRoutes(app: Express) {
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
      const state = await getAgentCouncil().finishOrder(String(req.params.id));
      res.json({ order: state.company.orders.find((order) => order.id === req.params.id) || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar la orden";
      res.status(message === "Orden no encontrada" ? 404 : 500).json({ error: message });
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
      await council.runCycle();
      res.json(await council.view());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run agent council" });
    }
  });
}
