import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unverifiedBuildProvenance, type BuildProvenance } from "../server/build-provenance";

const EXACT_FILES = new Set([".replit", "package.json", "package-lock.json", "client/index.html", "vite.config.ts", "tsconfig.json"]);
const EXCLUDED = /(?:^|\/)(?:\.env[^/]*|credentials?|secrets?|private|backups?|archives?|node_modules|dist|media|uploads|fixtures)(?:\/|\.|$)/i;

/** Only tracked source code and explicitly selected nonsecret build/policy files. */
export function isRuntimeSourcePath(path: string): boolean {
  if (path.includes("\\") || path.split("/").includes("..") || path.startsWith("/") || EXCLUDED.test(path)) return false;
  return EXACT_FILES.has(path) || /^config\/local-news-delivery-policy\.(?:json|ts|mjs)$/.test(path) ||
    /^(?:client\/src|server|shared|script)\/.+\.(?:ts|tsx|js|jsx|mjs|cjs|css)$/.test(path);
}

export function collectBuildProvenance(root = process.cwd()): BuildProvenance {
  // A caller's Git environment must not silently redirect identity to another repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = (args: string[]) => spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: root, env, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const head = git(["rev-parse", "--verify", "HEAD"]);
    const revision = head.stdout?.trim();
    if (head.status !== 0 || !/^[a-f0-9]{40}$/.test(revision || "")) return unverifiedBuildProvenance("git_unavailable");
    const clean = () => git(["diff", "--quiet", "--no-ext-diff", "--no-textconv", "HEAD", "--"]);
    const before = clean();
    if (before.status !== 0) return unverifiedBuildProvenance(before.status === 1 ? "tracked_dirty" : "git_unavailable");
    const listed = git(["ls-files", "-z", "--", ".replit", "package.json", "package-lock.json", "client", "server", "shared", "script", "config", "vite.config.ts", "tsconfig.json"]);
    if (listed.status !== 0) return unverifiedBuildProvenance("git_unavailable");
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]);
    if (untracked.status !== 0) return unverifiedBuildProvenance("git_unavailable");
    if (untracked.stdout.split("\0").some(isRuntimeSourcePath)) return unverifiedBuildProvenance("tracked_dirty");
    const paths = [...new Set(listed.stdout.split("\0").filter(isRuntimeSourcePath))].sort();
    if (!paths.includes("package.json") || !paths.includes("server/index.ts") || paths.length > 5000) return unverifiedBuildProvenance("source_unavailable");
    const hash = createHash("sha256");
    let bytes = 0;
    for (const path of paths) {
      const full = resolve(root, path), stat = lstatSync(full);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024 || (bytes += stat.size) > 64 * 1024 * 1024) return unverifiedBuildProvenance("source_unavailable");
      const contents = readFileSync(full);
      hash.update(path).update("\0").update(String(contents.length)).update("\0").update(contents).update("\0");
    }
    if (git(["rev-parse", "--verify", "HEAD"]).stdout?.trim() !== revision || clean().status !== 0) return unverifiedBuildProvenance("tracked_dirty");
    return { version: 1, status: "verified", revision, trackedClean: true,
      runtimeSourceSha256: hash.digest("hex"), runtimeSourceFiles: paths.length,
      scope: "tracked-runtime-source-v1", reason: "clean_build" };
  } catch {
    return unverifiedBuildProvenance("source_unavailable");
  }
}
