import { createHash, randomBytes } from "node:crypto";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function createOAuthState(): string {
  return randomBytes(48).toString("base64url");
}

export function digestOAuthState(state: string): string {
  if (!BASE64URL.test(state) || state.length !== 64) throw new Error("Invalid OAuth state");
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function createPkceVerifier(): string {
  const verifier = randomBytes(64).toString("base64url");
  if (verifier.length < 43 || verifier.length > 128) throw new Error("Invalid PKCE verifier length");
  return verifier;
}

export function createPkceChallenge(verifier: string): string {
  if (!BASE64URL.test(verifier) || verifier.length < 43 || verifier.length > 128) {
    throw new Error("Invalid PKCE verifier");
  }
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
