# Electrobun migration status

The production desktop still uses Electron. Electrobun 2.0.6 is an isolated
qualification target; it is not a replacement desktop release. Do not switch
the default launcher or publish its artifacts until the parity gates below pass.

## Implemented foundation

- The existing renderer bridge is constructed by `createDesktopRendererBridge`.
  Electron's preload supplies its transport. UI methods, event validation,
  unsubscribe behavior, and diagnostics gating retain their existing contracts.
- The Electrobun transport uses asynchronous RPC and explicit synchronous
  bootstrap values. Unsupported synchronous operations throw. Renderer disposal
  rejects pending requests and drops listeners; late native failures remain observed.
  This does not cancel native work; host-side cancellation still needs porting.
- The wire envelopes live in `packages/contracts/src/desktopRpc.ts` with no
  dependency on either native framework.
- A pinned Hutch/Electrobun qualification application builds with CEF on each
  configured target. Its identity is separate from Stable, Beta, Remote, and
  development. It starts no Synara backend, reads no application database or
  credentials, and does not configure an updater. Remote debugging is disabled.
- Its real native smoke exercises the existing bridge's window-state request,
  failure propagation for an unported operation, absence of diagnostics, and
  partitioned sandboxed guest readiness/cookie isolation using a loopback HTTP fixture.
  Public API observations in the report are availability checks, not behavioral
  validation of those APIs.

## Run

Install the repository's pinned Bun and dependencies using `bun install
--frozen-lockfile`, and install [Hutch](https://docs.electrobun.dev/electrobun/guides/quick-start/).
The qualification config pins Hutch 0.29.0 and Electrobun 2.0.6. The first build
downloads their native runtime and CEF assets. A graphical desktop session is
required; a headless JavaScript test is not a replacement.

```sh
bun run test:electrobun
bun run test:electrobun --require-parity
```

The first command requires a successful native report and process exit. It
currently fails at partitioned sandboxed CEF guest readiness on macOS ARM64. The
second also requires production parity and intentionally fails until the
migration is complete. Neither command validates a signed release or a live
provider. Run on macOS ARM64/x64, Windows x64, and Linux ARM64/x64 separately.

## Gates before replacing Electron

| Area                    | Remaining work                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser automation      | Replace Electron debugger transport and Betterwright host integration; prove cancellation, target ownership, navigation, screenshots, input, dialogs, upload, and recovery.                                                                                                                                                                             |
| Browser security        | Preserve per-session guarded proxy, permission decisions, navigation/subframe isolation, and restricted resource protocols. Electrobun 2.0.6's public Session API exposes cookies/storage, but no `setProxy` or `setPermissionRequestHandler` equivalent. A process-wide Chromium proxy flag is not equivalent to the existing dedicated session guard. |
| Renderer initialization | Supply authenticated backend endpoint and migration snapshot before app hydration; replace synchronous remote-resource URL generation and OS file-path access; stream binary previews with an explicit wire encoding.                                                                                                                                   |
| Backend                 | Replace use of Electron's executable as Node. Qualify the chosen backend runtime, native dependencies, stdio MCP launches, parent death, restart, and cancellation on every OS.                                                                                                                                                                         |
| Native services         | Port menus, shortcuts, notifications, clipboard, app icons, window material/chrome, keep-awake, permissions, App Snap, audio, and computer helpers without silent stubs.                                                                                                                                                                                |
| State and credentials   | Preserve origins, profiles, application homes, and encrypted secrets. Any migration requires independent data-preservation/replay/recovery review.                                                                                                                                                                                                      |
| Updates and releases    | Implement signed packaging and an existing-install upgrade path; retain Stable/Beta/Remote identities and feed isolation, active-work install guards, and rollback behavior.                                                                                                                                                                            |
| Platform support        | Validate the minimum OS versions, native dependencies, transcript/editor/terminal behavior, and packaged runtime on each supported target.                                                                                                                                                                                                              |

Electrobun's public BrowserView API also does not provide Electron's `debugger`,
`sendInputEvent`, or `capturePage` methods. Their absence does not prove that CEF
cannot implement the behaviors; it means new adapters or native integration are
required. Do not expose a general remote-debugging endpoint to recover this
functionality without preserving the application's authority boundary.

Reference: [BrowserView](https://docs.electrobun.dev/electrobun/apis/browser-view/),
[CEF configuration](https://docs.electrobun.dev/electrobun/apis/bundling-cef/), and
[supported platforms](https://docs.electrobun.dev/electrobun/guides/compatability/).

## Local qualification (2026-11-15)

The macOS ARM64 CEF build completed. A real hidden window loaded the renderer,
returned native window state through the shared bridge, rejected an unported
operation, and closed. The first attempt to quit with a live window reported a
native shutdown timeout; waiting for the native window-close event before quit
removed that timeout in subsequent runs. The command rejects that native error
if it recurs, even when the application reports success and exits with code zero.

The expanded guest-session qualification fails: persistent partitioned sandboxed
CEF guests do not emit the expected readiness event within the probe deadline.
An earlier ephemeral-partition probe loaded its guest but could not read back a
cookie accepted by the Session API. These are unresolved observations, not proof
of their underlying cause. A native-webview control with persistent partitions
passed cookie isolation. The default qualification retains CEF and fails instead
of weakening its assertions or enabling privileged RPC for guest pages.

The production-parity command also fails. Windows, Linux, Intel macOS,
existing-install upgrades, signed artifacts, and live provider sessions have
not been qualified. The probe does not load the complete Synara frontend.

## Verification of the foundation

- Formatting, lint (with existing warnings), workspace typecheck, the native
  qualification target's typecheck, and the Windows process-boundary check passed.
- Existing desktop bundle build passed. Desktop Vitest: 1,638 passed, 6 skipped.
- Scripts Vitest run serially: 394 passed. The new bridge/transport/report tests
  account for 15 focused passing cases.
- The broad repository run encountered seven checkpoint-reactor failures and a
  Git timing assertion failure in unchanged backend files. It was stopped after
  those failures; the backend suite did not finish. No clean full-suite claim is made.
- The broad run also discovered vendored Hutch SDK tests and had two script
  timeouts under load. SDK test discovery was excluded; the desktop suite and
  serial scripts rerun passed afterward.
- The expanded native CEF qualification fails at guest readiness. The fixture
  HTTP server did not receive the guest request in that failing run. The
  application window/RPC checks passed and the native window-close event was observed.

## Local preview external links

`src/preview.ts` and `preview.config.ts` describe the isolated macOS preview
(the qualification entry point remains unchanged). For a scratch Hutch project,
use the preview configuration as `electrobun.config.ts` and point its Bun entry
point at the preview source in this checkout. It expects the isolated web client
at `http://localhost:6733`; start its matching backend separately. Preserve the
preview bundle identity when rebuilding so its profile remains isolated.

OAuth returns its authorization URL asynchronously, after the click gesture.
The preview therefore enables CEF's `disable-popup-blocking` flag and registers
an app-view-specific `new-window-open` handler. The handler reuses the desktop's
HTTP(S) URL validation and opens the system browser through `Utils.openExternal`.
Other schemes and other view IDs are rejected; top-level navigation stays within
the local app origin. Do not reuse this popup policy for untrusted guest browsers.
Authorization URLs are never logged.

Native verification on macOS ARM64 / Electrobun 2.0.6 reproduced the blocked
async popup, then confirmed a request reached a loopback test page in the default
browser after both fixes. This proves browser launching, not a completed Composio
login or tool execution. Other platforms remain unverified.
