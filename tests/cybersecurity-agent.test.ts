import assert from "node:assert/strict";
import test from "node:test";
import type { AppProject } from "@shared/schema";
import { analyzeAppProject } from "../server/cybersecurity-agent";

function appProject(overrides: Partial<AppProject> = {}): AppProject {
  return {
    id: "app-1",
    userId: "user-1",
    name: "Kong Nightlife",
    slug: "kong-nightlife",
    description: "Nightlife production app",
    environment: "production",
    publicUrl: "https://kong.example",
    healthUrl: "https://kong.example/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "kong-nightlife",
    githubRepo: "robertmanzanillag-jpg/kong-nightlife",
    deploymentProvider: "replit",
    deploymentId: null,
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    status: "healthy",
    priority: "high",
    ownerLabel: "Robert",
    tags: null,
    lastSeenAt: null,
    createdAt: new Date("2026-06-18T12:00:00.000Z"),
    updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    ...overrides,
  };
}

test("flags high-priority production apps missing public and health URLs", () => {
  const threats = analyzeAppProject(appProject({ publicUrl: null, healthUrl: null }), []);

  assert.equal(threats.some((threat) => threat.title === "App importante sin URL pública"), true);
  assert.equal(threats.some((threat) => threat.title === "App importante sin health URL"), true);
  assert.equal(threats.filter((threat) => threat.signal === "coverage").length, 2);
});

test("does not flag complete high-priority production apps for coverage", () => {
  const threats = analyzeAppProject(appProject(), []);

  assert.equal(threats.some((threat) => threat.signal === "coverage"), false);
});

test("keeps down critical apps at critical severity", () => {
  const threats = analyzeAppProject(appProject({ status: "down", priority: "critical" }), []);
  const uptimeThreat = threats.find((threat) => threat.signal === "uptime");

  assert.equal(uptimeThreat?.severity, "critical");
});
