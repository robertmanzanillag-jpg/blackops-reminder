// Local-news delivery routed through the publishing seam (SOCIAL_PUBLISHING_PROVIDER).
// Unknown provider / missing capability => blocked result with the reason, nothing scheduled.
import { localNewsPublishingRefused, type ClipperLocalNewsMetricoolOptions, type ClipperLocalNewsMetricoolResult } from "../clippers-local-news-metricool";
import { publishingCapability, type PublishingLegacy } from "./provider";

export async function deliverLocalNewsThroughPublishingSeam(options: ClipperLocalNewsMetricoolOptions = {}): Promise<ClipperLocalNewsMetricoolResult> {
  let deliver: PublishingLegacy["deliverLocalNews"];
  try { deliver = publishingCapability("deliverLocalNews", { env: options.env, site: "clippers-local-news" }); }
  catch (refusal) { return localNewsPublishingRefused(refusal instanceof Error ? refusal.message : String(refusal), options); }
  return deliver(options);
}
