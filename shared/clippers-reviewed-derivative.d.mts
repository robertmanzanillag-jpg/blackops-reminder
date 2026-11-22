export interface ReviewedDerivativeManifest { id: string; baseline: unknown; [key:string]:unknown }
export function validateReviewedDerivativeManifest(manifest: unknown, now?: number): ReviewedDerivativeManifest;
export function reviewedDerivativeDigest(manifest: unknown): string;
export function reviewedMediaHash(value: string | Uint8Array): string;
export function approvedNativeMediaUrl(value: unknown): boolean;
export function approveReviewedDerivative(proposal: any, options: {principal:string;operatorLabel:string;now?:number;expectedDigest:string;attestRights:boolean;attestExternalQa:boolean}): any;
export function reviewedDerivativeGate(record:unknown, options?:{owner?:string;now?:number;destination?:unknown;scheduledAt?:string;liveEligibility?:unknown}):string|null;
