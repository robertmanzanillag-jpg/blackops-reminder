import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

// Floating office panels the owner can drag (mouse, pen or touch). The panel keeps its
// default Tailwind position until it is moved; then it is placed with fixed left/top,
// clamped to the viewport, and the position is remembered per panel in localStorage.
// Storage can be unavailable (private mode, blocked site data): every access is guarded.

export type PanelOffset = { x: number; y: number };
const STORAGE_PREFIX = "agentsOffice.panelPosition.v1:";
const MARGIN = 8;

/** Keeps at least `MARGIN` px of the panel inside the viewport (pure; tested). */
export function clampPanelPosition(position: PanelOffset, size: { width: number; height: number }, viewport: { width: number; height: number }): PanelOffset {
  const maxX = Math.max(MARGIN, viewport.width - size.width - MARGIN);
  const maxY = Math.max(MARGIN, viewport.height - Math.min(size.height, viewport.height - 2 * MARGIN) - MARGIN);
  return { x: Math.round(Math.min(Math.max(MARGIN, position.x), maxX)), y: Math.round(Math.min(Math.max(MARGIN, position.y), maxY)) };
}

export function parseStoredPanelPosition(raw: string | null): PanelOffset | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PanelOffset> | null;
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y) } : null;
  } catch {
    return null;
  }
}

function readStored(id: string): PanelOffset | null {
  try { return parseStoredPanelPosition(window.localStorage.getItem(STORAGE_PREFIX + id)); } catch { return null; }
}
function writeStored(id: string, value: PanelOffset | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_PREFIX + id);
  } catch { /* Position stays for this visit only. */ }
}

export function useDraggablePanel(id: string) {
  const ref = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<PanelOffset | null>(() => (typeof window === "undefined" ? null : readStored(id)));
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  const clampToViewport = useCallback((next: PanelOffset) => {
    const box = ref.current?.getBoundingClientRect();
    return clampPanelPosition(next, { width: box?.width ?? 320, height: box?.height ?? 200 }, { width: window.innerWidth, height: window.innerHeight });
  }, []);

  // Re-clamp a remembered position when the window shrinks (rotating a phone, resizing).
  useEffect(() => {
    if (!position) return;
    const onResize = () => setPosition(current => (current ? clampToViewport(current) : current));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // Only (re)subscribe when dragging starts or stops being active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(position), clampToViewport]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // Buttons and inputs inside the handle keep working as usual.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { pointerId: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Older browsers drag without capture. */ }
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setPosition(clampToViewport({ x: event.clientX - current.dx, y: event.clientY - current.dy }));
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Capture already released. */ }
    setPosition(value => { if (value) writeStored(id, value); return value; });
  };
  const reset = () => { setPosition(null); writeStored(id, null); };

  const style: CSSProperties | undefined = position ? { position: "fixed", left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined;
  const handleProps = {
    onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag,
    style: { touchAction: "none", cursor: "grab" } as CSSProperties,
    title: "Arrastra para mover este panel",
  };
  return { ref, style, handleProps, moved: Boolean(position), reset };
}
