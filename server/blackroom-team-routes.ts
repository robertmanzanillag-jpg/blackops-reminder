import type { Express, Request, Response } from "express";
import { isBlackRoomTeamActionName, isBlackRoomTeamAgentId, type BlackRoomTeamAgentId, type BlackRoomTeamRunResult } from "@shared/blackroom-team";
import {
  BLACKROOM_TEAM_MODULES,
  createBlackRoomTeamContext,
  getAllBlackRoomTeamStatuses,
  getBlackRoomTeamStatus,
  type BlackRoomTeamContextOptions,
  type BlackRoomTeamModules,
} from "./blackroom-team";
import { getCurrentUserId } from "./user-context";
import { isConfiguredSingleUserOwner } from "./single-user-owner";

export type BlackRoomTeamRouteOptions = {
  /** Resolves the request's user id or null (no session). Defaults to getCurrentUserId. */
  requestUserId?: (req: Request) => string | null;
  /** Owner check. Defaults to the same single-user owner rule the Black Room routes use. */
  isOwner?: (userId: string) => Promise<boolean>;
  modules?: BlackRoomTeamModules;
  context?: Omit<BlackRoomTeamContextOptions, "modules" | "userId">;
};

const MAX_INPUT_KEYS = 50;

function defaultRequestUserId(req: Request): string | null {
  try {
    return getCurrentUserId(req);
  } catch {
    return null;
  }
}

function inputFrom(body: unknown): Record<string, unknown> | null {
  if (body === undefined || body === null || body === "") return {};
  if (typeof body !== "object" || Array.isArray(body)) return null;
  return Object.keys(body as object).length > MAX_INPUT_KEYS ? null : (body as Record<string, unknown>);
}

function sendResult(res: Response, result: BlackRoomTeamRunResult) {
  // A run that did not complete is reported as such; the HTTP call itself succeeded.
  res.json(result);
}

/**
 * Black Room team (CEO, analiticas, competencia, publicador, guiones, website). Owner-only, like
 * the Black Room agent routes. None of these endpoints publishes or contacts anyone: outward
 * actions come back as approvals for Robert.
 */
export function registerBlackRoomTeamRoutes(app: Express, options: BlackRoomTeamRouteOptions = {}): void {
  const requestUserId = options.requestUserId ?? defaultRequestUserId;
  const isOwner = options.isOwner ?? isConfiguredSingleUserOwner;
  const modules = options.modules ?? BLACKROOM_TEAM_MODULES;
  const running = new Set<BlackRoomTeamAgentId>();

  const owner = async (req: Request, res: Response): Promise<string | null> => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = requestUserId(req);
      if (!userId) { res.status(401).json({ error: "Inicia sesion para ver el equipo de Black Room." }); return null; }
      if (!await isOwner(userId)) { res.status(403).json({ error: "El equipo de Black Room es solo para el owner." }); return null; }
      return userId;
    } catch {
      res.status(503).json({ error: "No se pudo verificar el owner." });
      return null;
    }
  };
  const agentId = (req: Request, res: Response): BlackRoomTeamAgentId | null => {
    const id = req.params.id;
    if (!isBlackRoomTeamAgentId(id)) { res.status(404).json({ error: "Agente de Black Room desconocido." }); return null; }
    return id;
  };
  const contextOptions = (userId: string): BlackRoomTeamContextOptions => ({ ...options.context, modules, userId });

  app.get("/api/blackroom-team", async (req, res) => {
    const userId = await owner(req, res);
    if (!userId) return;
    res.json({ agents: await getAllBlackRoomTeamStatuses(contextOptions(userId)) });
  });

  app.get("/api/blackroom-team/:id/status", async (req, res) => {
    const userId = await owner(req, res);
    if (!userId) return;
    const id = agentId(req, res);
    if (!id) return;
    res.json(await getBlackRoomTeamStatus(id, contextOptions(userId)));
  });

  const execute = async (req: Request, res: Response, id: BlackRoomTeamAgentId, userId: string, work: (input: Record<string, unknown>) => Promise<BlackRoomTeamRunResult>) => {
    const input = inputFrom(req.body);
    if (!input) return res.status(400).json({ error: "El cuerpo debe ser un objeto JSON." });
    if (running.has(id)) return res.status(409).json({ error: "Este agente ya esta trabajando. Espera a que termine." });
    running.add(id);
    try {
      sendResult(res, await work(input));
    } catch (error) {
      res.status(500).json({ ok: false, summary: "La ejecucion fallo.", error: error instanceof Error ? error.message.slice(0, 200) : "sin detalle" });
    } finally {
      running.delete(id);
    }
  };

  app.post("/api/blackroom-team/:id/run", async (req, res) => {
    const userId = await owner(req, res);
    if (!userId) return;
    const id = agentId(req, res);
    if (!id) return;
    await execute(req, res, id, userId, (input) => modules[id].run(createBlackRoomTeamContext(id, contextOptions(userId)), input));
  });

  app.post("/api/blackroom-team/:id/action/:action", async (req, res) => {
    const userId = await owner(req, res);
    if (!userId) return;
    const id = agentId(req, res);
    if (!id) return;
    const name = req.params.action;
    const handler = isBlackRoomTeamActionName(name) && modules[id].actions && Object.prototype.hasOwnProperty.call(modules[id].actions, name) ? modules[id].actions![name] : undefined;
    if (!handler) return res.status(404).json({ error: "Accion desconocida para este agente." });
    await execute(req, res, id, userId, (input) => handler(createBlackRoomTeamContext(id, contextOptions(userId)), input));
  });
}
