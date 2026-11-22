import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolioMetricool,DESTINATIONS,destinationKey} from '../script/clippers-portfolio-metricool.mjs';
const d=DESTINATIONS[0],TOKEN='fixture-token-not-real';
function fixture({rows=[]}={}){const calls=[];const adapter=createPortfolioMetricool({token:TOKEN,userId:'1',env:{CLIPPERS_RUNTIME:'cloud'},fetcher:async(url,options={})=>{
 const u=String(url);calls.push(u);
 if(u.includes('simpleProfiles'))return Response.json([{id:d.brandId,tiktokUsername:d.account,canPublish:true}]);
 if(u.includes('/scheduler/posts'))return Response.json(typeof rows==='function'?rows(new URL(u)):rows);
 const body=JSON.parse(options.body);assert.equal(body.params.name,'createScheduledPost');return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[]}});
 }});return{adapter,calls};}
test('adapter invokes final transactional rights fence after identity I/O and immediately before createScheduledPost',async()=>{
 const f=fixture();const item={id:'fixture',caption:'EXACT REVIEWED TITLE\n@fixture https://clips.twitch.tv/Fixture',mediaUrl:'https://static.metricool.com/fixture/final.mp4',scheduledAt:'2026-11-23T16:00:00.000Z',beforeWrite:async()=>{f.calls.push('FENCE');throw Error('derivative_revoked');}};
 await assert.rejects(f.adapter.schedule(d,item),/derivative_revoked/);assert.equal(f.calls.at(-1),'FENCE');assert.equal(f.calls.filter(c=>c.includes('ai.metricool')).length,0);
});
test('fresh baseline calendar includes drafts and every connected network; refuses unknown network and provider pagination',async()=>{
 const row={id:1,uuid:'uuid1',blogId:d.brandId,text:'exact',media:['https://static.metricool.com/final/1.mp4'],publicationDate:{dateTime:'2026-11-23T16:00:00.000Z',timezone:'UTC'},draft:true,providers:[{network:'tiktok',status:'pending'}]};
 const f=fixture({rows:[row]});await assert.rejects(f.adapter.reviewedDerivativeCalendar({fromDay:'2026-11-22',throughDay:'2026-11-24'}),/baseline_unverified/,'wrong-brand response cannot be treated as another account');
 const g=fixture({rows:[{...row,blogId:undefined,providers:[{network:'instagram'}]}]});await assert.rejects(g.adapter.reviewedDerivativeCalendar({fromDay:'2026-11-22',throughDay:'2026-11-24'}),/network_unmapped/);
});

test('adapter fence is directly adjacent to the create request, and complete read-back contains independent TT/FB draft reservations',async()=>{
 const f=fixture();await f.adapter.schedule(d,{id:'fixture-ok',caption:'EXACT TITLE @fixture https://clips.twitch.tv/Fixture',mediaUrl:'https://static.metricool.com/fixture/final.mp4',scheduledAt:'2026-11-23T16:00:00.000Z',beforeWrite:async()=>f.calls.push('FENCE')});const at=f.calls.indexOf('FENCE');assert.equal(f.calls[at+1],'https://ai.metricool.com/mcp');
 const g=fixture({rows:url=>DESTINATIONS.filter(d=>String(d.brandId)===url.searchParams.get('blogId')).map((d,i)=>({id:100+i,uuid:'uuid-'+d.network,blogId:d.brandId,text:'exact '+d.network,media:['https://static.metricool.com/final/'+d.network+'.mp4'],publicationDate:{dateTime:'2026-11-23T16:00:00.000Z',timezone:'UTC'},draft:true,providers:[{network:d.network,status:'pending'}]}))});
 const rows=await g.adapter.reviewedDerivativeCalendar({fromDay:'2026-11-22',throughDay:'2026-11-24'});assert.equal(rows.length,5);assert.ok(rows.some(r=>r.destinationKey==='6591612:tiktok:news305miami'));assert.ok(rows.some(r=>r.destinationKey==='6591612:facebook:1193011863901514'));
});
