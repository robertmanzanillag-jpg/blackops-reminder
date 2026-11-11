// Read-only diagnostic: why does the council not credit KONG? Writes nothing.
import { runOfficeKongReadOnly } from "../server/office-kong";
import { scoreOfficeKongSnapshot } from "../shared/office-kong-supervisor";
import { getCouncilStore } from "../server/agent-council-store";
import { getSystemUserId } from "../server/user-context";

const started = Date.now();
try {
  const result = await runOfficeKongReadOnly();
  const ended = Date.now();
  const ev = result.evidence;
  const at = (offset: number) => scoreOfficeKongSnapshot(ev, ended + offset).verified;
  console.log(JSON.stringify({
    readMs: ended - started,
    generatedAt: ev.generatedAt, citySnapshotCheckedAt: ev.citySnapshotCheckedAt,
    cities: ev.cities.length, agents: ev.agents.length, cityAgentsEnabled: ev.cityAgentsEnabled,
    verifiedNow: at(0), verifiedAfter3m: at(180_000), verifiedAfter6m: at(360_000),
  }));
} catch (error) {
  console.log(JSON.stringify({ readMs: Date.now() - started, error: (error as { code?: string }).code, message: (error as Error).message }));
}
try {
  const raw = await (await getCouncilStore()).read(getSystemUserId());
  const state = raw ? JSON.parse(raw) : null;
  console.log(JSON.stringify({
    stored: Boolean(raw), lastCycleAt: state?.lastCycleAt, kongObservedAt: state?.kongObservedAt,
    lastCredited: Object.values(state?.kongEvidenceAt || {}).sort().at(-1),
  }));
} catch (error) {
  console.log(JSON.stringify({ storeError: (error as Error).message.slice(0, 200) }));
}
process.exit(0);
