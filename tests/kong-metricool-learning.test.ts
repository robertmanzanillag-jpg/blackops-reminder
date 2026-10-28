import test from "node:test";
import assert from "node:assert/strict";
import { collectMetricoolObservations, mapMetricoolObservations, dueLearningRegistry, type PublishedCreative } from "../server/kong-metricool-learning";
const now=new Date("2026-10-28T15:00:00Z");
const known: PublishedCreative={network:"tiktok",postId:"123",publicUrl:"https://www.tiktok.com/@kongnightlife/video/123",publishedAt:"2026-10-27T15:00:00Z",family:"pov",hookStyle:"question"};
const row=["20261027110000",`${known.publicUrl}?tracking=abc`,"caption","8","241","6","0","0",null];
test("runtime sampling is once per comparable age window without deleting history",()=>{
  assert.equal(dueLearningRegistry([known],undefined,now).length,1);
  const observation=mapMetricoolObservations({rows:[row]},"tiktok",[known],now).observations[0];
  const ledger={version:1 as const,observations:[observation]};
  assert.equal(dueLearningRegistry([known],ledger,new Date(+now+3600_000)).length,0);
  assert.equal(dueLearningRegistry([known],ledger,new Date(+now+48*3600_000)).length,1);
  assert.equal(dueLearningRegistry([known],ledger,new Date(+now+60*3600_000)).length,0);
  assert.equal(ledger.observations.length,1);
});
test("maps actual response shape without inventing missing metrics or interpreting naive timestamps",()=>{
  const r=mapMetricoolObservations({content:[{type:"text",text:JSON.stringify({rows:[row]})}]},"tiktok",[known],now);
  assert.equal(r.observations[0].metrics.views,241); assert.equal(r.observations[0].metrics.shares,0);
  assert.equal(r.observations[0].metrics.completionRate,undefined); assert.equal(r.observations[0].metrics.websiteClicks,undefined);
  assert.equal(r.observations[0].publishedAt,known.publishedAt);
});
test("unregistered, ambiguous and foreign-brand posts never become evidence",()=>{
  assert.equal(mapMetricoolObservations({rows:[row]},"tiktok",[],now).observations.length,0);
  assert.equal(mapMetricoolObservations({rows:[row]},"tiktok",[known,known],now).observations.length,0);
  assert.equal(mapMetricoolObservations({rows:[row,row]},"tiktok",[known],now).observations.length,0);
  assert.equal(mapMetricoolObservations({rows:[row]},"tiktok",[{...known,postId:"999"}],now).observations.length,0);
  assert.equal(mapMetricoolObservations({rows:[[...row.slice(0,1),"https://www.tiktok.com/@other/video/123",...row.slice(2)]]},"tiktok",[known],now).observations.length,0);
});
test("collector pins brand and network fields and rejects provider errors",async()=>{
  let called=false;
  await collectMetricoolObservations({network:"tiktok",registry:[known],now,call:async(name,args)=>{
    called=true; assert.equal(name,"getAnalyticsDataByMetrics"); assert.equal(args.brandId,"6475033");
    return {rows:[row]};
  }}); assert.equal(called,true);
  assert.throws(()=>mapMetricoolObservations({isError:true},"tiktok",[known],now),/provider_analytics_failed/);
});
test("Facebook mapping preserves real zero and missing values with verified offset timestamp",()=>{
  const fb:PublishedCreative={...known,network:"facebook",publicUrl:"https://www.facebook.com/reel/123/",publishedAt:"2026-10-27T11:00:00-04:00"};
  const result=mapMetricoolObservations({rows:[["naive-unused",fb.publicUrl,"caption","336","0","3"]]},"facebook",[fb],now);
  assert.deepEqual(result.observations[0].metrics,{views:336,reach:0});
  assert.equal(result.observations[0].publishedAt,fb.publishedAt);
  const invalid=mapMetricoolObservations({rows:[["naive-unused",fb.publicUrl,"caption","not-a-number",null,"3"]]},"facebook",[fb],now);
  assert.equal(invalid.observations[0].metrics.views,null); assert.equal(invalid.observations[0].metrics.reach,null);
});
test("conflicting duplicate observations are both excluded",()=>{
  const changed=[...row]; changed[4]="999999";
  const result=mapMetricoolObservations({rows:[row,changed]},"tiktok",[known],now);
  assert.equal(result.observations.length,0); assert.equal(result.rejected.length,2);
});
