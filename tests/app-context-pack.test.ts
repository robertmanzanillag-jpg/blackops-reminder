import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildContextPack, contextPackCacheKey, isPackablePath, parseContextPack, renderContextSlice, selectContextSlice, summarizeSource } from "../shared/app-context-pack";
import { appContextSliceText, resetAppContextPackCacheForTests } from "../server/app-context-pack-loader";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const facts = { entrypoints: [], agents: [], dataSources: [], workflows: [] };
const src: Record<string, string> = {
  "server/credit-pacer.ts": "// Credit pacer: daily AI spend per task type.\nexport function taskEfficiency() {}\napp.get(\"/api/pacer\", h);",
  "server/clippers-agent.ts": "/** Clippers agent publishes clips. */\nexport const runClippers = 1;",
  ".env": "SECRET=1", "server/github-token.ts": "x", "docs/a.md": "# x",
};
const files = (hashes: Record<string, string> = {}) => Object.keys(src).map(p => ({ path: p, hash: hashes[p] || digest(src[p]), read: () => src[p] }));
const build = (extra: Partial<Parameters<typeof buildContextPack>[0]> = {}) => buildContextPack({ project: "blackops", commit: null, generatedAt: "x", files: files(), facts, digest, ...extra });

test("pack never indexes secrets, env, token files or non-source", () => {
  assert.equal(isPackablePath(".env"), false); assert.equal(isPackablePath("server/github-token.ts"), false); assert.equal(isPackablePath("docs/a.md"), false);
  const { pack } = build();
  assert.deepEqual(pack.files.map(f => f.path), ["server/clippers-agent.ts", "server/credit-pacer.ts"]);
  assert.deepEqual(pack.facts.routes, ["GET /api/pacer"]);
});

test("summaries are deterministic and only changed files are re-summarized", () => {
  assert.match(summarizeSource("server/credit-pacer.ts", src["server/credit-pacer.ts"]).summary, /Credit pacer/);
  const first = build();
  let reads = 0;
  const counted = files({ "server/clippers-agent.ts": "changed" }).map(f => ({ ...f, read: () => { reads++; return f.read(); } }));
  const second = build({ generatedAt: "y", previous: first.pack, files: counted });
  assert.equal(second.reused, 1); assert.equal(second.summarized, 1); assert.equal(reads, 1);
  const same = build({ generatedAt: "z", previous: first.pack });
  assert.equal(same.pack.packHash, first.pack.packHash, "hash ignores generatedAt");
});

test("slice selection is relevant, bounded, stable and cache-keyed", () => {
  const { pack } = build();
  const slice = selectContextSlice(pack, "¿por qué falla el credit pacer?");
  assert.deepEqual(slice.map(f => f.path), ["server/credit-pacer.ts"]);
  assert.deepEqual(selectContextSlice(pack, "hola"), []);
  assert.equal(renderContextSlice(pack, slice), renderContextSlice(pack, [...slice]));
  assert.ok(contextPackCacheKey(pack, "agent-chat").length <= 64);
  assert.equal(parseContextPack({ version: 99 }), null);
});

test("loader serves a slice only for app questions and caches by mtime", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ctx-")); mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "app-context-pack.json"), JSON.stringify(build().pack));
  resetAppContextPackCacheForTests();
  assert.match(appContextSliceText("error en el código del credit pacer", 2, root), /server\/credit-pacer\.ts/);
  assert.equal(appContextSliceText("¿cómo estás?", 2, root), "");
  assert.equal(appContextSliceText("error en el código del pacer", 0, root), "");
});
