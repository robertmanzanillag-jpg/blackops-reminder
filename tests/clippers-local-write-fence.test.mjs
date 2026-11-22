import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyWriteFence, prepareWriteFence, patchInstalledModule, hashBytes, GUARD_PATH } from '../script/clippers-install-local-write-fence.mjs';

const P = 'script/clippers-portfolio-metricool.mjs';
const A = 'script/clippers-metricool-autopilot.mjs';
const guardBytes = await readFile(new URL('../shared/clippers-metricool-writer.mjs', import.meta.url));
const originalPortfolio = Buffer.from('export const x = {\n    async schedule(destination, item) {\n      throw Error("unfenced");\n    }\n};\n');
const originalAutopilot = Buffer.from('export function run(input) { const results = [];\n  for (const candidate of [input]) {\n    const { item, validation, blogId, mediaReceipt } = candidate;\n    throw Error("unfenced");\n  } return results;\n}\n');
async function fixture(run) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'write-fence-')));
  const runtimeRoot = path.join(root, 'runtime');
  await mkdir(path.join(runtimeRoot, 'script'), { recursive: true });
  await mkdir(path.join(runtimeRoot, 'shared'));
  await writeFile(path.join(runtimeRoot, P), originalPortfolio);
  await writeFile(path.join(runtimeRoot, A), originalAutopilot);
  const pins = { [P]: hashBytes(originalPortfolio), [A]: hashBytes(originalAutopilot) };
  try { await run({ root, runtimeRoot, pins }); } finally { await rm(root, { recursive: true, force: true }); }
}

test('plan is read-only and preserves runtime plus unrelated receipt bytes', () => fixture(async ({runtimeRoot,pins}) => {
  const receipt = path.join(runtimeRoot, 'receipt.json');
  await writeFile(receipt, 'do not touch');
  const prepared = await prepareWriteFence({ runtimeRoot, guardBytes, pins });
  assert.equal(prepared.plan.applied, false);
  assert.equal(prepared.plan.files.length, 3);
  assert.equal(await readFile(path.join(runtimeRoot, P), 'utf8'), originalPortfolio.toString());
  assert.equal(await readFile(receipt, 'utf8'), 'do not touch');
  await assert.rejects(readFile(path.join(runtimeRoot, GUARD_PATH)), {code:'ENOENT'});
}));

test('apply requires exact plan and quiescence, backs up originals and readbacks new hashes', () => fixture(async ({root,runtimeRoot,pins}) => {
  const prepared = await prepareWriteFence({ runtimeRoot, guardBytes, pins });
  const backupRoot = path.join(root, 'backup');
  await assert.rejects(applyWriteFence(prepared, { expectedPlan:prepared.plan, backupRoot }), /QUIESCENCE/);
  await assert.rejects(applyWriteFence(prepared, { expectedPlan:{}, backupRoot, quiesced:true }), /PLAN_MISMATCH/);
  const receipt = await applyWriteFence(prepared, { expectedPlan:prepared.plan, backupRoot, quiesced:true });
  assert.equal(receipt.applied, true);
  assert.deepEqual(await readFile(path.join(backupRoot,P)), originalPortfolio);
  assert.deepEqual(await readFile(path.join(backupRoot,A)), originalAutopilot);
  for(const row of prepared.plan.files) assert.equal(hashBytes(await readFile(path.join(runtimeRoot,row.path))), row.afterSha256);
}));

test('wrong pins, changed guard, symlinks and concurrent changes fail closed', () => fixture(async ({root,runtimeRoot,pins}) => {
  await assert.rejects(prepareWriteFence({runtimeRoot,guardBytes,pins:{[P]:'0'.repeat(64)}}), /PIN_MISMATCH/);
  await assert.rejects(prepareWriteFence({runtimeRoot,guardBytes:Buffer.from('different'),pins}), /GUARD_PIN_MISMATCH/);
  const prepared = await prepareWriteFence({runtimeRoot,guardBytes,pins});
  await writeFile(path.join(runtimeRoot,P), 'changed');
  await assert.rejects(applyWriteFence(prepared,{expectedPlan:prepared.plan,backupRoot:path.join(root,'backup'),quiesced:true}), /CONCURRENT_CHANGE/);
  await rm(path.join(runtimeRoot,P));
  await symlink(path.join(runtimeRoot,A),path.join(runtimeRoot,P));
  await assert.rejects(prepareWriteFence({runtimeRoot,guardBytes,pins}), /FILE_INVALID/);
}));

test('fenced portfolio blocks cloud-owned brands before any network even with inherited cloud flags', () => fixture(async ({runtimeRoot}) => {
  await writeFile(path.join(runtimeRoot,GUARD_PATH),guardBytes);
  await writeFile(path.join(runtimeRoot,P),patchInstalledModule(P,originalPortfolio));
  const {x}=await import(path.join(runtimeRoot,P));
  const original=process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS='true';
  try {
    for(const brandId of [6431685,6431687,6591612,6595747,undefined]) await assert.rejects(x.schedule({brandId},{}), /cloud_owned_brand_mac_write_refused/);
    await assert.rejects(x.schedule({brandId:6475033},{}), /unfenced/);
  } finally { if(original===undefined)delete process.env.GITHUB_ACTIONS;else process.env.GITHUB_ACTIONS=original; }
}));


test('autopilot fence returns blocked without reaching unfenced transport for cloud-owned destinations', () => fixture(async ({runtimeRoot}) => {
  await writeFile(path.join(runtimeRoot,GUARD_PATH),guardBytes);
  await writeFile(path.join(runtimeRoot,A),patchInstalledModule(A,originalAutopilot));
  const {run}=await import(path.join(runtimeRoot,A));
  for(const blogId of [6431685,6431687,6591612,6595747]) {
    assert.deepEqual(run({item:{itemId:'clip-1'},blogId}), [{itemId:'clip-1',status:'blocked',blockers:['cloud_owned_brand_mac_write_refused']}]);
  }
  assert.throws(()=>run({item:{itemId:'clip-1'},blogId:6475033}), /unfenced/);
}));
