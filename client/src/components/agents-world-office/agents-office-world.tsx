import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { runProbe, type AgentLiveState, type AgentLiveStatus } from "@/lib/agent-live-status";
import {
  AgentsBuilding,
  councilDeskStatus,
  useAgentLiveStatuses,
  useCouncil,
  type BuildingAgent,
  type BuildingTeamAgent,
} from "@/components/agents-building/agents-building";
import { personalityFor, type AgentCareer, type CompanyOrder, type CompanyState, type LeaderboardRow, type Personality, type Trainee } from "@shared/agent-company";
import { CITY_NEWS_AGENTS } from "@shared/agent-live-status";
import { INTEGRATION_LABEL, effectiveIntegrations, integrationFor, type AgentIntegration } from "@shared/agent-integrations";
import { createOfficeScene, type SceneData, type SceneDepartment } from "./office-scene";

export type WorldAgent = BuildingAgent & { activity?: string; href?: string };

// Real agents that live in the backend but not in the classic office list.
const EXTRA_AGENTS: Array<{ id: string; name: string; role: string; description: string; color: string; href?: string }> = [
  { id: "blackroom-videos", name: "Videos Black Room", role: "Sube los videos de Black Room", description: "Edita y programa los videos de Black Room con su dispositivo de publicacion.", color: "#e879f9", href: "/clippers" },
  { id: "kong-videos", name: "Videos Kong", role: "Edita los videos de Kong", description: "Edita los videos de Kong y los guarda en Drive (Videos de Kong).", color: "#a3e635", href: "/promo-video" },
  { id: "news", name: "Noticias", role: "Jefe de noticias locales", description: "Coordina las mesas de cada ciudad y el comite de revision antes de publicar.", color: "#38bdf8", href: "/news" },
  ...CITY_NEWS_AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: `Mesa de noticias de ${agent.city}`,
    description: `Cubre ${agent.city}: noticias activas, cola de posts y metas diarias por cuenta de esta ciudad.`,
    color: agent.lane === "miami-news" ? "#fb923c" : "#60a5fa",
    href: "/news",
  })),
];

const COUNCIL_AGENTS: Record<string, { name: string; role: string; description: string; color: string }> = {
  "skills-scout": { name: "Skills Scout", role: "Novedades y skills", description: "Revisa una vez al dia los releases publicos y propone mejoras a las skills (gratis).", color: "#c084fc" },
  "agent-factory": { name: "Fabrica de agentes", role: "El CEO contrata", description: "Detecta agentes trabados y propone ayudantes nuevos; los nuevos pasan por la academia.", color: "#fbbf24" },
  mechanic: { name: "Mecanico", role: "Repara agentes", description: "Cuando un agente se queda sin bateria, abre la reparacion con el brief listo para un PR.", color: "#f97316" },
};

const DEPARTMENTS: Array<{ id: string; name: string; color: string; agentIds: string[] }> = [
  { id: "consejo", name: "Consejo", color: "#c084fc", agentIds: ["skills-scout", "agent-factory", "mechanic"] },
  { id: "direccion", name: "Direccion", color: "#fbbf24", agentIds: ["ceo", "assistant", "control"] },
  { id: "negocios", name: "Negocios", color: "#34d399", agentIds: ["revenue", "dropshipping", "portfolio"] },
  { id: "blackroom", name: "Black Room", color: "#e879f9", agentIds: ["blackroom-videos", "radio"] },
  { id: "kong", name: "Kong", color: "#a3e635", agentIds: ["kong-videos", "kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal"] },
  { id: "medios", name: "Marketing y medios", color: "#f472b6", agentIds: ["marketing-cmo", "clippers"] },
  { id: "ciudades", name: "Ciudades", color: "#fb923c", agentIds: ["news", ...CITY_NEWS_AGENTS.map((agent) => agent.id)] },
  { id: "ingenieria", name: "Ingenieria y app", color: "#38bdf8", agentIds: ["code", "github", "claude-reviewer", "app-qa"] },
  { id: "seguridad", name: "Seguridad y legal", color: "#a78bfa", agentIds: ["cybersecurity", "legal"] },
  { id: "operaciones", name: "Operaciones", color: "#2dd4bf", agentIds: ["automations"] },
];

const SCREEN_KIND: Record<string, SceneDepartment["agents"][number]["screen"]> = {
  radio: "timeline", clippers: "timeline", "blackroom-videos": "timeline", "kong-videos": "timeline", "news:miami-news": "list", "news:ny-news": "list",
  revenue: "chart", portfolio: "chart", "marketing-cmo": "chart", dropshipping: "chart", news: "chart",
  code: "code", github: "code", "claude-reviewer": "code", "app-qa": "code", cybersecurity: "code", mechanic: "code",
};

const SOURCE_NAME: Record<string, string> = {
  assistant: "Google Calendar", ceo: "Telegram + IA", control: "Salud de apps", revenue: "Stripe", dropshipping: "Shopify (pre-cuentas)",
  portfolio: "Mercados", "marketing-cmo": "Clientes de marketing", clippers: "Worker de clips", radio: "Calendario de radio",
  code: "GitHub", github: "GitHub", "claude-reviewer": "GitHub", "app-qa": "Salud de apps", cybersecurity: "Salud de apps",
  legal: "Reportes legales", automations: "Automatizaciones", "skills-scout": "Releases de GitHub", "agent-factory": "Consejo de agentes",
  mechanic: "Consejo de agentes", "blackroom-videos": "Publicador Black Room", news: "Noticias locales", "kong-videos": "Publicador externo KONG (Codex)",
  "news:miami-news": "Noticias locales", "news:ny-news": "Noticias locales",
};

const STATE_TEXT: Record<AgentLiveState, string> = {
  working: "text-emerald-300", "needs-setup": "text-amber-200", error: "text-rose-300", offline: "text-zinc-400", checking: "text-sky-200",
};
const STATE_BAR: Record<AgentLiveState, string> = {
  working: "bg-emerald-400", "needs-setup": "bg-amber-300", error: "bg-rose-400", offline: "bg-zinc-600", checking: "bg-sky-300",
};

type CompanyView = { company?: CompanyState; leaderboard?: LeaderboardRow[]; personalities?: Record<string, Personality>; integrations?: Record<string, AgentIntegration> };
export type WorldContact = { id: string; name: string; role: string; department: string; status: AgentLiveStatus; description: string; href?: string; color: string };
type PanelAgent = { id: string; name: string; role: string; description: string; href?: string; status: AgentLiveStatus; kong?: boolean; color: string };

export function AgentsOfficeWorld({
  agents,
  kongTeam,
  legal,
  selectedAgentId,
  onSelectAgent,
  onSelectKongAgent,
  onOpenContact,
}: {
  agents: WorldAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  selectedAgentId?: string;
  onSelectAgent: (agentId: string, status: AgentLiveStatus) => void;
  onSelectKongAgent: (name: string) => void;
  // Opens the same local chat for agents that are not in the classic list (cities, new agents, trainees).
  onOpenContact?: (contact: WorldContact) => void;
}) {
  const pageAgentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const probedIds = useMemo(() => [...pageAgentIds, ...EXTRA_AGENTS.map((agent) => agent.id)], [pageAgentIds]);
  const liveStatuses = useAgentLiveStatuses(probedIds, legal);
  const council = useCouncil();
  const companyView = (council.view || {}) as unknown as CompanyView;
  const company = companyView.company;
  const careers: Record<string, AgentCareer> = company?.careers || {};
  const leaderboardRows = companyView.leaderboard || [];
  const personalities = companyView.personalities || {};
  const integrations = companyView.integrations || effectiveIntegrations();
  const deputyId = leaderboardRows[0]?.points ? leaderboardRows[0].agentId : null;
  const queryClient = useQueryClient();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ReturnType<typeof createOfficeScene> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [focusedDepartment, setFocusedDepartment] = useState<string | null>(null);
  const [panelAgentId, setPanelAgentId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"none" | "ranking" | "ceo">("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [orderText, setOrderText] = useState("");

  // Approved council lessons change how an agent is reported (same rule as the building).
  const statuses: Record<string, AgentLiveStatus> = { ...liveStatuses };
  for (const [agentId, override] of Object.entries(council.view?.overrides || {})) {
    const current = statuses[agentId];
    if (current && current.state === "working") statuses[agentId] = { ...current, state: "needs-setup", label: override.label, detail: override.detail };
  }
  statuses["skills-scout"] = councilDeskStatus(council.view, "scout", council.error);
  statuses["agent-factory"] = councilDeskStatus(council.view, "factory", council.error);
  statuses.mechanic = !council.view
    ? { state: council.error ? "offline" : "checking", label: council.error ? "Sin conexion" : "Verificando..." }
    : council.view.lastCycleError
      ? { state: "error", label: "La ultima ronda fallo", detail: council.view.lastCycleError }
      : council.view.cycles === 0
        ? { state: "checking", label: "Primera ronda pendiente" }
        : council.view.enabled === false
          ? { state: "offline", label: "Consejo apagado" }
          : !council.view.lastCycleAt || Date.now() - Date.parse(council.view.lastCycleAt) > 45 * 60_000
            ? { state: "offline", label: "Sin rondas recientes", detail: "El servidor no ha corrido el consejo en los ultimos 45 minutos." }
            : { state: "working", label: `${(council.view.proposals || []).filter((p) => p.kind === "repair" && p.status === "submitted").length} reparaciones abiertas`, activity: Object.values(careers).filter((c) => c.battery < 30).slice(0, 4).map((c) => `Revisando ${c.agentId} (${c.battery}%)`) };
  // Work done outside BlackOps (the KONG publisher in Codex) is not visible here: say so instead of
  // reporting the local Drive folder as if it were that work.
  for (const [id, integration] of Object.entries(integrations)) {
    if (integration.mode !== "externa" || !statuses[id]) continue;
    statuses[id] = { state: "offline", label: integration.owner === "externo:codex" ? "Externo · lo publica Codex" : "Externo", detail: integration.reason, activity: ["Publicador externo: un solo publicador", ...(statuses[id].activity || [])].slice(0, 4), problems: statuses[id].problems };
  }
  for (const member of kongTeam) {
    statuses[`kong:${member.name}`] = { state: "offline", label: "Sin backend propio", detail: "Responde con guias locales; no ejecuta tareas en Kong.", activity: ["Esperando su backend", "Guia local activa"] };
  }

  const panelAgents = new Map<string, PanelAgent>();
  for (const agent of agents) panelAgents.set(agent.id, { id: agent.id, name: agent.name, role: agent.role, description: agent.activity || agent.role, href: agent.href, status: statuses[agent.id] ?? { state: "checking", label: "Verificando..." }, color: colorFromGradient(agent.color) });
  for (const agent of EXTRA_AGENTS) panelAgents.set(agent.id, { ...agent, status: statuses[agent.id] ?? { state: "checking", label: "Verificando..." } });
  for (const [id, agent] of Object.entries(COUNCIL_AGENTS)) panelAgents.set(id, { id, ...agent, status: statuses[id] });
  for (const member of kongTeam) panelAgents.set(`kong:${member.name}`, { id: `kong:${member.name}`, name: member.name, role: member.job, description: "Equipo de kong-nightlife: guia local, todavia sin backend propio.", status: statuses[`kong:${member.name}`], kong: true, color: "#a3e635" });

  const trainees: Trainee[] = (company?.trainees || []).filter((trainee) => !trainee.graduatedAt);
  const departments = [
    ...DEPARTMENTS,
    ...(trainees.length ? [{ id: "academia", name: "Academia", color: "#60a5fa", agentIds: trainees.map((trainee) => `trainee:${trainee.id}`) }] : []),
  ];
  for (const trainee of trainees) {
    panelAgents.set(`trainee:${trainee.id}`, {
      id: `trainee:${trainee.id}`,
      name: trainee.nickname,
      role: `En formacion: ${trainee.role}`,
      description: `Estudia los documentos y la base de datos de la empresa antes de trabajar. Lleva ${trainee.modulesDone.length} ${trainee.modulesDone.length === 1 ? "modulo" : "modulos"}.`,
      status: { state: "checking", label: `Estudiando · ${trainee.modulesDone.length} ${trainee.modulesDone.length === 1 ? "modulo" : "modulos"}`, activity: trainee.knowledge.slice(0, 4) },
      color: "#60a5fa",
    });
  }

  const sceneData: SceneData = {
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
      color: department.color,
      agents: department.agentIds
        .map((id) => panelAgents.get(id))
        .filter((agent): agent is PanelAgent => Boolean(agent))
        .map((agent) => {
          const career = careers[agent.id];
          return {
            id: agent.id,
            name: agent.name,
            label: agent.status.label,
            state: agent.status.state,
            color: agent.color,
            screen: SCREEN_KIND[agent.id] || "list",
            activity: agent.status.activity || [agent.status.label, agent.status.detail || ""].filter(Boolean),
            badge: integrationFor(agent.id, integrations).mode !== "activa"
              ? INTEGRATION_LABEL[integrationFor(agent.id, integrations).mode]
              : career ? `${career.nickname} · ${career.points} pts` : undefined,
            battery: career?.battery,
            deputy: agent.id === deputyId,
            student: agent.id.startsWith("trainee:"),
          };
        }),
    })),
    debates: (council.view?.debates || []).filter((debate) => debate.verdict !== "descartado").map((debate) => ({ from: debate.reviewer, to: debate.subject })),
  };
  const sceneKey = JSON.stringify(sceneData);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    const reducedMotion = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    // @ts-ignore three ships without type declarations in this repo; the scene module types it loosely.
    import("three")
      .then((THREE: unknown) => {
        if (cancelled) return;
        try {
          sceneRef.current = createOfficeScene(THREE, host, labels, {
            onFocusDepartment: (id) => setFocusedDepartment(id),
            onSelectAgent: (id) => setPanelAgentId(id),
          }, { reducedMotion });
          sceneRef.current.update(JSON.parse(sceneKey));
        } catch (error) {
          setFailed(error instanceof Error ? error.message : "WebGL no disponible");
        }
      })
      .catch((error: unknown) => setFailed(error instanceof Error ? error.message : "No se pudo cargar el motor 3D"));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // The scene is created once; data changes go through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.update(JSON.parse(sceneKey));
  }, [sceneKey]);

  const post = async (url: string, body?: unknown) =>
    runProbe(url, (input, init) => fetch(input, { ...init, method: "POST", headers: { ...(init?.headers || {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

  const refreshCouncil = () => queryClient.invalidateQueries({ queryKey: ["agent-council-state"] });

  const runCouncil = async () => {
    setBusy(true);
    const result = await post("/api/agent-council/run");
    setMessage(result.ok ? "El consejo se reunio." : result.status === 429 ? "El consejo acaba de reunirse; espera un minuto." : result.status === 409 ? "El consejo esta apagado." : "No se pudo reunir al consejo.");
    await refreshCouncil();
    setBusy(false);
  };

  const sendOrder = async () => {
    const text = orderText.trim();
    if (!text) return;
    setBusy(true);
    const result = await post("/api/agent-company/orders", { text });
    if (result.ok) {
      setOrderText("");
      setMessage("El CEO recibio la orden y la asigno.");
    } else {
      setMessage((result.body as { error?: string } | null)?.error || "No se pudo enviar la orden.");
    }
    await refreshCouncil();
    setBusy(false);
  };

  const markDone = async (orderId: string, evidenceRunId?: string) => {
    setBusy(true);
    const result = await post(`/api/agent-company/orders/${encodeURIComponent(orderId)}/done`, evidenceRunId ? { evidenceRunId } : {});
    setMessage(result.ok ? (evidenceRunId ? "Orden cerrada con evidencia: puntos para quien trabajaba." : "Orden cerrada a mano: queda anotada, sin puntos.") : (result.body as { error?: string } | null)?.error || "No se pudo cerrar la orden.");
    await refreshCouncil();
    setBusy(false);
  };

  if (failed) {
    return (
      <div className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-24">
        <p className="mx-auto mb-4 max-w-[900px] rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100" data-testid="world-fallback">
          Este navegador no pudo abrir la oficina 3D ({failed}). Te muestro el edificio con los mismos datos en vivo.
        </p>
        <AgentsBuilding agents={agents} kongTeam={kongTeam} legal={legal} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} onSelectKongAgent={onSelectKongAgent} />
      </div>
    );
  }

  const companyIds = DEPARTMENTS.flatMap((department) => department.agentIds);
  const workingCount = companyIds.filter((id) => statuses[id]?.state === "working").length;
  const focused = departments.find((department) => department.id === focusedDepartment) || null;
  const focusedAgents = focused ? focused.agentIds.map((id) => panelAgents.get(id)).filter((agent): agent is PanelAgent => Boolean(agent)) : [];
  const panelAgent = (panelAgentId && focusedAgents.find((agent) => agent.id === panelAgentId)) || focusedAgents[0] || null;
  const focusedIds = new Set(focused?.agentIds || []);
  const proposals = (council.view?.proposals || []).filter((proposal) => ["submitted", "pending_submit", "not_submitted"].includes(proposal.status) && (focusedIds.has(proposal.owner) || (proposal.lesson && focusedIds.has(proposal.lesson.subject)) || [...focusedIds].some((id) => proposal.key.startsWith(`repair:${id}#`))));
  const debates = (council.view?.debates || []).filter((debate) => focusedIds.has(debate.reviewer) || focusedIds.has(debate.subject));
  const sourceMap = new Map<string, { name: string; state: AgentLiveState; label: string; users: string[] }>();
  const rank: Record<AgentLiveState, number> = { error: 4, "needs-setup": 3, offline: 2, checking: 1, working: 0 };
  for (const agent of focusedAgents) {
    if (agent.id.startsWith("trainee:")) continue;
    const name = agent.kong ? "Kong (sin backend)" : SOURCE_NAME[agent.id] || agent.name;
    const current = sourceMap.get(name);
    if (!current) sourceMap.set(name, { name, state: agent.status.state, label: agent.status.label, users: [agent.name] });
    else {
      current.users.push(agent.name);
      if (rank[agent.status.state] > rank[current.state]) Object.assign(current, { state: agent.status.state, label: agent.status.label });
    }
  }
  const sources = Array.from(sourceMap.values());
  const orders: CompanyOrder[] = company?.orders || [];
  const nameOf = (id: string) => panelAgents.get(id)?.name || id;
  const panelCareer = panelAgent ? careers[panelAgent.id] : undefined;
  // Every agent has a personality: from its career when it has one, otherwise the same deterministic pick.
  const panelPersonality = panelAgent ? personalities[panelAgent.id] || personalityFor(panelAgent.id, 1) : undefined;
  const panelIntegration = panelAgent ? integrationFor(panelAgent.id, integrations) : undefined;
  const lifeNotApplicable = !panelAgent
    ? ""
    : panelAgent.id.startsWith("trainee:")
      ? "En formacion en la academia: empieza a ganar o perder vida cuando se gradue."
      : panelIntegration && panelIntegration.mode !== "activa"
        ? panelIntegration.reason
        : COUNCIL_AGENTS[panelAgent.id]
          ? "Parte del consejo: revisa a los demas y no se mide a si mismo."
          : panelAgent.id === "ceo"
            ? "El CEO dirige; no compite en la tabla."
            : "Se le abre la carrera en la proxima ronda del consejo (cada 15 min).";
  const evidenceRuns = ((queryClient.getQueryData(["agents-building-probe", "automation-runs"]) as { ok?: boolean; body?: unknown } | undefined)?.body as Array<{ id?: string; status?: string; resultSummary?: string | null; startedAt?: string }> | undefined || [])
    .filter((run) => run && typeof run.id === "string" && run.status === "success")
    .slice(0, 10);
  const panelRank = panelAgent ? leaderboardRows.find((row) => row.agentId === panelAgent.id) : undefined;
  const panelOrders = panelAgent ? orders.filter((order) => order.assignees.some((assignee) => assignee.agentId === panelAgent.id)).slice(0, 4) : [];

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#04060b]" data-testid="agents-office-world">
      <div ref={hostRef} className="absolute inset-0" data-testid="world-canvas-host" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      <div className="pointer-events-none absolute left-3 top-20 z-10 max-w-[min(540px,92vw)] rounded-2xl border border-white/10 bg-[#04060b]/90 p-3 shadow-2xl backdrop-blur sm:left-20">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">BlackOps · la empresa</p>
        <p className="mt-1 text-lg font-black text-white sm:text-2xl" data-testid="world-working-count">{workingCount} de {companyIds.length} agentes trabajando</p>
        <p className="mt-1 text-xs text-zinc-400">
          {council.view ? `${trainees.length} en la academia · ${council.view.debates.length} debates · consejo cada 15 min · costo $0` : council.error || "Consejo conectando..."}
        </p>
        {company?.events?.[0] && <p className="mt-1 truncate text-[11px] text-violet-200" data-testid="world-last-event">Ultimo: {company.events[0].text}</p>}
        <div className="pointer-events-auto mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => sceneRef.current?.focusDepartment(null)} className="rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10" data-testid="world-overview">Vista general</button>
          <button type="button" onClick={() => setOverlay(overlay === "ceo" ? "none" : "ceo")} className="rounded-full border border-amber-200/40 bg-amber-400/20 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-400/35" data-testid="world-ceo-channel">Canal con el CEO</button>
          <button type="button" onClick={() => setOverlay(overlay === "ranking" ? "none" : "ranking")} className="rounded-full border border-emerald-200/40 bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-400/30" data-testid="world-ranking">Tabla de posiciones</button>
          <button type="button" onClick={runCouncil} disabled={busy || !council.view} className="rounded-full border border-violet-200/40 bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-50 hover:bg-violet-500/35 disabled:opacity-50" data-testid="world-council-run">Reunir consejo</button>
        </div>
        <nav className="pointer-events-auto mt-2 flex max-w-full gap-1.5 overflow-x-auto pb-1" aria-label="Departamentos" data-testid="world-deptnav">
          {departments.map((department) => (
            <button
              key={department.id}
              type="button"
              onClick={() => sceneRef.current?.focusDepartment(department.id)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10",
                focusedDepartment === department.id ? "bg-white/15" : "bg-black/50",
              )}
              style={{ borderColor: `${department.color}88` }}
              data-testid={`world-nav-${department.id}`}
            >
              {department.name}
            </button>
          ))}
        </nav>
        {message && <p className="mt-2 text-xs text-violet-100" data-testid="world-message">{message}</p>}
      </div>

      {overlay === "ranking" && (
        <section className="absolute bottom-3 left-3 z-30 max-h-[55%] w-[min(380px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-emerald-200/20 bg-[#06100d]/95 p-4 text-white shadow-2xl" data-testid="world-ranking-panel">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200">Tabla de posiciones</p>
            <button type="button" onClick={() => setOverlay("none")} className="text-xs text-zinc-400 hover:text-white">✕</button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">Puntos por trabajar de verdad y por ordenes que apruebas. El primero queda de Subdirector, debajo del CEO.</p>
          {leaderboardRows.length === 0 && <p className="mt-3 text-xs text-zinc-400">Todavia no hay puntos: se reparten en cada reunion del consejo.</p>}
          <ol className="mt-3 space-y-1.5">
            {leaderboardRows.slice(0, 15).map((row) => (
              <li key={row.agentId} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px]" data-testid="world-ranking-row">
                <span className="w-6 text-center font-black text-zinc-300">{row.rank === 1 ? "👑" : row.rank}</span>
                <span className="min-w-0 flex-1 truncate"><b>{nameOf(row.agentId)}</b> <span className="text-zinc-400">· {row.nickname} · {row.title}</span></span>
                <span className="font-mono text-emerald-200">{row.points}</span>
                <span className={cn("font-mono", row.battery > 60 ? "text-emerald-300" : row.battery > 25 ? "text-amber-200" : "text-rose-300")}>{row.battery}%</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {overlay === "ceo" && (
        <section className="absolute bottom-3 left-3 z-30 flex max-h-[60%] w-[min(420px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-4 text-white shadow-2xl" data-testid="world-ceo-panel">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">Canal directo con el CEO</p>
            <button type="button" onClick={() => setOverlay("none")} className="text-xs text-zinc-400 hover:text-white">✕</button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">Escribe lo que necesitas y el CEO lo asigna al departamento correcto. Queda anotado como tarea: los agentes no la ejecutan solos. Para dar puntos, cierrala con una ejecucion exitosa como evidencia; cerrarla a mano solo la anota.</p>
          <div className="mt-3 flex gap-2">
            <input
              value={orderText}
              onChange={(event) => setOrderText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void sendOrder(); }}
              placeholder="Ej: sube el video nuevo de Black Room"
              maxLength={500}
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-amber-200/50 focus:outline-none"
              data-testid="world-order-input"
            />
            <button type="button" onClick={sendOrder} disabled={busy || !orderText.trim()} className="rounded-full bg-amber-300 px-3 py-2 text-xs font-bold text-black hover:bg-amber-200 disabled:opacity-50" data-testid="world-order-send">Enviar</button>
          </div>
          <div className="mt-3 space-y-2 overflow-y-auto">
            {orders.length === 0 && <p className="text-xs text-zinc-500">Todavia no hay ordenes.</p>}
            {orders.slice(0, 8).map((order) => (
              <div key={order.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2" data-testid="world-order">
                <p className="text-xs text-white">{order.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {order.assignees.map((assignee) => (
                    <span key={assignee.agentId} title={assignee.note} className={cn("rounded-full border px-2 py-0.5 text-[10px]", assignee.status === "hecha" ? "border-emerald-300/40 text-emerald-200" : assignee.status === "en_curso" ? "border-sky-300/40 text-sky-100" : "border-rose-300/40 text-rose-200")}>
                      {nameOf(assignee.agentId)} · {assignee.status === "en_curso" ? "asignada" : assignee.status === "bloqueada" ? "agente parado" : assignee.status}
                    </span>
                  ))}
                </div>
                {order.doneAt && (
                  <p className="mt-1 text-[10px] text-zinc-500">{order.closedBy === "evidencia" ? `Cerrada con evidencia: ${order.evidence?.summary || ""}` : "Cerrada a mano (sin puntos)"}</p>
                )}
                {!order.doneAt && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select
                      defaultValue=""
                      disabled={busy || evidenceRuns.length === 0}
                      onChange={(event) => { if (event.target.value) void markDone(order.id, event.target.value); }}
                      className="max-w-[220px] rounded-full border border-emerald-300/30 bg-black/60 px-2 py-0.5 text-[10px] text-emerald-100"
                      data-testid="world-order-evidence"
                    >
                      <option value="">{evidenceRuns.length ? "Cerrar con evidencia..." : "Sin ejecuciones exitosas"}</option>
                      {evidenceRuns.map((run) => <option key={run.id} value={run.id}>{(run.resultSummary || "Ejecucion exitosa").slice(0, 40)}</option>)}
                    </select>
                    <button type="button" onClick={() => markDone(order.id)} disabled={busy} className="text-[10px] font-semibold text-zinc-300 hover:underline" data-testid="world-order-done">Cerrar a mano (0 pts)</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!focused && overlay === "none" && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-zinc-300">
          Arrastra para girar · rueda para acercar · toca un departamento para entrar
        </p>
      )}

      {focused && (
        <aside className="absolute bottom-3 right-3 top-[42%] z-20 flex w-[min(390px,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-2xl border border-white/10 bg-[#070b14]/95 p-4 text-white shadow-2xl backdrop-blur sm:top-20" data-testid="world-panel">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: focused.color }}>{focused.name}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{focusedAgents.filter((agent) => agent.status.state === "working").length} de {focusedAgents.length} trabajando ahora</p>
            </div>
            <button type="button" onClick={() => sceneRef.current?.focusDepartment(null)} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10" aria-label="Cerrar departamento">✕</button>
          </div>

          {sources.length > 0 && (
            <section className="mt-4">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                <span>Fuentes conectadas</span>
                <span className="text-emerald-300">{sources.filter((source) => source.state === "working").length} live</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {sources.map((source) => (
                  <div key={`src-${source.name}`} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5" title={source.users.join(", ")}>
                    <p className="truncate text-[11px] font-semibold">{source.name}</p>
                    <p className={cn("truncate text-[10px]", STATE_TEXT[source.state])}>● {source.state === "working" ? `conectado · ${source.users.length} agente${source.users.length === 1 ? "" : "s"}` : source.label}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{focused.id === "academia" ? "Alumnos" : "Agentes en paralelo"}</p>
            <div className="mt-2 space-y-1.5">
              {focusedAgents.map((agent) => {
                const career = careers[agent.id];
                return (
                  <button key={`row-${agent.id}`} type="button" onClick={() => setPanelAgentId(agent.id)} className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5", panelAgent?.id === agent.id && "bg-white/[0.06]")} data-testid={`world-agent-row-${agent.id}`}>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-mono text-zinc-100">{agent.id === deputyId ? "👑 " : ""}{agent.name}{career ? <span className="text-zinc-500"> · {career.nickname}</span> : null}</span>
                      <span className={cn("truncate text-[10px]", STATE_TEXT[agent.status.state])}>{agent.status.label}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div className={cn("h-full rounded-full", STATE_BAR[agent.status.state], agent.status.state === "working" ? "w-1/2 motion-safe:animate-[world-progress_2.4s_ease-in-out_infinite]" : agent.status.state === "error" ? "w-full" : "w-1/4")} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {panelAgent && (
            <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="world-agent-card">
              <p className="text-sm font-bold">{panelAgent.name}{panelCareer ? <span className="font-normal text-zinc-400"> · {panelCareer.nickname} (gen {panelCareer.generation})</span> : null}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{panelAgent.role}{panelRank ? ` · #${panelRank.rank} · ${panelRank.title}` : ""}</p>
              {panelIntegration && panelIntegration.mode !== "activa" && (
                <p className="mt-1 inline-block rounded-full border border-sky-200/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-100" data-testid="world-integration">
                  {INTEGRATION_LABEL[panelIntegration.mode]}{panelIntegration.owner === "externo:codex" ? " · Codex" : ""}
                </p>
              )}
              {panelCareer && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-center" data-testid="world-career">
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Bateria</p><p className={cn("text-sm font-bold", panelCareer.battery > 60 ? "text-emerald-300" : panelCareer.battery > 25 ? "text-amber-200" : "text-rose-300")}>{panelCareer.battery}%</p></div>
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Puntos</p><p className="text-sm font-bold text-white">{panelCareer.points}</p></div>
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Confiable</p><p className="text-sm font-bold text-white">{panelRank?.reliability ?? 0}%</p></div>
                </div>
              )}
              {panelCareer && panelIntegration?.mode === "activa" && !COUNCIL_AGENTS[panelAgent.id] && panelAgent.id !== "ceo" && (
                <p className="mt-1 text-[10px] text-zinc-500" data-testid="world-rotation">
                  Rotacion: si su vida llega a 0% el CEO lo reemplaza y el nuevo pasa por la academia.{panelCareer.firedCount ? ` Ya rotado ${panelCareer.firedCount} ${panelCareer.firedCount === 1 ? "vez" : "veces"}.` : ""}
                </p>
              )}
              {(!panelCareer || (panelIntegration && panelIntegration.mode !== "activa")) && (
                <div className="mt-2 rounded-lg bg-black/40 p-2 text-[11px]" data-testid="world-life-na">
                  <span className="font-semibold text-zinc-200">Vida: {panelCareer ? `${panelCareer.battery}% (congelada)` : "no aplica"}</span>
                  <span className="text-zinc-400"> · {lifeNotApplicable}</span>
                </div>
              )}
              {panelPersonality && (
                <p className="mt-2 text-[11px] text-zinc-300">Personalidad: {panelPersonality.traits.join(", ")} · <i>"{panelPersonality.motto}"</i></p>
              )}
              <p className="mt-2 text-xs leading-5 text-zinc-300">{panelAgent.description}</p>
              <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/40 p-2">
                <p className={cn("text-[11px] font-semibold", STATE_TEXT[panelAgent.status.state])}>Ahora: {panelAgent.status.label}</p>
                {panelAgent.status.detail && <p className="mt-0.5 text-[11px] text-zinc-400">{panelAgent.status.detail}</p>}
              </div>
              {(panelAgent.status.problems || []).length > 0 && (
                <div className="mt-2 rounded-lg border border-rose-300/20 bg-rose-500/5 p-2 text-[11px] text-rose-100" data-testid="world-problems">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-rose-200">Problemas</p>
                  {(panelAgent.status.problems || []).map((problem) => <p key={problem}>· {problem}</p>)}
                </div>
              )}
              {(panelAgent.status.activity || []).length > 0 && (
                <div className="mt-2 rounded-lg bg-[#020617] p-2 font-mono text-[10px] leading-4 text-zinc-300">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-zinc-500">Trabajo en vivo</p>
                  {(panelAgent.status.activity || []).map((line, index) => <p key={`${index}-${line}`} className="truncate">&gt; {line}</p>)}
                </div>
              )}
              {panelCareer && panelCareer.memory.length > 0 && (
                <div className="mt-2 rounded-lg border border-violet-300/15 bg-violet-500/5 p-2 text-[10px] leading-4 text-zinc-300" data-testid="world-brain">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-violet-200">Cerebro · lo que recuerda</p>
                  {panelCareer.memory.slice(0, 5).map((entry, index) => <p key={`${index}-${entry.at}`} className="truncate" title={entry.text}>· {entry.text}</p>)}
                </div>
              )}
              {panelOrders.length > 0 && (
                <div className="mt-2 text-[10px] text-zinc-300">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-amber-200">Ordenes del CEO</p>
                  {panelOrders.map((order) => <p key={order.id} className="truncate">· {order.text} <span className="text-zinc-500">({order.doneAt ? "hecha" : order.assignees.find((a) => a.agentId === panelAgent.id)?.status})</span></p>)}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (panelAgent.kong) onSelectKongAgent(panelAgent.name);
                    else if (pageAgentIds.includes(panelAgent.id)) onSelectAgent(panelAgent.id, panelAgent.status);
                    else onOpenContact?.({ id: panelAgent.id, name: panelAgent.name, role: panelAgent.role, department: focused?.name || "Oficina", status: panelAgent.status, description: panelAgent.description, href: panelAgent.href, color: panelAgent.color });
                  }}
                  disabled={!panelAgent.kong && !pageAgentIds.includes(panelAgent.id) && !onOpenContact}
                  className="flex-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-40"
                  data-testid="world-talk"
                >
                  Hablar con el agente
                </button>
                {panelAgent.href && <a href={panelAgent.href} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Abrir</a>}
              </div>
            </section>
          )}

          {proposals.length > 0 && (
            <section className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">Esperando tu OK</p>
              {proposals.slice(0, 4).map((proposal) => (
                <a key={proposal.key} href="/" className="mt-1.5 block rounded-lg border border-amber-200/20 bg-amber-300/5 px-2 py-1.5 text-[11px] text-amber-50 hover:bg-amber-300/10" title={proposal.description}>
                  {proposal.title} <span className="text-amber-200/70">· aprobar en el Trust Center</span>
                </a>
              ))}
            </section>
          )}

          {debates.length > 0 && (
            <section className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-200">Debates del consejo</p>
              {debates.slice(0, 3).map((debate) => (
                <div key={debate.key} className="mt-1.5 rounded-lg border border-violet-300/20 bg-violet-500/5 px-2 py-1.5 text-[11px]">
                  <p className="text-violet-100">{nameOf(debate.reviewer)} → {nameOf(debate.subject)}</p>
                  <p className="mt-0.5 text-zinc-300">{debate.claim}</p>
                  <p className="mt-0.5 text-zinc-500">CEO: {debate.verdict}</p>
                </div>
              ))}
            </section>
          )}
        </aside>
      )}
    </div>
  );
}

// Agents carry Tailwind gradient classes ("from-sky-400 to-cyan-300"); the 3D figures need a hex color.
const TAILWIND_HEX: Record<string, string> = {
  sky: "#38bdf8", cyan: "#22d3ee", amber: "#fbbf24", orange: "#fb923c", emerald: "#34d399", lime: "#a3e635", blue: "#60a5fa",
  zinc: "#a1a1aa", slate: "#94a3b8", violet: "#a78bfa", fuchsia: "#e879f9", rose: "#fb7185", pink: "#f472b6", red: "#f87171",
  teal: "#2dd4bf", indigo: "#818cf8", purple: "#c084fc", stone: "#a8a29e", green: "#4ade80", yellow: "#facc15",
};
function colorFromGradient(gradient: string): string {
  const match = gradient.match(/from-([a-z]+)-/);
  return (match && TAILWIND_HEX[match[1]]) || "#94a3b8";
}
