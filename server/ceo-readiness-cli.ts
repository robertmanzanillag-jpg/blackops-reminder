export type CeoReadinessCliOptions = {
  userId: string;
  json: boolean;
};

export function parseCeoReadinessArgs(argv: string[]): CeoReadinessCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    userId: getValue("--user-id"),
    json: argv.includes("--json"),
  };
}

export function formatCeoReadinessText(report: {
  ready: boolean;
  status: string;
  checks: Array<{ id: string; label: string; status: string; detail: string }>;
}): string {
  const lines = [
    `CEO Assistant status: ${report.status}`,
    `Ready: ${report.ready ? "yes" : "no"}`,
    "",
    ...report.checks.map((check) => `- [${check.status}] ${check.label}: ${check.detail}`),
  ];
  return lines.join("\n");
}
