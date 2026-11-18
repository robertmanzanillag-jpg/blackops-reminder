import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { assertCeoActionActive, assertCeoOrderActive, ceoDomainRouteGuard, ceoFocusContext, ceoFocusIntegrations, pausedCeoDomains } from "../server/ceo-domain-policy";
import { companyOrderJob, createCompanyOrderDiscovery, ASISTENTE_REPOSITORY } from "../server/software-factory-company";
import * as dropshipping from "../server/dropshipping-ceo";
import * as revenue from "../server/revenue-engine";
import type { CompanyOrder } from "../shared/agent-company";
import type { FactoryProject } from "../server/software-factory";

test("owner focus pause holds API and direct commercial work while maintenance stays available", async () => {
  const previous = process.env.CEO_PAUSED_DOMAINS;
  process.env.CEO_PAUSED_DOMAINS = "websites,dropshipping";
  try {
    assert.deepEqual(pausedCeoDomains({ CEO_PAUSED_DOMAINS: "websites,clippers,factory,websites,dropshipping" }), ["websites", "dropshipping"]);
    assert.match(ceoFocusContext(), /fábrica de software, academia/);
    assert.match(ceoFocusContext(), /News.*clips/);
    assert.equal(ceoFocusIntegrations({}).revenue.mode, "pausada");
    assert.equal(ceoFocusIntegrations({}).dropshipping.mode, "pausada");
    assert.equal(ceoFocusIntegrations({})["clippers"], undefined);
    assert.equal(dropshipping.getDropshippingCeoSnapshot().operatingPause.paused, true);
    assert.equal(revenue.getRevenueEngineSnapshot().operatingPause.paused, true);
    const app = express(); let mutations = 0;
    app.use(ceoDomainRouteGuard);
    app.get(["/api/revenue-engine", "/api/dropshipping-ceo/status"], (_req, res) => res.json({ readable: true }));
    app.post(["/api/revenue-engine/scout-dispatch", "/api/dropshipping-ceo/operating-cycle", "/api/software-factory/enqueue", "/api/clippers/run", "/api/academy/run", "/api/kong-repairs"], (_req, res) => { mutations++; res.json({ allowed: true }); });
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      for (const route of ["/api/revenue-engine", "/api/dropshipping-ceo/status", "/API/REVENUE-ENGINE"]) {
        assert.equal((await fetch(base + route)).status, 200);
        assert.equal((await fetch(base + route, { method: "HEAD" })).status, 200);
      }
      for (const route of ["/api/revenue-engine/scout-dispatch", "/api/dropshipping-ceo/operating-cycle", "/API/REVENUE-ENGINE/scout-dispatch", "/API/DROPSHIPPING-CEO/operating-cycle"]) {
        const response = await fetch(base + route, { method: "POST" }); assert.equal(response.status, 423);
        const body = await response.json(); assert.equal(body.error, "CEO_DOMAIN_PAUSED"); assert.equal(body.queueDisposition, "held_not_deleted");
      }
      assert.equal(mutations, 0);
      for (const route of ["/api/software-factory/enqueue", "/api/clippers/run", "/api/academy/run", "/api/kong-repairs"]) assert.equal((await fetch(base + route, { method: "POST" })).status, 200);
      assert.equal(mutations, 4);
    } finally { server.close(); await once(server, "close"); }

    // Invalid inputs would fail parsing; the owner pause must run even earlier,
    // before any disk writes, provider, outreach or queue acknowledgement.
    for (const operation of [
      dropshipping.runDropshippingDailyOperatingCycle, dropshipping.runDropshippingAutopilotProductHunter,
      dropshipping.prepareDropshippingLaunchPackApprovalQueue, dropshipping.markDropshippingApprovalOutboxQueued,
      dropshipping.researchDropshippingProduct, dropshipping.buildDropshippingLaunchPlan,
      revenue.runRevenueScoutDispatch, revenue.runRevenueMoneySprint, revenue.buildRevenueMockup,
      revenue.createWebsiteDeliveryWorkspaceFromLead, revenue.recordRevenueSalesAutopilot,
      revenue.deliverRevenueDeliveryWorkspaceFromTrustedApproval,
    ]) assert.throws(() => (operation as (input: unknown) => unknown)(undefined), /CEO_DOMAIN_PAUSED/);
    await assert.rejects(dropshipping.createDropshippingShopifyDraft(undefined as never), /CEO_DOMAIN_PAUSED/);
    await assert.rejects(dropshipping.publishDropshippingSocialPost(undefined as never), /CEO_DOMAIN_PAUSED/);
    await assert.rejects(revenue.sendRevenueOutreachDraft(undefined as never), /CEO_DOMAIN_PAUSED/);

    const queued = { actionType: "dropshipping.create_shopify_draft", input: { approved: true, CEO_PAUSED_DOMAINS: "" }, status: "approved" };
    const before = structuredClone(queued);
    assert.throws(() => assertCeoActionActive(queued), /CEO_DOMAIN_PAUSED/);
    assert.deepEqual(queued, before);
    assert.throws(() => assertCeoActionActive({ actionType: "automation.manual_run", metadata: { key: "dropshipping-ceo-daily-operating-cycle" } }), /CEO_DOMAIN_PAUSED/);
    assert.doesNotThrow(() => assertCeoActionActive({ actionType: "clippers.run" }));

    const maintenance: CompanyOrder = { id: "existing", text: "Arregla el error de búsqueda de nuestra web existente", createdAt: "2026-11-18T12:00:00Z", assignees: [{ agentId: "code", status: "en_curso", note: "" }] };
    const commercial = { ...maintenance, text: "Crea una nueva página para vender websites", assignees: [...maintenance.assignees, { agentId: "revenue", status: "en_curso" as const, note: "" }] };
    const project = { id: "asistente", repo: ASISTENTE_REPOSITORY } as FactoryProject;
    assert.doesNotThrow(() => assertCeoOrderActive(maintenance));
    assert.doesNotThrow(() => companyOrderJob(maintenance, project, 1));
    for (const text of ["Crear una página nueva para analíticas de Clippers", "Crear una página nueva para la academia", "create new cache layer for KONG website"]) {
      assert.doesNotThrow(() => assertCeoOrderActive({ ...maintenance, text }));
    }
    for (const agentId of ["revenue", "dropshipping"]) assert.throws(() => assertCeoOrderActive({ ...maintenance, assignees: [{ agentId, status: "en_curso", note: "" }] }), /CEO_DOMAIN_PAUSED/);
    assert.throws(() => companyOrderJob(commercial, project, 1), /CEO_DOMAIN_PAUSED/);
    let downstreamCalls = 0;
    // Existing queued factory source re-checks the owner pause before head reads or model inspection.
    const discovery = createCompanyOrderDiscovery({ readMainOrder: async () => commercial, resolveHead: async () => { downstreamCalls++; return "a".repeat(40); }, inspectOrder: async () => { downstreamCalls++; return undefined; } });
    await assert.rejects(discovery(project, { signal: new AbortController().signal, maxCostCents: 1, source: { companyOrder: { version: 1, company: "main", orderId: commercial.id, revision: "old-approved" } } }), /CEO_DOMAIN_PAUSED/);
    assert.equal(downstreamCalls, 0);
    assert.equal(commercial.assignees[0].status, "en_curso");

    // Reversible owner control; queued records need no deletion or recreation.
    process.env.CEO_PAUSED_DOMAINS = "";
    assert.equal(ceoFocusContext(), "");
    assert.doesNotThrow(() => assertCeoActionActive(queued));
    assert.doesNotThrow(() => companyOrderJob(commercial, project, 1));
  } finally {
    if (previous === undefined) delete process.env.CEO_PAUSED_DOMAINS; else process.env.CEO_PAUSED_DOMAINS = previous;
  }
});
