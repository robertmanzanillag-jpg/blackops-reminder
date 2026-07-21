import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { OAUTH_CODE_OBJECT_PREFIX, S3KmsAuthorizationCodeVault } from "../server/ai-media-studio/oauth/s3-kms-authorization-code-vault";
import type { OAuthAuthorizationCodeVaultContext } from "../server/ai-media-studio/oauth/contracts";

const keyArn="arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111";
const code="authorization-code-secret-sentinel";
const context:OAuthAuthorizationCodeVaultContext={purpose:"ai_media_oauth_authorization_code",ownerUserId:"owner-1",workspaceId:"workspace-1",actorUserId:"actor-1",
  providerAccountId:"22222222-2222-4222-8222-222222222222",platform:"tiktok",sessionId:"33333333-3333-4333-8333-333333333333",
  tokenBindingId:"44444444-4444-4444-8444-444444444444",codeDigest:createHash("sha256").update(code).digest("hex"),expiresAt:"2026-07-21T12:10:00.000Z"};

class KmsFake { calls:any[]=[]; key=Buffer.alloc(32,7); decryptError:any; async send(command:any){this.calls.push(command.input);
  if(command instanceof GenerateDataKeyCommand)return{Plaintext:Buffer.from(this.key),CiphertextBlob:Buffer.from("encrypted-data-key")};
  if(command instanceof DecryptCommand){if(this.decryptError)throw this.decryptError;return{Plaintext:Buffer.from(this.key)}}throw new Error("kms secret leak");}}
class S3Fake { calls:any[]=[]; stored:any; ambiguous=false; async send(command:any){this.calls.push(command.input);
  if(command instanceof PutObjectCommand){if(this.stored&&command.input.IfNoneMatch==="*")throw Object.assign(new Error("exists"),{name:"PreconditionFailed",$metadata:{httpStatusCode:412}});this.stored={...command.input};if(this.ambiguous){this.ambiguous=false;throw new Error("ambiguous secret leak");}return{};}
  if(command instanceof GetObjectCommand){if(!this.stored)throw Object.assign(new Error("missing"),{name:"NoSuchKey",$metadata:{httpStatusCode:404}});return this.output();}
  if(command instanceof HeadObjectCommand){if(!this.stored)throw Object.assign(new Error("missing"),{name:"NotFound",$metadata:{httpStatusCode:404}});return this.output(false);}
  if(command instanceof DeleteObjectCommand){this.stored=undefined;return{};}throw new Error("s3 secret leak");}
  output(body=true){const x=this.stored;return{ServerSideEncryption:x.ServerSideEncryption,SSEKMSKeyId:x.SSEKMSKeyId,BucketKeyEnabled:x.BucketKeyEnabled,
    ContentType:x.ContentType,Expires:x.Expires,Metadata:x.Metadata,...(body?{Body:(async function*(){yield x.Body;})()}: {})};}}
function harness(){const s3=new S3Fake(),kms=new KmsFake();const vault=new S3KmsAuthorizationCodeVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,
  expectedBucketOwner:"123456789012",prefix:OAUTH_CODE_OBJECT_PREFIX,s3Client:s3,kmsClient:kms,clock:{now:()=>new Date("2026-07-21T12:00:00.000Z")}});return{vault,s3,kms};}

test("code vault is inert and envelope requests contain ciphertext plus exact non-secret binding only",async()=>{const h=harness();assert.equal(h.s3.calls.length+h.kms.calls.length,0);
  const ref=await h.vault.putOnce(code,context);assert.equal(ref,`vault://ai-media-studio/oauth-code/v1/${context.sessionId}`);
  assert.equal(await h.vault.read(ref,context),code);const durable=JSON.stringify([...h.s3.calls,...h.kms.calls]);
  for(const secret of [code,context.ownerUserId,context.actorUserId])assert.equal(durable.includes(secret),false);
  const put=h.s3.calls.find(x=>x.IfNoneMatch==="*");assert.equal(put.ExpectedBucketOwner,"123456789012");assert.equal(put.BucketKeyEnabled,true);assert.equal(put.ServerSideEncryption,"aws:kms");
  const generate=h.kms.calls[0];assert.deepEqual(Object.keys(generate.EncryptionContext).sort(),["ai-media-oauth-binding","ai-media-oauth-envelope"]);
  assert.equal(Buffer.from(put.Body).includes(Buffer.from(code)),false);
});

test("code put validates digest, recovers an ambiguous immutable put, and rejects cross-context substitution",async()=>{const h=harness();h.s3.ambiguous=true;
  assert.equal(await h.vault.putOnce(code,context),`vault://ai-media-studio/oauth-code/v1/${context.sessionId}`);
  assert.equal(await h.vault.putOnce(code,context),`vault://ai-media-studio/oauth-code/v1/${context.sessionId}`);
  await assert.rejects(h.vault.read(`vault://ai-media-studio/oauth-code/v1/${context.sessionId}`,{...context,actorUserId:"actor-2"}),/encrypted vault request was rejected/);
  const competing="different-authorization-code";
  await assert.rejects(h.vault.putOnce(competing,{...context,codeDigest:createHash("sha256").update(competing).digest("hex")}),/encrypted vault request was rejected/);
  await assert.rejects(h.vault.putOnce(code,{...context,codeDigest:"a".repeat(64)}),/encrypted vault request was rejected/);
  await assert.rejects(h.vault.putOnce("x".repeat(17_000),{...context,codeDigest:createHash("sha256").update("x".repeat(17_000)).digest("hex")}),/rejected/);
});

test("code read rejects malformed/expired objects and delete is exact plus 404-idempotent",async()=>{const h=harness();const ref=await h.vault.putOnce(code,context);
  h.s3.stored.Body=Buffer.from("not-json");await assert.rejects(h.vault.read(ref,context),/encrypted vault request was rejected/);
  const clean=harness();const cleanRef=await clean.vault.putOnce(code,context);await clean.vault.delete(cleanRef,context);await clean.vault.delete(cleanRef,context);
  assert.ok(clean.s3.calls.every(x=>x.ExpectedBucketOwner==="123456789012"));
  const expired=new S3KmsAuthorizationCodeVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,expectedBucketOwner:"123456789012",prefix:OAUTH_CODE_OBJECT_PREFIX,
    s3Client:clean.s3,kmsClient:clean.kms,clock:{now:()=>new Date("2026-07-21T12:11:00.000Z")}});
  await assert.rejects(expired.read(cleanRef,context),/rejected/);
});

test("default clients pin official endpoints despite ambient override variables",async()=>{const old=process.env.AWS_ENDPOINT_URL;process.env.AWS_ENDPOINT_URL="https://evil.invalid";
  try{const vault=new S3KmsAuthorizationCodeVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,expectedBucketOwner:"123456789012",prefix:OAUTH_CODE_OBJECT_PREFIX}) as any;
    assert.equal((await vault.config.s3.config.endpoint()).hostname,"s3.us-east-1.amazonaws.com");assert.equal((await vault.config.kms.kmsClient.config.endpoint()).hostname,"kms.us-east-1.amazonaws.com");
  }finally{if(old===undefined)delete process.env.AWS_ENDPOINT_URL;else process.env.AWS_ENDPOINT_URL=old;}});

test("code vault rejects a bucket owner outside the KMS account",()=>{
  assert.throws(()=>new S3KmsAuthorizationCodeVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,
    expectedBucketOwner:"999999999999",prefix:OAUTH_CODE_OBJECT_PREFIX}),/encrypted vault request was rejected/);
});

test("code read rechecks expiry after external I/O and cleanup rejects ambiguous 404s",async()=>{
  const h=harness();const ref=await h.vault.putOnce(code,context);let reads=0;
  const s3CallsBefore=h.s3.calls.length;const kmsCallsBefore=h.kms.calls.length;
  const expiring=new S3KmsAuthorizationCodeVault({bucket:"oauth-vault-bucket",region:"us-east-1",kmsKeyArn:keyArn,
    expectedBucketOwner:"123456789012",prefix:OAUTH_CODE_OBJECT_PREFIX,s3Client:h.s3,kmsClient:h.kms,
    clock:{now:()=>new Date(reads++<2?"2026-07-21T12:09:59.999Z":"2026-07-21T12:10:00.000Z")}});
  await assert.rejects(expiring.read(ref,context),/encrypted vault request was rejected/);
  assert.ok(h.s3.calls.length>s3CallsBefore);assert.ok(h.kms.calls.length>kmsCallsBefore);
  const statusOnly=harness();statusOnly.s3.send=async()=>{throw Object.assign(new Error("gateway 404"),{$metadata:{httpStatusCode:404}});};
  await assert.rejects(statusOnly.vault.delete(ref,context),/encrypted vault request was rejected/);
});

test("code vault fails closed on AEAD, metadata, and KMS substitution without leaking errors",async()=>{
  const tampered=harness();const ref=await tampered.vault.putOnce(code,context);
  const envelope=JSON.parse(Buffer.from(tampered.s3.stored.Body).toString("utf8"));
  const ciphertext=Buffer.from(envelope.ciphertext,"base64");ciphertext[0]^=1;envelope.ciphertext=ciphertext.toString("base64");
  tampered.s3.stored.Body=Buffer.from(JSON.stringify(envelope));
  await assert.rejects(tampered.vault.read(ref,context),/encrypted vault request was rejected/);

  const duplicate=harness();const duplicateRef=await duplicate.vault.putOnce(code,context);
  duplicate.s3.stored.Metadata["Binding-Digest"]=duplicate.s3.stored.Metadata["binding-digest"];
  await assert.rejects(duplicate.vault.read(duplicateRef,context),/encrypted vault request was rejected/);

  const kmsFailure=harness();const kmsRef=await kmsFailure.vault.putOnce(code,context);
  kmsFailure.kms.decryptError=new Error("KMS leaked authorization-code-secret-sentinel");
  const error=await kmsFailure.vault.read(kmsRef,context).then(()=>undefined,(caught:unknown)=>caught);
  assert.equal(error instanceof Error?error.message:"","OAuth encrypted vault request was rejected");
});
