import type {
  AnalyticsFilters,
  AnalyticsSummary,
  AttributionFilters,
  AttributionResponse,
  CreatePublishingJobRequest,
  PublishingConnectionsResponse,
  PublishingJob,
  PublishingJobsResponse,
  SocialPlatform,
  SourceFilters,
  SourcesResponse,
  AutomationPolicy,
  ReusableScriptAssetListRequest,
  ReusableScriptAssetSaveRequest,
} from "./types";
import type { MediaAsset } from "@shared/ai-media-studio-core";
import type { PublishingPreview } from "@shared/ai-media-studio-operations";
import { sourceEligibilityReviewResponseSchema } from "@shared/ai-media-studio-source-eligibility";
import { sourceScriptPreviewResponseSchema } from "@shared/ai-media-studio-source-to-script";
import { sourceToBatchAutomationResponseSchema } from "@shared/ai-media-studio-source-to-batch";
import {
  reusableScriptAssetListResponseSchema,
  reusableScriptAssetSaveResponseSchema,
} from "@shared/ai-media-studio-reusable-script-assets";
import { actionableApiError } from "../governance/errors";
import type { SourceEligibilityReviewInput, SourceScriptPreviewRequest } from "./types";

const API_ROOT = "/api/ai-media-studio";

export class OperationsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "OperationsApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const fallback = `Request failed (${response.status})`;
    let message = fallback;
    let code: string | undefined;
    try {
      const body = await response.json() as { code?: unknown };
      message = actionableApiError(body, fallback);
      if (typeof body.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(body.code)) code = body.code;
    } catch {
      // Retain the bounded status message when no JSON body is available.
    }
    throw new OperationsApiError(message, response.status, code);
  }
  return response.json() as Promise<T>;
}

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function post<T>(path: string, body?: unknown) {
  return requestJson<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export const operationsApi = {
  publishingJobs: async (filters: { platform?: SocialPlatform; status?: PublishingJob["status"]; cursor?: string; limit: number }) => {
    const response = await requestJson<PublishingJobsResponse | { items: PublishingJob[]; nextCursor: string | null; hasMore: boolean }>(`/publishing/jobs${queryString(filters)}`);
    return "items" in response ? { jobs: response.items, nextCursor: response.nextCursor, hasMore: response.hasMore } : response;
  },
  readyMediaAssets: async () => {
    const response = await requestJson<{ assets: MediaAsset[] }>("/media-assets?status=ready&limit=100");
    return response.assets;
  },
  createPublishingJob: async (input: Omit<CreatePublishingJobRequest, "previewDigest">) => {
    const response = await post<{ preview: PublishingPreview }>("/publishing/preview", input);
    return post<{ job: PublishingJob }>("/publishing/jobs", { ...input, previewDigest: response.preview.digest });
  },
  approvePublishingJob: ({ id, previewDigest }: { id: string; previewDigest: string }) => post<{ job: PublishingJob }>(`/publishing/jobs/${encodeURIComponent(id)}/approve`, { previewDigest }),
  rejectPublishingJob: ({ id, previewDigest, reason }: { id: string; previewDigest: string; reason: string }) => post<{ job: PublishingJob }>(`/publishing/jobs/${encodeURIComponent(id)}/reject`, { previewDigest, reason }),
  cancelPublishingJob: (id: string) => post<{ job: PublishingJob }>(`/publishing/jobs/${encodeURIComponent(id)}/cancel`),
  retryPublishingJob: (id: string) => post<{ job: PublishingJob }>(`/publishing/jobs/${encodeURIComponent(id)}/retry`),
  publishingConnections: () => requestJson<PublishingConnectionsResponse>("/publishing/connections"),
  analyticsSummary: async (filters: AnalyticsFilters) => {
    const response = await requestJson<{ summary: AnalyticsSummary }>(`/analytics/summary${queryString(filters)}`);
    return response.summary;
  },
  attributions: async (filters: AttributionFilters) => {
    const response = await requestJson<AttributionResponse | { items: AttributionResponse["attributions"]; nextCursor: string | null; hasMore: boolean }>(`/analytics/attribution${queryString(filters)}`);
    return "items" in response ? { attributions: response.items, nextCursor: response.nextCursor, hasMore: response.hasMore } : response;
  },
  sources: async (filters: SourceFilters) => {
    const response = await requestJson<SourcesResponse | { items: SourcesResponse["sources"]; nextCursor: string | null; hasMore: boolean }>(`/automation/sources${queryString(filters)}`);
    return "items" in response ? { sources: response.items, nextCursor: response.nextCursor, hasMore: response.hasMore } : response;
  },
  reviewSourceEligibility: async ({ sourceItemId, ...input }: SourceEligibilityReviewInput) => {
    const response = await post<unknown>(
      `/automation/sources/${encodeURIComponent(sourceItemId)}/eligibility-review`,
      input,
    );
    return sourceEligibilityReviewResponseSchema.parse(response);
  },
  previewSourceScript: async (input: SourceScriptPreviewRequest) => {
    const response = await post<unknown>("/automation/sources/scripts/preview", input);
    return sourceScriptPreviewResponseSchema.parse(response);
  },
  reusableScriptAssets: async (filters: ReusableScriptAssetListRequest) => {
    const response = await requestJson<unknown>(`/automation/sources/scripts/assets${queryString(filters)}`);
    return reusableScriptAssetListResponseSchema.parse(response);
  },
  saveReusableScriptAsset: async (input: ReusableScriptAssetSaveRequest) => {
    const response = await post<unknown>("/automation/sources/scripts/assets", input);
    return reusableScriptAssetSaveResponseSchema.parse(response);
  },
  prepareSourceProductionBatch: async () => {
    const response = await post<unknown>("/automation/sources/production-batch/prepare", {});
    return sourceToBatchAutomationResponseSchema.parse(response);
  },
  automationPolicy: async () => {
    const response = await requestJson<{ policy: AutomationPolicy }>("/automation/policy");
    return response.policy;
  },
};
