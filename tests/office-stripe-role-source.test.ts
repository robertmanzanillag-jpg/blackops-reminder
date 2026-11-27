import test from "node:test";
import assert from "node:assert/strict";
import {readStripeRoleSnapshot,classifyStripeBusiness} from "../server/office-stripe-role-source";
import {auditSavedRole} from "../server/office-role-audits";
import {validateRoleSnapshot} from "../server/office-role-snapshots";

const NOW=Date.parse("2026-11-26T12:00:00Z"),owner="owner",KEY=["rk","live","FAKEFAKE"+"0".repeat(16)].join("_");
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
function mock(route:(path:string)=>Response){
 const calls:Array<{url:string;init:RequestInit}>=[];
 return {calls,fetch:async(url:string,init:RequestInit)=>{calls.push({url,init});const u=new URL(url);assert.equal(u.origin,"https://api.stripe.com");assert.equal(init.method,"GET");assert.equal(init.redirect,"error");return route(u.pathname);}};
}
const charge=(id:string,amount:number,md:any,extra:any={})=>({id,object:"charge",paid:true,status:"succeeded",livemode:true,currency:"usd",amount,amount_refunded:0,metadata:md,balance_transaction:{currency:"usd",fee:Math.round(amount*0.03)},customer:"cus_x",billing_details:{email:"private@example.com"},...extra});

test("classifies KONG vs Black Room from metadata or descriptor",()=>{
 assert.equal(classifyStripeBusiness({metadata:{business:"KONG"}}),"kong");
 assert.equal(classifyStripeBusiness({metadata:{},calculated_statement_descriptor:"BLACK ROOM FEMMES"}),"blackroom");
 assert.equal(classifyStripeBusiness({metadata:{},description:"misc"}),"unattributed");
});

test("revenue: GET-only, aggregates by business, no PII or key in snapshot, unblocks role",async()=>{
 const m=mock(p=>{assert.equal(p,"/v1/charges");return json({object:"list",has_more:false,data:[charge("ch_1",1000,{business:"kong"}),charge("ch_2",2000,{brand:"blackroom"},{amount_refunded:500}),charge("ch_3",700,{}),charge("ch_4",999,{business:"kong"},{status:"failed",paid:false})]});});
 const snap=await readStripeRoleSnapshot({owner,role:"revenue",key:KEY,fetch:m.fetch,now:()=>NOW});
 const text=JSON.stringify(snap);assert.ok(!text.includes(KEY) && !text.includes("private@example.com") && !text.includes("cus_x"));
 assert.equal((m.calls[0].init.headers as any).Authorization,`Bearer ${KEY}`);
 const kong=snap.rows.find(r=>r.business==="kong")!;assert.equal(kong.charges,1);assert.equal(kong.netMinor,970);
 const audit=auditSavedRole("revenue",snap,owner,NOW);
 assert.equal(audit.status,"completed");assert.equal(audit.metrics["grossMinor:blackroom:usd"],2000);assert.equal(audit.metrics["refundedMinor:blackroom:usd"],500);
 assert.ok(audit.findings.some(f=>f.code==="UNATTRIBUTED_REVENUE"));
 assert.ok(!audit.findings.some(f=>f.code==="NO_SOURCE_RECORDS"));
});

test("control: balance and payouts, flags failed payouts",async()=>{
 const m=mock(p=>p==="/v1/balance"?json({object:"balance",livemode:true,available:[{currency:"usd",amount:5000}],pending:[{currency:"usd",amount:100}]}):json({object:"list",has_more:false,data:[{id:"po_1",object:"payout",status:"paid",currency:"usd",amount:3000},{id:"po_2",object:"payout",status:"failed",currency:"usd",amount:200}]}));
 const snap=await readStripeRoleSnapshot({owner,role:"control",key:KEY,fetch:m.fetch,now:()=>NOW});
 const audit=auditSavedRole("control",snap,owner,NOW);
 assert.equal(audit.status,"completed");assert.equal(audit.metrics["availableMinor:usd"],5000);
 assert.ok(audit.findings.some(f=>f.code==="FAILED_PAYOUT"));
});

test("fails closed: missing key or full secret key is never sent; role blocked with source-exempt code",async()=>{
 for(const key of [null,"",["sk","live","FAKEFAKE"+"0".repeat(16)].join("_"),"rk_bad"]){
  const m=mock(()=>{throw new Error("must not call Stripe");});
  const snap=await readStripeRoleSnapshot({owner,role:"revenue",key,fetch:m.fetch,now:()=>NOW});
  assert.equal(m.calls.length,0);assert.equal(snap.total,0);
  const audit=auditSavedRole("revenue",snap,owner,NOW);
  assert.equal(audit.status,"blocked");assert.equal(audit.findings[0].code,"SOURCE_MISSING");assert.match(audit.findings[0].detail,/STRIPE_READONLY_KEY/);
 }
});

test("Stripe errors become blocked snapshots, not exceptions",async()=>{
 for(const [status,code] of [[401,"STRIPE_AUTH_REJECTED"],[403,"STRIPE_PERMISSION_DENIED"],[429,"STRIPE_RATE_LIMITED"],[500,"STRIPE_UPSTREAM_ERROR"]] as const){
  const snap=await readStripeRoleSnapshot({owner,role:"control",key:KEY,fetch:mock(()=>json({error:{}},status)).fetch,now:()=>NOW});
  assert.equal(snap.stripe!.blocked,code);
  const audit=auditSavedRole("control",snap,owner,NOW);assert.equal(audit.status,"blocked");assert.equal(audit.findings[0].code,"SOURCE_UNAVAILABLE");
 }
});

test("tampered stripe snapshot is rejected",async()=>{
 const snap=await readStripeRoleSnapshot({owner,role:"revenue",key:null,now:()=>NOW});
 assert.throws(()=>validateRoleSnapshot({...snap,stripe:{...snap.stripe!,blocked:null}},owner,NOW));
});
