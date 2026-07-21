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
};

export function useHeyGenRoster() {
  return useQuery({
    queryKey: coreStudioKeys.heyGenRoster,
    queryFn: mediaStudioCoreApi.heyGenRoster,
    staleTime: 5 * 60_000,
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
