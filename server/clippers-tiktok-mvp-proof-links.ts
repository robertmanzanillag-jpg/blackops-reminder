const clipperUnsafeProofQueryParamPattern = /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|refresh|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i;

export const clipperTikTokMvpProofLaneSpecs = [
  { key: "sports-daily:tiktok", accountName: "Sports Daily Clips", handle: "@sportsdaily", metricoolBrandName: "SPORT", aliases: ["sport", "sports", "sportsdaily", "sports daily"] },
  { key: "meme-radar:tiktok", accountName: "Meme Radar", handle: "@memeradar", metricoolBrandName: "memes", aliases: ["meme", "memes", "memeradar", "meme radar"] },
] as const;

export function containsClipperSecretLikeText(value: unknown): boolean {
  return /access_token=|refresh_token=|client_secret=|cookie=|password=|passcode|recovery|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|api[_-]?key|private[_ -]?key/i.test(String(value || ""))
    || /https:\/\/[^/\s:@]+:[^@\s/]+@/i.test(String(value || ""))
    || clipperUnsafeProofQueryParamPattern.test(String(value || ""));
}

function hasClipperProofPlaceholder(value: unknown): boolean {
  return /<|>|paste|placeholder|replace this|example\.com|not-real|not-metricool|todo|tbd/i.test(String(value || ""));
}

export function safeClipperHttpsProofUrl(value: unknown): boolean {
  const text = String(value || "").trim();
  if (!text || hasClipperProofPlaceholder(text) || containsClipperSecretLikeText(text)) return false;
  try {
    const parsed = new URL(text);
    if (clipperUnsafeProofQueryParamPattern.test(parsed.search)) return false;
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function safeClipperMetricoolProofUrl(value: unknown): boolean {
  if (!safeClipperHttpsProofUrl(value)) return false;
  try {
    const parsed = new URL(String(value || "").trim());
    return /(^|\.)metricool\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function safeClipperGoogleEvidenceProofUrl(value: unknown): boolean {
  if (!safeClipperHttpsProofUrl(value)) return false;
  try {
    const parsed = new URL(String(value || "").trim());
    return /^(drive|docs)\.google\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function safeClipperMetricoolConnectionProofUrl(value: unknown): boolean {
  return safeClipperMetricoolProofUrl(value) || safeClipperGoogleEvidenceProofUrl(value);
}

function validClipperProofNotes(value: unknown, pattern: RegExp): boolean {
  const text = String(value || "").trim();
  return text.length >= 20 && !hasClipperProofPlaceholder(text) && !containsClipperSecretLikeText(text) && pattern.test(text);
}

export function validateClipperTikTokMvpProofLinks(value: any): string {
  const raw = JSON.stringify(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "proof-links must be a JSON object";
  if (containsClipperSecretLikeText(raw)) return "proof-links cannot contain passwords, tokens, cookies, keys, or recovery codes";
  if (!value.lanes || typeof value.lanes !== "object" || Array.isArray(value.lanes)) return "proof-links must contain a lanes object";
  for (const laneKey of ["sports-daily:tiktok", "meme-radar:tiktok"]) {
    const lane = value.lanes[laneKey];
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) return `proof-links is missing ${laneKey}`;
    for (const field of ["accountOwnershipProofUrl", "metricoolConnectionProofUrl", "accountNotes", "metricoolNotes"]) {
      if (typeof lane[field] !== "string") return `${laneKey}.${field} must be a string`;
    }
  }
  return "";
}

export function auditClipperTikTokMvpProofLinks(value: any) {
  const structureError = validateClipperTikTokMvpProofLinks(value);
  const lanes = clipperTikTokMvpProofLaneSpecs.map((spec) => {
    const lane = value?.lanes?.[spec.key] || {};
    const metricoolConnectionProofReady = safeClipperMetricoolConnectionProofUrl(lane.metricoolConnectionProofUrl);
    const issues = [
      safeClipperHttpsProofUrl(lane.accountOwnershipProofUrl) ? null : "accountOwnershipProofUrl must be a real safe HTTPS proof URL",
      metricoolConnectionProofReady ? null : "metricoolConnectionProofUrl must be a real HTTPS metricool.com URL or Google Drive/Docs evidence URL",
      validClipperProofNotes(lane.accountNotes, /(2fa|two-factor|two factor|security|ownership|owner|verification|verified|verificad|screenshot|captura|proof)/i) ? null : "accountNotes must be 20+ chars and mention ownership/security proof",
      validClipperProofNotes(lane.metricoolNotes, /(metricool|connection|connected|brand|profile|verified|verificad|proof|screenshot|captura)/i) ? null : "metricoolNotes must be 20+ chars and mention Metricool connection proof",
    ].filter(Boolean);
    return {
      ...spec,
      accountProofReady: safeClipperHttpsProofUrl(lane.accountOwnershipProofUrl),
      metricoolProofReady: metricoolConnectionProofReady,
      accountNotesReady: validClipperProofNotes(lane.accountNotes, /(2fa|two-factor|two factor|security|ownership|owner|verification|verified|verificad|screenshot|captura|proof)/i),
      metricoolNotesReady: validClipperProofNotes(lane.metricoolNotes, /(metricool|connection|connected|brand|profile|verified|verificad|proof|screenshot|captura)/i),
      issues,
      readyForProofDrop: issues.length === 0,
    };
  });
  const issues = [
    structureError || null,
    ...lanes.flatMap((lane) => lane.issues.map((issue) => `${lane.key}: ${issue}`)),
  ].filter(Boolean);
  const readyProofFields = lanes.reduce((sum, lane) => {
    return sum
      + (lane.accountProofReady ? 1 : 0)
      + (lane.metricoolProofReady ? 1 : 0)
      + (lane.accountNotesReady ? 1 : 0)
      + (lane.metricoolNotesReady ? 1 : 0);
  }, 0);
  const totalProofFields = lanes.length * 4;
  const readyForProofDrop = issues.length === 0;
  return {
    status: readyForProofDrop ? "ready_for_proof_drop" : "blocked",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    readyForProofDrop,
    lanes,
    issues,
    goalBoardImpact: {
      status: readyForProofDrop ? "unlocks_proof_actions" : "blocked_proof_actions",
      readyProofFields,
      totalProofFields,
      unlocksOperatorActions: readyForProofDrop ? [
        "sports-daily:tiktok.accountOwnershipProofUrl",
        "sports-daily:tiktok.metricoolConnectionProofUrl",
        "meme-radar:tiktok.accountOwnershipProofUrl",
        "meme-radar:tiktok.metricoolConnectionProofUrl",
      ] : [],
      nextSafeButton: readyForProofDrop ? "save_proof_links" : "preview_proof_links",
      nextLockedButton: readyForProofDrop ? "apply_tiktok_mvp_evidence_closeout" : "save_proof_links",
      nextStep: readyForProofDrop
        ? "Save proof links. This only stores validated proof links and refreshes gates; it still does not apply evidence or publish."
        : "Fix every blocked proof field before Save links can unlock the first four operator actions.",
    },
    impact: {
      unlocks: readyForProofDrop
        ? [
            "Proof links can be saved to proof-links.json.",
            "Proof drop can run quick-fill and unblocker checks.",
            "Import preview can evaluate whether target evidence CSVs are ready.",
            "The first four goal-board proof actions can move from blocked to ready for save/apply review.",
          ]
        : [
            "No production gate is unlocked until these proof-link issues are fixed.",
          ],
      doesNotUnlock: [
        "Does not apply account or Metricool evidence.",
        "Does not prove legal rights to third-party content.",
        "Does not schedule or publish TikTok posts.",
        "Does not mark Metricool queue items as published or ready_to_send.",
        "Does not enable direct social APIs or real publishing.",
      ],
    },
    guardrails: [
      "This preview does not write proof-links.json.",
      "This preview never applies evidence, schedules posts, or publishes.",
      "Metricool remains approval_required and realPublishEnabled remains false.",
    ],
    nextStep: issues.length
      ? "Fix the listed proof-link issues before saving and running Proof drop."
      : "Save proof links, then run Proof handoff/import preview. Do not apply until closeout preview is ready.",
  };
}

export function extractClipperTikTokMvpProofLinksPaste(rawPaste: unknown) {
  const raw = String(rawPaste || "");
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const allUrls = Array.from(raw.matchAll(/https:\/\/[^\s"'<>]+/gi)).map((match) => match[0].replace(/[),.;]+$/g, ""));
  const issues: string[] = [];
  if (!raw.trim()) issues.push("Paste text with SPORT and memes TikTok ownership proof plus Metricool proof URLs.");
  if (containsClipperSecretLikeText(raw)) issues.push("Paste text cannot contain passwords, tokens, cookies, keys, or recovery codes.");
  const explicitFields = new Map<string, Record<string, string>>();
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const match = line.match(/^([a-z0-9-]+:tiktok)\.(accountOwnershipProofUrl|metricoolConnectionProofUrl|accountNotes|metricoolNotes)\s*=\s*(.*)$/i);
    if (!match) continue;
    const laneKey = match[1].toLowerCase();
    const field = match[2];
    const value = match[3].trim();
    explicitFields.set(laneKey, { ...(explicitFields.get(laneKey) || {}), [field]: value });
  }
  const lanes = Object.fromEntries(clipperTikTokMvpProofLaneSpecs.map((spec) => {
    const explicitLane = explicitFields.get(spec.key) || {};
    const laneLines = lines.filter((line) => spec.aliases.some((alias) => line.toLowerCase().includes(alias)));
    const laneText = laneLines.join("\n");
    const scopedUrls = Array.from(laneText.matchAll(/https:\/\/[^\s"'<>]+/gi)).map((match) => match[0].replace(/[),.;]+$/g, ""));
    const candidateUrls = scopedUrls.length ? scopedUrls : allUrls;
    const metricoolConnectionProofUrl = explicitLane.metricoolConnectionProofUrl || candidateUrls.find((url) => safeClipperMetricoolConnectionProofUrl(url)) || "";
    const accountOwnershipProofUrl = explicitLane.accountOwnershipProofUrl
      || candidateUrls.find((url) => safeClipperHttpsProofUrl(url) && !safeClipperMetricoolConnectionProofUrl(url))
      || metricoolConnectionProofUrl
      || "";
    const usesMetricoolProofAsAccountControl = Boolean(accountOwnershipProofUrl && accountOwnershipProofUrl === metricoolConnectionProofUrl && !explicitLane.accountOwnershipProofUrl);
    if (!laneLines.length && !explicitFields.has(spec.key)) issues.push(`${spec.key}: include a line labeled SPORT/sports or memes for this account.`);
    if (!accountOwnershipProofUrl) issues.push(`${spec.key}: could not find a safe non-Metricool HTTPS ownership proof URL.`);
    if (!metricoolConnectionProofUrl) issues.push(`${spec.key}: could not find a safe HTTPS metricool.com or Google Drive/Docs connection proof URL.`);
    return [spec.key, {
      accountOwnershipProofUrl,
      metricoolConnectionProofUrl,
      accountNotes: explicitLane.accountNotes || (usesMetricoolProofAsAccountControl
        ? `${spec.metricoolBrandName} Metricool connection proof verifies Robert-controlled TikTok ownership for ${spec.accountName} without secrets.`
        : `${spec.accountName} TikTok ownership and security proof verified by Robert without secrets.`),
      metricoolNotes: explicitLane.metricoolNotes || `${spec.metricoolBrandName} TikTok profile connected in Metricool approval_required mode without secrets.`,
    }];
  }));
  const proofLinks = { lanes };
  const preview = auditClipperTikTokMvpProofLinks(proofLinks);
  return {
    status: issues.length || preview.issues.length ? "needs_review" : "ready_for_proof_links_preview",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    extractedUrls: allUrls.length,
    issues,
    proofLinks,
    proofLinksText: `${JSON.stringify(proofLinks, null, 2)}\n`,
    proofLinksPreview: preview,
    guardrails: [
      "Paste assistant only builds a proof-links.json draft.",
      "It does not save proof-links.json, apply evidence, or change Metricool status.",
      "Run Preview links before saving.",
    ],
    nextStep: issues.length || preview.issues.length
      ? "Review the draft and fix missing or unsafe proof links before saving."
      : "Preview links, then save proof links if the preview stays clean.",
  };
}
