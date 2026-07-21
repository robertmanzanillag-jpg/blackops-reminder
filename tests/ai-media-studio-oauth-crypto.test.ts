import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthState, createPkceChallenge, createPkceVerifier, digestOAuthState } from "../server/ai-media-studio/oauth/crypto";

test("OAuth state uses 48 random bytes and persists only a deterministic SHA-256 digest", () => {
  const first = createOAuthState();
  const second = createOAuthState();
  assert.match(first, /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(first, second);
  assert.match(digestOAuthState(first), /^[0-9a-f]{64}$/);
  assert.notEqual(digestOAuthState(first), first);
  assert.throws(() => digestOAuthState("not-valid"), /Invalid OAuth state/);
});

test("PKCE verifier is RFC 7636 length and S256 challenge is base64url SHA-256", () => {
  const verifier = createPkceVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(createPkceChallenge(verifier), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    createPkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  assert.throws(() => createPkceChallenge("short"), /Invalid PKCE verifier/);
});
