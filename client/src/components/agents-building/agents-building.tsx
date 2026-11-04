import { useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  agentProbes,
  runProbe,
  summarizeProbe,
  type AgentLiveState,
  type AgentLiveStatus,
  type ProbeResult,
} from "@/lib/agent-live-status";

export type BuildingAgent = {
  id: string;
  name: string;
  role: string;
  color: string;
  icon: ComponentType<{ className?: string }>;
};

export type BuildingTeamAgent = {
  name: string;
  job: string;
};

type Floor = {
  id: string;
  level: string;
  name: string;
  agentIds: string[];
};

// Top floor first, like reading a building from the roof down.
export const buildingFloors: Floor[] = [
  { id: "direccion", level: "6", name: "Direccion", agentIds: ["ceo", "assistant", "control"] },
  { id: "negocios", level: "5", name: "Negocios", agentIds: ["revenue", "dropshipping", "portfolio"] },
  { id: "marketing", level: "4", name: "Marketing y contenido", agentIds: ["marketing-cmo", "clippers", "radio"] },
  { id: "ingenieria", level: "3", name: "Ingenieria", agentIds: ["code", "github", "claude-reviewer", "app-qa"] },
  { id: "seguridad", level: "2", name: "Seguridad y legal", agentIds: ["cybersecurity", "legal"] },
];
const KONG_LEVEL = "1";
const OPERATIONS_AGENT_IDS = ["automations"];

const stateStyle: Record<AgentLiveState, { dot: string; chip: string; text: string }> = {
  working: { dot: "bg-emerald-400", chip: "border-emerald-300/30 bg-emerald-400/10", text: "text-emerald-100" },
  "needs-setup": { dot: "bg-amber-300", chip: "border-amber-300/30 bg-amber-300/10", text: "text-amber-100" },
  error: { dot: "bg-rose-400", chip: "border-rose-300/40 bg-rose-400/10", text: "text-rose-100" },
  offline: { dot: "bg-zinc-500", chip: "border-white/10 bg-white/[0.04]", text: "text-zinc-300" },
  checking: { dot: "bg-sky-300", chip: "border-sky-300/20 bg-sky-300/10", text: "text-sky-100" },
};

export function useAgentLiveStatuses(
  agentIds: string[],
  legal: { data: unknown; isError: boolean }
): Record<string, AgentLiveStatus> {
  const uniqueProbes = useMemo(() => {
    const byKey = new Map<string, (typeof agentProbes)[string]>();
    for (const id of agentIds) {
      const probe = agentProbes[id];
      if (probe && probe.kind !== "legal" && !byKey.has(probe.key)) byKey.set(probe.key, probe);
    }
    return Array.from(byKey.values());
  }, [agentIds]);

  const results = useQueries({
    queries: uniqueProbes.map((probe) => ({
      queryKey: ["agents-building-probe", probe.key],
      queryFn: () => runProbe(probe.url),
      refetchInterval: probe.intervalMs,
      staleTime: probe.intervalMs / 2,
      retry: false,
    })),
  });

  const resultByKey = new Map<string, ProbeResult | undefined>();
  uniqueProbes.forEach((probe, index) => resultByKey.set(probe.key, results[index]?.data));
  const statuses: Record<string, AgentLiveStatus> = {};
  for (const id of agentIds) {
    const probe = agentProbes[id];
    if (!probe) {
      statuses[id] = { state: "offline", label: "Sin monitoreo" };
      continue;
    }
    if (probe.kind === "legal") {
      const legalResult: ProbeResult | undefined = legal.isError
        ? { ok: false, status: 0, body: null, networkError: true }
        : legal.data === undefined
          ? undefined
          : { ok: true, status: 200, body: legal.data };
      statuses[id] = summarizeProbe(probe, legalResult);
      continue;
    }
    statuses[id] = summarizeProbe(probe, resultByKey.get(probe.key));
  }
  return statuses;
}

function Monitor({ state }: { state: AgentLiveState }) {
  const working = state === "working";
  return (
    <span
      className={cn(
        "relative block h-9 w-14 overflow-hidden rounded-md border bg-[#030712]",
        working ? "border-cyan-200/40 shadow-[0_0_18px_rgba(34,211,238,0.35)]" : "border-white/10",
        state === "error" && "border-rose-300/50 motion-safe:animate-[agent-alert_1.4s_ease-in-out_infinite]"
      )}
    >
      {working ? (
        <span className="absolute inset-1.5 flex flex-col gap-1">
          <span className="h-1 rounded-full bg-cyan-300/80 motion-safe:animate-[agent-type_2.2s_steps(6)_infinite]" />
          <span className="h-1 rounded-full bg-emerald-300/70 motion-safe:animate-[agent-type_2.8s_steps(7)_infinite_0.4s]" />
          <span className="h-1 rounded-full bg-violet-300/70 motion-safe:animate-[agent-type_2.5s_steps(5)_infinite_0.9s]" />
        </span>
      ) : state === "needs-setup" ? (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-amber-300">!</span>
      ) : state === "error" ? (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-rose-300">×</span>
      ) : state === "checking" ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-300 motion-safe:animate-pulse" />
        </span>
      ) : null}
      <span className="absolute -bottom-0 left-1/2 h-1 w-4 -translate-x-1/2 bg-zinc-700" />
    </span>
  );
}

function Worker({ color, state, Icon }: { color: string; state: AgentLiveState; Icon?: BuildingAgent["icon"] }) {
  const working = state === "working";
  return (
    <span
      className={cn(
        "relative block h-12 w-10",
        working ? "motion-safe:animate-[agent-bob_2.4s_ease-in-out_infinite]" : "origin-bottom rotate-[-6deg] opacity-80"
      )}
    >
      <span className={cn("absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 rounded-full border border-white/30 bg-gradient-to-br", color)}>
        <span className="absolute left-1 top-2 h-1 w-1 rounded-full bg-zinc-950" />
        <span className="absolute right-1 top-2 h-1 w-1 rounded-full bg-zinc-950" />
      </span>
      <span className={cn("absolute bottom-0 left-1/2 flex h-7 w-9 -translate-x-1/2 items-center justify-center rounded-t-2xl border border-white/20 bg-gradient-to-br", color)}>
        {Icon && <Icon className="h-3 w-3 text-zinc-950/70" />}
      </span>
      {working && (
        <>
          <span className="absolute -left-0.5 bottom-1 h-1.5 w-2.5 rounded-full bg-zinc-200 motion-safe:animate-[agent-hands_0.35s_ease-in-out_infinite]" />
          <span className="absolute -right-0.5 bottom-1 h-1.5 w-2.5 rounded-full bg-zinc-200 motion-safe:animate-[agent-hands_0.35s_ease-in-out_infinite_0.17s]" />
        </>
      )}
      {state === "needs-setup" && <span className="absolute -right-2 -top-1 text-[9px] font-bold text-amber-200">?</span>}
      {(state === "offline") && <span className="absolute -right-2 -top-1 text-[9px] font-bold text-zinc-400">zz</span>}
    </span>
  );
}

function Desk({
  name,
  role,
  color,
  Icon,
  status,
  selected,
  onSelect,
  testId,
}: {
  name: string;
  role: string;
  color: string;
  Icon?: BuildingAgent["icon"];
  status: AgentLiveStatus;
  selected?: boolean;
  onSelect: () => void;
  testId: string;
}) {
  const style = stateStyle[status.state];
  return (
    <button
      type="button"
      onClick={onSelect}
      title={status.detail ? `${status.label} - ${status.detail}` : status.label}
      data-testid={testId}
      data-agent-state={status.state}
      className={cn(
        "group flex w-full min-w-0 flex-col items-center rounded-xl border px-2 pb-2 pt-3 text-left transition",
        selected ? "border-cyan-200/70 bg-cyan-300/10" : "border-white/[0.06] bg-black/20 hover:border-white/20 hover:bg-white/[0.04]"
      )}
    >
      <span className="flex items-end gap-1.5">
        <Worker color={color} state={status.state} Icon={Icon} />
        <Monitor state={status.state} />
      </span>
      <span className="mt-0.5 block h-1.5 w-[112px] rounded-sm bg-gradient-to-b from-zinc-500 to-zinc-700 shadow-[0_6px_10px_rgba(0,0,0,0.5)]" />
      <span className="mt-2 w-full truncate text-center text-xs font-semibold text-white">{name}</span>
      <span className="w-full truncate text-center text-[10px] text-zinc-500">{role}</span>
      <span className={cn("mt-1.5 flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5", style.chip)}>
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, status.state === "working" && "motion-safe:animate-pulse")} />
        <span className={cn("truncate text-[10px] font-medium", style.text)}>{status.label}</span>
      </span>
    </button>
  );
}

function FloorShell({ level, name, note, children }: { level: string; name: string; note?: string; children: ReactNode }) {
  return (
    <div className="relative flex border-b border-white/[0.07] last:border-b-0">
      <div className="flex w-10 shrink-0 flex-col items-center justify-center border-r sm:w-14 border-white/[0.07] bg-black/30 py-3">
        <span className="text-lg font-black leading-none text-white/80">{level}</span>
        <span className="mt-1 text-[8px] font-semibold uppercase tracking-[0.18em] text-zinc-500">piso</span>
      </div>
      <div className="min-w-0 flex-1 px-2 py-3 sm:px-3">
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">{name}</p>
          {note && <p className="hidden truncate text-[10px] text-zinc-500 sm:block">{note}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 md:grid-cols-4">{children}</div>
      </div>
    </div>
  );
}

export function AgentsBuilding({
  agents,
  kongTeam,
  legal,
  selectedAgentId,
  onSelectAgent,
  onSelectKongAgent,
}: {
  agents: BuildingAgent[];
  kongTeam: BuildingTeamAgent[];
  legal: { data: unknown; isError: boolean };
  selectedAgentId?: string;
  onSelectAgent: (agentId: string, status: AgentLiveStatus) => void;
  onSelectKongAgent: (name: string) => void;
}) {
  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const statuses = useAgentLiveStatuses(agentIds, legal);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const counts = useMemo(() => {
    const total: Record<AgentLiveState, number> = { working: 0, "needs-setup": 0, error: 0, offline: 0, checking: 0 };
    for (const id of agentIds) total[statuses[id]?.state ?? "checking"] += 1;
    return total;
  }, [agentIds, statuses]);

  const renderAgent = (id: string) => {
    const agent = agentById.get(id);
    if (!agent) return null;
    const status = statuses[id] ?? { state: "checking" as const, label: "Verificando..." };
    return (
      <Desk
        key={id}
        name={agent.name}
        role={agent.role}
        color={agent.color}
        Icon={agent.icon}
        status={status}
        selected={selectedAgentId === id}
        onSelect={() => onSelectAgent(id, status)}
        testId={`building-agent-${id}`}
      />
    );
  };

  const placed = new Set([...buildingFloors.flatMap((floor) => floor.agentIds), ...OPERATIONS_AGENT_IDS]);
  const unplaced = agentIds.filter((id) => !placed.has(id));

  return (
    <div className="mx-auto w-full max-w-[860px]" data-testid="agents-building">
      {/* Rooftop */}
      <div className="relative mx-auto flex h-16 w-[86%] items-end justify-center">
        <span className="absolute bottom-0 left-[18%] h-12 w-0.5 bg-zinc-600" />
        <span className="absolute bottom-12 left-[18%] h-2 w-2 -translate-x-[3px] rounded-full bg-rose-400 motion-safe:animate-[antenna-blink_1.6s_steps(2)_infinite]" />
        <span className="absolute bottom-0 right-[20%] hidden h-6 w-12 rounded-t-md sm:block border border-white/10 bg-zinc-800" />
        <div className="rounded-t-xl border border-b-0 border-cyan-200/20 bg-[#0b1220] px-5 py-2 text-center shadow-[0_-10px_40px_rgba(34,211,238,0.12)]">
          <p className="text-sm font-black tracking-[0.3em] text-white">ROBS HQ</p>
          <p className="text-[10px] font-medium text-emerald-200" data-testid="building-working-count">
            {counts.working} de {agentIds.length} agentes trabajando
          </p>
        </div>
      </div>

      <div className="relative flex overflow-hidden rounded-t-2xl border border-white/10 bg-[linear-gradient(180deg,#0d1522,#080d16)] shadow-[0_40px_80px_rgba(0,0,0,0.6)]">
        <div className="min-w-0 flex-1">
          {buildingFloors.map((floor) => (
            <FloorShell key={floor.id} level={floor.level} name={floor.name}>
              {floor.agentIds.map(renderAgent)}
            </FloorShell>
          ))}

          <FloorShell level={KONG_LEVEL} name="Kong" note="Equipo de kong-nightlife: guias, todavia sin backend propio">
            {kongTeam.map((member) => (
              <Desk
                key={member.name}
                name={member.name}
                role={member.job}
                color="from-lime-300 to-emerald-400"
                status={{ state: "offline", label: "Sin backend propio", detail: "Responde con guias locales; no ejecuta tareas en Kong." }}
                onSelect={() => onSelectKongAgent(member.name)}
                testId={`building-kong-${member.name}`}
              />
            ))}
          </FloorShell>

          <FloorShell level="PB" name="Operaciones y lobby">
            {OPERATIONS_AGENT_IDS.map(renderAgent)}
            {unplaced.map(renderAgent)}
            <div className="flex w-full flex-col items-center justify-end rounded-xl border border-dashed border-white/10 px-2 pb-2 pt-3">
              <span className="flex h-12 items-end gap-1">
                <span className="h-10 w-5 rounded-t-md border border-cyan-100/20 bg-cyan-200/10" />
                <span className="h-10 w-5 rounded-t-md border border-cyan-100/20 bg-cyan-200/10" />
              </span>
              <span className="mt-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Entrada</span>
            </div>
          </FloorShell>
        </div>

        {/* Elevator shaft */}
        <div className="relative hidden w-10 shrink-0 border-l border-white/[0.07] bg-black/40 sm:block" aria-hidden="true">
          <span className="absolute inset-x-[18px] inset-y-2 w-px bg-zinc-700" />
          <span className="absolute left-1.5 h-10 w-7 rounded-sm border border-cyan-100/30 bg-cyan-200/15 shadow-[0_0_12px_rgba(34,211,238,0.25)] motion-safe:animate-[elevator-ride_16s_ease-in-out_infinite]" />
        </div>
      </div>
      <div className="h-3 rounded-b-md bg-zinc-800" />

      <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-zinc-400">
        <Legend state="working" label={`Trabajando (${counts.working})`} />
        <Legend state="needs-setup" label={`Falta configuracion (${counts["needs-setup"]})`} />
        <Legend state="error" label={`Con error (${counts.error})`} />
        <Legend state="offline" label={`Sin respuesta (${counts.offline})`} />
        {counts.checking > 0 && <Legend state="checking" label={`Verificando (${counts.checking})`} />}
      </div>
      <p className="mt-2 text-center text-[10px] text-zinc-600">
        El estado sale del endpoint real de cada agente y se actualiza solo cada 1-2 minutos.
      </p>
    </div>
  );
}

function Legend({ state, label }: { state: AgentLiveState; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", stateStyle[state].dot)} />
      {label}
    </span>
  );
}
