import type { TenantScope } from "../core/resource-domain";
import type { SourceAdapter, SourceAdapterItem, SourceAdapterSnapshot, SourceCategory, SourceSnapshotRequest } from "./contracts";

export class FakeSourceAdapter implements SourceAdapter {
  readonly categories: readonly SourceCategory[];

  constructor(
    readonly key: string,
    private readonly items: readonly SourceAdapterItem[],
    categories?: readonly SourceCategory[],
    private readonly capturedAt = "2026-07-20T12:00:00.000Z",
  ) {
    this.categories = categories ?? [...new Set(items.map((item) => item.category))];
  }

  async fetchSnapshot(_scope: TenantScope, request: SourceSnapshotRequest): Promise<SourceAdapterSnapshot> {
    const offset = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const items = this.items.slice(start, start + request.limit);
    const next = start + items.length;
    return {
      items,
      nextCursor: next < this.items.length ? String(next) : undefined,
      capturedAt: this.capturedAt,
    };
  }
}
