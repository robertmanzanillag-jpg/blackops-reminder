import type {
  AnalyticsSummary,
  Attribution,
  AutomationPolicy,
  CreatePublishingJobRequest,
  PublishingJob,
  PublishingMode,
  SocialPlatform,
  SourceItem,
} from "@shared/ai-media-studio-operations";
import type {
  SourceEligibilityReviewRequest,
  SourceEligibilityReviewResponse,
} from "@shared/ai-media-studio-source-eligibility";
import type {
  SourceScriptPreviewRequest,
  SourceScriptPreviewResponse,
} from "@shared/ai-media-studio-source-to-script";

export type {
  AnalyticsSummary,
  Attribution,
  AutomationPolicy,
  CreatePublishingJobRequest,
  PublishingJob,
  PublishingMode,
  SocialPlatform,
  SourceItem,
  SourceEligibilityReviewRequest,
  SourceEligibilityReviewResponse,
  SourceScriptPreviewRequest,
  SourceScriptPreviewResponse,
};

export type PublishingJobStatus = PublishingJob["status"];
export type SourceStatus = SourceItem["status"];
export type SourceRightsStatus = SourceItem["rightsStatus"];

export type CursorPage<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };
export type PublishingJobsResponse = { jobs: PublishingJob[]; nextCursor: string | null; hasMore: boolean };
export type AttributionResponse = { attributions: Attribution[]; nextCursor: string | null; hasMore: boolean };
export type SourcesResponse = { sources: SourceItem[]; nextCursor: string | null; hasMore: boolean };

export type PublishingConnection = {
  connectionId: string | null;
  platform: SocialPlatform;
  status: "ready" | "attention" | "not_connected";
  accountLabel: string | null;
  capabilities: string[];
  checkedAt: string | null;
  message: string;
};

export type PublishingConnectionsResponse = { connections: PublishingConnection[] };
export type AnalyticsFilters = { platform?: SocialPlatform; from?: string; to?: string };
export type AnalyticsDateWindow = { from: string; to: string };
export type AttributionDimension = "avatar" | "hook" | "cta" | "posting_time" | "category";
export type AttributionFilters = AnalyticsFilters & { dimension: AttributionDimension; cursor?: string; limit: number };
export type SourceFilters = { status?: SourceStatus; rightsStatus?: SourceRightsStatus; cursor?: string; limit: number };
export type SourceEligibilityReviewInput = SourceEligibilityReviewRequest & { sourceItemId: string };

export function createSourceActionIdempotencyKey(
  action: "owned" | "licensed" | "reject" | "preview",
  sourceItemId: string,
  contentHash: string,
): string {
  const sourcePart = sourceItemId.replace(/[^A-Za-z0-9._:-]/gu, "-");
  const hashPart = contentHash.replace(/^sha256:/u, "").slice(0, 24);
  return `ams-${action}-${hashPart}-${sourcePart}`.slice(0, 128);
}

export type RankedAttribution = { label: string; count: number };

export type AnalyticsDateWindowResult =
  | { ok: true; window: AnalyticsDateWindow }
  | { ok: false; message: string };

export function validateAnalyticsDateWindow(from: string, to: string): AnalyticsDateWindowResult {
  if (!from || !to) return { ok: false, message: "Enter both From and To dates before applying the range." };
  if (from > to) return { ok: false, message: "From date must be on or before To date." };
  return { ok: true, window: { from, to } };
}

export function scheduledPublishingError(value: string, nowMs = Date.now()): string | null {
  if (!value) return "Choose a future date and time for scheduled publishing.";
  const scheduledMs = Date.parse(value);
  if (!Number.isFinite(scheduledMs) || scheduledMs <= nowMs) {
    return "Scheduled publishing time must be strictly in the future.";
  }
  return null;
}

export function rankAttributions(attributions: readonly Attribution[], dimension: AttributionDimension): RankedAttribution[] {
  const counts = new Map<string, number>();
  for (const item of attributions) {
    const value = dimension === "avatar" ? item.dimensions.avatarId
      : dimension === "hook" ? item.dimensions.hook
        : dimension === "cta" ? item.dimensions.cta
          : dimension === "posting_time" ? item.dimensions.postingTime
            : item.dimensions.category;
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
