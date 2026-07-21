import type {
  CreateHeyGenRosterMember,
  HeyGenRosterPublicMember,
  HeyGenRosterStatus,
} from "../../../shared/ai-media-studio-heygen-roster";
import { HEYGEN_ROSTER_VIDEOS_PER_AVATAR } from "../../../shared/ai-media-studio-heygen-roster";
import type { TenantScope } from "../core/resource-domain";

export const HEYGEN_ROSTER_ERROR_CODES = [
  "INVALID_REQUEST",
  "ACCOUNT_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "ROSTER_UNAVAILABLE",
] as const;
export type HeyGenRosterErrorCode = typeof HEYGEN_ROSTER_ERROR_CODES[number];

/** Deliberately generic: provider-native identifiers are never interpolated into errors. */
export class HeyGenRosterError extends Error {
  readonly code: HeyGenRosterErrorCode;

  constructor(code: HeyGenRosterErrorCode) {
    super("Unable to configure avatar roster");
    this.name = "HeyGenRosterError";
    this.code = code;
  }
}

export type HeyGenResolvedAccountContext = Readonly<{
  providerAccountId: string;
  credentialVersion: number;
}>;

export interface HeyGenRosterAccountResolver {
  resolve(scope: TenantScope): Promise<HeyGenResolvedAccountContext | undefined>;
}

/** Internal-only binding. Never expose this shape from an HTTP/status boundary. */
export type HeyGenRosterNativeMember = Readonly<CreateHeyGenRosterMember & {
  memberId: string;
}>;

export type HeyGenRosterRecord = Readonly<{
  scope: TenantScope;
  providerAccountId: string;
  credentialVersion: number;
  rosterId: string;
  requestDigest: string;
  idempotencyKey: string;
  members: readonly HeyGenRosterNativeMember[];
  configuredAt: string;
}>;

export type ConfigureHeyGenRosterRecord = HeyGenRosterRecord;

export interface HeyGenRosterRepository {
  /** Atomically creates or returns an exact idempotent replay. */
  configure(input: ConfigureHeyGenRosterRecord): Promise<HeyGenRosterRecord>;
  getCurrent(scope: TenantScope): Promise<HeyGenRosterRecord | undefined>;
  get(scope: TenantScope, rosterId: string): Promise<HeyGenRosterRecord | undefined>;
}

export function toHeyGenRosterStatus(record: HeyGenRosterRecord): HeyGenRosterStatus {
  const members: HeyGenRosterPublicMember[] = record.members.map((member) => ({
    memberId: member.memberId,
    name: member.name,
    language: member.language,
    accent: member.accent,
    gender: member.gender,
    videosPlanned: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  }));
  return {
    rosterId: record.rosterId,
    status: "configured",
    avatarCount: members.length,
    videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    plannedVideoCount: members.length * HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    members,
    configuredAt: record.configuredAt,
  };
}
