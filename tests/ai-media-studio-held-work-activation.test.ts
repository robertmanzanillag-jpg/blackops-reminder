import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleHeldWorkActivationRepository,
  type HeldWorkActivationDatabase,
  type HeldWorkActivationTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-held-work-activation-repository";
import {
  HeldWorkActivationError,
  type TrustedActivationPrincipal,
} from "../server/ai-media-studio/planning/held-work-activation-domain";

const ids = {
  reservation:"11111111-1111-4111-8111-111111111111",render:"22222222-2222-4222-8222-222222222222",
  outbox:"33333333-3333-4333-8333-333333333333",slot:"44444444-4444-4444-8444-444444444444",
  account:"55555555-5555-4555-8555-555555555555",snapshot:"66666666-6666-4666-8666-666666666666",
  intent:"77777777-7777-4777-8777-777777777777",influencer:"88888888-8888-4888-8888-888888888888",
  activation:"99999999-9999-4999-8999-999999999999",avatar:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  voice:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",variant:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  governance:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
} as const;
const digest=(char:string)=>`sha256:${char.repeat(64)}` as `sha256:${string}`;
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)])):value;
const hash=(value:unknown)=>`sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}` as `sha256:${string}`;
const script="Approved activation script";
const checksum=createHash("sha256").update(script).digest("hex");
const activatedAt=new Date("2026-07-21T14:00:00.000Z");
const requestJson={influencerId:ids.influencer,script,voiceId:ids.voice,language:"en",aspectRatio:"9:16",idempotencyKey:"admit:stable-provider-key",governance:{profileId:ids.governance,evidenceDigest:digest("2")}};
const sealedDigest=hash({version:1,request:requestJson,reservationId:ids.reservation,renderJobId:ids.render,outboxId:ids.outbox,slotId:ids.slot,slotAttempt:1,authoritySnapshotId:ids.snapshot,authorityDigest:digest("a"),launchIntentId:ids.intent,launchIntentDigest:digest("e"),admissionDigest:digest("b"),providerAccountId:ids.account,providerKey:"heygen",providerCredentialVersion:1,scriptVariantId:ids.variant,scriptVariantChecksum:checksum,sourceItemId:null,sourceContentHash:null,avatarResourceId:ids.avatar,voiceResourceId:ids.voice});
const handoffDigest=hash({version:1,reservationId:ids.reservation,renderJobId:ids.render,outboxId:ids.outbox,sealedRequestDigest:sealedDigest,authorityDigest:digest("a"),launchIntentDigest:digest("e"),admissionDigest:digest("b")});

interface Rendered { sql:string; params:unknown[] }
function harness(respond:(query:Rendered)=>unknown){
  const dialect=new PgDialect();const calls:Rendered[]=[];let transactions=0;
  const execute=async(query:SQL)=>{const compiled=dialect.sqlToQuery(query);const rendered={sql:compiled.sql.replace(/\s+/gu," ").trim(),params:compiled.params};calls.push(rendered);return respond(rendered);};
  const db:HeldWorkActivationTransactionalDatabase={execute,async transaction<T>(callback:(tx:HeldWorkActivationDatabase)=>Promise<T>){transactions+=1;return callback({execute});}};
  return {db,calls,transactions:()=>transactions};
}
function gateRow(){return{
  budget_reservation_id:ids.reservation,render_job_id:ids.render,dispatch_outbox_id:ids.outbox,
  daily_plan_slot_id:ids.slot,slot_attempt:1,provider_account_id:ids.account,provider_key:"heygen",
  provider_credential_version:1,provider_idempotency_key:"admit:stable-provider-key",
  script_variant_checksum:checksum,authority_snapshot_id:ids.snapshot,authority_digest:digest("a"),
  admission_digest:digest("b"),work_handoff_digest:handoffDigest,sealed_request_digest:sealedDigest,
  launch_intent_id:ids.intent,launch_intent_digest:digest("e"),slot_state_version_before:2,
  script_content:script,locked_script_checksum:checksum,request_json:requestJson,script_variant_id:ids.variant,
  source_item_id:null,source_content_hash:null,avatar_resource_id:ids.avatar,voice_resource_id:ids.voice,observed_at:activatedAt,
};}
function activationRow(overrides:Record<string,unknown>={}){return{
  id:ids.activation,budget_reservation_id:ids.reservation,render_job_id:ids.render,
  dispatch_outbox_id:ids.outbox,daily_plan_slot_id:ids.slot,slot_attempt:1,
  work_handoff_digest:handoffDigest,sealed_request_digest:sealedDigest,activation_digest:digest("f"),
  activated_at:activatedAt,slot_state_version_before:2,slot_state_version_after:3,...overrides,
};}
function principal(actorUserId:string):TrustedActivationPrincipal{return{
  capability:"activate-held-work",actorUserId,
} as unknown as TrustedActivationPrincipal;}
function command(repository:DrizzleHeldWorkActivationRepository){const unsigned={
  scope:{ownerUserId:"owner-1",workspaceId:"workspace-1"},budgetReservationId:ids.reservation,
  workHandoffDigest:handoffDigest,requestedBy:"operator-1",idempotencyKey:"activate-reservation-1",
};return{...unsigned,inputDigest:repository.inputDigest(unsigned),principal:principal(unsigned.requestedBy)};}

test("activation revalidates the exact authority graph and atomically queues only internal work",async()=>{
  const h=harness((query)=>{
    if(query.sql.includes("SELECT job.influencer_id"))return{rows:[{influencer_id:ids.influencer}]};
    if(query.sql.includes("SELECT intent.source_type"))return{rows:[{source_type:"manual",source_item_id:null,source_content_hash:null}]};
    if(query.sql.includes("WITH sampled_clock AS MATERIALIZED"))return{rows:[gateRow()]};
    if(query.sql.startsWith('INSERT INTO "ai_media_work_activations"'))return{rows:[activationRow()]};
    if(query.sql.startsWith('UPDATE "ai_media_render_jobs"'))return{rows:[{id:ids.render}]};
    if(query.sql.startsWith('UPDATE "ai_media_outbox"'))return{rows:[{id:ids.outbox}]};
    if(query.sql.startsWith('UPDATE "ai_media_daily_plan_slots"'))return{rows:[{id:ids.slot}]};
    return{rows:[]};
  });
  const repository=new DrizzleHeldWorkActivationRepository(h.db,{accountingTimeZone:"UTC"});
  const result=await repository.activate(command(repository));
  assert.equal(h.transactions(),1);assert.equal(result.replayed,false);
  assert.deepEqual(result.effects,{renderQueued:true,outboxPending:true,slotQueued:true,budgetCommitted:false,providerCalled:false});
  const gate=h.calls.find((entry)=>entry.sql.includes("WITH sampled_clock AS MATERIALIZED"));assert.ok(gate);
  assert.equal((gate.sql.match(/clock_timestamp\(\)/gu)??[]).length,1);
  for(const table of ["ai_media_launch_authority_snapshots","ai_media_launch_evidence","ai_media_launch_intents","ai_media_admission_policy_revisions","ai_media_kill_switch_revisions","ai_media_budget_reservations","ai_media_budget_buckets"]){assert.match(gate.sql,new RegExp(table,"u"));}
  assert.match(gate.sql,/NOT EXISTS \(SELECT 1 FROM "ai_media_launch_evidence" newer/u);
  assert.match(gate.sql,/policy\.state='active'.*kill\.active=false/u);
  assert.match(gate.sql,/reservation\.state='reserved'.*job\.stage='admission_held'.*outbox\.status='held'.*slot\.status='reserved'/u);
  assert.match(gate.sql,/slot\.influencer_id=job\.influencer_id/u);
  assert.match(gate.sql,/slot\.avatar_resource_id=job\.avatar_resource_id/u);
  assert.match(gate.sql,/slot\.voice_resource_id=job\.voice_resource_id/u);
  assert.match(gate.sql,/script\.influencer_id=slot\.influencer_id.*script\.influencer_id=job\.influencer_id/u);
  assert.match(gate.sql,/governance\.avatar_resource_id=job\.avatar_resource_id.*governance\.voice_resource_id=job\.voice_resource_id/u);
  assert.match(gate.sql,/script\.archived_at IS NULL/u);
  assert.match(gate.sql,/FOR UPDATE OF reservation,job,outbox,snapshot,intent/u);
  const render=h.calls.find((entry)=>entry.sql.startsWith('UPDATE "ai_media_render_jobs"'));assert.match(render?.sql??"",/SET stage='queued'/u);
  const outbox=h.calls.find((entry)=>entry.sql.startsWith('UPDATE "ai_media_outbox"'));assert.match(outbox?.sql??"",/SET status='pending'/u);
  const slot=h.calls.find((entry)=>entry.sql.startsWith('UPDATE "ai_media_daily_plan_slots"'));assert.match(slot?.sql??"",/SET status='queued',state_version=/u);
  assert.equal(h.calls.some((entry)=>/UPDATE[^;]*committed_micro_usd|provider\.submit|fetch\s*\(/u.test(entry.sql)),false);
});

test("activation replay accepts monotonic outbox and slot progress but requires inert queued render",async()=>{
  let requestInput:ReturnType<typeof command>;
  const h=harness((query)=>query.sql.includes('FROM "ai_media_work_activations" activation')?{rows:[activationRow({
    owner_user_id:"owner-1",workspace_id:"workspace-1",actor_user_id:"operator-1",idempotency_key:"activate-reservation-1",
    input_digest:requestInput.inputDigest,render_stage:"queued",outbox_status:"dispatched",slot_status:"committed",current_slot_state_version:4,
  })]}:{rows:[]});
  const repository=new DrizzleHeldWorkActivationRepository(h.db,{accountingTimeZone:"UTC"});requestInput=command(repository);
  const result=await repository.activate(requestInput);assert.equal(result.replayed,true);
  assert.deepEqual(result.effects,{renderQueued:false,outboxPending:false,slotQueued:false,budgetCommitted:false,providerCalled:false});
  assert.equal(h.calls.length,3,"idempotency lock, reservation lock, and replay only");
});

test("activation requires a capability for the exact requested principal",async()=>{
  const h=harness(()=>({rows:[]}));
  const repository=new DrizzleHeldWorkActivationRepository(h.db,{accountingTimeZone:"UTC"});
  const valid=command(repository);
  await assert.rejects(repository.activate({...valid,principal:principal("different-operator")}),
    (error:unknown)=>error instanceof HeldWorkActivationError&&error.code==="ACTIVATION_DENIED");
  assert.equal(h.calls.length,0,"untrusted commands fail before opening durable work");
});

test("activation fails closed before mutation when durable authority is unavailable",async()=>{
  const h=harness((query)=>query.sql.includes("SELECT job.influencer_id")?{rows:[{influencer_id:ids.influencer}]}:
    query.sql.includes("SELECT intent.source_type")?{rows:[{source_type:"manual",source_item_id:null,source_content_hash:null}]}:{rows:[]});
  const repository=new DrizzleHeldWorkActivationRepository(h.db,{accountingTimeZone:"UTC"});
  await assert.rejects(repository.activate(command(repository)),(error:unknown)=>error instanceof HeldWorkActivationError&&error.code==="ACTIVATION_DENIED");
  assert.equal(h.calls.some((entry)=>entry.sql.startsWith("INSERT INTO")||entry.sql.startsWith("UPDATE ")),false);
});
