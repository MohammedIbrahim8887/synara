# Local Sona connections

Sona no longer exposes the hosted Synara account, sign-in dialogs, billing or subscription controls. The server refuses hosted account RPCs and does not start hosted account reporting, profile synchronization, remote billing policy or cloud connection orchestration. Existing account files and workspaces are preserved; provider logins are unaffected.

**Settings → Connections** enables an authenticated HTTPS listener on the computer's private IPv4 network. Create a single-use five-minute QR invitation and scan it in the [Expo Android companion](../apps/mobile/README.md). Pairing management is restricted to a local owner session. A paired owner can use the workspace, but cannot mint invitations. Device sessions use the existing durable authentication and revocation implementation; no database migration is required.

The listener is off by default and stops when Sona closes. Its TLS identity and port are stable on the same installation. After changing network addresses, turn the listener off and on, then scan a fresh QR code. Firewall configuration, Wi-Fi client isolation and a sleeping computer can prevent access; the Android retry/rescan controls do not bypass those restrictions. This mode does not require or contact a hosted account service.

Sidebar usage settings accept any number of available provider accounts. Saved selections are deduplicated, unavailable accounts are ignored, and the rail scrolls when the selection exceeds the available space.

For historical hosted-service behavior, the legacy code remains dormant behind `SONA_CLOUD_ACCOUNT_ENABLED = false`. Do not re-enable that flag as part of adding local connection features.

The QR tile stays square at narrow widths, with its doughnut mark centred inside the code. Settings remains available in the sidebar independently of account controls.

## Desktop attention and Dynamic Island

The Electrobun app forwards completion and attention-needed events to native desktop notifications with sound, respecting the existing Notifications settings and foreground suppression. **Settings → Notifications → Test notification** exercises the native path. macOS notification permissions, sound preferences and Focus mode still apply.

**Dynamic Island** in the desktop sidebar opens an always-on-top panel at the primary screen's top work area. Expand its running-session counter to see active work and pending questions; selecting a session opens the existing chat surface, including prompts and provider-specific approval/question controls. Collapse it to the counter or close the panel without stopping sessions. This is a Mac desktop companion, not an iOS Live Activity or Android overlay.

The companion uses a per-launch capability token on a loopback-only endpoint, validates the app origin and limits request bodies and notification frequency. Both webviews retain Electrobun's RPC sandbox. The panel closes with the main app. OS notification submission does not guarantee delivery when system permissions or Focus suppress it.
