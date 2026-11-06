import type { AgentLiveStatus } from "./agent-live-status";
import type { OfficeCityRoom } from "./office-city-agents";
import type { OfficeKongAuditResult } from "../../../server/office-kong";

export type KongOfficeDesk = { id: string; name: string; role: string; description: string; color: string; status: AgentLiveStatus };
const centralGroups = [
  { id: "kong-direction", name: "Dirección KONG", color: "#fbbf24", ids: ["chief_of_staff", "city_operations", "legacy_ceo"] },
  { id: "kong-operations", name: "Operaciones KONG", color: "#a3e635", ids: ["customer_operations", "venue_deals", "promoters_partnerships", "restaurant_secretary", "restaurant_deals"] },
  { id: "kong-growth", name: "Crecimiento KONG", color: "#38bdf8", ids: ["growth_analytics", "finance_risk"] },
];
const names: Record<string, string> = { chief_of_staff: "Coordinación KONG", city_operations: "Operaciones de ciudades", legacy_ceo: "CEO bajo demanda", customer_operations: "Atención al cliente", venue_deals: "Venues", promoters_partnerships: "Promotores y mesas", restaurant_secretary: "Secretaría de restaurantes", restaurant_deals: "Acuerdos de restaurantes", growth_analytics: "Crecimiento y analítica", finance_risk: "Finanzas y riesgo", product_reliability: "Producto y fiabilidad", kong_ai_chat: "KONG AI" };

/** Shared visual vocabulary with BlackOps; activity comes only from a current KONG snapshot. */
export function buildKongOfficeWing(evidence: OfficeKongAuditResult["evidence"] | undefined, cities: OfficeCityRoom[], media: Record<string, AgentLiveStatus>, now: number) {
  const age = evidence ? now - Date.parse(evidence.generatedAt) : Infinity;
  const fresh = age >= -30_000 && age <= 300_000;
  const central = new Map((evidence?.agents ?? []).filter(agent => agent.kind !== "city").map(agent => [agent.id, agent]));
  const ids = new Set([...Object.keys(names), ...central.keys()]);
  const agents: KongOfficeDesk[] = [...ids].map(id => {
    const source = central.get(id);
    const state = fresh ? source?.state : undefined;
    const status: AgentLiveStatus = state === "running"
      ? { state: "working", label: "En ejecución registrada", detail: source?.nextAction }
      : state === "attention" ? { state: "error", label: "Requiere atención", detail: source?.blocker || source?.nextAction }
      : state === "disabled" ? { state: "offline", label: "Deshabilitado" }
      : state === "healthy" ? { state: "offline", label: "Último trabajo registrado", detail: source?.lastRunAt ? `Completado: ${source.lastRunAt}` : "Sin ejecución activa registrada" }
      : { state: "offline", label: state === "stale" ? "Evidencia vencida" : "Sin evidencia vigente" };
    if (source && fresh) { status.problems = source.issues; status.activity = [source.responsibility, source.nextAction].filter(Boolean); }
    return { id: `kong:${id}`, name: source?.name || names[id] || id, role: source?.owner || "KONG", description: source?.responsibility || "Puesto KONG; esperando evidencia del backend.", color: "#a3e635", status };
  });
  agents.push(
    { id: "kong-videos", name: "Videos KONG", role: "Contenido", description: "Recibe fichas verificadas. La publicación corresponde al publicador autorizado.", color: "#a3e635", status: media["kong-videos"] || { state: "offline", label: "Sin evidencia" } },
    { id: "kong-metrics", name: "Métricas KONG", role: "Medición", description: "Mide resultados de publicaciones confirmadas.", color: "#38bdf8", status: media["kong-metrics"] || { state: "offline", label: "Sin evidencia" } },
  );
  const grouped = new Set(centralGroups.flatMap(group => group.ids));
  const departments = [
    ...centralGroups.map(({ids, ...group}) => ({...group, agentIds: ids.map(id => `kong:${id}`)})),
    { id: "kong-systems", name: "Sistemas KONG", color: "#c084fc", agentIds: [...ids].filter(id => !grouped.has(id)).map(id => `kong:${id}`) },
    { id: "kong-media", name: "Contenido KONG", color: "#f472b6", agentIds: ["kong-videos", "kong-metrics"] },
    ...cities.map(room => ({id: room.id, name: room.name, color: "#2dd4bf", agentIds: room.agents.map(agent => agent.id)})),
  ].filter(group => group.agentIds.length);
  return { agents, departments };
}
