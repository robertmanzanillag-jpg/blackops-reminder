import { z } from "zod";
import { INITIAL_CREATOR_CANARY_PROFILE } from "./ai-media-studio-launch-plan-profile";

export const HEYGEN_ROSTER_MIN_AVATARS = INITIAL_CREATOR_CANARY_PROFILE.creators.minimum;
export const HEYGEN_ROSTER_MAX_AVATARS = INITIAL_CREATOR_CANARY_PROFILE.creators.maximum;
export const HEYGEN_ROSTER_VIDEOS_PER_AVATAR = INITIAL_CREATOR_CANARY_PROFILE.creators.videosPerCreator;
export const HEYGEN_ROSTER_MIN_PLANNED_VIDEOS = INITIAL_CREATOR_CANARY_PROFILE.slots.minimum;
export const HEYGEN_ROSTER_MAX_PLANNED_VIDEOS = INITIAL_CREATOR_CANARY_PROFILE.slots.maximum;
export const HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS = [
  "script_batch_required",
  "governance_approval_required",
  "budget_reservation_required",
  "sandbox_generation_required",
  "human_launch_approval_required",
] as const;

export const heyGenRosterGenderSchema = z.enum(["female", "male", "non_binary", "unspecified"]);
export const heyGenRosterDailyPlanBlockerSchema = z.enum(HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS);
const heyGenRosterDailyPlanBlockersSchema = z.array(heyGenRosterDailyPlanBlockerSchema)
  .length(HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS.length)
  .superRefine((blockers, context) => {
    if (blockers.some((blocker, index) => blocker !== HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS[index])) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Daily plan blockers must match the launch gates" });
    }
  });

const nativeIdSchema = z.string().trim().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const nameSchema = z.string().trim().min(1).max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const languageSchema = z.string().trim().min(2).max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);
const accentSchema = z.string().trim().min(1).max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const planDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
const timeZoneSchema = z.string().trim().min(1).max(80)
  .regex(/^[A-Za-z0-9_+\-/.]+$/u)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA time zone");
const idempotencyKeySchema = z.string().trim().min(8).max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const NOT_A_PLAIN_OBJECT = Symbol("not-a-plain-object");
function requirePlainObject(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    ? value
    : NOT_A_PLAIN_OBJECT;
}

export const createHeyGenRosterMemberSchema = z.preprocess(requirePlainObject, z.object({
  name: nameSchema,
  avatarId: nativeIdSchema,
  voiceId: nativeIdSchema,
  language: languageSchema,
  accent: accentSchema,
  gender: heyGenRosterGenderSchema,
}).strict());

export const createHeyGenRosterRequestSchema = z.preprocess(requirePlainObject, z.object({
  members: z.array(createHeyGenRosterMemberSchema)
    .min(HEYGEN_ROSTER_MIN_AVATARS)
    .max(HEYGEN_ROSTER_MAX_AVATARS)
    .superRefine((members, context) => {
      const seen = new Set<string>();
      for (const [index, member] of members.entries()) {
        if (seen.has(member.avatarId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "avatarId"],
            message: "Each avatar must be unique",
          });
        }
        seen.add(member.avatarId);
      }
    }),
  idempotencyKey: idempotencyKeySchema,
}).strict());

export const heyGenRosterPublicMemberSchema = z.object({
  memberId: z.string().regex(/^member_[a-f0-9]{24}$/u),
  name: nameSchema,
  language: languageSchema,
  accent: accentSchema,
  gender: heyGenRosterGenderSchema,
  videosPlanned: z.literal(HEYGEN_ROSTER_VIDEOS_PER_AVATAR),
}).strict();

export const heyGenRosterStatusSchema = z.object({
  rosterId: z.string().regex(/^roster_[a-f0-9]{24}$/u),
  status: z.literal("configured"),
  avatarCount: z.number().int().min(HEYGEN_ROSTER_MIN_AVATARS).max(HEYGEN_ROSTER_MAX_AVATARS),
  videosPerAvatar: z.literal(HEYGEN_ROSTER_VIDEOS_PER_AVATAR),
  plannedVideoCount: z.number().int().min(HEYGEN_ROSTER_MIN_PLANNED_VIDEOS).max(HEYGEN_ROSTER_MAX_PLANNED_VIDEOS),
  members: z.array(heyGenRosterPublicMemberSchema)
    .min(HEYGEN_ROSTER_MIN_AVATARS)
    .max(HEYGEN_ROSTER_MAX_AVATARS),
  configuredAt: z.string().datetime({ offset: true }),
}).strict().superRefine((status, context) => {
  if (status.members.length !== status.avatarCount
    || status.plannedVideoCount !== status.avatarCount * HEYGEN_ROSTER_VIDEOS_PER_AVATAR
    || new Set(status.members.map((member) => member.memberId)).size !== status.members.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Roster totals are inconsistent" });
  }
});

export const configureHeyGenRosterResponseSchema = z.object({
  roster: heyGenRosterStatusSchema,
}).strict();

export const createHeyGenRosterDailyPlanRequestSchema = z.preprocess(requirePlainObject, z.object({
  planDate: planDateSchema,
  timeZone: timeZoneSchema,
}).strict());

export const heyGenRosterDailyPlanSlotSchema = z.object({
  slotId: z.string().regex(/^slot_[a-f0-9]{24}$/u),
  planId: z.string().regex(/^plan_[a-f0-9]{24}$/u),
  rosterId: z.string().regex(/^roster_[a-f0-9]{24}$/u),
  memberId: z.string().regex(/^member_[a-f0-9]{24}$/u),
  creatorName: nameSchema,
  videoNumber: z.number().int().min(1).max(HEYGEN_ROSTER_VIDEOS_PER_AVATAR),
  status: z.literal("not_queued"),
  blockers: heyGenRosterDailyPlanBlockersSchema,
}).strict();

export const heyGenRosterDailyPlanSchema = z.object({
  planId: z.string().regex(/^plan_[a-f0-9]{24}$/u),
  rosterId: z.string().regex(/^roster_[a-f0-9]{24}$/u),
  planDate: planDateSchema,
  timeZone: timeZoneSchema,
  status: z.literal("blocked_before_generation"),
  avatarCount: z.number().int().min(HEYGEN_ROSTER_MIN_AVATARS).max(HEYGEN_ROSTER_MAX_AVATARS),
  videosPerAvatar: z.literal(HEYGEN_ROSTER_VIDEOS_PER_AVATAR),
  plannedVideoCount: z.number().int().min(HEYGEN_ROSTER_MIN_PLANNED_VIDEOS).max(HEYGEN_ROSTER_MAX_PLANNED_VIDEOS),
  canGenerate: z.literal(INITIAL_CREATOR_CANARY_PROFILE.safety.canGenerate),
  noSpendGuarantee: z.literal(INITIAL_CREATOR_CANARY_PROFILE.safety.noSpend),
  generatedAt: z.string().datetime({ offset: true }),
  blockers: heyGenRosterDailyPlanBlockersSchema,
  slots: z.array(heyGenRosterDailyPlanSlotSchema)
    .min(HEYGEN_ROSTER_MIN_PLANNED_VIDEOS)
    .max(HEYGEN_ROSTER_MAX_PLANNED_VIDEOS),
}).strict().superRefine((plan, context) => {
  const byMember = new Map<string, Set<number>>();
  for (const slot of plan.slots) {
    const numbers = byMember.get(slot.memberId) ?? new Set<number>();
    numbers.add(slot.videoNumber);
    byMember.set(slot.memberId, numbers);
  }
  if (plan.slots.length !== plan.plannedVideoCount
    || plan.plannedVideoCount !== plan.avatarCount * HEYGEN_ROSTER_VIDEOS_PER_AVATAR
    || new Set(plan.slots.map((slot) => slot.slotId)).size !== plan.slots.length
    || plan.slots.some((slot) => slot.planId !== plan.planId)
    || plan.slots.some((slot) => slot.rosterId !== plan.rosterId)
    || plan.slots.some((slot) => slot.blockers.join("\0") !== plan.blockers.join("\0"))
    || byMember.size !== plan.avatarCount
    || [...byMember.values()].some((numbers) => numbers.size !== HEYGEN_ROSTER_VIDEOS_PER_AVATAR)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Daily plan totals are inconsistent" });
  }
});

export const heyGenRosterDailyPlanResponseSchema = z.object({
  plan: heyGenRosterDailyPlanSchema,
}).strict();

export type HeyGenRosterGender = z.infer<typeof heyGenRosterGenderSchema>;
export type HeyGenRosterDailyPlanBlocker = z.infer<typeof heyGenRosterDailyPlanBlockerSchema>;
export type CreateHeyGenRosterMember = z.infer<typeof createHeyGenRosterMemberSchema>;
export type CreateHeyGenRosterRequest = z.infer<typeof createHeyGenRosterRequestSchema>;
export type CreateHeyGenRosterDailyPlanRequest = z.infer<typeof createHeyGenRosterDailyPlanRequestSchema>;
export type HeyGenRosterPublicMember = z.infer<typeof heyGenRosterPublicMemberSchema>;
export type HeyGenRosterStatus = z.infer<typeof heyGenRosterStatusSchema>;
export type ConfigureHeyGenRosterResponse = z.infer<typeof configureHeyGenRosterResponseSchema>;
export type HeyGenRosterDailyPlanSlot = z.infer<typeof heyGenRosterDailyPlanSlotSchema>;
export type HeyGenRosterDailyPlan = z.infer<typeof heyGenRosterDailyPlanSchema>;
export type HeyGenRosterDailyPlanResponse = z.infer<typeof heyGenRosterDailyPlanResponseSchema>;
