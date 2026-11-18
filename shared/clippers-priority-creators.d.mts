export interface LegacyDiscoveryCreator { readonly id: string; readonly handle: string; readonly channelId: string; readonly language: string | null; readonly identityEvidenceUrl: string; readonly identityVerifiedAt: string }
export interface DiscoveryCreator extends LegacyDiscoveryCreator { readonly creatorGroupId: string; readonly name: string; readonly role: string; readonly permission: 'unknown'; readonly mayPublish: false }
export interface CreatorGroup { readonly id: string; readonly name: string; readonly aliases: readonly string[] }
export const LEGACY_DISCOVERY_CREATORS: readonly LegacyDiscoveryCreator[];
export const DISCOVERY_CREATORS: typeof LEGACY_DISCOVERY_CREATORS;
export const PRIORITY_CREATORS: readonly DiscoveryCreator[];
export const DISCOVERY_CANDIDATES: readonly DiscoveryCreator[];
export const CHALLENGER_CREATORS: readonly DiscoveryCreator[];
export const ALL_DISCOVERY_CREATORS: readonly DiscoveryCreator[];
export const CREATOR_GROUPS: readonly CreatorGroup[];
export const KNOWN_CREATOR_GROUPS: readonly CreatorGroup[];
export function resolveCreatorGroup(value: unknown): CreatorGroup | null;
export function resolveCreatorChannel(channelId: unknown): DiscoveryCreator | null;
export function canonicalSourceIdentity(value: unknown): string | null;
