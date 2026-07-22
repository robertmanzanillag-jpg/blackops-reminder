import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mediaStudioCoreApi } from "./api";
import type { MediaLibraryRequest, ProviderResourceKind } from "./types";

export const coreStudioKeys = {
  all: ["ai-media-studio", "core"] as const,
  influencers: ["ai-media-studio", "core", "influencers"] as const,
  resourceCatalogs: ["ai-media-studio", "core", "provider-resources"] as const,
  resources: (kind?: ProviderResourceKind) => ["ai-media-studio", "core", "provider-resources", kind ?? "all"] as const,
  assets: (filters: MediaLibraryRequest) => ["ai-media-studio", "core", "media-assets", filters] as const,
  heyGenRoster: ["ai-media-studio", "core", "heygen-roster"] as const,
  heyGenOnboardingReadiness: ["ai-media-studio", "core", "heygen-onboarding-readiness"] as const,
  heyGenRosterDailyPlan: ["ai-media-studio", "core", "heygen-roster", "daily-plan"] as const,
  productionBatch: ["ai-media-studio", "core", "production-batch", "current"] as const,
  productionBatchLaunchPreflight: (planId: string, batchId: string) => [
    "ai-media-studio", "core", "production-batch", "launch-preflight", planId, batchId,
  ] as const,
  productionBatchSandboxReadiness: (planId: string, batchId: string, slotId: string) => [
    "ai-media-studio", "core", "production-batch", "sandbox-readiness", planId, batchId, slotId,
  ] as const,
  oneVideoExecutionControl: (planId: string, batchId: string, slotId: string) => [
    "ai-media-studio", "core", "production-batch", "one-video-execution-control", planId, batchId, slotId,
  ] as const,
  oneVideoCostApprovalRuntime: ["ai-media-studio", "core", "one-video-cost-approval", "runtime"] as const,
};

export function useHeyGenOnboardingReadiness() {
  return useQuery({
    queryKey: coreStudioKeys.heyGenOnboardingReadiness,
    queryFn: mediaStudioCoreApi.heyGenOnboardingReadiness,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useHeyGenRoster(enabled = true) {
  return useQuery({
    queryKey: coreStudioKeys.heyGenRoster,
    queryFn: mediaStudioCoreApi.heyGenRoster,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useHeyGenRosterDailyPlan(enabled = true) {
  return useQuery({
    queryKey: coreStudioKeys.heyGenRosterDailyPlan,
    queryFn: mediaStudioCoreApi.heyGenRosterDailyPlan,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useProductionBatch() {
  return useQuery({
    queryKey: coreStudioKeys.productionBatch,
    queryFn: mediaStudioCoreApi.productionBatch,
    staleTime: 30_000,
  });
}

export function useProductionBatchLaunchPreflight({
  planId,
  batchId,
  enabled,
}: {
  planId: string;
  batchId: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: coreStudioKeys.productionBatchLaunchPreflight(planId, batchId),
    queryFn: () => mediaStudioCoreApi.productionBatchLaunchPreflight({ planId, batchId }),
    enabled: enabled && Boolean(planId) && Boolean(batchId),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useProductionBatchSandboxReadiness({
  planId,
  batchId,
  slotId,
  enabled,
}: {
  planId: string;
  batchId: string;
  slotId: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: coreStudioKeys.productionBatchSandboxReadiness(planId, batchId, slotId),
    queryFn: () => mediaStudioCoreApi.productionBatchSandboxReadiness({ planId, batchId, slotId }),
    enabled: enabled && Boolean(planId) && Boolean(batchId) && Boolean(slotId),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useOneVideoExecutionControl({
  planId,
  batchId,
  slotId,
  enabled,
}: {
  planId: string;
  batchId: string;
  slotId: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: coreStudioKeys.oneVideoExecutionControl(planId, batchId, slotId),
    queryFn: () => mediaStudioCoreApi.oneVideoExecutionControl({ planId, batchId, slotId }),
    enabled: enabled && Boolean(planId) && Boolean(batchId) && Boolean(slotId),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useOneVideoCostApprovalRuntime(enabled = true) {
  return useQuery({
    queryKey: coreStudioKeys.oneVideoCostApprovalRuntime,
    queryFn: mediaStudioCoreApi.oneVideoCostApprovalRuntime,
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useRecordOneVideoCostApproval({
  planId,
  batchId,
  slotId,
}: {
  planId: string;
  batchId: string;
  slotId: string;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mediaStudioCoreApi.recordOneVideoCostApproval,
    onSuccess: () => queryClient.invalidateQueries({
      queryKey: coreStudioKeys.oneVideoExecutionControl(planId, batchId, slotId),
    }),
  });
}

export function usePrepareProductionBatchScripts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mediaStudioCoreApi.prepareProductionBatchScripts,
    onSuccess: (response) => {
      queryClient.setQueryData(coreStudioKeys.productionBatch, response);
    },
  });
}

export function useApproveProductionBatchScripts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mediaStudioCoreApi.approveProductionBatchScripts,
    onSuccess: (response) => {
      queryClient.setQueryData(coreStudioKeys.productionBatch, response);
      queryClient.removeQueries({
        queryKey: ["ai-media-studio", "core", "production-batch", "launch-preflight"],
      });
      return queryClient.invalidateQueries({ queryKey: coreStudioKeys.productionBatch });
    },
  });
}

export function useConfigureHeyGenRoster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mediaStudioCoreApi.configureHeyGenRoster,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: coreStudioKeys.influencers }),
      queryClient.invalidateQueries({ queryKey: coreStudioKeys.resourceCatalogs }),
      queryClient.invalidateQueries({ queryKey: ["ai-media-studio", "options"] }),
      queryClient.invalidateQueries({ queryKey: coreStudioKeys.heyGenRoster }),
      queryClient.invalidateQueries({ queryKey: coreStudioKeys.heyGenRosterDailyPlan }),
      queryClient.invalidateQueries({ queryKey: coreStudioKeys.productionBatch }),
    ]),
  });
}

export function useInfluencers() {
  return useInfiniteQuery({
    queryKey: coreStudioKeys.influencers,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => mediaStudioCoreApi.influencers({ cursor: pageParam, limit: 25 }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
  });
}

export function useProviderResources(kind?: ProviderResourceKind) {
  return useInfiniteQuery({
    queryKey: coreStudioKeys.resources(kind),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => mediaStudioCoreApi.providerResources({ kind, status: "active", cursor: pageParam, limit: 25 }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
    staleTime: 5 * 60_000,
  });
}

export function useMediaAssets(filters: MediaLibraryRequest) {
  return useInfiniteQuery({
    queryKey: coreStudioKeys.assets(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => mediaStudioCoreApi.mediaAssets({ ...filters, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
  });
}

export function useAssetDelivery() {
  return useMutation({ mutationFn: mediaStudioCoreApi.createAssetDelivery });
}

export function useInfluencerMutations() {
  const queryClient = useQueryClient();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: coreStudioKeys.influencers }),
    queryClient.invalidateQueries({ queryKey: ["ai-media-studio", "options"] }),
  ]);
  const create = useMutation({ mutationFn: mediaStudioCoreApi.createInfluencer, onSuccess: refresh });
  const update = useMutation({ mutationFn: mediaStudioCoreApi.updateInfluencer, onSuccess: refresh });
  const remove = useMutation({ mutationFn: mediaStudioCoreApi.deleteInfluencer, onSuccess: refresh });
  return { create, update, remove };
}
