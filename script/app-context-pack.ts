// Deterministic, no-AI generator for docs/app-context-pack.json (see shared/app-context-pack.ts).
// Incremental: files whose git blob hash is unchanged reuse the previous summary.
// Usage: node --import tsx script/app-context-pack.ts [--project blackops]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildContextPack, isPackablePath, parseContextPack } from "../shared/app-context-pack";

const root = process.cwd();
const project = (process.argv.includes("--project") ? process.argv[process.argv.indexOf("--project") + 1] : "blackops") || "blackops";
const out = path.join(root, "docs", "app-context-pack.json");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// `git ls-files -s` gives the blob hash per tracked file: a content hash for free.
const files = git("ls-files", "-s").split("\n").filter(Boolean).map(line => {
  const [meta, p] = line.split("\t");
  return { path: p, hash: meta.split(" ")[1] };
}).filter(f => isPackablePath(f.path) && existsSync(path.join(root, f.path)) && statSync(path.join(root, f.path)).size <= 400_000)
  .map(f => ({ ...f, read: () => readFileSync(path.join(root, f.path), "utf8") }));

let previous = null;
try { previous = parseContextPack(JSON.parse(readFileSync(out, "utf8"))); } catch { previous = null; }
let commit: string | null = null, generatedAt = new Date(0).toISOString();
try { commit = git("rev-parse", "HEAD").trim(); generatedAt = git("log", "-1", "--format=%cI").trim(); } catch { /* not a git checkout */ }

const workflows = git("ls-files", ".github/workflows").split("\n").filter(Boolean).map(p => path.basename(p));
const agents = files.filter(f => /^(server|shared)\/.*(agent|ceo|clippers|office-role)/.test(f.path)).map(f => f.path);
const dataSources = (() => {
  try { const m = readFileSync(path.join(root, "server/office-source-documents.ts"), "utf8").match(/OFFICE_SOURCE_DOCUMENT_KINDS=\[([^\]]+)\]/); return m ? m[1].replace(/["\s]/g, "").split(",") : []; } catch { return []; }
})();
const entrypoints = ["server/index.ts", "server/routes.ts", "client/src/App.tsx", "shared/schema.ts"].filter(p => existsSync(path.join(root, p)));

const { pack, reused, summarized } = buildContextPack({
  project, commit, generatedAt, previous, files, digest: s => createHash("sha256").update(s).digest("hex"),
  facts: { entrypoints, agents: agents.slice(0, 200), dataSources, workflows },
});
if (previous?.packHash === pack.packHash) { console.log(`app-context-pack: unchanged (${pack.packHash.slice(0, 12)})`); process.exit(0); }
writeFileSync(out, `${JSON.stringify(pack)}\n`);
console.log(`app-context-pack: ${pack.files.length} files (${summarized} summarized, ${reused} reused), hash ${pack.packHash.slice(0, 12)}`);
