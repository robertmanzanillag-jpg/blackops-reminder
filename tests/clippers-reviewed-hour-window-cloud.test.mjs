import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewedHourWindowReadiness,runReviewedHourWindowCloud,reviewedHourWindowMain} from '../script/clippers-reviewed-hour-window-cloud.mjs';
import {emptyStreamerState,STREAMER_STATE_NAMESPACE} from '../script/clippers-streamer-discovery.mjs';
const env=()=>({CLIPPERS_REVIEWED_HOUR_WINDOW_ENABLED:'true',CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED:'true',DATABASE_URL:'postgresql://fixture.invalid/not-used',DEFAULT_USER_ID:'fixture-owner',METRICOOL_USER_TOKEN:'fixture-token',METRICOOL_USER_ID:'fixture-user',GITHUB_TOKEN:'fixture-github',GITHUB_REPOSITORY:'robertmanzanillag-jpg/blackops-reminder'});
function backend(raw=JSON.stringify(emptyStreamerState())){const calls=[];return{calls,read:async ns=>{calls.push(ns);return raw;},transact:async()=>{throw Error('due check must never transact');}};}
const due=async()=>['reviewed-fixture'];
test('explicit hour-window opt-in and every missing identity/kill/dry-run fence stop before storage or adapter construction',async()=>{
 for(const change of [{CLIPPERS_STREAMERS_CLOUD_ENABLED:'false'},{CLIPPERS_REVIEWED_HOUR_WINDOW_ENABLED:''},{CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED:'false'},{CLIPPERS_STREAMER_CLOUD_KILL_SWITCH:'true'},{CLIPPERS_STREAMER_CLOUD_DRY_RUN:'true'},{DATABASE_URL:''},{DEFAULT_USER_ID:''},{METRICOOL_USER_TOKEN:''},{METRICOOL_USER_ID:''},{GITHUB_TOKEN:''},{GITHUB_REPOSITORY:'invalid'}]){
  let touched=false;const options={env:{...env(),...change},getStore:async()=>{touched=true;throw Error('storage must stay untouched');},createMetricool:()=>{throw Error('no client');},createStager:()=>{throw Error('no stager');},runWorker:()=>{throw Error('no writer');},dueRecords:due};
  assert.equal((await reviewedHourWindowReadiness(options)).dueCount,0);assert.equal((await runReviewedHourWindowCloud(options)).scheduled,0);assert.equal(touched,false,JSON.stringify(change));
 }
});
test('read-only readiness uses the exact owner namespace and count, without exposing IDs or mutating data',async()=>{
 const store=backend();let observed;
 const result=await reviewedHourWindowReadiness({env:env(),store,clock:()=>123,dueRecords:async(state,options)=>{observed={state,options};return ['private-proposal-1','private-proposal-2'];}});
 assert.deepEqual(result,{status:'due',dueCount:2,maintenanceCount:0});assert.deepEqual(store.calls,[STREAMER_STATE_NAMESPACE('fixture-owner')]);assert.equal(observed.options.now,123);assert.equal(observed.state.version,1);assert.equal(JSON.stringify(result).includes('private-proposal'),false);
});
test('empty, malformed and unsupported due states stay idle/held and never construct providers or run worker',async()=>{
 for(const [raw,dueRecords,expected] of [[null,due,'held'],['{bad',due,'held'],[JSON.stringify(emptyStreamerState()),async()=>[],'idle'],[JSON.stringify(emptyStreamerState()),async()=>null,'held'],[JSON.stringify(emptyStreamerState()),async()=>Array.from({length:501},()=> 'x'),'held']]){
  let providerCalls=0;const result=await runReviewedHourWindowCloud({env:env(),store:backend(raw),dueRecords,createMetricool:()=>providerCalls++,createStager:()=>providerCalls++,runWorker:()=>providerCalls++});assert.equal(result.status,expected);assert.equal(result.scheduled,0);assert.equal(providerCalls,0);
 }
});
test('a due run delegates only to the reviewed worker with explicit dispatch mode and shared existing identities',async()=>{
 const store=backend(),metricool={},stager={};let call,metricoolOptions,stageOptions;
 const result=await runReviewedHourWindowCloud({env:env(),store,clock:()=>123,dueRecords:due,createMetricool:options=>(metricoolOptions=options,metricool),createStager:options=>(stageOptions=options,stager),runWorker:async options=>{call=options;return{status:'completed',scheduled:1,verificationPending:1,held:['derivative_source_or_media_duplicate','provider https://secret.invalid/private caption'],privateUrl:'https://never-log.invalid/media'};}});
 assert.equal(call.dispatchMode,'owner_hour_window');assert.equal(call.owner,'fixture-owner');assert.equal(call.store,store);assert.equal(call.metricool,metricool);assert.equal(call.stager,stager);assert.equal(call.clock(),123);assert.equal(call.config.enabled,true);assert.deepEqual(metricoolOptions,{token:'fixture-token',userId:'fixture-user'});assert.deepEqual(stageOptions,{token:'fixture-github',repo:'robertmanzanillag-jpg/blackops-reminder'});
 assert.deepEqual(result,{status:'completed',dueCount:1,maintenanceCount:0,scheduled:1,verificationPending:1,held:['derivative_source_or_media_duplicate','hour_window_dependency_unavailable']});assert.equal(JSON.stringify(result).includes('https:'),false);
});
test('CLI accepts only bounded read-only check or actual final-only run and rejects arbitrary arguments/output paths',async()=>{
 const options={env:env(),store:backend(),dueRecords:async()=>[]};assert.equal((await reviewedHourWindowMain(['--due-check'],options)).status,'idle');assert.equal((await reviewedHourWindowMain([],options)).scheduled,0);
 for(const args of [['--raw'],['--due-check','--due-check'],['--output','/tmp/anything']])await assert.rejects(reviewedHourWindowMain(args,options),/hour_window_arguments_invalid/);
});
test('workflow reuses one writer concurrency and existing trigger; opt-in runner has due check before FFmpeg without raw or AI tools',async()=>{
 const text=await readFile(new URL('../.github/workflows/clippers-streamers-publish.yml',import.meta.url),'utf8');
 const hour=text.split('  reviewed-hour-window:\n')[1].split('\n  publish:\n')[0],raw=text.split('\n  publish:\n')[1].split('\n  branch-dry-run:\n')[0];
 assert.match(text,/group: clippers-streamers-publish\n  cancel-in-progress: false/);assert.match(text,/workflow_run:\n    workflows: \["Office worker \(cloud\)"\]/);assert.doesNotMatch(text,/\n\s+schedule:/);
 assert.match(hour,/CLIPPERS_REVIEWED_HOUR_WINDOW_ENABLED == 'true'/);assert.match(raw,/CLIPPERS_REVIEWED_HOUR_WINDOW_ENABLED != 'true'/);
 for(const guard of ["CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED == 'true'","CLIPPERS_STREAMER_CLOUD_KILL_SWITCH != 'true'","github.ref != 'refs/heads/main'",'inputs.growth_only','inputs.dry_run'])assert.ok(hour.includes(guard),guard);
 assert.doesNotMatch(hour,/\$\{\{ env\.CLIPPERS_DRY_RUN_REQUESTED/,'job-level env cannot reference the env context');
 assert.match(hour,/timeout-minutes: 20/);assert.match(hour,/node-version: 22/);assert.match(hour,/persist-credentials: false/);assert.ok(hour.indexOf('--due-check')<hour.indexOf('apt-get install'));
 assert.match(hour,/if: steps\.due\.outputs\.run == 'true'/);assert.doesNotMatch(hour,/yt-dlp|whisper|TWITCH_CLIENT|YOUTUBE_API|--respect-interval|CLIPPERS_STREAMER_CLOUD_MIN_INTERVAL/);assert.match(raw,/Clock gate \(New York 09:00-19:59, minute < 15/);
});


test('no-new-due records still receive bounded known-copy and controlled-stage maintenance without replaying unknown writes',async()=>{
 const state=emptyStreamerState(),base={proposedBy:'fixture-owner',status:'approved',manifest:{dispatch:{mode:'owner_hour_window'}}};
 state.reviewedDerivatives={records:{
  pendingCopy:{...base,delivery:{writeStartedAt:'2026-11-22T10:00:00.000Z',metricoolId:'123',metricoolUuid:'uuid123',status:'verification_pending'}},
  copiedStage:{...base,delivery:{writeStartedAt:'2026-11-22T10:00:00.000Z',metricoolId:'124',metricoolUuid:'uuid124',copyVerifiedAt:'2026-11-22T10:01:00.000Z',status:'scheduled',asset:{id:'stage124'}}},
  prewriteStage:{...base,delivery:{status:'held_staging_reconciliation',stageIntent:{name:'pending-stage'}}},
  pendingStage:{...base,delivery:{status:'pending_stage'}},
  fenced:{...base,status:'revoked',delivery:{status:'cleanup_fenced'}},
  noIdentity:{...base,delivery:{writeStartedAt:'2026-11-22T10:00:00.000Z',status:'verification_pending'}},
  unknownBeforeWrite:{...base,delivery:{status:'verification_pending'}},
  exact:{...base,manifest:{},delivery:{writeStartedAt:'2026-11-22T10:00:00.000Z',metricoolId:'125',metricoolUuid:'uuid125'}},
  unapproved:{...base,status:'proposed',delivery:{status:'pending_stage'}},
  otherOwner:{...base,proposedBy:'other-owner',delivery:{status:'pending_stage'}},
  completed:{...base,delivery:{writeStartedAt:'2026-11-22T10:00:00.000Z',metricoolId:'126',metricoolUuid:'uuid126',copyVerifiedAt:'2026-11-22T10:01:00.000Z',status:'scheduled'}}
 }};
 const store=backend(JSON.stringify(state)),options={env:env(),store,dueRecords:async()=>[]};
 assert.deepEqual(await reviewedHourWindowReadiness(options),{status:'maintenance',dueCount:0,maintenanceCount:6});let called=0;
 const result=await runReviewedHourWindowCloud({...options,createMetricool:()=>({}),createStager:()=>({}),runWorker:async args=>{called++;assert.equal(args.dispatchMode,'owner_hour_window');return{status:'completed',scheduled:0};}});assert.equal(called,1);assert.equal(result.scheduled,0);assert.equal(result.maintenanceCount,6);
 const negative={...state,reviewedDerivatives:{records:Object.fromEntries(Object.entries(state.reviewedDerivatives.records).filter(([id])=>['noIdentity','unknownBeforeWrite','unapproved','otherOwner','completed'].includes(id)))}};
 assert.deepEqual(await reviewedHourWindowReadiness({...options,store:backend(JSON.stringify(negative))}),{status:'idle',dueCount:0,maintenanceCount:0});
});
