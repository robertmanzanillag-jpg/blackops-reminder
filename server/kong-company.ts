import { advanceAcademy, advanceCompany, tailoredModules, type CompanyState, type CurriculumModule } from "../shared/agent-company";
import type { AgentLiveStatus } from "../shared/agent-live-status";
import { scoreOfficeKongSnapshot } from "../shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "./office-kong";
import { buildOfficeKongCollaboration, type OfficeKongCollaboration } from "./office-kong-collaboration";

export const isKongCompanyAgent = (id: string) => id.startsWith("kong:") || id.startsWith("kong-city:") || ["kong-videos", "kong-metrics", "kong-supervisor"].includes(id);
export type KongCompanyObservation = {
  company: CompanyState;
  evidenceAt: Record<string, string>;
  statuses: Record<string, { state: AgentLiveStatus["state"]; label: string }>;
  observedAt: string | null;
  collaboration: OfficeKongCollaboration;
};

/** Work is credited once per completed result, never once per poll or heartbeat. */
export function advanceKongCompany(input: {
  company: CompanyState; evidenceAt: Record<string, string>; evidence?: OfficeKongAuditResult["evidence"];
  now: number; curriculum?: CurriculumModule[];
}): KongCompanyObservation {
  const supervision = scoreOfficeKongSnapshot(input.evidence, input.now);
  const statuses: KongCompanyObservation["statuses"] = {};
  const credited: KongCompanyObservation["statuses"] = {};
  const roles: Record<string, string> = {};
  const evidenceAt = { ...input.evidenceAt };
  const collaboration = input.evidence ? buildOfficeKongCollaboration(input.evidence, input.now) : { verified: false, observedAt: null, totalFindings: 0, exchanges: [] };
  const credit = (id: string, at: string | null, status: AgentLiveStatus["state"], label: string) => {
    const time = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(time) || time > input.now || time <= Date.parse(evidenceAt[id] || "1970-01-01")) return;
    credited[id] = { state: status, label };
    evidenceAt[id] = at!;
  };
  if (supervision.verified && input.evidence) {
    for (const raw of input.evidence.agents.filter(agent => agent.kind !== "city")) {
      const id = `kong:${raw.id}`;
      roles[id] = raw.name;
      // A running label without a lease is not proof that a remote department is still executing.
      statuses[id] = { state: raw.state === "attention" ? "error" : "offline", label: raw.state === "disabled" ? "Deshabilitado" : "Sin ejecución vigente verificable" };
      if (raw.state === "healthy" && raw.lastRunAt && input.now - Date.parse(raw.lastRunAt) >= 0 && input.now - Date.parse(raw.lastRunAt) <= 24 * 60 * 60_000 && !raw.blocker && !raw.issues.length) {
        statuses[id] = { state: "offline", label: "Resultado confirmado; esperando próximo turno" };
        credit(id, raw.lastRunAt, "working", "Resultado completado verificado en KONG");
      }
    }
    for (const city of supervision.cities) for (const score of city.categories) {
      const id = `kong-city:${city.id}:${score.category}`;
      const job = input.evidence.cities.find(item => item.id === city.id)?.categories.find(item => item.category === score.category);
      roles[id] = `${city.name} · ${score.category}`;
      statuses[id] = { state: score.state === "running" ? "working" : score.state === "failed" ? "error" : "offline", label: score.reason };
      if (["completed", "scheduled", "completed_with_warnings"].includes(score.state)) credit(id, job?.lastSuccessAt ?? null, "working", score.reason);
      if (score.state === "failed") credit(id, job?.lastRunAt ?? null, "error", score.reason);
    }
  }
  const newAgents = Object.fromEntries(Object.keys(statuses).filter(id => !input.company.careers[id]).map(id => [id, { state: "checking" as const, label: "Sin resultados puntuados" }]));
  const initialized = advanceCompany(input.company, { now: input.now, statuses: newAgents, roles }).state;
  let company = advanceCompany(initialized, { now: input.now, statuses: credited, roles }).state;
  // Academy records only local curriculum study; it does not start or replace remote KONG workers.
  if (supervision.verified) company = advanceAcademy(company, trainee => [
    ...tailoredModules(company, trainee.forAgentId, { status: statuses[trainee.forAgentId], lessons: [] }),
    ...(input.curriculum || []),
  ], input.now);
  return { company, evidenceAt, statuses, observedAt: supervision.verified ? supervision.snapshotAt : null, collaboration };
}
