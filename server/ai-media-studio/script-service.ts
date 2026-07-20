import { createHash } from "node:crypto";
import {
  generateScriptVariantsResponseSchema,
  type GenerateScriptVariantsResponse,
  type ParsedGenerateScriptVariantsRequest,
  type ScriptVariant,
} from "../../shared/ai-media-studio-scripts";

const DEFAULT_ANGLES = ["Top pick", "Hidden gem", "Worth the hype", "Plan your visit", "Local favorite"];

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20)}`;
}

function keywords(title: string, type: string, location?: string): string[] {
  return [...new Set([title, type.replaceAll("_", " "), location].filter((value): value is string => Boolean(value)))];
}

function hashtagsFor(title: string, type: string): string[] {
  const titleTag = title.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 60);
  const typeTag = type.replaceAll("_", "").slice(0, 60);
  return [...new Set([titleTag && `#${titleTag}`, typeTag && `#${typeTag}`, "#KongMedia"].filter((value): value is string => Boolean(value)))];
}

export class DeterministicScriptService {
  generate(request: ParsedGenerateScriptVariantsRequest): GenerateScriptVariantsResponse {
    const angles = [request.angle, ...DEFAULT_ANGLES].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index).slice(0, request.variantCount);
    const variants: ScriptVariant[] = angles.map((angle, index) => {
      const location = request.source.location ? ` in ${request.source.location}` : "";
      const fact = request.source.facts?.[index % (request.source.facts?.length || 1)];
      const hook = `${angle}: ${request.source.title}${location}.`;
      const script = [hook, request.source.summary, fact, `Save this for your next visit and follow Kong for more.`].filter(Boolean).join(" ").slice(0, 5_000);
      return {
        id: stableId("variant", { request, angle, index }),
        angle,
        title: `${angle}: ${request.source.title}`.slice(0, 200),
        hook: hook.slice(0, 500),
        script,
        cta: "Save this and follow Kong for more recommendations.",
        caption: `${request.source.title}${location}. ${request.source.summary}`.slice(0, 2_200),
        hashtags: hashtagsFor(request.source.title, request.source.type),
        seoKeywords: keywords(request.source.title, request.source.type, request.source.location),
      };
    });
    const primary = variants[0];
    if (!primary) throw new Error("At least one script variant is required");
    return generateScriptVariantsResponseSchema.parse({
      scriptSet: {
        ...primary,
        id: stableId("scriptset", request),
        source: { type: request.source.type, id: request.source.id, title: request.source.title },
        influencerId: request.influencerId,
        language: request.language,
        variants,
      },
      generation: { mode: "deterministic", estimatedCostUsd: 0, generatedAt: new Date().toISOString() },
    });
  }
}
