// Synthetic catalog loader: production has no identity-verifier bypass or test option.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CURRENT_IDENTITY_PINS, DESTINATIONS } from '../../script/clippers-destination-registry.mjs';
const sha=v=>createHash('sha256').update(String(v)).digest('hex');
let registry=await readFile(new URL('../../script/clippers-destination-registry.mjs',import.meta.url),'utf8');
registry=registry.replace(CURRENT_IDENTITY_PINS[0].ownerSha256,sha('900000001'));
for(const p of CURRENT_IDENTITY_PINS)registry=registry.replace(p.providerIdSha256,sha(p.network==='facebook'?p.account:'fixture-provider-'+p.brandId));
const registryUrl='data:text/javascript;base64,'+Buffer.from(registry).toString('base64');
let source=await readFile(new URL('../../script/clippers-portfolio-metricool.mjs',import.meta.url),'utf8');
source=source.replaceAll("'./clippers-destination-registry.mjs'",JSON.stringify(registryUrl));
const synthetic=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
// The fake adapter still runs the actual SHA/owner/provider validation with fake data.
export function createPortfolioMetricool({fetcher,...options}){
 return synthetic.createPortfolioMetricool({...options,userId:'900000001',fetcher:async(input,init)=>{
  const u=new URL(input);const match=/^\/api\/v2\/settings\/brands\/(\d+)$/.exec(u.pathname);
  if(match){const brandId=Number(match[1]);const networksData={};for(const d of DESTINATIONS.filter(d=>d.brandId===brandId))networksData[d.network+'Data']={username:d.account,providerUserId:d.network==='facebook'?d.account:'fixture-provider-'+brandId};return Response.json({id:brandId,ownerUserId:'900000001',networksData});}
  // Existing scenarios test permissions against the same synthetic owner they supplied.
  const r=await fetcher(input,init);
  if(u.pathname==='/api/admin/simpleProfiles'){
   const rows=await r.json();return Response.json(rows.map(row=>({...row,...(String(row.ownerUserId)===String(options.userId)?{ownerUserId:'900000001'}:{})})));
  }
  return r;
 }});
}
