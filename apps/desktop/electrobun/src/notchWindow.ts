import { CFunction, dlopen, FFIType, type Pointer } from "bun:ffi";

// AppKit constants: NSMainMenuWindowLevel + 1 sits above the menu bar so the
// island can occupy the notch; the behavior joins every Space and full-screen
// apps without appearing in Mission Control or the window cycle.
const NS_STATUS_WINDOW_LEVEL = 25n;
const COLLECTION_BEHAVIOR = BigInt(
  (1 << 0) /* canJoinAllSpaces */ |
    (1 << 4) /* stationary */ |
    (1 << 6) /* ignoresCycle */ |
    (1 << 8) /* fullScreenAuxiliary */,
);

const cstr = (value: string) => Buffer.from(`${value}\0`);

function objcRuntime() {
  const lib = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    object_getClassName: { args: [FFIType.ptr], returns: FFIType.cstring },
    objc_msgSend: { args: [], returns: FFIType.void },
  });
  const send = lib.symbols.objc_msgSend.ptr;
  return {
    className: (target: Pointer) => String(lib.symbols.object_getClassName(target)),
    cls: (name: string) => lib.symbols.objc_getClass(cstr(name)),
    sel: (name: string) => lib.symbols.sel_registerName(cstr(name)),
    sendPtr: CFunction({
      ptr: send,
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    }),
    sendArg: CFunction({
      ptr: send,
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i64],
      returns: FFIType.void,
    }),
    sendMain: CFunction({
      ptr: send,
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.bool],
      returns: FFIType.void,
    }),
  };
}
let runtime: ReturnType<typeof objcRuntime> | undefined;

/**
 * AppKit must only be touched on the main thread, while Electrobun runs Bun on a
 * worker. Build an NSInvocation here and let the main run loop perform it.
 */
function invokeOnMain(target: Pointer, selector: string, argument: BigInt64Array | Uint8Array) {
  const objc = (runtime ??= objcRuntime());
  const sel = objc.sel(selector);
  const signature = objc.sendPtr(target, objc.sel("methodSignatureForSelector:"), sel);
  if (!signature) throw new Error(`${objc.className(target)} does not respond to ${selector}`);
  const invocation = objc.sendPtr(
    objc.cls("NSInvocation"),
    objc.sel("invocationWithMethodSignature:"),
    signature,
  );
  if (!invocation) throw new Error(`Could not prepare ${selector}`);
  objc.sendPtr(invocation, objc.sel("setTarget:"), target);
  objc.sendPtr(invocation, objc.sel("setSelector:"), sel);
  // NSInvocation copies the argument bytes, so the buffer need not outlive this call.
  objc.sendArg(invocation, objc.sel("setArgument:atIndex:"), argument as unknown as Pointer, 2n);
  // performSelectorOnMainThread retains the invocation until it has run.
  objc.sendMain(
    invocation,
    objc.sel("performSelectorOnMainThread:withObject:waitUntilDone:"),
    objc.sel("invoke"),
    null,
    false,
  );
}

/** Lifts an Electrobun window into the macOS notch layer. Returns false when unsupported. */
export function raiseIntoNotch(windowPointer: Pointer | null): boolean {
  if (process.platform !== "darwin" || !windowPointer) return false;
  try {
    const objc = (runtime ??= objcRuntime());
    if (!objc.className(windowPointer).includes("Window"))
      throw new Error(`Unexpected native handle ${objc.className(windowPointer)}`);
    invokeOnMain(windowPointer, "setLevel:", BigInt64Array.of(NS_STATUS_WINDOW_LEVEL));
    invokeOnMain(windowPointer, "setCollectionBehavior:", BigInt64Array.of(COLLECTION_BEHAVIOR));
    invokeOnMain(windowPointer, "setHasShadow:", Uint8Array.of(0));
    return true;
  } catch (error) {
    console.error("Sona could not place the island in the notch:", error);
    return false;
  }
}

export type IslandMode = "hidden" | "compact" | "expanded";

/** Notch geometry in Electrobun's top-left screen coordinates. */
export function islandFrame(
  display: {
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { y: number; height: number };
  },
  mode: Exclude<IslandMode, "hidden">,
) {
  const { bounds, workArea } = display;
  // The menu bar height equals the notch height on notched Macs.
  const menuBar = Math.max(24, Math.min(64, workArea.y - bounds.y || 32));
  const width = Math.min(mode === "expanded" ? 560 : 340, bounds.width);
  const height = mode === "expanded" ? Math.min(680, bounds.height) : menuBar;
  return { x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y, width, height };
}
