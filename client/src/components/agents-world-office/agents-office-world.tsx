import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { AgentCareer, CompanyOrder, CompanyState, LeaderboardRow, Personality, Trainee } from "@shared/agent-company";
import { OFFICE_KONG_CITY_TASKS, scoreOfficeKongSnapshot } from "@shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "../../../../server/office-kong";
import type { OfficeKongCollaboration } from "../../../../server/office-kong-collaboration";
import { createOfficeScene, type SceneData, type SceneDepartment } from "./office-scene";
import { buildOfficeCityRoomsFromSnapshot, officeCityCountries, officeCitySnapshotExpiresAt, parseOfficeCityDirectory, type OfficeCityAgent } from "@/lib/office-city-agents";

export type WorldAgent = BuildingAgent & { activity?: string; href?: string };

// Real agents that live in the backend but not in the classic office list.
const EXTRA_AGENTS: Array<{ id: string; name: string; role: string; description: string; color: string; href?: string }> = [
  { id: "blackroom-videos", name: "Videos Black Room", role: "Sube los videos de Black Room", description: "Edita y programa los videos de Black Room con su dispositivo de publicacion.", color: "#e879f9", href: "/clippers" },
  { id: "kong-videos", name: "Videos Kong", role: "Edita los videos de Kong", description: "Edita los videos de Kong y los guarda en Drive (Videos de Kong).", color: "#a3e635", href: "/promo-video" },
  { id: "news", name: "Noticias", role: "Agente de noticias", description: "Cubre noticias locales con comite de revision antes de publicar.", color: "#38bdf8", href: "/news" },
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
  { id: "medios", name: "Marketing y medios", color: "#f472b6", agentIds: ["marketing-cmo", "clippers", "news"] },
  { id: "ingenieria", name: "Ingenieria y app", color: "#38bdf8", agentIds: ["code", "github", "claude-reviewer", "app-qa"] },
  { id: "seguridad", name: "Seguridad y legal", color: "#a78bfa", agentIds: ["cybersecurity", "legal"] },
  { id: "operaciones", name: "Operaciones", color: "#2dd4bf", agentIds: ["automations"] },
];

const SCREEN_KIND: Record<string, SceneDepartment["agents"][number]["screen"]> = {
  radio: "timeline", clippers: "timeline", "blackroom-videos": "timeline", "kong-videos": "timeline",
  revenue: "chart", portfolio: "chart", "marketing-cmo": "chart", dropshipping: "chart", news: "chart",
  code: "code", github: "code", "claude-reviewer": "code", "app-qa": "code", cybersecurity: "code", mechanic: "code",
};
const CITY_COUNTRY_COLORS: Record<string, string> = {
  AR: "#fbbf24", US: "#38bdf8", GB: "#c084fc", ES: "#f472b6", FR: "#2dd4bf", AE: "#a3e635",
};
const cityRefreshInterval = ({ state }: { state: { error: Error | null } }) => /^(401|403):/.test(state.error?.message ?? "") ? false as const : 60_000;

const SOURCE_NAME: Record<string, string> = {
  assistant: "Google Calendar", ceo: "Telegram + IA", control: "Salud de apps", revenue: "Stripe", dropshipping: "Shopify (pre-cuentas)",
  portfolio: "Mercados", "marketing-cmo": "Clientes de marketing", clippers: "Worker de clips", radio: "Calendario de radio",
  code: "GitHub", github: "GitHub", "claude-reviewer": "GitHub", "app-qa": "Salud de apps", cybersecurity: "Salud de apps",
  legal: "Reportes legales", automations: "Automatizaciones", "skills-scout": "Releases de GitHub", "agent-factory": "Consejo de agentes",
  mechanic: "Consejo de agentes", "blackroom-videos": "Publicador Black Room", news: "Noticias locales", "kong-videos": "Drive · Videos de Kong",
};

const STATE_TEXT: Record<AgentLiveState, string> = {
  working: "text-emerald-300", "needs-setup": "text-amber-200", error: "text-rose-300", offline: "text-zinc-400", checking: "text-sky-200",
};
const STATE_BAR: Record<AgentLiveState, string> = {
  working: "bg-emerald-400", "needs-setup": "bg-amber-300", error: "bg-rose-400", offline: "bg-zinc-600", checking: "bg-sky-300",
};

type CompanyView = { company?: CompanyState; leaderboard?: LeaderboardRow[]; personalities?: Record<string, Personality> };
type PanelAgent = { id: string; name: string; role: string; description: string; href?: string; status: AgentLiveStatus; kong?: boolean; color: string; cityAgent?: OfficeCityAgent };

export function AgentsOfficeWorld({
  agents,
  kongTeam,
  legal,
  selectedAgentId,
  onSelectAgent,
  onSelectKongAgent,
}: {
  agents: WorldAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  selectedAgentId?: string;
  onSelectAgent: (agentId: string, status: AgentLiveStatus) => void;
  onSelectKongAgent: (name: string) => void;
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
  const deputyId = leaderboardRows[0]?.points ? leaderboardRows[0].agentId : null;
  const queryClient = useQueryClient();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ReturnType<typeof createOfficeScene> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [focusedDepartment, setFocusedDepartment] = useState<string | null>(null);
  const [panelAgentId, setPanelAgentId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"none" | "ranking" | "ceo" | "city-director">("none");
  const [directorCityId, setDirectorCityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [orderText, setOrderText] = useState("");
  const [officeWing, setOfficeWing] = useState<"main" | "kong">("main");
  const [cityCountry, setCityCountry] = useState("");
  const [cityControlsOpen, setCityControlsOpen] = useState(false);
  const [mainPanelMinimized, setMainPanelMinimized] = useState(false);
  const [cityOverviewOpen, setCityOverviewOpen] = useState(false);
  const [cityDetailsOpen, setCityDetailsOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { if (failed && officeWing === "kong") setCityOverviewOpen(true); }, [failed, officeWing]);
  const cityDirectory = useQuery<unknown>({ queryKey: ["/api/agents-office/cities"], staleTime: 60_000, refetchInterval: cityRefreshInterval, retry: false });
  const citySnapshot = useQuery<OfficeKongAuditResult & { collaboration?: OfficeKongCollaboration }>({ queryKey: ["/api/agents-office/kong-snapshot"], staleTime: 45_000, refetchInterval: cityRefreshInterval, retry: false });
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  const cityEvidence = cityDirectory.isError || citySnapshot.isError ? undefined : citySnapshot.data?.evidence;
  const evidenceExpiresAt = useMemo(() => officeCitySnapshotExpiresAt(cityEvidence, clock), [cityEvidence, clock]);
  useEffect(() => {
    if (evidenceExpiresAt === undefined || !Number.isFinite(evidenceExpiresAt)) return;
    const delay = evidenceExpiresAt - Date.now();
    if (delay < 0) { setClock(Date.now()); return; }
    if (delay > 5 * 60_000 + 30_000) return;
    const timer = window.setTimeout(() => setClock(Date.now()), delay + 1);
    return () => window.clearTimeout(timer);
  }, [evidenceExpiresAt]);
  const directory = useMemo(() => clock - cityDirectory.dataUpdatedAt <= 5 * 60_000 ? parseOfficeCityDirectory(cityDirectory.data) : [], [clock, cityDirectory.data, cityDirectory.dataUpdatedAt]);
  const cityRooms = useMemo(() => buildOfficeCityRoomsFromSnapshot(directory, cityEvidence, clock), [directory, cityEvidence, clock]);
  const cityCountries = useMemo(() => officeCityCountries(directory), [directory]);
  const activeCityCountry = cityCountries.some(country => country.code === cityCountry) ? cityCountry : "";
  const filteredCityRooms = activeCityCountry ? cityRooms.filter(room => room.city.countryCode === activeCityCountry) : cityRooms;
  const selectedCity = filteredCityRooms.find(room => room.id === focusedDepartment);
  const activeCityAgents = cityRooms.flatMap(room => room.agents.filter(agent => agent.status.state === "working"));
  const cityRunning = activeCityAgents.length;
  const cityRegistered = cityRooms.reduce((count, room) => count + room.agents.filter(agent => agent.hasDurableEvidence).length, 0);
  const directorCity = cityRooms.find(room => room.city.id === directorCityId) ?? cityRooms[0];
  const citySupervision = overlay === "city-director" && cityEvidence ? scoreOfficeKongSnapshot(cityEvidence, clock) : undefined;
  const directorScore = citySupervision?.cities.find(city => city.id === directorCity?.city.id);
  const reassignmentProposals = citySupervision?.verified ? citySnapshot.data?.collaboration?.exchanges.filter(exchange => exchange.proposal.action === "review_reassignment") ?? [] : [];
  const changeWing = (wing: "main" | "kong") => {
    const department = wing === "kong" ? "kong" : null;
    setOfficeWing(wing); setFocusedDepartment(department); setPanelAgentId(null); setOverlay("none");
    setCityControlsOpen(false); setCityDetailsOpen(false); setCityCountry("");
    setCityOverviewOpen(Boolean(failed));
    sceneRef.current?.focusDepartment(department);
  };
  const focusRoom = (id: string | null) => {
    setFocusedDepartment(id); setPanelAgentId(null); sceneRef.current?.focusDepartment(id);
  };
  const openCityFromOverview = (id: string) => {
    if (!filteredCityRooms.some(room => room.id === id)) setCityCountry("");
    focusRoom(id);
    setCityDetailsOpen(true);
    setCityOverviewOpen(false);
  };

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
  for (const member of kongTeam) {
    statuses[`kong:${member.name}`] = { state: "offline", label: "Sin backend propio", detail: "Responde con guias locales; no ejecuta tareas en Kong.", activity: ["Esperando su backend", "Guia local activa"] };
  }

  const panelAgents = new Map<string, PanelAgent>();
  for (const agent of agents) panelAgents.set(agent.id, { id: agent.id, name: agent.name, role: agent.role, description: agent.activity || agent.role, href: agent.href, status: statuses[agent.id] ?? { state: "checking", label: "Verificando..." }, color: colorFromGradient(agent.color) });
  for (const agent of EXTRA_AGENTS) panelAgents.set(agent.id, { ...agent, status: statuses[agent.id] ?? { state: "checking", label: "Verificando..." } });
  for (const [id, agent] of Object.entries(COUNCIL_AGENTS)) panelAgents.set(id, { id, ...agent, status: statuses[id] });
  for (const member of kongTeam) panelAgents.set(`kong:${member.name}`, { id: `kong:${member.name}`, name: member.name, role: member.job, description: "Equipo de kong-nightlife: guia local, todavia sin backend propio.", status: statuses[`kong:${member.name}`], kong: true, color: "#a3e635" });

  const trainees: Trainee[] = (company?.trainees || []).filter((trainee) => !trainee.graduatedAt);
  const mainDepartments = [
    ...DEPARTMENTS,
    ...(trainees.length ? [{ id: "academia", name: "Academia", color: "#60a5fa", agentIds: trainees.map((trainee) => `trainee:${trainee.id}`) }] : []),
  ];
  const departments = [...mainDepartments, ...filteredCityRooms.map(room => ({
      id: room.id, name: room.name,
      color: CITY_COUNTRY_COLORS[room.city.countryCode] ?? "#a78bfa",
      agentIds: room.agents.map(agent => agent.id),
    }))];
  // City jobs never inherit council careers, lessons or optimistic live probes.
  for (const room of filteredCityRooms) for (const agent of room.agents) panelAgents.set(agent.id, {
    id: agent.id, name: agent.name, role: agent.role, description: `${agent.role} de ${room.city.name} · ${room.city.countryCode} · ${room.city.timeZone} · ${room.city.currency}`,
    status: agent.status, color: agent.color, cityAgent: agent,
  });
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
    cityAnnex: true,
    cityAnnexFocus: selectedCity?.id,
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
      color: department.color,
      agents: department.agentIds
        .map((id) => panelAgents.get(id))
        .filter((agent): agent is PanelAgent => Boolean(agent))
        .map((agent) => {
          const career = agent.cityAgent ? undefined : careers[agent.id];
          return {
            id: agent.id,
            name: agent.name,
            label: agent.status.label,
            state: agent.status.state,
            color: agent.color,
            screen: SCREEN_KIND[agent.id] || "list",
            activity: agent.status.activity || [agent.status.label, agent.status.detail || ""].filter(Boolean),
            cityRole: agent.cityAgent?.role,
            badge: career ? `${career.nickname} · ${career.points} pts` : undefined,
            battery: career?.battery,
            deputy: !agent.cityAgent && agent.id === deputyId,
            student: agent.id.startsWith("trainee:"),
          };
        }),
    })),
    debates: officeWing === "kong" ? [] : (council.view?.debates || []).filter((debate) => debate.verdict !== "descartado").map((debate) => ({ from: debate.reviewer, to: debate.subject })),
  };
  const sceneKey = JSON.stringify(sceneData);
  const latestSceneKey = useRef(sceneKey);
  latestSceneKey.current = sceneKey;

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
            onFocusDepartment: (id) => {
              setFocusedDepartment(id);
              if (id === "kong") { setOfficeWing("kong"); setCityDetailsOpen(true); }
              if (id?.startsWith("kong-city:")) {
                setOfficeWing("kong");
                setPanelAgentId(null);
                setCityDetailsOpen(true);
                setCityOverviewOpen(false);
              } else if (id && id !== "kong") {
                setOfficeWing("main");
                setOverlay(value => value === "city-director" ? "none" : value);
                setPanelAgentId(null);
              }
            },
            onSelectAgent: (id) => { setPanelAgentId(id); if (id.startsWith("kong-city:")) setCityDetailsOpen(true); },
            onOpenCityDirector: () => { setOfficeWing("kong"); setOverlay(value => value === "city-director" ? "none" : "city-director"); },
          }, { reducedMotion });
          sceneRef.current.update(JSON.parse(latestSceneKey.current));
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

  const markDone = async (orderId: string) => {
    setBusy(true);
    await post(`/api/agent-company/orders/${encodeURIComponent(orderId)}/done`);
    await refreshCouncil();
    setBusy(false);
  };

  if (failed && officeWing === "main") {
    return (
      <div className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-24">
        <p className="mx-auto mb-4 max-w-[900px] rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100" data-testid="world-fallback">
          Este navegador no pudo abrir la oficina 3D ({failed}). Te muestro el edificio con los mismos datos en vivo.
        </p>
        <button type="button" onClick={() => changeWing("kong")} className="mx-auto mb-4 block rounded-full bg-violet-500 px-5 py-3 font-bold text-white" data-testid="world-kong-wing">Ver oficina KONG</button>
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
    const name = agent.cityAgent ? "Auditoria autenticada KONG" : agent.kong ? "Kong (sin backend)" : SOURCE_NAME[agent.id] || agent.name;
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
  const panelCareer = panelAgent && !panelAgent.cityAgent ? careers[panelAgent.id] : undefined;
  const panelPersonality = panelAgent && !panelAgent.cityAgent ? personalities[panelAgent.id] : undefined;
  const panelRank = panelAgent && !panelAgent.cityAgent ? leaderboardRows.find((row) => row.agentId === panelAgent.id) : undefined;
  const panelOrders = panelAgent ? orders.filter((order) => order.assignees.some((assignee) => assignee.agentId === panelAgent.id)).slice(0, 4) : [];

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#04060b]" data-testid="agents-office-world">
      <div ref={hostRef} className="absolute inset-0" data-testid="world-canvas-host" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      <div className={cn("pointer-events-none absolute left-3 z-10 rounded-2xl border border-white/10 bg-[#04060b]/90 shadow-2xl backdrop-blur", officeWing === "kong" ? "top-28 w-[min(324px,calc(100vw-1.5rem))] p-2.5 sm:top-20" : cn("bottom-3 p-2.5", !mainPanelMinimized && "w-[min(365px,calc(100vw-1.5rem))]"))}>
        <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-100/80">{officeWing === "kong" ? "KONG · agentes por ciudad" : "BlackOps · la empresa"}</p>
          {officeWing === "kong" && <button type="button" aria-expanded={cityControlsOpen} aria-controls="world-city-controls-content" onClick={() => setCityControlsOpen(open => !open)} className="pointer-events-auto shrink-0 rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10" data-testid="world-city-controls-toggle">{cityControlsOpen ? "Minimizar" : "Controles"}</button>}
          {officeWing === "main" && <button type="button" aria-expanded={!mainPanelMinimized} aria-controls="world-office-panel-content" onClick={() => setMainPanelMinimized(value => !value)} className="pointer-events-auto shrink-0 rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10" data-testid="world-main-panel-toggle">{mainPanelMinimized ? "Abrir" : "Minimizar"}</button>}
        </div>
        <div id="world-office-panel-content" hidden={officeWing === "main" && mainPanelMinimized}>
        <p className={cn("mt-1 font-black text-white", officeWing === "kong" ? "text-sm" : "text-lg sm:text-2xl")} data-testid="world-working-count">{officeWing === "kong" ? `${cityRooms.length * 7} puestos · ${cityRunning} en ejecución verificada` : `${workingCount} de ${companyIds.length} con señales operativas`}</p>
        {officeWing === "kong" && <p className="mt-1 text-[11px] text-zinc-300" data-testid="world-city-country-count">{cityCountries.length} países · {cityRooms.length} ciudades · colores por país</p>}
        {officeWing === "kong" && activeCityAgents.length > 0 && <ul aria-label="Trabajos en curso verificados" className="mt-2 space-y-1" data-testid="world-city-active-work">
          {activeCityAgents.map(agent => <li key={agent.id}>
            <button type="button" className="pointer-events-auto w-full rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2 py-1.5 text-left text-[11px] text-emerald-100 hover:bg-emerald-400/20" onClick={() => { openCityFromOverview(`kong-city:${agent.cityId}`); setPanelAgentId(agent.id); }}>
              <strong className="block">{agent.cityName} · {agent.role}</strong>
              <span>{agent.status.detail}</span>
            </button>
          </li>)}
        </ul>}
        {officeWing === "kong" && citySnapshot.isError && <p role="status" className="mt-1 text-[11px] text-amber-200" data-testid="world-city-activity-unavailable">Actividad de KONG sin conectar.</p>}
        {officeWing === "kong" && failed && <p role="status" className="mt-1 text-[11px] text-zinc-300" data-testid="world-city-map-fallback">Mapa 3D no disponible. Usa la lista de ciudades.</p>}
        {officeWing === "kong" && !cityRooms.length && <p role="status" className="mt-1 text-[11px] text-zinc-300">{cityDirectory.isLoading ? "Consultando el directorio de KONG…" : "Directorio de ciudades no disponible."}</p>}
        {officeWing === "main" && <p className="mt-1 text-xs text-zinc-400">
          {council.view ? `${trainees.length} en la academia · ${council.view.debates.length} debates · consejo cada 15 min · costo $0` : council.error || "Consejo conectando..."}
        </p>}
        {officeWing === "main" && company?.events?.[0] && <p className="mt-1 truncate text-[11px] text-violet-200" data-testid="world-last-event">Ultimo: {company.events[0].text}</p>}
        <div className={cn("pointer-events-auto flex flex-wrap gap-2", officeWing === "kong" ? "mt-2" : "mt-3")}>
          <button type="button" onClick={() => changeWing(officeWing === "kong" ? "main" : "kong")} className={cn("rounded-full border-2 border-violet-200 bg-violet-500 font-bold text-white hover:bg-violet-400", officeWing === "kong" ? "px-3 py-1 text-[11px]" : "px-4 py-2 text-sm")} data-testid="world-kong-wing">{officeWing === "kong" ? "Ver controles generales" : "Ver equipo KONG"}</button>
          {officeWing === "kong" ? (
            <>
              <button type="button" aria-expanded={cityOverviewOpen} aria-controls="world-city-overview" onClick={() => setCityOverviewOpen(open => !open)} className="rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10" data-testid="world-overview">Todas las ciudades</button>
              <button type="button" aria-expanded={overlay === "city-director"} onClick={() => { setDirectorCityId(selectedCity?.city.id ?? ""); setOverlay(overlay === "city-director" ? "none" : "city-director"); }} className="rounded-full border border-amber-200/40 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-100" data-testid="world-city-director-toggle">Director de ciudades</button>
            </>
          ) : (
            <button type="button" onClick={() => focusRoom(null)} className="rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10" data-testid="world-overview">Vista general</button>
          )}
          {officeWing === "kong" && selectedCity && <button type="button" onClick={() => focusRoom(null)} className="rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10" data-testid="world-city-return-map">Volver al mapa 3D</button>}
          {officeWing === "main" && <>
          <button type="button" onClick={() => setOverlay(overlay === "ceo" ? "none" : "ceo")} className="rounded-full border border-amber-200/40 bg-amber-400/20 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-400/35" data-testid="world-ceo-channel">Canal con el CEO</button>
          <button type="button" onClick={() => setOverlay(overlay === "ranking" ? "none" : "ranking")} className="rounded-full border border-emerald-200/40 bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-400/30" data-testid="world-ranking">Tabla de posiciones</button>
          <button type="button" onClick={runCouncil} disabled={busy || !council.view} className="rounded-full border border-violet-200/40 bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-50 hover:bg-violet-500/35 disabled:opacity-50" data-testid="world-council-run">Reunir consejo</button>
          </>}
        </div>
        {officeWing === "kong" && <div id="world-city-controls-content" hidden={!cityControlsOpen} className="pointer-events-auto mt-2 space-y-2" data-testid="world-city-controls">
          <p className="text-xs text-zinc-300">{cityRooms.length} ciudades · 7 agentes por ciudad · {cityRegistered} con registro reciente. Completado no significa trabajando.</p>
          {(cityDirectory.isError || citySnapshot.isError) && <p role="status" className="text-xs text-amber-200">{cityDirectory.isError ? "No se pudo actualizar el directorio. Solo se conserva su ultima lectura reciente." : "No se pudo consultar la actividad registrada de KONG. Los agentes aparecen sin evidencia."}</p>}
          {cityDirectory.isLoading && <p className="text-xs text-zinc-400">Consultando ciudades configuradas…</p>}
          {!cityDirectory.isLoading && cityRooms.length === 0 && <p role="status" className="text-xs text-amber-200">Directorio no disponible. No se inventaran ciudades ni agentes.</p>}
          <label className="block text-[11px] text-zinc-300" htmlFor="world-city-country-select">Filtrar por país</label>
          <select id="world-city-country-select" value={activeCityCountry} disabled={!cityCountries.length} onChange={event => { setCityCountry(event.target.value); focusRoom(null); }} className="w-full rounded-lg border border-white/20 bg-[#0b1220] px-2 py-1.5 text-xs text-white" data-testid="world-city-country-select">
            <option value="">Todos los países ({cityCountries.length})</option>
            {cityCountries.map(country => <option key={country.code} value={country.code}>{country.name} · {country.cityCount} {country.cityCount === 1 ? "ciudad" : "ciudades"}</option>)}
          </select>
          <label className="block text-[11px] text-zinc-300" htmlFor="world-city-select">Ir a una ciudad</label>
          <select id="world-city-select" value={selectedCity?.id || ""} disabled={!filteredCityRooms.length} onChange={event => { if (event.target.value) openCityFromOverview(event.target.value); else focusRoom(null); }} className="w-full rounded-lg border border-white/20 bg-[#0b1220] px-2 py-1.5 text-xs text-white" data-testid="world-city-select">
            {filteredCityRooms.length > 0 && <option value="">Elegir ciudad ({filteredCityRooms.length})</option>}
            {!filteredCityRooms.length && <option value="">Sin directorio</option>}
            {filteredCityRooms.map(room => <option key={room.id} value={room.id}>{room.name} · {room.city.countryCode}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-300">{filteredCityRooms.length} ciudades en el mapa</span>
            <button type="button" onClick={() => { setCityCountry(""); focusRoom(null); }} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black" data-testid="world-city-clear">Restablecer vista KONG</button>
          </div>
        </div>}
        {(officeWing === "main" || cityControlsOpen) && <nav className="pointer-events-auto mt-2 flex max-w-full gap-1.5 overflow-x-auto pb-1 [color-scheme:dark] [scrollbar-color:#404b63_#080c14] [scrollbar-width:thin]" aria-label="Departamentos" data-testid="world-deptnav">
          {(officeWing === "main" ? mainDepartments : departments).map((department) => (
            <button
              key={department.id}
              type="button"
              onClick={() => department.id === "kong" ? changeWing("kong") : focusRoom(department.id)}
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
        </nav>}
        {message && <p className="mt-2 text-xs text-violet-100" data-testid="world-message">{message}</p>}
        </div>
      </div>

      {officeWing === "kong" && cityOverviewOpen && (
        <section id="world-city-overview" aria-labelledby="world-city-overview-title" className="absolute inset-x-3 bottom-3 z-20 flex max-h-[min(53%,34rem)] flex-col rounded-2xl border border-white/15 bg-[#070b14]/95 p-2.5 text-white shadow-2xl sm:left-auto sm:w-[min(660px,calc(100%_-_1.5rem))] sm:max-h-[min(64%,36rem)]" data-testid="world-city-overview">
          <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
            <div>
              <h2 id="world-city-overview-title" className="text-sm font-bold">Todas las ciudades ({cityRooms.length})</h2>
              <p className="text-[11px] text-zinc-400">Elige una ciudad para ver sus siete figuras.</p>
            </div>
            <button type="button" onClick={() => setCityOverviewOpen(false)} className="shrink-0 rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold hover:bg-white/10" aria-label="Minimizar todas las ciudades">Minimizar</button>
          </div>
          {citySnapshot.isError && <p role="status" className="mb-2 shrink-0 text-[11px] text-amber-200" data-testid="world-city-overview-activity-unavailable">Actividad de KONG sin conectar. El directorio sigue visible y la actividad queda sin verificar.</p>}
          {cityRooms.length ? (
            <ul className="grid grid-cols-2 gap-1 overflow-y-auto pr-1 min-[480px]:grid-cols-3 sm:grid-cols-5">
              {cityRooms.map(room => {
                const running = room.agents.filter(agent => agent.status.state === "working").length;
                const recorded = room.agents.filter(agent => agent.hasDurableEvidence).length;
                return (
                  <li key={room.id}>
                    <button type="button" onClick={() => openCityFromOverview(room.id)} className="flex h-full w-full flex-col rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-left hover:border-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300" data-testid="world-city-overview-city">
                      <span className="text-xs font-semibold">{room.name} <span className="text-[10px] text-zinc-400">{room.city.countryCode}</span></span>
                      {room.upcomingEvents !== null && <span className="text-[10px] text-cyan-200">{room.upcomingEvents} eventos próximos · 30 días</span>}
                      <span className={cn("text-[10px]", running ? "text-emerald-300" : "text-zinc-400")}>{recorded ? `${running} verificados en ejecución · ${recorded}/7 registrados` : "Sin evidencia reciente"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p role="status" className="text-xs text-zinc-300">{cityDirectory.isLoading ? "Consultando el directorio de KONG…" : "Directorio de ciudades no disponible."}</p>}
        </section>
      )}

      {officeWing === "kong" && overlay === "city-director" && <section aria-label="Director de ciudades de KONG" data-testid="world-city-director-panel" className="absolute bottom-3 right-3 z-30 max-h-[54%] w-[min(410px,calc(100vw-1.5rem))] space-y-2 overflow-y-auto rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-3 text-xs text-white shadow-2xl [color-scheme:dark]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-amber-100">Director de ciudades · KONG</h2>
          <button type="button" onClick={() => setOverlay("none")} className="rounded-full border border-white/20 px-2 py-1">Cerrar</button>
        </div>
        <p className="text-slate-300">El coordinador de KONG asigna los turnos de los siete puestos. El director calcula los puntos con el resultado registrado y propone relevos para revisión cuando hay intentos repetidos sin éxito.</p>
        <label className="block" htmlFor="world-director-city">Equipo de ciudad</label>
        <select id="world-director-city" className="w-full rounded border border-white/20 bg-[#120d04] px-2 py-1" value={directorCity?.city.id ?? ""} disabled={!directorCity} onChange={event => setDirectorCityId(event.target.value)}>
          {cityRooms.map(room => <option key={room.id} value={room.city.id}>{room.name}</option>)}
        </select>
        {!citySupervision?.verified && <p className="text-amber-200">Sin evidencia vigente para asignar puntos o proponer relevos.</p>}
        {directorScore?.points != null && <p className="font-semibold">{directorScore.scoredCategories === directorScore.totalCategories ? "Puntos del equipo" : "Puntaje parcial"}: {directorScore.points}/100 · {directorScore.scoredCategories}/{directorScore.totalCategories} puestos verificados</p>}
        <ul className="space-y-1">{directorCity?.agents.map(agent => {
          const grade = directorScore?.categories.find(category => category.category === agent.category);
          return <li key={agent.id} className="border-t border-white/10 pt-1">
            <strong>{agent.role}</strong> · {grade?.points == null ? "Sin puntuación" : `${grade.points}/100`}
            <p>{OFFICE_KONG_CITY_TASKS[agent.category]}</p>
            <p className="text-slate-400">{agent.status.label}{agent.nextWorkAt ? ` · Próximo turno: ${formatCityTime(agent.nextWorkAt)}` : ""}</p>
          </li>;
        })}</ul>
        <h3 className="font-semibold text-amber-100">Relevos propuestos · {reassignmentProposals.length}</h3>
        {reassignmentProposals.map(item => <p key={item.id} className="text-amber-200">{cityRooms.find(room => room.city.id === item.cityId)?.name ?? item.cityId} · {item.category} · {item.proposal.text}</p>)}
        <a href="https://kongnightlife.com/admin/ceo" className="inline-block text-amber-100 underline">Abrir la revisión del CEO en KONG</a>
      </section>}
      {overlay === "ranking" && (
        <section className="absolute bottom-3 right-3 z-30 max-h-[55%] w-[min(380px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-emerald-200/20 bg-[#06100d]/95 p-4 text-white shadow-2xl [color-scheme:dark]" data-testid="world-ranking-panel">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-200">Tabla de posiciones</p>
            <button type="button" onClick={() => setOverlay("none")} className="text-xs text-zinc-400 hover:text-white">✕</button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">Puntos del consejo por señales operativas y órdenes confirmadas por ti. El primer puesto queda de subdirector.</p>
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
        <section className="absolute bottom-3 right-3 z-30 flex max-h-[60%] w-[min(420px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-amber-200/25 bg-[#120d04]/95 p-4 text-white shadow-2xl [color-scheme:dark]" data-testid="world-ceo-panel">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">Canal directo con el CEO</p>
            <button type="button" onClick={() => setOverlay("none")} className="text-xs text-zinc-400 hover:text-white">✕</button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">Escribe lo que necesitas y el CEO lo asigna al departamento correcto. Queda anotado como tarea: los agentes no la ejecutan solos. Cuando este hecha, marcala y ganan puntos los que estaban trabajando.</p>
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
                {!order.doneAt && (
                  <button type="button" onClick={() => markDone(order.id)} disabled={busy} className="mt-1.5 text-[10px] font-semibold text-emerald-200 hover:underline" data-testid="world-order-done">Marcar como hecha</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!focused && overlay === "none" && (
        <p className={cn("pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-zinc-300", officeWing === "kong" && "hidden sm:block")}>
          {failed ? "Vista sin 3D: elige una ciudad para ver sus siete agentes." : officeWing === "kong" ? "Toca una ciudad para ver sus siete agentes" : "Arrastra para girar · rueda para acercar · toca un departamento para entrar"}
        </p>
      )}

      {focused && (
        <aside className={cn("absolute bottom-3 right-3 z-20 flex flex-col rounded-2xl border border-white/10 bg-[#070b14]/95 text-white shadow-2xl backdrop-blur", selectedCity ? cn("max-h-[min(38vh,350px)] overflow-hidden p-2.5", cityDetailsOpen ? "w-[min(320px,calc(100vw-1.5rem))]" : "w-fit max-w-[min(320px,calc(100vw-1.5rem))]") : "top-[42%] w-[min(390px,calc(100vw-1.5rem))] overflow-y-auto p-4 sm:top-20")} data-testid="world-panel">
          <div className="flex shrink-0 items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: focused.color }}>{focused.name}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{focusedAgents.filter((agent) => agent.status.state === "working").length} de {focusedAgents.length} {selectedCity ? "en ejecución según la auditoría" : "con señales operativas"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {selectedCity && <button type="button" aria-expanded={cityDetailsOpen} aria-controls="world-city-details-content" onClick={() => setCityDetailsOpen(open => !open)} className="rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10" data-testid="world-city-details-toggle">{cityDetailsOpen ? "Minimizar" : "Ver detalles"}</button>}
              <button type="button" onClick={() => focusRoom(null)} className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10" aria-label="Cerrar departamento">✕</button>
            </div>
          </div>

          <div id={selectedCity ? "world-city-details-content" : undefined} hidden={Boolean(selectedCity) && !cityDetailsOpen} className={selectedCity && cityDetailsOpen ? "flex min-h-0 flex-col overflow-y-auto pr-1" : undefined}>

          {officeWing === "main" && sources.length > 0 && (
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

          <section className={selectedCity ? "mt-2" : "mt-4"}>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{focused.id === "academia" ? "Alumnos" : "Agentes en paralelo"}</p>
            <div className={selectedCity ? "mt-1 grid grid-cols-2 gap-1" : "mt-2 space-y-1.5"}>
              {focusedAgents.map((agent) => {
                const career = agent.cityAgent ? undefined : careers[agent.id];
                return (
                  <button key={`row-${agent.id}`} type="button" onClick={() => setPanelAgentId(agent.id)} className={cn("w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5", panelAgent?.id === agent.id && "bg-white/[0.06]")} data-testid={`world-agent-row-${agent.id}`}>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-mono text-zinc-100">{agent.id === deputyId ? "👑 " : ""}{agent.cityAgent ? agent.role : agent.name}{career ? <span className="text-zinc-500"> · {career.nickname}</span> : null}</span>
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
            <section className={cn("rounded-xl border border-white/10 bg-white/[0.03]", panelAgent.cityAgent ? "order-first mt-2 p-2" : "mt-4 p-3")} data-testid="world-agent-card">
              <p className="text-sm font-bold">{panelAgent.name}{panelCareer ? <span className="font-normal text-zinc-400"> · {panelCareer.nickname} (gen {panelCareer.generation})</span> : null}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{panelAgent.role}{panelRank ? ` · #${panelRank.rank} · ${panelRank.title}` : ""}</p>
              {panelCareer && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-center" data-testid="world-career">
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Bateria</p><p className={cn("text-sm font-bold", panelCareer.battery > 60 ? "text-emerald-300" : panelCareer.battery > 25 ? "text-amber-200" : "text-rose-300")}>{panelCareer.battery}%</p></div>
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Puntos</p><p className="text-sm font-bold text-white">{panelCareer.points}</p></div>
                  <div className="rounded-lg bg-black/40 p-1.5"><p className="text-[9px] uppercase text-zinc-500">Confiable</p><p className="text-sm font-bold text-white">{panelRank?.reliability ?? 0}%</p></div>
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
              {(panelAgent.status.activity || []).length > 0 && (
                <div className="mt-2 rounded-lg bg-[#020617] p-2 font-mono text-[10px] leading-4 text-zinc-300">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-zinc-500">{panelAgent.cityAgent ? "Evidencia del trabajo" : "Trabajo en vivo"}</p>
                  {(panelAgent.status.activity || []).map((line, index) => <p key={`${index}-${line}`} className="truncate">&gt; {line}</p>)}
                </div>
              )}
              {panelAgent.cityAgent && <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-300" data-testid="world-city-evidence">
                <div><dt className="text-zinc-500">Ultimo trabajo completado</dt><dd>{formatCityTime(panelAgent.cityAgent.lastWorkAt)}</dd></div>
                <div><dt className="text-zinc-500">Ultimo inicio</dt><dd>{formatCityTime(panelAgent.cityAgent.lastStartedAt)}</dd></div>
                <div><dt className="text-zinc-500">Proximo trabajo registrado</dt><dd>{formatCityTime(panelAgent.cityAgent.nextWorkAt)}</dd></div>
                <div className="col-span-2"><dt className="text-zinc-500">Bloqueo / limite actual</dt><dd>{panelAgent.cityAgent.blocker}</dd></div>
                <div><dt className="text-zinc-500">Auditoria consultada</dt><dd>{formatCityTime(panelAgent.cityAgent.snapshotAt)}</dd></div>
              </dl>}
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
              {!panelAgent.cityAgent && <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => (panelAgent.kong ? onSelectKongAgent(panelAgent.name) : pageAgentIds.includes(panelAgent.id) && onSelectAgent(panelAgent.id, panelAgent.status))}
                  disabled={!panelAgent.kong && !pageAgentIds.includes(panelAgent.id)}
                  className="flex-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-40"
                  data-testid="world-talk"
                >
                  Hablar con el agente
                </button>
                {panelAgent.href && <a href={panelAgent.href} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Abrir</a>}
              </div>}
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
          </div>
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
function formatCityTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Sin registro verificable";
  return new Date(value).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}
