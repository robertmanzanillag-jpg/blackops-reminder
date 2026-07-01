const clipperUnsafeProofQueryParamPattern = /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|refresh|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i;

export const clipperTikTokMvpProofLaneSpecs = [
  { key: "sports-daily:tiktok", accountName: "Sports Daily Clips", handle: "@sportsdaily", metricoolBrandName: "SPORT", aliases: ["sport", "sports", "sportsdaily", "sports daily"] },
  { key: "meme-radar:tiktok", accountName: "Meme Radar", handle: "@memeradar", metricoolBrandName: "memes", aliases: ["meme", "memes", "memeradar", "meme radar"] },
] as const;

export function containsClipperSecretLikeText(value: unknown): boolean {
  return /access_token=|refresh_token=|client_secret=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|(?:^|[\s"'[{,?&#;=])(cookie|password|passcode|recovery|api[_-]?key|private[_ -]?key)["']?\s*[:=]/i.test(String(value || ""))
    || /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i.test(String(value || ""))
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
    if (!/(^|\.)metricool\.com$/i.test(parsed.hostname)) return false;
    const normalizedPath = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    return /^(planner|brands?|posts?|publications?|analytics|reports?)$/i.test(pathSegments[0] || "")
      && Boolean(pathSegments[1])
      && pathSegments.join("").length >= 8;
  } catch {
    return false;
  }
}

export function safeClipperGoogleEvidenceProofUrl(value: unknown): boolean {
  if (!safeClipperHttpsProofUrl(value)) return false;
  try {
    const parsed = new URL(String(value || "").trim());
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;
    if (hostname === "drive.google.com") {
      return /^\/file\/d\/[^/]+(?:\/|$)/.test(pathname)
        || /^\/drive\/(?:u\/\d+\/)?folders\/[^/]+(?:\/|$)/.test(pathname)
        || ((pathname === "/open" || pathname === "/folderview") && Boolean(parsed.searchParams.get("id")?.trim()));
    }
    if (hostname === "docs.google.com") {
      return /^\/(?:document|spreadsheets|presentation|forms|drawings)\/d\/[^/]+(?:\/|$)/.test(pathname);
    }
    return false;
  } catch {
    return false;
  }
}

export function safeClipperMetricoolConnectionProofUrl(value: unknown): boolean {
  return safeClipperMetricoolProofUrl(value) || safeClipperGoogleEvidenceProofUrl(value);
}

export function classifyClipperTikTokMvpProofUrl(value: unknown) {
  const text = String(value || "").trim();
  const base = {
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    rawStored: false,
  };
  const blocked = (status: string, issue: string, nextStep: string, details: Record<string, unknown> = {}) => ({
    ...base,
    status,
    acceptedAsMetricoolConnectionProof: false,
    acceptedAsOwnershipProof: false,
    issues: [issue],
    guardrails: [
      "URL check does not save proof links, apply evidence, queue Metricool, schedule, or publish.",
      "Do not paste passwords, cookies, tokens, recovery codes, API keys, signed URLs, or private screenshots.",
      "Metricool remains approval_required and realPublishEnabled=false.",
    ],
    nextStep,
    ...details,
  });
  if (!text) {
    return blocked("blocked_empty", "Paste one non-secret Metricool or concrete Drive/Docs proof URL first.", "Paste a real HTTPS Metricool planner/brand/report URL or concrete Drive file/folder/Docs evidence URL.");
  }
  if (containsClipperSecretLikeText(text)) {
    return blocked("blocked_secret_like", "URL contains credential-like or signed/temporary text.", "Remove tokens, cookies, passwords, signed query params, or private credential material before previewing proof.", { unsafeBlocked: true });
  }
  if (hasClipperProofPlaceholder(text)) {
    return blocked("blocked_placeholder", "URL is a placeholder/example/instruction, not real proof.", "Replace the placeholder with a real non-secret proof URL from Metricool or concrete Drive/Docs evidence.");
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return blocked("blocked_invalid_url", "URL is not parseable.", "Paste a complete HTTPS URL.");
  }
  const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const safeHttps = safeClipperHttpsProofUrl(text);
  if (!safeHttps) {
    return blocked("blocked_not_safe_https", "URL must be safe HTTPS with no username/password, tokens, or signed query params.", "Use a safe HTTPS proof URL with no credentials or temporary access parameters.", { hostname });
  }
  if (/(^|\.)metricool\.com$/i.test(parsed.hostname)) {
    if (safeClipperMetricoolProofUrl(text)) {
      return {
        ...base,
        status: "ready_metricool_proof_url",
        acceptedAsMetricoolConnectionProof: true,
        acceptedAsOwnershipProof: false,
        proofKind: "metricool",
        hostname,
        issues: [],
        guardrails: [
          "URL check only validates proof URL shape; Robert/operator still must confirm the page proves SPORT/memes TikTok is connected.",
          "If reusing this URL as account ownership/control proof, write a real 20+ character note after reviewing the proof content.",
          "URL check does not save proof links, apply evidence, queue Metricool, schedule, or publish.",
        ],
        nextStep: "Use this URL in metricoolConnectionProofUrl, add real confirmation notes, then run Preview links before saving.",
      };
    }
    return blocked("blocked_generic_metricool_url", "Metricool URL is too generic to prove a TikTok connection.", "Use a concrete Metricool planner, brand, post, publication, analytics, or report URL with an identifier.", { proofKind: "metricool", hostname });
  }
  if (hostname === "drive.google.com" || hostname === "docs.google.com") {
    if (safeClipperGoogleEvidenceProofUrl(text)) {
      return {
        ...base,
        status: "ready_google_evidence_url",
        acceptedAsMetricoolConnectionProof: true,
        acceptedAsOwnershipProof: false,
        proofKind: hostname === "drive.google.com" ? "google_drive" : "google_docs",
        hostname,
        issues: [],
        guardrails: [
          "URL check only validates Drive/Docs proof URL shape; Robert/operator still must confirm the evidence proves the TikTok profile is connected in Metricool.",
          "Do not use Drive/Docs links that expose secrets, private screenshots with credentials, signed URLs, or temporary access tokens.",
          "URL check does not save proof links, apply evidence, queue Metricool, schedule, or publish.",
        ],
        nextStep: "Use this URL in metricoolConnectionProofUrl, add real confirmation notes, then run Preview links before saving.",
      };
    }
    return blocked("blocked_non_concrete_google_evidence_url", "Google URL is not a concrete Drive file/folder/open ID or Docs evidence URL.", "Use a concrete Google Drive file/folder URL or a Docs/Sheets/Slides document URL that contains the proof.", { proofKind: "google_evidence", hostname });
  }
  return blocked("blocked_unsupported_domain", "Proof URL must be Metricool or concrete Google Drive/Docs evidence for this MVP.", "Use a real Metricool URL or a concrete Drive file/folder/Docs proof URL for SPORT or memes TikTok.", { hostname });
}

function validClipperProofNotes(value: unknown, pattern: RegExp): boolean {
  const text = String(value || "").trim();
  return text.length >= 20 && !hasClipperProofPlaceholder(text) && !containsClipperSecretLikeText(text) && pattern.test(text);
}

function validMetricoolReuseConfirmationNotes(value: unknown): boolean {
  return validClipperProofNotes(
    value,
    /(?=.*tiktok)(?=.*robert)(?=.*control)(?=.*(metricool|drive|docs|proof|screenshot|captura))/i,
  );
}

function comparableClipperProofUrl(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const googleDriveFileId = hostname === "drive.google.com"
      ? parsed.pathname.match(/^\/file\/d\/([^/]+)/i)?.[1] || parsed.searchParams.get("id") || ""
      : "";
    const googleDriveFolderId = hostname === "drive.google.com"
      ? parsed.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([^/]+)/i)?.[1]
        || (parsed.pathname.match(/^\/folderview/i) ? parsed.searchParams.get("id") : "")
        || ""
      : "";
    if (googleDriveFolderId) return `https://drive.google.com/drive/folders/${googleDriveFolderId}`;
    if (googleDriveFileId) return `https://drive.google.com/file/d/${googleDriveFileId}`;
    const googleDocsMatch = hostname === "docs.google.com" ? parsed.pathname.match(/^\/([^/]+)\/d\/([^/]+)/i) : null;
    if (googleDocsMatch) return `https://docs.google.com/${googleDocsMatch[1].toLowerCase()}/d/${googleDocsMatch[2]}`;
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const comparableSearch = new URLSearchParams();
    for (const [key, searchValue] of parsed.searchParams.entries()) {
      if (/^(utm_|fbclid$|gclid$|msclkid$|igshid$|usp$|sharing$|ref$|source$)/i.test(key)) continue;
      comparableSearch.append(key, searchValue);
    }
    const sortedSearch = Array.from(comparableSearch.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      return leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue);
    });
    parsed.search = "";
    for (const [key, searchValue] of sortedSearch) parsed.searchParams.append(key, searchValue);
    return parsed.toString();
  } catch {
    return text
      .replace(/#.*$/, "")
      .replace(/[?&](utm_[^=&]+|fbclid|gclid|msclkid|igshid|usp|sharing|ref|source)=[^&]*/gi, "")
      .replace(/[?&]$/, "")
      .replace(/\/+$/, "");
  }
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
    const reusesConnectionProofAsOwnership = Boolean(
      lane.accountOwnershipProofUrl
      && lane.metricoolConnectionProofUrl
      && comparableClipperProofUrl(lane.accountOwnershipProofUrl) === comparableClipperProofUrl(lane.metricoolConnectionProofUrl),
    );
    const metricoolReuseConfirmed = !reusesConnectionProofAsOwnership || validMetricoolReuseConfirmationNotes(lane.accountNotes);
    const accountNotesReady = validClipperProofNotes(lane.accountNotes, /(2fa|two-factor|two factor|security|ownership|owner|verification|verified|verificad|screenshot|captura|proof|control)/i)
      && metricoolReuseConfirmed;
    const issues = [
      safeClipperHttpsProofUrl(lane.accountOwnershipProofUrl) ? null : "accountOwnershipProofUrl must be a real safe HTTPS proof URL",
      metricoolConnectionProofReady ? null : "metricoolConnectionProofUrl must be a real HTTPS metricool.com URL or concrete Google Drive file/folder or Docs evidence URL",
      accountNotesReady ? null : reusesConnectionProofAsOwnership
        ? "accountNotes must confirm this Metricool or concrete Drive file/folder/Docs proof shows the TikTok profile under Robert control"
        : "accountNotes must be 20+ chars and mention ownership/security proof",
      validClipperProofNotes(lane.metricoolNotes, /(metricool|connection|connected|brand|profile|verified|verificad|proof|screenshot|captura)/i) ? null : "metricoolNotes must be 20+ chars and mention Metricool connection proof",
    ].filter(Boolean);
    return {
      ...spec,
      accountProofReady: safeClipperHttpsProofUrl(lane.accountOwnershipProofUrl),
      metricoolProofReady: metricoolConnectionProofReady,
      accountNotesReady,
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
  const contentLines = lines.filter((line) => !line.startsWith("#"));
  const nonCommentText = contentLines.join("\n");
  const allUrls = Array.from(nonCommentText.matchAll(/https:\/\/[^\s"'<>]+/gi)).map((match) => match[0].replace(/[),.;]+$/g, ""));
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
    const laneLines = contentLines.filter((line) => spec.aliases.some((alias) => line.toLowerCase().includes(alias)));
    const laneText = laneLines.join("\n");
    const scopedUrls = Array.from(laneText.matchAll(/https:\/\/[^\s"'<>]+/gi)).map((match) => match[0].replace(/[),.;]+$/g, ""));
    const candidateUrls = scopedUrls.length ? scopedUrls : allUrls;
    const metricoolConnectionProofUrl = explicitLane.metricoolConnectionProofUrl || candidateUrls.find((url) => safeClipperMetricoolConnectionProofUrl(url)) || "";
    const accountOwnershipProofUrl = explicitLane.accountOwnershipProofUrl
      || candidateUrls.find((url) => safeClipperHttpsProofUrl(url) && !safeClipperMetricoolConnectionProofUrl(url))
      || metricoolConnectionProofUrl
      || "";
    const usesMetricoolProofAsAccountControl = Boolean(
      accountOwnershipProofUrl
      && metricoolConnectionProofUrl
      && comparableClipperProofUrl(accountOwnershipProofUrl) === comparableClipperProofUrl(metricoolConnectionProofUrl),
    );
    const metricoolReuseConfirmed = !usesMetricoolProofAsAccountControl
      || validMetricoolReuseConfirmationNotes(explicitLane.accountNotes);
    if (!laneLines.length && !explicitFields.has(spec.key)) issues.push(`${spec.key}: include a line labeled SPORT/sports or memes for this account.`);
    if (!accountOwnershipProofUrl) issues.push(`${spec.key}: could not find a safe non-Metricool HTTPS ownership proof URL.`);
    if (!metricoolConnectionProofUrl) issues.push(`${spec.key}: could not find a safe HTTPS metricool.com or concrete Google Drive file/folder or Docs connection proof URL.`);
    if (!metricoolReuseConfirmed) {
      issues.push(`${spec.key}: add accountNotes confirming the Metricool or concrete Drive file/folder/Docs proof shows this TikTok profile under Robert control before reusing it as ownership proof.`);
    }
    return [spec.key, {
      accountOwnershipProofUrl,
      metricoolConnectionProofUrl,
      accountNotes: explicitLane.accountNotes || "",
      metricoolNotes: explicitLane.metricoolNotes || "",
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
      : "Preview links first; save proof links only if the preview gate stays clean/current.",
  };
}
