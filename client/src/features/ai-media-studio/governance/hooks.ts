import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { governanceApi } from "./api";

export const governanceKeys = {
  all: ["ai-media-studio", "governance"] as const,
  influencer: (id: string) => ["ai-media-studio", "governance", "influencer", id] as const,
  assetReview: (id: string) => ["ai-media-studio", "governance", "asset-review", id] as const,
};

export function useInfluencerGovernance(influencerId: string, enabled = true) {
  return useQuery({ queryKey: governanceKeys.influencer(influencerId), queryFn: () => governanceApi.influencerProfile(influencerId), enabled: Boolean(influencerId) && enabled, retry: false });
}

export function useInfluencerGovernanceMutations(influencerId: string) {
  const client = useQueryClient();
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: governanceKeys.influencer(influencerId) }),
    client.invalidateQueries({ queryKey: ["ai-media-studio", "options"] }),
  ]);
  return {
    create: useMutation({ mutationFn: governanceApi.createInfluencerProfile, onSuccess: refresh }),
    revoke: useMutation({ mutationFn: governanceApi.revokeInfluencerProfile, onSuccess: refresh }),
  };
}

export function useAssetQualityReview(assetId: string, enabled = true) {
  return useQuery({ queryKey: governanceKeys.assetReview(assetId), queryFn: () => governanceApi.assetQualityReview(assetId), enabled: Boolean(assetId) && enabled, retry: false });
}

export function useAssetQualityReviewMutation(assetId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: governanceApi.createAssetQualityReview,
    onSuccess: (review) => {
      client.setQueryData(governanceKeys.assetReview(assetId), review);
      return Promise.all([
      client.invalidateQueries({ queryKey: governanceKeys.assetReview(assetId) }),
      client.invalidateQueries({ queryKey: ["ai-media-studio", "core", "media-assets"] }),
      client.invalidateQueries({ queryKey: ["ai-media-studio", "operations", "ready-assets"] }),
      ]);
    },
  });
}
