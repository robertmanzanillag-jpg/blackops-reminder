import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useConfigureHeyGenRoster,
  useHeyGenOnboardingReadiness,
} from "../../client/src/features/ai-media-studio/core/hooks";
import type { CreateHeyGenRosterRequest } from "../../client/src/features/ai-media-studio/core/types";

const request: CreateHeyGenRosterRequest = {
  idempotencyKey: "heygen-roster-invalidation-browser-test",
  members: Array.from({ length: 5 }, (_, index) => ({
    name: `Creator ${index + 1}`,
    avatarId: `avatar-look-${index + 1}`,
    voiceId: `voice-${index + 1}`,
    language: "en-US",
    accent: "Neutral",
    gender: "unspecified" as const,
  })),
};

function MutationHarness() {
  const readiness = useHeyGenOnboardingReadiness();
  const mutation = useConfigureHeyGenRoster();
  const observation = readiness.data?.observedAt ?? "loading";
  return (
    <main>
      <p>Readiness observation: {observation}</p>
      <button type="button" disabled={!readiness.data || mutation.isPending} onClick={() => mutation.mutate(request)}>
        Save roster
      </button>
      {mutation.isSuccess && <p role="status">Roster saved</p>}
    </main>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MutationHarness />
  </QueryClientProvider>,
);
