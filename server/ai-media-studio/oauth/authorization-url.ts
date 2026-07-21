import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import { OAuthFlowError } from "./contracts";
import { AI_MEDIA_OAUTH_PLATFORM_MANIFESTS } from "./platform-manifests";

const STATE = /^[A-Za-z0-9_-]{64}$/u;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;
const CLIENT_ID = /^[A-Za-z0-9._:-]{1,512}$/u;
const AUTHORIZATION_PARAMETER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const RESERVED_PARAMETERS = new Set([
  "client_id",
  "client_key",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
]);

export type OAuthAuthorizationUrlInput = Readonly<{
  platform: AiMediaOAuthPlatform;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}>;

/**
 * Produces only the provider authorization redirect. Provider endpoints, scopes,
 * parameter names and PKCE policy come from the audited immutable manifests.
 */
export function buildOAuthAuthorizationUrl(input: OAuthAuthorizationUrlInput): string {
  const manifest = AI_MEDIA_OAUTH_PLATFORM_MANIFESTS[input.platform];
  if (!manifest || !CLIENT_ID.test(input.clientId) || !STATE.test(input.state)) throw rejected();
  const redirectUri = trustedRedirectUri(input.redirectUri);
  if (manifest.pkce === "required_s256" && !PKCE_CHALLENGE.test(input.codeChallenge ?? "")) throw rejected();
  if (manifest.pkce !== "required_s256" && input.codeChallenge !== undefined) throw rejected();
  const authorizationParameters = Object.entries(manifest.authorizationParameters ?? {});
  if (authorizationParameters.some(([key, value]) => (
    !AUTHORIZATION_PARAMETER.test(key)
    || RESERVED_PARAMETERS.has(key)
    || typeof value !== "string"
    || !value
    || value.length > 512
  ))) throw rejected();

  const url = new URL(manifest.authorizationEndpoint);
  url.searchParams.set(manifest.authorizationClientIdParameter, input.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", manifest.defaultScopes.join(manifest.scopeSeparator === "space" ? " " : ","));
  url.searchParams.set("state", input.state);

  if (manifest.pkce === "required_s256") {
    url.searchParams.set("code_challenge", input.codeChallenge!);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of authorizationParameters) {
    if (url.searchParams.has(key)) throw rejected();
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function trustedOAuthRedirectUri(value: string): string {
  return trustedRedirectUri(value);
}

function trustedRedirectUri(value: string): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 512) throw rejected();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw rejected();
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.hostname === "localhost"
    || isIpLiteral(url.hostname)
  ) throw rejected();
  return url.href;
}

function isIpLiteral(hostname: string): boolean {
  return /^\d+(?:\.\d*)*$/u.test(hostname) || hostname.includes(":");
}

function rejected(): OAuthFlowError {
  return new OAuthFlowError("OAuth authorization configuration is invalid");
}
