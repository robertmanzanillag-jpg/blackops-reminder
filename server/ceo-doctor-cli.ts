export type CeoDoctorOptions = {
  userId: string;
  chatId: string;
  json: boolean;
};

export type CeoDoctorCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export function parseCeoDoctorArgs(argv: string[]): CeoDoctorOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    userId: getValue("--user-id"),
    chatId: getValue("--chat-id"),
    json: argv.includes("--json"),
  };
}

export function buildCeoDoctorChecks(env: NodeJS.ProcessEnv, options: CeoDoctorOptions): CeoDoctorCheck[] {
  const briefHour = Number(env.CEO_BRIEF_HOUR ?? "7");
  const briefMinute = Number(env.CEO_BRIEF_MINUTE ?? "0");
  const schedulerValid = Boolean(env.SCHEDULER_TIMEZONE)
    && Number.isFinite(briefHour)
    && briefHour >= 0
    && briefHour <= 23
    && Number.isFinite(briefMinute)
    && briefMinute >= 0
    && briefMinute <= 59;

  return [
    {
      id: "database",
      label: "Database",
      ok: Boolean(env.DATABASE_URL),
      detail: env.DATABASE_URL ? "DATABASE_URL configured." : "Set DATABASE_URL for app data and persistent sessions.",
    },
    {
      id: "ai",
      label: "Assistant AI",
      ok: Boolean(env.AI_INTEGRATIONS_GEMINI_API_KEY),
      detail: env.AI_INTEGRATIONS_GEMINI_API_KEY ? "AI key configured." : "Set AI_INTEGRATIONS_GEMINI_API_KEY for app and Telegram chat.",
    },
    {
      id: "session",
      label: "Session auth",
      ok: Boolean(env.SESSION_SECRET),
      detail: env.SESSION_SECRET ? "SESSION_SECRET configured." : "Set SESSION_SECRET for production login sessions.",
    },
    {
      id: "local_auth",
      label: "Local auth",
      ok: env.LOCAL_AUTH_ENABLED === "true",
      detail: env.LOCAL_AUTH_ENABLED === "true" ? "LOCAL_AUTH_ENABLED=true." : "Set LOCAL_AUTH_ENABLED=true unless another auth provider populates req.user/session.",
    },
    {
      id: "dev_fallback",
      label: "Dev fallback",
      ok: env.ALLOW_DEV_USER_FALLBACK === "false",
      detail: env.ALLOW_DEV_USER_FALLBACK === "false" ? "ALLOW_DEV_USER_FALLBACK=false." : "Set ALLOW_DEV_USER_FALLBACK=false before production.",
    },
    {
      id: "telegram_token",
      label: "Telegram token",
      ok: Boolean(env.TELEGRAM_BOT_TOKEN),
      detail: env.TELEGRAM_BOT_TOKEN ? "TELEGRAM_BOT_TOKEN configured." : "Set TELEGRAM_BOT_TOKEN from BotFather.",
    },
    {
      id: "telegram_url",
      label: "Telegram webhook URL",
      ok: Boolean(env.TELEGRAM_WEBHOOK_URL || env.PUBLIC_APP_URL || env.REPLIT_DEV_DOMAIN || (env.REPL_SLUG && env.REPL_OWNER)),
      detail: env.TELEGRAM_WEBHOOK_URL || env.PUBLIC_APP_URL
        ? "Public webhook URL configured."
        : "Set PUBLIC_APP_URL or TELEGRAM_WEBHOOK_URL for production webhook setup.",
    },
    {
      id: "telegram_secret",
      label: "Telegram webhook secret",
      ok: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
      detail: env.TELEGRAM_WEBHOOK_SECRET ? "TELEGRAM_WEBHOOK_SECRET configured." : "Set TELEGRAM_WEBHOOK_SECRET before production.",
    },
    {
      id: "user_id",
      label: "Real user id",
      ok: Boolean(options.userId),
      detail: options.userId ? `Using user id ${options.userId}.` : "Pass --user-id=<real-user-id> after creating/migrating the user.",
    },
    {
      id: "chat_id",
      label: "Telegram chat id",
      ok: Boolean(options.chatId),
      detail: options.chatId ? `Using chat id ${options.chatId}.` : "Pass --chat-id=<telegram-chat-id> to print the configure command.",
    },
    {
      id: "scheduler",
      label: "Morning brief schedule",
      ok: schedulerValid,
      detail: schedulerValid
        ? `Brief scheduled at ${String(briefHour).padStart(2, "0")}:${String(briefMinute).padStart(2, "0")} (${env.SCHEDULER_TIMEZONE}).`
        : "Set SCHEDULER_TIMEZONE, CEO_BRIEF_HOUR 0-23, and CEO_BRIEF_MINUTE 0-59.",
    },
  ];
}

export function buildCeoDoctorNextCommands(options: CeoDoctorOptions): string[] {
  const userId = options.userId || "<real-user-id>";
  const chatId = options.chatId || "<telegram-chat-id>";
  return [
    "npm run auth:create-user -- --username=<username> --password=<password> --print-user-id",
    `npm run user:migrate -- --from=mock-user-123 --to=${userId} --execute`,
    `npm run telegram:configure -- --user-id=${userId} --chat-id=${chatId} --execute`,
    `npm run telegram:configure -- --user-id=${userId} --latest --execute`,
    "npm run telegram:webhook -- setup --execute",
    `npm run ceo:readiness -- --user-id=${userId}`,
    `npm run ceo:send-brief -- --user-id=${userId} --execute`,
  ];
}

export function formatCeoDoctorReport(checks: CeoDoctorCheck[], commands: string[]): string {
  const ready = checks.every((check) => check.ok);
  const lines = [
    "CEO Assistant Doctor",
    `Ready: ${ready ? "yes" : "no"}`,
    "",
    ...checks.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.label}: ${check.detail}`),
    "",
    "Next commands:",
    ...commands.map((command) => `- ${command}`),
  ];
  return lines.join("\n");
}

export function formatCeoDoctorJson(checks: CeoDoctorCheck[], commands: string[]): string {
  return JSON.stringify({
    ready: checks.every((check) => check.ok),
    checks,
    commands,
  }, null, 2);
}
