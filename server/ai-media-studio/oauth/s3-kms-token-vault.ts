import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { aiMediaOAuthPlatformSchema } from "../../../shared/ai-media-studio-oauth";
import { OAuthFlowError, type OAuthSafeTokenDescriptor, type OAuthSecretTokenBundle, type OAuthTokenSecretReader,
  type OAuthTokenVault, type OAuthTokenVaultContext, type OAuthTokenVaultRecord } from "./contracts";
import {
  assertExpectedBucketOwner, assertKmsKeyArn, boundedClient, canonicalContextBytes, decryptEnvelope, digestContext, encryptEnvelope,
  isExactS3KeyAbsence,
  MAX_ENVELOPE_BYTES,
  normalizedExactMetadata, normalizeEnvelopeKmsConfig, officialS3Endpoint, readBoundedBody, safeEqual, validBucket, vaultRejected,
  type AwsCommandClient, type NormalizedEnvelopeKmsConfig,
} from "./s3-kms-envelope";

export const OAUTH_TOKEN_OBJECT_PREFIX = "ai-media-studio/oauth-token/v1";
const REF = /^vault:\/\/ai-media-studio\/oauth-token\/v1\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE = /^[A-Za-z0-9._:/-]+$/u;

export type S3KmsTokenVaultConfig = Readonly<{
  bucket: string; region: string; kmsKeyArn: string; expectedBucketOwner: string;
  prefix: typeof OAUTH_TOKEN_OBJECT_PREFIX; s3Client?: AwsCommandClient; kmsClient?: AwsCommandClient;
}>;
type Config = Readonly<{ bucket:string; expectedBucketOwner:string; s3:AwsCommandClient; kms:NormalizedEnvelopeKmsConfig }>;
type TokenPayload = Readonly<{ v:1; bundle:OAuthSecretTokenBundle; descriptor:OAuthSafeTokenDescriptor }>;
class S3ObjectNotFound extends Error {}

export class S3KmsTokenVault implements OAuthTokenVault {
  private readonly config: Config;
  constructor(config:S3KmsTokenVaultConfig) { this.config=normalize(config); }

  createSecretReader(): OAuthTokenSecretReader {
    return { readBundle: async (reference, context) => {
      const payload = await this.readPayload(reference, context); return { ...payload.bundle };
    } };
  }

  async putOnce(input:{context:OAuthTokenVaultContext;bundle:OAuthSecretTokenBundle;descriptor:OAuthSafeTokenDescriptor}):Promise<OAuthTokenVaultRecord> {
    try {
      const context=validateContext(input.context); const payload=validatePayload({v:1,bundle:input.bundle,descriptor:input.descriptor},context);
      const aad=aadFor(context); const bindingDigest=digestContext(aad);
      const plaintext=Buffer.from(JSON.stringify(payload),"utf8");
      let encrypted:Awaited<ReturnType<typeof encryptEnvelope>>;
      try{encrypted=await encryptEnvelope(plaintext,aad,this.config.kms);}finally{plaintext.fill(0);}
      try {
        await this.config.s3.send(new PutObjectCommand({
          Bucket:this.config.bucket,Key:keyFor(context.tokenBindingId),ExpectedBucketOwner:this.config.expectedBucketOwner,
          Body:encrypted.body,ContentLength:encrypted.body.byteLength,ContentType:"application/json",
          ServerSideEncryption:"aws:kms",SSEKMSKeyId:this.config.kms.kmsKeyArn,BucketKeyEnabled:true,IfNoneMatch:"*",
          Tagging:"classification=oauth-token&retention=credential",
          Metadata:{"binding-digest":bindingDigest,"envelope-version":"v1"},
        }));
      } catch {
        const recovered=await this.readPayload(referenceFor(context.tokenBindingId),context);
        if (!samePayload(recovered,payload)) throw vaultRejected();
      }
      return {reference:referenceFor(context.tokenBindingId),descriptor:payload.descriptor};
    } catch(error) { if(error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }

  async find(context:OAuthTokenVaultContext):Promise<OAuthTokenVaultRecord|undefined> {
    try {
      const normalized=validateContext(context); const reference=referenceFor(normalized.tokenBindingId);
      const payload=await this.readPayloadRaw(reference,normalized);
      return {reference,descriptor:payload.descriptor};
    } catch(error) { if(error instanceof S3ObjectNotFound) return undefined; if(error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }

  async readDescriptor(reference:string,context:OAuthTokenVaultContext):Promise<OAuthSafeTokenDescriptor> {
    return (await this.readPayload(reference,context)).descriptor;
  }

  async delete(reference:string,context:OAuthTokenVaultContext):Promise<void> {
    try {
      const normalized=validateContext(context); if(!safeEqual(idFromRef(reference),normalized.tokenBindingId)) throw vaultRejected();
      let head:any;
      try { head=await this.config.s3.send(new HeadObjectCommand({Bucket:this.config.bucket,Key:keyFor(normalized.tokenBindingId),ExpectedBucketOwner:this.config.expectedBucketOwner})); }
      catch(error) { if(isExactS3KeyAbsence(error,true)) return; throw error; }
      validateStored(head,digestContext(aadFor(normalized)),this.config.kms.kmsKeyArn);
      await this.config.s3.send(new DeleteObjectCommand({Bucket:this.config.bucket,Key:keyFor(normalized.tokenBindingId),ExpectedBucketOwner:this.config.expectedBucketOwner}));
    } catch(error) { if(error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }

  private async readPayload(reference:string,context:OAuthTokenVaultContext):Promise<TokenPayload> {
    try { return await this.readPayloadRaw(reference,validateContext(context)); }
    catch(error) { if(error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }
  private async readPayloadRaw(reference:string,context:OAuthTokenVaultContext):Promise<TokenPayload> {
    if(!safeEqual(idFromRef(reference),context.tokenBindingId)) throw vaultRejected();
    const aad=aadFor(context); const digest=digestContext(aad);
    let result:any;
    try { result=await this.config.s3.send(new GetObjectCommand({Bucket:this.config.bucket,Key:keyFor(context.tokenBindingId),ExpectedBucketOwner:this.config.expectedBucketOwner})); }
    catch(error) { if(isExactS3KeyAbsence(error)) throw new S3ObjectNotFound(); throw error; }
    validateStored(result,digest,this.config.kms.kmsKeyArn);
    const plaintext=await decryptEnvelope(await readBoundedBody(result?.Body),aad,digest,this.config.kms);
    let parsed:unknown; try { parsed=JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
    return validatePayload(parsed,context);
  }
}

function normalize(config:S3KmsTokenVaultConfig):Config {
  if(!validBucket(config.bucket)||!/^\d{12}$/u.test(config.expectedBucketOwner)||config.prefix!==OAUTH_TOKEN_OBJECT_PREFIX) throw vaultRejected();
  const partition=assertKmsKeyArn(config.kmsKeyArn,config.region);
  assertExpectedBucketOwner(config.kmsKeyArn,config.expectedBucketOwner);
  return {bucket:config.bucket,expectedBucketOwner:config.expectedBucketOwner,
    s3:boundedClient(config.s3Client??new S3Client({region:config.region,endpoint:officialS3Endpoint(partition,config.region)})),
    kms:normalizeEnvelopeKmsConfig(config)};
}
function validateContext(c:OAuthTokenVaultContext):OAuthTokenVaultContext {
  if(c?.purpose!=="ai_media_oauth_token"||!field(c.ownerUserId)||!field(c.workspaceId)||!field(c.actorUserId)
    ||!UUID.test(c.providerAccountId)||!UUID.test(c.sessionId)||!UUID.test(c.tokenBindingId)
    ||!Number.isSafeInteger(c.targetCredentialVersion)||c.targetCredentialVersion<1||!aiMediaOAuthPlatformSchema.safeParse(c.platform).success) throw vaultRejected();
  return c;
}
function validatePayload(raw:unknown,c:OAuthTokenVaultContext):TokenPayload {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) throw vaultRejected(); const p=raw as Record<string,unknown>;
  if(Object.keys(p).sort().join(",")!=="bundle,descriptor,v"||p.v!==1||!p.bundle||typeof p.bundle!=="object"||Array.isArray(p.bundle)
    ||!p.descriptor||typeof p.descriptor!=="object"||Array.isArray(p.descriptor)) throw vaultRejected();
  const b=p.bundle as Record<string,unknown>; const d=p.descriptor as Record<string,unknown>;
  if(!secret(b.accessToken)||!(b.refreshToken===undefined||secret(b.refreshToken))
    ||Object.keys(b).sort().join(",")!==(b.refreshToken===undefined?"accessToken":"accessToken,refreshToken")) throw vaultRejected();
  if(Object.keys(d).sort().join(",")!=="accessTokenExpiresAt,capabilities,externalAccountId,manifestRevision,platform,refreshTokenExpiresAt,scopes,tokenBindingId,tokenKind"
    ||d.tokenBindingId!==c.tokenBindingId||d.platform!==c.platform||d.tokenKind!=="Bearer"||!field(d.externalAccountId)
    ||!field(d.manifestRevision)||!list(d.scopes,1)||!list(d.capabilities,0)
    ||!timestamp(d.accessTokenExpiresAt,true)||!timestamp(d.refreshTokenExpiresAt,false)) throw vaultRejected();
  return {v:1,bundle:{accessToken:b.accessToken as string,...(b.refreshToken===undefined?{}:{refreshToken:b.refreshToken as string})},
    descriptor:{tokenBindingId:d.tokenBindingId,platform:d.platform,externalAccountId:d.externalAccountId,scopes:[...(d.scopes as string[])],
      capabilities:[...(d.capabilities as string[])],accessTokenExpiresAt:d.accessTokenExpiresAt,refreshTokenExpiresAt:d.refreshTokenExpiresAt,
      tokenKind:"Bearer",manifestRevision:d.manifestRevision} as OAuthSafeTokenDescriptor};
}
function aadFor(c:OAuthTokenVaultContext):Buffer{return canonicalContextBytes([c.purpose,c.ownerUserId,c.workspaceId,c.actorUserId,c.providerAccountId,c.platform,c.sessionId,c.targetCredentialVersion,c.tokenBindingId]);}
function validateStored(v:any,digest:string,keyArn:string):void{const m=normalizedExactMetadata(v?.Metadata);
  if(v?.ServerSideEncryption!=="aws:kms"||v?.SSEKMSKeyId!==keyArn||v?.BucketKeyEnabled!==true||v?.ContentType!=="application/json"
    ||v?.Expires!==undefined||(v?.ContentLength!==undefined&&(!Number.isSafeInteger(v.ContentLength)||v.ContentLength<1||v.ContentLength>MAX_ENVELOPE_BYTES))
    ||Object.keys(m).sort().join(",")!=="binding-digest,envelope-version"||m["binding-digest"]!==digest||m["envelope-version"]!=="v1") throw vaultRejected();}
function samePayload(a:TokenPayload,b:TokenPayload):boolean{return JSON.stringify(a)===JSON.stringify(b);}
function secret(v:unknown):v is string{return typeof v==="string"&&v.length>0&&v.length<=32_768&&!/[\u0000-\u0020\u007f]/u.test(v);}
function field(v:unknown):v is string{return typeof v==="string"&&v.length>0&&v.length<=255&&SAFE.test(v);}
function list(v:unknown,min:number):v is string[]{return Array.isArray(v)&&v.length>=min&&v.length<=100&&v.every(field)&&new Set(v).size===v.length;}
function timestamp(v:unknown,required:boolean):boolean{return v===null?!required:typeof v==="string"&&!Number.isNaN(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;}
function keyFor(id:string):string{return `${OAUTH_TOKEN_OBJECT_PREFIX}/${id}.json`;}
function referenceFor(id:string):string{return `vault://ai-media-studio/oauth-token/v1/${id}`;}
function idFromRef(v:string):string{const m=REF.exec(v);if(!m)throw vaultRejected();return m[1];}
