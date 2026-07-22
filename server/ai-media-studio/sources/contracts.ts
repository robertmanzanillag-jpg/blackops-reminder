import type { SourceItem as SharedSourceItem } from "../../../shared/ai-media-studio-operations";
import type { TenantScope } from "../core/resource-domain";

type ModerationStatus = SharedSourceItem["moderationStatus"];
export type SourceRightsStatus = SharedSourceItem["rightsStatus"];

export const SOURCE_CATEGORIES = [
  "events",
  "restaurants",
  "hotels",
  "nightclubs",
  "deals",
  "travel_packages",
  "beach_clubs",
  "experiences",
] as const;

export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface SourceAdapterItem {
  providerExternalId: string;
  category: SourceCategory;
  canonicalUrl?: string;
  title?: string;
  content?: string;
  sourcePublishedAt?: string;
  /** Provider-neutral fields that materially identify the content. */
  fingerprint?: Record<string, JsonValue>;
  payload?: Record<string, JsonValue>;
}

export interface SourceSnapshotRequest {
  cursor?: string;
  limit: number;
}

export interface SourceAdapterSnapshot {
  items: readonly SourceAdapterItem[];
  nextCursor?: string;
  capturedAt: string;
}

export interface SourceAdapter {
  readonly key: string;
  readonly categories: readonly SourceCategory[];
  fetchSnapshot(scope: TenantScope, request: SourceSnapshotRequest): Promise<SourceAdapterSnapshot>;
}

export interface CanonicalSourceItem {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  adapterKey: string;
  providerExternalId: string;
  category: SourceCategory;
  canonicalUrl?: string;
  title?: string;
  content?: string;
  contentHash: `sha256:${string}`;
  rightsStatus: SourceRightsStatus;
  moderationStatus: ModerationStatus;
  status: "discovered" | "accepted" | "rejected" | "archived";
  sourcePublishedAt?: string;
  payload: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

/** Public filter status; transitional workflow values may not yet exist in a repository. */
export type SourceStatus = SharedSourceItem["status"];

export interface SourceListFilter {
  category?: SourceCategory;
  status?: SourceStatus;
  rightsStatus?: SourceRightsStatus;
}

export interface SourcePageRequest extends SourceListFilter {
  /** Opaque repository cursor. It never contains provider-native identifiers. */
  cursor?: string;
  limit?: number;
}

export interface SourcePage {
  items: CanonicalSourceItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type SourceEligibilityReviewDecision =
  | { decision: "approve"; rightsStatus: "owned" | "licensed" }
  | { decision: "reject"; reasonCode: "rights_unverified" | "moderation_rejected" | "source_invalid" };

export interface SourceEligibilityReviewInput {
  sourceItemId: string;
  expectedContentHash: `sha256:${string}`;
  idempotencyKey: string;
  actorUserId: string;
  inputDigest: `sha256:${string}`;
  review: SourceEligibilityReviewDecision;
}

export interface SourceEligibilityReviewResult {
  item: CanonicalSourceItem;
  replayed: boolean;
  reviewedAt: string;
}

export class SourceEligibilityRepositoryError extends Error {
  constructor(readonly code: "NOT_FOUND" | "SOURCE_REFRESHED" | "REVIEW_CONFLICT" | "REVIEW_UNAVAILABLE") {
    super("Source eligibility review repository is unavailable");
    this.name = "SourceEligibilityRepositoryError";
  }
}

export interface SourceRepository {
  upsertByContentHash(
    scope: TenantScope,
    item: Omit<CanonicalSourceItem, "id" | "ownerUserId" | "workspaceId" | "createdAt" | "updatedAt">,
  ): Promise<{ item: CanonicalSourceItem; created: boolean }>;
  get(scope: TenantScope, id: string): Promise<CanonicalSourceItem | undefined>;
  list(scope: TenantScope, options?: { limit?: number; category?: SourceCategory }): Promise<CanonicalSourceItem[]>;
  /** Filters in durable storage before applying the page limit. */
  listPage(scope: TenantScope, request?: SourcePageRequest): Promise<SourcePage>;
  reviewEligibility?(scope: TenantScope, input: SourceEligibilityReviewInput): Promise<SourceEligibilityReviewResult>;
}

export const MAX_SOURCE_SNAPSHOT_ITEMS = 100;
export const DEFAULT_SOURCE_SNAPSHOT_ITEMS = 25;

export interface IngestSourceSnapshotResult {
  items: CanonicalSourceItem[];
  createdCount: number;
  duplicateCount: number;
  nextCursor?: string;
  capturedAt: string;
  truncated: boolean;
}
