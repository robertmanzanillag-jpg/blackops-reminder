import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __SandboxReadinessPanelForBrowserTest as SandboxReadinessPanel } from "../../client/src/features/ai-media-studio/core/production-batch-workbench";

const key = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;

function approvedItem(slot: number, videoNumber: number, title: string) {
  return {
    slotId: key("slot", slot),
    videoNumber,
    preparation: "draft" as const,
    source: { title: `Source ${title}`, category: "experiences" as const },
    script: {
      key: key("script", slot),
      title,
      status: "approved" as const,
      variantCount: 3,
      selectedVariant: {
        title,
        angle: `Angle ${title}`,
        hook: `Hook ${title}`,
        script: `Approved script ${title}`,
        cta: `CTA ${title}`,
        caption: `Caption ${title}`,
        hashtags: ["#kong"],
        seoKeywords: ["kong media"],
      },
    },
  };
}

function approvedBatch(plan: number, batch: number, firstSlot: number, names: string[]) {
  const groups = Array.from({ length: 5 }, (_, groupIndex) => ({
    memberId: key("member", firstSlot + groupIndex),
    creatorName: names[groupIndex] ?? `Creator ${groupIndex + 1}`,
    items: Array.from({ length: 10 }, (_, itemIndex) =>
      approvedItem(firstSlot + groupIndex * 10 + itemIndex, itemIndex + 1, `${names[groupIndex] ?? `Creator ${groupIndex + 1}`} video ${itemIndex + 1}`)),
  }));
  return {
    planId: key("plan", plan),
    batchId: key("batch", batch),
    status: "approved_ready" as const,
    avatarCount: 5,
    videosPerAvatar: 10 as const,
    plannedVideoCount: 50,
    canGenerate: false as const,
    noSpend: true as const,
    preparedAt: "2026-07-21T12:00:00.000Z",
    approvedAt: "2026-07-21T12:05:00.000Z",
    blockers: [
      "governance_approval_required", "budget_reservation_required",
      "sandbox_generation_required", "human_launch_approval_required",
    ] as const,
    groups,
  };
}

const batches = {
  first: approvedBatch(1, 1, 1, ["Ada", "Bea", "Cleo", "Dara", "Etta"]),
  second: approvedBatch(2, 2, 101, ["Faye", "Gia", "Hope", "Iris", "Juno"]),
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const root = createRoot(document.getElementById("root")!);

function render(batch: typeof batches.first) {
  root.render(
    <QueryClientProvider client={queryClient}>
      <SandboxReadinessPanel batch={batch} />
    </QueryClientProvider>,
  );
}

const harness = (window as any).__sandboxHarness;
harness.queryClient = queryClient;
harness.renderSecondBatch = () => render(batches.second);
render(batches.first);
