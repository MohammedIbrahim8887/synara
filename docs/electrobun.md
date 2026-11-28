# Electrobun migration status

Sona 0.1.3 ships as a standalone Electrobun 2.0.6 app on Apple Silicon Macs.
The upstream Synara desktop uses Electron. Electrobun's isolated qualification
target tracks native parity for the upstream launcher and publication workflow.

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

## Standalone Sona installer (Apple Silicon Mac)

With Node 24, the pinned Bun, Hutch, `zstd`, `pkg-config`, and the Xcode command line tools
available on `PATH`, run:

```sh
bun run dist:desktop
```

This builds the production web client and backend, stages the installed production
dependency graph (including the repository's patches), bundles Node and CEF, and
creates `release/sona/Sona-0.1.3-macos-arm64.dmg`, its SHA-256 checksum, and a
standalone `Sona.app`. Open the DMG, drag Sona to Applications, then open Sona.
No checkout, separately installed Node,
or development server is required. Provider CLIs, accounts, and external tools
still have their usual requirements.

Sona's browser pane and the agent's browser tools share a headless instance of
Chrome, Chromium, Edge, or Brave installed on the Mac. Sona launches it with a
dedicated profile under its data directory. To select a different installation,
set `SONA_BROWSER_EXECUTABLE` to the browser executable before launching Sona.

The bundle uses `dev.sona.desktop` in Electrobun's stable channel and reuses
the installed Sona preview's backend data in `~/.sona`. Quit the preview before
opening Sona 0.1.3. macOS may prompt again for microphone access under the new
bundle identity. A stored loopback port
keeps browser preferences stable across launches; a concurrent instance is refused.
The backend uses its existing stdin parent-lifetime lease and the renderer uses
the existing authenticated pairing bootstrap. Set `SONA_HOME` in the app's
environment to a short path such as one created by `mktemp -d /tmp/sona-smoke.XXXXXX`
for local smoke tests. The browser host uses a Unix socket under that directory.

### Video previews

The bundled CEF has no H.264 or HEVC decoder. When the file preview player
reports an unsupported source, it requests the same file with `playable=webm`,
and the backend converts it to VP9/Opus WebM with the bundled ffmpeg. Converted
copies are cached in `<state dir>/video-previews` (2 GiB limit, least recently
served first) and keyed by real path, size, and modification time.

`scripts/lib/build-sona-ffmpeg.ts` builds that ffmpeg from checksum-pinned
FFmpeg and libvpx sources into `~/.cache/sona-ffmpeg` on first use. The build is
LGPL (no `--enable-gpl`, no x264), links only macOS system libraries, and enables
only the demuxers, decoders, and encoders conversion needs. The installer copies
it with its license files and source pins to `runtime/ffmpeg`, and the backend
receives its path as `SONA_FFMPEG_PATH`. Development servers use `ffmpeg` from `PATH`.

### Updates and release assets

Install 0.1.2 from the DMG once to enable in-app updates. In an installed copy,
choose **Sona → Check for Updates…** to check for a newer stable build.
Approve the download, then choose **Install and Restart** when it is ready.
Keep Sona in a writable Applications folder for the updater to replace the bundle.

The installer build also outputs `stable-macos-arm64-update-v2.json` and the
versioned `stable-macos-arm64-Sona-<version>.app.tar.zst`. The manifest records
the size and SHA-256 of the uncompressed tar containing the same app as the DMG.
For each release, update the version in `scripts/build-sona-installer.ts` and
attach the DMG, its checksum, the update archive, and the manifest to the same
GitHub release. Publish it as Latest after all four assets are uploaded and
verified. Installed Sona versions use that repository's Latest download URLs.

This local build uses ad-hoc signing and has no Apple notarization. Windows, Intel Mac,
and Linux installers are not produced by this command. Native Electron-only
services listed above remain unported. Packaging uses a regular application
bundle. After Hutch builds the stable shell, the installer extracts the inner
app and adds the runtime with its dependency symlinks intact before creating the DMG.

Native verification on macOS ARM64 / Electrobun 2.0.6 reproduced the blocked
async popup, then confirmed a request reached a loopback test page in the default
browser after both fixes. This proves browser launching, not a completed connector
login or tool execution. Other platforms remain unverified.

## Standalone preview verification (2026-11-16)

- Formatting, lint (existing warnings), workspace/native typechecks, and the
  Windows process-boundary check passed. This does not qualify Windows packaging.
- Web suite: 6,184 passed, 3 skipped. Scripts suite: 396 passed. Focused reruns
  passed for backend lifetime/external links (10), dependency staging (2), shared
  feature policy (21), server gates/errors (12), and retained coordinator restart (1).
- A copy outside the checkout started its bundled backend and authenticated CEF
  client without development servers. Native close triggered backend shutdown.
  A browser smoke against that bundled backend passed onboarding and redirects
  for `/inbox`, `/hubs`, `/spaces`, `/tasks`, and `/kanban`.
- The broad backend run encountered a recovery-snapshot test failure and did not
  finish before interruption. Full backend-suite success is not claimed. Live
  provider turns, completed connector OAuth, and tool execution remain unverified.
