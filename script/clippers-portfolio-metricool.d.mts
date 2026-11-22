export function createPortfolioMetricool(options:{token:string;userId:string;fetcher?:typeof fetch;env?:Record<string,string|undefined>}): {
 reconcileReviewedDerivative(destination:unknown,item:Record<string,unknown>):Promise<{id:string;uuid:string;mediaUrl:string;status:'scheduled'|'nonpublishing_draft'|'unverified';commercialDisclosureVerified:boolean;confirmedNonPublishingDraft:boolean}|null>;
};
