import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mediaStudioApi } from "./api";
import type { CreateGenerationInput, MediaJob } from "./types";

export const studioQueryKeys = {
  dashboard: ["ai-media-studio", "dashboard"] as const,
  options: ["ai-media-studio", "options"] as const,
  jobs: ["ai-media-studio", "jobs"] as const,
};

export function useStudioDashboard() {
  return useQuery({
    queryKey: studioQueryKeys.dashboard,
    queryFn: mediaStudioApi.dashboard,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useStudioOptions() {
  return useQuery({
    queryKey: studioQueryKeys.options,
    queryFn: mediaStudioApi.options,
    staleTime: 5 * 60_000,
  });
}

export function useStudioJobs() {
  return useQuery({
    queryKey: studioQueryKeys.jobs,
    queryFn: mediaStudioApi.jobs,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      return jobs?.some((job) => job.status === "pending" || job.status === "rendering") ? 4_000 : 15_000;
    },
  });
}

function replaceJob(jobs: MediaJob[] | undefined, updated: MediaJob) {
  if (!jobs) return [updated];
  return jobs.some((job) => job.id === updated.id)
    ? jobs.map((job) => (job.id === updated.id ? updated : job))
    : [updated, ...jobs];
}

export function useStudioMutations() {
  const queryClient = useQueryClient();
  const syncJob = (job: MediaJob) => {
    queryClient.setQueryData<MediaJob[]>(studioQueryKeys.jobs, (jobs) => replaceJob(jobs, job));
    queryClient.invalidateQueries({ queryKey: studioQueryKeys.dashboard });
  };

  const create = useMutation({
    mutationFn: (input: CreateGenerationInput) => mediaStudioApi.createGeneration(input),
    onSuccess: (response) => syncJob(response.job),
  });
  const retry = useMutation({ mutationFn: mediaStudioApi.retryJob, onSuccess: syncJob });
  const cancel = useMutation({ mutationFn: mediaStudioApi.cancelJob, onSuccess: syncJob });

  return { create, retry, cancel };
}
