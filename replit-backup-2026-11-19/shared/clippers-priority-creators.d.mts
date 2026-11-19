export interface LegacyDiscoveryCreator { readonly id: string; readonly handle: string; readonly channelId: string; readonly language: string | null; readonly identityEvidenceUrl: string; readonly identityVerifiedAt: string }
export interface DiscoveryCreator extends LegacyDiscoveryCreator { readonly creatorGroupId: string; readonly name: string; readonly role: string; readonly permission: 'unknown'; readonly mayPublish: false }
export interface CreatorGroup { readonly id: string; readonly name: string; readonly aliases: readonly string[] }
export declare const LEGACY_DISCOVERY_CREATORS: readonly LegacyDiscoveryCreator[];
export declare const DISCOVERY_CREATORS: typeof LEGACY_DISCOVERY_CREATORS;
export declare const PRIORITY_CREATORS: readonly DiscoveryCreator[];
export declare const DISCOVERY_CANDIDATES: readonly DiscoveryCreator[];
export declare const CHALLENGER_CREATORS: readonly DiscoveryCreator[];
export declare const ALL_DISCOVERY_CREATORS: readonly DiscoveryCreator[];
export declare const CREATOR_GROUPS: readonly CreatorGroup[];
export declare const KNOWN_CREATOR_GROUPS: readonly CreatorGroup[];
export declare function resolveCreatorGroup(value: unknown): CreatorGroup | null;
export declare function resolveCreatorChannel(channelId: unknown): DiscoveryCreator | null;
export declare function canonicalSourceIdentity(value: unknown): string | null;
