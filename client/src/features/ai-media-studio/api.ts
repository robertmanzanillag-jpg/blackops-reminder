import type {
  CreateGenerationInput,
  CreateGenerationResponse,
  MediaJob,
  StudioDashboard,
  StudioOptions,
} from "./types";

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
      // The API can return an empty response when an upstream provider is unavailable.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const mediaStudioApi = {
  dashboard: () => requestJson<StudioDashboard>("/dashboard"),
  options: () => requestJson<StudioOptions>("/options"),
  jobs: async () => {
    const response = await requestJson<{ jobs?: MediaJob[] } | MediaJob[]>("/jobs");
    return Array.isArray(response) ? response : response.jobs ?? [];
  },
  job: async (id: string) => {
    const response = await requestJson<{ job: MediaJob }>(`/jobs/${encodeURIComponent(id)}`);
    return response.job;
  },
  createGeneration: (input: CreateGenerationInput) =>
    requestJson<CreateGenerationResponse>("/generations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  retryJob: async (id: string) => {
    const response = await requestJson<{ job: MediaJob }>(`/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
    return response.job;
  },
  cancelJob: async (id: string) => {
    const response = await requestJson<{ job: MediaJob }>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    return response.job;
  },
};
