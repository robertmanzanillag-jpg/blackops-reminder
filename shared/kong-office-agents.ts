import type { AgentLiveState, AgentLiveStatus } from "./agent-live-status";

// KONG agents (central departments, systems and one agent per city) as they appear in the
// read-only KONG operations snapshot. Their careers (life, battery, points, replacement) live in
// the council under `kong:<snapshot id>`; the KONG backend keeps doing the actual work.
export type KongEvidenceAgent = {
  id: string;
  name: string;
  kind: "coordinator" | "department" | "city" | "system";
  state: "healthy" | "running" | "attention" | "stale" | "unknown" | "disabled";
  blocker?: string | null;
  lastRunAt?: string | null;
};

export const KONG_CAREER_PREFIX = "kong:";

/** Agents that only run when someone asks: never scored or replaced for being idle. */
export const KONG_ON_DEMAND_IDS = new Set(["restaurant_secretary", "legacy_ceo", "restaurant_deals", "kong_ai_chat"]);

export function kongCareerId(agentId: string): string {
  return `${KONG_CAREER_PREFIX}${agentId}`;
}

const STATE_MAP: Record<Exclude<KongEvidenceAgent["state"], "disabled">, { state: AgentLiveState; label: string }> = {
  running: { state: "working", label: "En ejecución verificada" },
  healthy: { state: "working", label: "Trabajo verificado" },
  attention: { state: "error", label: "Requiere atención" },
  stale: { state: "offline", label: "Evidencia vencida" },
  unknown: { state: "offline", label: "Sin evidencia reciente" },
};

/**
 * Turns the KONG snapshot into council statuses. Only verified evidence earns "working";
 * disabled and on-demand agents are left out (never scored). Returns the role names too.
 */
export function kongAgentStatuses(agents: readonly KongEvidenceAgent[]): {
  statuses: Record<string, AgentLiveStatus>;
  roles: Record<string, string>;
} {
  const statuses: Record<string, AgentLiveStatus> = {};
  const roles: Record<string, string> = {};
  for (const agent of agents) {
    if (agent.state === "disabled" || KONG_ON_DEMAND_IDS.has(agent.id)) continue;
    const id = kongCareerId(agent.id);
    const mapped = STATE_MAP[agent.state];
    statuses[id] = { ...mapped, ...(agent.blocker ? { detail: agent.blocker.slice(0, 160) } : {}) };
    roles[id] = agent.kind === "city" ? `KONG ${agent.name}` : agent.name;
  }
  return { statuses, roles };
}

export function isKongCareerId(id: string): boolean {
  return id.startsWith(KONG_CAREER_PREFIX);
}
