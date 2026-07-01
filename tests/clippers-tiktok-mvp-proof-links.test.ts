import assert from "node:assert/strict";
import test from "node:test";
import {
  auditClipperTikTokMvpProofLinks,
  extractClipperTikTokMvpProofLinksPaste,
  safeClipperMetricoolConnectionProofUrl,
  safeClipperMetricoolProofUrl,
  validateClipperTikTokMvpProofLinks,
} from "../server/clippers-tiktok-mvp-proof-links";

const cleanProofLinks = {
  lanes: {
    "sports-daily:tiktok": {
      accountOwnershipProofUrl: "https://drive.google.com/file/d/sports-daily-tiktok-proof/view",
      metricoolConnectionProofUrl: "https://app.metricool.com/planner/sports-daily-tiktok-proof",
      accountNotes: "Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
      metricoolNotes: "SPORT TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
    },
    "meme-radar:tiktok": {
      accountOwnershipProofUrl: "https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
      metricoolConnectionProofUrl: "https://app.metricool.com/planner/meme-radar-tiktok-proof",
      accountNotes: "Meme Radar TikTok ownership and 2FA security proof verified by Robert without secrets.",
      metricoolNotes: "memes TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
    },
  },
};

test("TikTok MVP proof links parser accepts explicit packet fields", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "sports-daily:tiktok.accountOwnershipProofUrl=https://drive.google.com/file/d/sports-daily-tiktok-proof/view",
    "sports-daily:tiktok.metricoolConnectionProofUrl=https://app.metricool.com/planner/sports-daily-tiktok-proof",
    "sports-daily:tiktok.accountNotes=Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
    "sports-daily:tiktok.metricoolNotes=SPORT TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
    "meme-radar:tiktok.accountOwnershipProofUrl=https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
    "meme-radar:tiktok.metricoolConnectionProofUrl=https://app.metricool.com/planner/meme-radar-tiktok-proof",
    "meme-radar:tiktok.accountNotes=Meme Radar TikTok ownership and 2FA security proof verified by Robert without secrets.",
    "meme-radar:tiktok.metricoolNotes=memes TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
  ].join("\n"));

  assert.equal(parsed.status, "ready_for_proof_links_preview");
  assert.equal(parsed.directSocialApisRequired, false);
  assert.equal(parsed.realPublishEnabled, false);
  assert.equal(parsed.proofLinksPreview.readyForProofDrop, true);
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.status, "unlocks_proof_actions");
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.readyProofFields, 8);
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.totalProofFields, 8);
  assert.deepEqual(parsed.proofLinksPreview.goalBoardImpact.unlocksOperatorActions, [
    "sports-daily:tiktok.accountOwnershipProofUrl",
    "sports-daily:tiktok.metricoolConnectionProofUrl",
    "meme-radar:tiktok.accountOwnershipProofUrl",
    "meme-radar:tiktok.metricoolConnectionProofUrl",
  ]);
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.nextSafeButton, "save_proof_links");
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.nextLockedButton, "apply_tiktok_mvp_evidence_closeout");
  assert.doesNotMatch(JSON.stringify(parsed.proofLinksPreview.goalBoardImpact), /ready_to_send|realPublishEnabled=true|video\.publish|autopublish/i);
  assert.equal(
    parsed.proofLinks.lanes["sports-daily:tiktok"].metricoolConnectionProofUrl,
    "https://app.metricool.com/planner/sports-daily-tiktok-proof",
  );
  assert.doesNotMatch(parsed.proofLinksText, /ready_to_send|realPublishEnabled\s*:\s*true|publish/i);
});

test("TikTok MVP proof links parser ignores instruction URLs in comments", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "# SPORT accepted: real https://*.metricool.com/... URL or concrete Google Drive file/folder or Docs evidence URL.",
    "sports-daily:tiktok.metricoolConnectionProofUrl=",
    "sports-daily:tiktok.accountOwnershipProofUrl=",
    "sports-daily:tiktok.accountNotes=Robert confirms this Metricool proof shows Sports Daily TikTok connected under Robert control without secrets.",
    "meme-radar:tiktok.metricoolConnectionProofUrl=",
    "meme-radar:tiktok.accountOwnershipProofUrl=",
    "meme-radar:tiktok.accountNotes=Robert confirms this Drive proof shows Meme Radar TikTok connected under Robert control without secrets.",
  ].join("\n"));

  assert.equal(parsed.status, "needs_review");
  assert.equal(parsed.extractedUrls, 0);
  assert.equal(parsed.proofLinks.lanes["sports-daily:tiktok"].metricoolConnectionProofUrl, "");
  assert.equal(parsed.proofLinks.lanes["meme-radar:tiktok"].metricoolConnectionProofUrl, "");
  assert.match(parsed.issues.join("\n"), /could not find a safe HTTPS metricool\.com/);
  assert.equal(parsed.realPublishEnabled, false);
});

test("TikTok MVP proof links parser can reuse clean Metricool proof as account control proof", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "SPORT Metricool connected proof https://app.metricool.com/planner/sports-daily-tiktok-proof",
    "sports-daily:tiktok.accountNotes=Robert confirms this Metricool proof shows Sports Daily TikTok connected under Robert control without secrets.",
    "sports-daily:tiktok.metricoolNotes=SPORT TikTok profile connection reviewed in Metricool approval_required mode without secrets.",
    "memes Metricool connected proof https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing",
    "meme-radar:tiktok.accountNotes=Robert confirms this Drive proof shows Meme Radar TikTok connected under Robert control without secrets.",
    "meme-radar:tiktok.metricoolNotes=memes TikTok profile connection reviewed in Metricool approval_required mode without secrets.",
  ].join("\n"));

  assert.equal(parsed.status, "ready_for_proof_links_preview");
  assert.equal(parsed.directSocialApisRequired, false);
  assert.equal(parsed.realPublishEnabled, false);
  assert.equal(parsed.proofLinksPreview.readyForProofDrop, true);
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.readyProofFields, 8);
  assert.equal(
    parsed.proofLinks.lanes["sports-daily:tiktok"].accountOwnershipProofUrl,
    "https://app.metricool.com/planner/sports-daily-tiktok-proof",
  );
  assert.equal(
    parsed.proofLinks.lanes["sports-daily:tiktok"].metricoolConnectionProofUrl,
    "https://app.metricool.com/planner/sports-daily-tiktok-proof",
  );
  assert.match(
    parsed.proofLinks.lanes["sports-daily:tiktok"].accountNotes,
    /Robert confirms this Metricool proof shows Sports Daily TikTok connected under Robert control/i,
  );
  assert.equal(
    parsed.proofLinks.lanes["meme-radar:tiktok"].accountOwnershipProofUrl,
    "https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing",
  );
  assert.doesNotMatch(JSON.stringify(parsed), /realPublishEnabled\s*[:=]\s*true|video\.publish|access_token|password=/i);
});

test("TikTok MVP proof links parser blocks Metricool ownership reuse without explicit confirmation notes", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "SPORT Metricool connected proof https://app.metricool.com/planner/sports-daily-tiktok-proof",
    "memes Metricool connected proof https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing",
  ].join("\n"));

  assert.equal(parsed.status, "needs_review");
  assert.equal(parsed.realPublishEnabled, false);
  assert.equal(parsed.proofLinksPreview.readyForProofDrop, false);
  assert.match(parsed.issues.join("\n"), /add accountNotes confirming the Metricool or concrete Drive file\/folder\/Docs proof shows this TikTok profile under Robert control/i);
  assert.match(parsed.proofLinksPreview.issues.join("\n"), /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/i);
  assert.doesNotMatch(JSON.stringify(parsed), /realPublishEnabled\s*[:=]\s*true|video\.publish|access_token|password=/i);
});

test("TikTok MVP proof links recommended packet stays blocked until Robert writes confirmation notes", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "sports-daily:tiktok.metricoolConnectionProofUrl=https://app.metricool.com/planner/sports-daily-tiktok-proof",
    "sports-daily:tiktok.accountNotes=<write a real 20+ character note after reviewing SPORT ownership/control proof>",
    "meme-radar:tiktok.metricoolConnectionProofUrl=https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing",
    "meme-radar:tiktok.accountNotes=<write a real 20+ character note after reviewing memes ownership/control proof>",
  ].join("\n"));

  assert.equal(parsed.status, "needs_review");
  assert.equal(parsed.realPublishEnabled, false);
  assert.equal(parsed.proofLinksPreview.readyForProofDrop, false);
  assert.equal(
    parsed.proofLinks.lanes["sports-daily:tiktok"].accountNotes,
    "<write a real 20+ character note after reviewing SPORT ownership/control proof>",
  );
  assert.match(parsed.issues.join("\n"), /add accountNotes confirming the Metricool or concrete Drive file\/folder\/Docs proof shows this TikTok profile under Robert control/i);
  assert.match(parsed.proofLinksPreview.issues.join("\n"), /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/i);
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.nextSafeButton, "preview_proof_links");
  assert.doesNotMatch(JSON.stringify(parsed), /realPublishEnabled\s*[:=]\s*true|video\.publish|access_token|password=/i);
});

test("TikTok MVP proof links parser blocks explicit same-URL reuse with generic ownership notes", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "sports-daily:tiktok.accountOwnershipProofUrl=https://drive.google.com/folderview?id=sports-daily-tiktok-proof-folder&utm_source=copy#ownership",
    "sports-daily:tiktok.metricoolConnectionProofUrl=https://drive.google.com/drive/u/0/folders/sports-daily-tiktok-proof-folder?usp=sharing",
    "sports-daily:tiktok.accountNotes=Sports Daily TikTok ownership and 2FA security proof verified by Robert without secrets.",
    "sports-daily:tiktok.metricoolNotes=SPORT TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
    "meme-radar:tiktok.accountOwnershipProofUrl=https://docs.google.com/spreadsheets/d/meme-radar-metricool-connected-proof/edit/?usp=sharing#ownership",
    "meme-radar:tiktok.metricoolConnectionProofUrl=https://docs.google.com/spreadsheets/d/meme-radar-metricool-connected-proof/preview",
    "meme-radar:tiktok.accountNotes=Meme Radar ownership proof confirmed by Robert without secrets.",
    "meme-radar:tiktok.metricoolNotes=memes TikTok profile connected in Metricool approval_required mode with proof reviewed by Robert.",
  ].join("\n"));

  assert.equal(parsed.status, "needs_review");
  assert.equal(parsed.proofLinksPreview.readyForProofDrop, false);
  assert.match(parsed.issues.join("\n"), /add accountNotes confirming the Metricool or concrete Drive file\/folder\/Docs proof shows this TikTok profile under Robert control/i);
  assert.match(parsed.proofLinksPreview.issues.join("\n"), /accountNotes must confirm this Metricool or concrete Drive file\/folder\/Docs proof shows the TikTok profile under Robert control/i);
  assert.doesNotMatch(JSON.stringify(parsed), /realPublishEnabled\s*[:=]\s*true|video\.publish|access_token|password=/i);
});

test("TikTok MVP proof links parser names Drive or Docs as valid Metricool evidence", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "SPORT proof https://drive.google.com/file/d/sports-daily-proof/view",
    "memes proof https://example.com/not-valid",
  ].join("\n"));

  assert.equal(parsed.status, "needs_review");
  assert.match(parsed.issues.join("\n"), /concrete Google Drive file\/folder or Docs connection proof URL/);
  assert.equal(parsed.realPublishEnabled, false);
});

test("TikTok MVP proof links parser blocks secret-bearing paste text", () => {
  const parsed = extractClipperTikTokMvpProofLinksPaste([
    "sports-daily:tiktok.accountOwnershipProofUrl=https://drive.google.com/file/d/sports-daily-tiktok-proof/view?token=abc123",
    "sports-daily:tiktok.metricoolConnectionProofUrl=https://app.metricool.com/planner/sports-daily-tiktok-proof",
    "meme-radar:tiktok.accountOwnershipProofUrl=https://drive.google.com/file/d/meme-radar-tiktok-proof/view",
    "meme-radar:tiktok.metricoolConnectionProofUrl=https://app.metricool.com/planner/meme-radar-tiktok-proof",
  ].join("\n"));

  assert.equal(parsed.status, "needs_review");
  assert.match(parsed.issues.join("\n"), /passwords, tokens, cookies, keys, or recovery codes/i);
  assert.equal(parsed.proofLinksPreview.readyForProofDrop, false);
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.status, "blocked_proof_actions");
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.nextSafeButton, "preview_proof_links");
  assert.equal(parsed.proofLinksPreview.goalBoardImpact.nextLockedButton, "save_proof_links");

  const nestedSecret = extractClipperTikTokMvpProofLinksPaste([
    "SPORT Metricool connected proof https://app.metricool.com/planner/sports-daily-tiktok-proof",
    "memes Metricool connected proof https://app.metricool.com/planner/meme-radar-tiktok-proof",
    "operator_notes=api_key=neverpaste-this-value",
  ].join("\n"));
  assert.equal(nestedSecret.status, "needs_review");
  assert.match(nestedSecret.issues.join("\n"), /passwords, tokens, cookies, keys, or recovery codes/i);
  assert.equal(nestedSecret.proofLinksPreview.readyForProofDrop, false);
});

test("TikTok MVP proof links audit rejects placeholders and non-Metricool proof domains", () => {
  const proofLinks = {
    lanes: {
      ...cleanProofLinks.lanes,
      "meme-radar:tiktok": {
        ...cleanProofLinks.lanes["meme-radar:tiktok"],
        metricoolConnectionProofUrl: "https://example.com/not-metricool-proof",
      },
    },
  };

  assert.equal(validateClipperTikTokMvpProofLinks(proofLinks), "");
  assert.equal(safeClipperMetricoolProofUrl("https://example.com/not-metricool-proof"), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl("https://example.com/not-metricool-proof"), false);
  const audit = auditClipperTikTokMvpProofLinks(proofLinks);
  assert.equal(audit.status, "blocked");
  assert.equal(audit.realPublishEnabled, false);
  assert.equal(audit.goalBoardImpact.status, "blocked_proof_actions");
  assert.ok(audit.goalBoardImpact.readyProofFields < audit.goalBoardImpact.totalProofFields);
  assert.match(audit.issues.join("\n"), /metricoolConnectionProofUrl must be a real HTTPS metricool\.com URL or concrete Google Drive file\/folder or Docs evidence URL/);
});

test("TikTok MVP proof links audit rejects generic Metricool pages as proof", () => {
  for (const metricoolConnectionProofUrl of [
    "https://metricool.com/",
    "https://app.metricool.com/",
    "https://app.metricool.com/login",
    "https://app.metricool.com/dashboard",
    "https://app.metricool.com/settings",
    "https://app.metricool.com/calendar",
    "https://metricool.com/pricing",
    "https://metricool.com/integrations",
    "https://metricool.com/resources",
  ]) {
    const proofLinks = {
      lanes: {
        ...cleanProofLinks.lanes,
        "sports-daily:tiktok": {
          ...cleanProofLinks.lanes["sports-daily:tiktok"],
          metricoolConnectionProofUrl,
        },
      },
    };

    assert.equal(
      safeClipperMetricoolProofUrl(metricoolConnectionProofUrl),
      false,
      `${metricoolConnectionProofUrl} should not count as concrete Metricool proof`,
    );
    assert.equal(
      safeClipperMetricoolConnectionProofUrl(metricoolConnectionProofUrl),
      false,
      `${metricoolConnectionProofUrl} should not count as concrete connection proof`,
    );
    const audit = auditClipperTikTokMvpProofLinks(proofLinks);
    assert.equal(audit.status, "blocked", `${metricoolConnectionProofUrl} should keep the proof gate blocked`);
    assert.match(audit.issues.join("\n"), /metricoolConnectionProofUrl must be a real HTTPS metricool\.com URL or concrete Google Drive file\/folder or Docs evidence URL/);
  }

  assert.equal(safeClipperMetricoolProofUrl("https://app.metricool.com/planner/sports-daily-tiktok-proof"), true);
  assert.equal(safeClipperMetricoolProofUrl("https://app.metricool.com/brands/6431687"), true);
});

test("TikTok MVP proof links audit accepts Google Drive Metricool screenshots as non-secret evidence", () => {
  const proofLinks = {
    lanes: {
      ...cleanProofLinks.lanes,
      "sports-daily:tiktok": {
        ...cleanProofLinks.lanes["sports-daily:tiktok"],
        metricoolConnectionProofUrl: "https://drive.google.com/file/d/sports-daily-metricool-connected-screenshot/view?usp=sharing",
        metricoolNotes: "Metricool screenshot proof shows SPORT TikTok profile connected in approval_required mode.",
      },
      "meme-radar:tiktok": {
        ...cleanProofLinks.lanes["meme-radar:tiktok"],
        metricoolConnectionProofUrl: "https://docs.google.com/document/d/meme-radar-metricool-connected-proof/edit?usp=sharing",
        metricoolNotes: "Metricool proof document shows memes TikTok profile connected without sharing secrets.",
      },
    },
  };

  assert.equal(safeClipperMetricoolProofUrl(proofLinks.lanes["sports-daily:tiktok"].metricoolConnectionProofUrl), false);
  assert.equal(safeClipperMetricoolConnectionProofUrl(proofLinks.lanes["sports-daily:tiktok"].metricoolConnectionProofUrl), true);
  assert.equal(safeClipperMetricoolConnectionProofUrl(proofLinks.lanes["meme-radar:tiktok"].metricoolConnectionProofUrl), true);
  const audit = auditClipperTikTokMvpProofLinks(proofLinks);
  assert.equal(audit.status, "ready_for_proof_drop");
  assert.equal(audit.readyForProofDrop, true);
  assert.equal(audit.realPublishEnabled, false);
});

test("TikTok MVP proof links JSON starter stays blocked until real proof URLs are filled", () => {
  const starter = {
    lanes: {
      "sports-daily:tiktok": {
        accountOwnershipProofUrl: "",
        metricoolConnectionProofUrl: "",
        accountNotes: "Sports Daily Clips TikTok ownership and 2FA/security proof verified by Robert without secrets.",
        metricoolNotes: "SPORT Metricool connection to @sportsdaily verified by Robert without secrets.",
      },
      "meme-radar:tiktok": {
        accountOwnershipProofUrl: "",
        metricoolConnectionProofUrl: "",
        accountNotes: "Meme Radar TikTok ownership and 2FA/security proof verified by Robert without secrets.",
        metricoolNotes: "memes Metricool connection to @memeradar verified by Robert without secrets.",
      },
    },
  };

  assert.equal(validateClipperTikTokMvpProofLinks(starter), "");
  const audit = auditClipperTikTokMvpProofLinks(starter);
  assert.equal(audit.status, "blocked");
  assert.equal(audit.readyForProofDrop, false);
  assert.equal(audit.realPublishEnabled, false);
  assert.equal(audit.directSocialApisRequired, false);
  assert.equal(audit.goalBoardImpact.status, "blocked_proof_actions");
  assert.equal(audit.goalBoardImpact.readyProofFields, 4);
  assert.equal(audit.goalBoardImpact.totalProofFields, 8);
  assert.equal(audit.goalBoardImpact.nextSafeButton, "preview_proof_links");
  assert.equal(audit.goalBoardImpact.nextLockedButton, "save_proof_links");
  assert.deepEqual(audit.goalBoardImpact.unlocksOperatorActions, []);
  assert.match(audit.issues.join("\n"), /accountOwnershipProofUrl must be a real safe HTTPS proof URL/);
  assert.match(audit.issues.join("\n"), /metricoolConnectionProofUrl must be a real HTTPS metricool\.com URL or concrete Google Drive file\/folder or Docs evidence URL/);
  assert.doesNotMatch(JSON.stringify(audit), /"readyToSend"\s*:\s*true|realPublishEnabled\s*[:=]\s*true|video\.publish|autopublish/i);
});

test("TikTok MVP proof links validator rejects secrets anywhere in JSON", () => {
  const proofLinks = {
    lanes: {
      ...cleanProofLinks.lanes,
      "sports-daily:tiktok": {
        ...cleanProofLinks.lanes["sports-daily:tiktok"],
        accountNotes: "Sports Daily ownership proof password=neverpaste verified by Robert.",
      },
    },
  };

  assert.match(validateClipperTikTokMvpProofLinks(proofLinks), /cannot contain passwords, tokens, cookies, keys, or recovery codes/);
});

test("TikTok MVP proof links validator rejects JSON-style credential fields", () => {
  for (const [field, value] of [
    ["password", "never-paste-this"],
    ["api_key", "metricool-key"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
  ]) {
    const proofLinks = {
      lanes: {
        ...cleanProofLinks.lanes,
        "sports-daily:tiktok": {
          ...cleanProofLinks.lanes["sports-daily:tiktok"],
          accountNotes: "Sports Daily ownership proof verified by Robert with safe notes.",
          [field]: value,
        },
      },
    };

    assert.match(
      validateClipperTikTokMvpProofLinks(proofLinks),
      /cannot contain passwords, tokens, cookies, keys, or recovery codes/,
      `${field} should be blocked`,
    );
  }
});
