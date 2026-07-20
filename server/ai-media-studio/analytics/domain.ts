import { createHash, randomUUID } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";

export const SOCIAL_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube_shorts"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type AttributionDimension = "avatar" | "hook" | "cta" | "posting_time" | "category";

export interface AnalyticsMetrics {
  views: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  ctr: number;
  watchTimeMs: number;
  retentionRate: number;
}

export interface PublicationDimensions {
  avatar?: string;
  hook?: string;
  cta?: string;
  postingTime?: string;
  category?: string;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface Publication {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  videoId: string | null;
  mediaAssetId: string | null;
  platform: SocialPlatform;
  status: string;
  permalink: string | null;
  publishedAt: string | null;
  dimensions: PublicationDimensions;
  generationCost: Money | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSnapshot {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  publicationId: string;
  capturedAt: string;
  metrics: AnalyticsMetrics;
  createdAt: string;
}

export interface AnalyticsEvent {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  publicationId: string | null;
  source: string;
  eventType: string;
  occurredAt: string;
  dimensions: Record<string, string | number | boolean | null>;
  metrics: AnalyticsMetrics;
  createdAt: string;
}

export interface AnalyticsWindow {
  /** Inclusive ISO timestamp. */
  start: string;
  /** Exclusive ISO timestamp. */
  end: string;
  currency: string;
}

export interface AnalyticsFilter {
  platform?: SocialPlatform;
  publicationId?: string;
  videoId?: string;
  mediaAssetId?: string;
  category?: string;
  window?: Omit<AnalyticsWindow, "currency">;
}

export interface CursorPageRequest {
  limit?: number;
  cursor?: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PublicationSummary {
  publication: Publication;
  metrics: AnalyticsMetrics;
  latestCapturedAt: string | null;
  cost: Money | null;
  costPerView: number | null;
  zeroViewRule: "null_when_zero_views";
}

export interface AttributionRanking {
  dimension: AttributionDimension;
  value: string;
  publicationCount: number;
  metrics: AnalyticsMetrics;
  engagementRate: number;
  rank: number;
}

export interface AnalyticsSummary {
  window: AnalyticsWindow;
  metrics: AnalyticsMetrics;
  publicationCount: number;
  videoCount: number;
  costedVideoCount: number;
  excludedCurrencyCount: number;
  totalCost: Money;
  costPerVideo: number | null;
  costPerView: number | null;
  zeroViewRule: "null_when_zero_views";
  publications: PublicationSummary[];
  attribution: Record<AttributionDimension, AttributionRanking[]>;
}

export interface StoredPublicationCandidate extends Omit<Publication, "ownerUserId" | "workspaceId"> {
  externalIdentityDigest: string;
}

export interface StoredAnalyticsEventCandidate extends Omit<AnalyticsEvent, "ownerUserId" | "workspaceId"> {
  externalEventDigest: string;
}

export interface AnalyticsRepository {
  upsertPublication(scope: TenantScope, candidate: StoredPublicationCandidate): Promise<{ item: Publication; created: boolean }>;
  putSnapshot(scope: TenantScope, snapshot: Omit<AnalyticsSnapshot, "ownerUserId" | "workspaceId">): Promise<{ item: AnalyticsSnapshot; created: boolean }>;
  putEvent(scope: TenantScope, event: StoredAnalyticsEventCandidate): Promise<{ item: AnalyticsEvent; created: boolean }>;
  listPublications(scope: TenantScope, filter: AnalyticsFilter, page: Required<CursorPageRequest>): Promise<CursorPage<Publication>>;
  listSnapshots(scope: TenantScope, filter: AnalyticsFilter, page: Required<CursorPageRequest>): Promise<CursorPage<AnalyticsSnapshot>>;
  listEvents(scope: TenantScope, filter: AnalyticsFilter, page: Required<CursorPageRequest>): Promise<CursorPage<AnalyticsEvent>>;
}

export interface ProviderPublicationInput {
  providerPublicationId: string;
  videoId?: string | null;
  mediaAssetId?: string | null;
  platform: SocialPlatform;
  status?: string;
  permalink?: string | null;
  publishedAt?: string | null;
  dimensions?: PublicationDimensions;
  generationCost?: Money | null;
}

export interface ProviderSnapshotInput {
  providerPublicationId: string;
  capturedAt: string;
  metrics: Partial<AnalyticsMetrics>;
}

export interface ProviderEventInput {
  providerEventId: string;
  providerPublicationId?: string | null;
  eventType: string;
  occurredAt: string;
  dimensions?: Record<string, string | number | boolean | null>;
  metrics?: Partial<AnalyticsMetrics>;
}

export interface AnalyticsIngestionBatch {
  source: string;
  publications: ProviderPublicationInput[];
  snapshots?: ProviderSnapshotInput[];
  events?: ProviderEventInput[];
}

export interface AnalyticsIngestionAdapter {
  fetch(scope: TenantScope): Promise<AnalyticsIngestionBatch>;
}

const ZERO_METRICS: AnalyticsMetrics = {
  views: 0, impressions: 0, likes: 0, comments: 0, shares: 0,
  clicks: 0, ctr: 0, watchTimeMs: 0, retentionRate: 0,
};

export function zeroMetrics(): AnalyticsMetrics {
  return { ...ZERO_METRICS };
}

function finiteNonNegative(value: unknown, field: string, integer = true): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new AnalyticsValidationError(`${field} must be a non-negative ${integer ? "safe integer" : "number"}`);
  }
  return value;
}

export function normalizeMetrics(input: Partial<AnalyticsMetrics>): AnalyticsMetrics {
  const views = finiteNonNegative(input.views, "views");
  const impressions = finiteNonNegative(input.impressions, "impressions");
  const clicks = finiteNonNegative(input.clicks, "clicks");
  const suppliedCtr = input.ctr === undefined ? undefined : finiteNonNegative(input.ctr, "ctr", false);
  const retentionRate = finiteNonNegative(input.retentionRate, "retentionRate", false);
  if (suppliedCtr !== undefined && suppliedCtr > 1) throw new AnalyticsValidationError("ctr must be between 0 and 1");
  if (retentionRate > 1) throw new AnalyticsValidationError("retentionRate must be between 0 and 1");
  if (clicks > impressions) throw new AnalyticsValidationError("clicks must not exceed impressions");
  return {
    views,
    impressions,
    likes: finiteNonNegative(input.likes, "likes"),
    comments: finiteNonNegative(input.comments, "comments"),
    shares: finiteNonNegative(input.shares, "shares"),
    clicks,
    // CTR is always derived from the canonical counters so providers cannot
    // produce mutually inconsistent aggregate math.
    ctr: impressions === 0 ? 0 : clicks / impressions,
    watchTimeMs: finiteNonNegative(input.watchTimeMs, "watchTimeMs"),
    retentionRate,
  };
}

function sumMetrics(items: readonly AnalyticsMetrics[]): AnalyticsMetrics {
  const result = zeroMetrics();
  for (const item of items) {
    result.views += item.views;
    result.impressions += item.impressions;
    result.likes += item.likes;
    result.comments += item.comments;
    result.shares += item.shares;
    result.clicks += item.clicks;
    result.watchTimeMs += item.watchTimeMs;
  }
  result.ctr = result.impressions === 0 ? 0 : result.clicks / result.impressions;
  result.retentionRate = result.views === 0 ? 0 : items.reduce((sum, item) => sum + item.retentionRate * item.views, 0) / result.views;
  return result;
}

export class AnalyticsValidationError extends Error {
  readonly code = "ANALYTICS_VALIDATION";
}

export function assertPublicationMediaReference(value: Pick<Publication, "videoId" | "mediaAssetId">): void {
  if (value.videoId === null && value.mediaAssetId === null) {
    throw new AnalyticsValidationError("A publication requires videoId or mediaAssetId");
  }
}

function requiredText(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new AnalyticsValidationError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function isoTimestamp(value: unknown, field: string): string {
  const text = requiredText(value, field, 64);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new AnalyticsValidationError(`${field} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

function validateScope(scope: TenantScope): TenantScope {
  return { ownerUserId: requiredText(scope.ownerUserId, "ownerUserId"), workspaceId: requiredText(scope.workspaceId, "workspaceId") };
}

function currency(value: string): string {
  const normalized = requiredText(value, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new AnalyticsValidationError("currency must be a three-letter ISO currency code");
  return normalized;
}

function money(value: Money | null | undefined): Money | null {
  if (value == null) return null;
  return { amount: finiteNonNegative(value.amount, "generationCost.amount", false), currency: currency(value.currency) };
}

function pageRequest(input: CursorPageRequest): Required<CursorPageRequest> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AnalyticsValidationError("limit must be between 1 and 100");
  return { limit, cursor: input.cursor ?? "" };
}

function normalizedFilter(input: AnalyticsFilter): AnalyticsFilter {
  const output: AnalyticsFilter = {};
  if (input.platform !== undefined) {
    if (!SOCIAL_PLATFORMS.includes(input.platform)) throw new AnalyticsValidationError("Unsupported social platform");
    output.platform = input.platform;
  }
  if (input.publicationId !== undefined) output.publicationId = requiredText(input.publicationId, "publicationId");
  if (input.videoId !== undefined) output.videoId = requiredText(input.videoId, "videoId");
  if (input.mediaAssetId !== undefined) output.mediaAssetId = requiredText(input.mediaAssetId, "mediaAssetId");
  if (input.category !== undefined) output.category = requiredText(input.category, "category", 160);
  if (input.window) {
    const start = isoTimestamp(input.window.start, "window.start");
    const end = isoTimestamp(input.window.end, "window.end");
    if (start >= end) throw new AnalyticsValidationError("window.start must be before window.end");
    output.window = { start, end };
  }
  return output;
}

function identityDigest(scope: TenantScope, source: string, kind: string, rawId: string): string {
  return createHash("sha256").update(`${scope.ownerUserId}\0${scope.workspaceId}\0${source}\0${kind}\0${rawId}`).digest("hex");
}

function safePermalink(value: string | null | undefined): string | null {
  if (value == null) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe");
    return parsed.toString();
  } catch {
    throw new AnalyticsValidationError("permalink must be a public HTTPS URL without credentials");
  }
}

function normalizedDimensions(value: PublicationDimensions = {}): PublicationDimensions {
  const output: PublicationDimensions = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!["avatar", "hook", "cta", "postingTime", "category"].includes(key)) throw new AnalyticsValidationError(`Unsupported publication dimension: ${key}`);
    if (raw !== undefined) output[key as keyof PublicationDimensions] = requiredText(raw, `dimensions.${key}`, 160);
  }
  return output;
}

function safeEventDimensions(value: ProviderEventInput["dimensions"]): AnalyticsEvent["dimensions"] {
  const output: AnalyticsEvent["dimensions"] = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (/secret|token|password|credential|api.?key|external.?id|provider.?id/iu.test(key)) {
      throw new AnalyticsValidationError("Event dimensions contain a forbidden sensitive field");
    }
    requiredText(key, "event dimension key", 80);
    if (typeof item === "string" && item.length > 500) throw new AnalyticsValidationError("Event dimension string exceeds 500 characters");
    if (typeof item === "number" && !Number.isFinite(item)) throw new AnalyticsValidationError("Event dimension numbers must be finite");
    output[key] = item;
  }
  return output;
}

export interface AnalyticsServiceOptions { now?: () => Date; idFactory?: () => string }

export class AnalyticsService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly repository: AnalyticsRepository, options: AnalyticsServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async ingest(scopeInput: TenantScope, adapter: AnalyticsIngestionAdapter): Promise<{ publicationsCreated: number; snapshotsCreated: number; eventsCreated: number }> {
    const scope = validateScope(scopeInput);
    const batch = await adapter.fetch(scope);
    const source = requiredText(batch.source, "source", 80).toLowerCase();
    if (batch.publications.length > 1_000 || (batch.snapshots?.length ?? 0) > 10_000 || (batch.events?.length ?? 0) > 10_000) {
      throw new AnalyticsValidationError("Analytics ingestion batch exceeds its bounded size");
    }
    const now = this.now().toISOString();
    const publications = new Map<string, Publication>();
    let publicationsCreated = 0;
    let snapshotsCreated = 0;
    let eventsCreated = 0;

    for (const input of batch.publications) {
      const rawId = requiredText(input.providerPublicationId, "providerPublicationId", 512);
      if (!SOCIAL_PLATFORMS.includes(input.platform)) throw new AnalyticsValidationError("Unsupported social platform");
      const videoId = input.videoId == null ? null : requiredText(input.videoId, "videoId");
      const mediaAssetId = input.mediaAssetId == null ? null : requiredText(input.mediaAssetId, "mediaAssetId");
      assertPublicationMediaReference({ videoId, mediaAssetId });
      const result = await this.repository.upsertPublication(scope, {
        id: this.idFactory(),
        externalIdentityDigest: identityDigest(scope, source, "publication", rawId),
        videoId,
        mediaAssetId,
        platform: input.platform,
        status: requiredText(input.status ?? "published", "status", 40),
        permalink: safePermalink(input.permalink),
        publishedAt: input.publishedAt == null ? null : isoTimestamp(input.publishedAt, "publishedAt"),
        dimensions: normalizedDimensions(input.dimensions),
        generationCost: money(input.generationCost),
        createdAt: now,
        updatedAt: now,
      });
      publications.set(rawId, result.item);
      if (result.created) publicationsCreated += 1;
    }

    for (const input of batch.snapshots ?? []) {
      const publication = publications.get(requiredText(input.providerPublicationId, "providerPublicationId", 512));
      if (!publication) throw new AnalyticsValidationError("Snapshot references a publication absent from this ingestion batch");
      const result = await this.repository.putSnapshot(scope, {
        id: this.idFactory(), publicationId: publication.id,
        capturedAt: isoTimestamp(input.capturedAt, "capturedAt"), metrics: normalizeMetrics(input.metrics), createdAt: now,
      });
      if (result.created) snapshotsCreated += 1;
    }

    for (const input of batch.events ?? []) {
      const rawEventId = requiredText(input.providerEventId, "providerEventId", 512);
      const publication = input.providerPublicationId == null ? undefined : publications.get(requiredText(input.providerPublicationId, "providerPublicationId", 512));
      if (input.providerPublicationId != null && !publication) throw new AnalyticsValidationError("Event references a publication absent from this ingestion batch");
      const result = await this.repository.putEvent(scope, {
        id: this.idFactory(), publicationId: publication?.id ?? null, source,
        externalEventDigest: identityDigest(scope, source, "event", rawEventId),
        eventType: requiredText(input.eventType, "eventType", 80), occurredAt: isoTimestamp(input.occurredAt, "occurredAt"),
        dimensions: safeEventDimensions(input.dimensions), metrics: normalizeMetrics(input.metrics ?? {}), createdAt: now,
      });
      if (result.created) eventsCreated += 1;
    }
    return { publicationsCreated, snapshotsCreated, eventsCreated };
  }

  listPublications(scope: TenantScope, filter: AnalyticsFilter = {}, page: CursorPageRequest = {}): Promise<CursorPage<Publication>> {
    return this.repository.listPublications(validateScope(scope), normalizedFilter(filter), pageRequest(page));
  }

  listSnapshots(scope: TenantScope, filter: AnalyticsFilter = {}, page: CursorPageRequest = {}): Promise<CursorPage<AnalyticsSnapshot>> {
    return this.repository.listSnapshots(validateScope(scope), normalizedFilter(filter), pageRequest(page));
  }

  listEvents(scope: TenantScope, filter: AnalyticsFilter = {}, page: CursorPageRequest = {}): Promise<CursorPage<AnalyticsEvent>> {
    return this.repository.listEvents(validateScope(scope), normalizedFilter(filter), pageRequest(page));
  }

  async summarize(scopeInput: TenantScope, windowInput: AnalyticsWindow, filter: Omit<AnalyticsFilter, "window"> = {}): Promise<AnalyticsSummary> {
    const scope = validateScope(scopeInput);
    const window = { start: isoTimestamp(windowInput.start, "window.start"), end: isoTimestamp(windowInput.end, "window.end"), currency: currency(windowInput.currency) };
    if (window.start >= window.end) throw new AnalyticsValidationError("window.start must be before window.end");
    const scopedFilter = normalizedFilter({ ...filter, window: { start: window.start, end: window.end } });
    const publications = await this.collectPages((page) => this.repository.listPublications(scope, scopedFilter, page));
    const snapshots = await this.collectPages((page) => this.repository.listSnapshots(scope, scopedFilter, page));
    const latest = new Map<string, AnalyticsSnapshot>();
    for (const snapshot of snapshots) {
      const current = latest.get(snapshot.publicationId);
      if (!current || snapshot.capturedAt > current.capturedAt || (snapshot.capturedAt === current.capturedAt && snapshot.id > current.id)) latest.set(snapshot.publicationId, snapshot);
    }
    const summaries = publications.map((publication): PublicationSummary => {
      const snapshot = latest.get(publication.id);
      const metrics = snapshot?.metrics ?? zeroMetrics();
      const eligibleCost = publication.generationCost?.currency === window.currency ? publication.generationCost : null;
      return { publication, metrics, latestCapturedAt: snapshot?.capturedAt ?? null, cost: eligibleCost,
        costPerView: eligibleCost && metrics.views > 0 ? eligibleCost.amount / metrics.views : null, zeroViewRule: "null_when_zero_views" };
    }).sort((a, b) => (b.metrics.views - a.metrics.views) || a.publication.id.localeCompare(b.publication.id));
    const metrics = sumMetrics(summaries.map((item) => item.metrics));
    const costed = summaries.filter((item) => item.cost !== null);
    const costByVideo = new Map<string, number>();
    for (const item of costed) {
      const amount = item.cost!.amount;
      const mediaIdentity = item.publication.videoId ?? item.publication.mediaAssetId!;
      const existing = costByVideo.get(mediaIdentity);
      if (existing !== undefined && existing !== amount) {
        throw new AnalyticsValidationError("Conflicting generation costs exist for the same video and currency");
      }
      costByVideo.set(mediaIdentity, amount);
    }
    const totalAmount = [...costByVideo.values()].reduce((sum, amount) => sum + amount, 0);
    const costedViews = costed.reduce((sum, item) => sum + item.metrics.views, 0);
    const distinctVideos = new Set(summaries.map((item) => item.publication.videoId ?? item.publication.mediaAssetId!));
    const costedVideos = new Set(costed.map((item) => item.publication.videoId ?? item.publication.mediaAssetId!));
    return {
      window, metrics, publicationCount: summaries.length, videoCount: distinctVideos.size, costedVideoCount: costedVideos.size,
      excludedCurrencyCount: summaries.filter((item) => item.publication.generationCost !== null && item.cost === null).length,
      totalCost: { amount: totalAmount, currency: window.currency },
      costPerVideo: costedVideos.size === 0 ? null : totalAmount / costedVideos.size,
      costPerView: costedViews === 0 ? null : totalAmount / costedViews,
      zeroViewRule: "null_when_zero_views", publications: summaries,
      attribution: this.rankAttribution(summaries),
    };
  }

  private async collectPages<T>(load: (page: Required<CursorPageRequest>) => Promise<CursorPage<T>>): Promise<T[]> {
    const output: T[] = [];
    let cursor = "";
    do {
      const page = await load({ limit: 100, cursor });
      output.push(...page.items);
      cursor = page.nextCursor ?? "";
      if (output.length > 100_000) throw new AnalyticsValidationError("Aggregate input exceeds the deterministic safety bound");
    } while (cursor);
    return output;
  }

  private rankAttribution(publications: PublicationSummary[]): Record<AttributionDimension, AttributionRanking[]> {
    const field: Record<AttributionDimension, keyof PublicationDimensions> = {
      avatar: "avatar", hook: "hook", cta: "cta", posting_time: "postingTime", category: "category",
    };
    return Object.fromEntries(Object.entries(field).map(([dimension, key]) => {
      const groups = new Map<string, PublicationSummary[]>();
      for (const publication of publications) {
        const value = publication.publication.dimensions[key];
        if (value) groups.set(value, [...(groups.get(value) ?? []), publication]);
      }
      const ranked = [...groups.entries()].map(([value, items]) => {
        const metrics = sumMetrics(items.map((item) => item.metrics));
        const engagements = metrics.likes + metrics.comments + metrics.shares + metrics.clicks;
        return { dimension: dimension as AttributionDimension, value, publicationCount: items.length, metrics,
          engagementRate: metrics.views === 0 ? 0 : Math.min(1, engagements / metrics.views), rank: 0 };
      }).sort((a, b) => (b.metrics.views - a.metrics.views) || (b.engagementRate - a.engagementRate) || a.value.localeCompare(b.value));
      return [dimension, ranked.map((item, index) => ({ ...item, rank: index + 1 }))];
    })) as unknown as Record<AttributionDimension, AttributionRanking[]>;
  }
}
