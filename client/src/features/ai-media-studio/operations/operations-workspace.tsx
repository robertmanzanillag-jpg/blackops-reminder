import { AnalyticsWorkspace } from "./analytics";
import { AutomationWorkspace } from "./automation";
import { PublishingWorkspace } from "./publishing";

export function OperationsWorkspace() {
  return <div className="space-y-14"><PublishingWorkspace /><AnalyticsWorkspace /><AutomationWorkspace /></div>;
}
