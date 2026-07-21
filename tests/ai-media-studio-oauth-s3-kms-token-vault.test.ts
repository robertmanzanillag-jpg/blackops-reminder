import assert from "node:assert/strict";
import test from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { OAUTH_TOKEN_OBJECT_PREFIX, S3KmsTokenVault } from "../server/ai-media-studio/oauth/s3-kms-token-vault";
import type { OAuthSafeTokenDescriptor, OAuthTokenVaultContext } from "../server/ai-media-studio/oauth/contracts";

const keyArn="arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111";
const context:OAuthTokenVaultContext={purpose:"ai_media_oauth_token",ownerUserId:"owner-1",workspaceId:"workspace-1",actorUserId:"actor-1",
  providerAccountId:"22222222-2222-4222-8222-222222222222",platform:"tiktok",sessionId:"33333333-3333-4333-8333-333333333333",
  targetCredentialVersion:3,tokenBindingId:"44444444-4444-4444-8444-444444444444"};
const descriptor:OAuthSafeTokenDescriptor={tokenBindingId:context.tokenBindingId,platform:"tiktok",externalAccountId:"external-1",scopes:["video.publish"],capabilities:["publish"],
  accessTokenExpiresAt:"2099-01-01T00:00:00.000Z",refreshTokenExpiresAt:null,tokenKind:"Bearer",manifestRevision:"tiktok-v1"};
const bundle={accessToken:"access-token-secret-sentinel",refreshToken:"refresh-token-secret-sentinel"};
class KmsFake{calls:any[]=[];key=Buffer.alloc(32,9);decryptError:any;async send(command:any){this.calls.push(command.input);if(command instanceof GenerateDataKeyCommand)return{Plaintext:Buffer.from(this.key),CiphertextBlob:Buffer.from("token-edk")};if(command instanceof DecryptCommand){if(this.decryptError)throw this.decryptError;return{Plaintext:Buffer.from(this.key)}}throw new Error("kms leak");}}
class S3Fake{calls:any[]=[];stored:any;ambiguous=false;getError:any;async send(command:any){this.calls.push(command.input);
  if(command instanceof PutObjectCommand){if(this.stored&&command.input.IfNoneMatch==="*")throw Object.assign(new Error("exists"),{name:"PreconditionFailed",$metadata:{httpStatusCode:412}});this.stored={...command.input};if(this.ambiguous){this.ambiguous=false;throw new Error("uncertain");}return{};}
  if(command instanceof GetObjectCommand){if(this.getError)throw this.getError;if(!this.stored)throw Object.assign(new Error("missing"),{name:"NoSuchKey",$metadata:{httpStatusCode:404}});return this.output();}
  if(command instanceof HeadObjectCommand){if(!this.stored)throw Object.assign(new Error("missing"),{name:"NotFound",$metadata:{httpStatusCode:404}});return this.output(false);}
  if(command instanceof DeleteObjectCommand){this.stored=undefined;return{};}throw new Error("s3 leak");}
  output(body=true){const x=this.stored;return{ServerSideEncryption:x.ServerSideEncryption,SSEKMSKeyId:x.SSEKMSKeyId,BucketKeyEnabled:x.BucketKeyEnabled,ContentType:x.ContentType,
    Metadata:x.Metadata,...(body?{Body:(async function*(){yield x.Body;})()}: {})};}}
function harness(){const s3=new S3Fake(),kms=new KmsFake();const vault=new S3KmsTokenVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,
  expectedBucketOwner:"123456789012",prefix:OAUTH_TOKEN_OBJECT_PREFIX,s3Client:s3,kmsClient:kms});return{vault,s3,kms};}

test("token vault is inert, encrypts bundle plus descriptor, and exposes secrets only through separate reader",async()=>{const h=harness();assert.equal(h.s3.calls.length+h.kms.calls.length,0);
  const record=await h.vault.putOnce({context,bundle,descriptor});assert.equal(record.reference,`vault://ai-media-studio/oauth-token/v1/${context.tokenBindingId}`);assert.deepEqual(record.descriptor,descriptor);
  assert.equal("accessToken" in record,false);assert.deepEqual(await h.vault.readDescriptor(record.reference,context),descriptor);
  assert.deepEqual(await h.vault.createSecretReader().readBundle(record.reference,context),bundle);
  const durable=JSON.stringify([...h.s3.calls,...h.kms.calls]);for(const secret of Object.values(bundle))assert.equal(durable.includes(secret),false);
  const put=h.s3.calls.find(x=>x.IfNoneMatch==="*");assert.equal(put.ExpectedBucketOwner,"123456789012");assert.equal(put.Expires,undefined);assert.equal(put.BucketKeyEnabled,true);
});

test("token vault binds actor and full identity, rejects substitution, and recovers ambiguous put exactly",async()=>{const h=harness();h.s3.ambiguous=true;
  const record=await h.vault.putOnce({context,bundle,descriptor});assert.equal(record.descriptor.externalAccountId,"external-1");
  assert.equal((await h.vault.putOnce({context,bundle,descriptor})).reference,record.reference);
  await assert.rejects(h.vault.putOnce({context,bundle:{...bundle,accessToken:"competing-access-token"},descriptor}),/rejected/);
  await assert.rejects(h.vault.readDescriptor(record.reference,{...context,actorUserId:"actor-2"}),/encrypted vault request was rejected/);
  await assert.rejects(h.vault.putOnce({context,bundle,descriptor:{...descriptor,tokenBindingId:"55555555-5555-4555-8555-555555555555"}}),/rejected/);
  h.s3.stored.Body=Buffer.alloc(100_000);await assert.rejects(h.vault.readDescriptor(record.reference,context),/rejected/);
});

test("find distinguishes only true 404 and redacts provider failures",async()=>{const h=harness();assert.equal(await h.vault.find(context),undefined);
  h.s3.getError=new Error("provider access-token-secret-sentinel");let error:unknown;try{await h.vault.find(context);}catch(caught){error=caught;}
  assert.equal(error instanceof Error?error.message:"","OAuth encrypted vault request was rejected");
  const encrypted=harness();await encrypted.vault.putOnce({context,bundle,descriptor});encrypted.kms.decryptError=Object.assign(new Error("kms missing"),{$metadata:{httpStatusCode:404}});
  await assert.rejects(encrypted.vault.find(context),/encrypted vault request was rejected/);
  const bucketMissing=harness();bucketMissing.s3.getError=Object.assign(new Error("bucket missing"),{name:"NoSuchBucket",$metadata:{httpStatusCode:404}});
  await assert.rejects(bucketMissing.vault.find(context),/encrypted vault request was rejected/);
  const statusOnly=harness();statusOnly.s3.getError=Object.assign(new Error("gateway 404"),{$metadata:{httpStatusCode:404}});
  await assert.rejects(statusOnly.vault.find(context),/encrypted vault request was rejected/);
});

test("token delete validates the exact stored binding and is 404-idempotent without listing",async()=>{const h=harness();const record=await h.vault.putOnce({context,bundle,descriptor});
  await assert.rejects(h.vault.delete(record.reference,{...context,workspaceId:"workspace-2"}),/rejected/);await h.vault.delete(record.reference,context);await h.vault.delete(record.reference,context);
  assert.ok(h.s3.calls.every(x=>x.ExpectedBucketOwner==="123456789012"));assert.equal(h.s3.calls.some(x=>String(x.constructor?.name).includes("List")),false);
});

test("default token clients pin official endpoints",async()=>{const vault=new S3KmsTokenVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,expectedBucketOwner:"123456789012",prefix:OAUTH_TOKEN_OBJECT_PREFIX}) as any;
  assert.equal((await vault.config.s3.config.endpoint()).hostname,"s3.us-east-1.amazonaws.com");assert.equal((await vault.config.kms.kmsClient.config.endpoint()).hostname,"kms.us-east-1.amazonaws.com");});

test("token vault rejects an invalid region and a bucket owner outside the KMS account",()=>{
  assert.throws(()=>new S3KmsTokenVault({bucket:"oauth-vault-bucket",region:"attacker",kmsKeyArn:keyArn,
    expectedBucketOwner:"123456789012",prefix:OAUTH_TOKEN_OBJECT_PREFIX}),/encrypted vault request was rejected/);
  assert.throws(()=>new S3KmsTokenVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,
    expectedBucketOwner:"999999999999",prefix:OAUTH_TOKEN_OBJECT_PREFIX}),/encrypted vault request was rejected/);
});
