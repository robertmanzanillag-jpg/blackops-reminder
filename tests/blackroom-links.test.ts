import assert from "node:assert/strict";
import test from "node:test";
import { deactivateBlackRoomLink } from "../server/blackroom-links";

test("deactivateBlackRoomLink soft-disables bio link and builder element without DELETE", async () => {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: any, init: any = {}) => {
    const method = init.method || "GET";
    calls.push({
      url: String(url),
      method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (String(url).endsWith("/api/admin/link-stats")) {
      return new Response(JSON.stringify({
        links: [
          { id: 10, title: "Old Party", url: "https://tickets.example/old", is_active: true },
        ],
        totals: {},
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (String(url).endsWith("/api/admin/bio-elements")) {
      return new Response(JSON.stringify([
        { id: 20, element_type: "link", title: "Old Party", url: "https://tickets.example/old", is_active: true },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await deactivateBlackRoomLink({ title: "Old Party" });

    assert.equal(result.action, "deactivated");
    assert.equal(result.preservedData, true);
    assert.equal(calls.some((call) => call.method === "DELETE"), false);
    assert.ok(calls.some((call) =>
      call.url.endsWith("/api/admin/bio-links/10") &&
      call.method === "PUT" &&
      call.body?.is_active === false
    ));
    assert.ok(calls.some((call) =>
      call.url.endsWith("/api/admin/bio-elements/20") &&
      call.method === "PUT" &&
      call.body?.is_active === false
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
