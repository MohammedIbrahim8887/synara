// Live view of a Sona-owned browser tab: draws the page's screencast frames and
// forwards pointer, wheel, keyboard, paste and IME input back to Chromium.
import { useEffect, useRef } from "react";

import { readSonaBrowserPane, type SonaBrowserInput } from "~/sonaBrowserPane";
import { isMacPlatform } from "~/lib/utils";

const MOUSE_BUTTONS = ["left", "middle", "right"] as const;

function modifierBits(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

/** Editing shortcuts CDP key events do not trigger on their own. */
function editingCommands(event: KeyboardEvent, mac: boolean): string[] | undefined {
  const primary = mac ? event.metaKey : event.ctrlKey;
  if (!primary || event.altKey) return undefined;
  switch (event.key.toLowerCase()) {
    case "a":
      return ["selectAll"];
    case "c":
      return ["copy"];
    case "x":
      return ["cut"];
    case "z":
      return [event.shiftKey ? "redo" : "undo"];
    case "y":
      return mac ? undefined : ["redo"];
    default:
      return undefined;
  }
}

export function keyInput(
  event: KeyboardEvent,
  phase: "down" | "up",
  mac: boolean,
): Extract<SonaBrowserInput, { kind: "key" }> {
  const modifiers = modifierBits(event);
  const printable =
    event.key === "Enter"
      ? "\r"
      : event.key.length === 1 && !event.ctrlKey && !event.metaKey
        ? event.key
        : undefined;
  const commands = phase === "down" ? editingCommands(event, mac) : undefined;
  return {
    kind: "key",
    type: phase === "up" ? "keyUp" : printable ? "keyDown" : "rawKeyDown",
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    modifiers,
    ...(phase === "down" && printable ? { text: printable } : {}),
    ...(commands ? { commands } : {}),
    ...(event.location === 1 || event.location === 2 ? { location: event.location } : {}),
    ...(event.repeat ? { repeat: true } : {}),
  };
}

function decodeFrame(data: string): Promise<ImageBitmap> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
}

export function SonaBrowserStreamSurface({ tabId }: { tabId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const pane = readSonaBrowserPane();
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const keyboard = keyboardRef.current;
    if (!pane || !container || !canvas || !keyboard) return;
    const context = canvas.getContext("2d");
    const mac = isMacPlatform(navigator.platform);
    let bitmap: ImageBitmap | null = null;
    // Page viewport size in CSS pixels, from the latest frame's metadata.
    let pageWidth = container.clientWidth;
    let pageHeight = container.clientHeight;
    let decoding = false;
    let queued: { data: string; width: number; height: number } | null = null;
    let disposed = false;

    const draw = () => {
      if (!context || !bitmap) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const height = (canvas.width * bitmap.height) / bitmap.width;
      context.drawImage(bitmap, 0, 0, canvas.width, height);
    };
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(container.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(container.clientHeight * ratio));
      draw();
    };
    const decodeLatest = async () => {
      if (decoding) return;
      decoding = true;
      // Only the newest frame matters; earlier ones are dropped while decoding.
      for (let frame = queued; frame; frame = queued) {
        if (disposed) break;
        queued = null;
        try {
          const next = await decodeFrame(frame.data);
          if (disposed) {
            next.close();
            break;
          }
          bitmap?.close();
          bitmap = next;
          pageWidth = frame.width;
          pageHeight = frame.height;
          draw();
        } catch {
          // Drop a frame that failed to decode; the next one replaces it.
        }
      }
      decoding = false;
    };
    const unsubscribe = pane.subscribeFrames(tabId, (frame) => {
      queued = frame;
      void decodeLatest();
    });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const point = (event: { clientX: number; clientY: number }) => {
      const rect = container.getBoundingClientRect();
      // Frames are drawn width-fitted, so one scale maps both axes.
      const scale = rect.width > 0 ? pageWidth / rect.width : 1;
      return {
        x: Math.max(0, Math.min(pageWidth, (event.clientX - rect.left) * scale)),
        y: Math.max(0, Math.min(pageHeight, (event.clientY - rect.top) * scale)),
      };
    };
    const send = (input: SonaBrowserInput) => pane.sendInput(tabId, input);

    let pendingMove: PointerEvent | null = null;
    let moveFrame = 0;
    const flushMove = () => {
      moveFrame = 0;
      if (!pendingMove) return;
      const event = pendingMove;
      pendingMove = null;
      send({
        kind: "mouse",
        type: "mouseMoved",
        ...point(event),
        button: "none",
        buttons: event.buttons,
        clickCount: 0,
        modifiers: modifierBits(event),
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      pendingMove = event;
      moveFrame ||= requestAnimationFrame(flushMove);
    };
    const onPointerButton = (event: PointerEvent) => {
      const button = MOUSE_BUTTONS[event.button];
      if (!button) return;
      event.preventDefault();
      if (event.type === "pointerdown") {
        container.setPointerCapture(event.pointerId);
        keyboard.focus({ preventScroll: true });
      }
      flushMove();
      send({
        kind: "mouse",
        type: event.type === "pointerdown" ? "mousePressed" : "mouseReleased",
        ...point(event),
        button,
        buttons: event.buttons,
        clickCount: Math.max(1, Math.min(3, event.detail || 1)),
        modifiers: modifierBits(event),
      });
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
      send({
        kind: "wheel",
        ...point(event),
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
        modifiers: modifierBits(event),
      });
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const primary = mac ? event.metaKey : event.ctrlKey;
      // Let the native paste event fire so clipboard text reaches the page.
      if (primary && event.key.toLowerCase() === "v") return;
      event.preventDefault();
      send(keyInput(event, "down", mac));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      event.preventDefault();
      send(keyInput(event, "up", mac));
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain");
      if (text) send({ kind: "text", text });
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      if (event.data) send({ kind: "text", text: event.data });
      keyboard.value = "";
    };
    const onInput = () => {
      if (!(keyboard as HTMLTextAreaElement & { isComposing?: boolean }).isComposing) {
        keyboard.value = "";
      }
    };

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerdown", onPointerButton);
    container.addEventListener("pointerup", onPointerButton);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("contextmenu", onContextMenu);
    keyboard.addEventListener("keydown", onKeyDown);
    keyboard.addEventListener("keyup", onKeyUp);
    keyboard.addEventListener("paste", onPaste);
    keyboard.addEventListener("compositionend", onCompositionEnd);
    keyboard.addEventListener("input", onInput);
    return () => {
      disposed = true;
      unsubscribe();
      observer.disconnect();
      if (moveFrame) cancelAnimationFrame(moveFrame);
      bitmap?.close();
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerdown", onPointerButton);
      container.removeEventListener("pointerup", onPointerButton);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("contextmenu", onContextMenu);
      keyboard.removeEventListener("keydown", onKeyDown);
      keyboard.removeEventListener("keyup", onKeyUp);
      keyboard.removeEventListener("paste", onPaste);
      keyboard.removeEventListener("compositionend", onCompositionEnd);
      keyboard.removeEventListener("input", onInput);
    };
  }, [tabId]);

  return (
    <div
      ref={containerRef}
      data-sona-browser-stream="true"
      className="absolute inset-0 touch-none select-none"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <textarea
        ref={keyboardRef}
        tabIndex={-1}
        aria-hidden="true"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="pointer-events-none absolute top-0 left-0 size-px resize-none opacity-0"
      />
    </div>
  );
}
