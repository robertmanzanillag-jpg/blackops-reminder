import { createHash } from "node:crypto";

export type LocalNewsReviewRole = "source_verifier" | "safety_editor" | "monetization_editor";
export type LocalNewsReviewVerdict = "approve" | "quarantine" | "reject";
export type LocalNewsPublishDecision = "auto_publish" | "quarantine" | "reject";

export interface LocalNewsReview {
  role: LocalNewsReviewRole;
  verdict: LocalNewsReviewVerdict;
  reasons: string[];
  evidence: string[];
  checkedAt: string;
}

export interface LocalNewsCommitteeInput {
  source: string;
  sourceUrl: string;
  title: string;
  description: string;
  instruction: string;
  location: string;
  eventType: string;
  risk: "low" | "medium" | "high" | "critical";
  section: string;
  editorialUrgency: string;
  connectorId?: string | null;
  canonicalHost?: string | null;
  fetchedAt?: string | null;
  claimHash?: string | null;
  provenanceVerified?: boolean;
  effective?: string | null;
  expires?: string | null;
}

export interface LocalNewsCommitteeResult {
  verdicts: LocalNewsReview[];
  evidence: string[];
  consensus: "unanimous_approve" | "not_unanimous";
  publishDecision: LocalNewsPublishDecision;
  reasons: string[];
  checkedAt: string;
  reviewHash: string;
}

const OFFICIAL_HOSTS = ["weather.gov", "nyc.gov", "notify.nyc", "everbridge.net", "miamidade.gov", "511ny.org", "fl511.com", "arcgis.com"];
const OFFICIAL_SOURCE_NAMES = /national weather service|\bnws\b|notify nyc|miami-dade county|florida highway patrol|\bfl511\b|\b511ny\b/i;

export function hashLocalNewsReviewValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashLocalNewsQueueReview(value: {
  copy: string;
  platform: string;
  verdicts: LocalNewsReview[];
  evidence: string[];
  consensus: LocalNewsCommitteeResult["consensus"];
  publishDecision: LocalNewsPublishDecision;
  checkedAt: string;
}): string {
  return hashLocalNewsReviewValue(value);
}

function hostFor(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function matchesOfficialHost(host: string): boolean {
  return OFFICIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function review(role: LocalNewsReviewRole, verdict: LocalNewsReviewVerdict, reasons: string[], evidence: string[], checkedAt: string): LocalNewsReview {
  return { role, verdict, reasons, evidence, checkedAt };
}

export function runLocalNewsReviewCommittee(input: LocalNewsCommitteeInput, checkedAt: string): LocalNewsCommitteeResult {
  const text = `${input.title} ${input.description} ${input.instruction} ${input.location} ${input.eventType}`.toLowerCase();
  const sensitive = input.risk === "high" || input.risk === "critical";
  const sourceHost = hostFor(input.sourceUrl);
  const canonicalHost = (input.canonicalHost || "").toLowerCase();
  const official = matchesOfficialHost(sourceHost) && OFFICIAL_SOURCE_NAMES.test(input.source);
  const provenanceComplete = Boolean(input.provenanceVerified && input.connectorId && input.fetchedAt && input.claimHash && canonicalHost === sourceHost);
  const sourceEvidence = [`source=${input.source}`, `host=${sourceHost || "invalid"}`, `connector=${input.connectorId || "none"}`, `claimHash=${input.claimHash || "none"}`];
  const sourceVerdict = !official && !provenanceComplete
    ? review("source_verifier", "quarantine", ["source_not_official_or_authorized"], sourceEvidence, checkedAt)
    : sensitive && !provenanceComplete
      ? review("source_verifier", "quarantine", ["sensitive_story_missing_verified_connector_provenance"], sourceEvidence, checkedAt)
      : review("source_verifier", "approve", [provenanceComplete ? "official_source_and_connector_provenance_verified" : "official_source_host_verified"], sourceEvidence, checkedAt);

  const graphic = /graphic|gr[aá]fic[oa]|gore|decapitat|dismember|charred body|body parts|blood-soaked|sangre expl[ií]cita/.test(text);
  const minorIdentifiable = /\b(minor|child|teen|menor|niñ[oa]|adolescente)\b/.test(text) && /identified|named|nombre|identificad[oa]|\bage[d]?\s+\d{1,2}\b|\bde\s+\d{1,2}\s+años\b/.test(text);
  const victimPrivateAddress = /victim|v[ií]ctima/.test(text) && /\b\d{1,5}\s+[a-z0-9.' -]+\s(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|calle|avenida)\b/i.test(text);
  const contradiction = /contradict|conflicting reports|reports differ|versiones contradictorias|informaci[oó]n contradictoria/.test(text);
  const unconfirmed = /rumou?r|unconfirmed|not confirmed|sin confirmar|no confirmado/.test(text);
  const accusation = /alleged|allegation|accus|charged|indict|arrested|acusad|imputad|detenid|arrestad/.test(text);
  const officialResolution = /convicted|acquitted|charges dismissed|pleaded guilty|sentenced|condenad|absuelt|cargos desestimados|se declar[oó] culpable|sentenciad/.test(text);
  const criticalEvacuation = input.risk === "critical" && /evacuat|evacuaci[oó]n/.test(text);
  const locationSpecific = input.location.trim().length >= 5 && !/^(miami area|new york area|miami-dade|new york|nyc)$/i.test(input.location.trim());
  const effectiveMs = input.effective ? new Date(input.effective).getTime() : Number.NaN;
  const expiresMs = input.expires ? new Date(input.expires).getTime() : Number.NaN;
  const checkedMs = new Date(checkedAt).getTime();
  const evacuationVerified = provenanceComplete && locationSpecific && Number.isFinite(effectiveMs) && Number.isFinite(expiresMs) && effectiveMs <= checkedMs && expiresMs > checkedMs;
  let safetyVerdict: LocalNewsReviewVerdict = "approve";
  const safetyReasons: string[] = ["no_disqualifying_safety_pattern_detected"];
  if (graphic || minorIdentifiable || victimPrivateAddress) {
    safetyVerdict = "reject";
    safetyReasons.splice(0, safetyReasons.length, graphic ? "graphic_violence" : minorIdentifiable ? "identifiable_minor" : "victim_private_address");
  } else if (contradiction || unconfirmed || (accusation && !officialResolution) || (criticalEvacuation && !evacuationVerified)) {
    safetyVerdict = "quarantine";
    safetyReasons.splice(0, safetyReasons.length, contradiction ? "contradictory_information" : unconfirmed ? "unconfirmed_claim" : accusation && !officialResolution ? "unresolved_accusation" : "critical_evacuation_missing_verified_zone_or_validity_window");
  }
  if (criticalEvacuation && evacuationVerified) safetyReasons.splice(0, safetyReasons.length, "critical_evacuation_provenance_zone_and_validity_verified");
  const safetyEvidence = [`risk=${input.risk}`, `contentHash=${hashLocalNewsReviewValue([input.title, input.description, input.instruction, input.location])}`];
  const safetyVerdictRecord = review("safety_editor", safetyVerdict, safetyReasons, safetyEvidence, checkedAt);

  const bait = /you won'?t believe|share before|tag everyone|must see|shocking|no vas a creer|comparte antes|etiqueta a todos/.test(text);
  const relevant = input.section !== "local" || input.editorialUrgency !== "routine" || text.length >= 40;
  const monetizationVerdict = bait ? "reject" : relevant ? "approve" : "quarantine";
  const monetizationReasons = [bait ? "engagement_bait_or_spam_pattern" : relevant ? "public_interest_story_without_revenue_inference" : "insufficient_public_interest_signal"];
  const monetizationEvidence = [`section=${input.section}`, `urgency=${input.editorialUrgency}`, "revenue_not_inferred"];
  const monetizationVerdictRecord = review("monetization_editor", monetizationVerdict, monetizationReasons, monetizationEvidence, checkedAt);

  const verdicts = [sourceVerdict, safetyVerdictRecord, monetizationVerdictRecord];
  const consensus = verdicts.every((item) => item.verdict === "approve") ? "unanimous_approve" : "not_unanimous";
  const publishDecision: LocalNewsPublishDecision = verdicts.some((item) => item.verdict === "reject") ? "reject" : consensus === "unanimous_approve" ? "auto_publish" : "quarantine";
  const reasons = [...new Set(verdicts.flatMap((item) => item.reasons))];
  const evidence = [...new Set(verdicts.flatMap((item) => item.evidence))];
  return { verdicts, evidence, consensus, publishDecision, reasons, checkedAt, reviewHash: hashLocalNewsReviewValue({ input, verdicts, checkedAt }) };
}
