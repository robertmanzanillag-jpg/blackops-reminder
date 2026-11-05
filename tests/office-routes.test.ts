import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { randomUUID } from "node:crypto";
import { registerOfficeRoutes } from "../server/office-routes";
import { createSignedLocalAuthCookieValue } from "../server/user-context";

test("execution HTTP endpoints require authenticated owner, origin, and strict task data", async t => {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", DEFAULT_USER_ID: "office-owner", SESSION_SECRET: "office-test-only-signing-secret", ALLOW_DEV_USER_FALLBACK: "true" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const app = express(); app.use(express.json());
  let submissions = 0;
  let directoryReads = 0;
  registerOfficeRoutes(app, { runtime: {
    list: async () => [],
    submit: async (_owner, task: any) => { submissions++; return { id: "accepted-id", ...task, status: "accepted", createdAt: new Date().toISOString() } as any; },
  }, directoryReader: async () => { directoryReads++; return [{ id: "buenos-aires", name: "Buenos Aires", countryCode: "AR", timeZone: "America/Argentina/Buenos_Aires", currency: "ARS" }]; } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.PUBLIC_APP_URL = base;
  const cookie = (id: string) => `blackops.uid=${createSignedLocalAuthCookieValue(id)}`;
  const task = { kind: "claude_chat", key: randomUUID(), message: "Hello" };
  assert.equal((await fetch(`${base}/api/agents-office/cities`)).status, 401);
  assert.equal(directoryReads, 0);
  const directoryResponse = await fetch(`${base}/api/agents-office/cities`, { headers: { cookie: cookie("office-owner") } });
  assert.equal(directoryResponse.status, 200);
  assert.equal((await directoryResponse.json())[0].id, "buenos-aires");
  const post = (headers: Record<string,string>, body: unknown = task) => fetch(`${base}/api/agents-office/runs`, {
    method: "POST", headers: { "content-type": "application/json", origin: base, ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await fetch(`${base}/api/agents-office/runs`, { headers: { "x-user-id": "office-owner" } })).status, 401);
  assert.equal((await post({ "x-user-id": "office-owner" })).status, 401);
  assert.equal((await post({ cookie: cookie("someone-else") })).status, 403);
  assert.equal((await post({ cookie: cookie("office-owner"), origin: "https://untrusted.example" })).status, 403);
  assert.equal((await post({ cookie: cookie("office-owner"), origin: "" })).status, 403);
  assert.equal((await post({ cookie: cookie("office-owner") }, { ...task, command: "arbitrary-shell", sessionId: "forged" })).status, 400);
  assert.equal(submissions, 0);
  assert.equal((await post({ cookie: cookie("office-owner") })).status, 202);
  assert.equal(submissions, 1);
  assert.equal((await fetch(`${base}/api/agents-office/runs`, { headers: { cookie: cookie("office-owner") } })).headers.get("cache-control"), "no-store");
});
