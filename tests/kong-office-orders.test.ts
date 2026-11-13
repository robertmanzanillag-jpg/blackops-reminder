import test from "node:test";
import assert from "node:assert/strict";
import { createAgentCouncil, emptyCouncilState } from "../server/agent-council";
import { createAgentChatService, createChatStorageThreadStore, kongTasksInThread } from "../server/agent-chat";
import { registerAgentChatRoutes } from "../server/agent-chat-routes";
import {
  DEFAULT_KONG_OFFICE_ORDER_URL, createKongOfficeOrderClient, kongOrderAgentId, kongOrderIdempotencyKey, kongOrderUrl,
} from "../server/kong-office-orders";
import { isExternalActionForKong } from "../shared/agent-chat-routing";

// No network: every KONG call goes through this fake fetch.
const TOKEN = "kong-order-secret-123";
type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function fakeKong(handler: (call: Call) => { status?: number; body?: unknown; type?: string } | Promise<never>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const out = await handler(call);
    return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": out.type ?? "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const env = (extra: Record<string, string> = {}) => ({ KONG_OFFICE_ORDER_TOKEN: TOKEN, ...extra }) as NodeJS.ProcessEnv;

test("KONG agent ids, idempotency keys, URL config and the external-action guard", () => {
  assert.equal(kongOrderAgentId("kong:Venues"), "kong:Venues");
  assert.equal(kongOrderAgentId("kong:Promoters + Mesas"), "kong:Promoters + Mesas");
  assert.equal(kongOrderAgentId("kong-city:miami:clubs"), "kong-city:miami:clubs");
  assert.equal(kongOrderAgentId("kong-city:buenos-aires"), "kong-city:buenos-aires");
  for (const id of ["kong-videos", "kong-metrics", "code", "kong:", "kong-city:Miami:clubs", "kong-city:miami:clubs:extra"]) assert.equal(kongOrderAgentId(id), null, id);
  assert.equal(kongOrderIdempotencyKey("kong-city:miami:clubs", "req-1"), kongOrderIdempotencyKey("kong-city:miami:clubs", "req-1"));
  assert.notEqual(kongOrderIdempotencyKey("kong-city:miami:clubs", "req-1"), kongOrderIdempotencyKey("kong-city:miami:events", "req-1"));
  assert.match(kongOrderIdempotencyKey("a", "b"), /^office-[0-9a-f]{40}$/);
  assert.equal(kongOrderUrl({} as NodeJS.ProcessEnv), DEFAULT_KONG_OFFICE_ORDER_URL);
  assert.equal(kongOrderUrl({ KONG_OFFICE_ORDER_URL: "https://staging.example.com/api/admin/ceo/office-orders/" } as NodeJS.ProcessEnv), "https://staging.example.com/api/admin/ceo/office-orders");
  for (const bad of ["http://kongnightlife.com/x", "https://user:pw@kongnightlife.com/x", "https://kongnightlife.com/x?token=1", "not a url"]) assert.equal(kongOrderUrl({ KONG_OFFICE_ORDER_URL: bad } as NodeJS.ProcessEnv), null, bad);
  assert.equal(isExternalActionForKong("elimina el venue duplicado y los eventos duplicados"), false);
  assert.equal(isExternalActionForKong("borra el club repetido"), false);
  assert.equal(isExternalActionForKong("publica el evento en instagram"), true);
  assert.equal(isExternalActionForKong("contacta al venue mañana"), true);
  assert.equal(isExternalActionForKong("paga al DJ"), true);
});

test("client: POSTs {agentId, text, idempotencyKey} with the dedicated token and reads the task", async () => {
  const kong = fakeKong(() => ({ body: { taskId: "t_42", status: "queued", agent: "kong-city:miami:clubs" } }));
  const client = createKongOfficeOrderClient({ fetchImpl: kong.fetchImpl, env: env() });
  const task = await client.send({ agentId: "kong-city:miami:clubs", text: "  elimina el venue duplicado  ", idempotencyKey: "office-abc" });
  assert.deepEqual(task, { taskId: "t_42", status: "queued", agent: "kong-city:miami:clubs", result: null });
  assert.equal(kong.calls[0].url, DEFAULT_KONG_OFFICE_ORDER_URL);
  assert.equal(kong.calls[0].method, "POST");
  assert.equal(kong.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(kong.calls[0].body, { agentId: "kong-city:miami:clubs", text: "elimina el venue duplicado", idempotencyKey: "office-abc" });
  const status = await createKongOfficeOrderClient({ fetchImpl: fakeKong(() => ({ body: { task: { id: 42, status: "done", result: `Listo. token ${TOKEN}` } } })).fetchImpl, env: env() }).status("42");
  assert.equal(status.status, "done");
  assert.equal(status.result, "Listo. token [redacted]", "the token never comes back");
});

test("client: unset token, bad answers and network errors become safe errors without the token", async () => {
  const unset = createKongOfficeOrderClient({ fetchImpl: fakeKong(() => { throw new Error("must not be called"); }).fetchImpl, env: {} as NodeJS.ProcessEnv });
  assert.equal(unset.enabled(), false);
  await assert.rejects(unset.send({ agentId: "kong:Venues", text: "x", idempotencyKey: "k" }), (error: any) => error.code === "NOT_CONFIGURED");
  const cases: Array<[() => any, string]> = [
    [() => ({ status: 401, body: { error: `bad ${TOKEN}` } }), "UNAUTHENTICATED"],
    [() => ({ status: 403 }), "FORBIDDEN"],
    [() => ({ status: 422, body: { error: `agent not supported ${TOKEN}` } }), "REJECTED"],
    [() => ({ status: 503 }), "UNAVAILABLE"],
    [() => ({ body: "<html>", type: "text/html" }), "INVALID_RESPONSE"],
    [() => ({ body: { taskId: "../../x", status: "queued" } }), "INVALID_RESPONSE"],
    [() => Promise.reject(new Error(`socket hang up Authorization: Bearer ${TOKEN}`)), "CONNECTION_FAILED"],
  ];
  for (const [handler, code] of cases) {
    const client = createKongOfficeOrderClient({ fetchImpl: fakeKong(handler).fetchImpl, env: env() });
    await assert.rejects(client.send({ agentId: "kong:Venues", text: "importa eventos", idempotencyKey: "k" }), (error: any) => {
      assert.equal(error.code, code);
      assert.ok(!String(error.message).includes(TOKEN), `${code} leaks the token`);
      return true;
    });
  }
  const tooLong = createKongOfficeOrderClient({ fetchImpl: fakeKong(() => { throw new Error("must not be called"); }).fetchImpl, env: env() });
  await assert.rejects(tooLong.send({ agentId: "kong:Venues", text: "x".repeat(1001), idempotencyKey: "k" }), (error: any) => error.code === "REJECTED");
  await assert.rejects(tooLong.send({ agentId: "code", text: "x", idempotencyKey: "k" }), (error: any) => error.code === "REJECTED");
});

// ---------- Agent chat service ----------
function memoryChatStorage() {
  const conversations: Array<{ id: number; title: string; createdAt: Date }> = [];
  const messages: Array<{ id: number; conversationId: number; role: string; content: string; createdAt: Date }> = [];
  const scoped = (title: string, userId?: string) => userId ? `[owner:${userId}] ${title}` : title;
  let seq = 0;
  return {
    async getConversation(id: number, userId?: string) { const c = conversations.find(x => x.id === id); return c && (!userId || c.title.startsWith(scoped("", userId))) ? c : undefined; },
    async getConversationByTitle(title: string, userId?: string) { return conversations.find(x => x.title === scoped(title, userId)); },
    async getAllConversations(userId?: string) { return conversations.filter(c => !userId || c.title.startsWith(scoped("", userId))); },
    async createConversation(title: string, userId?: string) { const c = { id: ++seq, title: scoped(title, userId), createdAt: new Date(Date.parse("2026-11-12T10:00:00Z") + seq) }; conversations.push(c); return c; },
    async getMessagesByConversation(id: number) { return messages.filter(m => m.conversationId === id); },
    async createMessage(conversationId: number, role: string, content: string) { const m = { id: ++seq, conversationId, role, content, createdAt: new Date() }; messages.push(m); return m; },
  };
}
function council() {
  const initial = emptyCouncilState();
  initial.kongLastStatuses = { "kong-city:miami:clubs": { state: "working", label: "Auditando clubs" } };
  let raw: string | null = JSON.stringify(initial);
  return createAgentCouncil({ now: () => Date.parse("2026-11-12T10:05:00Z"), userId: () => "owner", readState: async () => raw, writeState: async next => { raw = next; },
    collect: async () => ({}), submitProposal: async () => "x", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
}
function setup(kongEnv: NodeJS.ProcessEnv, handler: Parameters<typeof fakeKong>[0]) {
  let clock = Date.parse("2026-11-12T10:05:00Z");
  const kong = fakeKong(handler);
  const officeCouncil = council();
  const service = createAgentChatService({ store: createChatStorageThreadStore(memoryChatStorage(), "owner"), council: officeCouncil, now: () => clock,
    kongOrders: createKongOfficeOrderClient({ fetchImpl: kong.fetchImpl, env: kongEnv }) });
  return { service, kong, officeCouncil, tick: (ms: number) => { clock += ms; } };
}

test("owner order to the Miami clubs agent goes to KONG, replies with the task and shows status when reopened", async () => {
  let status = "queued";
  const { service, kong, officeCouncil, tick } = setup(env(), call => call.method === "POST"
    ? { body: { taskId: "t_77", status: "queued", agent: call.body.agentId } }
    : { body: { taskId: "t_77", status, ...(status === "done" ? { result: "Eliminé 1 venue duplicado y 3 eventos duplicados." } : {}) } });
  const sent = await service.send("kong-city:miami:clubs", { text: "elimina el venue duplicado y los eventos duplicados", requestId: "req-kong-1" });
  assert.equal(sent.messages[1].role, "agent");
  assert.match(sent.messages[1].text, /^Orden enviada a Miami · Clubs en KONG \(tarea #t_77\)\. Te aviso el resultado aquí\./);
  assert.ok(!/no inicia ni cambia|no se le registran órdenes/.test(sent.messages[1].text));
  assert.equal(kong.calls.length, 1);
  assert.deepEqual({ ...kong.calls[0].body, idempotencyKey: "-" }, { agentId: "kong-city:miami:clubs", text: "elimina el venue duplicado y los eventos duplicados", idempotencyKey: "-" });
  assert.equal(kong.calls[0].body.idempotencyKey, kongOrderIdempotencyKey("kong-city:miami:clubs", "req-kong-1"));
  assert.equal((await officeCouncil.load()).company.orders.length, 0, "KONG work is not recorded as a BlackOps order");
  // Retried send (same requestId): no second KONG task.
  await service.send("kong-city:miami:clubs", { text: "elimina el venue duplicado y los eventos duplicados", requestId: "req-kong-1" });
  assert.equal(kong.calls.length, 1);

  // Reopened right away: no poll (throttled). After 31 s, still queued: no new message.
  assert.equal((await service.thread("kong-city:miami:clubs", sent.thread.id)).messages.length, 2);
  tick(31_000);
  assert.equal((await service.thread("kong-city:miami:clubs", sent.thread.id)).messages.length, 2);
  assert.equal(kong.calls.at(-1)!.url, `${DEFAULT_KONG_OFFICE_ORDER_URL}/t_77`);
  assert.equal(kong.calls.at(-1)!.method, "GET");
  // KONG finished: the reopened thread gets the result once.
  status = "done";
  tick(31_000);
  const reopened = await service.thread("kong-city:miami:clubs", sent.thread.id);
  assert.equal(reopened.messages.length, 3);
  assert.match(reopened.messages[2].text, /^Actualización de KONG · tarea #t_77/);
  assert.match(reopened.messages[2].text, /completada/);
  assert.match(reopened.messages[2].text, /Eliminé 1 venue duplicado y 3 eventos duplicados/);
  assert.deepEqual(kongTasksInThread(reopened.messages), [{ taskId: "t_77", status: "done" }]);
  const polls = kong.calls.length;
  tick(120_000);
  assert.equal((await service.thread("kong-city:miami:clubs", sent.thread.id)).messages.length, 3);
  assert.equal(kong.calls.length, polls, "finished tasks are not polled again");
});

test("questions stay answers; desk orders work; token unset, external actions and long texts are honest and send nothing", async () => {
  const { service, kong } = setup(env(), call => ({ body: { taskId: "t_1", status: "accepted", agent: call.body?.agentId } }));
  const question = await service.send("kong-city:miami:clubs", { text: "estado", requestId: "req-kong-q" });
  assert.equal(kong.calls.length, 0);
  assert.match(question.messages[1].text, /Auditando clubs/);
  const desk = await service.send("kong:Venues", { text: "importa los eventos de E11even de esta semana", requestId: "req-kong-desk" });
  assert.match(desk.messages[1].text, /Orden enviada a Venues en KONG \(tarea #t_1\)/);
  assert.equal(kong.calls[0].body.agentId, "kong:Venues");
  const external = await service.send("kong-city:miami:clubs", { text: "contacta al venue y pídele los flyers", requestId: "req-kong-ext" });
  assert.match(external.messages.at(-1)!.text, /No envié la orden a KONG|Requiere tu aprobación/);
  const long = await service.send("kong:Venues", { text: `importa ${"eventos ".repeat(140)}`, requestId: "req-kong-long" });
  assert.match(long.messages[1].text, /hasta 1000 caracteres/);
  assert.equal(kong.calls.length, 1);

  const off = setup({} as NodeJS.ProcessEnv, () => { throw new Error("must not be called"); });
  const reply = await off.service.send("kong-city:miami:clubs", { text: "elimina el venue duplicado y los eventos duplicados", requestId: "req-kong-off" });
  assert.match(reply.messages[1].text, /no está activado/);
  assert.match(reply.messages[1].text, /No envié nada/);
  assert.equal(off.kong.calls.length, 0);

  const down = setup(env(), () => ({ status: 503 }));
  const failed = await down.service.send("kong-city:miami:clubs", { text: "elimina el venue duplicado", requestId: "req-kong-down" });
  assert.match(failed.messages[1].text, /No pude enviar la orden .* KONG no pudo recibir la orden ahora mismo\. No quedó registrada/);
  assert.ok(!failed.messages[1].text.includes(TOKEN));
});

test("routes: only the owner can send KONG orders; partners get 403 and KONG is never called", async () => {
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const app = { get: (path: string, h: never) => { handlers.set(`GET ${path}`, h); }, post: (path: string, h: never) => { handlers.set(`POST ${path}`, h); } };
  const { service, kong } = setup(env(), () => ({ body: { taskId: "t_9", status: "queued" } }));
  registerAgentChatRoutes(app as never, { service: () => service, ownerUserId: () => "owner", requestUserId: (req: any) => req.user ?? null });
  const call = async (user: string | null) => {
    let status = 200, body: any;
    const res = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; return res; }, set() { return res; } };
    await handlers.get("POST /api/agent-chat/:agentId/messages")!({ user, params: { agentId: "kong-city:miami:clubs" }, body: { text: "elimina el venue duplicado", requestId: `req-route-${user}` } }, res);
    return { status, body };
  };
  assert.equal((await call(null)).status, 401);
  assert.equal((await call("partner-1")).status, 403);
  assert.equal(kong.calls.length, 0);
  const ok = await call("owner");
  assert.equal(ok.status, 200);
  assert.match(ok.body.messages[1].text, /tarea #t_9/);
  assert.ok(!JSON.stringify(ok.body).includes(TOKEN));
});
