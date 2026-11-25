import { createHash } from "node:crypto";
import {
  SELF_HEAL_REPOSITORY, SELF_HEAL_TEST_PATH, selfHealTestRecordId, type SelfHealObservedAudit,
} from "./office-self-heal";
import { isFactoryWritePathAllowed } from "./software-factory-write-scope";

/**
 * Release-gate backlog for the office self-heal loop.
 *
 * script/release-gate/known-failures.json on main lists the pre-existing failing
 * test files the release gate tolerates. Each one is real, bounded work for the
 * Software Factory: make the test pass and drop its allowlist entry. This module
 * turns that file into one KNOWN_TEST_FAILURE finding per eligible test file.
 *
 * Only the file path (validated against a strict pattern) and its digest leave
 * this module; reasons and test names are used solely to filter entries and never
 * reach an order. Excluded (never an order):
 *   - flaky entries (headless browser timeouts: no deterministic fix signal),
 *   - entries that need the operator Mac toolchain or macOS (cannot pass on the
 *     Linux runner, so a factory PR could never prove the fix),
 *   - KONG files and paths outside the factory write scope.
 * Any read or parse problem yields no audit at all (fail closed: no orders, and no
 * "cleared" evidence either).
 */

export const RELEASE_GATE_ROLE = "release-gate" as const;
export const RELEASE_GATE_ALLOWLIST_PATH = "script/release-gate/known-failures.json";
export const RELEASE_GATE_MAX_FINDINGS = 20;
const MAC_ONLY = /macOS|operator Mac|Mac toolchain|Linux runner/i;
const MAX_BYTES = 256 * 1024;

export function releaseGateSelfHealAudits(raw: string | null, completedAt: string): SelfHealObservedAudit[] {
  if (typeof raw !== "string" || raw.length > MAX_BYTES || !Number.isFinite(Date.parse(completedAt))) return [];
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const known = parsed?.knownFailures;
  if (!known || typeof known !== "object" || Array.isArray(known)) return [];
  const findings: SelfHealObservedAudit["findings"] = [], records: SelfHealObservedAudit["records"] = {};
  for (const [testPath, entry] of Object.entries<any>(known).sort(([a], [b]) => a.localeCompare(b))) {
    if (findings.length >= RELEASE_GATE_MAX_FINDINGS) break;
    if (!SELF_HEAL_TEST_PATH.test(testPath) || /kong/i.test(testPath) || !isFactoryWritePathAllowed(testPath)) continue;
    if (!entry || typeof entry !== "object" || entry.flaky === true || typeof entry.reason !== "string" || MAC_ONLY.test(entry.reason)) continue;
    const id = selfHealTestRecordId(testPath);
    findings.push({ code: "KNOWN_TEST_FAILURE", recordId: id });
    records[id] = { repo: SELF_HEAL_REPOSITORY, testPath };
  }
  const digest = createHash("sha256").update(raw).digest("hex");
  // One audit per UTC day of the same file content: stable job id, so replays and repeated ticks are idempotent.
  return [{ role: RELEASE_GATE_ROLE, jobId: `release-gate:${completedAt.slice(0, 10)}:${digest.slice(0, 16)}`, completedAt, status: "completed",
    completeCoverage: true, artifactId: digest, findings, records }];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Reads the allowlist from main through the GitHub REST contents API (read-only). Null on any problem. */
export async function readReleaseGateAllowlist(options: { token?: string | null; ref?: string; fetch?: Fetch; timeoutMs?: number } = {}): Promise<string | null> {
  const ref = options.ref ?? "main";
  if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(ref)) return null;
  const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "office-release-gate-backlog" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  try {
    const response = await (options.fetch ?? fetch)(`https://api.github.com/repos/${SELF_HEAL_REPOSITORY}/contents/${RELEASE_GATE_ALLOWLIST_PATH}?ref=${encodeURIComponent(ref)}`,
      { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length <= MAX_BYTES ? text : null;
  } catch { return null; }
}

export async function readReleaseGateSelfHealAudits(options: Parameters<typeof readReleaseGateAllowlist>[0] & { now?: number } = {}): Promise<SelfHealObservedAudit[]> {
  const raw = await readReleaseGateAllowlist(options);
  return releaseGateSelfHealAudits(raw, new Date(options.now ?? Date.now()).toISOString());
}
