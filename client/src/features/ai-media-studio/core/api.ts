import type {
  ConfigureHeyGenRosterResponse,
  CreateHeyGenRosterRequest,
  HeyGenRosterDailyPlanResponse,
  CreateInfluencerRequest,
  AssetDelivery,
  Influencer,
  InfluencerListRequest,
  MediaAsset,
  MediaLibraryRequest,
  LaunchPreflight,
  SandboxReadiness,
  ApproveProductionBatchRequest,
  PrepareProductionBatchRequest,
  ProductionBatchResponse,
  ProviderResource,
  ProviderResourceListRequest,
  UpdateInfluencerRequest,
} from "./types";
import {
  configureHeyGenRosterResponseSchema,
  heyGenRosterDailyPlanResponseSchema,
} from "@shared/ai-media-studio-heygen-roster";
import { productionBatchResponseSchema } from "@shared/ai-media-studio-production-batches";
import { launchPreflightResponseSchema } from "@shared/ai-media-studio-launch-preflight";
import { sandboxReadinessResponseSchema } from "@shared/ai-media-studio-sandbox-readiness";
import {
  heyGenOnboardingReadinessSchema,
  type HeyGenOnboardingReadiness,
} from "@shared/ai-media-studio-heygen-onboarding";

type InfluencerListResponse = { influencers: Influencer[]; nextCursor: string | null; hasMore: boolean };
type InfluencerResponse = { influencer: Influencer };
type ProviderResourceListResponse = { resources: ProviderResource[]; nextCursor: string | null; hasMore: boolean };
type MediaLibraryResponse = { assets: MediaAsset[]; nextCursor: string | null; hasMore: boolean };

const API_ROOT = "/api/ai-media-studio";

const launchPreflightErrorMessages: Readonly<Record<number, string>> = {
  404: "Launch preflight was not found for this approved batch.",
  409: "Launch preflight is not available for the current batch state.",
  503: "Launch preflight observation is temporarily unavailable.",
};

const sandboxReadinessErrorMessages: Readonly<Record<number, string>> = {
  404: "Sandbox readiness was not found for this approved slot.",
  409: "Sandbox readiness is not available for the current batch or slot state.",
  503: "Sandbox readiness observation is temporarily unavailable.",
};

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

async function requestOptionalJson(path: string, safeErrors: readonly string[] = []): Promise<unknown | null> {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: "include" });
  if (response.status === 404) return null;
  if (!response.ok) {
    const fallback = `Request failed (${response.status})`;
    if (safeErrors.length === 0) throw new Error(fallback);
    try {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error && safeErrors.includes(body.error) ? body.error : fallback);
    } catch (error) {
      if (error instanceof Error && safeErrors.includes(error.message)) throw error;
      throw new Error(fallback);
    }
  }
  return response.json() as Promise<unknown>;
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
  heyGenOnboardingReadiness: async (): Promise<HeyGenOnboardingReadiness> => {
    const response = await fetch(
      `${API_ROOT}/provider-configurations/heygen/onboarding-readiness`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return heyGenOnboardingReadinessSchema.parse(await response.json());
  },
  heyGenRoster: async (): Promise<ConfigureHeyGenRosterResponse | null> => {
    const response = await requestOptionalJson("/provider-configurations/heygen/roster");
    return response === null ? null : configureHeyGenRosterResponseSchema.parse(response);
  },
  heyGenRosterDailyPlan: async (): Promise<HeyGenRosterDailyPlanResponse | null> => {
    const response = await requestOptionalJson("/provider-configurations/heygen/roster/daily-plan");
    return response === null ? null : heyGenRosterDailyPlanResponseSchema.parse(response);
  },
  productionBatch: async (): Promise<ProductionBatchResponse | null> => {
    const response = await requestOptionalJson("/production-batches/current", [
      "AI Media Studio production batch persistence is unavailable",
    ]);
    return response === null ? null : productionBatchResponseSchema.parse(response);
  },
  productionBatchLaunchPreflight: async ({ planId, batchId }: { planId: string; batchId: string }): Promise<{ preflight: LaunchPreflight }> => {
    const response = await fetch(
      `${API_ROOT}/production-batches/${encodeURIComponent(planId)}/launch-preflight`,
      { credentials: "include" },
    );
    if (!response.ok) {
      throw new Error(launchPreflightErrorMessages[response.status] ?? `Request failed (${response.status})`);
    }
    const parsed = launchPreflightResponseSchema.parse(await response.json());
    if (parsed.preflight.subject.planId !== planId || parsed.preflight.subject.batchId !== batchId) {
      throw new Error("Launch preflight identity did not match the current approved batch.");
    }
    return parsed;
  },
  productionBatchSandboxReadiness: async ({
    planId,
    batchId,
    slotId,
  }: {
    planId: string;
    batchId: string;
    slotId: string;
  }): Promise<{ sandboxReadiness: SandboxReadiness }> => {
    const response = await fetch(
      `${API_ROOT}/production-batches/${encodeURIComponent(planId)}/sandbox-readiness/${encodeURIComponent(slotId)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(sandboxReadinessErrorMessages[response.status] ?? `Request failed (${response.status})`);
    }
    const parsed = sandboxReadinessResponseSchema.parse(await response.json());
    const subject = parsed.sandboxReadiness.subject;
    if (subject.planId !== planId || subject.batchId !== batchId || subject.slotId !== slotId) {
      throw new Error("Sandbox readiness identity did not match the selected approved slot.");
    }
    return parsed;
  },
  prepareProductionBatchScripts: async ({ planId, input }: { planId: string; input: PrepareProductionBatchRequest }): Promise<ProductionBatchResponse> => {
    const response = await requestJson<unknown>(`/production-batches/${encodeURIComponent(planId)}/prepare-scripts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return productionBatchResponseSchema.parse(response);
  },
  approveProductionBatchScripts: async ({ planId, input }: { planId: string; input: ApproveProductionBatchRequest }): Promise<ProductionBatchResponse> => {
    const response = await requestJson<unknown>(`/production-batches/${encodeURIComponent(planId)}/approve-scripts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return productionBatchResponseSchema.parse(response);
  },
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
  createAssetDelivery: (id: string) =>
    requestJson<AssetDelivery>(`/media-assets/${encodeURIComponent(id)}/delivery`, { method: "POST" }),
  configureHeyGenRoster: async (input: CreateHeyGenRosterRequest): Promise<ConfigureHeyGenRosterResponse> => {
    const response = await requestJson<unknown>("/provider-configurations/heygen/roster", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return configureHeyGenRosterResponseSchema.parse(response);
  },
};

export type CoreApiBoundary = typeof mediaStudioCoreApi;
export type InfluencerMutationResult = Influencer;
