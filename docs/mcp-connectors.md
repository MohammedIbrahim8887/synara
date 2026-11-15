# Connectors

Connectors let agents in Synara use remote MCP servers such as Supabase, Linear, or Notion,
loopback HTTP servers, and local stdio commands. Add them in **Settings → Connectors** or ask
in a chat; new chats receive their tools after approval and any required sign-in.
Connectors are available in Stable and Beta builds from current source, including RPCs, OAuth
callbacks and proxy routes. Each app reads only its own saved connectors; credentials are not
copied from Beta into Stable. Published builds gain these additions only after updating.

One sign-in covers every provider account configured in Synara on this machine, such as all
Claude accounts, Codex, and OpenCode, because the tokens live in Synara's own store rather than
in any provider's configuration. This is separate from Claude Code's own claude.ai connectors and
per-account MCP configuration, which stay per account. Each machine signs in separately, because
the store belongs to one Synara home.

This is the opposite direction of [External MCP](./external-mcp.md), which lets outside agents
call into Synara.

## How it works

| Step     | What happens                                                                                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect  | The server sends an unauthenticated MCP `initialize` to the connector URL. A valid JSON-RPC initialize result means no sign-in is needed. Existing OAuth connections retain their credentials if initialization is public. A 401 starts OAuth.                                                           |
| Sign-in  | The MCP SDK's OAuth client discovers the protected-resource and authorization-server metadata, registers Synara with Dynamic Client Registration, and builds a PKCE (S256) authorization URL with a single-use `state` and the RFC 8707 `resource`. The web app opens it in the default browser.         |
| Callback | The browser returns to `GET /oauth/mcp/callback` on Synara's loopback port. The `state` is the only authority (the browser carries no Synara session); it expires after ten minutes. The code is exchanged for tokens.                                                                                   |
| Storage  | All connectors and their tokens are one entry (`mcp-connectors`) in the server secret store: a `0600` file under the Synara home. Tokens never reach the web app or provider processes.                                                                                                                  |
| Sessions | Connected connectors are published to the agent gateway. Each new provider session gets one MCP server per connector, named `<slug>_connector`, pointing at `/mcp/connectors/<id>` on the gateway and authenticated with the session's gateway bearer.                                                   |
| Calls    | The proxy checks the bearer, attaches the connector's access token, and forwards the exchange through the origin-pinned outbound client. SSE answers are collapsed to their JSON-RPC response. A 401 triggers one refresh and one retry; a rejected refresh grant marks the connector **needs sign-in**. |

The `_connector` suffix reduces accidental overlap with user-configured MCP servers. Codex
deep-merges same-named tables, so Synara reads its effective configuration and omits a connector
whose name is already present rather than altering the user's server. If that configuration
cannot be checked, connectors are omitted for that session. Names never start with `synara`,
which tool policy treats as trusted.

## Provider coverage

| Provider                      | Connectors                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Claude                        | Yes, as SDK `mcpServers` HTTP entries                                                    |
| Codex                         | Yes, in the per-thread config only (re-sent on every credential renewal)                 |
| OpenCode                      | Yes, through `mcp.add` on the managed server; a connector that fails to start is skipped |
| Cursor, Grok, Droid, Oh My Pi | HTTP when advertised by the agent, otherwise Synara's session-aware stdio proxy          |
| Pi, Devin, Antigravity        | No                                                                                       |

Running sessions keep the connector set they started with. A disconnected connector answers its
remaining calls with a JSON-RPC error.

Third-party tool calls follow each provider's normal approval flow. Codex still cancels MCP
elicitation requests other than tool approvals.

## Catalog

The presets live in `packages/shared/src/mcpConnectors.ts`. Each one was checked against the live
server: it either answers anonymously (Hugging Face) or accepts dynamic registration from an
unknown client. Vercel documents that it admits only clients it has reviewed, yet a full sign-in
from Synara succeeded on 2026-10-14; its consent page names Synara "An MCP client" until Vercel
approves it through its [client review form](https://forms.gle/FQ3nYPbovoHvbfmz9). Todoist
(`ai.todoist.net/mcp`) accepted a test registration from Synara on 2026-10-14. Slack registers no
clients, so its preset asks for the user's own Slack app (client ID and secret) and shows the
redirect URL to paste into it. Vendors that refuse registration (Figma) or require a
pre-registered OAuth app (GitHub, Asana, HubSpot) are left out; their custom URLs fail with an
explanation instead.

Each preset sits on one shelf (`category`: Popular, Developer tools, or Productivity), which is
how Settings → Connectors groups the catalog under its search field.

Convex's hosted server (`mcp.convex.dev`) only guides setup and scaling; its deployment tools run
in the local `npx convex mcp start` server, which can be added as a stdio connector. WorkOS has no Simple
Icons mark, so its icon is the site favicon.

Custom URLs must be public `https://` endpoints without credentials, or `http://` on
`localhost`, `127.0.0.0/8`, or `[::1]`. The outbound client pins loopback DNS resolutions
and refuses redirects out of the selected origin. Public plain HTTP remains rejected.

## Add from chat and import

- `synara_list_mcp_connectors` lists transport, status, supported providers and URL origin
  or command. URL paths/queries are omitted because they can contain credentials.
- `synara_add_mcp_connector` accepts a preset, a named URL, or a named command with an
  argument array and optional `cwd`/`env`. It saves an inert proposal and shows a card.
- `synara_remove_mcp_connector` also creates a proposal. Removal needs UI confirmation.
- `synara_import_mcp_servers` discovers Claude Code user/current-project entries in
  `~/.claude.json`, `~/.codex/config.toml`, the workspace `.mcp.json`, and Claude Desktop's
  platform config. Each candidate gets a card; only the entries the user accepts are added.
  Disabled entries are skipped. Custom HTTP headers, environment-backed HTTP credentials,
  and unsupported configurations are reported as skipped, without exposing their values.
  Environment values are imported literally; provider-specific variable interpolation is not applied.

Only the owning computer's authenticated UI can resolve a proposal. MCP tools cannot approve
one, even in full-access sessions. Choose **Review connection** to see the exact expanded
command, argument array, working directory and environment keys before **Approve connector**
becomes available; values stay hidden. Pending proposals and connector
environment values are stored only in the existing secret-store document. Approval of an HTTP
connector opens its OAuth authorization URL in the browser if sign-in is required.

Saved connectors show their app icon when recognized (including Paper's official app artwork),
name and connection status. A **Custom** badge identifies connectors outside the built-in catalog.
**Connection details** expands the configuration and supported providers without putting command
paths on the main card. Remote custom servers retain the existing site-favicon fallback.

## Local servers

Use **Add local server** for a URL such as `http://127.0.0.1:29979/mcp`, or command
`~/.paper/bin/paper` with arguments `["mcp"]`. `~` expands in the command, arguments and
working directory; commands are not interpreted as shell strings. Relative working directories
are resolved against the proposing chat's workspace, or the home directory in Settings.

An unavailable local connector stays saved as **Not running** and is omitted from new provider
sessions. HTTP health is checked in the background; unavailable stdio servers are retried.
Stdio commands run through the shared platform process boundary, with separate MCP sessions
per provider bearer, bounded initialization, cancellation and owned process-tree cleanup.
Ambient Synara credentials and provider API keys are stripped; explicitly configured environment
values reach only the local MCP subprocess. Removal closes its processes before reporting success.

Running chats keep their current connector set: newly added connectors are **available in new
threads**. Gateway forwarding supports request/response MCP calls; server-initiated sampling,
elicitation and standalone notification streams are not supported. Session revocation is swept
in the background, while explicit disconnect and stdio-client shutdown close sessions directly.

## Paired devices

Synara Remote 1.0.6-remote.12 and later let authenticated paired clients read the
connector list for the computer running their chat. iPhone and iPad build 0.1
(136) and later use it for @ suggestions, filtered to connected services and
supported providers. Older desktop hosts can return an empty list.

Connections belong to that computer’s app data home. A service connected on the
Mini is not automatically connected on the MacBook or in another Synara flavor.
Connect it in Settings → Connectors on the execution computer, then start a new
chat so the provider receives its tools.

The paired view includes names, status and URL origins only; URL credentials,
paths and queries are removed; stdio entries are withheld. OAuth setup, proposals, connecting and disconnecting remain
local-owner operations. No connector token is transferred to the phone.

## Vercel sign-in renewal

Vercel requires the OAuth `offline_access` scope to issue a refresh token.
Synara includes it when connecting to `https://mcp.vercel.com`, preserving the
scopes the server requested. The grant stays on the execution computer and uses
the existing refresh path after token expiry or a desktop restart. Other
connectors keep their existing scope selection.

Older Vercel grants with only `openid` have no refresh token and need one new
sign-in after this fix is installed. The user chooses project access in Vercel’s
consent page; Synara does not silently expand that project selection. A source
fix is not an upgrade to an already-issued grant.

See [Vercel’s scope reference](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions).

## Limits

- Connecting needs a loopback-only instance, because the OAuth redirect targets this machine's
  loopback port. The desktop picks a new port per launch, so every sign-in registers a fresh
  client.
- A user's own OAuth app (Slack) accepts only the redirect URL registered with it, and that URL
  carries the current port. After the desktop restarts, reconnecting fails until the app's
  redirect URL is updated to the one the connect dialog shows.
- The MCP 2026-07-28 revision prefers Client ID Metadata Documents over Dynamic Client
  Registration. Supporting it needs a hosted client metadata document on a Synara domain.
- Disconnecting invalidates pending sign-ins, deletes the tokens locally and attempts RFC 7009 revocation when the server
  advertises a revocation endpoint.

## Composio discovery and app connections

Composio is available in Settings → Connectors and in onboarding step 3, after
agent setup. The onboarding catalog reuses the Settings connector panel, consent
dialog, connection status, error handling, and disconnect behavior. Setup is optional.

Sona connects to the official `https://connect.composio.dev/mcp` endpoint using
OAuth with PKCE. No Composio project API key is needed for this route. Tokens stay
in the existing server secret store; `offline_access` requests a renewable grant.
The live endpoint, metadata, dynamic registration and PKCE authorization URL were
verified through Sona’s connector runtime on 2026-11-15. An authenticated
account and actual app execution still require the user's sign-in and verification.

Composio supplies discovery, schema lookup, account management and execution tools
through that connection. Agents can search its catalog for a task, obtain the
matching schemas, request an app connection, and use the connected app's context.
The catalog is resolved by Composio at runtime rather than copied into Sona.
Choose **Connect apps** in the discovery panel to sign in. For example,
ask a new chat to discover Gmail tools and help connect
your account. Follow the returned authorization link, then ask it to verify the
connection before fetching any context.

Access depends on the apps Composio supports, your account permissions and your
provider's connector support (see the coverage table above). Connecting Composio
does not automatically authorize every upstream app. New connectors apply to new
chats. Existing chats retain their original connector set. The remote workbench
and execution tools run at Composio; ordinary provider tool approval still applies.
MCP server-initiated elicitation is not supported by Sona's proxy; if a Composio
policy requires that interaction, treat the action as unsupported rather than
silently bypassing its approval requirement.

Disconnecting the Sona connector stops Sona forwarding to it. To revoke an upstream
app's OAuth grant, manage the connection in Composio or at the app itself.

Reference: [Composio Connect](https://docs.composio.dev/docs/composio-connect).

### Search Composio tools in Sona

The connector panel includes **Find apps and tools**, separate from the built-in
connector filter. It appears in Settings and onboarding step 3. Developer shortcuts
include GitHub, GitLab, Bitbucket, Linear, Sentry, Vercel, Cloudflare and Supabase.
These are discovery queries, not claims that an app account is already connected.

After connecting Composio, submit an app name or task to search across its catalog.
Results show tool names, slugs and descriptions; copy a tool name into a new chat
and ask the agent to connect the relevant app and use it. Search returns relevant
matches, not an exhaustive dump of every tool. Availability follows Composio's
catalog and your access. An empty result or error is shown explicitly.

The local-owner `server.searchComposioTools` RPC only accepts a saved connector ID
and search text. It requires the exact official Composio endpoint, initializes an
isolated MCP session, calls only `COMPOSIO_SEARCH_TOOLS`, and closes that session.
It does not expose arbitrary tool execution, custom URLs, credentials, or app
connection mutations. Searches are bounded to 30 seconds and 100 displayed tools.
Remote paired clients cannot call this local-owner operation. Returned strings
are rendered as text, never interpreted as HTML or instructions.

Authenticated search response fixtures cover discovery, protocol session handling,
failure cleanup, and disallowed endpoints. Real account search still needs a
Composio sign-in; mocked results are not proof of live tool availability.

The main search is labeled by its purpose, with Composio identified as the search
provider in the setup helper. The **Direct connections** section contains the
services’ own MCP endpoints and explains that these bypass Composio. Composio’s
setup is offered through **Connect apps** above instead of duplicated in that
section. Saved connections remain visible together above the direct catalog.
