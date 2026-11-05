// The supervisor reviews existing read-only signals. It does not produce videos,
// contact promoters, give legal advice or execute commercial orders.
export const KONG_WORKERS = ["kong-videos", "kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal"] as const;
export type KongWorkerId = typeof KONG_WORKERS[number];
export type SupervisionResult = "completed" | "blocked" | "failed";
export type SupervisionRecord = {
  agentId: KongWorkerId;
  task: "review-readiness";
  checkedAt: string;
  result: SupervisionResult;
  reason: string;
};
export type KongSupervision = { version: 1; owner: "kong-supervisor"; lastRunAt: string | null; records: SupervisionRecord[] };
export function emptyKongSupervision(): KongSupervision {
  return { version: 1, owner: "kong-supervisor", lastRunAt: null, records: [] };
}
export function parseKongSupervision(value: unknown): KongSupervision {
  const input = value as Partial<KongSupervision> | null;
  if (!input || input.version !== 1 || !Array.isArray(input.records)) return emptyKongSupervision();
  const records = input.records.filter((item): item is SupervisionRecord => Boolean(item) && KONG_WORKERS.includes(item.agentId) && item.task === "review-readiness" && ["completed", "blocked", "failed"].includes(item.result) && typeof item.reason === "string" && typeof item.checkedAt === "string" && Number.isFinite(Date.parse(item.checkedAt))).slice(0, 50);
  return { version: 1, owner: "kong-supervisor", lastRunAt: typeof input.lastRunAt === "string" && Number.isFinite(Date.parse(input.lastRunAt)) ? input.lastRunAt : null, records };
}
// Only the video reader exists in this application. Other roles remain blocked
// until a real adapter is implemented; UI names alone never grant a capability.
export function reviewKongReadiness(previous: KongSupervision, statuses: Record<string, { state: string }>, now: number): KongSupervision {
  const checkedAt = new Date(now).toISOString();
  const records: SupervisionRecord[] = KONG_WORKERS.map((agentId) => {
    const base = { agentId, task: "review-readiness" as const, checkedAt };
    if (agentId !== "kong-videos") return { ...base, result: "blocked", reason: "Falta un servicio de ejecucion para este rol. No se ha ejecutado una orden." };
    const signal = statuses[agentId];
    if (!signal || signal.state === "checking") return { ...base, result: "blocked", reason: "No hay una lectura de estado disponible en este ciclo." };
    if (["error", "offline"].includes(signal.state)) return { ...base, result: "failed", reason: "La lectura de estado del servicio de video no esta disponible." };
    if (signal.state === "needs-setup") return { ...base, result: "blocked", reason: "El servicio de video informa dependencias o contenido pendientes." };
    if (signal.state !== "working") return { ...base, result: "blocked", reason: "El servicio no aporta un estado reconocido." };
    return { ...base, result: "completed", reason: "Revision de disponibilidad completada con una lectura del servicio. No se produjo ni publico contenido." };
  });
  return { version: 1, owner: "kong-supervisor", lastRunAt: checkedAt, records: [...records, ...previous.records].slice(0, 50) };
}
