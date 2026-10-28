import { Pool } from "pg";
import type { Express } from "express";
import { resolveCurrentUserId } from "./user-context";
import { callMetricoolMcpTool, formatMetricoolMcpDate } from "./blackroom-metricool-bridge";
import { assetProblem, catalogSchema, contentHash, coverage, deliverJob, emptyState, fillPlan, type Delivery, type Job, type State } from "./kong-autopilot-core";

const BRAND = 6475033;
const INTERVAL = 15 * 60_000;
const LOCK = 6475033;
type Env = Record<string, string | undefined>;
const verifiedNetworks = (env: Env) => (env.KONG_METRICOOL_ACCOUNTS_VERIFIED || "").split(",").filter(n => ["tiktok", "youtube"].includes(n));

export function readiness(env: Env) {
  const blockers: string[] = [];
  for (const key of ["DATABASE_URL", "KONG_OWNER_USER_ID", "KONG_CATALOG_URL", "KONG_MEDIA_ORIGINS", "METRICOOL_USER_TOKEN", "METRICOOL_USER_ID"])
    if (!env[key]?.trim()) blockers.push(`missing_${key.toLowerCase()}`);
  if (!verifiedNetworks(env).length) blockers.push("verify_kong_accounts");
  if (env.KONG_AUTOPUBLISH_ENABLED !== "true") blockers.push("autopublishing_disabled");
  return { enabled: env.KONG_AUTOPILOT_ENABLED === "true", blockers, brandId: BRAND, networks: ["tiktok", "youtube"],
    verifiedNetworks: verifiedNetworks(env), blockedNetworks: ["tiktok", "youtube"].filter(n => !verifiedNetworks(env).includes(n)),
    sourceMode: "remote_reviewed_catalog", discovery: "not_implemented", rendering: "not_implemented", learning: "not_implemented", paidAiCalls: 0 };
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
async function bytesAt(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
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
      const info: Record<string, unknown> = { autoPublish: true, draft: false, text: job.asset.caption,
        providers: [{ network: job.network }], publicationDate: { dateTime: job.at.slice(0, 19), timezone: "America/New_York" },
        shortener: false, mediaAltText: [], descendants: [], firstCommentText: "", hasNotReadNotes: false,
        smartLinkData: { ids: [] } };
      if (job.network === "tiktok") info.tiktokData = { title: job.asset.title, privacyOption: "PUBLIC_TO_EVERYONE",
        commercialContentOwnBrand: true, commercialContentThirdParty: false, autoAddMusic: false,
        disableComment: false, disableDuet: false, disableStitch: false, photoCoverIndex: 0 };
      else info.youtubeData = { title: job.asset.title, type: "short", privacy: "public", madeForKids: false, category: "ENTERTAINMENT", tags: ["KONG", "Nightlife", "Shorts"] };
      await callMetricoolMcpTool(fetcher, token, "createScheduledPost", { date: job.at, blogId: String(BRAND),
        info: JSON.stringify(info), mediaFiles: [{ download_url: job.asset.mediaUrl, file_id: `${job.asset.sha256}-${job.network}.mp4` }] });
    },
  };
}

export function createKongCloudRuntime(env: Env = process.env) {
  let pool: Pool | undefined, timer: ReturnType<typeof setInterval> | undefined, running = false;
  let lastError: string | undefined, lastCycleAt: string | undefined;
  const getPool = () => pool ||= new Pool({ connectionString: env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
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
      const save = async () => { await client!.query("INSERT INTO kong_cloud_autopilot(id,state) VALUES('kong',$1::jsonb) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state", [JSON.stringify(state)]); };
      const now = new Date();
      lastError = undefined;
      // First reconcile outstanding intents even when the source catalog is down.
      const ready = readiness(env);
      const delivery = createDelivery(env);
      if (!ready.blockers.length) for (const job of state.jobs.filter(j => ready.verifiedNetworks.includes(j.network) && ["submitting", "uncertain"].includes(j.state))
        .sort((a, b) => (a.lastReconciledAt || "").localeCompare(b.lastReconciledAt || "")).slice(0, 10)) {
        job.lastReconciledAt = now.toISOString();
        await save();
        try { await deliverJob(job, delivery, save, now); } catch { lastError = "metricool_reconciliation_failed"; }
      }
      if (!env.KONG_CATALOG_URL || !env.KONG_MEDIA_ORIGINS) throw new Error("remote_catalog_not_configured");
      const origins = env.KONG_MEDIA_ORIGINS.split(",").map(v => v.trim());
      const catalogUrl = approvedUrl(env.KONG_CATALOG_URL, origins);
      const catalog = catalogSchema.parse(JSON.parse(Buffer.from(await bytesAt(catalogUrl, 2_000_000)).toString("utf8")));
      const assets = catalog.assets.filter(a => { try { approvedUrl(a.mediaUrl, origins); return !assetProblem(a, now); } catch { return false; } });
      fillPlan(state, assets, now, wall => formatMetricoolMcpDate(wall, "America/New_York"));
      state.lastCycleAt = now.toISOString(); await save();
      if (!ready.blockers.length) {
        for (const job of state.jobs.filter(j => j.state === "planned" && ready.verifiedNetworks.includes(j.network)
          && (!j.nextAttemptAt || Date.parse(j.nextAttemptAt) <= +now)).sort((a, b) => (a.nextAttemptAt || "").localeCompare(b.nextAttemptAt || "")).slice(0, 10)) {
          const current = assets.find(a => a.sha256 === job.asset.sha256 && a.id === job.asset.id);
          if (!current || assetProblem(current, new Date(job.at), now)) { job.state = "blocked"; job.reason = "asset_removed_or_evidence_expired"; await save(); continue; }
          // Pre-submit jobs use the full current reviewed catalog record. Intents
          // already sent to Metricool keep their exact reconciliation snapshot.
          job.asset = current;
          if (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > +now) continue;
          try {
            approvedUrl(job.asset.mediaUrl, origins);
            const bytes = await bytesAt(job.asset.mediaUrl, 100_000_000);
            if (contentHash(bytes) !== job.asset.sha256) { job.state = "blocked"; job.reason = "media_hash_changed"; await save(); continue; }
            await deliverJob(job, delivery, save, now);
          } catch {
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
      return { ...readiness(env), running, lastCycleAt: state?.lastCycleAt || lastCycleAt, lastError,
        localLedgerCoverage: state ? coverage(state, new Date()) : null, remoteCoverageVerified: false,
        receipts: state?.jobs.filter(j => j.receipt).map(j => ({ id: j.id, receipt: j.receipt, at: j.at })) || [] };
    },
  };
}
export function registerKongCloudAutopilot(app: Express) {
  const runtime = createKongCloudRuntime();
  app.get("/api/kong-autopilot/status", async (req, res) => {
    if (!process.env.KONG_OWNER_USER_ID || resolveCurrentUserId(req) !== process.env.KONG_OWNER_USER_ID) { res.status(403).json({ error: "owner_required" }); return; }
    try { res.json(await runtime.status()); } catch { res.status(503).json({ error: "status_unavailable" }); }
  });
  runtime.start();
  return runtime;
}
