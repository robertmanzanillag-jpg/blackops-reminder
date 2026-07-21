import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type ClipperLocalNewsLane = "miami-news" | "ny-news";
export type ClipperLocalNewsPlatform = "x" | "facebook";
export type ClipperLocalNewsRisk = "low" | "medium" | "high" | "critical";
export type ClipperLocalNewsLifecycle = "active" | "resolved";
export type ClipperLocalNewsQueueStatus = "approval_required" | "auto_eligible";

export interface ClipperLocalNewsRawEvent {
  id?: string;
  sourceEventId?: string;
  source?: string;
  sourceUrl?: string;
  lane?: ClipperLocalNewsLane;
  title?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  location?: string;
  areaDesc?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  eventType?: string;
  effective?: string;
  expires?: string;
  status?: string;
  active?: boolean;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ClipperLocalNewsEvent {
  id: string;
  sourceEventId: string;
  source: string;
  sourceUrl: string;
  lane: ClipperLocalNewsLane;
  title: string;
  description: string;
  instruction: string;
  location: string;
  eventType: string;
  severity: string;
  urgency: string;
  certainty: string;
  risk: ClipperLocalNewsRisk;
  lifecycle: ClipperLocalNewsLifecycle;
  effective: string | null;
  expires: string | null;
  firstSeenAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  revision: number;
  fingerprint: string;
}

export interface ClipperLocalNewsQueueItem {
  id: string;
  eventId: string;
  eventRevision: number;
  lane: ClipperLocalNewsLane;
  platform: ClipperLocalNewsPlatform;
  copy: string;
  source: string;
  sourceUrl: string;
  risk: ClipperLocalNewsRisk;
  lifecycle: ClipperLocalNewsLifecycle;
  status: ClipperLocalNewsQueueStatus;
  approvalRequired: boolean;
  autoEligible: boolean;
  published: false;
  createdAt: string;
}

export interface ClipperLocalNewsMetricInput {
  queueItemId?: string;
  eventId?: string;
  lane: ClipperLocalNewsLane;
  platform: ClipperLocalNewsPlatform;
  impressions?: number;
  engagements?: number;
  clicks?: number;
  shares?: number;
  revenueUsd?: number;
  costUsd?: number;
  observedAt?: string;
}

export interface ClipperLocalNewsMetric extends Required<Omit<ClipperLocalNewsMetricInput, "queueItemId" | "eventId" | "observedAt">> {
  id: string;
  queueItemId: string | null;
  eventId: string | null;
  observedAt: string;
  recordedAt: string;
}

export interface ClipperLocalNewsStatus {
  workspaceDir: string;
  bootstrapped: boolean;
  scheduleMinutes: number;
  lastRunAt: string | null;
  lanes: Record<ClipperLocalNewsLane, { active: number; resolved: number; queued: number }>;
  events: { total: number; active: number; resolved: number };
  queue: { total: number; approvalRequired: number; autoEligible: number; published: 0 };
  metrics: { total: number; impressions: number; engagements: number; clicks: number; shares: number; revenueUsd: number; costUsd: number; profitUsd: number };
  connectors: Array<{ id: string; lane: ClipperLocalNewsLane; configured: boolean; requiresKey: boolean; public: boolean }>;
  coverage: {
    weather: "nws_public";
    miamiTraffic: "configured_feed" | "not_configured";
    nyTraffic: "ny511_configured" | "not_configured";
    roadCoverageComplete: false;
    note: string;
  };
  artifacts: Record<string, string>;
  guardrails: string[];
}

export interface ClipperLocalNewsOptions {
  workspaceDir?: string;
  now?: string | Date;
  env?: NodeJS.ProcessEnv;
}

export interface ClipperLocalNewsIngestInput extends ClipperLocalNewsOptions {
  events: ClipperLocalNewsRawEvent[];
  resolveMissing?: boolean;
  snapshotLanes?: ClipperLocalNewsLane[];
}

export interface ClipperLocalNewsCycleInput extends ClipperLocalNewsOptions {
  events?: ClipperLocalNewsRawEvent[];
  fetch?: typeof globalThis.fetch;
  resolveMissing?: boolean;
  snapshotLanes?: ClipperLocalNewsLane[];
}

export interface ClipperLocalNewsMetricsInput extends ClipperLocalNewsOptions {
  metrics: ClipperLocalNewsMetricInput[];
}

interface LocalNewsState {
  version: 1;
  bootstrappedAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  scheduleMinutes: number;
  events: ClipperLocalNewsEvent[];
  queue: ClipperLocalNewsQueueItem[];
  metrics: ClipperLocalNewsMetric[];
}

const LANES: ClipperLocalNewsLane[] = ["miami-news", "ny-news"];
const PLATFORMS: ClipperLocalNewsPlatform[] = ["x", "facebook"];
const MAX_BATCH_SIZE = 500;
const DEFAULT_WORKSPACE = path.join(process.cwd(), "clippers_workspace", "local-news");
const FILES = {
  state: "state.json",
  events: "events.json",
  queue: "metricool-queue.json",
  queueCsv: "metricool-queue.csv",
  analytics: "analytics.json",
  analyticsCsv: "analytics.csv",
  runbook: "RUNBOOK.md",
  sources: "SOURCE_SETUP.md",
} as const;

function workspace(options?: ClipperLocalNewsOptions): string {
  return path.resolve(options?.workspaceDir || options?.env?.CLIPPERS_LOCAL_NEWS_WORKSPACE || process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE || DEFAULT_WORKSPACE);
}

function isoNow(value?: string | Date): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid now value");
  return date.toISOString();
}

function clean(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function safeUrl(value: unknown, fallback: string): string {
  const candidate = clean(value);
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function riskFor(input: { severity: string; urgency: string; title: string; eventType: string; description?: string; instruction?: string; location?: string }): ClipperLocalNewsRisk {
  const text = `${input.severity} ${input.urgency} ${input.title} ${input.eventType} ${input.description || ""} ${input.instruction || ""} ${input.location || ""}`.toLowerCase();
  if (/extreme|catastrophic|tornado emergency|hurricane warning|flash flood emergency|evacuat|\bdeath\b|\bdead\b|fatalit|fallecid|muerte|tiroteo|shooting|homicid|asesinat/.test(text)) return "critical";
  if (/severe|immediate|warning|tornado|hurricane|flash flood|life[- ]threat|arrest|detenid|acusad|charged|indict|\bminor child\b|\bmenor(?:es)?\b|victim|víctima|violence|violencia|rumou?r|rumor|unconfirmed|no confirmado|sin confirmar|identified as|identificad[oa] como|named as/.test(text)) return "high";
  if (/moderate|expected|watch|flood|storm|snow|traffic|closure|crash|incident/.test(text)) return "medium";
  return "low";
}

function inferLane(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>): ClipperLocalNewsLane {
  if (raw.lane && LANES.includes(raw.lane)) return raw.lane;
  const text = `${clean(raw.location || raw.areaDesc || props.areaDesc)} ${clean(raw.source)} ${clean(raw.title || raw.headline || props.headline)}`.toLowerCase();
  return /miami|dade|broward|florida|\bfl\b/.test(text) ? "miami-news" : "ny-news";
}

function isResolved(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>, now: string): boolean {
  if (raw.active === false) return true;
  if (/\b(resolved|cleared|cancelled|canceled|expired|ended|reopened)\b/.test(clean(raw.status || props.status).toLowerCase())) return true;
  const expires = clean(raw.expires || props.expires || props.ends);
  if (!expires) return false;
  const expiresAt = new Date(expires).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= new Date(now).getTime();
}

export function normalizeClipperLocalNewsEvent(raw: ClipperLocalNewsRawEvent, now = isoNow()): Omit<ClipperLocalNewsEvent, "firstSeenAt" | "updatedAt" | "resolvedAt" | "revision"> {
  const props = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
  const source = clean(raw.source || props.senderName || props.source, "public-feed");
  const sourceUrl = safeUrl(raw.sourceUrl || props.web || props.url || props.uri || raw.id, "https://www.weather.gov/");
  const sourceEventId = clean(raw.sourceEventId || props.id || raw.id) || digest(JSON.stringify([source, raw.title, raw.location, raw.effective]));
  const title = clean(raw.title || raw.headline || props.headline || props.event, "Local public update");
  const description = clean(raw.description || props.description);
  const instruction = clean(raw.instruction || props.instruction);
  const location = clean(raw.location || raw.areaDesc || props.areaDesc, inferLane(raw, props) === "miami-news" ? "Miami area" : "New York area");
  const eventType = clean(raw.eventType || props.event, title);
  const severity = clean(raw.severity || props.severity, "Unknown");
  const urgency = clean(raw.urgency || props.urgency, "Unknown");
  const certainty = clean(raw.certainty || props.certainty, "Unknown");
  const lane = inferLane(raw, props);
  const lifecycle: ClipperLocalNewsLifecycle = isResolved(raw, props, now) ? "resolved" : "active";
  const effective = clean(raw.effective || props.effective || props.sent) || null;
  const expires = clean(raw.expires || props.expires || props.ends) || null;
  const risk = riskFor({ severity, urgency, title, eventType, description, instruction, location });
  const fingerprint = digest(JSON.stringify({ title, description, instruction, location, eventType, severity, urgency, certainty, lifecycle, effective, expires, sourceUrl }));
  return { id: digest(`${source.toLowerCase()}|${sourceEventId.toLowerCase()}`), sourceEventId, source, sourceUrl, lane, title, description, instruction, location, eventType, severity, urgency, certainty, risk, lifecycle, effective, expires, fingerprint };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 1) return text.slice(0, limit);
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function buildClipperLocalNewsCopy(event: ClipperLocalNewsEvent, platform: ClipperLocalNewsPlatform): string {
  const prefix = event.lifecycle === "resolved" ? "RESUELTO" : event.risk === "critical" ? "URGENTE" : event.risk === "high" ? "ALERTA" : "ACTUALIZACIÓN LOCAL";
  const attribution = `Fuente: ${event.source}`;
  if (platform === "x") {
    const ending = `\nAviso: verifica la fuente oficial. ${attribution} ${event.sourceUrl}`;
    const body = `${prefix}: ${event.title} — ${event.location}. ${event.instruction || event.description}`.trim();
    return `${truncate(body, Math.max(1, 280 - ending.length))}${ending}`.slice(0, 280);
  }
  const detail = event.description || event.instruction || "Consulta la fuente oficial para conocer la información más reciente.";
  return `${prefix}: ${event.title}\n\n${event.location}\n${detail}\n\nAviso: verifica la información oficial antes de actuar.\n${attribution}\n${event.sourceUrl}`;
}

const rawEventSchema = z.object({
  id: z.string().max(2_000).optional(),
  sourceEventId: z.string().min(1).max(500).optional(),
  source: z.string().min(1).max(300).optional(),
  sourceUrl: z.string().url().max(2_000).optional(),
  lane: z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]]).optional(),
  title: z.string().max(1_000).optional(),
  headline: z.string().max(1_000).optional(),
  description: z.string().max(20_000).optional(),
  instruction: z.string().max(10_000).optional(),
  location: z.string().max(1_000).optional(),
  areaDesc: z.string().max(1_000).optional(),
  severity: z.string().max(100).optional(),
  urgency: z.string().max(100).optional(),
  certainty: z.string().max(100).optional(),
  eventType: z.string().max(500).optional(),
  effective: z.string().datetime({ offset: true }).optional(),
  expires: z.string().datetime({ offset: true }).optional(),
  status: z.string().max(100).optional(),
  active: z.boolean().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const snapshotFieldsSchema = z.object({
  events: z.array(rawEventSchema).max(MAX_BATCH_SIZE),
  resolveMissing: z.boolean().optional(),
  snapshotLanes: z.array(z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]])).min(1).max(LANES.length).optional(),
}).superRefine((value, context) => {
  if (value.resolveMissing && !value.snapshotLanes?.length) context.addIssue({ code: "custom", path: ["snapshotLanes"], message: "snapshotLanes is required when resolveMissing is true" });
});
const ingestPayloadSchema = snapshotFieldsSchema;
const cyclePayloadSchema = z.object({
  events: z.array(rawEventSchema).max(MAX_BATCH_SIZE).optional(), resolveMissing: z.boolean().optional(),
  snapshotLanes: z.array(z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]])).min(1).max(LANES.length).optional(),
}).superRefine((value, context) => {
  if (value.resolveMissing && (value.events === undefined || !value.snapshotLanes?.length)) context.addIssue({ code: "custom", path: ["snapshotLanes"], message: "events and snapshotLanes are required when resolveMissing is true" });
});
const metricPayloadSchema = z.object({
  metrics: z.array(z.object({
    queueItemId: z.string().min(1).max(500).optional(), eventId: z.string().min(1).max(500).optional(),
    lane: z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]]), platform: z.enum(PLATFORMS as [ClipperLocalNewsPlatform, ...ClipperLocalNewsPlatform[]]),
    impressions: z.number().finite().nonnegative().optional(), engagements: z.number().finite().nonnegative().optional(), clicks: z.number().finite().nonnegative().optional(), shares: z.number().finite().nonnegative().optional(),
    revenueUsd: z.number().finite().nonnegative().optional(), costUsd: z.number().finite().nonnegative().optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
  }).strict()).max(MAX_BATCH_SIZE),
});

function scheduleMinutes(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES || "3", 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(2, parsed)) : 3;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

async function readState(dir: string): Promise<LocalNewsState | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, FILES.state), "utf8")) as LocalNewsState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv<T extends object>(rows: T[], columns: string[]): string {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell((row as Record<string, unknown>)[column])).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

async function persist(dir: string, state: LocalNewsState): Promise<void> {
  const analytics = summarizeMetrics(state.metrics);
  const queueColumns = ["id", "eventId", "eventRevision", "lane", "platform", "risk", "lifecycle", "status", "approvalRequired", "autoEligible", "published", "copy", "source", "sourceUrl", "createdAt"];
  const metricColumns = ["id", "queueItemId", "eventId", "lane", "platform", "impressions", "engagements", "clicks", "shares", "revenueUsd", "costUsd", "observedAt", "recordedAt"];
  await Promise.all([
    atomicWrite(path.join(dir, FILES.state), `${JSON.stringify(state, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.events), `${JSON.stringify({ generatedAt: state.updatedAt, events: state.events }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.queue), `${JSON.stringify({ generatedAt: state.updatedAt, disclaimer: "Queue only; no real publication is claimed.", items: state.queue }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.queueCsv), csv(state.queue, queueColumns)),
    atomicWrite(path.join(dir, FILES.analytics), `${JSON.stringify({ generatedAt: state.updatedAt, summary: analytics, metrics: state.metrics }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.analyticsCsv), csv(state.metrics, metricColumns)),
  ]);
}

function summarizeMetrics(metrics: ClipperLocalNewsMetric[]) {
  const totals = metrics.reduce((summary, metric) => ({ total: summary.total + 1, impressions: summary.impressions + metric.impressions, engagements: summary.engagements + metric.engagements, clicks: summary.clicks + metric.clicks, shares: summary.shares + metric.shares, revenueUsd: summary.revenueUsd + (metric.revenueUsd || 0), costUsd: summary.costUsd + (metric.costUsd || 0) }), { total: 0, impressions: 0, engagements: 0, clicks: 0, shares: 0, revenueUsd: 0, costUsd: 0 });
  const revenueUsd = Math.round(totals.revenueUsd * 100) / 100;
  const costUsd = Math.round(totals.costUsd * 100) / 100;
  return { ...totals, revenueUsd, costUsd, profitUsd: Math.round((revenueUsd - costUsd) * 100) / 100 };
}

function sourceSetup(): string {
  return `# Local News Source Setup\n\n- NWS: public, no API key. The agent reads active alerts for Florida and New York.\n- NY511: optional and subject to its access agreement. Set both \`NY511_API_KEY\` and \`NY511_FEED_URL\`; the key is sent only at request time and is never written here.\n- Miami traffic: no complete default road feed is assumed. Set an authorized \`FL511_FEED_URL\` or \`MIAMI_NEWS_FEED_URL\`; do not use the Leon County-only ArcGIS public view as Miami coverage.\n- Generic NY feed: optional \`NY_NEWS_FEED_URL\`.\n- Webhook/manual ingestion: call the ingest function with attributed public events.\n\nOnly use public/authorized feeds. Keep secrets in environment variables. Without the optional traffic connectors, status must not be interpreted as complete road coverage.\n`;
}

function runbook(minutes: number): string {
  return `# Local News Agent Runbook\n\n1. Run every ${minutes} minutes (supported range: 2–5).\n2. Low/medium risk items are \`auto_eligible\` by default once a separate Metricool executor is connected; set \`CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE=false\` to require approval for all items. High/critical content always remains \`approval_required\`.\n3. \`auto_eligible\` means eligible for that separate executor; it does not mean published.\n4. Verify location, timing, attribution, and the official source URL before approval.\n5. Resolve events only from an explicit resolved/cleared/cancelled/expired/ended/reopened update or a passed \`expires\` timestamp. A road status of \`closed\` describes an active closure and does not resolve it. Absence-based resolution is allowed only when calling ingest with \`resolveMissing: true\` for the exact controlled \`snapshotLanes\`; normal fetched cycles never enable it automatically.\n6. Import observed Metricool and money metrics separately; revenue, cost, and profit summarize only recorded observations and are never inferred from queue state.\n7. NWS supplies weather alerts, not complete road coverage. NY511 needs its key/agreement; Miami traffic needs an authorized configured feed.\n`;
}

export async function bootstrapClipperLocalNews(options: ClipperLocalNewsOptions = {}): Promise<ClipperLocalNewsStatus> {
  const dir = workspace(options);
  const now = isoNow(options.now);
  const env = options.env || process.env;
  await mkdir(dir, { recursive: true });
  let state = await readState(dir);
  if (!state) state = { version: 1, bootstrappedAt: now, updatedAt: now, lastRunAt: null, scheduleMinutes: scheduleMinutes(env), events: [], queue: [], metrics: [] };
  state.scheduleMinutes = scheduleMinutes(env);
  state.updatedAt = now;
  await Promise.all([
    atomicWrite(path.join(dir, FILES.runbook), runbook(state.scheduleMinutes)),
    atomicWrite(path.join(dir, FILES.sources), sourceSetup()),
  ]);
  await persist(dir, state);
  return getClipperLocalNewsStatus({ ...options, workspaceDir: dir });
}

function queueFor(event: ClipperLocalNewsEvent, now: string, env: NodeJS.ProcessEnv): ClipperLocalNewsQueueItem[] {
  const autoEnabled = !/^(0|false|no)$/i.test(env.CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE || "true");
  const gated = event.risk === "high" || event.risk === "critical" || !autoEnabled;
  return PLATFORMS.map((platform) => ({ id: digest(`${event.id}|${event.revision}|${platform}`), eventId: event.id, eventRevision: event.revision, lane: event.lane, platform, copy: buildClipperLocalNewsCopy(event, platform), source: event.source, sourceUrl: event.sourceUrl, risk: event.risk, lifecycle: event.lifecycle, status: gated ? "approval_required" : "auto_eligible", approvalRequired: gated, autoEligible: !gated, published: false, createdAt: now }));
}

export async function ingestClipperLocalNewsEvents(input: ClipperLocalNewsIngestInput): Promise<{ created: number; updated: number; duplicates: number; resolved: number; queued: number; status: ClipperLocalNewsStatus }> {
  ingestPayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const state = (await readState(dir))!;
  const now = isoNow(input.now);
  const env = input.env || process.env;
  const byId = new Map(state.events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  let created = 0, updated = 0, duplicates = 0, resolved = 0, queued = 0;
  for (const raw of input.events) {
    const normalized = normalizeClipperLocalNewsEvent(raw, now);
    seen.add(normalized.id);
    const previous = byId.get(normalized.id);
    if (previous?.fingerprint === normalized.fingerprint) { duplicates += 1; continue; }
    const event: ClipperLocalNewsEvent = { ...normalized, firstSeenAt: previous?.firstSeenAt || now, updatedAt: now, resolvedAt: normalized.lifecycle === "resolved" ? now : null, revision: (previous?.revision || 0) + 1 };
    byId.set(event.id, event);
    previous ? updated += 1 : created += 1;
    if (event.lifecycle === "resolved") resolved += 1;
    const newItems = queueFor(event, now, env);
    for (const item of newItems) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; }
  }
  if (input.resolveMissing) {
    const lanes = new Set(input.snapshotLanes?.length ? input.snapshotLanes : LANES);
    for (const [id, previous] of byId) {
      if (previous.lifecycle !== "active" || !lanes.has(previous.lane) || seen.has(id)) continue;
      const event = { ...previous, lifecycle: "resolved" as const, resolvedAt: now, updatedAt: now, revision: previous.revision + 1 };
      event.fingerprint = digest(`${previous.fingerprint}|resolved`);
      byId.set(id, event);
      updated += 1; resolved += 1;
      for (const item of queueFor(event, now, env)) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; }
    }
  }
  const nowMs = new Date(now).getTime();
  for (const [id, previous] of byId) {
    if (previous.lifecycle !== "active" || !previous.expires) continue;
    const expiresAt = new Date(previous.expires).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs) continue;
    const event = { ...previous, lifecycle: "resolved" as const, resolvedAt: now, updatedAt: now, revision: previous.revision + 1 };
    event.fingerprint = digest(`${previous.fingerprint}|expired`);
    byId.set(id, event);
    updated += 1; resolved += 1;
    for (const item of queueFor(event, now, env)) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; }
  }
  state.events = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  state.updatedAt = now;
  await persist(dir, state);
  return { created, updated, duplicates, resolved, queued, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

interface SourceDefinition { id: string; lane: ClipperLocalNewsLane; url: string; requiresKey: boolean; key?: string }
interface ConnectorDefinition { id: string; lane: ClipperLocalNewsLane; configured: boolean; requiresKey: boolean; public: boolean }

function connectorCatalog(env: NodeJS.ProcessEnv): ConnectorDefinition[] {
  return [
    { id: "nws-miami", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "nws-nyc", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "ny511", lane: "ny-news", configured: Boolean(env.NY511_FEED_URL && env.NY511_API_KEY), requiresKey: true, public: false },
    { id: "fl511", lane: "miami-news", configured: Boolean(env.FL511_FEED_URL), requiresKey: false, public: false },
    { id: "miami-generic", lane: "miami-news", configured: Boolean(env.MIAMI_NEWS_FEED_URL), requiresKey: false, public: false },
    { id: "ny-generic", lane: "ny-news", configured: Boolean(env.NY_NEWS_FEED_URL), requiresKey: false, public: false },
  ];
}

function sources(env: NodeJS.ProcessEnv): SourceDefinition[] {
  const result: SourceDefinition[] = [
    { id: "nws-miami", lane: "miami-news", url: "https://api.weather.gov/alerts/active?point=25.7617,-80.1918", requiresKey: false },
    { id: "nws-nyc", lane: "ny-news", url: "https://api.weather.gov/alerts/active?point=40.7128,-74.0060", requiresKey: false },
  ];
  if (env.NY511_FEED_URL && env.NY511_API_KEY) result.push({ id: "ny511", lane: "ny-news", url: env.NY511_FEED_URL, requiresKey: true, key: env.NY511_API_KEY });
  if (env.FL511_FEED_URL) result.push({ id: "fl511", lane: "miami-news", url: env.FL511_FEED_URL, requiresKey: false });
  if (env.MIAMI_NEWS_FEED_URL) result.push({ id: "miami-generic", lane: "miami-news", url: env.MIAMI_NEWS_FEED_URL, requiresKey: false });
  if (env.NY_NEWS_FEED_URL) result.push({ id: "ny-generic", lane: "ny-news", url: env.NY_NEWS_FEED_URL, requiresKey: false });
  return result;
}

function extractEvents(payload: unknown): ClipperLocalNewsRawEvent[] {
  if (Array.isArray(payload)) return payload as ClipperLocalNewsRawEvent[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["features", "events", "incidents", "items", "results"]) if (Array.isArray(record[key])) return record[key] as ClipperLocalNewsRawEvent[];
  return [];
}

export async function runClipperLocalNewsCycle(input: ClipperLocalNewsCycleInput = {}): Promise<{ fetchedSources: number; failedSources: Array<{ id: string; error: string }>; created: number; updated: number; duplicates: number; resolved: number; queued: number; status: ClipperLocalNewsStatus }> {
  cyclePayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const now = isoNow(input.now);
  const env = input.env || process.env;
  let events = input.events;
  let fetchedSources = 0;
  const failedSources: Array<{ id: string; error: string }> = [];
  if (!events) {
    events = [];
    const fetcher = input.fetch || globalThis.fetch;
    for (const source of sources(env)) {
      if (source.requiresKey && !source.key) { failedSources.push({ id: source.id, error: "missing_api_key" }); continue; }
      try {
        const requestUrl = new URL(source.url);
        if (source.id === "ny511" && source.key) requestUrl.searchParams.set("key", source.key);
        const response = await fetcher(requestUrl, { headers: { Accept: "application/geo+json, application/json", "User-Agent": "asistente-local-news/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const extracted = extractEvents(await response.json()).map((event) => ({ ...event, lane: event.lane || source.lane, source: event.source || source.id }));
        events.push(...extracted); fetchedSources += 1;
      } catch (error) { failedSources.push({ id: source.id, error: error instanceof Error ? error.message : "fetch_failed" }); }
    }
  }
  const controlledSnapshot = input.events !== undefined && input.resolveMissing === true;
  const result = await ingestClipperLocalNewsEvents({ ...input, workspaceDir: dir, now, events, resolveMissing: controlledSnapshot, snapshotLanes: controlledSnapshot ? input.snapshotLanes : undefined });
  const state = (await readState(dir))!;
  state.lastRunAt = now; state.updatedAt = now;
  await persist(dir, state);
  return { fetchedSources, failedSources, created: result.created, updated: result.updated, duplicates: result.duplicates, resolved: result.resolved, queued: result.queued, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

function nonNegativeInteger(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(number);
}

function nonNegativeMoney(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(number * 100) / 100;
}

export async function recordClipperLocalNewsMetrics(input: ClipperLocalNewsMetricsInput): Promise<{ recorded: number; status: ClipperLocalNewsStatus }> {
  metricPayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const state = (await readState(dir))!;
  const now = isoNow(input.now);
  for (const item of input.metrics) {
    if (!LANES.includes(item.lane) || !PLATFORMS.includes(item.platform)) throw new Error("Invalid metric lane or platform");
    const metric: ClipperLocalNewsMetric = { id: digest(JSON.stringify([item.queueItemId, item.eventId, item.lane, item.platform, item.observedAt || now, state.metrics.length])), queueItemId: item.queueItemId || null, eventId: item.eventId || null, lane: item.lane, platform: item.platform, impressions: nonNegativeInteger(item.impressions, "impressions"), engagements: nonNegativeInteger(item.engagements, "engagements"), clicks: nonNegativeInteger(item.clicks, "clicks"), shares: nonNegativeInteger(item.shares, "shares"), revenueUsd: nonNegativeMoney(item.revenueUsd, "revenueUsd"), costUsd: nonNegativeMoney(item.costUsd, "costUsd"), observedAt: isoNow(item.observedAt || now), recordedAt: now };
    state.metrics.push(metric);
  }
  state.updatedAt = now;
  await persist(dir, state);
  return { recorded: input.metrics.length, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

export async function getClipperLocalNewsStatus(options: ClipperLocalNewsOptions = {}): Promise<ClipperLocalNewsStatus> {
  const dir = workspace(options);
  const state = await readState(dir);
  const env = options.env || process.env;
  const artifacts = Object.fromEntries(Object.entries(FILES).map(([key, filename]) => [key, path.join(dir, filename)]));
  const emptyLane = () => ({ active: 0, resolved: 0, queued: 0 });
  const lanes: ClipperLocalNewsStatus["lanes"] = { "miami-news": emptyLane(), "ny-news": emptyLane() };
  if (state) {
    for (const event of state.events) lanes[event.lane][event.lifecycle] += 1;
    for (const item of state.queue) lanes[item.lane].queued += 1;
  }
  const metrics = summarizeMetrics(state?.metrics || []);
  return {
    workspaceDir: dir, bootstrapped: Boolean(state), scheduleMinutes: state?.scheduleMinutes ?? scheduleMinutes(env), lastRunAt: state?.lastRunAt || null, lanes,
    events: { total: state?.events.length || 0, active: state?.events.filter((event) => event.lifecycle === "active").length || 0, resolved: state?.events.filter((event) => event.lifecycle === "resolved").length || 0 },
    queue: { total: state?.queue.length || 0, approvalRequired: state?.queue.filter((item) => item.approvalRequired).length || 0, autoEligible: state?.queue.filter((item) => item.autoEligible).length || 0, published: 0 },
    metrics,
    connectors: connectorCatalog(env),
    coverage: {
      weather: "nws_public",
      miamiTraffic: env.FL511_FEED_URL || env.MIAMI_NEWS_FEED_URL ? "configured_feed" : "not_configured",
      nyTraffic: env.NY511_FEED_URL && env.NY511_API_KEY ? "ny511_configured" : "not_configured",
      roadCoverageComplete: false,
      note: "NWS is weather-only. Complete road coverage is not claimed; optional traffic feeds require explicit authorized configuration.",
    },
    artifacts,
    guardrails: ["Queue state never proves or claims real publication.", "Revenue, cost, and profit include only explicitly recorded observations; no money is inferred.", "Low and medium risk items are auto-eligible by default; set CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE=false to opt out.", "High and critical risk items always require approval and are never auto-eligible.", "Secrets are read from environment variables and never persisted."],
  };
}

export const __clipperLocalNewsInternals = { riskFor, sources, connectorCatalog, truncate, extractEvents, scheduleMinutes };
