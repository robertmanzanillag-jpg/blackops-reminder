import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFactoryPilotGitHubClient, createFactoryPilotGitHubSourceExporter, FACTORY_PILOT_REPOSITORY } from "../server/software-factory-github-client";
const scope = { owner: "robertmanzanillag-jpg", repo: "software-factory-pilot" };
const sha = "a".repeat(40), tree = "b".repeat(40), branch = `factory/${sha}-${"c".repeat(64)}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
test("constructs exact fixed-origin routes and sanitized request bodies", async () => {
    const calls: {
        url: string;
        init: RequestInit;
    }[] = [];
    const client = createFactoryPilotGitHubClient({ allowDispatch: true, request: async (url, init) => {
            calls.push({ url, init });
            assert.equal(init.redirect, "error");
            assert.ok(init.signal);
            assert.equal(new Headers(init.headers).has("Authorization"), false);
            if (url.includes("/dispatches"))
                return new Response(null, { status: 204 });
            if (url.includes("/git/ref/"))
                return json({ ref: `refs/heads/${branch}`, object: { type: "commit", sha } });
            if (url.includes("/contents/"))
                return json({ path: ".github/workflows/check.yml", type: "file", sha });
            return json({ sha, tree: { sha: tree }, parents: [], message: "base" });
        } });
    await client.git.getCommit({ ...scope, commit_sha: sha });
    await client.git.getRef({ ...scope, ref: `heads/${branch}` });
    await client.repos.getContent({ ...scope, path: ".github/workflows/check.yml", ref: sha });
    await client.actions.createWorkflowDispatch!({ ...scope, workflow_id: 9, ref: branch });
    assert.equal(calls[0].url, `https://api.github.com/repos/${FACTORY_PILOT_REPOSITORY}/git/commits/${sha}`);
    assert.equal(new Headers(calls[2].init.headers).get("Accept"), "application/vnd.github.object+json");
    assert.deepEqual(JSON.parse(String(calls[3].init.body)), { ref: branch });
    assert.ok(calls.every(c => c.url.startsWith(`https://api.github.com/repos/${FACTORY_PILOT_REPOSITORY}/`)));
});
test("rejects foreign repositories, mutable IDs, unsafe paths and default-branch writes before requests", async () => {
    let calls = 0;
    const client = createFactoryPilotGitHubClient({ request: async () => { calls++; return json({}); } });
    assert.equal(client.actions.createWorkflowDispatch, undefined);
    const actions = [() => client.repos.get({ ...scope, repo: "kong" }), () => client.git.getCommit({ ...scope, commit_sha: "main" }), () => client.repos.getContent({ ...scope, path: "../secret", ref: sha }), () => client.git.createRef({ ...scope, ref: "refs/heads/main", sha }), () => client.git.createRef({ ...scope, ref: "refs/tags/main", sha }), () => client.git.createTree({ ...scope, base_tree: sha, tree: [{ path: ".github/workflows/check.yml", sha, mode: "100644", type: "blob" }] }), () => client.git.createTree({ ...scope, base_tree: sha, tree: [{ path: "link", sha, mode: "120000", type: "blob" }] }), () => client.actions.listJobsForWorkflowRunAttempt({ ...scope, run_id: 1, attempt_number: 2, per_page: 100 }), () => client.pulls.create({ ...scope, head: branch, base: "main", draft: false as true, title: "x", body: "x" })];
    for (const action of actions)
        await assert.rejects(action, /INPUT_INVALID/);
    assert.equal(calls, 0);
});
test("HTTP missing-ref status is preserved but credentials and response bodies never escape", async () => {
    let calls = 0;
    const client = createFactoryPilotGitHubClient({ request: async () => { calls++; return new Response("sensitive credentials fixture", { status: 404 }); } });
    await assert.rejects(client.git.getRef({ ...scope, ref: `heads/${branch}` }), error => { assert.equal((error as any).status, 404); assert.equal((error as Error).message, "FACTORY_GITHUB_HTTP_FAILURE"); return true; });
    assert.equal(calls, 1);
    const failed = createFactoryPilotGitHubClient({ request: async () => { throw Error("sensitive transport fixture"); } });
    await assert.rejects(failed.git.getCommit({ ...scope, commit_sha: sha }), error => { assert.equal((error as Error).message, "FACTORY_GITHUB_REQUEST_UNCONFIRMED"); return true; });
});
test("oversized, malformed and mismatched responses fail closed", async () => {
    for (const response of [() => new Response("x".repeat(1025)), () => new Response("not JSON"), () => json({ sha: tree, tree: { sha: tree } })]) {
        const client = createFactoryPilotGitHubClient({ maxResponseBytes: 1024, request: async () => response() });
        await assert.rejects(client.git.getCommit({ ...scope, commit_sha: sha }));
    }
    const client = createFactoryPilotGitHubClient({ request: async () => json({ full_name: FACTORY_PILOT_REPOSITORY, private: true, archived: false, disabled: false, default_branch: "main" }) });
    await assert.rejects(client.repos.get(scope), /PUBLIC_PILOT_REQUIRED/);
});
test("timeout bounds a stalled response or body and never retries a mutation", async () => {
    for (const stalledBody of [false, true]) {
        let calls = 0;
        const client = createFactoryPilotGitHubClient({ allowDispatch: true, timeoutMs: 15, request: async () => { calls++; if (stalledBody)
                return new Response(new ReadableStream({ start() { } }), { status: 201 }); return new Promise<Response>(() => { }); } });
        await assert.rejects(client.git.createRef({ ...scope, ref: `refs/heads/${branch}`, sha }), /UNCONFIRMED/);
        assert.equal(calls, 1);
    }
});
test("publication endpoints only create candidate objects and draft PRs", async () => {
    const calls: {
        url: string;
        body: any;
    }[] = [];
    const client = createFactoryPilotGitHubClient({ request: async (url, init) => { const body = JSON.parse(String(init.body)); calls.push({ url, body }); if (url.endsWith("/git/refs"))
            return json({ ref: body.ref, object: { sha: body.sha, type: "commit" } }, 201); if (url.endsWith("/pulls"))
            return json({ number: 3 }, 201); return json({ sha }, 201); } });
    await client.git.createBlob({ ...scope, content: Buffer.from("hello").toString("base64"), encoding: "base64" });
    await client.git.createTree({ ...scope, base_tree: tree, tree: [{ path: "site/index.html", type: "blob", mode: "100644", sha }] });
    await client.git.createCommit({ ...scope, tree, message: `Factory candidate ${"c".repeat(64)}`, parents: [sha] });
    await client.git.createRef({ ...scope, ref: `refs/heads/${branch}`, sha });
    await client.pulls.create({ ...scope, head: branch, base: "main", draft: true, title: "candidate", body: "review required" });
    assert.ok(calls.every(c => !c.url.endsWith("/merge")));
    assert.equal(calls.at(-1)!.body.draft, true);
    assert.deepEqual(calls[2].body.parents, [sha]);
});
test("public exact-source helper exports verified blobs without commands or protected files", async () => {
    const bytes = Buffer.from("synthetic source\n"), blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    let checkedPublic = false;
    const client = createFactoryPilotGitHubClient({ request: async (url) => {
            if (url.endsWith(FACTORY_PILOT_REPOSITORY)) {
                checkedPublic = true;
                return json({ full_name: FACTORY_PILOT_REPOSITORY, private: false, archived: false, disabled: false, default_branch: "main" });
            }
            assert.equal(checkedPublic, true);
            if (url.includes("/git/commits/"))
                return json({ sha, tree: { sha: tree }, parents: [], message: "base" });
            if (url.includes("/git/trees/"))
                return json({ sha: tree, truncated: false, tree: [{ path: "app.ts", type: "blob", mode: "100644", sha: blob, size: bytes.length }, { path: ".env", type: "blob", mode: "100644", sha: "d".repeat(40) }] });
            assert.ok(url.endsWith(blob));
            return json({ sha: blob, encoding: "base64", size: bytes.length, content: bytes.toString("base64") });
        } });
    const workspace = await mkdtemp(path.join(tmpdir(), "factory-client-test-"));
    try {
        assert.deepEqual(await createFactoryPilotGitHubSourceExporter(client)(FACTORY_PILOT_REPOSITORY, sha, workspace), { sha });
        assert.deepEqual(await readdir(workspace), ["app.ts"]);
        assert.deepEqual(await readFile(path.join(workspace, "app.ts")), bytes);
    }
    finally {
        await rm(workspace, { recursive: true, force: true });
    }
});
