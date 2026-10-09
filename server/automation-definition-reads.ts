import type { AutomationDefinition } from "@shared/schema";

export interface AutomationDefinitionReader {
  getAutomationDefinitions(userId: string): Promise<AutomationDefinition[]>;
}

// Missing definitions remain missing. A read never registers defaults or resumes.
export function listExistingAutomationDefinitions(reader: AutomationDefinitionReader, userId: string) {
  return reader.getAutomationDefinitions(userId);
}

export function activeMetricoolAnalyticsDefinition(definitions: AutomationDefinition[]): boolean {
  return definitions.some(item => item.status === "active"
    && (item.metadata as { key?: unknown } | null)?.key === "metricool-daily-analytics-sync");
}
