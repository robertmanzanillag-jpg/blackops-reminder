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
} from "./types";
import type { MediaAsset } from "@shared/ai-media-studio-core";
import type { PublishingPreview } from "@shared/ai-media-studio-operations";

const API_ROOT = "/api/ai-media-studio";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const fallback = `Request failed (${response.status})`;
    let message = fallback;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.error || body.message || fallback;
    } catch {
      // Retain the bounded status message when no JSON body is available.
    }
    throw new Error(message);
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
  automationPolicy: async () => {
    const response = await requestJson<{ policy: AutomationPolicy }>("/automation/policy");
    return response.policy;
  },
};
