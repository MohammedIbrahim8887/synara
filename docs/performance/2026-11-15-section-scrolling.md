# Section scrolling

The onboarding apps/tools list was doing avoidable work during scrolling:

- Connector row color transitions restarted as rows moved under the pointer,
  repainting the scrolling layer repeatedly. Hover colors now update immediately;
  keyboard focus and row actions are unchanged.
- The empty-chat ASCII canvas remained active beneath the modal. CSS visibility
  alone does not detect Base UI's `data-base-ui-inert` ancestors. The existing
  canvas lifecycle now checks native and Base UI inert ancestors before drawing
  or allocating surfaces, and defers pending resizes until the owner is active.
  The existing visibility retry resumes rendering after dismissal.

A separate development-preview cost remained after those fixes: server-config query
notifications synchronously rerendered the large chat/sidebar tree beneath the modal.
A CPU profile attributed the work to React's development JSX rendering. This preview
had the React compiler disabled (the repository's default for faster cold development
startup). The existing `SYNARA_DEV_REACT_COMPILER=1` option is now enabled in the local
preview runner. Production builds and browser tests already use the compiler. No query,
provider refresh, session consumer or global build default was changed.

The pixelated onboarding image and section layout are unchanged. No transcript
scrolling or follow behavior was changed.

## Measurement

Chrome on macOS, local Vite preview, 1440 × 960 viewport at device scale 2,
apps/tools onboarding step. After a 1.5-second settle and 700-ms idle sample,
60 wheel inputs of ±110 pixels were sent at 20-ms intervals, reversing direction
in groups of 15. CDP tracing covered the wheel sequence. These are individual
local samples, not a native Electrobun benchmark or a guaranteed frame rate.

| Metric                                              |  Before |   After |
| --------------------------------------------------- | ------: | ------: |
| Paint events                                        |     158 |      72 |
| Total paint time                                    | 56.2 ms | 30.3 ms |
| Main-thread task time                               |  347 ms |  240 ms |
| Worst frame interval, separate 6× CPU-throttled run |  500 ms | 33.5 ms |

The environment's idle frame interval was approximately 33.3 ms both before and
after the fix; p95 stayed approximately 33.4 ms. The result is less rendering work
during scrolling, not a claimed FPS gain.

The agents section also passed the 6× CPU-throttled wheel probe at a shorter
1440 × 640 viewport (where its content overflows): maximum frame interval 33.5 ms,
52 ms of main-thread work and no tasks exceeding 30 ms.

## Regression coverage

`AsciiWaveBackground.browser.tsx` exercises covered startup, native inert and
Base UI inert owners, wheel input while covered, resumption, invisible retained
owners, unmount cleanup, reduced motion, Retina allocation and resize rendering.
The three new cases failed before the fix: covered startup alone issued 5,465
`drawImage` calls. They pass after the fix with zero drawing calls while covered.
`McpConnectorsSettingsPanel.browser.tsx` covers the existing connector actions.

Run with the repository's installed Playwright browser:

```sh
bun run --cwd apps/web test:browser src/components/chat/AsciiWaveBackground.browser.tsx src/components/settings/McpConnectorsSettingsPanel.browser.tsx
```

For the local verification, a temporary Vitest config selected installed Google
Chrome because the pinned Playwright browser was unavailable. The running native
preview was left open; native frame timing and other platforms remain unverified.
