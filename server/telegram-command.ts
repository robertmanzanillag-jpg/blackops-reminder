export type TelegramControlCommand =
  | "help"
  | "readiness"
  | "health"
  | "brief"
  | "pending"
  | "approve"
  | "reject"
  | null;

export function normalizeTelegramCommand(message: string): string {
  return message.trim().toLowerCase().replace(/^\//, "");
}

export function classifyTelegramControlCommand(message: string): TelegramControlCommand {
  const normalized = normalizeTelegramCommand(message);

  if (/^(start|ayuda|help|comandos)\b/.test(normalized)) {
    return "help";
  }

  if (/^(readiness|estado ceo|ceo status|operacion|operación|listo)\b/.test(normalized)) {
    return "readiness";
  }

  if (/^(health|status|salud|diagnostico|diagnóstico|estado sistema)\b/.test(normalized)) {
    return "health";
  }

  if (/^(brief|resumen|agenda|prioridades|estado)\b/.test(normalized)) {
    return "brief";
  }

  if (/^(pendientes|aprobaciones|acciones pendientes)\b/.test(normalized)) {
    return "pending";
  }

  if (/^(aprobar|aprueba|autorizar|autoriza)\b/.test(normalized)) {
    return "approve";
  }

  if (/^(rechazar|rechaza|cancelar|cancela)\b/.test(normalized)) {
    return "reject";
  }

  return null;
}
