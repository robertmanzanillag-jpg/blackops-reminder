import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseDerivativeCampaignResponse,checkDerivativeCampaign} from '../script/clippers-derivative-campaign.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/clippers-campaign-depth-actual.json',import.meta.url),'utf8'));
const htmlOf=f=>`${f.acceptingSpan?'<span>Accepting clips</span>':''}<script>self.__next_f.push(${JSON.stringify([1,f.frames.map((v,i)=>i+':'+JSON.stringify(v)).join('\n')+'\n'])})</script>`;
const inputOf=f=>({id:f.id,url:f.provenance.sourceUrl,status:200,headers:new Headers(Object.entries(f.headers).filter(([,v])=>v!==null)),html:htmlOf(f),now:Date.parse(f.provenance.capturedAt)});
function depths(value,depth=0,result={object:0,primitive:0}){if(value&&typeof value==='object'){result.object=Math.max(result.object,depth);for(const x of Object.values(value))depths(x,depth+1,result);}else result.primitive=Math.max(result.primitive,depth);return result;}
function changeLeaf(value){const copy=structuredClone(fixture.active),path=copy.provenance.primitiveLeafPath;let node=copy.frames[0];for(const key of path.slice(0,-1))node=node[key];node[path.at(-1)]=value;return copy;}
function changeQuery(change){const copy=structuredClone(fixture.active);function walk(v){if(!v||typeof v!=='object')return;if(v.queryKey?.[0]==='campaigns'&&v.queryKey?.[1]==='detail')change(v);else for(const x of Object.values(v))walk(x);}copy.frames.forEach(walk);return copy;}
test('actual compact structural capture accepts object depth40 with primitive leaf41, without treating it as membership proof',()=>{
 assert.equal(fixture.active.provenance.sourceHtmlSha256,'659cb6ff4680650e6ca309c6da3f2a7b58747b9f66253abdd1a1211ca9db681b');assert.equal(fixture.active.provenance.queryObjectDepth,4);
 assert.deepEqual(depths(fixture.active.frames[0]),{object:40,primitive:41});assert.ok(Buffer.byteLength(JSON.stringify(fixture))<10000,'retain structural provenance, not full third-party page/UI text');
 const proof=parseDerivativeCampaignResponse(inputOf(fixture.active));assert.equal(proof.campaignId,fixture.active.id);assert.equal(proof.checkedAt,fixture.active.provenance.capturedAt);assert.equal(proof.doesNotProveMembership,true);
 for(const primitive of [null,false,true,0,'redacted'])assert.equal(parseDerivativeCampaignResponse(inputOf(changeLeaf(primitive))).campaignId,fixture.active.id);
});
test('object and array at depth41 remain rejected: do not widen the40-object nesting cap',()=>{
 for(const value of [{},[],{child:'leaf'}])assert.throws(()=>parseDerivativeCampaignResponse(inputOf(changeLeaf(value))),/derivative_campaign_unverified/);
});
test('actual paused TJR capture remains ineligible even if accepting text is supplied',()=>{
 const paused=fixture.paused;assert.equal(paused.provenance.sourceHtmlSha256,'0c8253ec7b6e1685bc510301f78a8f7c8053e2d234c7e0faf2789f4b6c05acd8');assert.throws(()=>parseDerivativeCampaignResponse(inputOf(paused)),/derivative_campaign_not_active/);assert.throws(()=>parseDerivativeCampaignResponse(inputOf({...paused,acceptingSpan:true})),/derivative_campaign_not_active/);
});
test('captured deep leaf does not relax exact query uniqueness, campaign identity, status, freshness or accepting marker',()=>{
 for(const altered of [changeQuery(q=>q.state.data.status='paused'),changeQuery(q=>q.state.status='error'),changeQuery(q=>q.state.data.id='00000000-0000-0000-0000-000000000000'),changeQuery(q=>q.state.dataUpdatedAt=Date.parse(fixture.active.provenance.capturedAt)-120001),changeQuery(q=>q.state.dataUpdatedAt=Date.parse(fixture.active.provenance.capturedAt)+30001),{...fixture.active,acceptingSpan:false},{...fixture.active,frames:[...fixture.active.frames,fixture.active.frames[1]]}])assert.throws(()=>parseDerivativeCampaignResponse(inputOf(altered)),/derivative_campaign_not_active/);
 const input=inputOf(fixture.active);assert.throws(()=>parseDerivativeCampaignResponse({...input,status:503}),/unverified/);assert.throws(()=>parseDerivativeCampaignResponse({...input,url:input.url+'?cached=1'}),/unverified/);assert.throws(()=>parseDerivativeCampaignResponse({...input,html:'x'.repeat(4*1024*1024+1)}),/unverified/);
});
test('captured response still rejects stale/future HTTP dates, positive cache age and missing no-store',()=>{
 const input=inputOf(fixture.active);for(const headers of [new Headers({'date':new Date(input.now-120001).toUTCString(),'cache-control':'no-store'}),new Headers({'date':new Date(input.now+31000).toUTCString(),'cache-control':'no-store'}),new Headers({'date':new Date(input.now).toUTCString(),'cache-control':'max-age=0'}),new Headers({'date':new Date(input.now).toUTCString(),'cache-control':'no-store',age:'1'})])assert.throws(()=>parseDerivativeCampaignResponse({...input,headers}),/derivative_campaign_stale/);
});
test('transport check consumes compact captured bytes with original capture time and binds existing verifier/digest only',async()=>{
 const f=fixture.active,record={manifest:{rights:{licenseTerm:{kind:'conditional_live',campaignId:f.id,verifierId:'contentrewards_campaign_active_v1'}}},manifestSha256:'a'.repeat(64)};let calls=0;
 const proof=await checkDerivativeCampaign(record,{clock:()=>Date.parse(f.provenance.capturedAt),fetch:async(url,options)=>{calls++;assert.equal(url,f.provenance.sourceUrl);assert.equal(options.redirect,'error');assert.equal(options.headers['Cache-Control'],'no-cache');assert.equal(Object.keys(options.headers).some(k=>/cookie|authorization/i.test(k)),false);const response=new Response(htmlOf(f),{status:200,headers:inputOf(f).headers});Object.defineProperty(response,'url',{value:url});return response;}});
 assert.equal(calls,1);assert.equal(proof.allowed,true);assert.equal(proof.manifestSha256,record.manifestSha256);assert.equal(proof.doesNotProveMembership,true);
});
