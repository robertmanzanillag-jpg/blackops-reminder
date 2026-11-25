// App context pack: a compact, versioned, deterministic index of one project (no AI).
// Built by script/app-context-pack.ts from Git-visible files and stored in
// docs/app-context-pack.json. Agents load a small relevant slice instead of
// scanning/reading the repo; each file summary is cached by content hash so a
// regeneration only re-summarizes files that changed.

export const APP_CONTEXT_PACK_VERSION = 1;
export const MAX_SUMMARY_CHARS = 160;
export const DEFAULT_SLICE_ENTRIES = 4;
export const MAX_SLICE_ENTRIES = 8;

export type ContextPackFile = { path: string; hash: string; kind: string; summary: string; exports: string[]; routes: string[] };
export type ContextPackFacts = { entrypoints: string[]; routes: string[]; agents: string[]; dataSources: string[]; workflows: string[] };
export type AppContextPack = { version: number; project: string; commit: string | null; generatedAt: string; packHash: string; files: ContextPackFile[]; facts: ContextPackFacts };

const SECRET_NAME = /(^|\/)(\.env|credentials|secrets?)(\/|\.|$)|token|private[-_]?key|recovery/i;
export const isPackablePath = (p: string) => !SECRET_NAME.test(p) && /\.(ts|tsx|mjs|js)$/.test(p) && /^(server|shared|client\/src|script)\//.test(p);

export function fileKind(p: string): string {
  if (p.startsWith("server/")) return "server";
  if (p.startsWith("shared/")) return "shared";
  if (p.startsWith("client/src/pages/")) return "page";
  if (p.startsWith("client/src/")) return "client";
  return "script";
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Deterministic summary: the first leading comment (or first doc comment) plus exported names. Never includes string literals or env values. */
export function summarizeSource(p: string, content: string): Pick<ContextPackFile, "summary" | "exports" | "routes"> {
  const exports = Array.from(content.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm)).map(m => m[1]);
  const routes = Array.from(content.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`\s]{1,120})["'`]/g)).map(m => `${m[1].toUpperCase()} ${m[2]}`);
  const block = content.match(/^\s*(?:import[^\n]*\n|\s)*\/\*\*?([\s\S]*?)\*\//);
  const lines = content.match(/^(?:\s*\/\/[^\n]*\n)+/);
  const doc = content.match(/\/\*\*([\s\S]*?)\*\//);
  let raw = lines ? lines[0].replace(/^\s*\/\/\s?/gm, " ") : block ? block[1] : doc ? doc[1] : "";
  raw = clean(raw.replace(/^\s*\*\s?/gm, " "));
  const summary = (raw || (exports.length ? `${fileKind(p)}: ${exports.slice(0, 5).join(", ")}` : fileKind(p))).slice(0, MAX_SUMMARY_CHARS);
  return { summary, exports: [...new Set(exports)].slice(0, 12), routes: [...new Set(routes)].slice(0, 20) };
}

/** Incremental build: a file whose content hash matches the previous pack keeps its summary (not recomputed). */
export function buildContextPack(input: {
  project: string; commit: string | null; generatedAt: string; previous?: AppContextPack | null;
  files: Array<{ path: string; hash: string; read: () => string }>; facts: Omit<ContextPackFacts, "routes" | "entrypoints"> & { entrypoints: string[] };
  digest: (s: string) => string;
}): { pack: AppContextPack; reused: number; summarized: number } {
  const prev = new Map((input.previous?.version === APP_CONTEXT_PACK_VERSION ? input.previous.files : []).map(f => [f.path, f]));
  let reused = 0, summarized = 0;
  const files: ContextPackFile[] = [];
  for (const f of [...input.files].filter(f => isPackablePath(f.path)).sort((a, b) => a.path.localeCompare(b.path))) {
    const old = prev.get(f.path);
    if (old && old.hash === f.hash) { files.push(old); reused++; continue; }
    files.push({ path: f.path, hash: f.hash, kind: fileKind(f.path), ...summarizeSource(f.path, f.read()) });
    summarized++;
  }
  const facts: ContextPackFacts = { ...input.facts, routes: [...new Set(files.flatMap(f => f.routes))].sort().slice(0, 400) };
  const body = JSON.stringify({ files, facts });
  const pack = { version: APP_CONTEXT_PACK_VERSION, project: input.project, commit: input.commit, generatedAt: input.generatedAt, packHash: input.digest(body), files, facts };
  return { pack, reused, summarized };
}

const tokens = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(t => t.length >= 3);

/** The N files most relevant to a question (path/export/summary keyword overlap). Empty when nothing matches. */
export function selectContextSlice(pack: AppContextPack | null | undefined, question: string, n = DEFAULT_SLICE_ENTRIES): ContextPackFile[] {
  if (!pack || !Array.isArray(pack.files) || n < 1) return [];
  const q = new Set(tokens(question));
  if (!q.size) return [];
  const scored = pack.files.map(f => {
    const pathT = tokens(f.path), expT = f.exports.flatMap(e => tokens(e.replace(/([a-z])([A-Z])/g, "$1 $2"))), sumT = tokens(f.summary), routeT = f.routes.flatMap(tokens);
    let score = 0;
    for (const t of q) score += (pathT.includes(t) ? 3 : 0) + (expT.includes(t) ? 2 : 0) + (routeT.includes(t) ? 2 : 0) + (sumT.includes(t) ? 1 : 0);
    return { f, score };
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));
  return scored.slice(0, Math.min(n, MAX_SLICE_ENTRIES)).map(x => x.f);
}

/** Stable text block (sorted by path, no timestamps) so repeated prompts share a cacheable prefix. */
export function renderContextSlice(pack: AppContextPack, slice: ContextPackFile[]): string {
  if (!slice.length) return "";
  const rows = [...slice].sort((a, b) => a.path.localeCompare(b.path)).map(f => `- ${f.path}: ${f.summary}${f.exports.length ? ` [${f.exports.slice(0, 6).join(", ")}]` : ""}`);
  return `MAPA DE LA APP (${pack.project}@${pack.packHash.slice(0, 12)}):\n${rows.join("\n")}`;
}

/** Provider prompt-cache key for the stable pack prefix (OpenAI prompt_cache_key; Anthropic cache_control marks the same block). */
export const contextPackCacheKey = (pack: Pick<AppContextPack, "project" | "packHash">, scope: string) => `ctx:${pack.project}:${scope}:${pack.packHash.slice(0, 16)}`.slice(0, 64);

export function parseContextPack(raw: unknown): AppContextPack | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as AppContextPack;
  if (p.version !== APP_CONTEXT_PACK_VERSION || typeof p.project !== "string" || typeof p.packHash !== "string" || !Array.isArray(p.files) || !p.facts) return null;
  if (!p.files.every(f => f && typeof f.path === "string" && typeof f.summary === "string" && Array.isArray(f.exports) && Array.isArray(f.routes))) return null;
  return p;
}
