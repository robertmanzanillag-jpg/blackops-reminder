import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { withBlackRoomQueueLock } from "../server/blackroom-daily-queue";
import { assessLocalBlackRoomExports, emptyEvidence, type EvidenceArchive } from "../server/blackroom-local-evidence";
import { buildBlackRoomPublicationExperiments } from "./blackroom-remote-sync.mjs";

async function jsonFile(file: string, missing: unknown) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (err: any) { if (err?.code === "ENOENT") return missing; throw err; }
}

async function saveAtomic(file: string, data: unknown) {
  const temp = file + "." + process.pid + ".tmp";
  await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
  await rename(temp, file);
}

/** No network clients, scheduler, receipt mutation or queue-state writes.
 * A dedicated file lock covers the complete archive->report transaction. */
export async function refreshLocalBlackRoomEvidence(root: string, agentDir: string, now = new Date()) {
  const archiveFile = path.join(agentDir, "local-ceo-evidence.json");
  return withBlackRoomQueueLock(archiveFile, async () => {
    const prior = await jsonFile(archiveFile, emptyEvidence()) as EvidenceArchive;
    if (prior?.version !== 1 || !Array.isArray(prior.posts) || !Array.isArray(prior.snapshots)) throw new Error("Invalid local evidence archive");
    const latest = await jsonFile(path.join(root, "latest-export.json"), null);
    if (!latest || !Array.isArray(latest.imports)) throw new Error("Verified BlackRoom export unavailable");
    const ledger = await jsonFile(path.join(agentDir, "worker-ledger.json"), { entries: [] });
    if (!Array.isArray(ledger?.entries)) throw new Error("Invalid BlackRoom receipt ledger");
    const { archive, report } = assessLocalBlackRoomExports(prior, latest.imports, buildBlackRoomPublicationExperiments(ledger), now);
    // A planner receipt without an official platform ID is pending context,
    // never a measurement or evidence for the controlled hook experiment.
    const manual = await jsonFile(process.env.BLACKROOM_MANUAL_RECEIPTS_PATH || path.join(agentDir, "manual-planner-receipts.json"), null);
    const keys = new Set<string>();
    if (String(manual?.brandId) === "6585226" && manual?.state === "scheduled_not_published" && Array.isArray(manual.rows)) {
      for (const row of manual.rows.slice(-2000)) {
        if (!/^\d+$/.test(String(row?.plannerId || "")) || !Array.isArray(row.networks)) continue;
        for (const net of row.networks) if (["tiktok", "facebook", "youtube"].includes(net)) keys.add(row.plannerId + ":" + net);
      }
    }
    const summary = { ...report, unverifiedManualDeliveries: keys.size };
    await saveAtomic(archiveFile, archive);
    await saveAtomic(path.join(agentDir, "local-ceo-report.json"), summary);
    return summary;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.env.BLACKROOM_ANALYTICS_STATE_DIR || (process.platform === "darwin"
    ? path.join(homedir(), "Library/Application Support/BlackRoom/analytics")
    : "clippers_workspace/blackroom/analytics"));
  refreshLocalBlackRoomEvidence(root, path.resolve("clippers_workspace/blackroom/agent"))
    .then(report => console.log(JSON.stringify({ scope: report.scope, evaluatedAt: report.evaluatedAt, networkSamples: report.networkSamples })))
    .catch(() => { console.error("No se pudo actualizar la evidencia local; se conserva el archivo anterior."); process.exitCode = 1; });
}
