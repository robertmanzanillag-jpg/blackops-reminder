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

/**
 * Function-only PostgreSQL adapter. The admitted login has no table privileges;
 * every state transition is performed by one versioned SECURITY DEFINER call.
 * Submit and reconciliation use different authenticated database lanes.
 */
export class DrizzleAdmittedRenderRepository implements AdmittedRenderRepository {
  constructor(
    private readonly db:AdmittedWorkerDatabaseLanes,
    private readonly options:AdmittedWorkerDatabaseCapabilities,
  ) {
    assertScope(options.scope);
    assertUuid(options.submitCapabilityId,"submitCapabilityId");
    assertUuid(options.reconcileCapabilityId,"reconcileCapabilityId");
    if(options.submitCapabilityId===options.reconcileCapabilityId)throw new Error("Submit and reconcile capabilities must be distinct");
  }

  async claim(input:{workerId:string;leaseDurationMs:number}):Promise<AdmittedSubmissionClaim|undefined>{
    assertWorkerLease(input);
    const row=await committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.claim_admitted_v1(
      ${this.options.submitCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.workerId}::text,${input.leaseDurationMs}::integer)`);
    return row?claimFrom(row,row.request_json):undefined;
  }

  async authorize(claim:AdmittedSubmissionClaim):Promise<AdmittedSendAuthorization|undefined>{
    if(!sameScope(claim.scope,this.options.scope))return undefined;
    const row=await committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.authorize_admitted_v1(
      ${this.options.submitCapabilityId}::uuid,${claim.scope.ownerUserId}::text,${claim.scope.workspaceId}::text,
      ${claim.id}::uuid,${claim.budgetReservationId}::uuid,${claim.fencingToken}::bigint,
      ${claim.leaseToken}::uuid,${claim.sealedRequestDigest}::text)`);
    return row?authorizationFrom(row,row.request_json):undefined;
  }

  async confirm(input:AdmittedAuthorizedIdentity&{providerJobId:string;providerRequestId?:string;evidenceDigest:Sha256Digest}):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!boundedProviderId(input.providerJobId)
      ||!optionalProviderId(input.providerRequestId)||!DIGEST.test(input.evidenceDigest))return false;
    if(isReconciliation(input)){
      return mutationResult(await committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.record_reconciled_confirmed_v1(
        ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
        ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
        ${input.authorizationDigest}::text,${input.reconciliationLeaseToken}::uuid,
        ${input.reconciliationFencingToken}::bigint,${input.providerJobId}::text,
        ${input.providerRequestId??null}::text,${input.evidenceDigest}::text)`));
    }
    const send=input as AdmittedSendAuthorization;
    if(!UUID.test(send.leaseToken))return false;
    return mutationResult(await committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.record_submit_confirmed_v1(
      ${this.options.submitCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${send.leaseToken}::uuid,${input.providerJobId}::text,
      ${input.providerRequestId??null}::text,${input.evidenceDigest}::text)`));
  }

  async markAmbiguous(input:AdmittedSendAuthorization&{providerRequestId?:string;evidenceDigest:Sha256Digest}):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!UUID.test(input.leaseToken)
      ||!optionalProviderId(input.providerRequestId)||!DIGEST.test(input.evidenceDigest))return false;
    return mutationResult(await committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.record_submit_ambiguous_v1(
      ${this.options.submitCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.leaseToken}::uuid,
      ${input.providerRequestId??null}::text,${input.evidenceDigest}::text)`));
  }

  async markReconciledNoSubmit(input:AdmittedReconciliationClaim&{finality:ExactNegativeSubmissionFinality}):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope)||!sameNegativeFinality(input,input.finality))return false;
    return mutationResult(await committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.finalize_reconciled_no_submit_v1(
      ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.reconciliationLeaseToken}::uuid,
      ${input.reconciliationFencingToken}::bigint,${input.finality.guarantee}::text,
      ${input.finality.providerAccountId}::uuid,${input.finality.providerKey}::text,
      ${input.finality.providerCredentialVersion}::integer,${input.finality.providerIdempotencyKey}::text,
      ${new Date(input.finality.observedAt)}::timestamptz,${input.finality.evidenceDigest}::text)`));
  }

  async expireAuthorizedLeases():Promise<number>{
    const row=await committedCall(this.db.submit,sql`SELECT * FROM ai_media_worker_api.expire_authorized_v1(
      ${this.options.submitCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,100::integer)`);
    return row?nonNegative(row.transitioned_count):0;
  }

  async claimAmbiguous(input:{workerId:string;leaseDurationMs:number}):Promise<AdmittedReconciliationClaim|undefined>{
    assertWorkerLease(input);
    const row=await committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.claim_reconciliation_v1(
      ${this.options.reconcileCapabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.workerId}::text,${input.leaseDurationMs}::integer)`);
    if(!row)return undefined;
    return {...authorizedIdentityFrom(row,row.request_json),reconciliationLeaseToken:dbUuid(row,"reconciliation_lease_token"),
      reconciliationLeaseOwner:text(row.reconciliation_lease_owner),reconciliationFencingToken:big(row.reconciliation_fencing_token)};
  }

  async releaseUnknownReconciliation(input:AdmittedReconciliationClaim):Promise<boolean>{
    if(!sameScope(input.scope,this.options.scope))return false;
    return mutationResult(await committedCall(this.db.reconcile,sql`SELECT * FROM ai_media_worker_api.release_reconciliation_unknown_v1(
      ${this.options.reconcileCapabilityId}::uuid,${input.scope.ownerUserId}::text,${input.scope.workspaceId}::text,
      ${input.id}::uuid,${input.budgetReservationId}::uuid,${input.fencingToken}::bigint,
      ${input.authorizationDigest}::text,${input.reconciliationLeaseToken}::uuid,
      ${input.reconciliationFencingToken}::bigint)`));
  }
}

async function committedCall(db:AdmittedRenderTransactionalDatabase,query:SQL):Promise<Record<string,unknown>|undefined>{
  // Returning from the transaction callback is not authorization. The outer
  // promise must resolve after the driver has committed all deferred guards.
  return db.transaction(async tx=>first(await tx.execute(query)));
}
function rows(result:ExecuteResult):Record<string,unknown>[]{const value=Array.isArray(result)?result:result.rows;return Array.isArray(value)?value as Record<string,unknown>[]:[];}
function first(result:ExecuteResult):Record<string,unknown>|undefined{return rows(result)[0];}
function text(value:unknown):string{if(typeof value!=="string"||!value.length)throw new Error("Invalid database text");return value;}
function dbUuid(row:Record<string,unknown>,key:string):string{const value=text(row[key]);assertUuid(value,key);return value;}
function dbDigest(row:Record<string,unknown>,key:string):Sha256Digest{const value=text(row[key]);if(!DIGEST.test(value))throw new Error(`Invalid ${key}`);return value as Sha256Digest;}
function positive(value:unknown):number{const number=Number(value);if(!Number.isSafeInteger(number)||number<1)throw new Error("Invalid positive integer");return number;}
function nonNegative(value:unknown):number{const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw new Error("Invalid count");return number;}
function big(value:unknown):bigint{try{const result=BigInt(String(value));if(result<1n)throw new Error();return result;}catch{throw new Error("Invalid fencing token");}}
function iso(value:unknown):string{const date=value instanceof Date?value:new Date(String(value));if(Number.isNaN(date.getTime()))throw new Error("Invalid database time");return date.toISOString();}
function boundedProviderId(value:unknown):value is string{return typeof value==='string'&&value===value.trim()&&value.length>=1&&value.length<=500;}
function optionalProviderId(value:unknown):boolean{return value===undefined||boundedProviderId(value);}
function assertUuid(value:string,key:string):void{if(!UUID.test(value))throw new Error(`Invalid ${key}`);}
function assertScope(scope:TenantScope):void{if(!scope.ownerUserId.trim()||!scope.workspaceId.trim())throw new Error("Exact tenant scope is required");}
function sameScope(left:TenantScope,right:TenantScope):boolean{return left.ownerUserId===right.ownerUserId&&left.workspaceId===right.workspaceId;}
function assertWorkerLease(input:{workerId:string;leaseDurationMs:number}):void{if(!input.workerId.trim()||input.workerId.length>120
  ||!Number.isInteger(input.leaseDurationMs)||input.leaseDurationMs<1||input.leaseDurationMs>300_000)throw new Error("Invalid admitted claim lease");}
function mutationResult(row:Record<string,unknown>|undefined):boolean{return row?.applied===true;}
function isReconciliation(input:AdmittedAuthorizedIdentity):input is AdmittedReconciliationClaim{return "reconciliationLeaseToken" in input;}
function sameNegativeFinality(input:AdmittedReconciliationClaim,finality:ExactNegativeSubmissionFinality):boolean{return Boolean(finality)
  &&finality.guarantee==='linearizable_not_accepted_and_cannot_later_accept'
  &&finality.scope.ownerUserId===input.scope.ownerUserId&&finality.scope.workspaceId===input.scope.workspaceId
  &&finality.providerAccountId===input.providerAccountId&&finality.providerKey===input.providerKey
  &&finality.providerCredentialVersion===input.providerCredentialVersion
  &&finality.authorizationDigest===input.authorizationDigest&&finality.providerIdempotencyKey===input.providerIdempotencyKey
  &&DIGEST.test(finality.evidenceDigest)&&!Number.isNaN(Date.parse(finality.observedAt));}
function identityFrom(row:Record<string,unknown>,request:unknown){return{id:dbUuid(row,"id"),scope:{ownerUserId:text(row.owner_user_id),workspaceId:text(row.workspace_id)},
  budgetReservationId:dbUuid(row,"budget_reservation_id"),renderJobId:dbUuid(row,"render_job_id"),providerAccountId:dbUuid(row,"provider_account_id"),
  providerKey:text(row.provider_key),providerCredentialVersion:positive(row.provider_credential_version),providerIdempotencyKey:text(row.provider_idempotency_key),
  avatarExternalResourceId:text(row.avatar_external_resource_id),voiceExternalResourceId:text(row.voice_external_resource_id),
  sealedRequest:(request&&typeof request==='object'&&!Array.isArray(request)?request:{}) as Readonly<Record<string,unknown>>,
  sealedRequestDigest:dbDigest(row,"sealed_request_digest"),fencingToken:big(row.fencing_token)};}
function claimFrom(row:Record<string,unknown>,request:unknown):AdmittedSubmissionClaim{return{...identityFrom(row,request),leaseToken:dbUuid(row,"lease_token"),leaseExpiresAt:iso(row.lease_expires_at)};}
function authorizedIdentityFrom(row:Record<string,unknown>,request:unknown):AdmittedAuthorizedIdentity{return{...identityFrom(row,request),authorizationDigest:dbDigest(row,"send_authorization_digest"),commitEvidenceDigest:dbDigest(row,"commit_evidence_digest"),authorizedAt:iso(row.authorized_at)};}
function authorizationFrom(row:Record<string,unknown>,request:unknown):AdmittedSendAuthorization{return{...authorizedIdentityFrom(row,request),leaseToken:dbUuid(row,"lease_token"),leaseExpiresAt:iso(row.lease_expires_at)};}
