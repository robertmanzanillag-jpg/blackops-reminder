import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioShell } from "../../client/src/features/ai-media-studio/studio-shell";
import { HeyGenOnboardingPanel } from "../../client/src/features/ai-media-studio/core/heygen-onboarding-panel";

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
const root = createRoot(document.getElementById("root")!);

function render(state: "loading" | "error" | "ready") {
  (window as any).__heyGenNavigationHarness.state = state;
  root.render(
    <QueryClientProvider client={queryClient}>
      <StudioShell>
        <div id="overview">Overview</div>
        <HeyGenOnboardingPanel />
      </StudioShell>
    </QueryClientProvider>,
  );
}

(window as any).__heyGenNavigationHarness.render = render;
render("loading");
