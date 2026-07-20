export type ArchiveDialogState = {
  open: boolean;
  phase: "idle" | "pending" | "error";
  error: string;
};

export type ArchiveDialogEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "confirm" }
  | { type: "success" }
  | { type: "failure"; message: string };

export const initialArchiveDialogState: ArchiveDialogState = { open: false, phase: "idle", error: "" };

export function archiveDialogReducer(state: ArchiveDialogState, event: ArchiveDialogEvent): ArchiveDialogState {
  if (event.type === "open") return { open: true, phase: "idle", error: "" };
  if (event.type === "close") return state.phase === "pending" ? state : initialArchiveDialogState;
  if (event.type === "confirm") return state.open ? { open: true, phase: "pending", error: "" } : state;
  if (event.type === "success") return initialArchiveDialogState;
  return { open: true, phase: "error", error: event.message };
}
