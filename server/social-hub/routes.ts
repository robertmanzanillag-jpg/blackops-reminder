// Owner-only HTTP API for the Social Hub. Factory/office agents call getSocialHub() in-process.
import { timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { NETWORK_CAPABILITIES, SOCIAL_NETWORKS, type SocialNetwork, type SocialPostInput, type SocialPostStatus } from "@shared/social-hub";
import { getCurrentUserId, getSystemUserId } from "../user-context";
import { envCredentialStore, listEnvAccounts } from "./providers";
import { buildAuthUrl, completeOAuth, loadTokens, oauthConfigured, oauthCredentialStore, OAUTH_APPS, removeToken, tokenStoreStatus } from "./oauth";
import { publishingCapability } from "../social-publishing/provider";
import { MEDIA_MAX_BYTES, MediaRejected, postgresMediaStore, saveUpload, serveMedia, type MediaStore } from "./media";
import { hydrateSocialHub, kvFlush, kvFlushOrThrow, kvGet, kvSet, kvStatus } from "./persist";
import { listSetVideos, streamSetVideo, trashSetVideo } from "./drive-sets";
import { persistentSocialHubStore, SocialHub, SocialHubValidationError } from "./scheduler";

let hub: SocialHub | undefined;

export function getSocialHub(): SocialHub {
  return hub ||= new SocialHub({
    store: persistentSocialHubStore(),
    credentials: oauthCredentialStore(envCredentialStore()),
    publishingEnabled: process.env.SOCIAL_HUB_PUBLISHING_ENABLED === "true",
    autoApproveBrands: (process.env.SOCIAL_HUB_AUTO_APPROVE_BRANDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
}

/** For la fábrica / la oficina: queue a post. Lands in pending_approval unless the brand is pre-approved. */
export async function queueAgentSocialPost(agent: string, input: Omit<SocialPostInput, "createdBy">) {
  await socialHubReady();
  return getSocialHub().create({ ...input, createdBy: agent.startsWith("factory:") || agent.startsWith("office:") ? agent : `office:${agent}` });
}

let ready: Promise<void> | undefined;
/** Loads queue + tokens from Postgres once. Every route and the scheduler wait for it. */
export function socialHubReady(): Promise<void> {
  return ready ||= hydrateSocialHub().catch((e) => { ready = undefined; throw e; });
}

let timer: NodeJS.Timeout | undefined;
export function startSocialHubScheduler(intervalMs = 60_000) {
  socialHubReady().catch((e) => console.error("[social-hub] no pude cargar el almacenamiento:", e?.message ?? e));
  if (timer || process.env.SOCIAL_HUB_SCHEDULER !== "on") return;
  let tick = 0;
  timer = setInterval(() => {
    // Metrics every 6 hours (360 ticks) to stay inside API quotas.
    if (++tick % 360 === 0) socialHubReady().then(() => getSocialHub().collectMetrics()).catch((e) => console.error("[social-hub metrics]", e?.message ?? e));
    socialHubReady().then(() => getSocialHub().runDue()).catch((e) => console.error("[social-hub]", e?.message ?? e));
  }, intervalMs);
  timer.unref?.();
}

export function registerSocialHubRoutes(app: Pick<Express, "get" | "post">, deps: { hub?: () => SocialHub; isOwner?: (req: Request) => boolean; media?: MediaStore } = {}) {
  const media = deps.media ?? postgresMediaStore();
  const getHub = deps.hub ?? getSocialHub;
  const isOwner = deps.isOwner ?? ((req: Request) => { try { return getCurrentUserId(req) === getSystemUserId(); } catch { return false; } });
  const h = (work: (req: Request) => unknown | Promise<unknown>) => async (req: Request, res: Response) => {
    if (!isOwner(req)) return res.status(403).json({ error: "Solo el propietario puede usar el Social Hub." });
    res.set("Cache-Control", "no-store");
    try { await socialHubReady(); res.json(await work(req)); await kvFlush(); }
    catch (e) {
      if (e instanceof SocialHubValidationError) return res.status(400).json({ error: e.message, problems: e.problems });
      res.status(409).json({ error: e instanceof Error ? e.message : "Error" });
    }
  };

  app.get("/api/social-hub/networks", h(() => ({ capabilities: NETWORK_CAPABILITIES, accounts: listEnvAccounts(), publishingEnabled: process.env.SOCIAL_HUB_PUBLISHING_ENABLED === "true" })));
  app.get("/api/social-hub/posts", h((req) => getHub().list({ status: req.query.status as SocialPostStatus | undefined, brand: req.query.brand as string | undefined })));
  app.post("/api/social-hub/posts", h((req) => getHub().create({ ...(req.body as SocialPostInput), createdBy: "robert" })));
  app.post("/api/social-hub/posts/:id/approve", h((req) => getHub().approve(String(req.params.id))));
  app.post("/api/social-hub/posts/:id/cancel", h((req) => getHub().cancel(String(req.params.id))));
  app.post("/api/social-hub/posts/:id/reschedule", h((req) => getHub().reschedule(String(req.params.id), String(req.body?.publishAt))));
  app.post("/api/social-hub/posts/:id/publish-now", h((req) => getHub().publishNow(String(req.params.id))));
  app.get("/api/social-hub/analytics", h((req) => getHub().analytics(Number(req.query.days ?? 30))));
  app.post("/api/social-hub/analytics/refresh", h(() => getHub().collectMetrics()));
  // ---- Conectar cuentas ----
  const asNetwork = (v: unknown): SocialNetwork => {
    if (!SOCIAL_NETWORKS.includes(v as SocialNetwork)) throw new Error("Red desconocida");
    return v as SocialNetwork;
  };
  app.get("/api/social-hub/connections", h(() => {
    let tokens: ReturnType<typeof loadTokens> = [];
    try { tokens = loadTokens(); } catch { tokens = []; }
    return {
      apps: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, { ready: oauthConfigured(n), needs: [OAUTH_APPS[n].clientIdEnv, OAUTH_APPS[n].clientSecretEnv] }])),
      storage: { ...kvStatus(), tokens: tokenStoreStatus() },
      connected: tokens.map((t) => ({ network: t.network, accountId: t.accountId, label: t.label, connectedAt: t.connectedAt, expiresAt: t.expiresAt })),
    };
  }));
  app.get("/api/social-hub/oauth/start/:network", async (req, res) => {
    if (!isOwner(req)) return res.status(403).send("Solo el propietario puede conectar cuentas.");
    try { await socialHubReady(); res.redirect(buildAuthUrl(asNetwork(req.params.network))); }
    catch (e) { res.status(400).send(e instanceof Error ? e.message : "Error"); }
  });
  // The callback is protected by the one-time state created in /start (which is owner-only).
  app.get("/api/social-hub/oauth/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    try {
      if (req.query.error) throw new Error(String(req.query.error_description ?? req.query.error));
      await socialHubReady();
      const rows = await completeOAuth(String(req.query.state ?? ""), String(req.query.code ?? ""));
      await kvFlushOrThrow();
      res.type("html").send(`<meta charset="utf-8"><h2>Conectado ✅</h2><ul>${rows.map((r) => `<li>${esc(r.network)}: ${esc(r.label)}</li>`).join("")}</ul><p>Ya puedes cerrar esta pestaña.</p>`);
    } catch (e) {
      res.status(400).type("html").send(`<meta charset="utf-8"><h2>No se pudo conectar</h2><p>${esc(e instanceof Error ? e.message : "Error")}</p>`);
    }
  });
  app.post("/api/social-hub/connections/:network/:accountId/disconnect", h((req) => { removeToken(asNetwork(req.params.network), String(req.params.accountId)); return { ok: true }; }));
  // ---- Archivos (subir desde el panel) ----
  app.post("/api/social-hub/media", express.raw({ type: () => true, limit: MEDIA_MAX_BYTES }), async (req, res) => {
    if (!isOwner(req)) return res.status(403).json({ error: "Solo el propietario puede subir archivos." });
    try {
      const name = decodeURIComponent(String(req.headers["x-filename"] ?? "archivo"));
      const out = await saveUpload(media, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.headers["content-type"] ?? ""), name);
      const base = (process.env.SOCIAL_HUB_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      res.json({ url: `${base}/social-hub-media/${out.id}`, kind: out.kind });
    } catch (e) {
      res.status(e instanceof MediaRejected ? 400 : 500).json({ error: e instanceof Error ? e.message : "No se pudo subir" });
    }
  });
  // Public on purpose (outside /api): networks download from here. IDs are 144-bit random.
  app.get("/social-hub-media/:id", async (req, res) => {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9_-]{24}\.[a-z0-9]{2,4}$/.test(id)) return res.status(404).end();
    try {
      const row = await media.get(id);
      if (!row) return res.status(404).end();
      const out = serveMedia(row, req.headers.range);
      res.status(out.status).set(out.headers).end(out.body);
    } catch { res.status(500).end(); }
  });
  // Read-only: what Metricool still has scheduled, shown in the calendar during the migration.
  app.get("/api/social-hub/metricool", h(async (req) => {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date();
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 7 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() - from.getTime() > 45 * 86_400_000) throw new Error("Rango de fechas inválido (máx. 45 días).");
    // Publishing seam: another/unknown provider => no Metricool read (reported, not hidden).
    try { return await publishingCapability("scheduledCalendar", { site: "social-hub-metricool-calendar" })(from, to); }
    catch (refusal) { return { items: [], errors: [refusal instanceof Error ? refusal.message : String(refusal)], configured: false }; }
  }));
  // ---- Agent API (cloud workers: clippers, Black Room). Outside /api on purpose: no browser session,
  // authenticated only by Bearer SOCIAL_HUB_AGENT_TOKEN (>= 32 chars, otherwise the API is off). ----
  const agentAuth = (req: Request, res: Response): boolean => {
    const expected = process.env.SOCIAL_HUB_AGENT_TOKEN || "";
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (expected.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Agent token inválido o no configurado." });
      return false;
    }
    return true;
  };
  const agentName = (v: unknown) => String(v || "").replace(/[^a-z0-9:_-]/gi, "").slice(0, 60) || "agent";
  app.get("/social-hub-agent/accounts", async (req, res) => {
    if (!agentAuth(req, res)) return;
    await socialHubReady();
    let tokens: ReturnType<typeof loadTokens> = [];
    try { tokens = loadTokens(); } catch { tokens = []; }
    res.json(tokens.map((t) => ({ network: t.network, accountId: t.accountId, label: t.label })));
  });
  app.post("/social-hub-agent/media", express.raw({ type: () => true, limit: MEDIA_MAX_BYTES }), async (req, res) => {
    if (!agentAuth(req, res)) return;
    try {
      const out = await saveUpload(media, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.headers["content-type"] ?? ""), decodeURIComponent(String(req.headers["x-filename"] ?? "clip")));
      const base = (process.env.SOCIAL_HUB_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      res.json({ url: `${base}/social-hub-media/${out.id}`, kind: out.kind });
    } catch (e) {
      res.status(e instanceof MediaRejected ? 400 : 500).json({ error: e instanceof Error ? e.message : "No se pudo subir" });
    }
  });
  // Free the clip bytes once the networks already pulled it: only media of a post that is published everywhere.
  app.post("/social-hub-agent/media/cleanup", async (req, res) => {
    if (!agentAuth(req, res)) return;
    await socialHubReady();
    const post = getHub().list().find((p) => p.id === String(req.body?.postId || ""));
    if (!post || post.status !== "published") return res.status(409).json({ error: "El post aún no está publicado." });
    const ids = post.mediaUrls.map((u) => u.match(/\/social-hub-media\/([A-Za-z0-9_-]+)/)?.[1]).filter(Boolean) as string[];
    for (const id of ids) await media.remove?.(id);
    res.json({ removed: ids.length });
  });
  app.post("/social-hub-agent/posts", async (req, res) => {
    if (!agentAuth(req, res)) return;
    try {
      const { agent, ...input } = (req.body ?? {}) as any;
      const post = await queueAgentSocialPost(`office:${agentName(agent)}`, input);
      await kvFlushOrThrow();
      res.json(post);
    } catch (e) {
      if (e instanceof SocialHubValidationError) return res.status(400).json({ error: e.message, problems: e.problems });
      res.status(409).json({ error: e instanceof Error ? e.message : "Error" });
    }
  });
  app.get("/social-hub-agent/posts", async (req, res) => {
    if (!agentAuth(req, res)) return;
    await socialHubReady();
    const who = `office:${agentName(req.query.agent)}`;
    res.json(getHub().list().filter((p) => p.createdBy === who).slice(-500));
  });
  app.get("/social-hub-agent/metrics", async (req, res) => {
    if (!agentAuth(req, res)) return;
    await socialHubReady();
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
    res.json(getHub().metricsSince(days));
  });
  // Worker state (e.g. Black Room clip ledger) lives in the same Postgres kv, namespaced per agent.
  const stateKey = (k: unknown) => `agent-state:${agentName(k)}`;
  const loadedState = new Set<string>();
  const loadState = async (k: string) => {
    await socialHubReady();
    if (loadedState.has(k)) return;
    await hydrateSocialHub([k]);
    loadedState.add(k);
  };
  app.get("/social-hub-agent/state/:key", async (req, res) => {
    if (!agentAuth(req, res)) return;
    await loadState(stateKey(req.params.key));
    res.json(JSON.parse(kvGet(stateKey(req.params.key)) || "null"));
  });
  app.post("/social-hub-agent/state/:key", express.json({ limit: "2mb" }), async (req, res) => {
    if (!agentAuth(req, res)) return;
    await loadState(stateKey(req.params.key));
    kvSet(stateKey(req.params.key), JSON.stringify(req.body ?? null));
    try { await kvFlushOrThrow(); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "No se pudo guardar" }); }
  });
  // Drive "sets para clips" folder: credentials stay on the server; only files inside that folder are reachable.
  const driveErr = (res: Response, e: unknown) => res.status(502).json({ error: e instanceof Error ? e.message : "Drive error" });
  app.get("/social-hub-agent/drive/sets", async (req, res) => {
    if (!agentAuth(req, res)) return;
    try { res.json(await listSetVideos()); } catch (e) { driveErr(res, e); }
  });
  app.get("/social-hub-agent/drive/sets/:id", async (req, res) => {
    if (!agentAuth(req, res)) return;
    try { await streamSetVideo(req.params.id, res); } catch (e) { if (!res.headersSent) driveErr(res, e); else res.destroy(); }
  });
  app.post("/social-hub-agent/drive/sets/:id/trash", async (req, res) => {
    if (!agentAuth(req, res)) return;
    try { res.json(await trashSetVideo(req.params.id)); } catch (e) { driveErr(res, e); }
  });
  app.get("/api/social-hub/best-time", h((req) => ({ at: getHub().bestTime(String(req.query.networks ?? "instagram").split(",") as any).toISOString() })));
}
