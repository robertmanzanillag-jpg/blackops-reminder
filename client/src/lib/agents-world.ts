/** Read-only adapters. Catalog describes capabilities, never live activity. */
export type Area = "Oficina" | "KONG" | "Black Room" | "Daily Planner" | "Contenido";
export type Signal = "Sin señal" | "No verificado" | "Señal reciente" | "Obsoleto";
export type Entity = { id: string; name: string; area: Area; role: string; href?: string; signal: Signal; lastSignal?: string; task: string; dependencies: string; result: string; evidence: string; connection: "Catálogo · sin telemetría" | "Registro de usuario" | "Fuente owner" | "No conectado" };
export type Source = { state: "loading" | "ready" | "denied" | "error"; data?: unknown };
export const areas: Area[] = ["Oficina", "KONG", "Black Room", "Daily Planner", "Contenido"];
const catalog = [
  ["assistant", "Asistente", "Agenda y memoria", "/assistant"],
  ["ceo", "CEO", "Prioridades y riesgos", "/ceo"],
  ["revenue", "Revenue", "Deals y websites", "/revenue-engine"],
  ["dropshipping", "Dropshipping CEO", "Comercio", "/dropshipping-ceo"],
  ["marketing-cmo", "Marketing CMO", "Marketing", "/marketing-command-center"],
  ["code", "Code", "Desarrollo", "/code-agent"],
  ["github", "GitHub", "Repositorios", "/github-agent"],
  ["claude-reviewer", "Claude Reviewer", "Revisión", "/github-agent"],
  ["portfolio", "Portfolio", "Finanzas", "/portfolio"],
  ["radio", "Radio", "Radio", "/radio"],
  ["clippers", "Clippers", "Contenido", "/clippers"],
  ["automations", "Autos", "Automatizaciones", "/automations"],
  ["cybersecurity", "Cybersecurity", "Seguridad", "/cybersecurity-agent"],
  ["app-qa", "App QA", "Calidad", "/app-qa-agent"],
  ["legal", "Legal / Compliance", "Cumplimiento", "/legal-compliance"],
  ["control", "Control / Permisos", "Permisos", "/tools"],
];
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : undefined;
export function freshness(value: unknown, now: number, maxAge = 15 * 60_000): Signal {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000) return "No verificado";
  return now - timestamp > maxAge ? "Obsoleto" : "Señal reciente";
}
function blank(id: string, name: string, area: Area, role: string, href?: string): Entity {
  return { id, name, area, role, href, signal: "Sin señal", task: "Sin tarea actual verificada", dependencies: "No verificadas: la fuente no declara dependencias", result: "No verificado", evidence: "Sin evidencia de ejecución", connection: "Catálogo · sin telemetría" };
}
function sourceEvidence(source: Source, endpoint: string) {
  return `${endpoint} · ${source.state === "denied" ? "Acceso restringido" : source.state === "error" ? "Fuente no disponible" : source.state === "loading" ? "Cargando" : "Lectura disponible"}`;
}
export function buildWorld(userId: string, projects: Source, tasks: Source, blackroom: Source, now: number): Entity[] {
  const entities = catalog.map(([id, name, role, href]) => blank(id, name, ["radio", "clippers"].includes(id) ? "Contenido" : "Oficina", role, href));
  for (const [id, name, role] of [
    ["content-preparation", "Preparación", "Fuentes y guion de contenido"],
    ["content-editing", "Edición", "Montaje, formatos y calidad"],
    ["content-publication", "Publicación", "Revisión y publicación"],
    ["content-analysis", "Análisis", "Observaciones comparables"],
    ["content-ceo", "CEO de contenido", "Hipótesis, evaluación y cambios auditables"],
  ]) {
    const entity = blank(id, name, "Contenido", role);
    entity.connection = "No conectado";
    entity.evidence = "Rol conceptual sin identidad operativa verificada. No se ha creado un agente.";
    entities.push(entity);
  }
  const kong = blank("kong", "KONG", "KONG", "Inventario de proyectos asociados", "/projects");
  kong.evidence = sourceEvidence(projects, "/api/projects");
  entities.push(kong);
  if (userId && projects.state === "ready" && Array.isArray(projects.data)) {
    for (const value of projects.data) {
      const p = record(value);
      if (p.userId !== userId || !text(p.id) || !text(p.name)) continue;
      const area: Area = /\bkong\b/i.test(`${p.name} ${text(p.description) || ""}`) ? "KONG" : "Oficina";
      const entity = blank(`project:${p.id}`, p.name as string, area, "Proyecto monitorizado", "/projects");
      entity.connection = "Registro de usuario";
      entity.lastSignal = text(p.lastCheck);
      entity.signal = p.lastCheck ? freshness(p.lastCheck, now, Math.max(15, typeof p.checkInterval === "number" && Number.isFinite(p.checkInterval) ? p.checkInterval * 3 : 15) * 60_000) : "Sin señal";
      entity.result = ["online", "offline", "degraded"].includes(String(p.status)) ? `Estado reportado: ${p.status} (salud del sitio, no ejecución del agente)` : "Estado no verificado";
      entity.evidence = `/api/projects · registro ${p.id} · ${entity.lastSignal || "sin fecha de comprobación"}`;
      entities.push(entity);
    }
  }
  const planner = blank("planner", "Daily Planner", "Daily Planner", "Agenda personal", "/");
  planner.evidence = sourceEvidence(tasks, "/api/tasks");
  entities.push(planner);
  if (userId && tasks.state === "ready" && Array.isArray(tasks.data)) {
    for (const value of tasks.data) {
      const t = record(value);
      if (t.userId !== userId || !text(t.id) || !text(t.title)) continue;
      const entity = blank(`task:${t.id}`, t.title as string, "Daily Planner", "Tarea de agenda", "/");
      entity.connection = "Registro de usuario";
      entity.task = `Registro de agenda: ${t.title}. No atribuido a un agente.`;
      entity.lastSignal = text(t.updatedAt);
      entity.signal = t.updatedAt ? freshness(t.updatedAt, now, 24 * 60 * 60_000) : "Sin señal";
      entity.result = t.completed === true ? "Marcada completada en agenda; resultado no verificado" : "Sin resultado verificado";
      entity.evidence = `/api/tasks · registro ${t.id} · fecha prevista: ${text(t.date) || "no verificada"}`;
      entities.push(entity);
    }
  }
  const room = blank("blackroom", "Black Room", "Black Room", "Señal del dispositivo protegido");
  room.evidence = sourceEvidence(blackroom, "/api/blackroom-agent");
  if (blackroom.state === "ready") {
    room.connection = "Fuente owner";
    const remote = record(record(blackroom.data).remote), device = record(remote.device);
    room.lastSignal = text(device.seenAt);
    room.signal = room.lastSignal ? freshness(room.lastSignal, now) : "Sin señal";
    // Never infer running from desiredEnabled, queue counters, or online alone.
    const events = Array.isArray(record(device.worker).activity) ? record(device.worker).activity as unknown[] : [];
    const event = events.map(record).filter(e => text(e.id) && text(e.createdAt) && Number.isFinite(Date.parse(String(e.createdAt))) && Date.parse(String(e.createdAt)) <= now).sort((a,b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)))[0];
    if (event) {
      room.result = `Último evento reportado: ${text(event.stage) || "sin etapa"} · ${text(event.level) || "sin nivel"}; resultado no verificado`;
      room.evidence = `/api/blackroom-agent · evento ${event.id} · ${event.createdAt}`;
    }
  }
  entities.push(room);
  return entities;
}
export function filterWorld(entities: Entity[], search: string, area: string, signal: string) {
  const query = search.trim().toLocaleLowerCase();
  return entities.filter(e => (area === "Todas" || e.area === area) && (signal === "Todas" || e.signal === signal) && `${e.name} ${e.role} ${e.area} ${e.task}`.toLocaleLowerCase().includes(query));
}
// GET is not a safety contract. Only these source-reviewed reads are permitted.
export const worldReadAllowlist = ["/api/auth/me", "/api/projects", "/api/tasks"] as const;
export async function readSource(endpoint: string, signal: AbortSignal): Promise<Source> {
  if (!(worldReadAllowlist as readonly string[]).includes(endpoint)) return { state: "denied" };
  try {
    const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal });
    if (response.status === 401 || response.status === 403) return { state: "denied" };
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return { state: "error" };
    const data = await response.json();
    if ((endpoint === "/api/projects" || endpoint === "/api/tasks") && !Array.isArray(data)) return { state: "error" };
    if (endpoint === "/api/blackroom-agent" && !record(data).remote) return { state: "error" };
    return { state: "ready", data };
  } catch { return { state: "error" }; }
}
