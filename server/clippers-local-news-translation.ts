import path from "node:path";

export type LocalNewsLanguage = "en" | "es" | "unknown";
export type LocalNewsTranslationDirection = "en-es" | "es-en";
export type LocalNewsTranslationStatus =
  | "translated"
  | "original_language"
  | "disabled"
  | "unavailable"
  | "unsafe";

export interface LocalNewsTranslationResult {
  status: LocalNewsTranslationStatus;
  safe: boolean;
  original: string;
  translated: string | null;
  direction: LocalNewsTranslationDirection;
  detectedLanguage: LocalNewsLanguage;
  fromCache: boolean;
  issues: string[];
}

export interface LocalNewsTranslationAdapter {
  translate(input: string, direction: LocalNewsTranslationDirection): Promise<string>;
}

export interface LocalNewsTranslatorOptions {
  enabled?: boolean;
  adapter?: LocalNewsTranslationAdapter;
  cache?: Map<string, LocalNewsTranslationResult>;
}

type TransformersPipeline = (input: string, options?: Record<string, unknown>) => Promise<unknown>;
type TransformersPipelineFactory = (
  task: "translation",
  model: string,
  options?: Record<string, unknown>,
) => Promise<TransformersPipeline>;

const MODEL_BY_DIRECTION: Record<LocalNewsTranslationDirection, string> = {
  "en-es": "Xenova/opus-mt-en-es",
  "es-en": "Xenova/opus-mt-es-en",
};
const REVISION_BY_DIRECTION: Record<LocalNewsTranslationDirection, string> = {
  "en-es": "4b002a4c7edd54a7ced58877258b87f7efd3f892",
  "es-en": "eadfd7c658a9d8929ac3b8e996b68a68e2c7d480",
};

const ENGLISH_MARKERS = new Set([
  "a", "an", "and", "are", "at", "be", "closed", "closes", "closure", "crash", "flood", "for", "from", "has", "in", "is", "of", "on", "road", "the", "to", "traffic", "warning", "was", "watch", "with",
]);
const SPANISH_MARKERS = new Set([
  "a", "al", "carretera", "choque", "cierra", "cierre", "con", "de", "del", "el", "en", "está", "fue", "heridos", "hora", "la", "las", "los", "noticia", "para", "por", "que", "se", "tráfico", "un", "una", "última", "y",
]);

function words(input: string): string[] {
  return input.toLocaleLowerCase().match(/[\p{L}]+/gu) ?? [];
}

export function detectLocalNewsLanguage(input: string): LocalNewsLanguage {
  const tokens = words(input);
  if (tokens.length === 0) return "unknown";
  let english = 0;
  let spanish = 0;
  for (const token of tokens) {
    if (ENGLISH_MARKERS.has(token)) english += 1;
    if (SPANISH_MARKERS.has(token)) spanish += 1;
    if (/[áéíóúñü]/u.test(token)) spanish += 2;
  }
  if (spanish > english) return "es";
  if (english > spanish) return "en";
  return "unknown";
}

function matches(input: string, expression: RegExp): string[] {
  return input.match(expression) ?? [];
}

function protectedTokens(input: string): string[] {
  return [
    ...matches(input, /https?:\/\/[^\s<>()]+/gu),
    ...matches(input, /(?<![\p{L}\p{N}])\d+(?:[.,:/-]\d+)*(?![\p{L}\p{N}])/gu),
    ...matches(input, /\b(?:I|US|SR|FL|NY|CR)[- ]?\d+[A-Z]?\b/gu),
  ];
}

export interface LocalNewsIntegrityValidation {
  safe: boolean;
  issues: string[];
}

export function validateLocalNewsTranslationIntegrity(
  original: string,
  translated: string,
  direction: LocalNewsTranslationDirection,
): LocalNewsIntegrityValidation {
  const issues: string[] = [];
  const output = translated.trim();
  if (!output) issues.push("missing_translation");
  if (output && output.toLocaleLowerCase() === original.trim().toLocaleLowerCase()) {
    issues.push("translation_not_substantive");
  }

  const originalCounts = new Map<string, number>();
  const translatedCounts = new Map<string, number>();
  for (const token of protectedTokens(original)) originalCounts.set(token, (originalCounts.get(token) || 0) + 1);
  for (const token of protectedTokens(output)) translatedCounts.set(token, (translatedCounts.get(token) || 0) + 1);
  for (const [token, count] of originalCounts) {
    if ((translatedCounts.get(token) || 0) < count) issues.push(`protected_token_missing:${token}`);
  }
  for (const [token, count] of translatedCounts) {
    if (count > (originalCounts.get(token) || 0)) issues.push(`protected_token_unexpected:${token}`);
  }

  const targetLanguage: LocalNewsLanguage = direction === "en-es" ? "es" : "en";
  const detectedOutput = detectLocalNewsLanguage(output);
  if (output && detectedOutput !== targetLanguage) {
    issues.push(`unexpected_output_language:${detectedOutput}`);
  }
  return { safe: issues.length === 0, issues };
}

async function defaultPipelineFactory(
  task: "translation",
  model: string,
  options?: Record<string, unknown>,
): Promise<TransformersPipeline> {
  // Keep the runtime optional: no API key or hosted inference is used, and a
  // missing local dependency fails closed instead of silently calling a service.
  const dynamicImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
    pipeline?: TransformersPipelineFactory;
    env?: { cacheDir?: string; allowRemoteModels?: boolean };
  }>;
  const transformers = await dynamicImport("@huggingface/transformers");
  if (typeof transformers.pipeline !== "function") throw new Error("transformers_pipeline_unavailable");
  if (transformers.env) {
    transformers.env.cacheDir = process.env.CLIPPERS_LOCAL_NEWS_MODEL_CACHE_DIR || path.join(process.cwd(), "clippers_workspace", "local-news", "models");
    transformers.env.allowRemoteModels = process.env.CLIPPERS_LOCAL_NEWS_ALLOW_MODEL_DOWNLOAD === "true";
  }
  return transformers.pipeline(task, model, options);
}

export class OpusMtLocalTranslationAdapter implements LocalNewsTranslationAdapter {
  private readonly pipelines = new Map<LocalNewsTranslationDirection, Promise<TransformersPipeline>>();
  private readonly pipelineFactory: TransformersPipelineFactory;

  constructor(pipelineFactory: TransformersPipelineFactory = defaultPipelineFactory) {
    this.pipelineFactory = pipelineFactory;
  }

  async translate(input: string, direction: LocalNewsTranslationDirection): Promise<string> {
    let pipelinePromise = this.pipelines.get(direction);
    if (!pipelinePromise) {
      pipelinePromise = this.pipelineFactory("translation", MODEL_BY_DIRECTION[direction], {
        device: "cpu",
        dtype: "q8",
        revision: REVISION_BY_DIRECTION[direction],
      });
      this.pipelines.set(direction, pipelinePromise);
    }
    try {
      const output = await (await pipelinePromise)(input);
      const first = Array.isArray(output) ? output[0] : output;
      if (!first || typeof first !== "object") throw new Error("translation_output_missing");
      const record = first as Record<string, unknown>;
      const text = record.translation_text ?? record.generated_text;
      if (typeof text !== "string" || !text.trim()) throw new Error("translation_output_missing");
      return text.trim();
    } catch (error) {
      // Permit a later cycle to recover from a model-loading failure.
      if (this.pipelines.get(direction) === pipelinePromise) this.pipelines.delete(direction);
      throw error;
    }
  }
}

export class LocalNewsTranslator {
  private readonly enabled: boolean;
  private readonly adapter: LocalNewsTranslationAdapter;
  private readonly cache: Map<string, LocalNewsTranslationResult>;

  constructor(options: LocalNewsTranslatorOptions = {}) {
    this.enabled = options.enabled ?? process.env.NODE_ENV === "production";
    this.adapter = options.adapter ?? new OpusMtLocalTranslationAdapter();
    this.cache = options.cache ?? new Map();
  }

  async translate(input: string, direction: LocalNewsTranslationDirection): Promise<LocalNewsTranslationResult> {
    const original = input;
    const detectedLanguage = detectLocalNewsLanguage(original);
    const base = { original, direction, detectedLanguage, fromCache: false } as const;
    if (!this.enabled) {
      return { ...base, status: "disabled", safe: false, translated: null, issues: ["local_translation_disabled"] };
    }

    const sourceLanguage: LocalNewsLanguage = direction === "en-es" ? "en" : "es";
    const targetLanguage: LocalNewsLanguage = direction === "en-es" ? "es" : "en";
    if (detectedLanguage === targetLanguage) {
      return { ...base, status: "original_language", safe: true, translated: original, issues: [] };
    }
    if (detectedLanguage !== "unknown" && detectedLanguage !== sourceLanguage) {
      return { ...base, status: "unsafe", safe: false, translated: null, issues: [`unexpected_source_language:${detectedLanguage}`] };
    }

    const cacheKey = `${direction}\u0000${original}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };

    try {
      const translated = await this.adapter.translate(original, direction);
      const validation = validateLocalNewsTranslationIntegrity(original, translated, direction);
      if (!validation.safe) {
        return { ...base, status: "unsafe", safe: false, translated: null, issues: validation.issues };
      }
      const result: LocalNewsTranslationResult = {
        ...base,
        status: "translated",
        safe: true,
        translated,
        issues: [],
      };
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      return { ...base, status: "unavailable", safe: false, translated: null, issues: [`local_translation_failed:${message}`] };
    }
  }
}

let defaultTranslator: LocalNewsTranslator | null = null;

export function getDefaultLocalNewsTranslator(): LocalNewsTranslator {
  defaultTranslator ??= new LocalNewsTranslator();
  return defaultTranslator;
}

export async function translateLocalNewsText(
  input: string,
  direction: LocalNewsTranslationDirection,
): Promise<LocalNewsTranslationResult> {
  return getDefaultLocalNewsTranslator().translate(input, direction);
}
