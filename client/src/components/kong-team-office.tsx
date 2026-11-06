import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildOfficeCityRoomsFromSnapshot,
  officeCityCountries,
  parseOfficeCityDirectory,
  officeCitySnapshotExpiresAt,
} from "@/lib/office-city-agents";
import { useAgentLiveStatuses, useCouncil } from "@/components/agents-building/agents-building";
import { OFFICE_KONG_CITY_TASKS } from "@shared/office-kong-supervisor";
import { KONG_ON_DEMAND_IDS, kongCareerId } from "@shared/kong-office-agents";
import type { OfficeKongAuditResult } from "../../../server/office-kong";

// One KONG office: every KONG agent (central desks, content and the 7 desks of every city) is a
// visible desk with its real status, life and task. There is no separate city office.

const priority = [
  "customer_operations", "venue_deals", "finance_risk", "growth_analytics",
  "promoters_partnerships", "city_operations",
];
const mediaIds = ["kong-videos", "kong-metrics"];
type Tone = "working" | "attention" | "idle" | "demand";
const labels: Record<string, { text: string; tone: Tone }> = {
  running: { text: "En ejecución", tone: "working" },
  healthy: { text: "Trabajo verificado", tone: "working" },
  attention: { text: "Requiere atención", tone: "attention" },
  disabled: { text: "Deshabilitado", tone: "idle" },
  stale: { text: "Evidencia vencida", tone: "idle" },
  unknown: { text: "Sin evidencia reciente", tone: "idle" },
};
const toneFromLive: Record<string, Tone> = { working: "working", error: "attention", "needs-setup": "attention", offline: "idle", checking: "idle" };
const toneStyle: Record<Tone, { avatar: string; dot: string; text: string }> = {
  working: { avatar: "border-emerald-300 bg-emerald-400/20 text-emerald-100 shadow-[0_0_14px_rgba(52,211,153,0.45)]", dot: "bg-emerald-400 animate-pulse", text: "text-emerald-200" },
  attention: { avatar: "border-amber-300 bg-amber-400/15 text-amber-100", dot: "bg-amber-400", text: "text-amber-200" },
  idle: { avatar: "border-slate-500 bg-slate-700/40 text-slate-300", dot: "bg-slate-500", text: "text-slate-400" },
  demand: { avatar: "border-cyan-300/60 bg-cyan-400/10 text-cyan-100", dot: "bg-cyan-300", text: "text-cyan-200" },
};
type Career = { battery: number; points: number; nickname?: string; generation?: number; firedCount?: number };
type Desk = {
  id: string; careerId: string; name: string; owner: string; responsibility: string;
  status: string; tone: Tone; lastRunAt: string | null; blocker: string | null; cityId?: string;
};
const searchKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const initials = (name: string) => name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "K";
const when = (value: string | null) => value ? new Date(value).toLocaleString("es", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" }) : "Sin registro";

function Battery({ career }: { career?: Career }) {
  if (!career) return <span className="text-[10px] text-slate-500">Vida: sin datos aún</span>;
  const color = career.battery > 60 ? "bg-emerald-400" : career.battery > 25 ? "bg-amber-400" : "bg-rose-400";
  return (
    <span className="flex items-center gap-1.5" title={`Vida ${career.battery}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10"><span className={`block h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, career.battery))}%` }} /></span>
      <span className="font-mono text-[10px] text-slate-300">{career.battery}%</span>
    </span>
  );
}

export function KongTeamOffice({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [country, setCountry] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const panel = dialog.current;
    panel?.showModal();
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearInterval(timer); panel?.close(); };
  }, []);
  const directory = useQuery<unknown>({ queryKey: ["/api/agents-office/cities"], refetchInterval: 60_000, retry: 2 });
  const snapshot = useQuery<OfficeKongAuditResult>({ queryKey: ["/api/agents-office/kong-snapshot"], refetchInterval: 60_000, retry: 2 });
  const council = useCouncil();
  const careers = ((council.view as { company?: { careers?: Record<string, Career> } } | null)?.company?.careers) || {};
  const media = useAgentLiveStatuses(mediaIds, { data: null, isError: false });
  const evidence = snapshot.data?.evidence;
  const age = evidence ? now - Date.parse(evidence.generatedAt) : Infinity;
  const current = !snapshot.isError && age >= -30_000 && age <= 300_000;
  const cities = parseOfficeCityDirectory(directory.data);
  const cityEvidence = current && !directory.isError ? evidence : undefined;
  const rooms = buildOfficeCityRoomsFromSnapshot(cities, cityEvidence, now);
  const expiresAt = officeCitySnapshotExpiresAt(cityEvidence, now);
  useEffect(() => {
    if (expiresAt === undefined || !Number.isFinite(expiresAt) || expiresAt < now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [expiresAt, now]);
  const countries = officeCityCountries(cities);

  const team: Desk[] = (evidence?.agents ?? []).filter(agent => agent.kind !== "city").map(agent => {
    const label = labels[current ? agent.state : "unknown"];
    const demand = KONG_ON_DEMAND_IDS.has(agent.id);
    return {
      id: agent.id, careerId: kongCareerId(agent.id), name: agent.name, owner: agent.owner, responsibility: agent.responsibility,
      status: demand ? "Bajo demanda" : label.text, tone: demand ? "demand" : label.tone,
      lastRunAt: agent.lastRunAt, blocker: agent.blocker,
    };
  });
  for (const [id, name, owner, responsibility] of [
    ["kong-videos", "Videos KONG", "Contenido", "Recibir fichas verificadas y preparar videos para el publicador autorizado."],
    ["kong-metrics", "Métricas KONG", "Crecimiento y analítica", "Medir resultados por publicación confirmada."],
  ] as const) {
    const live = media[id];
    team.push({ id, careerId: id, name, owner, responsibility, status: live?.label ?? labels.unknown.text, tone: live ? toneFromLive[live.state] ?? "idle" : "idle",
      lastRunAt: null, blocker: live?.state === "error" ? live.detail ?? null : null });
  }
  const byId = new Map(team.map(desk => [desk.id, desk]));
  const cityAgents = new Map((evidence?.agents ?? []).filter(agent => agent.kind === "city").map(agent => [agent.id.replace(/^city:/, ""), agent]));
  const cityDesks: Desk[] = rooms.flatMap(room => room.agents.map(agent => ({
    id: agent.id, careerId: kongCareerId(`city:${room.city.id}`), name: agent.name, owner: "Coordinador de ciudades",
    responsibility: OFFICE_KONG_CITY_TASKS[agent.category], status: agent.status.label,
    tone: toneFromLive[agent.status.state] ?? "idle", lastRunAt: agent.lastWorkAt,
    blocker: agent.recordedFailure || agent.status.state === "needs-setup" ? agent.blocker : null, cityId: room.city.id,
  })));
  const all = [...byId.values(), ...cityDesks];
  const desk = all.find(agent => agent.id === selected);
  const query = searchKey(search.trim());
  const matches = (agent: Desk) => !query || searchKey(`${agent.name} ${agent.responsibility} ${agent.owner} ${agent.status}`).includes(query);
  const working = all.filter(agent => agent.tone === "working").length;
  const attention = all.filter(agent => agent.tone === "attention").length;
  const ceo = byId.get("chief_of_staff");
  const priorityDesks = priority.flatMap(id => byId.get(id) ? [byId.get(id)!] : []).filter(matches);
  const otherDesks = [...byId.values()].filter(agent => agent.id !== "chief_of_staff" && !priority.includes(agent.id)).filter(matches);
  const visibleRooms = rooms.filter(room => !country || room.city.countryCode === country)
    .map(room => ({ room, desks: cityDesks.filter(agent => agent.cityId === room.city.id).filter(agent => matches(agent) || searchKey(room.name).includes(query)) }))
    .filter(entry => entry.desks.length > 0);

  const deskCard = (agent: Desk, compact = false) => {
    const style = toneStyle[agent.tone];
    const career = careers[agent.careerId];
    return (
      <button key={agent.id} type="button" data-testid={`kong-desk-${agent.id}`} aria-pressed={agent.id === selected}
        onClick={() => setSelected(agent.id === selected ? "" : agent.id)}
        className={`group flex w-full items-center gap-2 rounded-xl border border-white/10 bg-slate-900/80 text-left hover:border-white/30 focus-visible:outline focus-visible:outline-cyan-200 ${compact ? "p-1.5" : "p-2.5"} ${agent.id === selected ? "ring-2 ring-cyan-300/70" : ""}`}>
        <span className={`relative grid shrink-0 place-items-center rounded-full border-2 font-bold ${compact ? "h-8 w-8 text-[10px]" : "h-11 w-11 text-xs"} ${style.avatar}`} aria-hidden="true">
          {initials(compact ? agent.name.split(" · ").pop() || agent.name : agent.name)}
          <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950 ${style.dot}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold text-slate-100 ${compact ? "text-[11px]" : "text-sm"}`}>{compact ? agent.name.split(" · ").pop() : agent.name}</span>
          <span className={`block truncate text-[10px] ${style.text}`}>{agent.status}</span>
          {!compact && <span className="mt-0.5 block"><Battery career={career} /></span>}
        </span>
      </button>
    );
  };

  return (
    <dialog ref={dialog} aria-labelledby="kong-team-title" data-testid="kong-team-office" onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[94dvh] w-[min(98vw,90rem)] overflow-auto rounded-2xl border border-lime-300/30 bg-slate-950 px-3 pb-3 pt-0 text-slate-100 backdrop:bg-black/75 sm:px-5 sm:pb-5">
      <header className="sticky top-0 z-10 -mx-3 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950 px-3 py-3 sm:-mx-5 sm:px-5">
        <div>
          <h2 id="kong-team-title" className="text-xl font-bold text-lime-200">Oficina KONG</h2>
          <p className="text-xs text-slate-300" data-testid="kong-office-summary">
            {all.length} agentes · <span className="text-emerald-300">{working} trabajando</span> · <span className="text-amber-200">{attention} requieren atención</span> · {rooms.length} ciudades
          </p>
        </div>
        <button type="button" className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" onClick={onClose}>Volver a la oficina principal</button>
      </header>
      {!current && <p role="status" className="mt-3 text-sm text-amber-200">{snapshot.isLoading ? "Consultando KONG…" : "Actividad de KONG sin verificar. Comprueba la conexión con el backend."}</p>}
      {directory.isError && <p role="status" className="mt-2 text-sm text-amber-200">El directorio de ciudades no está disponible.</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-xs text-slate-300" htmlFor="kong-team-search">Buscar agente, ciudad o función
          <input id="kong-team-search" value={search} onChange={event => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-white/25 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label className="text-xs text-slate-300" htmlFor="kong-team-country">País
          <select id="kong-team-country" value={country} onChange={event => setCountry(event.target.value)} className="mt-1 block rounded-lg border border-white/25 bg-slate-900 px-2 py-2 text-sm text-slate-100">
            <option value="">Todos</option>
            {countries.map(item => <option key={item.code} value={item.code}>{item.name} ({item.cityCount})</option>)}
          </select>
        </label>
      </div>

      {desk && <section aria-live="polite" data-testid="kong-desk-detail" className="mt-3 rounded-xl border border-cyan-300/30 bg-slate-900 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{desk.name}{careers[desk.careerId]?.nickname ? <span className="ml-2 text-xs font-normal text-slate-400">({careers[desk.careerId]!.nickname}{(careers[desk.careerId]!.generation ?? 1) > 1 ? ` · relevo ${careers[desk.careerId]!.generation}` : ""})</span> : null}</h3>
          <Battery career={careers[desk.careerId]} />
        </div>
        <p className="mt-1 text-sm">{desk.responsibility}</p>
        <p className="mt-1 text-sm">Responsable · {byId.get(desk.owner)?.name ?? desk.owner}</p>
        <p className={`text-sm ${toneStyle[desk.tone].text}`}>{desk.status}</p>
        <p className="text-sm">Última evidencia · {when(desk.lastRunAt)}</p>
        {careers[desk.careerId] && <p className="text-xs text-slate-400">Puntos {careers[desk.careerId]!.points} · relevos {careers[desk.careerId]!.firedCount ?? 0}</p>}
        {media[desk.id]?.activity?.map(detail => <p key={detail} className="text-sm">{detail}</p>)}
        {desk.blocker && <p className="text-sm text-amber-200">Bloqueo · {desk.blocker}</p>}
      </section>}

      <section aria-label="Dirección KONG" className="mt-4 rounded-2xl border border-cyan-300/25 p-3">
        <h3 className="text-center text-xs font-semibold uppercase tracking-wider text-cyan-200">Dirección · operación prioritaria</h3>
        <div className="mx-auto mt-3 grid max-w-5xl grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ceo && matches(ceo) && <div className="rounded-2xl border border-amber-300/60 bg-amber-300/5 p-1 sm:col-span-2 lg:col-span-3 lg:mx-auto lg:w-1/3">{deskCard(ceo)}</div>}
          {priorityDesks.map(agent => deskCard(agent))}
        </div>
      </section>

      {otherDesks.length > 0 && <section aria-label="Departamentos y sistemas" className="mt-4">
        <h3 className="text-sm font-semibold">Departamentos, sistemas y contenido</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{otherDesks.map(agent => deskCard(agent))}</div>
      </section>}

      <section aria-label="Ciudades" className="mt-5">
        <h3 className="text-sm font-semibold">Ciudades · {visibleRooms.length} de {rooms.length}</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRooms.map(({ room, desks }) => {
            const cityAgent = cityAgents.get(room.city.id);
            const cityCareer = careers[kongCareerId(`city:${room.city.id}`)];
            const busy = desks.filter(agent => agent.tone === "working").length;
            return (
              <article key={room.id} data-testid={`kong-city-room-${room.city.id}`} className="rounded-2xl border border-lime-300/20 bg-slate-900/40 p-2.5">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-bold text-lime-100">{room.name}</h4>
                    <p className="text-[10px] text-slate-400">{busy}/{room.agents.length} trabajando{cityAgent?.nextRunAt ? ` · próxima ronda ${when(cityAgent.nextRunAt)}` : ""}</p>
                  </div>
                  <Battery career={cityCareer} />
                </header>
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">{desks.map(agent => deskCard(agent, true))}</div>
              </article>
            );
          })}
        </div>
        {!rooms.length && <p className="mt-2 text-sm text-slate-400">{directory.isLoading ? "Cargando ciudades…" : "Sin ciudades registradas."}</p>}
      </section>
    </dialog>
  );
}
