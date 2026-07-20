import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mediaStudioCoreApi } from "../client/src/features/ai-media-studio/core/api.ts";
import { completeAssetDelivery } from "../client/src/features/ai-media-studio/core/asset-delivery.ts";

test("asset delivery API requests a fresh authenticated link without using a listed URL", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ url: "https://owned.example/signed", expiresAt: "2030-01-01T00:00:00.000Z" }), { status: 200 });
  }) as typeof fetch;
  try {
    const delivery = await mediaStudioCoreApi.createAssetDelivery("asset/id");
    assert.deepEqual(delivery, { url: "https://owned.example/signed", expiresAt: "2030-01-01T00:00:00.000Z" });
    assert.equal(request?.url, "/api/ai-media-studio/media-assets/asset%2Fid/delivery");
    assert.equal(request?.init?.method, "POST");
    assert.equal(request?.init?.credentials, "include");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("media library uses per-asset on-demand delivery and fail-safe states", async () => {
  const source = await readFile("client/src/features/ai-media-studio/core/media-library.tsx", "utf8");
  const control = await readFile("client/src/features/ai-media-studio/core/asset-delivery-control.tsx", "utf8");
  const delivery = await readFile("client/src/features/ai-media-studio/core/asset-delivery.ts", "utf8");
  assert.match(source, /available=\{asset\.status === "ready"\}/);
  assert.match(control, /Creating secure link/);
  assert.match(control, /Retry \$\{label\.toLowerCase\(\)\}/);
  assert.match(delivery, /expiration <= now/);
  assert.match(control, /aria-live="polite"/);
  assert.match(control, /const descriptionId = useId\(\)/);
  assert.match(control, /aria-describedby=\{descriptionId\}/);
  assert.match(control, /id=\{descriptionId\}/);
  assert.doesNotMatch(control, /asset-delivery-\$\{assetId\}/);
  assert.match(control, /motion-reduce:animate-none/);
  assert.match(control, /inFlight\.current/);
  assert.match(control, /window\.open\("about:blank", "_blank"\)/);
  assert.doesNotMatch(source, /href=\{asset\.deliveryUrl\}/);
});

test("failed delivery closes the pending window without navigating it", async () => {
  let replacements = 0;
  let closes = 0;
  const pendingWindow = {
    closed: false,
    close: () => { closes += 1; },
    location: { replace: () => { replacements += 1; } },
  };
  await assert.rejects(() => completeAssetDelivery({
    request: async () => { throw new Error("delivery unavailable"); },
    pendingWindow,
    origin: "https://kong.example",
  }), /delivery unavailable/);
  assert.equal(replacements, 0);
  assert.equal(closes, 1);
});

test("expired or unsafe delivery responses are never assigned to the pending window", async () => {
  for (const response of [
    { url: "https://owned.example/signed", expiresAt: "2020-01-01T00:00:00.000Z" },
    { url: "http://owned.example/signed", expiresAt: "2030-01-01T00:00:00.000Z" },
    { url: "javascript:alert(1)", expiresAt: "2030-01-01T00:00:00.000Z" },
  ]) {
    let replacements = 0;
    let closes = 0;
    await assert.rejects(() => completeAssetDelivery({
      request: async () => response,
      pendingWindow: {
        closed: false,
        close: () => { closes += 1; },
        location: { replace: () => { replacements += 1; } },
      },
      origin: "https://kong.example",
      now: Date.parse("2025-01-01T00:00:00.000Z"),
    }), /invalid or expired/);
    assert.equal(replacements, 0);
    assert.equal(closes, 1);
  }
});

test("completed jobs use the canonical asset id and never a public provider URL", async () => {
  const source = await readFile("client/src/features/ai-media-studio/job-list.tsx", "utf8");
  assert.match(source, /assetId=\{job\.asset\.id\}/);
  assert.match(source, /label="Open video"/);
  assert.doesNotMatch(source, /job\.asset\.url|href=\{job\.asset/);
});
