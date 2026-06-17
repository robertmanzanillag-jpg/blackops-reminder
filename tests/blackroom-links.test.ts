import assert from "node:assert/strict";
import test from "node:test";
import { deactivateBlackRoomLink, formatBlackRoomLinkPerformance, getBlackRoomLinkPerformance } from "../server/blackroom-links";

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

test("getBlackRoomLinkPerformance ranks links by total clicks", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => new Response(JSON.stringify({
    totals: { total_clicks: 17, clicks_today: 3, clicks_week: 9 },
    links: [
      { id: 1, title: "Low", url: "https://example.com/low", clicks_today: 1, clicks_week: 2, clicks_month: 3, total_clicks: 4, is_active: true },
      { id: 2, title: "High", url: "https://example.com/high", clicks_today: 2, clicks_week: 7, clicks_month: 8, total_clicks: 13, is_active: false },
    ],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    const performance = await getBlackRoomLinkPerformance({ limit: 2 });

    assert.equal(performance.totals.total_clicks, 17);
    assert.equal(performance.links[0].title, "High");
    assert.equal(performance.links[0].isActive, false);
    assert.match(formatBlackRoomLinkPerformance(performance), /High \(desactivado\).*total 13/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
