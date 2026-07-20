import { createHash } from "node:crypto";
import type {
  ArtifactReadRequest,
  ArtifactReadStream,
  AssetDeliverySigner,
  BoundedArtifactReader,
  OwnedObjectStorage,
  OwnedObjectUpload,
} from "./contracts";

export class FakeBoundedArtifactReader implements BoundedArtifactReader {
  readonly requests: ArtifactReadRequest[] = [];
  constructor(private readonly response: ArtifactReadStream | ((request: ArtifactReadRequest) => ArtifactReadStream | Promise<ArtifactReadStream>)) {}
  async open(request: ArtifactReadRequest) {
    this.requests.push(request);
    return typeof this.response === "function" ? this.response(request) : this.response;
  }
}

interface StoredObject { tenantId: string; bytes: Uint8Array; mimeType: string; sha256: string }

export class InMemoryOwnedObjectStorage implements OwnedObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  readonly abortedKeys: string[] = [];

  async beginUpload(input: { tenantId: string; temporaryObjectKey: string }): Promise<OwnedObjectUpload> {
    const chunks: Uint8Array[] = [];
    let ended = false;
    return {
      write: async (chunk) => {
        if (ended) throw new Error("upload already ended");
        chunks.push(new Uint8Array(chunk));
      },
      commit: async (metadata) => {
        if (ended) throw new Error("upload already ended");
        ended = true;
        const bytes = concatenate(chunks);
        if (bytes.byteLength !== metadata.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) throw new Error("object metadata mismatch");
        const finalObjectKey = contentAddressedObjectKey(input.tenantId, metadata.sha256);
        const existing = this.objects.get(finalObjectKey);
        if (existing) {
          if (existing.tenantId !== input.tenantId || existing.sha256 !== metadata.sha256) throw new Error("object key conflict");
          return { finalObjectKey, reused: true };
        }
        this.objects.set(finalObjectKey, { tenantId: input.tenantId, bytes, mimeType: metadata.mimeType, sha256: metadata.sha256 });
        return { finalObjectKey, reused: false };
      },
      abort: async () => {
        if (!ended) this.abortedKeys.push(input.temporaryObjectKey);
        ended = true;
      },
    };
  }

  getForTenant(tenantId: string, objectKey: string) {
    const object = this.objects.get(objectKey);
    return object?.tenantId === tenantId ? { ...object, bytes: new Uint8Array(object.bytes) } : undefined;
  }

  countForTenant(tenantId: string) {
    return [...this.objects.values()].filter((object) => object.tenantId === tenantId).length;
  }
}

export function contentAddressedObjectKey(tenantId: string, sha256: string) {
  const safeTenant = encodeURIComponent(tenantId).replaceAll("%", "_");
  return `ai-media-studio/${safeTenant}/sha256/${sha256}.mp4`;
}

export class FakeAssetDeliverySigner implements AssetDeliverySigner {
  async sign(input: { tenantId: string; objectKey: string; expiresInSeconds: number }) {
    return `https://delivery.invalid/${encodeURIComponent(input.tenantId)}/${input.objectKey}?ttl=${input.expiresInSeconds}`;
  }
}

function concatenate(chunks: readonly Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
