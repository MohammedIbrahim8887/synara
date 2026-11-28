# Local Sona connections

Sona no longer exposes the hosted Synara account, sign-in dialogs, billing or subscription controls. The server refuses hosted account RPCs and does not start hosted account reporting, profile synchronization, remote billing policy or cloud connection orchestration. Existing account files and workspaces are preserved; provider logins are unaffected.

**Settings → Connections** enables an authenticated HTTPS listener on the computer's private IPv4 network. Create a single-use five-minute QR invitation and scan it in the [Expo Android companion](../apps/mobile/README.md). Pairing management is restricted to a local owner session. A paired owner can use the workspace, but cannot mint invitations. Device sessions use the existing durable authentication and revocation implementation; no database migration is required.

The listener is off by default and stops when Sona closes. Its TLS identity and port are stable on the same installation. After changing network addresses, turn the listener off and on, then scan a fresh QR code. Firewall configuration, Wi-Fi client isolation and a sleeping computer can prevent access; the Android retry/rescan controls do not bypass those restrictions. This mode does not require or contact a hosted account service.

Sidebar usage settings accept any number of available provider accounts. Saved selections are deduplicated, unavailable accounts are ignored, and the rail scrolls when the selection exceeds the available space.

For historical hosted-service behavior, the legacy code remains dormant behind `SONA_CLOUD_ACCOUNT_ENABLED = false`. Do not re-enable that flag as part of adding local connection features.

The QR tile stays square at narrow widths, with its doughnut mark centred inside the code. Settings remains available in the sidebar independently of account controls.

## Desktop notifications

The Electrobun app forwards completion and attention-needed events to native desktop notifications with sound, respecting the existing Notifications settings and foreground suppression. **Settings → Notifications → Test notification** exercises the native path. macOS notification permissions, sound preferences and Focus mode still apply.

Dynamic Island has been removed; active sessions and questions remain available in the main app.

The companion uses a per-launch capability token on a loopback-only endpoint, validates the app origin and limits request bodies and notification frequency. The main webview retains Electrobun's RPC sandbox. The companion endpoint stops with the main app. OS notification submission does not guarantee delivery when system permissions or Focus suppress it.

## Text editing in the desktop preview

The macOS preview registers native **Edit** menu actions for undo, redo, cut, copy,
paste, and select all. CEF text fields use these responder-chain actions for
Command-key shortcuts; keep the menu registered in both preview entry points.
The fix requires a rebuilt app, not just refreshed web assets.

## Rules and workflows

Open **Automations → Rules & workflows**. The overview explains each concept and
offers starter templates. Rules have **Write** and **Draw** views: written rules and
diagram steps are both included when the rule runs. Workflows use the diagram.
Pick steps from the palette, connect their handles, and edit the selected step in
the side panel. Choose a project scope, then **Save**. **Edit as JSON** in the menu
edits the same host-owned definition. Definitions start disabled; importing JSON also disables the imported
definition until the owner explicitly enables it. Invalid connections, recursion,
and oversized graphs are rejected. Saving checks that another client has not changed
the library; on a conflict, preserve your JSON, discard local changes, and reload.

Enabled **rules** accompany every matching turn, including automation turns.
**Require worktree** and **Require branch prefix** are server admission checks against
the actual Git checkout before dispatch. A failing check prevents that turn from being
sent to the provider. These checks do not sandbox shell commands or prevent an agent
from changing branches during an admitted turn.

**Instruction** steps describe commands, reviews, PR targets, or custom conventions.
They remain agent-followed instructions, not verified completion gates. Connected steps
are ordered before their dependents; independent steps run in a stable sequence.
**Run a workflow** expands another enabled workflow within the same project scope.
An unavailable dependency fails the turn rather than silently skipping it.

**Tool** steps select a connected service and describe its task. Connect services
first in **Settings → Connectors**; a diagram does not grant access to a service.
**AI model** steps ask the agent to delegate through the existing thread tools and
wait for the result. If those tools are unavailable, the agent is instructed to do
the step itself and disclose that fallback. **Decision** steps carry yes/no branches;
branch selection is agent-followed, not a separate server execution engine.

Automations also have a **Tools** picker in creation and editing. Link multiple
connected services, such as GitHub and ClickUp, then describe how the run should use
them in the prompt. These links persist with the automation through an additive
nullable database column (migration 145). Missing services remain visible so they
can be unlinked; a saved link does not establish a connection or expand permissions.

Start a chat message or automation prompt with `/workflow <id>` to invoke a saved
workflow. The editor provides the command and **Run in chat** prepares an unsent draft
using the existing project/provider defaults. Workflows run within the existing provider
turn, with its normal approvals, cancellation, transcript, and automation reporting;
there is no separate durable per-node execution or automatic per-node retry engine.

**Draft with AI** turns a text description into an unsent authoring request.
Review the returned JSON, paste it into **Edit as JSON**, and enable it when ready. Generated
or repository-provided content cannot activate itself. Code-based definitions use the
`FlowDefinition` schema in `packages/contracts/src/flows.ts`; import that JSON through
the editor. Libraries are saved in the server settings file in the current app's data
home, independently for each host/channel; no database migration is needed.

The Sona production installer includes `NSMicrophoneUsageDescription` before signing.
Microphone recording still requires both the native CEF permission prompt and macOS
permission for **Sona**. Updating the source does not repair a previously built app:
rebuild the installer with `bun run dist:desktop`. Do not reset Synara's or Sona's privacy database to
work around a denied grant.
