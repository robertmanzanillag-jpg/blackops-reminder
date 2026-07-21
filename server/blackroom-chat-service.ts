import { looksLikeBlackRoomAssistantRequest, parseBlackRoomChatCommand } from "./blackroom-chat";
import {
  appendBlackRoomRemoteCommand,
  isBlackRoomRemoteDeviceOnline,
  mutateBlackRoomRemoteControl,
  readBlackRoomRemoteControl,
  setBlackRoomRemoteCommand,
  type BlackRoomRemoteControlState,
} from "./blackroom-remote-control";

export { looksLikeBlackRoomAssistantRequest };

export function formatBlackRoomChatStatus(state: BlackRoomRemoteControlState, now = new Date()): string {
  const queue = state.device?.queue as { totals?: Record<string, number> } | undefined;
  const totals = queue?.totals || {};
  const device = isBlackRoomRemoteDeviceOnline(state, now) ? "Mac conectada" : "Mac desconectada";
  const activity = state.desiredEnabled ? "activado" : "pausado";
  if (!queue) return `BlackRoom está ${activity}. ${device}; todavía no hay un reporte reciente de la cola.`;
  return `BlackRoom está ${activity}. ${device}. Cola: ${Number(totals.queued || 0)} pendientes, ${Number(totals.processing || 0)} procesando, ${Number(totals.retry || 0)} reintentos, ${Number(totals.scheduled || 0)} agendados y ${Number(totals.completed || 0)} completados.`;
}

export async function executeBlackRoomChatMessage(message: string): Promise<{
  reply: string;
  command: ReturnType<typeof parseBlackRoomChatCommand>["command"];
  remote: BlackRoomRemoteControlState;
}> {
  const current = await readBlackRoomRemoteControl();
  const deviceQueue = current.device?.queue as { postsPerDay?: number; analytics?: { sampleCount?: number } } | undefined;
  const parsed = parseBlackRoomChatCommand(message, {
    analyticsSamples: Number(deviceQueue?.analytics?.sampleCount || 0),
    currentPostsPerDay: Number(deviceQueue?.postsPerDay || 10),
  });
  const reply = parsed.statusRequested ? formatBlackRoomChatStatus(current) : parsed.reply;
  const remote = await mutateBlackRoomRemoteControl((state) => {
    if (parsed.control) {
      setBlackRoomRemoteCommand(state, parsed.control.enabled, parsed.control.weeks ?? state.weeks);
    }
    appendBlackRoomRemoteCommand(state, { message, reply, command: parsed.command });
  });
  return { reply, command: parsed.command, remote };
}
