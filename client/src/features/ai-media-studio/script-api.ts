import type {
  GenerateScriptVariantsRequest,
  GenerateScriptVariantsResponse,
} from "@shared/ai-media-studio-scripts";

export async function generateScriptVariants(input: GenerateScriptVariantsRequest) {
  const response = await fetch("/api/ai-media-studio/scripts/generate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = `Script generation failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // Preserve the bounded fallback when the server returns no JSON body.
    }
    throw new Error(message);
  }

  return response.json() as Promise<GenerateScriptVariantsResponse>;
}
