---
title: Agent access (MCP server)
description: Turn Flare's MCP server on or off, decide who can connect AI agents, and review what agents did.
---

# Agent access (MCP server)

The MCP server lets people connect AI agents such as Claude Code, Codex, and Cursor to their own Flare accounts. It is off on every instance, new or upgraded, until someone with `settings.security` turns it on in **Admin → Settings → Access**.

## Turn it on

1. Choose **Admin → Settings**, then the **Access** section, and find the **MCP server** card below **Single sign-on (OIDC)**.
2. Turn on **Enable the MCP server**.
3. Choose **Save settings**. **Settings updated** confirms it.

<Screenshot src="/screenshots/agents/settings-mcp-server.webp" alt="MCP server card in Settings Access with Enable the MCP server switched on, the Server URL http://localhost:3197/api/mcp beside a Copy URL button, a note that local clients work with this address, and a link to the agents guide" caption="The switch and the address agents connect to, on a local demonstration instance. The note under the address appears when it is not a public HTTPS one." />

The card then shows the **Server URL** that agents connect to, with **Copy URL**, and **Read the agents guide** opens [Connect an agent](/guide/agents) for the version you run. Opening Settings needs `settings.read`; the switch itself needs `settings.security`, the permission that also governs registration and single sign-on, because it opens a new way to reach the instance.

From the next request on:

- **`POST /api/mcp` answers.** Before, it and every transfer URL answered `404`, as if they did not exist.
- **People with `tokens.manage` get an Agents card** in **Profile → Integrations**, with **Connect an agent**, and an **Agent access** box in **New token**.
- **Nothing that already exists gains access.** No existing API token, upload token, or browser session works on the MCP endpoint. An agent can connect only with a token a person creates for it afterwards.

## What an agent can do

An agent acts as the account that connected it, and three things bound it:

- **The actions that person allowed** when connecting: reading, uploading, organizing, changing sharing, deleting, short links.
- **The account's role, checked on every call.** An agent can never do what its owner's role does not allow, and a role change applies at once.
- **Its owner's own content.** Agents work with that account's files, folders, tags, and short links only.

This release has no tools for administration. An agent connected by an administrator cannot read or change users, roles, invites, instance settings, the audit log, or other accounts' files. No agent can create or read API tokens, upload tokens, or webhooks, or change how anyone signs in. The [reference](/api/mcp#what-mcp-covers-of-the-http-api) lists every route and whether a tool covers it.

One risk remains and cannot be removed: an agent reads files, and a file can contain text written to steer the agent that reads it. Flare marks file contents as untrusted data for the agent, which lowers the risk without ending it. What a misled agent can do is limited to what its connection allows, so tell the people on your instance to [grant the least that works](/guide/agents#stay-safe).

## Decide who can connect agents

Connecting an agent creates an API token, so it needs **Manage API tokens** (`tokens.manage`). Everyone grants that permission on a new instance, which means every account can connect agents once the switch is on.

To limit it, remove `tokens.manage` from Everyone in [Roles](./roles) and grant it through a role you assign. The same permission covers ordinary API tokens, the account upload token, and the downloads for screenshot tools, so those are limited with it.

Removing `tokens.manage` later stops a person from connecting more agents. It does not disconnect the agents they already have. To stop those, the person revokes the tokens in **Profile → Integrations**, or you remove the permissions the agent uses, such as `files.read`, from their role.

## The server address

The **Server URL** is the instance's public address, from [`NEXTAUTH_URL`](/hosting/configuration#core-environment-variables), followed by `/api/mcp`. Without `NEXTAUTH_URL`, the card shows the address your browser is using. Links and the upload and download URLs that agents receive are built from the same address, so it has to be reachable from the computers agents run on.

When the address is not a public HTTPS one, the card adds a note: local clients such as Claude Code, Cursor, and VS Code work with this address, and agents must be able to reach it. In this release the hosted Claude and ChatGPT apps cannot connect to any instance, because they sign in through the browser and Flare does not offer that yet. An instance on a private network works for clients that run on that network.

## Turn it off

Turn **Enable the MCP server** off and choose **Save settings**. From the next request:

- `/api/mcp` and every upload and download URL answer `404`.
- The **Agents** card and the **Agent access** box disappear from Profile.
- Creating a token with Agent access is refused: `The MCP server is turned off on this instance, so tokens cannot have Agent access.`

Tokens are kept as they are. Turning the server on again lets the same tokens connect again, so turning it off is a pause, not a cleanup. While it is off, a token made for an agent still works on the [REST API](/api/authentication#scope-reference) for the scopes that work there, such as uploading and listing files. To end a connection for good, its owner revokes the token.

## Review what agents did

Every tool call an agent makes is recorded in the [audit log](./audit). Set **Category** to `mcp` to see them; the category is offered once the first call has been recorded:

- **Action** is `mcp.` and the tool, such as `mcp.read_file`, `mcp.set_file_sharing`, or `mcp.delete_files`.
- **Outcome** is `success`, `denied` when the token or the role did not allow the call, or `failure`.
- The actor is the account, and the event's details carry the ID of the token used, never its secret. The target is the file, folder, tag, or short link.
- Downloads and uploads through the temporary URLs agents receive appear as `mcp.transfer.download` and `mcp.transfer.upload`.

The changes themselves also appear as the usual events, such as `file.create`, in their own categories. The [reference](/api/mcp#audit) has the details.

<Screenshot src="/screenshots/agents/audit-mcp.webp" alt="Audit log filtered to the mcp category: a denied MCP delete files call, then successful set file sharing, search files, tag files, move files and transfer upload events by Alex, with invoice-2026-10.pdf, 2 files and team-offsite.png as targets" caption="Two agents at work on demonstration files. The read-only one was refused when it tried to delete." />

## For operators

No environment variable turns the server on, and it runs inside Flare: there is no extra process or port. The upgrade adds one database table. [Configuration](/hosting/configuration#mcp-server) covers the public address, reverse proxies and their logs, and browser-based clients; the [upgrade note](/hosting/maintenance#mcp-server) covers the migration and rollback.
