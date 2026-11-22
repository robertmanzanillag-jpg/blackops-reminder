import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// This backport is intentionally pinned to the observed installed code, not a tree sync.
export const INSTALLED_PINS = Object.freeze({
  'script/clippers-portfolio-metricool.mjs': '1a28161c2e48c8700b98685f6bf86e5cc3b188a83e435555704693a1ac0ceb2f',
  'script/clippers-metricool-autopilot.mjs': 'ec0191009f1d948fda6aaa187f52c4e8ac96851370786d1cc5db7787faef034f',
});
export const GUARD_PATH = 'shared/clippers-metricool-writer.mjs';
const GUARD_PIN = '9c322e088ecbec98d416660d1b4c4b32ed5f3926256a947e74396ed21de3973f';
export const hashBytes = value => createHash('sha256').update(value).digest('hex');

function replaceOnce(text, anchor, replacement) {
  if (text.split(anchor).length !== 2) throw Error('WRITE_FENCE_ANCHOR_MISMATCH');
  return text.replace(anchor, replacement);
}
export function patchInstalledModule(relative, original) {
  let text = original.toString('utf8');
  const importLine = `import { metricoolWriteRefusal } from '../shared/clippers-metricool-writer.mjs';\n`;
  if (relative === 'script/clippers-portfolio-metricool.mjs') {
    const anchor = '    async schedule(destination, item) {\n';
    text = replaceOnce(text, anchor, anchor + `      // Local-only backport: inherited cloud/override flags cannot enable this Mac writer.\n      const refused = metricoolWriteRefusal(destination?.brandId, {});\n      if (refused) throw new Error(refused);\n`);
  } else if (relative === 'script/clippers-metricool-autopilot.mjs') {
    const anchor = '    const { item, validation, blogId, mediaReceipt } = candidate;\n';
    text = replaceOnce(text, anchor, anchor + `    // Local-only backport: fence before the candidate calendar recheck or scheduling writes.\n    const refused = metricoolWriteRefusal(blogId, {});\n    if (refused) {\n      results.push({ itemId: item.itemId, status: "blocked", blockers: [refused] });\n      continue;\n    }\n`);
  } else throw Error('WRITE_FENCE_PATH_DENIED');
  return Buffer.from(importLine + text);
}

async function plainFile(root, relative, allowAbsent = false) {
  const file = path.join(root, relative);
  const parent = path.dirname(file);
  if (await realpath(parent) !== parent) throw Error('WRITE_FENCE_SYMLINK_DENIED');
  let stat;
  try { stat = await lstat(file); } catch (error) {
    if (allowAbsent && error.code === 'ENOENT') return null;
    throw Error('WRITE_FENCE_INPUT_UNREADABLE');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw Error('WRITE_FENCE_FILE_INVALID');
  return { bytes: await readFile(file), mode: stat.mode & 0o777 };
}

export async function prepareWriteFence({ runtimeRoot, guardBytes, pins = INSTALLED_PINS }) {
  const root = path.resolve(runtimeRoot);
  if (await realpath(root) !== root) throw Error('WRITE_FENCE_SYMLINK_DENIED');
  if (hashBytes(guardBytes) !== GUARD_PIN) throw Error('WRITE_FENCE_GUARD_PIN_MISMATCH');
  const writes = [];
  for (const [relative, pin] of Object.entries(pins)) {
    if (!(relative in INSTALLED_PINS)) throw Error('WRITE_FENCE_PATH_DENIED');
    const before = await plainFile(root, relative);
    const after = patchInstalledModule(relative, before.bytes);
    if (hashBytes(before.bytes) !== pin) throw Error('WRITE_FENCE_INSTALLED_PIN_MISMATCH');
    writes.push({ relative, before, after });
  }
  const previousGuard = await plainFile(root, GUARD_PATH, true);
  if (previousGuard && hashBytes(previousGuard.bytes) !== GUARD_PIN) throw Error('WRITE_FENCE_EXISTING_GUARD_MISMATCH');
  writes.unshift({ relative: GUARD_PATH, before: previousGuard, after: guardBytes });
  const plan = { version: 1, runtimeRoot: root, purpose: 'local_clippers_metricool_write_fence',
    cloudImpersonationAllowed: false, applied: false,
    files: writes.map(w => ({ path: w.relative, beforeSha256: w.before ? hashBytes(w.before.bytes) : null,
      afterSha256: hashBytes(w.after), mode: w.before?.mode ?? 0o600 })) };
  return { plan, writes };
}

export async function applyWriteFence(prepared, { expectedPlan, backupRoot, quiesced = false }) {
  if (!quiesced) throw Error('WRITE_FENCE_QUIESCENCE_REQUIRED');
  if (JSON.stringify(expectedPlan) !== JSON.stringify(prepared.plan)) throw Error('WRITE_FENCE_PLAN_MISMATCH');
  const root = prepared.plan.runtimeRoot;
  const backup = path.resolve(backupRoot);
  if (backup === root || backup.startsWith(root + path.sep) || root.startsWith(backup + path.sep)) throw Error('WRITE_FENCE_BACKUP_LOCATION_INVALID');
  const lock = path.join(root, '.clippers-local-write-fence.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    // Recheck every byte under the lock before saving or changing anything.
    for (const write of prepared.writes) {
      const current = await plainFile(root, write.relative, !write.before);
      if ((current ? hashBytes(current.bytes) : null) !== (write.before ? hashBytes(write.before.bytes) : null)) throw Error('WRITE_FENCE_CONCURRENT_CHANGE');
    }
    await mkdir(backup, { mode: 0o700 }); // Must be a new, owner-controlled backup directory.
    for (const write of prepared.writes) if (write.before) {
      const file = path.join(backup, write.relative);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, write.before.bytes, { mode: 0o600, flag: 'wx' });
    }
    await writeFile(path.join(backup, 'plan.json'), JSON.stringify(prepared.plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // Install the dependency first. No launch job is restarted by this tool.
    for (const write of prepared.writes) {
      const target = path.join(root, write.relative);
      const temporary = target + `.write-fence-${process.pid}`;
      const handle = await open(temporary, 'wx', write.before?.mode ?? 0o600);
      try { await handle.writeFile(write.after); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
      if (hashBytes(await readFile(target)) !== hashBytes(write.after)) throw Error('WRITE_FENCE_READBACK_FAILED');
    }
    const receipt = { ...prepared.plan, applied: true, backupRoot: backup, installedAt: new Date().toISOString() };
    await writeFile(path.join(backup, 'applied.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return receipt;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function main(argv) {
  const [mode, runtimeRoot, planFile, backupRoot, confirmation] = argv;
  if (!['--plan', '--apply'].includes(mode) || !runtimeRoot || !planFile ||
      mode === '--plan' && argv.length !== 3 || mode === '--apply' && (argv.length !== 5 || confirmation !== '--quiesced')) throw Error('WRITE_FENCE_USAGE_INVALID');
  const guardBytes = await readFile(new URL('../' + GUARD_PATH, import.meta.url));
  const prepared = await prepareWriteFence({ runtimeRoot, guardBytes });
  if (mode === '--plan') {
    await writeFile(planFile, JSON.stringify(prepared.plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log('WRITE_FENCE_PLAN_WRITTEN_NO_RUNTIME_CHANGES');
  } else {
    await applyWriteFence(prepared, { expectedPlan: JSON.parse(await readFile(planFile, 'utf8')), backupRoot, quiesced: true });
    console.log('WRITE_FENCE_INSTALLED_AND_VERIFIED_NO_JOBS_STARTED');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => { console.error('WRITE_FENCE_FAILED_CLOSED'); process.exitCode = 1; });
}
