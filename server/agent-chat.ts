// Per-agent chat service (owner only). Deterministic first, $0 by default:
// - questions about the agent's own state are answered from recorded council data;
// - tasks become normal agent-company orders (same record as POST /api/agent-company/orders),
//   handed off to the right department when it is not this agent's job (shared/agent-chat-routing.ts);
// - the receiving agent acknowledges the hand-off in its own inbox thread (agent-to-agent message);
// - only an open question may use the model, through the office's existing token budget, and the
//   chat says honestly when the model is off or the monthly budget is used up.
// Nothing here publishes, deploys, contacts anyone or runs a worker: orders are records.

import type { CouncilState } from "@shared/agent-council";
import type { CompanyOrder } from "@shared/agent-company";
import { AGENT_CHAT_IDS, AGENT_CHAT_PROFILES, agentChatName, handoffLog, isAgentChatId, routeAgentMessage, type AgentChatRoute } from "@shared/agent-chat-routing";
import { effectiveIntegrations, integrationFor, parseIntegrationOverrides } from "@shared/agent-integrations";

export type AgentChatRole = "user" | "agent" | "handoff" | "peer";
export type AgentChatMessage = { id: string; threadId: string; role: AgentChatRole; agentId: string; fromAgentId?: string; text: string; at: string };
export type AgentThread = { id: string; agentId: string; title: string; createdAt: string; inbox: boolean };

export interface AgentThreadStore {
  listThreads(agentId: string): Promise<AgentThread[]>;
  createThread(agentId: string, title: string): Promise<AgentThread>;
  /** The single inbox thread where other agents' hand-offs to this agent land. */
  inboxThread(agentId: string): Promise<AgentThread>;
  getThread(threadId: string): Promise<AgentThread | null>;
  listMessages(threadId: string): Promise<AgentChatMessage[]>;
  append(threadId: string, message: { role: AgentChatRole; agentId: string; fromAgentId?: string; text: string }): Promise<AgentChatMessage>;
}

export class AgentChatInputError extends Error {}
export class AgentChatNotFound extends Error {}
export class AgentChatModelError extends Error {
  constructor(public readonly code: "disabled" | "budget_exhausted" | "unavailable") { super(code); }
}
export type AgentChatModel = { ask(prompt: string, requestId: string): Promise<string> };

type Council = {
  load(): Promise<CouncilState>;
  placeChatOrder(input: { text: string; fromAgentId: string; toAgentId: string; reason: string; approvalRequired: boolean; requestId?: string }): Promise<CompanyOrder>;
};

const MAX_TEXT = 2000;
const INBOX_TITLE = "Derivaciones recibidas";

export function validateAgentChatInput(agentId: unknown, body: unknown) {
  const v = (body || {}) as { text?: unknown; requestId?: unknown; threadId?: unknown };
  if (!isAgentChatId(agentId)) throw new AgentChatInputError("Agente no válido.");
  if (typeof v.text !== "string" || !v.text.trim() || v.text.trim().length > MAX_TEXT) throw new AgentChatInputError(`Escribe entre 1 y ${MAX_TEXT} caracteres.`);
  if (typeof v.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.requestId)) throw new AgentChatInputError("La solicitud necesita un identificador válido.");
  if (v.threadId !== undefined && v.threadId !== null && (typeof v.threadId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(v.threadId))) throw new AgentChatInputError("Conversación no válida.");
  return { agentId, text: v.text.trim(), requestId: v.requestId, threadId: (v.threadId as string | null | undefined) || undefined };
}

const when = (iso?: string | null) => iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "sin fecha";
const STATUS_FRESH_MS = 45 * 60_000;

/** Everything the chat may say about an agent comes from here: recorded council data only. */
export function agentFacts(state: CouncilState, agentId: string, now: number, env: NodeJS.ProcessEnv = process.env) {
  const profile = AGENT_CHAT_PROFILES.find(p => p.id === agentId)!;
  const integration = integrationFor(agentId, effectiveIntegrations(parseIntegrationOverrides(env.AGENT_INTEGRATION_OVERRIDES)));
  const fresh = !!state.lastCycleAt && now - Date.parse(state.lastCycleAt) < STATUS_FRESH_MS && !state.lastCycleError;
  const status = state.lastStatuses[agentId];
  const career = state.company.careers[agentId];
  const openOrders = state.company.orders.filter(o => !o.doneAt && o.assignees.some(a => a.agentId === agentId)).slice(0, 5);
  const jobs = (state.officeExecution?.roleWork?.jobs || []).filter(job => job.role === agentId);
  const lastJob = jobs[jobs.length - 1];
  const handoffs = handoffLog(state.company).filter(h => h.fromAgentId === agentId || h.toAgentIds.includes(agentId)).slice(0, 5);
  return { profile, integration, fresh, status, career, openOrders, lastJob, handoffs, lastCycleAt: state.lastCycleAt };
}
type Facts = ReturnType<typeof agentFacts>;

function statusLine(f: Facts) {
  const mode = f.integration.mode !== "activa" ? ` Modo: ${f.integration.mode} — ${f.integration.reason}` : "";
  if (!f.status) return `Sin estado registrado por el consejo (último consejo: ${when(f.lastCycleAt)}).${mode}`;
  return `Último estado registrado por el consejo (${when(f.lastCycleAt)}${f.fresh ? "" : ", no reciente"}): **${f.status.state}** — ${f.status.label}.${mode}`;
}
function ordersBlock(f: Facts) {
  if (!f.openOrders.length) return "No tengo órdenes abiertas.";
  return `Órdenes abiertas (${f.openOrders.length}):\n${f.openOrders.map(o => `- \`${o.id}\` ${o.text.slice(0, 80)} — ${o.assignees.find(a => a.agentId === f.profile.id)?.status}${o.chat?.approvalRequired ? " · requiere aprobación" : ""}`).join("\n")}`;
}
function lastWorkBlock(f: Facts) {
  const lines: string[] = [];
  if (f.lastJob) lines.push(`Último trabajo de rol en la oficina cloud: **${f.lastJob.status}** (inicio ${when(f.lastJob.startedAt)}${f.lastJob.completedAt ? `, fin ${when(f.lastJob.completedAt)}` : ""})${f.lastJob.reason ? ` — ${f.lastJob.reason.slice(0, 160)}` : ""}.`);
  else lines.push("La oficina cloud no tiene un trabajo de rol registrado para mí.");
  const memory = f.career?.memory?.slice(0, 3) || [];
  if (memory.length) lines.push(`Mi memoria reciente:\n${memory.map(m => `- ${when(m.at)}: ${m.text}`).join("\n")}`);
  return lines.join("\n");
}
function handoffBlock(f: Facts) {
  if (!f.handoffs.length) return "No hay derivaciones registradas entre otros agentes y yo.";
  return `Derivaciones recientes:\n${f.handoffs.map(h => `- ${when(h.at)} ${agentChatName(h.fromAgentId)} → ${h.toAgentIds.map(agentChatName).join(", ")}: "${h.text.slice(0, 60)}" (\`${h.orderId}\`, ${h.status})`).join("\n")}`;
}

export function deterministicAnswer(route: AgentChatRoute, f: Facts) {
  switch (route.intent) {
    case "help": return `Soy **${f.profile.name}**. ${f.profile.job}\n\nPuedes pedirme: \`estado\`, \`órdenes\`, \`último trabajo\`, \`derivaciones\`, o darme una tarea. Si no es mi trabajo, la derivo al agente correcto y queda registrada como orden. No publico, despliego ni contacto a nadie sin tu aprobación.`;
    case "status": return `${statusLine(f)}\n\n${ordersBlock(f)}`;
    case "orders": return ordersBlock(f);
    case "last_work": return lastWorkBlock(f);
    case "handoffs": return handoffBlock(f);
    default: return `${statusLine(f)}\n\n${ordersBlock(f)}`;
  }
}

function modelPrompt(f: Facts, question: string, history: AgentChatMessage[]) {
  const facts = [
    `Agente: ${f.profile.name}. Función: ${f.profile.job}`, statusLine(f), ordersBlock(f), lastWorkBlock(f), handoffBlock(f),
  ].join("\n").slice(0, 3000);
  const recent = history.slice(-6).map(m => `${m.role === "user" ? "Robert" : f.profile.name}: ${m.text.slice(0, 300)}`).join("\n");
  return `Eres ${f.profile.name}, un agente de la oficina BlackOps de Robert. Responde en el idioma de Robert, en markdown, máximo 120 palabras.
Usa SOLO los datos registrados de abajo. Si la respuesta no está en los datos, dilo claramente. No inventes actividad, resultados ni fechas.
No prometas publicar, desplegar, pagar ni contactar a nadie: eso requiere aprobación de Robert.

DATOS REGISTRADOS:
${facts}

CONVERSACIÓN RECIENTE:
${recent}

PREGUNTA: ${question.slice(0, 800)}`;
}

export function createAgentChatService(deps: {
  store: AgentThreadStore; council: Council; now?: () => number; model?: AgentChatModel; env?: NodeJS.ProcessEnv;
}) {
  const now = deps.now || Date.now;
  const done = new Map<string, unknown>();
  const inflight = new Map<string, Promise<unknown>>();
  const remember = (key: string, value: unknown) => { done.set(key, value); if (done.size > 500) done.delete(done.keys().next().value!); };

  async function answerQuestion(route: AgentChatRoute, f: Facts, text: string, history: AgentChatMessage[], requestId: string) {
    const pointer = route.targetAgentId !== f.profile.id
      ? `\n\nEste tema parece de **${agentChatName(route.targetAgentId)}**. Escribe "pásaselo a ${agentChatName(route.targetAgentId)}" y se lo derivo como orden.` : "";
    if (!deps.model) return { text: `No tengo una regla para responder eso y el modelo de IA está apagado para este chat (costo $0). Lo que sí está registrado:\n\n${statusLine(f)}\n\n${ordersBlock(f)}${pointer}`, model: "off" as const };
    try {
      const answer = (await deps.model.ask(modelPrompt(f, text, history), requestId)).trim();
      if (!answer) throw new AgentChatModelError("unavailable");
      return { text: `${answer.slice(0, 4000)}${pointer}`, model: "used" as const };
    } catch (error) {
      const code = error instanceof AgentChatModelError ? error.code : "unavailable";
      const why = code === "budget_exhausted" ? "el presupuesto mensual de tokens de la oficina está agotado"
        : code === "disabled" ? "el modelo de IA está apagado para este chat (costo $0)" : "el modelo no respondió de forma verificable";
      return { text: `No uso IA para esto: ${why}. Lo que sí está registrado:\n\n${statusLine(f)}\n\n${ordersBlock(f)}${pointer}`, model: code };
    }
  }

  async function notifyTarget(order: CompanyOrder, fromAgentId: string, toAgentId: string, reason: string, state: CouncilState) {
    const inbox = await deps.store.inboxThread(toAgentId);
    // A retried send reuses its order; never deliver the same hand-off twice.
    if ((await deps.store.listMessages(inbox.id)).some(m => m.role === "peer" && m.text.includes(`\`${order.id}\``))) return [];
    const peer = await deps.store.append(inbox.id, { role: "peer", agentId: toAgentId, fromAgentId,
      text: `**${agentChatName(fromAgentId)}** me pasó: "${order.text}"\n\nMotivo: ${reason}\nOrden: \`${order.id}\`${order.chat?.approvalRequired ? "\n\n⚠ Acción externa: requiere aprobación de Robert." : ""}` });
    const f = agentFacts(state, toAgentId, now(), deps.env);
    const assignee = order.assignees.find(a => a.agentId === toAgentId);
    const ack = await deps.store.append(inbox.id, { role: "agent", agentId: toAgentId,
      text: `Recibida de ${agentChatName(fromAgentId)}. ${assignee?.status === "en_curso" ? "La tengo en curso" : "Queda bloqueada"}: ${assignee?.note || ""}\n\n${statusLine(f)}` });
    return [peer, ack];
  }

  async function send(agentIdRaw: unknown, body: unknown) {
    const input = validateAgentChatInput(agentIdRaw, body);
    const key = `${input.agentId}:${input.requestId}`;
    if (done.has(key)) return done.get(key) as Awaited<ReturnType<typeof sendOnce>>;
    // Registered before the first await: a concurrent duplicate joins the same work.
    const running = inflight.get(key);
    if (running) return running as ReturnType<typeof sendOnce>;
    const work = sendOnce(input);
    inflight.set(key, work);
    try {
      const result = await work;
      remember(key, result);
      return result;
    } finally { inflight.delete(key); }
  }

  async function sendOnce(input: ReturnType<typeof validateAgentChatInput>) {
    let thread = input.threadId ? await deps.store.getThread(input.threadId) : null;
    if (input.threadId && (!thread || thread.agentId !== input.agentId)) throw new AgentChatNotFound("Conversación no encontrada.");
    if (!thread) thread = await deps.store.createThread(input.agentId, input.text.replace(/\s+/g, " ").slice(0, 60));
    const history = await deps.store.listMessages(thread.id);
    const user = await deps.store.append(thread.id, { role: "user", agentId: input.agentId, text: input.text });
    const route = routeAgentMessage(input.agentId, input.text);
    const state = await deps.council.load();
    const facts = agentFacts(state, input.agentId, now(), deps.env);
    const out: AgentChatMessage[] = [user];
    const peers: AgentChatMessage[] = [];
    let order: CompanyOrder | undefined;
    let model: string = "none";
    if (route.decision === "answer") {
      if (route.intent === "question") {
        const answer = await answerQuestion(route, facts, input.text, history, input.requestId);
        model = answer.model;
        out.push(await deps.store.append(thread.id, { role: "agent", agentId: input.agentId, text: answer.text }));
      } else {
        out.push(await deps.store.append(thread.id, { role: "agent", agentId: input.agentId, text: deterministicAnswer(route, facts) }));
      }
    } else {
      order = await deps.council.placeChatOrder({ text: input.text, fromAgentId: input.agentId, toAgentId: route.targetAgentId, reason: route.reason, approvalRequired: route.approvalRequired, requestId: `${input.agentId}:${input.requestId}` });
      const approval = route.approvalRequired ? "\n\n⚠ **Requiere tu aprobación**: es una acción externa (publicar, desplegar, pagar, contactar o gastar). La oficina es solo de revisión y no la ejecuta." : "";
      if (route.decision === "handoff") {
        out.push(await deps.store.append(thread.id, { role: "handoff", agentId: input.agentId, fromAgentId: input.agentId,
          text: `${route.reason}\n\nDerivé la tarea a **${agentChatName(route.targetAgentId)}** → orden \`${order.id}\`. Puedes seguirla en su chat (Derivaciones recibidas) o en el consejo.${approval}` }));
        peers.push(...await notifyTarget(order, input.agentId, route.targetAgentId, route.reason, state));
      } else {
        const assignee = order.assignees.find(a => a.agentId === input.agentId);
        out.push(await deps.store.append(thread.id, { role: "agent", agentId: input.agentId,
          text: `${route.reason} Anotada como orden \`${order.id}\` (${assignee?.status === "en_curso" ? "en curso" : "bloqueada"}).\n\n${assignee?.note || ""}${approval}` }));
      }
    }
    return { thread, messages: out, peerMessages: peers, route, order: order ? { id: order.id, assignees: order.assignees, chat: order.chat } : null, model };
  }

  async function agents() {
    const state = await deps.council.load();
    return AGENT_CHAT_IDS.map(id => {
      const f = agentFacts(state, id, now(), deps.env);
      return { id, name: f.profile.name, job: f.profile.job, status: f.status || null, fresh: f.fresh, mode: f.integration.mode, openOrders: f.openOrders.length };
    });
  }

  async function threads(agentId: unknown) {
    if (!isAgentChatId(agentId)) throw new AgentChatInputError("Agente no válido.");
    return deps.store.listThreads(agentId);
  }
  async function createThread(agentId: unknown, title?: unknown) {
    if (!isAgentChatId(agentId)) throw new AgentChatInputError("Agente no válido.");
    const clean = typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : "Nueva conversación";
    return deps.store.createThread(agentId, clean);
  }
  async function thread(agentId: unknown, threadId: unknown) {
    if (!isAgentChatId(agentId) || typeof threadId !== "string") throw new AgentChatInputError("Conversación no válida.");
    const found = await deps.store.getThread(threadId);
    if (!found || found.agentId !== agentId) throw new AgentChatNotFound("Conversación no encontrada.");
    return { thread: found, messages: await deps.store.listMessages(found.id) };
  }
  async function handoffs() { return handoffLog((await deps.council.load()).company); }

  return { send, agents, threads, createThread, thread, handoffs, inboxTitle: INBOX_TITLE };
}

// ---- Persistence over the existing chat tables (conversations/messages), owner-scoped titles. ----
type ChatStorageLike = {
  getConversation(id: number, userId?: string): Promise<{ id: number; title: string; createdAt: Date | string } | undefined>;
  getConversationByTitle(title: string, userId?: string): Promise<{ id: number; title: string; createdAt: Date | string } | undefined>;
  getAllConversations(userId?: string): Promise<Array<{ id: number; title: string; createdAt: Date | string }>>;
  createConversation(title: string, userId?: string): Promise<{ id: number; title: string; createdAt: Date | string }>;
  getMessagesByConversation(conversationId: number): Promise<Array<{ id: number; conversationId: number; role: string; content: string; createdAt: Date | string }>>;
  createMessage(conversationId: number, role: string, content: string): Promise<{ id: number; conversationId: number; role: string; content: string; createdAt: Date | string }>;
};
const PREFIX = "agent-chat|";
const OWNER_PREFIX = /^\[owner:[^\]]+\]\s*/;

/** Threads are rows of the existing `conversations` table titled "agent-chat|<agentId>|<title>", scoped to the owner. */
export function createChatStorageThreadStore(storage: ChatStorageLike, userId: string): AgentThreadStore {
  if (!userId) throw new Error("Owner required");
  const toThread = (row: { id: number; title: string; createdAt: Date | string }): AgentThread | null => {
    const title = row.title.replace(OWNER_PREFIX, "");
    if (!title.startsWith(PREFIX)) return null;
    const [agentId, ...rest] = title.slice(PREFIX.length).split("|");
    if (!isAgentChatId(agentId)) return null;
    const name = rest.join("|");
    return { id: String(row.id), agentId, title: name, createdAt: new Date(row.createdAt).toISOString(), inbox: name === INBOX_TITLE };
  };
  const encodeRole = (m: { role: AgentChatRole; fromAgentId?: string }) => m.role === "peer" || m.role === "handoff" ? `${m.role}:${m.fromAgentId}` : m.role === "agent" ? "assistant" : "user";
  const decode = (threadId: string, agentId: string, row: { id: number; role: string; content: string; createdAt: Date | string }): AgentChatMessage => {
    const [kind, from] = row.role.split(":");
    const role: AgentChatRole = kind === "assistant" ? "agent" : kind === "peer" || kind === "handoff" ? kind : "user";
    return { id: String(row.id), threadId, role, agentId, ...(from ? { fromAgentId: from } : {}), text: row.content, at: new Date(row.createdAt).toISOString() };
  };
  const inboxLocks = new Map<string, Promise<AgentThread>>();
  const get = async (threadId: string) => {
    if (!/^\d{1,12}$/.test(threadId)) return null;
    const row = await storage.getConversation(Number(threadId), userId);
    return row ? toThread(row) : null;
  };
  return {
    async listThreads(agentId) {
      const rows = await storage.getAllConversations(userId);
      return rows.map(toThread).filter((t): t is AgentThread => !!t && t.agentId === agentId)
        .sort((a, b) => Number(b.inbox) - Number(a.inbox) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    async createThread(agentId, title) {
      const clean = title.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, 60) || "Nueva conversación";
      return toThread(await storage.createConversation(`${PREFIX}${agentId}|${clean === INBOX_TITLE ? `${clean} (chat)` : clean}`, userId))!;
    },
    inboxThread(agentId) {
      // Serialized per agent so concurrent hand-offs never create two inbox threads.
      const previous = inboxLocks.get(agentId) || Promise.resolve(null as unknown as AgentThread);
      const next = previous.catch(() => null).then(async () => {
        const title = `${PREFIX}${agentId}|${INBOX_TITLE}`;
        const row = await storage.getConversationByTitle(title, userId) || await storage.createConversation(title, userId);
        return toThread(row)!;
      });
      inboxLocks.set(agentId, next);
      return next;
    },
    getThread: get,
    async listMessages(threadId) {
      const thread = await get(threadId);
      if (!thread) return [];
      return (await storage.getMessagesByConversation(Number(threadId))).map(row => decode(threadId, thread.agentId, row));
    },
    async append(threadId, message) {
      const thread = await get(threadId);
      if (!thread) throw new AgentChatNotFound("Conversación no encontrada.");
      return decode(threadId, thread.agentId, await storage.createMessage(Number(threadId), encodeRole(message), message.text.slice(0, 8000)));
    },
  };
}
