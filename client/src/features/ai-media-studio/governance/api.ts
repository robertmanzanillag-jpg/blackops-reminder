import type {
  AssetQualityReview,
  CreateAssetQualityReview,
  CreateInfluencerGovernanceProfile,
  InfluencerGovernanceProfile,
} from "./types";
import { actionableApiError } from "./errors";

const API_ROOT = "/api/ai-media-studio/governance";

export class GovernanceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GovernanceApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const fallback = `Governance request failed (${response.status})`;
    let message = fallback;
    try {
      message = actionableApiError(await response.json(), fallback);
    } catch {
      // Use the bounded status message when the response has no JSON body.
    }
    throw new GovernanceApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export const governanceApi = {
  influencerProfile: async (influencerId: string) => {
    try {
      const response = await requestJson<{ profile: InfluencerGovernanceProfile }>(`/influencers/${encodeURIComponent(influencerId)}/profile`);
      return response.profile;
    } catch (error) {
      if (error instanceof GovernanceApiError && error.status === 404) return null;
      throw error;
    }
  },
  createInfluencerProfile: async ({ influencerId, input }: { influencerId: string; input: CreateInfluencerGovernanceProfile }) => {
    const response = await requestJson<{ profile: InfluencerGovernanceProfile }>(`/influencers/${encodeURIComponent(influencerId)}/profile`, { method: "POST", body: JSON.stringify(input) });
    return response.profile;
  },
  revokeInfluencerProfile: async ({ influencerId, reason, idempotencyKey }: { influencerId: string; reason: string; idempotencyKey: string }) => {
    const response = await requestJson<{ profile: InfluencerGovernanceProfile }>(`/influencers/${encodeURIComponent(influencerId)}/profile/revoke`, { method: "POST", body: JSON.stringify({ reason, idempotencyKey }) });
    return response.profile;
  },
  assetQualityReview: async (assetId: string) => {
    try {
      const response = await requestJson<{ review: AssetQualityReview }>(`/assets/${encodeURIComponent(assetId)}/quality-review`);
      return response.review;
    } catch (error) {
      if (error instanceof GovernanceApiError && error.status === 404) return null;
      throw error;
    }
  },
  createAssetQualityReview: async ({ assetId, input }: { assetId: string; input: CreateAssetQualityReview }) => {
    const response = await requestJson<{ review: AssetQualityReview }>(`/assets/${encodeURIComponent(assetId)}/quality-review`, { method: "POST", body: JSON.stringify(input) });
    return response.review;
  },
};
