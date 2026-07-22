import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "./api";
import type { AnalyticsFilters, AttributionFilters, PublishingJob, ReusableScriptAssetListRequest, SocialPlatform, SourceFilters } from "./types";

export const operationsKeys = {
  all: ["ai-media-studio", "operations"] as const,
  publishing: (filters: { platform?: SocialPlatform; status?: PublishingJob["status"] }) => ["ai-media-studio", "operations", "publishing", filters] as const,
  connections: ["ai-media-studio", "operations", "connections"] as const,
  readyAssets: ["ai-media-studio", "operations", "ready-assets"] as const,
  summary: (filters: AnalyticsFilters) => ["ai-media-studio", "operations", "analytics-summary", filters] as const,
  attributions: (filters: Omit<AttributionFilters, "cursor">) => ["ai-media-studio", "operations", "attributions", filters] as const,
  sources: (filters: Omit<SourceFilters, "cursor">) => ["ai-media-studio", "operations", "sources", filters] as const,
  reusableScripts: (filters: Omit<ReusableScriptAssetListRequest, "cursor">) => ["ai-media-studio", "operations", "reusable-scripts", filters] as const,
  policy: ["ai-media-studio", "operations", "policy"] as const,
};

export function usePublishingJobs(filters: { platform?: SocialPlatform; status?: PublishingJob["status"] }) {
  return useInfiniteQuery({
    queryKey: operationsKeys.publishing(filters), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => operationsApi.publishingJobs({ ...filters, cursor: pageParam, limit: 25 }),
    getNextPageParam: (page) => page.hasMore ? page.nextCursor ?? undefined : undefined,
  });
}

export function usePublishingConnections() {
  return useQuery({ queryKey: operationsKeys.connections, queryFn: operationsApi.publishingConnections, staleTime: 60_000 });
}

export function useReadyPublishingAssets() {
  return useQuery({ queryKey: operationsKeys.readyAssets, queryFn: operationsApi.readyMediaAssets, staleTime: 30_000 });
}

export function usePublishingMutations() {
  const queryClient = useQueryClient();
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["ai-media-studio", "operations", "publishing"] }),
    queryClient.invalidateQueries({ queryKey: ["ai-media-studio", "dashboard"] }),
  ]);
  return {
    create: useMutation({ mutationFn: operationsApi.createPublishingJob, onSuccess: refresh }),
    approve: useMutation({ mutationFn: operationsApi.approvePublishingJob, onSuccess: refresh }),
    reject: useMutation({ mutationFn: operationsApi.rejectPublishingJob, onSuccess: refresh }),
    cancel: useMutation({ mutationFn: operationsApi.cancelPublishingJob, onSuccess: refresh }),
    retry: useMutation({ mutationFn: operationsApi.retryPublishingJob, onSuccess: refresh }),
  };
}

export function useAnalyticsSummary(filters: AnalyticsFilters) {
  return useQuery({ queryKey: operationsKeys.summary(filters), queryFn: () => operationsApi.analyticsSummary(filters) });
}

export function useAttributions(filters: Omit<AttributionFilters, "cursor">) {
  return useInfiniteQuery({
    queryKey: operationsKeys.attributions(filters), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => operationsApi.attributions({ ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.hasMore ? page.nextCursor ?? undefined : undefined,
  });
}

export function useSources(filters: Omit<SourceFilters, "cursor">) {
  return useInfiniteQuery({
    queryKey: operationsKeys.sources(filters), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => operationsApi.sources({ ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.hasMore ? page.nextCursor ?? undefined : undefined,
  });
}

export function useReusableScriptAssets(filters: Omit<ReusableScriptAssetListRequest, "cursor">) {
  return useInfiniteQuery({
    queryKey: operationsKeys.reusableScripts(filters), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => operationsApi.reusableScriptAssets({ ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.hasMore ? page.nextCursor ?? undefined : undefined,
  });
}

export function useSourceReviewMutations() {
  const queryClient = useQueryClient();
  const refreshSources = () => queryClient.invalidateQueries({
    queryKey: ["ai-media-studio", "operations", "sources"],
  });
  return {
    review: useMutation({ mutationFn: operationsApi.reviewSourceEligibility, onSuccess: refreshSources }),
    preview: useMutation({ mutationFn: operationsApi.previewSourceScript }),
    saveReusableScript: useMutation({
      mutationFn: operationsApi.saveReusableScriptAsset,
      onSuccess: () => queryClient.invalidateQueries({
        queryKey: ["ai-media-studio", "operations", "reusable-scripts"],
      }),
    }),
    prepareBatch: useMutation({
      mutationFn: operationsApi.prepareSourceProductionBatch,
      onSuccess: () => Promise.all([
        refreshSources(),
        queryClient.invalidateQueries({ queryKey: ["ai-media-studio", "core", "production-batch"] }),
      ]),
    }),
  };
}

export function useAutomationPolicy() {
  return useQuery({ queryKey: operationsKeys.policy, queryFn: operationsApi.automationPolicy, staleTime: 30_000 });
}
