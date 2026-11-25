/** Provider-neutral social publishing contract (see docs/social-publishing-provider.md). */
export interface PublishingAccountRef {
  network: string; // tiktok | facebook | instagram | youtube | ...
  handle?: string; // public handle without "@"
  providerAccountId?: string; // provider-side id (Metricool blogId, hub account id, page id...)
}

export interface PublishRequest {
  provider?: string;
  accountRef: PublishingAccountRef;
  mediaUrl: string; // https URL the provider can download
  caption: string;
  hashtags?: string[];
  scheduledFor: string; // ISO-8601
  idempotencyKey: string; // same key => never posted twice
}

export type PublishStatus = "scheduled" | "published" | "pending_reconciliation" | "unverified" | "refused" | "failed" | "cancelled" | "unknown";

export interface PublishResult {
  provider: string;
  status: PublishStatus;
  providerPostId: string | null;
  publicUrl: string | null;
  publishedAt?: string;
  reason?: string;
  duplicate?: boolean;
}

export interface PublicationRef {
  providerPostId: string;
  accountRef: PublishingAccountRef;
  scheduledFor?: string;
}

export interface FreeSlotsQuery { accountRef: PublishingAccountRef; day: string } // day = YYYY-MM-DD
export interface FreeSlotsResult { provider: string; slots: string[]; timezone?: string | null; reason?: string }

export interface PublishingContext { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; now?: () => Date }

export interface SocialPublishingProvider<L = Record<string, unknown>> {
  name: string;
  label: string;
  schedulePost(request: PublishRequest, ctx?: PublishingContext): Promise<PublishResult>;
  getPublication(ref: PublicationRef, ctx?: PublishingContext): Promise<PublishResult>;
  cancel(ref: PublicationRef, ctx?: PublishingContext): Promise<PublishResult>;
  freeSlots(query: FreeSlotsQuery, ctx?: PublishingContext): Promise<FreeSlotsResult>;
  /** Existing provider-specific flows kept byte-for-byte (Metricool only). */
  legacy?: Partial<L>;
}
