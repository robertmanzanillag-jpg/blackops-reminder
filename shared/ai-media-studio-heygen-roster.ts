import { z } from "zod";

export const HEYGEN_ROSTER_MIN_AVATARS = 5 as const;
export const HEYGEN_ROSTER_MAX_AVATARS = 10 as const;
export const HEYGEN_ROSTER_VIDEOS_PER_AVATAR = 10 as const;
export const HEYGEN_ROSTER_MIN_PLANNED_VIDEOS = 50 as const;
export const HEYGEN_ROSTER_MAX_PLANNED_VIDEOS = 100 as const;

export const heyGenRosterGenderSchema = z.enum(["female", "male", "non_binary", "unspecified"]);

const nativeIdSchema = z.string().trim().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const nameSchema = z.string().trim().min(1).max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const languageSchema = z.string().trim().min(2).max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);
const accentSchema = z.string().trim().min(1).max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
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

export type HeyGenRosterGender = z.infer<typeof heyGenRosterGenderSchema>;
export type CreateHeyGenRosterMember = z.infer<typeof createHeyGenRosterMemberSchema>;
export type CreateHeyGenRosterRequest = z.infer<typeof createHeyGenRosterRequestSchema>;
export type HeyGenRosterPublicMember = z.infer<typeof heyGenRosterPublicMemberSchema>;
export type HeyGenRosterStatus = z.infer<typeof heyGenRosterStatusSchema>;
export type ConfigureHeyGenRosterResponse = z.infer<typeof configureHeyGenRosterResponseSchema>;
