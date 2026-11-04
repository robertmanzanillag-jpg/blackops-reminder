// BlackOps as a company: careers, points, battery, academy, CEO orders and personalities.
//
// Pure and deterministic ($0, no AI). The server runs `advanceCompany` once per council cycle
// with every agent's REAL status, and Robert's orders/feedback through the CEO channel.
// Points only come from real evidence: an agent earns them while its endpoint says it works,
// and when Robert marks one of its orders as done. Nothing here edits code: a "fired" agent is
// replaced by a new hire that trains in the academy, and the Mechanic opens a repair proposal.

import type { AgentLiveState } from "./agent-live-status";

export type Personality = { nickname: string; traits: string[]; motto: string };

export type MemoryEntry = { at: string; text: string };

export type AgentCareer = {
  agentId: string;
  generation: number;
  nickname: string;
  points: number;
  battery: number;
  lastState: AgentLiveState | null;
  cyclesWorking: number;
  cyclesTotal: number;
  ordersDone: number;
  firedCount: number;
  hiredAt: string;
  memory: MemoryEntry[];
  inTrainingUntilGeneration?: number;
};

export type Trainee = {
  id: string;
  forAgentId: string;
  role: string;
  nickname: string;
  startedAt: string;
  modulesDone: string[];
  knowledge: string[];
  graduatedAt?: string;
};

export type OrderStatus = "en_curso" | "bloqueada" | "hecha";
export type CompanyOrder = {
  id: string;
  text: string;
  createdAt: string;
  assignees: Array<{ agentId: string; status: OrderStatus; note: string }>;
  doneAt?: string;
};

export type CompanyState = {
  version: 1;
  careers: Record<string, AgentCareer>;
  trainees: Trainee[];
  orders: CompanyOrder[];
  events: MemoryEntry[];
};

export type CurriculumModule = { id: string; title: string; summary: string };

export const BATTERY_MAX = 100;
const MAX_MEMORY = 12;
const MAX_ORDERS = 60;
const MAX_EVENTS = 40;
const MAX_TRAINEES = 30;

// Points / battery per council cycle, by real state.
const DELTA: Record<AgentLiveState, { points: number; battery: number }> = {
  working: { points: 10, battery: 6 },
  "needs-setup": { points: 0, battery: -4 },
  error: { points: -5, battery: -10 },
  offline: { points: -2, battery: -6 },
  checking: { points: 0, battery: 0 },
};

const NICKNAMES = ["Vale", "Teo", "Luna", "Bruno", "Mia", "Leo", "Sofi", "Nico", "Ari", "Dani", "Gabo", "Emi", "Rafa", "Isa", "Tomi", "Cami", "Santi", "Paz", "Joaco", "Abril", "Iker", "Ema", "Thiago", "Zoe"];
const TRAITS = ["metodico", "curioso", "rapido", "detallista", "creativo", "competitivo", "calmado", "estratega", "directo", "obsesivo con la calidad", "colaborador", "esceptico"];
const MOTTOS = [
  "Si no hay evidencia, no paso.",
  "Primero entrego, despues celebro.",
  "Cada dia un poco mejor que ayer.",
  "Pregunto antes de romper algo.",
  "El dato manda.",
  "Equipo primero, ego despues.",
  "Lo simple escala.",
  "Nada sale sin revision.",
];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.abs(h);
}

function usedNicknames(careers: Record<string, AgentCareer>, trainees: Trainee[], exceptAgentId?: string): Set<string> {
  const used = new Set<string>();
  for (const career of Object.values(careers)) if (career.agentId !== exceptAgentId) used.add(career.nickname);
  for (const trainee of trainees) if (!trainee.graduatedAt && trainee.forAgentId !== exceptAgentId) used.add(trainee.nickname);
  return used;
}

/** Same deterministic pick as the personality, but never repeats a name already on the team. */
export function uniqueNickname(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  const start = Math.max(0, NICKNAMES.indexOf(preferred));
  for (let i = 1; i <= NICKNAMES.length; i++) {
    const candidate = NICKNAMES[(start + i) % NICKNAMES.length];
    if (!used.has(candidate)) return candidate;
  }
  for (let n = 2; ; n++) if (!used.has(`${preferred} ${n}`)) return `${preferred} ${n}`;
}

export function personalityFor(agentId: string, generation: number): Personality {
  const seed = hash(`${agentId}#${generation}`);
  const first = TRAITS[seed % TRAITS.length];
  const second = TRAITS[(seed >> 5) % TRAITS.length];
  return {
    nickname: NICKNAMES[seed % NICKNAMES.length],
    traits: first === second ? [first] : [first, second],
    motto: MOTTOS[(seed >> 9) % MOTTOS.length],
  };
}

export function emptyCompanyState(): CompanyState {
  return { version: 1, careers: {}, trainees: [], orders: [], events: [] };
}

export function parseCompanyState(value: unknown): CompanyState {
  const v = value as Partial<CompanyState> | null;
  if (!v || v.version !== 1 || typeof v.careers !== "object" || !Array.isArray(v.trainees) || !Array.isArray(v.orders)) return emptyCompanyState();
  return { version: 1, careers: v.careers as Record<string, AgentCareer>, trainees: v.trainees, orders: v.orders, events: Array.isArray(v.events) ? v.events : [] };
}

function remember(memory: MemoryEntry[], at: string, text: string) {
  return [{ at, text }, ...memory].slice(0, MAX_MEMORY);
}

export function levelFor(points: number) {
  if (points >= 1500) return "Lider";
  if (points >= 700) return "Senior";
  if (points >= 250) return "Semi-senior";
  return "Junior";
}

const STATE_WORDS: Record<AgentLiveState, string> = {
  working: "trabajando",
  "needs-setup": "esperando configuracion",
  error: "con error",
  offline: "sin respuesta",
  checking: "verificando",
};

// One company tick: careers move with real states; empty batteries trigger a replacement.
export function advanceCompany(
  state: CompanyState,
  input: { now: number; statuses: Record<string, { state: AgentLiveState; label: string }>; roles: Record<string, string>; exempt?: string[] }
): { state: CompanyState; fired: Array<{ agentId: string; nickname: string; generation: number; reason: string }> } {
  const iso = new Date(input.now).toISOString();
  const careers: Record<string, AgentCareer> = { ...state.careers };
  const fired: Array<{ agentId: string; nickname: string; generation: number; reason: string }> = [];
  let trainees = [...state.trainees];
  let events = [...state.events];

  for (const [agentId, status] of Object.entries(input.statuses)) {
    const existing = careers[agentId];
    let career: AgentCareer = existing
      ? { ...existing }
      : {
          agentId,
          generation: 1,
          nickname: uniqueNickname(personalityFor(agentId, 1).nickname, usedNicknames(careers, trainees, agentId)),
          points: 0,
          battery: 80,
          lastState: null,
          cyclesWorking: 0,
          cyclesTotal: 0,
          ordersDone: 0,
          firedCount: 0,
          hiredAt: iso,
          memory: [{ at: iso, text: `Contratado como ${input.roles[agentId] || agentId}.` }],
        };
    // "checking" has no evidence yet, and a replacement in the academy is studying, not failing.
    if (status.state === "checking" || career.inTrainingUntilGeneration) {
      careers[agentId] = career;
      continue;
    }
    const delta = DELTA[status.state];
    career.points = Math.max(0, career.points + delta.points);
    career.battery = Math.max(0, Math.min(BATTERY_MAX, career.battery + delta.battery));
    career.cyclesTotal += 1;
    if (status.state === "working") career.cyclesWorking += 1;
    if (career.lastState !== status.state) {
      career.memory = remember(career.memory, iso, `Paso a ${STATE_WORDS[status.state]}: ${status.label}.`);
    }
    career.lastState = status.state;

    const exempt = input.exempt?.includes(agentId);
    if (!exempt && career.battery === 0) {
      const reason = `Bateria en cero (${status.label}).`;
      fired.push({ agentId, nickname: career.nickname, generation: career.generation, reason });
      events = [{ at: iso, text: `El CEO despidio a ${career.nickname} (${input.roles[agentId] || agentId}). ${reason} Entra un reemplazo a la academia.` }, ...events];
      const nextGeneration = career.generation + 1;
      const replacement = { nickname: uniqueNickname(personalityFor(agentId, nextGeneration).nickname, usedNicknames(careers, trainees, agentId)) };
      career = {
        ...career,
        generation: nextGeneration,
        nickname: replacement.nickname,
        points: 0,
        battery: 60,
        firedCount: career.firedCount + 1,
        hiredAt: iso,
        inTrainingUntilGeneration: nextGeneration,
        memory: [{ at: iso, text: `Reemplaza a la generacion ${nextGeneration - 1}. Empieza en la academia.` }],
      };
      if (!trainees.some((trainee) => trainee.forAgentId === agentId && !trainee.graduatedAt)) {
        trainees = [
          { id: `${agentId}#${nextGeneration}`, forAgentId: agentId, role: input.roles[agentId] || agentId, nickname: replacement.nickname, startedAt: iso, modulesDone: [], knowledge: [] },
          ...trainees,
        ].slice(0, MAX_TRAINEES);
      }
    }
    careers[agentId] = career;
  }
  return { state: { ...state, careers, trainees, events: events.slice(0, MAX_EVENTS) }, fired };
}

// Academy: each cycle every trainee studies one more real module; graduation puts it to work.
export function advanceAcademy(state: CompanyState, curriculum: (trainee: Trainee) => CurriculumModule[], now: number): CompanyState {
  const iso = new Date(now).toISOString();
  const careers = { ...state.careers };
  let events = [...state.events];
  const trainees = state.trainees.map((trainee) => {
    if (trainee.graduatedAt) return trainee;
    const modules = curriculum(trainee);
    const next = modules.find((module) => !trainee.modulesDone.includes(module.id));
    if (!next) {
      const career = careers[trainee.forAgentId];
      if (career) {
        careers[trainee.forAgentId] = { ...career, inTrainingUntilGeneration: undefined, memory: remember(career.memory, iso, `Se graduo de la academia (${trainee.modulesDone.length} modulos) y entra a trabajar.`) };
      }
      events = [{ at: iso, text: `${trainee.nickname} se graduo como ${trainee.role}.` }, ...events];
      return { ...trainee, graduatedAt: iso };
    }
    return { ...trainee, modulesDone: [...trainee.modulesDone, next.id], knowledge: [`${next.title}: ${next.summary}`, ...trainee.knowledge].slice(0, 8) };
  });
  return { ...state, careers, trainees, events: events.slice(0, MAX_EVENTS) };
}

export function enrollTrainee(state: CompanyState, input: { id: string; forAgentId: string; role: string; now: number }): CompanyState {
  if (state.trainees.some((trainee) => trainee.id === input.id)) return state;
  const iso = new Date(input.now).toISOString();
  const nickname = uniqueNickname(personalityFor(input.id, 1).nickname, usedNicknames(state.careers, state.trainees));
  return {
    ...state,
    trainees: [{ id: input.id, forAgentId: input.forAgentId, role: input.role, nickname, startedAt: iso, modulesDone: [], knowledge: [] }, ...state.trainees].slice(0, MAX_TRAINEES),
    events: [{ at: iso, text: `${nickname} entro a la academia para ${input.role}.` }, ...state.events].slice(0, MAX_EVENTS),
  };
}

// CEO channel: deterministic routing from Robert's words to the right departments.
const ROUTES: Array<{ words: string[]; agents: string[] }> = [
  { words: ["black room", "blackroom", "br "], agents: ["blackroom-videos", "radio"] },
  { words: ["kong"], agents: ["kong-videos"] },
  { words: ["video", "reel", "clip", "tiktok", "subir"], agents: ["clippers", "blackroom-videos", "kong-videos"] },
  { words: ["radio", "dj", "set"], agents: ["radio"] },
  { words: ["noticia", "news"], agents: ["news"] },
  { words: ["legal", "contrato", "termino", "privacidad", "copyright", "abogado"], agents: ["legal"] },
  { words: ["app", "bug", "error", "falla", "funcion", "pantalla", "monitor"], agents: ["app-qa", "code"] },
  { words: ["codigo", "github", "pr ", "deploy", "repo"], agents: ["code", "github", "claude-reviewer"] },
  { words: ["seguridad", "hack", "ataque", "contrasena"], agents: ["cybersecurity"] },
  { words: ["marketing", "campana", "anuncio", "ads", "metricool", "redes", "instagram"], agents: ["marketing-cmo"] },
  { words: ["venta", "cliente", "deal", "stripe", "cobro", "pago", "dinero"], agents: ["revenue"] },
  { words: ["tienda", "shopify", "producto", "dropshipping"], agents: ["dropshipping"] },
  { words: ["inversion", "accion", "portafolio", "bolsa", "crypto"], agents: ["portfolio"] },
  { words: ["agenda", "calendario", "reunion", "recordatorio", "cita"], agents: ["assistant"] },
  { words: ["automatiza", "automatizacion", "programa", "cada dia", "diario"], agents: ["automations"] },
  { words: ["skill", "mejorar", "aprender", "actualiza"], agents: ["skills-scout"] },
  { words: ["agente nuevo", "contrata", "crear agente", "subagente"], agents: ["agent-factory"] },
  { words: ["arregla", "repara", "no funciona", "caido", "roto"], agents: ["mechanic"] },
];

export function routeOrder(text: string, available: string[]): string[] {
  const normalized = ` ${text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const picked: string[] = [];
  for (const route of ROUTES) {
    if (route.words.some((word) => normalized.includes(word))) {
      for (const agent of route.agents) if (available.includes(agent) && !picked.includes(agent)) picked.push(agent);
    }
  }
  if (picked.length === 0) return available.includes("assistant") ? ["assistant"] : available.slice(0, 1);
  return picked.slice(0, 4);
}

export function createOrder(
  state: CompanyState,
  input: { text: string; now: number; statuses: Record<string, { state: AgentLiveState; label: string }>; available: string[]; names: Record<string, string> }
): { state: CompanyState; order: CompanyOrder } {
  const iso = new Date(input.now).toISOString();
  const text = input.text.trim().slice(0, 500);
  const assigneeIds = routeOrder(text, input.available);
  const order: CompanyOrder = {
    id: `ord-${input.now.toString(36)}-${hash(text).toString(36).slice(0, 4)}`,
    text,
    createdAt: iso,
    assignees: assigneeIds.map((agentId) => {
      const status = input.statuses[agentId];
      const working = status?.state === "working";
      return {
        agentId,
        status: working ? "en_curso" : "bloqueada",
        note: working ? "Recibida: la tiene en su cola." : `No puede tomarla ahora (${status?.label || "sin estado"}); el Mecanico revisa por que.`,
      };
    }),
  };
  const careers = { ...state.careers };
  for (const assignee of order.assignees) {
    const career = careers[assignee.agentId];
    if (career) careers[assignee.agentId] = { ...career, memory: remember(career.memory, iso, `Orden del CEO: "${text.slice(0, 80)}" (${assignee.status === "en_curso" ? "en curso" : "bloqueada"}).`) };
  }
  const who = order.assignees.map((assignee) => input.names[assignee.agentId] || assignee.agentId).join(", ");
  return {
    order,
    state: {
      ...state,
      careers,
      orders: [order, ...state.orders].slice(0, MAX_ORDERS),
      events: [{ at: iso, text: `El CEO asigno "${text.slice(0, 60)}" a ${who}.` }, ...state.events].slice(0, MAX_EVENTS),
    },
  };
}

// Robert confirms an order is done: assignees that had it in progress earn points.
export function completeOrder(state: CompanyState, orderId: string, now: number): CompanyState {
  const iso = new Date(now).toISOString();
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.doneAt) return state;
  const careers = { ...state.careers };
  for (const assignee of order.assignees) {
    const career = careers[assignee.agentId];
    if (!career) continue;
    const earned = assignee.status === "en_curso" ? 25 : 5;
    careers[assignee.agentId] = {
      ...career,
      points: career.points + earned,
      battery: Math.min(BATTERY_MAX, career.battery + 10),
      ordersDone: career.ordersDone + 1,
      memory: remember(career.memory, iso, `Robert aprobo la orden "${order.text.slice(0, 60)}" (+${earned} puntos).`),
    };
  }
  return {
    ...state,
    careers,
    orders: state.orders.map((item) => (item.id === orderId ? { ...item, doneAt: iso, assignees: item.assignees.map((a) => ({ ...a, status: "hecha" as const })) } : item)),
  };
}

export type LeaderboardRow = { agentId: string; nickname: string; points: number; battery: number; level: string; rank: number; title: string; reliability: number };

export function leaderboard(state: CompanyState, exclude: string[] = ["ceo"]): LeaderboardRow[] {
  const rows = Object.values(state.careers)
    .filter((career) => !exclude.includes(career.agentId))
    .sort((a, b) => b.points - a.points || b.battery - a.battery || a.agentId.localeCompare(b.agentId))
    .map((career, index) => ({
      agentId: career.agentId,
      nickname: career.nickname,
      points: career.points,
      battery: career.battery,
      level: levelFor(career.points),
      rank: index + 1,
      // The best agent becomes the deputy, right under the CEO.
      title: index === 0 && career.points > 0 ? "Subdirector/a (debajo del CEO)" : levelFor(career.points),
      reliability: career.cyclesTotal ? Math.round((career.cyclesWorking / career.cyclesTotal) * 100) : 0,
    }));
  return rows;
}
