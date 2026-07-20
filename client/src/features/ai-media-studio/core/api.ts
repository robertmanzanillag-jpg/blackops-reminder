import type {
  CreateInfluencerRequest,
  Influencer,
  InfluencerListRequest,
  MediaAsset,
  MediaLibraryRequest,
  ProviderResource,
  ProviderResourceListRequest,
  UpdateInfluencerRequest,
} from "./types";

type InfluencerListResponse = { influencers: Influencer[]; nextCursor: string | null; hasMore: boolean };
type InfluencerResponse = { influencer: Influencer };
type ProviderResourceListResponse = { resources: ProviderResource[]; nextCursor: string | null; hasMore: boolean };
type MediaLibraryResponse = { assets: MediaAsset[]; nextCursor: string | null; hasMore: boolean };

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
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message || body.error || fallback;
    } catch {
      // Keep the status-based message for empty or non-JSON failures.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryString(values: Record<string, string | number | readonly string[] | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const mediaStudioCoreApi = {
  influencers: (filters: InfluencerListRequest) =>
    requestJson<InfluencerListResponse>(`/influencers${queryString({
      status: filters.status,
      category: filters.category,
      language: filters.language,
      search: filters.search,
      cursor: filters.cursor,
      limit: filters.limit,
    })}`),
  createInfluencer: async (input: CreateInfluencerRequest) => {
    const response = await requestJson<InfluencerResponse>("/influencers", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.influencer;
  },
  updateInfluencer: async ({ id, input }: { id: string; input: UpdateInfluencerRequest }) => {
    const response = await requestJson<InfluencerResponse>(`/influencers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return response.influencer;
  },
  deleteInfluencer: (id: string) =>
    requestJson<void>(`/influencers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  providerResources: (filters: ProviderResourceListRequest) =>
    requestJson<ProviderResourceListResponse>(`/provider-resources${queryString({
      kind: filters.kind,
      status: filters.status,
      language: filters.language,
      cursor: filters.cursor,
      limit: filters.limit,
    })}`),
  mediaAssets: (filters: MediaLibraryRequest) =>
    requestJson<MediaLibraryResponse>(`/media-assets${queryString({
      kinds: filters.kinds,
      status: filters.status,
      influencerId: filters.influencerId,
      projectId: filters.projectId,
      search: filters.search,
      cursor: filters.cursor,
      limit: filters.limit,
    })}`),
};

export type CoreApiBoundary = typeof mediaStudioCoreApi;
export type InfluencerMutationResult = Influencer;
