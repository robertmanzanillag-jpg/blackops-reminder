import { z } from "zod";
import { INITIAL_CREATOR_CANARY_PROFILE } from "./ai-media-studio-launch-plan-profile";

const launchCreators = INITIAL_CREATOR_CANARY_PROFILE.creators;
const launchSlots = INITIAL_CREATOR_CANARY_PROFILE.slots;

export const AI_MEDIA_STUDIO_AGENT_ROUTE = "/ai-media-studio-agent" as const;
export const AI_MEDIA_STUDIO_AGENT_API = "/api/ai-media-studio/agent" as const;

export const aiMediaStudioAgentWorkStateSchema = z.enum([
  "review",
  "merged",
  "running",
  "ready",
  "blocked",
  "backlog",
]);

export const aiMediaStudioAgentGateStatusSchema = z.enum([
  "passed",
  "pending",
  "blocked",
  "not_required",
]);

const agentGateSchema = z.object({
  status: aiMediaStudioAgentGateStatusSchema,
  evidence: z.array(z.string().trim().min(1).max(300)).max(12),
}).strict();

export const aiMediaStudioAgentGatesSchema = z.object({
  checker: agentGateSchema,
  appQa: agentGateSchema,
  ci: agentGateSchema,
  human: agentGateSchema,
}).strict();

export const aiMediaStudioAgentRuntimeSchema = z.object({
  component: z.literal("source_scheduler"),
  status: z.enum(["queued", "leased", "retry_wait", "completed", "dead_letter", "unavailable", "not_initialized"]),
  health: z.enum(["healthy", "stopped", "attention", "unknown"]),
  evidence: z.array(z.string().trim().min(1).max(300)).max(12),
}).strict();

export const aiMediaStudioAgentWorkItemSchema = z.object({
  id: z.string().regex(/^ams-agent-[a-z0-9-]{1,64}$/u),
  title: z.string().trim().min(1).max(160),
  owner: z.string().trim().min(1).max(120),
  state: aiMediaStudioAgentWorkStateSchema,
  branch: z.string().trim().min(1).max(240).nullable(),
  pullRequestUrl: z.string().url().startsWith("https://github.com/").nullable(),
  baseBranch: z.string().trim().min(1).max(240).nullable().optional(),
  headBranch: z.string().trim().min(1).max(240).nullable().optional(),
  gates: aiMediaStudioAgentGatesSchema.optional(),
  runtime: aiMediaStudioAgentRuntimeSchema.optional(),
  harness: z.string().trim().min(1).max(300).nullable().optional(),
  worktree: z.string().trim().min(1).max(500).nullable().optional(),
  heartbeatAt: z.string().datetime({ offset: true }).nullable().optional(),
  handoff: z.string().trim().min(1).max(500).nullable().optional(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/u).nullable().optional(),
  evidenceLinks: z.array(z.string().url()).max(20).optional(),
  acceptance: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
  mergeGate: z.string().trim().min(1).max(500),
  evidence: z.array(z.string().trim().min(1).max(300)).max(20),
  blockers: z.array(z.string().trim().min(1).max(300)).max(12),
  nextAction: z.string().trim().min(1).max(500),
}).strict();

export const aiMediaStudioAgentSnapshotSchema = z.object({
  agent: z.object({
    id: z.literal("ai-media-studio-agent"),
    name: z.literal("AI Media Studio Agent"),
    status: z.enum(["working", "awaiting_human", "blocked", "idle"]),
    route: z.literal(AI_MEDIA_STUDIO_AGENT_ROUTE),
    mission: z.string().trim().min(1).max(500),
  }).strict(),
  generatedAt: z.string().datetime({ offset: true }),
  dataAsOf: z.string().datetime({ offset: true }),
  safety: z.object({
    spendAuthorized: z.literal(false),
    deploymentAuthorized: z.literal(false),
    migrationsApplied: z.literal(false),
    liveProviderCallsEnabled: z.literal(false),
  }).strict(),
  launchTarget: z.object({
    minimumAvatars: z.literal(launchCreators.minimum),
    maximumAvatars: z.literal(launchCreators.maximum),
    videosPerAvatar: z.literal(launchCreators.videosPerCreator),
    minimumVideos: z.literal(launchSlots.minimum),
    maximumVideos: z.literal(launchSlots.maximum),
  }).strict(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    backlog: z.number().int().nonnegative(),
  }).strict(),
  workItems: z.array(aiMediaStudioAgentWorkItemSchema).min(1).max(50),
}).strict().superRefine((snapshot, context) => {
  const counts = Object.fromEntries(
    aiMediaStudioAgentWorkStateSchema.options.map((state) => [
      state,
      snapshot.workItems.filter((item) => item.state === state).length,
    ]),
  );
  if (snapshot.summary.total !== snapshot.workItems.length
    || aiMediaStudioAgentWorkStateSchema.options.some((state) => snapshot.summary[state] !== counts[state])
    || new Set(snapshot.workItems.map((item) => item.id)).size !== snapshot.workItems.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Agent work-item summary is inconsistent" });
  }
  if (Date.parse(snapshot.dataAsOf) > Date.parse(snapshot.generatedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Agent dataAsOf cannot be newer than generatedAt" });
  }
  for (const [index, item] of snapshot.workItems.entries()) {
    const humanPassed = item.gates?.human.status === "passed";
    if (item.state === "merged") {
      if (!humanPassed || (item.gates?.human.evidence.length ?? 0) === 0
        || item.pullRequestUrl === null || (item.evidenceLinks?.length ?? 0) === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workItems", index, "state"],
          message: "Merged work requires explicit human and GitHub evidence",
        });
      }
    } else if (humanPassed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workItems", index, "gates", "human"],
        message: "Only merged work may pass the human merge gate",
      });
    }
  }
});

export type AiMediaStudioAgentWorkState = z.infer<typeof aiMediaStudioAgentWorkStateSchema>;
export type AiMediaStudioAgentGateStatus = z.infer<typeof aiMediaStudioAgentGateStatusSchema>;
export type AiMediaStudioAgentWorkItem = z.infer<typeof aiMediaStudioAgentWorkItemSchema>;
export type AiMediaStudioAgentSnapshot = z.infer<typeof aiMediaStudioAgentSnapshotSchema>;
