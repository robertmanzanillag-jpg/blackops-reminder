import {createHash} from 'node:crypto';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';

export const V6_MANIFEST_SHA256='786da807c7bf5d480292d941b017aee0450077b531f2264c5afb85b5baad0a1e';
export const V6_SOURCE_COMMIT='96aae6c6718b437321031c4d3a418c94236020d5';
export const HISTORICAL_FIXTURE_SHA256='2e66f0abc9aff73ddca5884a1e777ac3253262cd2e1539beec913804c5139bf3';
export const REQUIRED_SOURCES=Object.freeze([
  "script/software-factory-pilot-exports.ts",
  "server/ai-model-router.ts",
  "server/clippers-local-news-translation.ts",
  "server/factory-api-cache-usage.ts",
  "server/factory-api-context.ts",
  "server/factory-api-invocation.ts",
  "server/factory-api-sdk.ts",
  "server/factory-api-token-cost.ts",
  "server/gemini-client.ts",
  "server/office-execution.ts",
  "server/office-openai.ts",
  "server/office-protocol.ts",
  "server/office-shared-credits.ts",
  "server/office-token-budget.ts",
  "server/openai-client.ts",
  "server/shared-openai-credit-ledger.ts",
  "server/shared-openai-credit-runtime.ts",
  "server/software-factory-anthropic.ts",
  "server/software-factory-api-budget.ts",
  "server/software-factory-asistente-build.ts",
  "server/software-factory-asistente-operator.ts",
  "server/software-factory-asistente-review.ts",
  "server/software-factory-company-auto.ts",
  "server/software-factory-model-routes.ts",
  "server/software-factory-object-store.ts",
  "server/software-factory-openai-builder.ts",
  "server/software-factory-openai-count.ts",
  "server/software-factory-openai-transport.ts",
  "server/software-factory-openai.ts",
  "server/software-factory-pilot-review.ts",
  "server/software-factory-responses-runtime.ts",
  "server/software-factory-routes.ts",
  "server/software-factory-store-provider.ts",
  "server/software-factory-store.ts",
  "server/software-factory-worker.ts"
]);
export const integritySha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hold=()=>{throw Error('OFFICE_API_BUDGET_INTEGRITY_MISMATCH');};
async function publicBytes(root,relative){
 const target=path.join(root,relative),info=await lstat(target);
 if(!info.isFile()||info.isSymbolicLink()||info.size>2_097_152||await realpath(path.dirname(target))!==path.dirname(target))hold();
 return readFile(target);
}
async function filesUnder(directory,prefix=''){
 const found=[];
 for(const name of (await readdir(directory)).sort()){
  if(name==='__pycache__')continue;
  const file=path.join(directory,name),info=await lstat(file),relative=prefix+name;
  if(info.isSymbolicLink())hold();
  if(info.isDirectory())found.push(...await filesUnder(file,relative+'/'));
  else if(info.isFile())found.push(relative);else hold();
 }
 return found;
}
/** Read-only canonical-source check. This is not a source installer or a billing approval. */
export async function verifyActiveIntegrity(root,manifest){
 root=await realpath(root);
 if(manifest?.version!==7||manifest.kind!=='canonical_api_budget_source_integrity_only'||manifest.installable!==false||
    manifest.predecessor?.manifestSha256!==V6_MANIFEST_SHA256||manifest.predecessor?.sourceCommit!==V6_SOURCE_COMMIT||
    manifest.predecessor?.historicalFixtureSha256!==HISTORICAL_FIXTURE_SHA256||!Array.isArray(manifest.sources))hold();
 const names=manifest.sources.map(row=>row?.path);
 if(names.length!==REQUIRED_SOURCES.length||new Set(names).size!==names.length||
    JSON.stringify([...names].sort())!==JSON.stringify(REQUIRED_SOURCES))hold();
 for(const row of manifest.sources){
  if(Object.keys(row).sort().join(',')!=='path,sha256'||!/^[a-f0-9]{64}$/.test(row.sha256)||
      integritySha256(await publicBytes(root,row.path))!==row.sha256)hold();
 }
 const historicalBytes=await publicBytes(root,'tests/fixtures/office-api-budget-v6-public/snapshot.json');
 if(integritySha256(historicalBytes)!==HISTORICAL_FIXTURE_SHA256)hold();
 const historical=JSON.parse(historicalBytes.toString('utf8'));
 if(historical.sourceCommit!==V6_SOURCE_COMMIT||historical.v6ManifestSha256!==V6_MANIFEST_SHA256||
    JSON.stringify(historical.frozenPackageFiles)!==JSON.stringify(manifest.predecessor.frozenPackageFiles))hold();
 const packageRoot=path.join(root,'script/office-api-budget-v6'),namesInPackage=await filesUnder(packageRoot);
 if(JSON.stringify(namesInPackage.sort())!==JSON.stringify(Object.keys(historical.frozenPackageFiles).sort()))hold();
 for(const [relative,digest] of Object.entries(historical.frozenPackageFiles)){
  if(integritySha256(await publicBytes(packageRoot,relative))!==digest)hold();
 }
 if(historical.frozenPackageFiles['manifest.json']!==V6_MANIFEST_SHA256)hold();
 return {kind:'read_only_source_integrity',activeSourceCount:names.length,frozenV6FileCount:namesInPackage.length,installable:false};
}
