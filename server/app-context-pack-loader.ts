import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type AppContextPack, DEFAULT_SLICE_ENTRIES, parseContextPack, renderContextSlice, selectContextSlice } from "@shared/app-context-pack";

/** Reads docs/app-context-pack.json once per file change (mtime cache): no repo scan at request time. */
let cached: { file: string; mtimeMs: number; pack: AppContextPack | null } | null = null;

export function loadAppContextPack(root = process.cwd()): AppContextPack | null {
  const file = path.join(root, "docs", "app-context-pack.json");
  try {
    const mtimeMs = statSync(file).mtimeMs;
    if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.pack;
    const pack = parseContextPack(JSON.parse(readFileSync(file, "utf8")));
    cached = { file, mtimeMs, pack };
    return pack;
  } catch { return null; }
}

/** Only questions about the app itself (code, routes, files, APIs, bugs) get a slice. */
const APP_QUESTION = /\b(c[oó]digo|code|ruta|route|api|endpoint|archivo|file|m[oó]dulo|module|funci[oó]n|function|bug|error|test|script|pantalla|panel|workflow)\b/i;

/** Relevant slice text for a question, bounded by n entries; "" when the question is not about the app or nothing matches. */
export function appContextSliceText(question: string, n = DEFAULT_SLICE_ENTRIES, root = process.cwd()): string {
  if (n < 1 || !APP_QUESTION.test(question)) return "";
  const pack = loadAppContextPack(root);
  if (!pack) return "";
  return renderContextSlice(pack, selectContextSlice(pack, question, n)).slice(0, 1200);
}

export function resetAppContextPackCacheForTests() { cached = null; }
