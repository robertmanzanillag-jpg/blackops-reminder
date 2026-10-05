import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  renderClipperAppReviewDemoHtml,
  renderClipperPrivacyPolicyHtml,
  renderClipperTermsOfServiceHtml,
} from "../server/clippers-agent";

test("YouTube privacy policy identifies API use and gives users data controls", () => {
  const html = renderClipperPrivacyPolicyHtml();

  assert.match(html, /uses YouTube API Services/i);
  assert.match(html, /upload permission and read-only channel access/i);
  assert.match(html, /Information Accessed, Collected, And Stored/i);
  assert.match(html, /within 7 calendar days/i);
  assert.match(html, /no later than 30 calendar days/i);
  assert.match(html, /Deleting data from Clippers does not delete/i);
  assert.match(html, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(html, /https:\/\/myaccount\.google\.com\/permissions/);
  assert.match(html, /https:\/\/security\.google\.com\/settings\/security\/permissions/);
  assert.match(html, /mailto:robert\.manzanillag@gmail\.com/i);
  assert.match(html, /privacy, access, revocation, or deletion requests/i);
  assert.doesNotMatch(html, /Audit blocker.*public privacy contact/is);
  assert.doesNotMatch(html, /client_secret|refresh_token|access_token/i);
});

test("YouTube terms link the controlling policies and prohibit unauthorized use", () => {
  const html = renderClipperTermsOfServiceHtml();

  assert.match(html, /https:\/\/www\.youtube\.com\/t\/terms/);
  assert.match(html, /api-services-terms-of-service/);
  assert.match(html, /developer-policies/);
  assert.match(html, /required-minimum-functionality/);
  assert.match(html, /owner or an expressly authorized operator/i);
  assert.match(html, /review and agree to the Clippers Privacy Policy and these Terms/i);
  assert.match(html, /must not be used to scrape or download restricted YouTube content/i);
  assert.match(html, /does not claim that Google or YouTube has approved/i);
});

test("review demo explains the owner-only upload flow without claiming approval", () => {
  const html = renderClipperAppReviewDemoHtml();

  assert.match(html, /internal, owner-only uploader/i);
  assert.match(html, /no public signup or delegated end-user uploader/i);
  assert.match(html, /upload and read-only channel scopes/i);
  assert.match(html, /title \(up to 100 characters\)/i);
  assert.match(html, /owner-approved batch manifest/i);
  assert.match(html, /visibility or future schedule/i);
  assert.match(html, /https:\/\/studio\.youtube\.com\//);
  assert.match(html, /does not claim Google or YouTube approval/i);
  assert.match(html, /Public Policy Links/i);
  assert.match(html, /https:\/\/policies\.google\.com\/privacy/);
  assert.match(html, /https:\/\/myaccount\.google\.com\/permissions/);
  assert.doesNotMatch(html, /client_secret|refresh_token|access_token/i);
});

test("early public routes in server index carry the same required compliance links", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");

  for (const required of [
    "YouTube API Services",
    "https://policies.google.com/privacy",
    "https://myaccount.google.com/permissions",
    "https://security.google.com/settings/security/permissions",
    "https://www.youtube.com/t/terms",
    "https://developers.google.com/youtube/terms/api-services-terms-of-service",
    "https://developers.google.com/youtube/terms/developer-policies",
    "no later than 30 calendar days",
    "within 7 calendar days",
    "https://studio.youtube.com/",
    "does not claim Google or YouTube approval",
  ]) {
    assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /mailto:robert\.manzanillag@gmail\.com/i);
  assert.doesNotMatch(source, /Audit blocker.*public privacy contact/is);
  assert.doesNotMatch(source, /blackops@reminder\.app/i);
  assert.doesNotMatch(source, /Tokens are encrypted server-side/i);
});

test("public review route uses the exact app name and identifies the owner-only homepage", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  const route = source.match(
    /app\.get\("\/clippers\/review-demo"[\s\S]*?\n\}\);/,
  )?.[0];

  assert.ok(route, "expected the public review route to exist");
  assert.match(route, /<title>Clippers Creator Autopilot<\/title>/);
  assert.match(route, /<h1>Clippers Creator Autopilot<\/h1>/);
  assert.match(route, /public home of Clippers Creator Autopilot/i);
  assert.match(route, /owner-only YouTube uploader/i);
  assert.match(route, /no public signup or login/i);
  assert.match(route, /Public home, no login required/i);
  assert.doesNotMatch(route, /<title>Clippers App Review Demo<\/title>/);
});

test("Google Search Console verification route returns the exact public file contract", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  const route = source.match(
    /app\.get\("\/google057a15d5c243008e\.html"[\s\S]*?\n\}\);/,
  )?.[0];

  assert.ok(route, "expected the Google verification route to exist");
  assert.match(route, /\.status\(200\)/);
  assert.match(route, /\.type\("text\/plain"\)/);
  assert.match(
    route,
    /\.send\("google-site-verification: google057a15d5c243008e\.html"\)/,
  );
});
