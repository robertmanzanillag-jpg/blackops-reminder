import {
  createInfluencerRequestSchema,
  influencerCoreFieldsSchema,
  type CreateInfluencerRequest,
  type InfluencerGender,
} from "../../../shared/ai-media-studio-core";
import type { ZodType } from "zod";

/**
 * Provider-neutral inputs available when a creator roster is provisioned.
 * Provider-native identifiers intentionally stay outside this contract.
 */
export type CanonicalRosterPersonaInput = Readonly<{
  name: string;
  language: string;
  accent: string;
  gender: InfluencerGender;
  avatarResourceId: string;
  voiceResourceId: string;
}>;

function starterCopy(name: string, language: string): { intro: string; outro: string } {
  const primaryLanguage = language.trim().toLowerCase().split("-")[0];
  if (primaryLanguage === "es") {
    return {
      intro: `Hola, soy ${name}, tu guía de KONG.`,
      outro: "Descubre más con KONG.",
    };
  }
  if (primaryLanguage === "en") {
    return {
      intro: `Hi, I'm ${name}, your KONG guide.`,
      outro: "Discover more with KONG.",
    };
  }
  return {
    intro: `${name} — KONG.`,
    outro: "KONG.",
  };
}

/**
 * Produces a complete, editable starter persona without guessing a provider's
 * capabilities or claiming that the draft has been editorially approved.
 */
export function buildCanonicalRosterPersona(input: CanonicalRosterPersonaInput): CreateInfluencerRequest {
  const copy = starterCopy(input.name.trim(), input.language);
  return createInfluencerRequestSchema.parse({
    name: input.name,
    avatarResourceId: input.avatarResourceId,
    voiceResourceId: input.voiceResourceId,
    accent: input.accent,
    language: input.language,
    gender: input.gender,
    ageRange: { minimum: 18, maximum: 65 },
    personality: ["approachable"],
    tone: ["informative"],
    speakingStyle: "Natural, concise, and conversational social-video delivery.",
    categories: ["local discovery"],
    intro: copy.intro,
    outro: copy.outro,
    energyLevel: 6,
    facialExpressions: ["friendly and engaged"],
    brandColors: ["#34D399"],
    status: "draft",
  });
}

function validOr<T>(schema: ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/**
 * Repairs an imported roster profile one field at a time. Valid editorial
 * choices survive reconciliation; only invalid fields fall back to the
 * canonical starter, while resource bindings always follow the current
 * canonical resources.
 */
export function repairCanonicalRosterPersona(
  existing: unknown,
  input: CanonicalRosterPersonaInput,
): CreateInfluencerRequest {
  const current = existing !== null && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  const fallback = buildCanonicalRosterPersona(input);
  const fields = influencerCoreFieldsSchema.shape;
  return createInfluencerRequestSchema.parse({
    name: validOr(fields.name, current.name, fallback.name),
    avatarResourceId: fallback.avatarResourceId,
    voiceResourceId: fallback.voiceResourceId,
    accent: validOr(fields.accent, current.accent, fallback.accent),
    language: validOr(fields.language, current.language, fallback.language),
    gender: validOr(fields.gender, current.gender, fallback.gender),
    ageRange: validOr(fields.ageRange, current.ageRange, fallback.ageRange),
    personality: validOr(fields.personality, current.personality, fallback.personality),
    tone: validOr(fields.tone, current.tone, fallback.tone),
    speakingStyle: validOr(fields.speakingStyle, current.speakingStyle, fallback.speakingStyle),
    categories: validOr(fields.categories, current.categories, fallback.categories),
    intro: validOr(fields.intro, current.intro, fallback.intro),
    outro: validOr(fields.outro, current.outro, fallback.outro),
    energyLevel: validOr(fields.energyLevel, current.energyLevel, fallback.energyLevel),
    facialExpressions: validOr(fields.facialExpressions, current.facialExpressions, fallback.facialExpressions),
    brandColors: validOr(fields.brandColors, current.brandColors, fallback.brandColors),
    status: validOr(fields.status, current.status, fallback.status),
  });
}
