import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { OAuthFlowError } from "./contracts";

const SHA256 = /^[0-9a-f]{64}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
export const MAX_ENVELOPE_BYTES = 96 * 1024;

export const OAUTH_VAULT_SEND_BUDGET_MS=15_000;
export interface AwsCommandClient { send(command: unknown,options?:{abortSignal?:AbortSignal}): Promise<any> }
export async function sendBounded(client:AwsCommandClient,command:unknown):Promise<any>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),OAUTH_VAULT_SEND_BUDGET_MS);timer.unref?.();try{return await client.send(command,{abortSignal:controller.signal});}finally{clearTimeout(timer);}}
export function boundedClient(client:AwsCommandClient):AwsCommandClient{return Object.assign({send:(command:unknown)=>sendBounded(client,command)},
  (client as {config?:unknown}).config===undefined?{}:{config:(client as {config?:unknown}).config});}

export type EnvelopeKmsConfig = Readonly<{
  region: string;
  kmsKeyArn: string;
  kmsClient?: AwsCommandClient;
}>;

export type NormalizedEnvelopeKmsConfig = Readonly<{
  kmsKeyArn: string;
  kmsClient: AwsCommandClient;
}>;

type EnvelopeV1 = Readonly<{
  v: 1;
  bindingDigest: string;
  encryptedDataKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}>;

export function normalizeEnvelopeKmsConfig(config: EnvelopeKmsConfig): NormalizedEnvelopeKmsConfig {
  const partition = assertKmsKeyArn(config.kmsKeyArn, config.region);
  return {
    kmsKeyArn: config.kmsKeyArn,
    kmsClient: config.kmsClient ?? new KMSClient({
      region: config.region,
      endpoint: `https://kms.${config.region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`,
    }),
  };
}

export function canonicalContextBytes(entries: readonly (string | number)[]): Buffer {
  if (!entries.length || entries.some((entry) => typeof entry === "string" ? !entry.length : !Number.isSafeInteger(entry))) throw vaultRejected();
  return Buffer.from(JSON.stringify(entries), "utf8");
}

export function digestContext(aad: Uint8Array): string {
  return createHash("sha256").update(aad).digest("hex");
}

function encryptionContext(bindingDigest: string): Record<string, string> {
  if (!SHA256.test(bindingDigest)) throw vaultRejected();
  return { "ai-media-oauth-binding": bindingDigest, "ai-media-oauth-envelope": "v1" };
}

export async function encryptEnvelope(
  plaintext: Uint8Array,
  aad: Uint8Array,
  config: NormalizedEnvelopeKmsConfig,
): Promise<{ body: Buffer; bindingDigest: string }> {
  if (!plaintext.byteLength || plaintext.byteLength > 64 * 1024 || !aad.byteLength || aad.byteLength > 8 * 1024) throw vaultRejected();
  const bindingDigest = digestContext(aad);
  let dek: Buffer | undefined;
  let kmsPlaintext: Uint8Array | undefined;
  try {
    const generated = await sendBounded(config.kmsClient,new GenerateDataKeyCommand({
      KeyId: config.kmsKeyArn,
      KeySpec: "AES_256",
      EncryptionContext: encryptionContext(bindingDigest),
    }));
    if (!(generated?.Plaintext instanceof Uint8Array) || generated.Plaintext.byteLength !== 32
      || !(generated?.CiphertextBlob instanceof Uint8Array) || generated.CiphertextBlob.byteLength < 1) throw vaultRejected();
    kmsPlaintext = generated.Plaintext;
    dek = Buffer.from(generated.Plaintext);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const envelope: EnvelopeV1 = {
      v: 1, bindingDigest, encryptedDataKey: Buffer.from(generated.CiphertextBlob).toString("base64"),
      iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
    };
    const body = Buffer.from(JSON.stringify(envelope), "utf8");
    if (body.byteLength > MAX_ENVELOPE_BYTES) throw vaultRejected();
    return { body, bindingDigest };
  } catch (error) {
    if (error instanceof OAuthFlowError) throw error;
    throw vaultRejected();
  } finally {
    dek?.fill(0);
    kmsPlaintext?.fill(0);
  }
}

export async function decryptEnvelope(
  body: Uint8Array,
  aad: Uint8Array,
  expectedBindingDigest: string,
  config: NormalizedEnvelopeKmsConfig,
): Promise<Buffer> {
  let dek: Buffer | undefined;
  let kmsPlaintext: Uint8Array | undefined;
  try {
    const envelope = parseEnvelope(body);
    const actualDigest = digestContext(aad);
    if (!safeEqual(actualDigest, expectedBindingDigest) || !safeEqual(envelope.bindingDigest, actualDigest)) throw vaultRejected();
    const encryptedDataKey = decodeBase64(envelope.encryptedDataKey, 1, 16 * 1024);
    const decrypted = await sendBounded(config.kmsClient,new DecryptCommand({
      CiphertextBlob: encryptedDataKey,
      KeyId: config.kmsKeyArn,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: encryptionContext(actualDigest),
    }));
    if (!(decrypted?.Plaintext instanceof Uint8Array) || decrypted.Plaintext.byteLength !== 32) throw vaultRejected();
    kmsPlaintext = decrypted.Plaintext;
    dek = Buffer.from(decrypted.Plaintext);
    const iv = decodeBase64(envelope.iv, 12, 12);
    const authTag = decodeBase64(envelope.authTag, 16, 16);
    const ciphertext = decodeBase64(envelope.ciphertext, 1, 64 * 1024);
    const decipher = createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    if (error instanceof OAuthFlowError) throw error;
    throw vaultRejected();
  } finally {
    dek?.fill(0);
    kmsPlaintext?.fill(0);
  }
}

export async function readBoundedBody(body: unknown, max = MAX_ENVELOPE_BYTES): Promise<Buffer> {
  if (!body || typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function") throw vaultRejected();
  const chunks: Buffer[] = []; let total = 0;
  for await (const raw of body as AsyncIterable<unknown>) {
    const chunk = typeof raw === "string" ? Buffer.from(raw) : raw instanceof Uint8Array ? Buffer.from(raw) : undefined;
    if (!chunk || (total += chunk.byteLength) > max) throw vaultRejected();
    chunks.push(chunk);
  }
  if (!total) throw vaultRejected();
  return Buffer.concat(chunks, total);
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function vaultRejected(): OAuthFlowError { return new OAuthFlowError("OAuth encrypted vault request was rejected"); }

export function isExactS3KeyAbsence(error: unknown, headRequest = false): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown };
  return value.name === "NoSuchKey" || (headRequest && value.name === "NotFound");
}

export function normalizedExactMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw vaultRejected();
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (typeof item !== "string" || normalizedKey in output) throw vaultRejected();
    output[normalizedKey] = item;
  }
  return output;
}

export function validBucket(value: string): boolean {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value)
    && !value.includes("..") && !/^\d+(?:\.\d+){3}$/u.test(value);
}

export function officialS3Endpoint(partition: "aws" | "aws-us-gov" | "aws-cn", region: string): string {
  return `https://s3.${region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`;
}

export function assertKmsKeyArn(value: string, region: string): "aws" | "aws-us-gov" | "aws-cn" {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(region)) throw vaultRejected();
  const match = /^arn:(aws|aws-us-gov|aws-cn):kms:([a-z0-9-]+):(\d{12}):key\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(value);
  if (!match || match[2] !== region) throw vaultRejected();
  const partition = match[1] as "aws" | "aws-us-gov" | "aws-cn";
  if ((partition === "aws-cn") !== region.startsWith("cn-") || (partition === "aws-us-gov") !== region.startsWith("us-gov-")
    || (partition === "aws" && (region.startsWith("cn-") || region.startsWith("us-gov-")))) throw vaultRejected();
  return partition;
}

export function assertExpectedBucketOwner(kmsKeyArn: string, expectedBucketOwner: string): void {
  const match = /^arn:(?:aws|aws-us-gov|aws-cn):kms:[a-z0-9-]+:(\d{12}):key\//u.exec(kmsKeyArn);
  if (!match || !safeEqual(match[1], expectedBucketOwner)) throw vaultRejected();
}

function parseEnvelope(body: Uint8Array): EnvelopeV1 {
  if (!body.byteLength || body.byteLength > MAX_ENVELOPE_BYTES) throw vaultRejected();
  let parsed: unknown; try { parsed = JSON.parse(Buffer.from(body).toString("utf8")); } catch { throw vaultRejected(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw vaultRejected();
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "authTag,bindingDigest,ciphertext,encryptedDataKey,iv,v"
    || value.v !== 1 || typeof value.bindingDigest !== "string" || !SHA256.test(value.bindingDigest)
    || typeof value.encryptedDataKey !== "string" || typeof value.iv !== "string"
    || typeof value.authTag !== "string" || typeof value.ciphertext !== "string") throw vaultRejected();
  return value as EnvelopeV1;
}

function decodeBase64(value: string, min: number, max: number): Buffer {
  if (!BASE64.test(value) || value.length > Math.ceil(max / 3) * 4 + 4) throw vaultRejected();
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < min || decoded.byteLength > max || decoded.toString("base64") !== value) throw vaultRejected();
  return decoded;
}
