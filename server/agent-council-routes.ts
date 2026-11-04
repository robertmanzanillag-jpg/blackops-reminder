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
