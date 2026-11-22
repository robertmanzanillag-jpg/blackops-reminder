import test from 'node:test';
import assert from 'node:assert/strict';
import {observedPosts,computeLearning,latestViews,computeGrowth} from '../script/clippers-streamer-cloud-learning.mjs';
import {BREAKOUT_FOLLOWUP_CLIPS} from '../shared/clippers-account-lanes.mjs';
const NOW=Date.parse('2026-11-22T18:00:00.000Z'),HOUR=3600000,KEY='6431685:tiktok:streamersus',EXTERNAL='owner_authorized_external_review';
const iso=t=>new Date(t).toISOString();
const post=(id,extra={})=>({id,destinationKey:KEY,creatorKey:'twitch:reviewed-camera',hookVariant:'title',status:'scheduled',scheduledAt:iso(NOW-HOUR),...extra});
const observation={views:500000,ageHours:25,publishedAt:iso(NOW-25*HOUR),observedAt:iso(NOW),platformPostId:'real-platform-id',completionRate:0.9};
test('reviewed origin cannot become legacy hook/creator learning through a copied observation or guessed variant',()=>{
 const external=Array.from({length:12},(_,i)=>post('reviewed-'+i,{origin:EXTERNAL,observation:{...observation},hookVariant:i%2?'title':'teaser'}));
 assert.deepEqual(observedPosts(external),[]);const empty=computeLearning(external,{now:NOW});assert.equal(empty.samples,0);assert.deepEqual(empty.creatorBoost,{});assert.deepEqual(empty.hookPreference,{});
 const raw=post('raw',{creatorKey:'twitch:raw',observation:{...observation}});assert.deepEqual(observedPosts([...external,raw]),[raw]);assert.equal(computeLearning([...external,raw],{now:NOW}).samples,1);
});
test('reviewed origin never uses the legacy nearby-time or exact-observation fallback; raw matching stays unchanged',()=>{
 const row={id:'real-platform-id',views:500000,publishedAt:iso(NOW-HOUR),observedAt:iso(NOW),actualAgeHours:1};
 assert.equal(latestViews(post('reviewed',{origin:EXTERNAL}),[row]),null);
 assert.equal(latestViews(post('copied-observation',{origin:EXTERNAL,observation:{...observation}}),[row]),null);
 assert.equal(latestViews(post('raw'),[row]).views,500000);assert.equal(latestViews(post('raw-observed',{observation:{...observation}}),[]).platformPostId,'real-platform-id');
});
test('real whole-account totals remain intact while external nearby rows create no source/hour kills, breakouts or creator doubling',()=>{
 for(const views of [1,500000]){
  const posts=Array.from({length:6},(_,i)=>post('reviewed-'+i,{origin:EXTERNAL,scheduledAt:iso(NOW-HOUR+i*60000)}));
  const rows=posts.map((p,i)=>({id:'platform-'+i,views,publishedAt:p.scheduledAt,observedAt:iso(NOW),actualAgeHours:1})),before=JSON.stringify({posts,rows});
  const result=computeGrowth({posts,accountPosts:{[KEY]:rows},now:NOW});assert.equal(result.accounts[KEY].weeklyPosts,6);assert.equal(result.accounts[KEY].weeklyViews,6*views);assert.equal(result.accounts[KEY].weeklyMedian,views);assert.equal(result.accounts[KEY].source,'metricool_account_analytics');assert.deepEqual(result.kills,[]);assert.deepEqual(result.breakouts,[]);assert.deepEqual(result.doubled,[]);assert.equal(result.decisions.some(x=>/^(kill_|breakout:|double_creator:)/.test(x)),false);assert.equal(JSON.stringify({posts,rows}),before,'preserve actual receipts/source and quota reservations');
 }
 assert.deepEqual(computeGrowth({posts:[post('no-real-metrics',{origin:EXTERNAL,observation:{...observation}})],now:NOW}).accounts,{},'no external ledger observation masquerades as account data');
});
test('valid raw breakout remains attributed to raw source and reviewed finals do not consume its requested follow-up count',()=>{
 const raw=post('raw-winner',{creatorKey:'twitch:raw',streamKey:'vod:raw'}),detectedAt=iso(NOW-120000);
 const external=Array.from({length:6},(_,i)=>post('external-followup-'+i,{origin:EXTERNAL,creatorKey:raw.creatorKey,streamKey:raw.streamKey,attemptedAt:iso(NOW-60000),scheduledAt:iso(NOW-30000)}));
 const rows=[{id:'raw-platform',views:150000,publishedAt:raw.scheduledAt,observedAt:iso(NOW),actualAgeHours:1}];
 const out=computeGrowth({posts:[raw,...external],accountPosts:{[KEY]:rows},previous:{breakouts:[{postId:raw.id,detectedAt}]},now:NOW});assert.equal(out.breakouts.length,1);assert.equal(out.breakouts[0].postId,raw.id);assert.equal(out.breakouts[0].remaining,BREAKOUT_FOLLOWUP_CLIPS);assert.deepEqual(out.doubled.map(d=>d.creatorKey),[raw.creatorKey]);
});
