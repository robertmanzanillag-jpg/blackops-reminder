import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile,stat,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {derivativeFixture,DERIVATIVE_NOW as NOW,fixtureProbe} from './helpers/reviewed-derivative-fixture.mjs';
import {reviewedDerivativeDigest,approveReviewedDerivative} from '../shared/clippers-reviewed-derivative.mjs';
import {emptyStreamerState,STREAMER_STATE_NAMESPACE} from '../script/clippers-streamer-discovery.mjs';
import {reservePrivateFinal,putPrivateFinalChunk,finalizePrivateFinal,privateFinalStatus,assertPrivateFinalReady,streamPrivateFinalRange,sealPrivateFinal,cleanupPrivateFinals,CHUNK_BYTES,OWNER_ACTIVE_BYTES} from '../script/clippers-private-final-store.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function memory(){const data=new Map(),locks=new Map(),inside=new AsyncLocalStorage();return{data,read:async k=>{assert.notEqual(inside.getStore(),true,'no storage/network reads inside a transaction');return data.get(k)??null;},transact:async(k,fn)=>{const previous=locks.get(k)??Promise.resolve();let release;const gate=new Promise(r=>release=r);locks.set(k,previous.then(()=>gate));await previous;try{const raw=await inside.run(true,()=>fn(data.get(k)??null));JSON.parse(raw);data.set(k,raw);return raw;}finally{release();}}};}
function recordFor(bytes,id='private-fixture',owner='fixture-owner'){
 const m=derivativeFixture().manifest;m.id=id;m.media={storageKind:'private_council_v1',privateFinalRef:'final-'+hash(bytes),sha256:hash(bytes),byteLength:bytes.length,durationSeconds:20,width:1080,height:1920,audio:'absent'};m.qa.finalSha256=m.media.sha256;
 const record={status:'proposed',proposedBy:owner,proposedAt:new Date(NOW).toISOString(),manifest:m,manifestSha256:reviewedDerivativeDigest(m)};
 return record;
}
async function upload(store,record,bytes,owner='fixture-owner'){
 await reservePrivateFinal({store,owner,record,now:NOW});for(let start=0,index=0;start<bytes.length;start+=CHUNK_BYTES,index++){const chunk=bytes.subarray(start,Math.min(bytes.length,start+CHUNK_BYTES));await putPrivateFinalChunk({store,owner,record,index,bytes:chunk,sha256:hash(chunk),now:NOW});}return finalizePrivateFinal({store,owner,record,now:NOW});
}
async function register(store,records,owner='fixture-owner'){const state=emptyStreamerState();state.reviewedDerivatives={version:1,records:Object.fromEntries(records.map(r=>[r.manifest.id,r]))};store.data.set(STREAMER_STATE_NAMESPACE(owner),JSON.stringify(state));}
async function collect(input){const chunks=[];for await(const c of streamPrivateFinalRange(input))chunks.push(c);return Buffer.concat(chunks);}
test('private bytes require exact owner/proposal/ref binding; multi-chunk finalize and ranges preserve bytes without public URL or arbitrary path',async()=>{
 const store=memory(),bytes=Buffer.alloc(CHUNK_BYTES+1200,0x41),r=recordFor(bytes);const input={store,owner:'fixture-owner',record:r};assert.equal((await privateFinalStatus(input)).status,'missing');await assert.rejects(assertPrivateFinalReady(input),/not_ready/);
 const complete=await upload(store,r,bytes);assert.equal(complete.ready,true);assert.equal(complete.receivedChunks,2);assert.equal(complete.ownerUsageBytes,bytes.length);assert.deepEqual(await collect({...input,start:CHUNK_BYTES-10,end:CHUNK_BYTES+19}),bytes.subarray(CHUNK_BYTES-10,CHUNK_BYTES+20));
 await assert.rejects(collect({...input,start:0,end:bytes.length}),/range_invalid/);await assert.rejects(privateFinalStatus({...input,owner:'other-owner'}),/binding_invalid/);
 const forged=structuredClone(r);forged.manifest.media.privateFinalRef='../../secret';forged.manifestSha256=reviewedDerivativeDigest(forged.manifest);await assert.rejects(reservePrivateFinal({...input,record:forged,now:NOW}),/binding_invalid/);
 assert.ok([...store.data.keys()].every(k=>!k.includes('http')&&!k.includes('..')));assert.ok([...store.data.values()].filter(v=>!v.includes('"data":')).every(v=>Buffer.byteLength(v)<262144));
});
test('ordered immutable chunks retry idempotently; size/hash/whole-hash mismatches cannot become ready',async()=>{
 const store=memory(),bytes=Buffer.alloc(CHUNK_BYTES+1024,0x42),r=recordFor(bytes);const input={store,owner:'fixture-owner',record:r,now:NOW};await reservePrivateFinal(input);
 await assert.rejects(putPrivateFinalChunk({...input,index:1,bytes:bytes.subarray(CHUNK_BYTES),sha256:hash(bytes.subarray(CHUNK_BYTES))}),/chunk_order/);
 await assert.rejects(putPrivateFinalChunk({...input,index:0,bytes:bytes.subarray(0,CHUNK_BYTES),sha256:'a'.repeat(64)}),/chunk_invalid/);
 const chunk=bytes.subarray(0,CHUNK_BYTES);await putPrivateFinalChunk({...input,index:0,bytes:chunk,sha256:hash(chunk)});await putPrivateFinalChunk({...input,index:0,bytes:chunk,sha256:hash(chunk)});assert.equal((await privateFinalStatus(input)).receivedChunks,1);
 await assert.rejects(finalizePrivateFinal(input),/incomplete/);const wrong=Buffer.alloc(1024,0x43);await putPrivateFinalChunk({...input,index:1,bytes:wrong,sha256:hash(wrong)});await assert.rejects(finalizePrivateFinal(input),/whole_hash_mismatch/);assert.equal((await privateFinalStatus(input)).status,'invalid');
});
test('active cap includes incomplete reservations across midnight; same SHA shared proposals count once and concurrent new files cannot overbook',async()=>{
 const store=memory(),one=recordFor(Buffer.alloc(32*1024*1024,0x31),'one'),two=recordFor(Buffer.alloc(32*1024*1024,0x32),'two'),extra=recordFor(Buffer.alloc(1024,0x33),'extra');const base={store,owner:'fixture-owner',now:NOW};
 await Promise.all([reservePrivateFinal({...base,record:one}),reservePrivateFinal({...base,record:two})]);const shared=structuredClone(one);shared.manifest.id='same-bytes-shared';shared.manifestSha256=reviewedDerivativeDigest(shared.manifest);assert.equal((await reservePrivateFinal({...base,record:shared})).ownerUsageBytes,OWNER_ACTIVE_BYTES);
 await assert.rejects(reservePrivateFinal({...base,record:extra}),/owner_capacity/);const tomorrow=recordFor(Buffer.alloc(1024,0x34),'tomorrow');tomorrow.manifest.scheduledAt=new Date(NOW+27*3600000).toISOString();tomorrow.manifest.windowStart=new Date(NOW+26*3600000).toISOString();tomorrow.manifest.windowEnd=new Date(NOW+28*3600000).toISOString();tomorrow.manifest.expiresAt=new Date(NOW+30*3600000).toISOString();tomorrow.manifestSha256=reviewedDerivativeDigest(tomorrow.manifest);await assert.rejects(reservePrivateFinal({...base,record:tomorrow,now:NOW+24*3600000}),/owner_capacity/);
 const other=memory(),a=recordFor(Buffer.alloc(24*1024*1024,0x51),'a'),b=recordFor(Buffer.alloc(24*1024*1024,0x52),'b'),c=recordFor(Buffer.alloc(24*1024*1024,0x53),'c');const out=await Promise.allSettled([a,b,c].map(record=>reservePrivateFinal({store:other,owner:'fixture-owner',record,now:NOW})));assert.equal(out.filter(x=>x.status==='fulfilled').length,2);assert.equal(out.filter(x=>x.status==='rejected').length,1);
});
test('only an approved exact private final can be sealed into0700/0600 temporary storage and it is always cleaned',async()=>{
 const store=memory(),bytes=Buffer.alloc(1536,0x44),r=recordFor(bytes);await upload(store,r,bytes);await assert.rejects(sealPrivateFinal({store,owner:'fixture-owner',record:r,now:NOW,probe:async()=>fixtureProbe}),/owner_approval_required/);
 const approved=approveReviewedDerivative(r,{principal:'fixture-owner',operatorLabel:'TEST ONLY',expectedDigest:r.manifestSha256,attestRights:true,attestExternalQa:true,now:NOW});const sealed=await sealPrivateFinal({store,owner:'fixture-owner',record:approved,now:NOW,probe:async()=>fixtureProbe});try{assert.equal((await stat(sealed.file)).mode&0o777,0o600);assert.equal((await stat(path.dirname(sealed.file))).mode&0o777,0o700);assert.deepEqual(await readFile(sealed.file),bytes);}finally{await sealed.cleanup();}await assert.rejects(access(sealed.file));
});
test('shared refs prevent premature purge; revoked unused bytes retire only after allrefs and source/publication history remains',async()=>{
 const store=memory(),bytes=Buffer.alloc(1536,0x45),one=recordFor(bytes,'one'),two=recordFor(bytes,'two');await upload(store,one,bytes);await reservePrivateFinal({store,owner:'fixture-owner',record:two,now:NOW});one.status='revoked';await register(store,[one,two]);let result=await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW});assert.equal(result.retired,0);assert.equal((await privateFinalStatus({store,owner:'fixture-owner',record:two})).ready,true);
 two.status='revoked';await register(store,[one,two]);result=await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW});assert.equal(result.retired,1);assert.equal(result.bytesReclaimed,bytes.length);assert.equal((await privateFinalStatus({store,owner:'fixture-owner',record:two})).ownerUsageBytes,0);assert.ok([...store.data.values()].some(raw=>raw.includes('"status":"purged"')));assert.equal(JSON.parse(store.data.get(STREAMER_STATE_NAMESPACE('fixture-owner'))).reviewedDerivatives.records.one.status,'revoked');
 const next=recordFor(bytes,'new-permission');await upload(store,next,bytes);assert.equal((await privateFinalStatus({store,owner:'fixture-owner',record:next})).ready,true);const meta=[...store.data.entries()].find(([k])=>k.endsWith(':meta'))[1];assert.equal(JSON.parse(meta).history.length,1);
});
test('unknown writes, unknown public uploads and missing owner records preserve private bytes; exact verifiednativecopy permits retirement',async()=>{
 const store=memory(),bytes=Buffer.alloc(1536,0x46),r=recordFor(bytes);await upload(store,r,bytes);r.status='revoked';r.delivery={id:'unknown',status:'verification_pending',writeStartedAt:new Date(NOW).toISOString()};await register(store,[r]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW+1000})).retired,0);
 r.delivery={status:'held_staging_reconciliation',stageIntent:{name:'unknown-upload'}};await register(store,[r]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW+1000})).retired,0);
 await register(store,[]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW+1000})).retired,0);
 r.delivery={id:'known',status:'scheduled',writeStartedAt:new Date(NOW).toISOString(),copyVerifiedAt:new Date(NOW).toISOString(),confirmedMediaUrl:'https://static.metricool.com/private/final.mp4',confirmedMediaSha256:r.manifest.media.sha256,confirmedByteLength:bytes.length};await register(store,[r]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW+1000})).retired,1);
});

test('an index-only reservation lost before metadata commit can retire after irreversible revocation with tombstones, never a blind quota refund',async()=>{
 const store=memory(),bytes=Buffer.alloc(1536,0x47),r=recordFor(bytes);const original=store.transact;let failOnce=true;store.transact=async(k,fn)=>{if(failOnce&&k.endsWith(':meta')){failOnce=false;throw Error('metadata_commit_unavailable');}return original(k,fn);};await assert.rejects(reservePrivateFinal({store,owner:'fixture-owner',record:r,now:NOW}),/metadata_commit_unavailable/);
 assert.equal([...store.data.values()].filter(x=>JSON.parse(x).files).map(x=>Object.values(JSON.parse(x).files).reduce((s,e)=>s+e.byteLength,0))[0],bytes.length);
 r.status='revoked';await register(store,[r]);const result=await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW});assert.equal(result.bytesReclaimed,bytes.length);assert.equal((await privateFinalStatus({store,owner:'fixture-owner',record:r})).ownerUsageBytes,0);assert.ok([...store.data.entries()].some(([key,value])=>key.includes(':chunk:')&&JSON.parse(value).status==='purged'));
});
test('a late in-flight chunk writer cannot resurrect bytes after a revoked private epoch was tombstoned',async()=>{
 const store=memory(),bytes=Buffer.alloc(1536,0x48),r=recordFor(bytes),cached=structuredClone(r);await reservePrivateFinal({store,owner:'fixture-owner',record:r,now:NOW});const original=store.transact;let waitingResolve,release;const waiting=new Promise(r=>waitingResolve=r),gate=new Promise(r=>release=r);let block=true;
 store.transact=async(k,fn)=>{if(block&&k.includes(':chunk:')){block=false;waitingResolve();await gate;}return original(k,fn);};
 const pending=putPrivateFinalChunk({store,owner:'fixture-owner',record:cached,index:0,bytes,sha256:hash(bytes),now:NOW});await waiting;r.status='revoked';await register(store,[r]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW})).retired,1);release();await assert.rejects(pending,/chunk_conflict/);
 assert.ok([...store.data.entries()].filter(([key])=>key.includes(':chunk:')).every(([,value])=>JSON.parse(value).data===undefined));
});

test('malformed legacy external-delivery markers cannot become proof of unused private bytes merely because writeStartedAt is missing',async()=>{
 for(const delivery of [{status:'scheduled',metricoolId:'777'},{status:'held_staging_reconciliation'},{status:'pending_stage',asset:{id:1}},{status:'held_before_write',metricoolUuid:'existing-uuid'},{status:'pending_write'},{status:'unknown'}]){
  const store=memory(),bytes=Buffer.alloc(1536,0x49),r=recordFor(bytes);await upload(store,r,bytes);r.status='revoked';r.delivery=delivery;await register(store,[r]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW})).retired,0,JSON.stringify(delivery));assert.equal((await privateFinalStatus({store,owner:'fixture-owner',record:r})).ready,true);
 }
});

test('a reseal reservation lost before replacing older purged metadata recovers only its new unused epoch and preserves prior history',async()=>{
 const store=memory(),bytes=Buffer.alloc(1536,0x50),old=recordFor(bytes,'old-cached-copy');await upload(store,old,bytes);old.status='revoked';await register(store,[old]);assert.equal((await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW})).retired,1);
 const next=recordFor(bytes,'new-unfinished-copy'),original=store.transact;let failOnce=true;store.transact=async(k,fn)=>{if(failOnce&&k.endsWith(':meta')){failOnce=false;throw Error('new_meta_write_lost');}return original(k,fn);};await assert.rejects(reservePrivateFinal({store,owner:'fixture-owner',record:next,now:NOW}),/new_meta_write_lost/);next.status='revoked';await register(store,[old,next]);
 const result=await cleanupPrivateFinals({store,owner:'fixture-owner',now:NOW+1});assert.equal(result.retired,1);assert.equal(result.bytesReclaimed,bytes.length);const status=await privateFinalStatus({store,owner:'fixture-owner',record:next});assert.equal(status.ownerUsageBytes,0);assert.equal(status.status,'purged');const meta=JSON.parse([...store.data.entries()].find(([k])=>k.endsWith(':meta'))[1]);assert.equal(meta.epoch,2);assert.equal(meta.history[0].epoch,1);assert.equal(meta.history[0].references[old.manifestSha256].proposalId,old.manifest.id);assert.ok([...store.data.entries()].some(([k,v])=>k.includes(':epoch:2:chunk:')&&JSON.parse(v).status==='purged'));
});
