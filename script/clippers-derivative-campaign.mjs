// Anonymous primary backend state only; never a membership or whole-source rights claim.
import { reviewedMediaHash } from '../shared/clippers-reviewed-derivative.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function parseDerivativeCampaignResponse({id,url,status,headers,html,now=Date.now()}) {
  if(!UUID.test(id??'')||url!==`https://contentrewards.com/c/campaigns/${id}`||status!==200||typeof html!=='string'||Buffer.byteLength(html)>4*1024*1024)throw Error('derivative_campaign_unverified');
  const age=headers.get('age'),date=Date.parse(headers.get('date'));
  if(!headers.get('cache-control')?.toLowerCase().includes('no-store')||(age!==null&&age!=='0')||!Number.isFinite(date)||now-date>120000||date-now>30000)throw Error('derivative_campaign_stale');
  const hits=[];
  function walk(v,depth=0){if(depth>40)throw Error('derivative_campaign_unverified');if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(JSON.stringify(v.queryKey)===JSON.stringify(['campaigns','detail',id]))hits.push(v);for(const x of Object.values(v))walk(x,depth+1);}
  for(const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)){
    let chunks;try{chunks=JSON.parse(match[1]);}catch{continue;}if(!Array.isArray(chunks))continue;
    for(const chunk of chunks)if(typeof chunk==='string')for(const line of chunk.split('\n')){let data;try{data=JSON.parse(line.slice(line.indexOf(':')+1));}catch{continue;}walk(data);}
  }
  const q=hits.length===1?hits[0]?.state:null;
  if(!q||q.status!=='success'||q.data?.id!==id||q.data.status!=='active'||typeof q.dataUpdatedAt!=='number'||q.dataUpdatedAt>now+30000||now-q.dataUpdatedAt>120000||!html.includes('<span>Accepting clips</span>'))throw Error('derivative_campaign_not_active');
  return {campaignId:id,primaryUrl:url,checkedAt:new Date(now).toISOString(),htmlSha256:reviewedMediaHash(html),origin:'anonymous_primary_campaign_state',doesNotProveMembership:true};
}
export async function checkDerivativeCampaign(record,{fetch:fetchImpl=globalThis.fetch,clock=Date.now}={}){
  const term=record.manifest.rights.licenseTerm;if(term.kind!=='conditional_live')return null;
  if(term.verifierId!=='contentrewards_campaign_active_v1'||!UUID.test(term.campaignId??''))throw Error('derivative_live_verifier_unavailable');
  const url=`https://contentrewards.com/c/campaigns/${term.campaignId}`;
  const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{'Cache-Control':'no-cache',Accept:'text/html'}});
  const reader=r.body?.getReader();if(!reader)throw Error('derivative_campaign_unverified');let size=0;const chunks=[];
  try{while(true){const c=await reader.read();if(c.done)break;size+=c.value.byteLength;if(size>4*1024*1024)throw Error('derivative_campaign_unverified');chunks.push(Buffer.from(c.value));}}finally{await reader.cancel().catch(()=>undefined);}
  const proof=parseDerivativeCampaignResponse({id:term.campaignId,url:r.url,status:r.status,headers:r.headers,html:Buffer.concat(chunks).toString('utf8'),now:clock()});
  return {...proof,allowed:true,verifierId:term.verifierId,manifestSha256:record.manifestSha256};
}
