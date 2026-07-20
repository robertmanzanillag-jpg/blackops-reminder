import type { TenantScope } from "../core/resource-domain";
import type { AnalyticsIngestionAdapter, AnalyticsIngestionBatch } from "./domain";

/** Deterministic test/dev adapter. It only returns configured fixtures and never performs I/O. */
export class FakeAnalyticsIngestionAdapter implements AnalyticsIngestionAdapter {
  readonly calls: TenantScope[] = [];

  constructor(
    private readonly fixture: AnalyticsIngestionBatch | ((scope: TenantScope) => AnalyticsIngestionBatch),
  ) {}

  async fetch(scope: TenantScope): Promise<AnalyticsIngestionBatch> {
    this.calls.push({ ...scope });
    const value = typeof this.fixture === "function" ? this.fixture(scope) : this.fixture;
    return structuredClone(value);
  }
}
