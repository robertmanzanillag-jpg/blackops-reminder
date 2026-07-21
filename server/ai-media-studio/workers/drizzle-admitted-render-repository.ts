import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedAuthorizedIdentity,
  AdmittedReconciliationClaim,
  AdmittedRenderRepository,
  AdmittedSendAuthorization,
  AdmittedSubmissionClaim,
  ExactNegativeSubmissionFinality,
} from "./admitted-render-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export interface AdmittedRenderDatabase { execute(query: SQL): Promise<ExecuteResult> }
export interface AdmittedRenderTransactionalDatabase extends AdmittedRenderDatabase {
  /** Resolves only after COMMIT; rejection includes commit-time failures. */
  transaction<T>(callback: (tx: AdmittedRenderDatabase) => Promise<T>): Promise<T>;
}

export interface AdmittedWorkerDatabaseLanes {
  /** A connection authenticated as a submit executor. */
  submit: AdmittedRenderTransactionalDatabase;
  /** A distinct connection authenticated as a reconcile executor. */
  reconcile: AdmittedRenderTransactionalDatabase;
}

export interface AdmittedWorkerDatabaseCapabilities {
  scope: TenantScope;
  submitCapabilityId: string;
  reconcileCapabilityId: string;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST=/^sha256:[0-9a-f]{64}$/u;
const RECONCILIATION_GUARD:unique symbol=Symbol("ai-media-reconciliation-guard");
type GuardedReconciliationClaim=AdmittedReconciliationClaim&{readonly [RECONCILIATION_GUARD]:object};

/**
 * Function-only PostgreSQL adapter. The admitted login has no table privileges;
 * every state transition is performed by one versioned SECURITY DEFINER call.
 * Submit and reconciliation use different authenticated database lanes.
 */
export class DrizzleAdmittedRenderRepository implements AdmittedRenderRepository {
  private readonly reconciliationGuard=Object.freeze({});

  constructor(
    private readonly db:AdmittedWorkerDatabaseLanes,
    private readonly options:AdmittedWorkerDatabaseCapabilities,
  ) {
    assertScope(options.scope);
    assertUuid(options.submitCapabilityId,"submitCapabilityId");
    assertUuid(options.reconcileCapabilityId,"reconcileCapabilityId");
    if(options.submitCapabilityId===options.reconcileCapabilityId)throw new Error("Submit and reconcile capabilities must be distinct");
    if(db.submit===db.reconcile)throw new Error("Submit and reconcile database lanes must be distinct");
  }

  async claim(input:{workerId:string;leaseDurationMs:number}):Promise<AdmittedSubmissionClaim|undefined>{
    assertWorkerLease(input);
    return committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.claim_admitted_v1(
      ${this.options.submitCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.workerId}::text,${input.leaseDurationMs}::integer)`,row=>{
      if(!row)return undefined;
      const claim=claimFrom(row,row.request_json);
      assertReturnedScope(claim.scope,this.options.scope);
      return claim;
    });
  }

  async authorize(claim:AdmittedSubmissionClaim):Promise<AdmittedSendAuthorization|undefined>{
    if(!sameScope(claim.scope,this.options.scope))return undefined;
    assertClaimInput(claim);
    return committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.authorize_admitted_v1(
      ${this.options.submitCapabilityId}::uuid,${claim.scope.ownerUserId}::text,${claim.scope.workspaceId}::text,
      ${claim.id}::uuid,${claim.budgetReservationId}::uuid,${claim.fencingToken}::bigint,
      ${claim.leaseToken}::uuid,${claim.sealedRequestDigest}::text)`,row=>{
      if(!row)return undefined;
      const authorization=authorizationFrom(row,row.request_json);
      assertExactAuthorizedClaim(authorization,claim);
      return authorization;
    });
  }

  async confirm(input:AdmittedAuthorizedIdentity&{providerJobId:string;providerRequestId?:string;evidenceDigest:Sha256Digest}):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!boundedProviderId(input.providerJobId)
      ||!optionalProviderId(input.providerRequestId)||!DIGEST.test(input.evidenceDigest))return false;
    if(this.isIssuedReconciliation(input)){
      return committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.record_reconciled_confirmed_v1(
        ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
        ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
        ${input.authorizationDigest}::text,${input.reconciliationLeaseToken}::uuid,
        ${input.reconciliationFencingToken}::bigint,${input.providerJobId}::text,
        ${input.providerRequestId??null}::text,${input.evidenceDigest}::text)`,mutationResult);
    }
    if(!isSendAuthorization(input))return false;
    return committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.record_submit_confirmed_v1(
      ${this.options.submitCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.leaseToken}::uuid,${input.providerJobId}::text,
      ${input.providerRequestId??null}::text,${input.evidenceDigest}::text)`,mutationResult);
  }

  async markAmbiguous(input:AdmittedSendAuthorization&{providerRequestId?:string;evidenceDigest:Sha256Digest}):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!UUID.test(input.leaseToken)
      ||!optionalProviderId(input.providerRequestId)||!DIGEST.test(input.evidenceDigest))return false;
    return committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.record_submit_ambiguous_v1(
      ${this.options.submitCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.leaseToken}::uuid,
      ${input.providerRequestId??null}::text,${input.evidenceDigest}::text)`,mutationResult);
  }

  async markReconciledNoSubmit(input:AdmittedReconciliationClaim&{finality:ExactNegativeSubmissionFinality}):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!this.isIssuedReconciliation(input)||!sameNegativeFinality(input,input.finality))return false;
    return committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.finalize_reconciled_no_submit_v1(
      ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.reconciliationLeaseToken}::uuid,
      ${input.reconciliationFencingToken}::bigint,${input.finality.guarantee}::text,
      ${input.finality.providerAccountId}::uuid,${input.finality.providerKey}::text,
      ${input.finality.providerCredentialVersion}::integer,${input.finality.providerIdempotencyKey}::text,
      ${new Date(input.finality.observedAt)}::timestamptz,${input.finality.evidenceDigest}::text)`,mutationResult);
  }

  async expireAuthorizedLeases():Promise<number>{
    return committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.expire_authorized_v1(
      ${this.options.submitCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,100::integer)`,row=>row?nonNegative(row.transitioned_count):0);
  }

  async claimAmbiguous(input:{workerId:string;leaseDurationMs:number}):Promise<AdmittedReconciliationClaim|undefined>{
    assertWorkerLease(input);
    return committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.claim_reconciliation_v1(
      ${this.options.reconcileCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.workerId}::text,${input.leaseDurationMs}::integer)`,row=>{
      if(!row)return undefined;
      const claim:GuardedReconciliationClaim={...authorizedIdentityFrom(row,row.request_json),
        reconciliationLeaseToken:dbUuid(row,"reconciliation_lease_token"),
        reconciliationLeaseOwner:text(row.reconciliation_lease_owner),
        reconciliationFencingToken:big(row.reconciliation_fencing_token),
        [RECONCILIATION_GUARD]:this.reconciliationGuard};
      assertReturnedScope(claim.scope,this.options.scope);
      return claim;
    });
  }

  async releaseUnknownReconciliation(input:AdmittedReconciliationClaim):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!this.isIssuedReconciliation(input))return false;
    return committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.release_reconciliation_unknown_v1(
      ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.reconciliationLeaseToken}::uuid,
      ${input.reconciliationFencingToken}::bigint)`,mutationResult);
  }

  private isIssuedReconciliation(input:AdmittedAuthorizedIdentity):input is GuardedReconciliationClaim{
    return (input as Partial<GuardedReconciliationClaim>)[RECONCILIATION_GUARD]===this.reconciliationGuard;
  }
}

async function committedCall<T>(db:AdmittedRenderTransactionalDatabase,query:SQL,
  decode:(row:Record<string,unknown>|undefined)=>T):Promise<T>{
  // Returning from the transaction callback is not authorization. The outer
  // promise must resolve after the driver has committed all deferred guards.
  // Decode and bind the function result before COMMIT so malformed or
  // substituted rows roll the whole capability transaction back.
  return db.transaction(async tx=>decode(exactOptionalRow(await tx.execute(query))));
}
function rows(result:ExecuteResult):Record<string,unknown>[]{
  const value=Array.isArray(result)?result:result&&typeof result==="object"?result.rows:undefined;
  if(!Array.isArray(value)||value.some(row=>!row||typeof row!=="object"||Array.isArray(row)))throw new Error("Invalid capability function result");
  return value as Record<string,unknown>[];
}
function exactOptionalRow(result:ExecuteResult):Record<string,unknown>|undefined{const value=rows(result);if(value.length>1)throw new Error("Capability function returned multiple rows");return value[0];}
function text(value:unknown):string{if(typeof value!=="string"||!value.length)throw new Error("Invalid database text");return value;}
function dbUuid(row:Record<string,unknown>,key:string):string{const value=text(row[key]);assertUuid(value,key);return value;}
function dbDigest(row:Record<string,unknown>,key:string):Sha256Digest{const value=text(row[key]);if(!DIGEST.test(value))throw new Error(`Invalid ${key}`);return value as Sha256Digest;}
function positive(value:unknown):number{const number=Number(value);if(!Number.isSafeInteger(number)||number<1)throw new Error("Invalid positive integer");return number;}
function nonNegative(value:unknown):number{const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw new Error("Invalid count");return number;}
function big(value:unknown):bigint{try{const result=BigInt(String(value));if(result<1n)throw new Error();return result;}catch{throw new Error("Invalid fencing token");}}
function iso(value:unknown):string{const date=value instanceof Date?value:new Date(String(value));if(Number.isNaN(date.getTime()))throw new Error("Invalid database time");return date.toISOString();}
function boundedProviderId(value:unknown):value is string{return typeof value==='string'&&value===value.trim()&&value.length>=1&&value.length<=500;}
function optionalProviderId(value:unknown):boolean{return value===undefined||boundedProviderId(value);}
function isSendAuthorization(input:AdmittedAuthorizedIdentity):input is AdmittedSendAuthorization{
  return "leaseToken" in input&&typeof input.leaseToken==="string"&&UUID.test(input.leaseToken)
    &&"leaseExpiresAt" in input&&typeof input.leaseExpiresAt==="string"&&!Number.isNaN(Date.parse(input.leaseExpiresAt));
}
function assertUuid(value:string,key:string):void{if(!UUID.test(value))throw new Error(`Invalid ${key}`);}
function assertScope(scope:TenantScope):void{if(!scope.ownerUserId.trim()||scope.ownerUserId!==scope.ownerUserId.trim()
  ||!scope.workspaceId.trim()||scope.workspaceId!==scope.workspaceId.trim())throw new Error("Exact tenant scope is required");}
function sameScope(left:TenantScope,right:TenantScope):boolean{return left.ownerUserId===right.ownerUserId&&left.workspaceId===right.workspaceId;}
function assertWorkerLease(input:{workerId:string;leaseDurationMs:number}):void{if(!input.workerId.trim()||input.workerId.length>120
  ||input.workerId!==input.workerId.trim()||!Number.isInteger(input.leaseDurationMs)||input.leaseDurationMs<1
  ||input.leaseDurationMs>300_000)throw new Error("Invalid admitted claim lease");}
function mutationResult(row:Record<string,unknown>|undefined):boolean{if(!row)return false;if(typeof row.applied!=="boolean")throw new Error("Invalid capability mutation result");return row.applied;}
function sameNegativeFinality(input:AdmittedReconciliationClaim,finality:ExactNegativeSubmissionFinality):boolean{return Boolean(finality)
  &&finality.guarantee==='linearizable_not_accepted_and_cannot_later_accept'
  &&finality.scope.ownerUserId===input.scope.ownerUserId&&finality.scope.workspaceId===input.scope.workspaceId
  &&finality.providerAccountId===input.providerAccountId&&finality.providerKey===input.providerKey
  &&finality.providerCredentialVersion===input.providerCredentialVersion
  &&finality.authorizationDigest===input.authorizationDigest&&finality.providerIdempotencyKey===input.providerIdempotencyKey
  &&DIGEST.test(finality.evidenceDigest)&&!Number.isNaN(Date.parse(finality.observedAt));}
function identityFrom(row:Record<string,unknown>,request:unknown){return{id:dbUuid(row,"id"),scope:returnedScope(row),
  budgetReservationId:dbUuid(row,"budget_reservation_id"),renderJobId:dbUuid(row,"render_job_id"),providerAccountId:dbUuid(row,"provider_account_id"),
  providerKey:text(row.provider_key),providerCredentialVersion:positive(row.provider_credential_version),providerIdempotencyKey:text(row.provider_idempotency_key),
  avatarExternalResourceId:text(row.avatar_external_resource_id),voiceExternalResourceId:text(row.voice_external_resource_id),
  sealedRequest:plainJsonObject(request),
  sealedRequestDigest:dbDigest(row,"sealed_request_digest"),fencingToken:big(row.fencing_token)};}
function claimFrom(row:Record<string,unknown>,request:unknown):AdmittedSubmissionClaim{return{...identityFrom(row,request),leaseToken:dbUuid(row,"lease_token"),leaseExpiresAt:iso(row.lease_expires_at)};}
function authorizedIdentityFrom(row:Record<string,unknown>,request:unknown):AdmittedAuthorizedIdentity{return{...identityFrom(row,request),authorizationDigest:dbDigest(row,"send_authorization_digest"),commitEvidenceDigest:dbDigest(row,"commit_evidence_digest"),authorizedAt:iso(row.authorized_at)};}
function authorizationFrom(row:Record<string,unknown>,request:unknown):AdmittedSendAuthorization{return{...authorizedIdentityFrom(row,request),leaseToken:dbUuid(row,"lease_token"),leaseExpiresAt:iso(row.lease_expires_at)};}
function returnedScope(row:Record<string,unknown>):TenantScope{const scope={ownerUserId:text(row.owner_user_id),workspaceId:text(row.workspace_id)};assertScope(scope);return scope;}
function assertReturnedScope(actual:TenantScope,expected:TenantScope):void{if(!sameScope(actual,expected))throw new Error("Capability function returned another tenant scope");}
function assertExactAuthorizedClaim(actual:AdmittedSendAuthorization,claim:AdmittedSubmissionClaim):void{
  assertReturnedScope(actual.scope,claim.scope);
  if(actual.id!==claim.id||actual.budgetReservationId!==claim.budgetReservationId||actual.renderJobId!==claim.renderJobId
    ||actual.providerAccountId!==claim.providerAccountId||actual.providerKey!==claim.providerKey
    ||actual.providerCredentialVersion!==claim.providerCredentialVersion
    ||actual.providerIdempotencyKey!==claim.providerIdempotencyKey
    ||actual.avatarExternalResourceId!==claim.avatarExternalResourceId
    ||actual.voiceExternalResourceId!==claim.voiceExternalResourceId
    ||actual.sealedRequestDigest!==claim.sealedRequestDigest||actual.fencingToken!==claim.fencingToken
    ||actual.leaseToken!==claim.leaseToken||actual.leaseExpiresAt!==claim.leaseExpiresAt
    ||canonicalJson(actual.sealedRequest)!==canonicalJson(claim.sealedRequest)){
    throw new Error("Capability authorization does not match the exact submitted claim");
  }
}
function assertClaimInput(claim:AdmittedSubmissionClaim):void{
  assertScope(claim.scope);assertUuid(claim.id,"claim.id");assertUuid(claim.budgetReservationId,"claim.budgetReservationId");
  assertUuid(claim.renderJobId,"claim.renderJobId");assertUuid(claim.providerAccountId,"claim.providerAccountId");
  assertUuid(claim.leaseToken,"claim.leaseToken");dbInputDigest(claim.sealedRequestDigest,"claim.sealedRequestDigest");
  if(claim.fencingToken<1n||Number.isNaN(Date.parse(claim.leaseExpiresAt)))throw new Error("Invalid exact claim fence or lease");
  plainJsonObject(claim.sealedRequest);
}
function dbInputDigest(value:string,key:string):void{if(!DIGEST.test(value))throw new Error(`Invalid ${key}`);}
function plainJsonObject(value:unknown):Readonly<Record<string,unknown>>{
  if(!value||typeof value!=="object"||Array.isArray(value)
    ||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
    ||!isJsonValue(value))throw new Error("Invalid sealed request JSON");
  return value as Readonly<Record<string,unknown>>;
}
function isJsonValue(value:unknown):boolean{
  if(value===null||typeof value==="string"||typeof value==="boolean")return true;
  if(typeof value==="number")return Number.isFinite(value);
  if(Array.isArray(value))return value.every(isJsonValue);
  if(typeof value!=="object")return false;
  const prototype=Object.getPrototypeOf(value);
  return (prototype===Object.prototype||prototype===null)&&Object.values(value as Record<string,unknown>).every(isJsonValue);
}
function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right))
    .map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
