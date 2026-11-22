---
title: Agent access (MCP server)
description: Turn Flare's MCP server on or off, decide who can connect AI agents, and review what agents did.
---

# Agent access (MCP server)

The MCP server lets people connect AI agents such as Claude Code, Codex, Cursor, Claude, and ChatGPT to their own Flare accounts, by signing in through the browser or with a token. It is off on every instance, new or upgraded, until someone with `settings.security` turns it on in **Admin → Settings → Access**.

## Turn it on

1. Choose **Admin → Settings**, then the **Access** section, and find the **MCP server** card below **Single sign-on (OIDC)**.
2. Turn on **Enable the MCP server**.
3. Choose **Save settings**. **Settings updated** confirms it.

<Screenshot src="/screenshots/agents/settings-mcp-server.webp" alt="MCP server card in Settings Access with Enable the MCP server switched on above the sentence Agents can connect and act for an account, once its owner signs them in or gives them a token, the Server URL http://localhost:3198/api/mcp beside a Copy URL button, a note that Claude and ChatGPT on the web need a public HTTPS address while local clients work with this address, and a link to the agents guide" caption="The switch and the address agents connect to, on a local demonstration instance. The note under the address appears when it is not a public HTTPS one." />

Under the switch the card says what it opens: **Agents can connect and act for an account, once its owner signs them in or gives them a token. They can do only what that connection and the account's role allow.** The card then shows the **Server URL** that agents connect to, with **Copy URL**, and **Read the agents guide** opens [Connect an agent](/guide/agents) for the version you run. Opening Settings needs `settings.read`; the switch itself needs `settings.security`, the permission that also governs registration and single sign-on, because it opens a new way to reach the instance.

From the next request on:

- **`POST /api/mcp` answers.** Before, it and every transfer URL answered `404`, as if they did not exist.
- **The sign-in endpoints answer.** Two documents under `/.well-known/` tell a client where to sign in, and `/api/oauth/register`, `/api/oauth/authorize`, `/api/oauth/token`, and `/api/oauth/revoke` carry the sign-in, with the consent screen at `/auth/connect`. They also answered `404` before. A client can register itself without an account, within [limits](/api/mcp#register-a-client), but a registration gives access to nothing: only a signed-in person who chooses **Allow** connects an agent.
- **People with `tokens.manage` get an Agents card** in **Profile → Integrations**, with **Connect an agent** and their connected agents, and an **Agent access** box in **New token**.
- **Nothing that already exists gains access.** No existing API token, upload token, or browser session works on the MCP endpoint. An agent can connect only after a person signs it in or creates a token for it.

## What an agent can do

An agent acts as the account that connected it, and three things bound it:

- **The actions that person allowed** when connecting: reading, uploading, organizing, changing sharing, deleting, short links. For an agent that signed in, they can change these afterwards.
- **The account's role, checked on every call.** An agent can never do what its owner's role does not allow, and a role change applies at once.
- **Its owner's own content.** Agents work with that account's files, folders, tags, and short links only.

This release has no tools for administration. An agent connected by an administrator cannot read or change users, roles, invites, instance settings, the audit log, or other accounts' files. No agent can create or read API tokens, upload tokens, or webhooks, connect or change another agent, or change how anyone signs in. The [reference](/api/mcp#what-mcp-covers-of-the-http-api) lists every route and whether a tool covers it.

One risk remains and cannot be removed: an agent reads files, and a file can contain text written to steer the agent that reads it. Flare marks file contents as untrusted data for the agent, which lowers the risk without ending it. What a misled agent can do is limited to what its connection allows, so tell the people on your instance to [grant the least that works](/guide/agents#stay-safe).

## Decide who can connect agents

Signing an agent in and creating a token for one both need **Manage API tokens** (`tokens.manage`). Everyone grants that permission on a new instance, which means every account can connect agents once the switch is on. Without it, the consent screen says **Your role does not allow connecting agents. Ask an administrator if you need this.** and offers only **Cancel**.

To limit it, remove `tokens.manage` from Everyone in [Roles](./roles) and grant it through a role you assign. The same permission covers ordinary API tokens, the account upload token, and the downloads for screenshot tools, so those are limited with it.

Removing `tokens.manage` later stops a person from connecting more agents. It does not disconnect the agents they already have, and it hides the **Agents** card, so they can no longer edit or disconnect those themselves. To stop them:

- **Agents that signed in:** revoke the person's sessions under [Users](./users#revoke-browser-sessions). That signs them out of every browser and disconnects every agent they signed in. They can do the same with **Revoke all sessions** in their profile.
- **Agents with a token:** tokens are not touched by revoking sessions. Remove the permissions the agent uses, such as `files.read`, from the person's role, or give `tokens.manage` back long enough for them to revoke the token.

## See who has connected agents

Connections belong to accounts. Each person sees their own under **Profile → Integrations → Connected agents**, with **Edit permissions** and **Disconnect**. There is no list of every account's agents, and an administrator cannot open another person's list.

What you can see is the [audit log](./audit): every connection made, edited, and ended is an event in the `authentication` category, as [described below](#review-what-agents-did).

Each account can have 50 agents signed in at once, and separately 50 active named tokens.

## The server address

The **Server URL** is the instance's public address, from [`NEXTAUTH_URL`](/hosting/configuration#core-environment-variables), followed by `/api/mcp`. Without `NEXTAUTH_URL`, the card shows the address your browser is using. Links and the upload and download URLs that agents receive are built from the same address, so it has to be reachable from the computers agents run on.

Sign-in depends on this address more than tokens do. Flare tells clients to sign in at `NEXTAUTH_URL` and issues access for that address only, so **clients must connect to exactly the Server URL**. A client that reaches the instance under another name or port is refused sign-in. A reverse proxy in front of Flare must also [pass `/.well-known/` to it](/hosting/reverse-proxy#agent-sign-in).

When the address is not a public HTTPS one, the card adds a note: **Claude and ChatGPT on the web connect from their own servers and need a public HTTPS address. Local clients such as Claude Code, Cursor and VS Code work with this address. Links and upload URLs that Flare gives agents use it, so agents must be able to reach it.** Flare treats an address as public when it uses `https` and its host is not `localhost`, an address in a private or link-local range, a name without a dot, or a name ending in `.local`, `.internal`, `.lan`, or `.home.arpa`. On such an instance **Connect an agent** shows people no steps for Claude or ChatGPT and says why. An instance on a private network works for clients that run on that network.

## Turn it off

Turn **Enable the MCP server** off and choose **Save settings**. From the next request:

- `/api/mcp`, every upload and download URL, the sign-in endpoints, and the consent screen answer `404`.
- The **Agents** card and the **Agent access** box disappear from Profile.
- Creating a token with Agent access is refused: `The MCP server is turned off on this instance, so tokens cannot have Agent access.`

Nothing is deleted. Tokens are kept as they are, and so are the connections of agents that signed in. Turning the server on again lets the same tokens connect again, so turning it off is a pause, not a cleanup. An agent that signed in cannot renew its access while the server is off; when it is back on within 90 days the agent can carry on, though a client that gave up in the meantime asks its owner to sign in again. While the server is off, a token made for an agent still works on the [REST API](/api/authentication#scope-reference) for the scopes that work there, such as uploading and listing files. To end a connection for good, its owner disconnects the agent or revokes the token.

## Review what agents did

Every tool call an agent makes is recorded in the [audit log](./audit). Set **Category** to `mcp` to see them; the category is offered once the first call has been recorded:

- **Action** is `mcp.` and the tool, such as `mcp.read_file`, `mcp.set_file_sharing`, or `mcp.delete_files`.
- **Outcome** is `success`, `denied` when the connection or the role did not allow the call, or `failure`.
- The actor is the account. The event's details carry the ID of the token used, or `connection:` and the connection's ID for an agent that signed in, never a secret. The target is the file, folder, tag, or short link.
- Downloads and uploads through the temporary URLs agents receive appear as `mcp.transfer.download` and `mcp.transfer.upload`.

The changes themselves also appear as the usual events, such as `file.create`, in their own categories. The [reference](/api/mcp#audit) has the details.

<Screenshot src="/screenshots/agents/audit-mcp.webp" alt="Audit log filtered to the mcp category: a denied MCP delete files call, then successful set file sharing, search files, tag files, move files and transfer upload events by Alex, with invoice-2026-10.pdf, 2 files and team-offsite.png as targets" caption="Two agents at work on demonstration files. The read-only one was refused when it tried to delete." />

Connecting is recorded in the `authentication` category, beside the sign-ins of people. Set **Category** to `authentication` and choose an **Action**, or search for `agent_connection` or `oauth`:

| Action                        | What happened                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_connection.create`     | A person allowed an agent, and it connected. The event names the account, the name the client gave itself, and the scopes granted.                                                                                                   |
| `agent_connection.updateMany` | A connection was edited or ended. The details show the scopes before and after, and for an ending its `revokedReason`: `disconnected` by its owner, `revoked` by the client, or `replay` or `code-reuse` when Flare ended it itself. |
| `agent_connection.revokeAll`  | Every agent an account had signed in was disconnected because the account was signed out everywhere. The details give the count.                                                                                                     |
| `oauth.token` with `denied`   | An old sign-in credential of an agent was used again, and Flare ended that connection. This can mean a copy of the credential was taken, so it is worth asking the account's owner about.                                            |
| `oauth.register`              | A client registered itself. Anyone can, so these alone mean little; a burst of refused ones from one address is the registration limit at work.                                                                                      |
| `oauth.authorize`             | A browser started a sign-in, a request was refused, or a person answered the consent screen.                                                                                                                                         |

An agent renewing its access, which a busy one does about once an hour, is not recorded.

## For operators

No environment variable turns the server on, and it runs inside Flare: there is no extra process or port. The upgrade adds five database tables. [Configuration](/hosting/configuration#mcp-server) covers the public address, reverse proxies and their logs, and browser-based clients; [reverse proxy](/hosting/reverse-proxy#agent-sign-in) covers what sign-in needs from a proxy; the [upgrade note](/hosting/maintenance#mcp-server) covers the migrations and rollback.
