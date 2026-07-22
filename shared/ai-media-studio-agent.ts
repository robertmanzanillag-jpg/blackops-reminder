import { z } from "zod";
import { INITIAL_CREATOR_CANARY_PROFILE } from "./ai-media-studio-launch-plan-profile";

const launchCreators = INITIAL_CREATOR_CANARY_PROFILE.creators;
const launchSlots = INITIAL_CREATOR_CANARY_PROFILE.slots;

export const AI_MEDIA_STUDIO_AGENT_ROUTE = "/ai-media-studio-agent" as const;
export const AI_MEDIA_STUDIO_AGENT_API = "/api/ai-media-studio/agent" as const;

export const aiMediaStudioAgentWorkStateSchema = z.enum([
  "done",
  "running",
  "ready",
  "blocked",
  "backlog",
]);

export const aiMediaStudioAgentWorkItemSchema = z.object({
  id: z.string().regex(/^ams-agent-[a-z0-9-]{1,64}$/u),
  title: z.string().trim().min(1).max(160),
  owner: z.string().trim().min(1).max(120),
  state: aiMediaStudioAgentWorkStateSchema,
  branch: z.string().trim().min(1).max(240).nullable(),
  pullRequestUrl: z.string().url().startsWith("https://github.com/").nullable(),
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
    status: z.literal("working"),
    route: z.literal(AI_MEDIA_STUDIO_AGENT_ROUTE),
    mission: z.string().trim().min(1).max(500),
  }).strict(),
  generatedAt: z.string().datetime({ offset: true }),
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
    done: z.number().int().nonnegative(),
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
});

export type AiMediaStudioAgentWorkState = z.infer<typeof aiMediaStudioAgentWorkStateSchema>;
export type AiMediaStudioAgentWorkItem = z.infer<typeof aiMediaStudioAgentWorkItemSchema>;
export type AiMediaStudioAgentSnapshot = z.infer<typeof aiMediaStudioAgentSnapshotSchema>;
