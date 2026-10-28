import { Pool } from "pg";
import { planRollingEditorial, type EditorialPlanInput } from "./kong-editorial-planner";
import type { Express } from "express";
import { resolveCurrentUserId } from "./user-context";
import { verifyImmutableMedia } from "./kong-media-store";
import { collectMetricoolObservations, dueLearningRegistry } from "./kong-metricool-learning";
import { analyzeLearning, emptyLearningLedger, ingestLearning } from "./kong-content-learning";
import { emptyProductionState, runProductionCycle, type EditorialTask, type ProductionDependencies, type ProductionState } from "./kong-production-pipeline";
import { appendProductionArchive, archiveProductionHistory } from "./kong-production-archive";
import { callMetricoolMcpTool, formatMetricoolMcpDate } from "./blackroom-metricool-bridge";
import { assetProblem, catalogSchema, coverage, deliverJob, emptyState, fillPlan, isKongNetwork, networks, type Asset, type Delivery, type Job, type State } from "./kong-autopilot-core";

const BRAND = 6475033;
const INTERVAL = 15 * 60_000;
const LOCK = 6475033;
type Env = Record<string, string | undefined>;
const verifiedNetworks = (env: Env) => (env.KONG_METRICOOL_ACCOUNTS_VERIFIED || "").split(",").map(n => n.trim()).filter(isKongNetwork);

export function readiness(env: Env, production?: KongRuntimeOptions["production"]) {
  const blockers: string[] = [];
  for (const key of ["DATABASE_URL", "KONG_OWNER_USER_ID", "KONG_MEDIA_ORIGINS", "METRICOOL_USER_TOKEN", "METRICOOL_USER_ID"])
    if (!env[key]?.trim()) blockers.push(`missing_${key.toLowerCase()}`);
  if (!verifiedNetworks(env).length) blockers.push("verify_kong_accounts");
  if (env.KONG_AUTOPUBLISH_ENABLED !== "true") blockers.push("autopublishing_disabled");
  return { enabled: env.KONG_AUTOPILOT_ENABLED === "true", blockers, brandId: BRAND, networks,
    verifiedNetworks: verifiedNetworks(env), blockedNetworks: networks.filter(n => !verifiedNetworks(env).includes(n)),
    sourceMode: production ? "cloud_production_and_reviewed_assets" : "remote_reviewed_catalog",
    sourceBlockers: !production && !env.KONG_CATALOG_URL ? ["production_not_configured"] : [],
    discovery: production?.dependencies.discover ? "adapter_configured" : "not_configured",
    rendering: production ? "adapter_configured" : "not_configured",
    editorialPlanning: production?.tasks ? "custom_provider" : production?.editorial ? "rolling_14_days" : "not_configured",
    productionEnabled: env.KONG_PRODUCTION_ENABLED === "true" && Boolean(production),
    review: production?.dependencies.review ? "adapter_configured" : "pending_review_adapter",
    learning: "partial_registry_gated", paidAiCalls: 0 };
}

// Only deployment-configured origins may supply catalogs/media. No arbitrary URL
// from a catalog is fetched, and redirects cannot escape this trust boundary.
export function approvedUrl(value: string, origins: string[]): string {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || !origins.includes(u.origin)
    || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/i.test(u.hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) throw new Error("unapproved_remote_origin");
  return u.href;
}
async function bytesAt(url: string, maxBytes: number, fetcher = fetch): Promise<Uint8Array> {
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("remote_read_failed");
  const chunks: Uint8Array[] = []; let length = 0;
  for await (const chunk of response.body as any) {
    length += chunk.length;
    if (length > maxBytes) throw new Error("remote_asset_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function matchesPost(post: any, job: Job): boolean {
  return post?.text === job.asset.caption && post?.publicationDate?.dateTime === job.at.slice(0, 19)
    && post?.publicationDate?.timezone === "America/New_York" && post?.draft === false
    && Array.isArray(post.providers) && post.providers.some((p: any) => p.network === job.network && !/error|fail|reject/i.test(String(p.status || "")))
    && (typeof post.id === "number" || typeof post.id === "string");
}
export function createDelivery(env: Env, fetcher: typeof fetch = fetch): Delivery {
  const token = env.METRICOOL_USER_TOKEN!;
  return {
    async find(job) {
      if (!isKongNetwork(job.network)) throw new Error("unsupported_kong_network");
      const params = new URLSearchParams({ blogId: String(BRAND), userId: env.METRICOOL_USER_ID!, integrationSource: "MCP",
        start: `${job.day}T00:00:00`, end: `${job.day}T23:59:59`, timezone: "America/New_York", extendedRange: "false" });
      const response = await fetcher(`https://app.metricool.com/api/v2/scheduler/posts?${params}`, {
        headers: { "X-Mc-Auth": token }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("metricool_read_failed");
      const result = await response.json();
      const rows = Array.isArray(result) ? result : result.data;
      if (!Array.isArray(rows)) throw new Error("metricool_unrecognized_calendar_response");
      const matched = rows.filter((post: any) => matchesPost(post, job));
      if (matched.length > 1) throw new Error("duplicate_remote_posts_need_review");
      return matched[0] ? String(matched[0].id) : undefined;
    },
    async create(job) {
      if (!isKongNetwork(job.network)) throw new Error("unsupported_kong_network");
      if (!Number.isFinite(job.asset.durationSeconds) || job.asset.durationSeconds < 3 || job.asset.durationSeconds > 90) throw new Error("unsupported_reel_duration");
      const info: Record<string, unknown> = { autoPublish: true, draft: false, text: job.asset.caption,
        providers: [{ network: job.network }], publicationDate: { dateTime: job.at.slice(0, 19), timezone: "America/New_York" },
        shortener: false, mediaAltText: [], descendants: [], firstCommentText: "", hasNotReadNotes: false,
        smartLinkData: { ids: [] } };
      if (job.network === "tiktok") info.tiktokData = { title: job.asset.title, privacyOption: "PUBLIC_TO_EVERYONE",
        commercialContentOwnBrand: true, commercialContentThirdParty: false, autoAddMusic: false,
        disableComment: false, disableDuet: false, disableStitch: false, photoCoverIndex: 0 };
      else info.facebookData = { title: job.asset.title, type: "REEL" };
      await callMetricoolMcpTool(fetcher, token, "createScheduledPost", { date: job.at, blogId: String(BRAND),
        info: JSON.stringify(info), mediaFiles: [{ download_url: job.asset.mediaUrl, file_id: `${job.asset.sha256}-${job.network}.mp4` }] });
    },
  };
}

export interface KongRuntimeOptions {
  production?: { dependencies: Omit<ProductionDependencies, "save">;
    tasks?(state: ProductionState, now: Date): Promise<EditorialTask[]>;
    editorial?: Omit<EditorialPlanInput, "now" | "targetDay">; maxJobs?: number };
  pool?: Pick<Pool, "connect" | "query" | "end">;
  fetch?: typeof fetch; delivery?: Delivery; now?: () => Date;
  verifyMedia?: typeof verifyImmutableMedia;
}
export function createKongCloudRuntime(env: Env = process.env, options: KongRuntimeOptions = {}) {
  let pool: Pool | undefined, timer: ReturnType<typeof setInterval> | undefined, running = false;
  let lastError: string | undefined, lastCycleAt: string | undefined;
  const getPool = () => options.pool || (pool ||= new Pool({ connectionString: env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 }));
  const fetcher = options.fetch || fetch, nowAt = options.now || (() => new Date());
  async function cycle() {
    if (running || env.KONG_AUTOPILOT_ENABLED !== "true" || !env.DATABASE_URL) return;
    running = true;
    let client: Awaited<ReturnType<Pool["connect"]>> | undefined, locked = false;
    try {
      client = await getPool().connect();
      locked = (await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK])).rows[0].locked;
      if (!locked) return;
      await client.query("CREATE TABLE IF NOT EXISTS kong_cloud_autopilot (id text PRIMARY KEY, state jsonb NOT NULL)");
      const stored = (await client.query("SELECT state FROM kong_cloud_autopilot WHERE id='kong'")).rows[0]?.state;
      const state: State = stored || emptyState();
      if (state.version !== 1 || !Array.isArray(state.jobs)) throw new Error("invalid_persisted_state");
      let persistenceFailed = false;
      const save = async () => {
        try { await client!.query("INSERT INTO kong_cloud_autopilot(id,state) VALUES('kong',$1::jsonb) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state", [JSON.stringify(state)]); }
        catch (error) { persistenceFailed = true; throw error; }
      };
      const now = nowAt();
      lastError = undefined;
      // Durable append completes before the active JSON row is trimmed. A crash
      // between these saves replays the same archive IDs without losing evidence.
      if (state.production) await archiveProductionHistory(state.production, state.jobs, {
        archive: records => appendProductionArchive(client!, records),
        saveActive: async production => { state.production = production; await save(); },
      }, now);
      // Analytics runs independently of catalog availability and publishing flags.
      // Only actual published IDs/URLs may label metrics; scheduler IDs are not enough.
      if (env.METRICOOL_USER_TOKEN && state.publishedCreatives?.length &&
        (!state.learningCheckedAt || +now - Date.parse(state.learningCheckedAt) >= 3600_000)) {
        state.learningError = undefined;
        for (const network of networks) {
          try {
            const due = dueLearningRegistry(state.publishedCreatives.filter(p => p.network === network), state.learning || emptyLearningLedger(), now);
            if (!due.length) continue;
            const result = await collectMetricoolObservations({ network, registry:due, now,
              call:(name,args)=>callMetricoolMcpTool(fetcher,env.METRICOOL_USER_TOKEN!,name,args) });
            const added = ingestLearning(state.learning || emptyLearningLedger(), result.observations, now);
            state.learning = added.ledger;
            if (result.rejected.some(r => !/unregistered/.test(r.reason)) || added.rejected.length) state.learningError = "analytics_rows_need_reconciliation";
          } catch { state.learningError = "analytics_collection_failed"; }
        }
        state.learningCheckedAt = now.toISOString(); await save();
      }
      // First reconcile outstanding intents even when the source catalog is down.
      const ready = readiness(env, options.production);
      const delivery = options.delivery || createDelivery(env, fetcher);
      const canReadReceipts = Boolean(env.METRICOOL_USER_TOKEN && env.METRICOOL_USER_ID);
      if (canReadReceipts) for (const job of state.jobs.filter(j => ready.verifiedNetworks.includes(j.network) && ["submitting", "uncertain"].includes(j.state))
        .sort((a, b) => (a.lastReconciledAt || "").localeCompare(b.lastReconciledAt || "")).slice(0, 10)) {
        job.lastReconciledAt = now.toISOString();
        await save();
        try { await deliverJob(job, delivery, save, now); } catch { if (persistenceFailed) throw Error("persistence_failed"); lastError = "metricool_reconciliation_failed"; }
      }
      // Production shares this DB lease and row. No local heartbeat or second
      // process can race its upload intents when every worker uses this lock.
      if (options.production && env.KONG_PRODUCTION_ENABLED === "true" && !ready.blockers.length
        && (!state.productionNextAttemptAt || Date.parse(state.productionNextAttemptAt) <= +now)) {
        try {
          const current = state.production || emptyProductionState();
          let tasks: EditorialTask[] = [], tasksUnavailable = false;
          try {
            if (options.production.tasks) tasks = await options.production.tasks(structuredClone(current), now);
            else if (options.production.editorial) tasks = planRollingEditorial(current, { ...options.production.editorial, now }).tasks;
            else tasksUnavailable = true;
          }
          catch { tasksUnavailable = true; }
          await runProductionCycle(current, tasks, { ...options.production.dependencies,
            save: async production => { state.production = production; await save(); } }, { now, maxJobs: options.production.maxJobs });
          state.productionError = tasksUnavailable ? "editorial_tasks_unavailable" : undefined;
          state.productionNextAttemptAt = tasksUnavailable ? new Date(+now + INTERVAL).toISOString() : undefined; await save();
        } catch {
          if (persistenceFailed) throw Error("persistence_failed");
          state.productionError = "production_cycle_failed";
          state.productionNextAttemptAt = new Date(+now + INTERVAL).toISOString(); await save();
        }
      }
      const origins = (env.KONG_MEDIA_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
      let catalogAssets: Asset[] = [];
      state.catalogError = undefined;
      if (env.KONG_CATALOG_URL) {
        try {
          const catalogUrl = approvedUrl(env.KONG_CATALOG_URL, origins);
          catalogAssets = catalogSchema.parse(JSON.parse(Buffer.from(await bytesAt(catalogUrl, 2_000_000, fetcher)).toString("utf8"))).assets;
        } catch { state.catalogError = "catalog_unavailable"; }
      }
      const assets = [...catalogAssets, ...(state.production?.assets || [])].filter((a, i, all) => {
        try { approvedUrl(a.mediaUrl, origins); return !assetProblem(a, now) && all.findIndex(other => other.sha256 === a.sha256) === i; } catch { return false; }
      });
      fillPlan(state, assets, now, wall => formatMetricoolMcpDate(wall, "America/New_York"));
      state.lastCycleAt = now.toISOString(); await save();
      if (!ready.blockers.length) {
        for (const job of state.jobs.filter(j => j.state === "planned" && ready.verifiedNetworks.includes(j.network)
          && (!j.nextAttemptAt || Date.parse(j.nextAttemptAt) <= +now)).sort((a, b) => (a.nextAttemptAt || "").localeCompare(b.nextAttemptAt || "")).slice(0, 10)) {
          const current = assets.find(a => a.sha256 === job.asset.sha256 && a.id === job.asset.id);
          if (!current && state.catalogError) { job.nextAttemptAt = new Date(+now + INTERVAL).toISOString(); job.reason = "catalog_temporarily_unavailable"; await save(); continue; }
          if (!current || assetProblem(current, new Date(job.at), now)) { job.state = "blocked"; job.reason = "asset_removed_or_evidence_expired"; await save(); continue; }
          // Pre-submit jobs use the full current reviewed catalog record. Intents
          // already sent to Metricool keep their exact reconciliation snapshot.
          job.asset = current;
          if (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > +now) continue;
          try {
            approvedUrl(job.asset.mediaUrl, origins);
            await (options.verifyMedia || verifyImmutableMedia)(job.asset.mediaUrl, job.asset.sha256, origins, fetcher);
            await deliverJob(job, delivery, save, now);
          } catch {
            if (persistenceFailed) throw Error("persistence_failed");
            job.nextAttemptAt = new Date(+now + INTERVAL).toISOString();
            job.reason = "preflight_or_persistence_failed";
            await save();
          }
        }
      }
      lastCycleAt = state.lastCycleAt;
    } catch { lastError = "cycle_failed_check_catalog_database_and_provider"; }
    finally {
      if (client) { if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {}); client.release(); }
      running = false;
    }
  }
  return { cycle,
    start() { if (!timer && env.KONG_AUTOPILOT_ENABLED === "true") { void cycle(); timer = setInterval(() => void cycle(), INTERVAL); timer.unref(); } },
    async stop() { if (timer) clearInterval(timer); timer = undefined; if (pool) await pool.end(); },
    async status() {
      let state: State | undefined;
      if (env.DATABASE_URL && env.KONG_AUTOPILOT_ENABLED === "true") {
        try { state = (await getPool().query("SELECT state FROM kong_cloud_autopilot WHERE id='kong'")).rows[0]?.state; } catch { /* Read-only status never initializes schema. */ }
      }
      return { ...readiness(env, options.production), running, lastCycleAt: state?.lastCycleAt || lastCycleAt, lastError,
        productionStatus: { jobs: state?.production?.jobs.length || 0, reviewedAssets: state?.production?.assets.length || 0,
          archivePolicy: "terminal_older_than_30d_durable_append_before_trim",
          pendingQa: state?.production?.jobs.filter(j => j.stage === "qa_pending").length || 0,
          error: state?.productionError, nextAttemptAt: state?.productionNextAttemptAt, catalogError: state?.catalogError },
        learningStatus: { collection: state?.publishedCreatives?.length ? "registered_posts_only" : "waiting_for_verified_publication_registry",
          lastCheckedAt:state?.learningCheckedAt, error:state?.learningError,
          reports:state?.learning ? networks.flatMap(network => (["24h","72h","7d"] as const).map(horizon => analyzeLearning(state.learning!,network,horizon,new Date()))) : [] },
        localLedgerCoverage: state ? coverage(state, new Date()) : null, remoteCoverageVerified: false,
        receipts: state?.jobs.filter(j => j.receipt).map(j => ({ id: j.id, receipt: j.receipt, at: j.at })) || [] };
    },
  };
}
export function registerKongCloudAutopilot(app: Express, options: KongRuntimeOptions = {}) {
  const runtime = createKongCloudRuntime(process.env, options);
  app.get("/api/kong-autopilot/status", async (req, res) => {
    if (!process.env.KONG_OWNER_USER_ID || resolveCurrentUserId(req) !== process.env.KONG_OWNER_USER_ID) { res.status(403).json({ error: "owner_required" }); return; }
    try { res.json(await runtime.status()); } catch { res.status(503).json({ error: "status_unavailable" }); }
  });
  runtime.start();
  return runtime;
}
