import { createHash } from "node:crypto";
import type { JsonValue, SourceAdapterItem } from "./contracts";

function stable(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
}

function normalized(value: string | undefined): string | null {
  return value?.trim().replace(/\s+/g, " ").normalize("NFKC") || null;
}

export function sourceContentHash(item: SourceAdapterItem): `sha256:${string}` {
  const identity: JsonValue = {
    category: item.category,
    canonicalUrl: normalized(item.canonicalUrl),
    title: normalized(item.title),
    content: normalized(item.content),
    fingerprint: item.fingerprint ?? {},
  };
  return `sha256:${createHash("sha256").update(stable(identity)).digest("hex")}`;
}
