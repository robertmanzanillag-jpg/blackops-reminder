import {
  registerHeyGenCredentialReferenceRequestSchema,
  registerHeyGenCredentialReferenceResponseSchema,
  type RegisterHeyGenCredentialReferenceResponse,
} from "@shared/ai-media-studio-heygen-secure-setup";

export const HEYGEN_DEPLOYMENT_SECRET_NAME = "AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY" as const;
export const HEYGEN_STATIC_CREDENTIAL_REFERENCE_ENDPOINT =
  "/api/ai-media-studio/provider-configurations/heygen/static-credential-reference" as const;

export type HeyGenCredentialReferenceRegistration = RegisterHeyGenCredentialReferenceResponse;

export function newHeyGenCredentialReferenceAttemptKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure reference registration could not be started. Reload and try again.");
  }
  return `heygen-static-reference-${crypto.randomUUID()}`;
}

export async function registerHeyGenCredentialReference(
  idempotencyKey: string,
): Promise<HeyGenCredentialReferenceRegistration> {
  const request = registerHeyGenCredentialReferenceRequestSchema.parse({ idempotencyKey });
  const response = await fetch(HEYGEN_STATIC_CREDENTIAL_REFERENCE_ENDPOINT, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    if (response.status === 409) {
      throw new Error("Provider account metadata changed. Refresh readiness before trying again.");
    }
    if (response.status === 503) {
      throw new Error("Secure reference registration is not available yet. No provider request occurred.");
    }
    throw new Error(`Secure reference registration failed (${response.status}). No provider request occurred.`);
  }
  return registerHeyGenCredentialReferenceResponseSchema.parse(await response.json());
}
