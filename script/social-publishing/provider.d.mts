// Types for the scripts-side publishing seam (provider.mjs). Contract: docs/social-publishing-provider.md.
export interface PublishingAccountRef { network: string; handle?: string; providerAccountId?: string }
export interface ScriptPublishResult { provider: string; status: string; providerPostId: string | null; publicUrl: string | null; reason?: string; duplicate?: boolean }
export interface ScriptPublishingProvider {
  name: string; label: string;
  schedulePost(request: unknown, ctx?: unknown): Promise<ScriptPublishResult>;
  getPublication(ref: unknown, ctx?: unknown): Promise<ScriptPublishResult>;
  cancel(ref: unknown, ctx?: unknown): Promise<ScriptPublishResult>;
  freeSlots(query: unknown, ctx?: unknown): Promise<{ provider: string; slots: string[]; timezone?: string | null; reason?: string }>;
  createClient?(options: unknown): any;
  legacy?: Record<string, (...args: any[]) => any>;
}
import type { createPortfolioMetricool } from '../clippers-portfolio-metricool.mjs';
type Log = (message: string) => void;
export const SOCIAL_PUBLISHING_PROVIDERS: Readonly<Record<string, ScriptPublishingProvider>>;
export function resolveSocialPublishingProvider(env?: Record<string, string | undefined>, registry?: Readonly<Record<string, ScriptPublishingProvider>>, opts?: { site?: string; log?: Log }): { provider: ScriptPublishingProvider | null; name: string; reason: string };
export function publishingCapability(capability: string, opts?: { env?: Record<string, string | undefined>; registry?: Readonly<Record<string, ScriptPublishingProvider>>; site?: string; log?: Log }): (...args: any[]) => any;
/** Drop-in for createPortfolioMetricool(options) through the selected provider; throws when refused. */
export function createPublishingClient(options: { token: string; userId: string; fetcher?: typeof fetch; env?: Record<string, string | undefined> }, opts?: { registry?: Readonly<Record<string, ScriptPublishingProvider>>; site?: string; log?: Log }): ReturnType<typeof createPortfolioMetricool>;
export function validatePublishRequest(request: unknown): string[];
export function memoryIdempotencyStore(): { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
export function createSocialPublisher(opts?: { env?: Record<string, string | undefined>; registry?: Readonly<Record<string, ScriptPublishingProvider>>; idempotency?: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }; log?: Log; ctx?: Record<string, unknown> }): {
  name: string; reason: string;
  schedulePost(request: unknown): Promise<ScriptPublishResult>; getPublication(ref: unknown): Promise<ScriptPublishResult>;
  cancel(ref: unknown): Promise<ScriptPublishResult>; freeSlots(query: unknown): Promise<{ provider: string; slots: string[]; reason?: string }>;
};
