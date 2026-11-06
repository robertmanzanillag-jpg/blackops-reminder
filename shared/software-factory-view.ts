/** Public owner dashboard. Never includes job payloads, credentials or provider output. */
export interface SoftwareFactoryView {
  checkedAt: string;
  paused: boolean;
  readiness: "blocked" | "paused" | "available";
  blockers: string[];
  budget: { month: string; limitCents: number; fixedCents: number; spentCents: number; reservedCents: number; remainingCents: number; configured: boolean };
  metrics: { verifiedDeliveries: number; stagingVerifications: number; regressions: number; humanInterventions: number | null; rollbacks: number; blockedJobs: number; completedJobs: number; averageCompletedCostCents: number | null };
  projects: { id: string; repo: string; readiness: string[]; automaticRelease: boolean }[];
  jobs: { id: string; projectId: string; kind: string; status: string; createdAt: string; costCents: number | null; evidenceCount: number; blocker?: string; headSha?: string }[];
}
