import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Mac -> Replit office bridge. After each local cycle the free local worker
 * sends a compact, numeric-only summary (proof-backed clip metrics + one cycle
 * report) to the web, which validates it with the same office source schemas
 * and stores it as clip_metrics / clip_report documents.
 *
 * Fail closed: without CLIPPERS_OFFICE_INGEST_URL (https) and
 * CLIPPERS_OFFICE_INGEST_TOKEN (>= 32 chars) nothing is sent. Only rows that
 * reconciliation proved published (exact public URL) with an explicit views
 * count are sent; nothing is estimated. URLs, captions and media never leave
 * the Mac.
 */
export const OFFICE_BRIDGE_MAX_RECORDS = 2000;
const TIMEOUT_MS = 15_000;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
function count(value) {
  const n = Number(value);
  return typeof value === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}
function isoOrNull(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}
async function readJsonArray(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function bridgeConfig(env = process.env) {
  const url = clean(env.CLIPPERS_OFFICE_INGEST_URL);
  const token = clean(env.CLIPPERS_OFFICE_INGEST_TOKEN);
  if (!url || !token) return { ok: false, reason: "office_bridge_not_configured" };
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, reason: "office_bridge_url_invalid" }; }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return { ok: false, reason: "office_bridge_url_not_https" };
  if (token.length < 32) return { ok: false, reason: "office_bridge_token_too_short" };
  return { ok: true, url: parsed.toString(), token };
}

/**
 * Provider adapters. Each one is the ONLY place that knows a publishing
 * provider's local files and field names; it returns provider-neutral rows:
 *   posts:  { provider, postId, accountId, clipId, publishedAt, views, likes, comments, shares, saves }
 *   ledger: { status: "published"|"scheduled"|"blocked"|"pending", publishedAt }
 *   queueLength
 * To switch providers, add an adapter and select it with CLIPPERS_PUBLISHING_PROVIDER.
 */
export const OFFICE_BRIDGE_ADAPTERS = {
  async metricool(workspaceRoot) {
    const metricsRows = await readJsonArray(path.join(workspaceRoot, "research", "paid-streamer-campaign-metrics.json"));
    const ledgerRows = await readJsonArray(path.join(workspaceRoot, "reports", "metricool-autopilot-ledger.json"));
    const queue = await readJsonArray(path.join(workspaceRoot, "reports", "metricool-autopilot-queue.json"));
    const posts = [];
    for (const row of metricsRows) {
      if (!row || clean(row.finalStatus) !== "published" || !clean(row.publishedPostUrl) || row.metricEvidenceVerified !== true) continue;
      const views = count(row.views);
      const postId = clean(row.metricoolId) || clean(row.itemId);
      if (views === undefined || !postId) continue;
      posts.push({ provider: "metricool", postId, accountId: clean(row.account), clipId: clean(row.itemId) || clean(row.draftFile),
        publishedAt: row.publishedAt, views, likes: count(row.likes), comments: count(row.comments), shares: count(row.shares), saves: count(row.saves) });
    }
    const map = { published: "published", scheduled: "scheduled", verification_pending: "scheduled", blocked: "blocked", failed: "blocked" };
    const ledger = ledgerRows.map((row) => ({ status: map[clean(row?.status).toLowerCase()] || "pending", publishedAt: clean(row?.publishedAt) }));
    return { posts, ledger, queueLength: queue.length };
  },
};

/** Builds the provider-neutral payload from the selected adapter's rows. */
export async function buildClipperOfficeBridgePayload({ workspaceRoot, workerReport, env = process.env, now = new Date(), adapters = OFFICE_BRIDGE_ADAPTERS }) {
  const providerName = clean(env.CLIPPERS_PUBLISHING_PROVIDER) || "metricool";
  const adapter = adapters[providerName];
  if (!adapter) throw new Error("office_bridge_unknown_provider");
  const source = await adapter(workspaceRoot);
  const records = [];
  const seen = new Set();
  for (const post of source.posts) {
    if (records.length >= OFFICE_BRIDGE_MAX_RECORDS) break;
    const provider = clean(post.provider), postId = clean(post.postId), views = count(post.views);
    if (!provider || !postId || views === undefined || seen.has(`${provider}:${postId}`)) continue;
    seen.add(`${provider}:${postId}`);
    records.push({
      provider: provider.slice(0, 40),
      postId: postId.slice(0, 400),
      accountId: (clean(post.accountId) || "unknown").slice(0, 500),
      clipId: (clean(post.clipId) || postId).slice(0, 500),
      publishedAt: isoOrNull(post.publishedAt),
      views,
      // Secondary counters the provider did not return are sent as 0 because the
      // office schema requires numbers; views (the audited signal) is never filled in.
      likes: count(post.likes) ?? 0,
      comments: count(post.comments) ?? 0,
      shares: count(post.shares) ?? 0,
      saves: count(post.saves) ?? 0,
    });
  }
  const statuses = source.ledger.map((row) => row.status);
  const dailyTarget = Math.max(0, Math.floor(Number(env.CLIPPERS_TARGET_DAILY_CLIPS) || 5));
  const today = now.toISOString().slice(0, 10);
  const publishedToday = source.ledger.filter((row) => row.status === "published" && clean(row.publishedAt).slice(0, 10) === today).length;
  const workerStatus = clean(workerReport?.status);
  const cycle = {
    createdAt: isoOrNull(workerReport?.finishedAt) || now.toISOString(),
    status: workerStatus === "completed" ? "ready" : workerStatus === "partial" ? "partial" : "blocked",
    totals: {
      posts: statuses.filter((s) => s === "published").length,
      dailyTargetPosts: dailyTarget,
      weeklyTargetClips: dailyTarget * 7,
      backlogPosts: source.queueLength,
      gapToDailyTarget: Math.max(0, dailyTarget - publishedToday),
      scheduled: statuses.filter((s) => s === "scheduled").length,
      readyForManual: 0,
      blocked: statuses.filter((s) => s === "blocked").length,
      draftReady: Math.max(0, Math.floor(Number(workerReport?.renderingReport?.summary?.rendered) || 0)),
      rightsReview: 0,
      needsSource: 0,
    },
  };
  return { version: 1, metrics: { generatedAt: now.toISOString(), records }, cycle };
}

/** Never throws; returns a small status object for the worker report. */
export async function sendClipperOfficeBridge({ workspaceRoot, workerReport, env = process.env, fetchImpl = globalThis.fetch, now = new Date(), log = console.warn }) {
  const config = bridgeConfig(env);
  if (!config.ok) {
    log(`[clippers-office-bridge] skipped: ${config.reason}`);
    return { status: "skipped", reason: config.reason };
  }
  try {
    const payload = await buildClipperOfficeBridgePayload({ workspaceRoot, workerReport, env, now });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      log(`[clippers-office-bridge] rejected: HTTP ${response.status}`);
      return { status: "failed", reason: `http_${response.status}`, records: payload.metrics.records.length };
    }
    return { status: "sent", records: payload.metrics.records.length, cycleStatus: payload.cycle.status };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : String(error?.message || "").startsWith("office_bridge_") ? error.message : "network_error";
    log(`[clippers-office-bridge] failed: ${reason}`);
    return { status: "failed", reason };
  }
}
