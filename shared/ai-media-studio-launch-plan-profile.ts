import { z } from "zod";

export const initialCreatorCanaryProfileSchema = z.object({
  version: z.literal(1),
  key: z.literal("initial_creator_canary_v1"),
  scope: z.literal("provider_neutral"),
  creators: z.object({
    minimum: z.literal(5),
    maximum: z.literal(10),
    videosPerCreator: z.literal(10),
  }).strict(),
  slots: z.object({
    minimum: z.literal(50),
    maximum: z.literal(100),
  }).strict(),
  contentDeck: z.object({
    strategy: z.literal("topic_deck_by_video_number"),
    topicCount: z.literal(10),
    reuseAcrossCreators: z.literal(true),
  }).strict(),
  safety: z.object({
    blocked: z.literal(true),
    canGenerate: z.literal(false),
    noSpend: z.literal(true),
  }).strict(),
  admission: z.literal("one_video_then_canary"),
}).strict().superRefine((profile, context) => {
  if (profile.contentDeck.topicCount !== profile.creators.videosPerCreator
    || profile.slots.minimum !== profile.creators.minimum * profile.creators.videosPerCreator
    || profile.slots.maximum !== profile.creators.maximum * profile.creators.videosPerCreator) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Initial creator canary totals are inconsistent" });
  }
});

export type InitialCreatorCanaryProfile = z.infer<typeof initialCreatorCanaryProfileSchema>;

export type DeepReadonly<T> = T extends object
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const INITIAL_CREATOR_CANARY_PROFILE: DeepReadonly<InitialCreatorCanaryProfile> = deepFreeze(
  initialCreatorCanaryProfileSchema.parse({
    version: 1,
    key: "initial_creator_canary_v1",
    scope: "provider_neutral",
    creators: { minimum: 5, maximum: 10, videosPerCreator: 10 },
    slots: { minimum: 50, maximum: 100 },
    contentDeck: {
      strategy: "topic_deck_by_video_number",
      topicCount: 10,
      reuseAcrossCreators: true,
    },
    safety: { blocked: true, canGenerate: false, noSpend: true },
    admission: "one_video_then_canary",
  }),
);

export type InitialCreatorCanaryShape = Readonly<{
  creatorCount: number;
  videosPerCreator: number;
  slotCount: number;
}>;

export function isInitialCreatorCanaryShape(value: InitialCreatorCanaryShape): boolean {
  const { creators, slots } = INITIAL_CREATOR_CANARY_PROFILE;
  return Number.isInteger(value.creatorCount)
    && value.creatorCount >= creators.minimum
    && value.creatorCount <= creators.maximum
    && value.videosPerCreator === creators.videosPerCreator
    && value.slotCount === value.creatorCount * creators.videosPerCreator
    && value.slotCount >= slots.minimum
    && value.slotCount <= slots.maximum;
}
