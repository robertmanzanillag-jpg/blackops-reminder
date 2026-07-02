import { hasRealValue } from "./ceo-doctor-cli";

export type RevenueMoneyReadinessCliOptions = {
  mode: string;
  json: boolean;
};

export function parseRevenueMoneyReadinessArgs(argv: string[]): RevenueMoneyReadinessCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };
  const mode = getValue("--mode") || "first-sprint";

  return {
    mode: mode || "first-sprint",
    json: argv.includes("--json"),
  };
}

export function validateRevenueMoneyReadinessOptions(options: RevenueMoneyReadinessCliOptions): string[] {
  if (options.mode === "first-sprint" || options.mode === "production-launch") return [];
  return ["--mode must be first-sprint or production-launch."];
}

export function formatRevenueMoneyReadinessText(report: {
  ready: boolean;
  status: string;
  headline: string;
  canStartToday: boolean;
  canSearchBusinesses: boolean;
  canAutonomousSearchBusinesses: boolean;
  canRunGuardedPublicScoutCapture?: boolean;
  canContactBusinesses: boolean;
  canCollectMoney: boolean;
  canBuildWebsites: boolean;
  nextApiAction: string;
  nextAction: string;
  allowedToday: string[];
  blockedUntil: string[];
  remainingGaps: string[];
  checks: Array<{ id: string; label: string; status: "ok" | "fail"; detail: string; nextStep: string }>;
}): string {
  const lines = [
    `Revenue money readiness: ${report.status}`,
    `Ready: ${report.ready ? "yes" : "no"}`,
    report.headline,
    "",
    `Can start today: ${report.canStartToday ? "yes" : "no"}`,
    `Can search businesses: ${report.canSearchBusinesses ? "yes" : "no"}`,
    `Can autonomously discover businesses: ${report.canAutonomousSearchBusinesses ? "yes" : "no"}`,
    `Can run guarded public scout capture: ${report.canRunGuardedPublicScoutCapture ? "yes" : "no"}`,
    `Can contact businesses: ${report.canContactBusinesses ? "yes" : "no"}`,
    `Can collect money: ${report.canCollectMoney ? "yes" : "no"}`,
    `Can build/publish websites: ${report.canBuildWebsites ? "yes" : "no"}`,
    `Next API action: ${report.nextApiAction}`,
    `Next action: ${report.nextAction}`,
    "",
    "Allowed today:",
    ...report.allowedToday.map((item) => `- ${item}`),
    "",
    "Blocked until:",
    ...report.blockedUntil.map((item) => `- ${item}`),
    "",
    "Remaining gaps:",
    ...report.remainingGaps.map((item) => `- ${item}`),
    "",
    "Checks:",
    ...report.checks.map((check) => `- [${check.status}] ${check.label}: ${check.detail}`),
  ];

  return lines.join("\n");
}

export function isRevenueMoneyModePlaceholder(value: string | undefined) {
  return !hasRealValue(value) || value !== "live";
}
