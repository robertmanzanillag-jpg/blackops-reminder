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
  assert.match(audit.issues.join("\n"), /metricoolConnectionProofUrl must be a real HTTPS metricool\.com URL or Google Drive\/Docs evidence URL/);
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
