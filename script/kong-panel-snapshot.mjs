import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function sanitizeSnapshot(status, capturedAt = new Date().toISOString()) {
  const count = key => {
    const value = status[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid count: ${key}`);
    return value;
  };
  const counts = Object.fromEntries(['projectCount','collectiveCount','radioCount','labelCount','otherProjectCount','extraTypeAssignments','candidateCount','corroboratedCount'].map(k => [k,count(k)]));
  if (counts.collectiveCount + counts.radioCount + counts.labelCount - counts.extraTypeAssignments + counts.otherProjectCount !== counts.projectCount) throw new Error('Project totals do not reconcile');
  if (counts.corroboratedCount > counts.projectCount) throw new Error('Invalid corroborated count');
  if (!Number.isSafeInteger(status.djs?.total) || status.djs.total < 0) throw new Error('Invalid DJ count');
  for (const value of [capturedAt, status.lastActivityAt]) if (value !== null && !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp');
  return { version: 1, capturedAt, lastActivityAt: status.lastActivityAt, counts: {...counts, djCount:status.djs.total}, mode:'snapshot', note:'Copia de cifras locales; no indica actividad en vivo. Los contactos y candidatos no se publican.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node script/kong-panel-snapshot.mjs input.json output.json');
  const snapshot = sanitizeSnapshot(JSON.parse(await readFile(input,'utf8')));
  await writeFile(output, JSON.stringify(snapshot,null,2)+'\n');
}
