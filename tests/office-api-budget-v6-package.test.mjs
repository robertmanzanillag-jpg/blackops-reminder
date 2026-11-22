import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyActiveIntegrity,integritySha256,V6_MANIFEST_SHA256,V6_SOURCE_COMMIT,HISTORICAL_FIXTURE_SHA256,REQUIRED_SOURCES} from '../script/office-api-budget-v7-integrity/verify.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const packageRoot=path.join(root,'script/office-api-budget-v6');
const historicalBytes=await readFile(path.join(root,'tests/fixtures/office-api-budget-v6-public/snapshot.json'));
const historical=JSON.parse(historicalBytes);
const manifest=JSON.parse(await readFile(path.join(root,'script/office-api-budget-v7-integrity/manifest.json'),'utf8'));
async function verifiedHistory(){
 assert.equal(integritySha256(historicalBytes),HISTORICAL_FIXTURE_SHA256);
 assert.equal(historical.sourceCommit,V6_SOURCE_COMMIT);assert.equal(historical.v6ManifestSha256,V6_MANIFEST_SHA256);
 const original=JSON.parse(await readFile(path.join(packageRoot,'manifest.json'),'utf8'));
 const required=original.operations.filter(op=>op.path!=='server/clippers-local-news-translation.ts');
 assert.equal(historical.postimages.length,15);
 assert.deepEqual(historical.postimages.map(row=>row.path).sort(),required.map(row=>row.path).sort());
 const bytes=new Map();
 for(const row of historical.postimages){
  const operation=required.find(op=>op.path===row.path);assert.equal(row.sha256,operation.afterSha256);
  let body;
  if(operation.kind==='create'){
   assert.equal(row.frozenPackagePayload,operation.payload);assert.equal(row.contentBase64,undefined);
   body=await readFile(path.join(packageRoot,operation.payload));
  }else{
   assert.equal(row.frozenPackagePayload,undefined);body=Buffer.from(row.contentBase64,'base64');
   assert.equal(body.toString('base64'),row.contentBase64);
  }
  assert.equal(integritySha256(body),row.sha256);bytes.set(row.path,body);
 }
 return bytes;
}

test('active v7 public source inventory and every frozen v6 byte retain exact integrity',async()=>{
 const result=await verifyActiveIntegrity(root,manifest);
 assert.equal(result.activeSourceCount,36);assert.equal(result.frozenV6FileCount,10);assert.equal(result.installable,false);
 await verifiedHistory();
});

test('active integrity rejects missing cache dependencies, missing pins, unexpected entries and source drift',async()=>{
 for(const change of [
  value=>{value.sources=value.sources.filter(row=>row.path!=='server/factory-api-token-cost.ts');},
  value=>{delete value.sources.find(row=>row.path==='server/factory-api-sdk.ts').sha256;},
  value=>{value.sources.push({path:'server/assistant.ts',sha256:'a'.repeat(64)});},
  value=>{value.sources[0].sha256='0'.repeat(64);},
  value=>{value.sources[0]=value.sources[1];},
  value=>{value.predecessor.manifestSha256='0'.repeat(64);},
 ]){const changed=structuredClone(manifest);change(changed);await assert.rejects(verifyActiveIntegrity(root,changed),/INTEGRITY_MISMATCH/);}
 assert.ok(REQUIRED_SOURCES.includes('server/factory-api-cache-usage.ts'));
 assert.ok(REQUIRED_SOURCES.includes('server/software-factory-openai-count.ts'));
});

test('unchanged 15 v6 staging tests retain portable guards and no-clobber behavior on explicit historical public postimages',async()=>{
 const postimages=await verifiedHistory(),temporary=await mkdtemp(path.join(tmpdir(),'office-v6-history-'));
 try{
  const canonical=path.join(temporary,'historical'),copiedPackage=path.join(canonical,'script/office-api-budget-v6');
  await mkdir(path.dirname(copiedPackage),{recursive:true});await cp(packageRoot,copiedPackage,{recursive:true,filter:source=>!source.split(path.sep).includes('__pycache__')});
  for(const [relative,bytes] of postimages){const target=path.join(canonical,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  for(const relative of Object.keys(historical.frozenPackageFiles))assert.equal(integritySha256(await readFile(path.join(copiedPackage,relative))),historical.frozenPackageFiles[relative]);
  const run=spawnSync('python3',[path.join(copiedPackage,'test_stage.py')],{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH}});
  assert.equal(run.status,0,run.stderr);assert.match(run.stderr,/Ran 15 tests/);assert.match(run.stderr,/\bOK\b/);
 }finally{await rm(temporary,{recursive:true,force:true});}
});

test('frozen v6 rejects current SDK drift without source changes, backup creation or private guards',()=>{
 const program=`import importlib.util,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('v6_frozen',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)\ncase=module.StageTests('test_dry_no_writes');case.setUp()\ntry:\n target=case.root/'server/factory-api-sdk.ts';target.write_bytes(Path(sys.argv[2]).read_bytes());before=case.snapshot()\n try: case.run_stage(True)\n except case.module.Held as error: assert str(error)=='STAGE_PREIMAGE_CHANGED',str(error)\n else: raise AssertionError('current drift was accepted')\n assert case.snapshot()==before\n assert not (case.top/'backup').exists()\n print('FROZEN_V6_CURRENT_DRIFT_HELD_NO_WRITES')\nfinally: case.doCleanups()\n`;
 const run=spawnSync('python3',['-c',program,path.join(packageRoot,'test_stage.py'),path.join(root,'server/factory-api-sdk.ts')],{encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/FROZEN_V6_CURRENT_DRIFT_HELD_NO_WRITES/);
});
