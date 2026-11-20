import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  createKongMirrorLab, createMirrorSummarizer, resolveMirrorSummaryCapUsd, verifyMirrorReport, mirrorReportKey, MirrorError,
  KONG_MIRROR_REPOSITORY, MIRROR_MAX_IMAGE_BYTES, type MirrorCards, type MirrorGithub, type MirrorCard, type KongMirrorReport,
} from "../server/kong-mirror-lab";
import { registerKongMirrorRoutes } from "../server/kong-mirror-routes";
import { buildMonthlyAiSpendReport } from "../server/ai-cost-policy";

const NOW = Date.parse("2026-11-20T12:00:00Z"), SECRET = "synthetic-only-mirror-secret-0123456789", HEAD = "b".repeat(40), BASE = "a".repeat(40);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString("base64");

function report(patch: Partial<KongMirrorReport> = {}) {
  return {
    version: 1, repo: KONG_MIRROR_REPOSITORY, prNumber: 42, prUrl: `https://github.com/${KONG_MIRROR_REPOSITORY}/pull/42`, title: "Botón de reservar más visible",
    baseSha: BASE, headSha: HEAD, overall: "pass",
    agents: [
      { id: "visual", name: "Agente visual", verdict: "pass", summary: "El botón se ve en móvil sin hacer scroll.", details: ["Mejora: probar color en modo oscuro"] },
      { id: "perf", name: "Agente rendimiento", verdict: "pass", summary: "LCP baja de 2.8s a 2.1s.", details: [] },
      { id: "devils-advocate", name: "Abogado del diablo", verdict: "pass", summary: "Riesgo bajo: solo CSS.", details: ["Podría chocar con el banner de cookies"] },
    ],
    metrics: { lcp: { before: 2.8, after: 2.1, unit: "s", better: "lower" }, errors: 0 },
    images: [{ id: "home-before", page: "/", viewport: "390x844", kind: "before", caption: "Inicio antes", mime: "image/png", dataBase64: PNG },
      { id: "home-after", page: "/", viewport: { width: 390, height: 844 }, kind: "after", caption: "Inicio después", mime: "image/png", dataBase64: PNG }],
    videos: ["https://github.com/robertmanzanillag-jpg/kong-nightlife/actions/runs/1"],
    artifactUrl: "https://github.com/robertmanzanillag-jpg/kong-nightlife/actions/runs/1/artifacts/2",
    generatedAt: new Date(NOW - 60_000).toISOString(), dataSource: "production-copy",
    ...patch,
  };
}
function sign(value: unknown, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(value));
  return { raw, signature: `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`, timestamp: String(Math.floor(NOW / 1000)) };
}
function memoryStore() {
  const rows = new Map<string, string>(); let tail = Promise.resolve();
  return { rows, read: async (key: string) => rows.get(key) ?? null, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    const job = tail.then(async () => { const next = await change(rows.get(key) ?? null); rows.set(key, next); return next; });
    tail = job.then(() => {}, () => {}); return job;
  } };
}
function fakeCards() {
  const actions = new Map<string, { id: string; status: string; card: MirrorCard; notes: string[] }>(); let n = 0;
  const cards: MirrorCards = {
    create: async card => { const id = `pa-${++n}`; actions.set(id, { id, status: "pending", card, notes: [] }); return { id }; },
    findByKey: async key => { const found = [...actions.values()].find(action => action.card.key === key); return found ? { id: found.id, status: found.status } : null; },
    get: async id => actions.has(id) ? { id, status: actions.get(id)!.status } : null,
    note: async (id, note) => { actions.get(id)!.notes.push(note); },
    approved: async id => { actions.get(id)!.status = "approved"; },
    executed: async id => { actions.get(id)!.status = "executed"; },
    reopen: async id => { actions.get(id)!.status = "pending"; },
    rejected: async id => { actions.get(id)!.status = "rejected"; },
  };
  return { cards, actions };
}
function fakeGithub(patch: Partial<{ headSha: string; checks: boolean; state: string }> = {}) {
  const calls = { merges: 0, comments: [] as string[] };
  const github: MirrorGithub = {
    readPull: async () => ({ state: patch.state || "open", merged: false, headSha: patch.headSha || HEAD, baseRepo: KONG_MIRROR_REPOSITORY, baseRef: "main", mergeable: true }),
    readChecks: async () => ({ passed: patch.checks ?? true, summary: patch.checks === false ? "1 check(s) sin éxito: test" : "todo en verde" }),
    merge: async () => { calls.merges++; return { merged: true, sha: "c".repeat(40) }; },
    comment: async (_repo, _pr, body) => { calls.comments.push(body); },
  };
  return { github, calls };
}
function lab(options: { github?: MirrorGithub; time?: () => number } = {}) {
  const store = memoryStore(), { cards, actions } = fakeCards(), gh = fakeGithub();
  const instance = createKongMirrorLab({ owner: "owner", store, now: options.time || (() => NOW), cards, github: options.github || gh.github,
    summarize: async () => ({ text: "Resumen determinista", source: "deterministic" }) });
  return { instance, store, actions, calls: gh.calls };
}

test("signature: valid accepted, invalid/stale/oversized rejected", () => {
  const good = sign(report());
  assert.equal(verifyMirrorReport(good.raw, good.signature, good.timestamp, SECRET, NOW).report.prNumber, 42);
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, good.timestamp, "another-secret-of-at-least-32-chars!!", NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_SIGNATURE");
  assert.throws(() => verifyMirrorReport(Buffer.from(good.raw.toString().replace("42", "43")), good.signature, good.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_SIGNATURE");
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, String(Math.floor((NOW - 11 * 60_000) / 1000)), SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_STALE");
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, undefined, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_STALE");
  const oldBody = sign(report({ generatedAt: new Date(NOW - 2 * 60 * 60_000).toISOString() }));
  assert.throws(() => verifyMirrorReport(oldBody.raw, oldBody.signature, oldBody.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_STALE");
  assert.throws(() => verifyMirrorReport(good.raw, good.signature, good.timestamp, "short", NOW), (error: MirrorError) => error.code === "MIRROR_NOT_CONFIGURED");
  const big = Buffer.alloc(MIRROR_MAX_IMAGE_BYTES + 1024, 1);
  big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const huge = sign(report({ images: [{ id: "big", page: "/", viewport: "1x1", kind: "after", caption: "", mime: "image/png", dataBase64: big.toString("base64") }] }));
  assert.throws(() => verifyMirrorReport(huge.raw, huge.signature, huge.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_TOO_LARGE" && error.status === 413);
  const strict = sign({ ...report(), unexpected: true });
  assert.throws(() => verifyMirrorReport(strict.raw, strict.signature, strict.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_REPORT");
  const fake = sign(report({ images: [{ id: "x", page: "/", viewport: "1x1", kind: "after", caption: "", mime: "image/png", dataBase64: Buffer.from("<svg onload=alert(1)>").toString("base64") }] }));
  assert.throws(() => verifyMirrorReport(fake.raw, fake.signature, fake.timestamp, SECRET, NOW), (error: MirrorError) => error.code === "MIRROR_INVALID_REPORT");
});

test("replay rejected; same repo+PR+headSha is idempotent: one card, images stored outside the journal", async () => {
  const { instance, store, actions } = lab();
  const first = sign(report());
  const created = await instance.receive(first.raw, first.signature, first.timestamp, SECRET);
  assert.equal(created.duplicate, false);
  await assert.rejects(instance.receive(first.raw, first.signature, first.timestamp, SECRET), (error: MirrorError) => error.code === "MIRROR_REPLAY" && error.status === 409);
  const rerun = sign(report({ generatedAt: new Date(NOW - 30_000).toISOString() }));
  const again = await instance.receive(rerun.raw, rerun.signature, rerun.timestamp, SECRET);
  assert.equal(again.duplicate, true);
  assert.equal(again.pendingActionId, created.pendingActionId);
  assert.equal(actions.size, 1);
  const journal = store.rows.get(JSON.stringify(["kong-mirror-reports-v1", "owner"]))!;
  assert.ok(!journal.includes(PNG), "journal must not hold image data");
  const card = actions.get(created.pendingActionId)!.card;
  assert.ok(!JSON.stringify(card).includes(PNG), "card must only reference images");
  const image = await instance.image(card.images[0].key);
  assert.equal(image?.mime, "image/png");
  assert.equal(card.key, mirrorReportKey(KONG_MIRROR_REPOSITORY, 42, HEAD));
  const newSha = sign(report({ headSha: "d".repeat(40) }));
  await instance.receive(newSha.raw, newSha.signature, newSha.timestamp, SECRET);
  assert.equal(actions.size, 2, "a new head SHA gets its own card (no count cap)");
});

test("cards: pass approvable, warn flagged, fail informational (also when an agent fails under overall=pass)", async () => {
  const { instance, actions } = lab();
  const cardFor = async (patch: Partial<KongMirrorReport>, sha: string) => {
    const signed = sign(report({ headSha: sha, ...patch }));
    const { pendingActionId } = await instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
    return actions.get(pendingActionId)!.card;
  };
  const pass = await cardFor({}, "1".repeat(40));
  assert.equal(pass.approvable, true); assert.equal(pass.warn, false);
  assert.equal(pass.risks.devilsAdvocate?.name, "Abogado del diablo");
  assert.deepEqual(pass.metrics[0], { name: "lcp", before: 2.8, after: 2.1, unit: "s", better: "lower" });
  assert.ok(pass.improveLater.some(line => line.includes("modo oscuro")));
  assert.equal(pass.images.length, 2);
  const warn = await cardFor({ overall: "warn" }, "2".repeat(40));
  assert.equal(warn.approvable, true); assert.equal(warn.warn, true); assert.match(warn.statusLabel, /AVISOS/);
  const fail = await cardFor({ overall: "fail", agents: [{ id: "a11y", name: "Agente accesibilidad", verdict: "fail", summary: "Contraste insuficiente.", details: [] }] }, "3".repeat(40));
  assert.equal(fail.approvable, false); assert.deepEqual(fail.failReasons, ["Agente accesibilidad: Contraste insuficiente."]);
  const sneaky = await cardFor({ overall: "pass", agents: [{ id: "flow", name: "Agente flujo", verdict: "fail", summary: "El pago se rompe.", details: [] }] }, "4".repeat(40));
  assert.equal(sneaky.overall, "fail"); assert.equal(sneaky.approvable, false);
  const failKey = mirrorReportKey(KONG_MIRROR_REPOSITORY, 42, "3".repeat(40));
  const refused = await instance.approve(failKey, { actorId: "robert" });
  assert.equal(refused.ok, false); assert.equal((refused as { code: string }).code, "MIRROR_NOT_APPROVABLE");
});

test("approve refuses on SHA mismatch or red checks, merges only after both pass", async () => {
  const changed = fakeGithub({ headSha: "e".repeat(40) });
  const t1 = lab({ github: changed.github });
  const signed = sign(report());
  const { key, pendingActionId } = await t1.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const refused = await t1.instance.approve(key, { actorId: "robert", headSha: HEAD });
  assert.equal(refused.ok, false); assert.equal((refused as { code: string }).code, "MIRROR_SHA_CHANGED");
  assert.equal(changed.calls.merges, 0);
  assert.equal(t1.actions.get(pendingActionId)!.status, "pending", "card stays pending after a refusal");

  const red = fakeGithub({ checks: false });
  const t2 = lab({ github: red.github });
  const r2 = await t2.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const redResult = await t2.instance.approve(r2.key, { actorId: "robert" });
  assert.equal((redResult as { code: string }).code, "MIRROR_CHECKS_RED"); assert.equal(red.calls.merges, 0);

  const green = fakeGithub();
  const t3 = lab({ github: green.github });
  const r3 = await t3.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const merged = await t3.instance.approve(r3.key, { actorId: "robert", headSha: HEAD });
  assert.equal(merged.ok, true);
  assert.equal((merged as { message: string }).message, "Merge hecho: falta republicar KONG en Replit");
  assert.equal(green.calls.merges, 1);
  assert.equal(t3.actions.get(r3.pendingActionId)!.status, "executed");
  const twice = await t3.instance.approve(r3.key, { actorId: "robert" });
  assert.equal(twice.ok, false); assert.equal(green.calls.merges, 1);
});

test("reject closes the card and posts the optional note as a PR comment", async () => {
  const gh = fakeGithub();
  const t = lab({ github: gh.github });
  const signed = sign(report());
  const { key, pendingActionId } = await t.instance.receive(signed.raw, signed.signature, signed.timestamp, SECRET);
  const result = await t.instance.reject(key, { actorId: "robert", note: "Prefiero otro color" });
  assert.equal(result.ok, true); assert.equal((result as { commentPosted: boolean }).commentPosted, true);
  assert.match(gh.calls.comments[0], /Prefiero otro color/);
  assert.equal(t.actions.get(pendingActionId)!.status, "rejected");
  assert.equal((await t.instance.approve(key, { actorId: "robert" })).ok, false);
});

test("summary budget: env clamp (10 → 3, 0 → off), cap enforced, deterministic fallback, spend reported", async () => {
  assert.equal(resolveMirrorSummaryCapUsd({ BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "10" }), 3);
  assert.equal(resolveMirrorSummaryCapUsd({ BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "0" }), 0);
  assert.equal(resolveMirrorSummaryCapUsd({}), 3);
  assert.equal(resolveMirrorSummaryCapUsd({ BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "1.5" }), 1.5);
  assert.equal(resolveMirrorSummaryCapUsd({ BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "abc" }), 0);
  const parsed = verifyMirrorReport(sign(report()).raw, sign(report()).signature, sign(report()).timestamp, SECRET, NOW).report;
  let calls = 0, prompt = "";
  const generate = async (value: string) => { calls++; prompt = value; return { text: "Conviene porque el botón se ve mejor.", inputTokens: 100, outputTokens: 50 }; };
  const off = createMirrorSummarizer({ owner: "o", store: memoryStore(), now: () => NOW, env: { BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "0" }, generate, estimateUsd: () => 0.001 });
  const offResult = await off.summarize(parsed);
  assert.equal(offResult.source, "deterministic"); assert.equal(calls, 0); assert.match(offResult.text, /agentes de prueba aprobaron/);
  const store = memoryStore();
  const on = createMirrorSummarizer({ owner: "o", store, now: () => NOW, env: { BLACKOPS_MIRROR_SUMMARY_MONTHLY_USD: "10" }, generate, estimateUsd: (i, o) => (i + o) / 1000 * 0.5 });
  const ai = await on.summarize(parsed);
  assert.equal(ai.source, "ai"); assert.equal(calls, 1);
  assert.ok(!prompt.includes(PNG), "no image data goes to the model");
  // Exhaust the 3 USD ceiling (env 10 is clamped): the next call must not reach the provider.
  await store.transact(JSON.stringify(["kong-mirror-summary-spend-v1", "o"]), async () => JSON.stringify({ version: 1, months: { "2026-11": { spentUsd: 2.999, reservedUsd: 0, calls: 99 } } }));
  const capped = await on.summarize(parsed);
  assert.equal(capped.source, "deterministic"); assert.equal(calls, 1); assert.match(capped.reason || "", /tope/);
  const spend = await on.monthSpend();
  assert.equal(spend.capUsd, 3); assert.equal(spend.spentUsd, 2.999);
  const failing = createMirrorSummarizer({ owner: "o", store: memoryStore(), now: () => NOW, generate: async () => { throw new Error("FACTORY_API_GEMINI_USAGE_UNPRICED"); }, estimateUsd: () => 0.001 });
  const fallback = await failing.summarize(parsed);
  assert.equal(fallback.source, "deterministic"); assert.equal((await failing.monthSpend()).spentUsd, 0, "a refused preflight releases the reservation");
  const tracker = buildMonthlyAiSpendReport([], new Date(NOW), [{ id: "kong_mirror_summary", label: "Resumen Mirror Lab", amountUsd: 1.25, count: 3, kind: "estimated" }]);
  assert.equal(tracker.trackedSpendUsd, 1.25);
  assert.ok(tracker.sources.some(source => source.id === "kong_mirror_summary"));
});

test("route: signed receive 202, bad signature 401, owner-only decisions", async () => {
  const t = lab();
  const app = express();
  app.use(KONG_PATH, express.raw({ type: () => true, limit: "12mb" }), (req, _res, next) => { (req as { rawBody?: unknown }).rawBody = req.body; next(); });
  app.use(express.json());
  let isOwner = false;
  registerKongMirrorRoutes(app, { resolve: async () => t.instance, secret: () => SECRET, owner: () => isOwner, sameOrigin: () => true });
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // The lab instance uses a fixed clock; the route passes the raw body and headers through untouched.
    const good = sign(report());
    const post = (signature: string) => fetch(`${base}${KONG_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Kong-Mirror-Signature": signature, "X-Kong-Mirror-Timestamp": good.timestamp }, body: good.raw });
    assert.equal((await post("sha256=" + "0".repeat(64))).status, 401);
    const accepted = await post(good.signature);
    assert.equal(accepted.status, 202, await accepted.clone().text());
    assert.equal((await post(good.signature)).status, 409);
    const key = mirrorReportKey(KONG_MIRROR_REPOSITORY, 42, HEAD);
    assert.equal((await fetch(`${base}/api/kong-mirror/${key}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) })).status, 403);
    assert.equal((await fetch(`${base}/api/kong-mirror/reports`)).status, 403);
    isOwner = true;
    assert.equal((await fetch(`${base}/api/kong-mirror/${key}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400, "second click confirmation required");
    const list = await (await fetch(`${base}/api/kong-mirror/reports`)).json() as { pendingCount: number };
    assert.equal(list.pendingCount, 1);
  } finally { server.close(); }
});
const KONG_PATH = "/api/integrations/kong/mirror-reports";
