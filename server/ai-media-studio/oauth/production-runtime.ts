import type { AiMediaOAuthPlatform } from "../../../shared/ai-media-studio-oauth";
import type {
  OAuthAccountBindingVerifier,
  OAuthPlatformPolicies,
  OAuthSessionRepository,
} from "./contracts";
import { OAuthFlowError } from "./contracts";
import { buildOAuthAuthorizationUrl, trustedOAuthRedirectUri } from "./authorization-url";
import { AI_MEDIA_OAUTH_PLATFORM_MANIFESTS } from "./platform-manifests";
import {
  OAUTH_PKCE_OBJECT_PREFIX,
  S3KmsPkceVault,
  assertOAuthKmsKeyArn,
  type S3KmsCommandClient,
} from "./s3-kms-pkce-vault";
import { createOAuthService } from "./service";

const ENV = {
  enabledPlatforms: "AI_MEDIA_STUDIO_OAUTH_ENABLED_PLATFORMS",
  bucket: "AI_MEDIA_STUDIO_OAUTH_PKCE_BUCKET",
  region: "AI_MEDIA_STUDIO_OAUTH_AWS_REGION",
  kmsKeyArn: "AI_MEDIA_STUDIO_OAUTH_KMS_KEY_ARN",
  expectedBucketOwner: "AI_MEDIA_STUDIO_OAUTH_EXPECTED_BUCKET_OWNER",
  prefix: "AI_MEDIA_STUDIO_OAUTH_PKCE_PREFIX",
  tiktokClientId: "AI_MEDIA_STUDIO_OAUTH_TIKTOK_CLIENT_ID",
  tiktokRedirectUri: "AI_MEDIA_STUDIO_OAUTH_TIKTOK_REDIRECT_URI",
  instagramClientId: "AI_MEDIA_STUDIO_OAUTH_INSTAGRAM_CLIENT_ID",
  instagramRedirectUri: "AI_MEDIA_STUDIO_OAUTH_INSTAGRAM_REDIRECT_URI",
  facebookClientId: "AI_MEDIA_STUDIO_OAUTH_FACEBOOK_CLIENT_ID",
  facebookRedirectUri: "AI_MEDIA_STUDIO_OAUTH_FACEBOOK_REDIRECT_URI",
  youtubeShortsClientId: "AI_MEDIA_STUDIO_OAUTH_YOUTUBE_SHORTS_CLIENT_ID",
  youtubeShortsRedirectUri: "AI_MEDIA_STUDIO_OAUTH_YOUTUBE_SHORTS_REDIRECT_URI",
} as const;

const KNOWN_ENV_NAMES = new Set<string>(Object.values(ENV));
const PLATFORMS = ["tiktok", "instagram", "facebook", "youtube_shorts"] as const;
const SAFE_CONFIGURATION_ERROR = "AI Media Studio production OAuth configuration is invalid";

const PROVIDER_ENV: Readonly<Record<AiMediaOAuthPlatform, Readonly<{ clientId: string; redirectUri: string }>>> = {
  tiktok: { clientId: ENV.tiktokClientId, redirectUri: ENV.tiktokRedirectUri },
  instagram: { clientId: ENV.instagramClientId, redirectUri: ENV.instagramRedirectUri },
  facebook: { clientId: ENV.facebookClientId, redirectUri: ENV.facebookRedirectUri },
  youtube_shorts: { clientId: ENV.youtubeShortsClientId, redirectUri: ENV.youtubeShortsRedirectUri },
};

export type ProductionOAuthEnvironment = Readonly<Record<string, string | undefined>>;

export type ProductionOAuthRuntime =
  | { available: false; reason: "not_configured" }
  | Readonly<{
      available: true;
      enabledPlatforms: readonly AiMediaOAuthPlatform[];
      createService(input: {
        repository: OAuthSessionRepository;
        accounts: OAuthAccountBindingVerifier;
        ttlMs?: number;
        now?: () => Date;
      }): ReturnType<typeof createOAuthService>;
      authorizationUrl(input: {
        platform: AiMediaOAuthPlatform;
        state: string;
        codeChallenge?: string;
      }): string;
    }>;

export interface ProductionOAuthRuntimeDependencies {
  s3Client?: S3KmsCommandClient;
  clock?: { now(): Date };
}

type ProviderConfiguration = Readonly<{ clientId: string; redirectUri: string }>;
type ParsedConfiguration = Readonly<{
  bucket: string;
  region: string;
  kmsKeyArn: string;
  expectedBucketOwner: string;
  prefix: typeof OAUTH_PKCE_OBJECT_PREFIX;
  enabledPlatforms: readonly AiMediaOAuthPlatform[];
  providers: Readonly<Partial<Record<AiMediaOAuthPlatform, ProviderConfiguration>>>;
}>;

/** Composes inert production adapters; no AWS, database, or provider request occurs here. */
export function createProductionOAuthRuntimeFromEnvironment(
  environment: ProductionOAuthEnvironment = process.env,
  dependencies: ProductionOAuthRuntimeDependencies = {},
): ProductionOAuthRuntime {
  try {
    const config = parseConfiguration(environment);
    if (!config) return { available: false, reason: "not_configured" };
    const vault = new S3KmsPkceVault({
      bucket: config.bucket,
      region: config.region,
      kmsKeyArn: config.kmsKeyArn,
      expectedBucketOwner: config.expectedBucketOwner,
      prefix: config.prefix,
      ...(dependencies.s3Client ? { client: dependencies.s3Client } : {}),
      ...(dependencies.clock ? { clock: dependencies.clock } : {}),
    });
    const policies: OAuthPlatformPolicies = Object.fromEntries(config.enabledPlatforms.map((platform) => [
      platform,
      {
        redirectUris: [config.providers[platform]!.redirectUri],
        scopes: AI_MEDIA_OAUTH_PLATFORM_MANIFESTS[platform].defaultScopes,
        pkce: AI_MEDIA_OAUTH_PLATFORM_MANIFESTS[platform].pkce === "required_s256" ? "required_s256" : "none",
      },
    ]));

    return {
      available: true,
      enabledPlatforms: Object.freeze([...config.enabledPlatforms]),
      createService: (input) => createOAuthService({
        repository: input.repository,
        accounts: input.accounts,
        policies,
        vault,
        ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
        ...(input.now ? { now: input.now } : {}),
      }),
      authorizationUrl: (input) => {
        if (!config.enabledPlatforms.includes(input.platform)) throw new OAuthFlowError();
        return buildOAuthAuthorizationUrl({
          platform: input.platform,
          clientId: config.providers[input.platform]!.clientId,
          redirectUri: config.providers[input.platform]!.redirectUri,
          state: input.state,
          ...(input.codeChallenge === undefined ? {} : { codeChallenge: input.codeChallenge }),
        });
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === SAFE_CONFIGURATION_ERROR) throw error;
    throw invalidConfiguration();
  }
}

function parseConfiguration(environment: ProductionOAuthEnvironment): ParsedConfiguration | undefined {
  const configuredNames = Object.keys(environment).filter((name) => name.startsWith("AI_MEDIA_STUDIO_OAUTH_"));
  if (configuredNames.length === 0) return undefined;
  if (configuredNames.some((name) => !KNOWN_ENV_NAMES.has(name))) throw invalidConfiguration();

  const bucket = required(environment, ENV.bucket);
  const region = required(environment, ENV.region);
  const kmsKeyArn = required(environment, ENV.kmsKeyArn);
  const expectedBucketOwner = required(environment, ENV.expectedBucketOwner);
  const prefix = required(environment, ENV.prefix);
  if (!validBucket(bucket) || !validRegion(region) || prefix !== OAUTH_PKCE_OBJECT_PREFIX) throw invalidConfiguration();
  try { assertOAuthKmsKeyArn(kmsKeyArn, region); } catch { throw invalidConfiguration(); }
  if (!/^\d{12}$/u.test(expectedBucketOwner) || !kmsKeyArn.includes(`:${expectedBucketOwner}:key/`)) throw invalidConfiguration();

  const enabledPlatforms = parseEnabledPlatforms(required(environment, ENV.enabledPlatforms));
  const providers: Partial<Record<AiMediaOAuthPlatform, ProviderConfiguration>> = {};
  for (const platform of PLATFORMS) {
    const names = PROVIDER_ENV[platform];
    const clientIdValue = environment[names.clientId];
    const redirectValue = environment[names.redirectUri];
    if (enabledPlatforms.includes(platform)) {
      const clientId = required(environment, names.clientId);
      if (!/^[A-Za-z0-9._:-]{1,512}$/u.test(clientId)) throw invalidConfiguration();
      let redirectUri: string;
      try { redirectUri = trustedOAuthRedirectUri(required(environment, names.redirectUri)); } catch { throw invalidConfiguration(); }
      providers[platform] = { clientId, redirectUri };
    } else if (clientIdValue !== undefined || redirectValue !== undefined) {
      throw invalidConfiguration();
    }
  }
  return {
    bucket,
    region,
    kmsKeyArn,
    expectedBucketOwner,
    prefix: OAUTH_PKCE_OBJECT_PREFIX,
    enabledPlatforms,
    providers,
  };
}

function parseEnabledPlatforms(value: string): readonly AiMediaOAuthPlatform[] {
  const values = value.split(",");
  if (!values.length || values.some((item) => item.trim() !== item || !PLATFORMS.includes(item as AiMediaOAuthPlatform))) {
    throw invalidConfiguration();
  }
  const unique = [...new Set(values)] as AiMediaOAuthPlatform[];
  if (unique.length !== values.length) throw invalidConfiguration();
  return unique;
}

function required(environment: ProductionOAuthEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || !value || value.trim() !== value) throw invalidConfiguration();
  return value;
}

function validBucket(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value) && !value.includes("..") && !/^\d+(?:\.\d+){3}$/u.test(value);
}

function validRegion(value: string): boolean {
  return /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(value);
}

function invalidConfiguration(): Error {
  return new Error(SAFE_CONFIGURATION_ERROR);
}
