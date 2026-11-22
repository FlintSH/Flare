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

<Screenshot src="/screenshots/agents/settings-mcp-server.webp" alt="MCP server card in Settings Access with Enable the MCP server switched on above the sentence Agents can connect and act for an account, once its owner signs them in or gives them a token, then Allow administration through MCP switched on above the sentence Agents can be given permission to manage users, roles, other accounts' content and instance settings, up to what the account's role allows, the Server URL http://localhost:3193/api/mcp beside a Copy URL button, a note that Claude and ChatGPT on the web need a public HTTPS address while local clients work with this address, and a link to the agents guide" caption="Both switches and the address agents connect to, on a local demonstration instance. The second switch appears once the server is on. The note under the address appears when it is not a public HTTPS one." />

Under the switch the card says what it opens: **Agents can connect and act for an account, once its owner signs them in or gives them a token. They can do only what that connection and the account's role allow.** The card then shows the **Server URL** that agents connect to, with **Copy URL**, and **Read the agents guide** opens [Connect an agent](/guide/agents) for the version you run. Opening Settings needs `settings.read`; the switch itself needs `settings.security`, the permission that also governs registration and single sign-on, because it opens a new way to reach the instance.

From the next request on:

- **`POST /api/mcp` answers.** Before, it and every transfer URL answered `404`, as if they did not exist.
- **The sign-in endpoints answer.** Two documents under `/.well-known/` tell a client where to sign in, and `/api/oauth/register`, `/api/oauth/authorize`, `/api/oauth/token`, and `/api/oauth/revoke` carry the sign-in, with the consent screen at `/auth/connect`. They also answered `404` before. A client can register itself without an account, within [limits](/api/mcp#register-a-client), but a registration gives access to nothing: only a signed-in person who chooses **Allow** connects an agent.
- **People with `tokens.manage` get an Agents card** in **Profile → Integrations**, with **Connect an agent** and their connected agents, and an **Agent access** box in **New token**.
- **Nothing that already exists gains access.** No existing API token, upload token, or browser session works on the MCP endpoint. An agent can connect only after a person signs it in or creates a token for it.

## What an agent can do

An agent acts as the account that connected it, and three things bound it:

- **The actions that person allowed** when connecting. For an agent that signed in, they can change these afterwards.
- **The account's role, checked on every call.** An agent can never do what its owner's role does not allow, and a role change applies at once.
- **Its owner's own account.** Agents work with that account's files, folders, tags, short links, upload profiles, settings, and invites, unless you turn on [administration through MCP](#administration-through-mcp) and the person grants an administration scope.

The actions a person can allow, as the consent screen and the token form name them:

| Action                      | Scope            | Lets the agent                                                                                                                      | Role permissions it uses                                                                                     |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Upload files**            | `files:upload`   | Upload files and create pastes; with **Read file contents**, extract archives and create them                                       | `files.upload`, `pastes.create`; archives also need `files.read`, and extracting `folders.manage`            |
| **Read files**              | `files:read`     | List and search files, folders, and tags                                                                                            | `files.read`                                                                                                 |
| **Read file contents**      | `files:content`  | Read files and what is inside archives, and get download links, private files included                                              | `files.read`                                                                                                 |
| **Organize files**          | `files:organize` | Manage folders and tags, move and tag files, schedule an expiry                                                                     | `files.update`, `folders.manage`, `tags.manage`                                                              |
| **Change sharing**          | `files:share`    | Change visibility and passwords, share folders                                                                                      | `files.share`, `folders.manage`, `folders.share`                                                             |
| **Delete files**            | `files:delete`   | Delete files permanently                                                                                                            | `files.delete`                                                                                               |
| **Read short links**        | `urls:read`      | List short links                                                                                                                    | `links.read`                                                                                                 |
| **Manage short links**      | `urls:write`     | Create and delete short links                                                                                                       | `links.create`, `links.delete`                                                                               |
| **Change account settings** | `account:write`  | Change the display name, vanity URL, upload defaults, theme, link embed, and avatar, and create, change, and delete upload profiles | `profile.update`, `uploadProfiles.manage`; the theme needs `appearance.personal` and the embed `files.share` |
| **Manage invites**          | `invites:write`  | List, create, and revoke invite links; everyone's with `invites.manage`                                                             | `invites.create`, `invites.manage`                                                                           |

The four administration actions are [below](#administration-through-mcp); they exist only while you allow administration through MCP. With **Read files**, **Read file contents**, and **Read short links** together, which is the **Read only** preset, an agent can also export the account, if the role holds `profile.export`. The [reference](/api/mcp#authorization-matrix) has the exact needs of every tool.

### What Change account settings covers

**Change account settings** is part of the **Everything in my account** preset and a checkbox under **Custom**. It lets an agent do what its owner does under **Profile → Account** (**Identity** and **Appearance**), **Profile → Uploads**, and **Profile → Embeds**:

- **Display name, vanity URL, and avatar.** The avatar is an image the agent picks from the account's own files, and an avatar is public. Picking one therefore also needs **Read file contents**, and **Change sharing** when the image is private or has a password.
- **Upload defaults:** randomized file URLs, the default expiration, and what it does.
- **Theme** (`appearance.personal`) and **link embed** (`files.share`, and only while the instance [allows personal embeds](./appearance)).
- **Upload profiles:** create, change, delete, and choose the default (`uploadProfiles.manage`).

Expirations act on every later upload, so Flare checks what each change does to them. For every way of uploading (no profile named, the account's own defaults, and each upload profile) it works out the expiration action and the length a file takes from what is saved. A change that makes the saved action of any of them `delete` also needs **Delete files** and `files.delete`, and one that makes it `make_private` needs **Change sharing** and `files.share`, even while no length is saved, because an upload can set its own expiration and take the saved action. A length that is new for any of them needs both, because an upload can name either action itself and take the saved length. That includes turning on a default expiration that an existing profile's action then applies to, and removing or deleting a default profile when uploads that name no profile then take another action or length from the account. Naming an expiration action always needs that action's scope, even while no expiration length is set. Turning an expiration off needs neither. Visibility is checked the same way: a change to an upload profile, or to which profile is the default, that would make later uploads public where they were private needs **Change sharing** and `files.share`. The [reference](/api/mcp#rules-for-later-uploads) has the details.

It never covers how the account signs in. No agent, whatever it was allowed, can change the email address, the password, passkeys, two-factor authentication, or recovery codes, read or revoke sessions, or delete the account.

A named token that is [bound to an upload profile](/api/authentication#bind-uploads-to-a-profile) cannot change upload profiles or the account's upload defaults through MCP, even with **Change account settings**: it would otherwise be able to rewrite the settings it was bound to. Its other account settings work.

To keep agents on your instance from any of this, remove the role permission behind it. A role without `profile.update` has no `update_profile` tool, one without `uploadProfiles.manage` cannot touch upload profiles, and one without `profile.export` cannot export. Those permissions also govern what people do in Profile, so removing one removes it for both.

### Archives and exports

Agents extract and create archives through the same code as the library, with the same [limits](/guide/archives#supported-sizes-and-formats). They also share its capacity: Flare runs one archive operation for an account at a time and two in each Flare process, whether a person or an agent started them, so while an agent's operation runs, someone's **Extract all** is refused with **Another archive operation is running. Try again shortly.**, and the other way round.

An export is downloaded through a temporary URL that needs no sign-in and works once, if the download starts within 15 minutes. Whoever holds that URL in those minutes gets every file of the account, so it is worth more than any other link an agent receives. It appears in the agent's transcript and in [proxy access logs](/hosting/configuration#mcp-server).

### What no agent can do

Without [administration through MCP](#administration-through-mcp), an agent connected by an administrator still works only with that account's own files and settings, and its invites where it was allowed **Manage invites**: it cannot read or change users, roles, instance settings, the audit log, or other accounts' files. Whatever an agent was granted, it can never create or read API tokens, upload tokens, or webhooks, connect or change another agent, or change how anyone signs in; the [list below](#what-an-agent-can-never-do-whatever-it-was-granted) has every such rule. The [reference](/api/mcp#what-mcp-covers-of-the-http-api) lists every route and whether a tool covers it.

One risk remains and cannot be removed: an agent reads files, and a file can contain text written to steer the agent that reads it. Flare marks file contents as untrusted data for the agent, which lowers the risk without ending it. What a misled agent can do is limited to what its connection allows, so tell the people on your instance to [grant the least that works](/guide/agents#stay-safe).

## Administration through MCP

Administration through MCP lets agents act on the instance itself: manage users and roles, moderate other accounts' files and short links, and change some instance settings. It is a second switch on the **MCP server** card, separate from the server itself, and it is **off on every instance until an administrator turns it on**. It does nothing while the MCP server is off.

### Turn it on

1. Turn on the MCP server and save, as [above](#turn-it-on). The card then shows a second switch, **Allow administration through MCP**, under the server's own.
2. Turn on **Allow administration through MCP**. Under it the card says what it allows: **Agents can be given permission to manage users, roles, other accounts' content and instance settings, up to what the account's role allows.**
3. Choose **Save settings**.

Nothing changes for agents that are already connected: each one that should administer needs a person to grant it an administration permission, which a connected agent can only get by signing in again, and a token only by being created with it. From then on, the [consent screen and the token form](/guide/agents#administer-the-instance) offer an **Administration** group under **Custom** to accounts whose role can use it.

### Who can change it

Only an account that holds `administrator` can turn administration through MCP on or off. For anyone else who can open these settings, the switch cannot be changed and its sentence ends **Only an administrator can change this.** The MCP server switch beside it needs `settings.security`, as before, so someone who can turn the server on cannot by that alone let agents administer the instance. No agent can change either switch: neither setting can be changed through MCP.

### Turning it off removes the administration permissions for good

To turn it off, turn off **Allow administration through MCP**. Flare asks **Turn off administration through MCP?** and says **When you save, every agent connection and token loses its administration permissions. Turning this on again does not give them back.** Choose **Turn off**, then **Save settings**; **Cancel** leaves the switch on. Nothing happens until you save, and turning the switch back on before saving asks nothing.

When an administrator turns it off and saves, Flare takes the four administration scopes away from every named token, every agent that signed in, and every sign-in not yet finished, in the same save. Turning it on again gives nothing back: each agent that should administer has to be signed in again, or given a new token. Saving it on also removes any administration permission still stored, so nothing granted before can come back. Download links made for moderation stop working at once and stay dead.

The save takes turns with every grant. A token being created, a consent being allowed, or a sign-in being finished at that moment either completes first and loses its administration permissions with everything else, or sees the switch off: the token or the consent is refused, and an agent finishing its sign-in gets a connection without them, or none if they were all it was granted.

Nothing else about those tokens and connections changes. One left with only other scopes keeps working with them, and one left with none still connects and sees only `get_account`; its owner decides whether to keep it. The audit log records one `mcp.administration.scopesRemoved` event with the number of named tokens, connections, and token pairs that lost a scope, and the reason: `administration-off`, or `administration-on` when saving it on removed leftovers.

While it is off, nobody can give an agent an administration scope: the consent screen, the token form, and **Edit permissions** show no **Administration** group, Flare refuses a sign-in or a token that asks for one, and a credential that still holds one cannot use it. **Manage invites** is not an administration permission and is still offered.

### What each permission lets an agent do

An agent with one of these acts as the account that connected it, and can do no more than that account's role allows: it needs the role permission behind each tool, it can manage only accounts and roles below that account's own highest role, and it can grant only permissions the account holds.

| Action                       | Scope            | Lets the agent                                                                                                                                                                                                                                                            | Role permissions it uses                                                                                                                          |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manage invites**           | `invites:write`  | List, create, and revoke the account's own invite links, or everyone's. It is not an administration scope: it works whenever the MCP server is on, for any account whose role may create or manage invites. Giving an invite roles also needs **Manage users and roles**. | `invites.create`; everyone's invites `invites.manage`                                                                                             |
| **View administration**      | `admin:read`     | List and read users and roles, read the instance settings with every secret hidden, check for updates, and search the audit log                                                                                                                                           | `users.read`; roles one of `roles.manage`, `users.roles`, `users.read`; `settings.read`, and `settings.email` for the email section; `audit.read` |
| **Manage users and roles**   | `admin:users`    | Create users, change their name, public IDs, avatar, roles, and email verification, sign them out everywhere, delete them; create, change, and delete roles; give invites roles                                                                                           | `users.create`, `users.update`, `users.roles`, `users.email`, `users.sessions`, `users.delete`, `roles.manage`, each for what it covers           |
| **Moderate content**         | `admin:content`  | Find, read, change the sharing of, and delete another account's files, and list and delete its short links, including private and password-protected files                                                                                                                | `content.read`, `content.update`, `content.delete`                                                                                                |
| **Change instance settings** | `admin:settings` | Open or close registration and set invite limits, let everyone invite, change storage, quotas and the upload limit, the footer credit, OCR, and the classic theme; change the email policy and branding and send test emails; edit and publish the appearance studio      | `settings.security`, `settings.storage`, `settings.general`, `appearance.manage`, `settings.email`, each for what it covers                       |

The [reference](/api/mcp#administration) has every tool, argument, and refusal. A user an agent creates [has no password](./users#accounts-an-agent-creates) and cannot sign in until you set one; to bring a person in, an agent creates an invite instead.

### What an agent can never do, whatever it was granted

Some changes would hand out access that outlives the agent's connection. MCP refuses them for every agent, an administrator's included, whatever its scopes:

- **How anyone signs in.** No agent sets or changes a password or an email address, its own account's or anyone else's. It cannot change single sign-on, passkeys, two-factor authentication, or recovery codes, and it cannot sign out the account it acts as or require that account to verify its email.
- **The three key permissions**: `administrator`, `settings.security`, and `settings.email`. Between them they decide who administers the instance, how people get in, and where account mail goes. No agent can give a user or an invite a role that holds one, add one to any role, Everyone included, or exempt an account that holds one from email verification. A role that already holds one keeps it. See [key permissions](./roles#key-permissions).
- **The Everyone role while it holds a key permission.** Everyone applies to every account, and you can give it `settings.security` or `settings.email` in Roles. Do that, and every new account would hold it, so agents can no longer create users or invites, open registration, or let everyone invite, and no agent sees any invite's link until you take it off again.
- **Code in visitors' browsers and the instance's look outside the studio.** Custom head HTML and CSS, logos, the favicon, and appearance packs change only in the browser.
- **Where account mail goes.** The SMTP connection and the public address put in emailed links change only in **Settings → Email**.
- **The MCP settings.** Neither switch on the **MCP server** card.
- **Secrets.** No agent reads an S3 key, the single sign-on client secret, or the SMTP password, and a saved S3 key is never sent to a new bucket or endpoint: changing the destination needs both keys in the same call.
- **Credentials.** API tokens, upload tokens, webhooks, and agent connections.
- **The account it acts as.** An agent cannot delete it, and setup and the legacy whole-settings write are not reachable.

### What a misled agent can still do

An agent that administers the instance also reads text other people wrote: file contents, names, invite notes, audit details. That text can be written to steer it, and nothing removes that risk. Within the rules above, here is what a misled agent with these permissions could still do that lasts after its connection ends:

- **Create an account or an invite with any role that holds no key permission**, including a role with other powerful permissions, such as managing users or moderating content.
- **Change what such roles allow.**
- **Open registration**, so anyone can create an account.
- **Point storage at another bucket with new keys**, which sends every later upload there.
- **Change the reply-to and support addresses** that account emails carry (`reply_to` and `branding.support_address`), so a person who replies to such an email reaches whoever the agent set. It cannot change the server the mail is sent through or the links in it.

That is what **Manage users and roles** and **Change instance settings** mean. The [audit log](#review-what-agents-did) is where such a change is found afterwards.

### What bounds it

- **Nothing is granted by default.** No preset includes an administration scope or **Manage invites**, and they are never ticked in advance: a person has to choose them under **Custom**, where the administration scopes sit in their own **Administration** group after **Account**. On the consent screen and in **Edit permissions** the group says **These let the agent act on other accounts and the instance itself, and a connection that holds one ends after 30 days.**; in the token form, **These let the agent act on other accounts and the instance itself.**
- **Every administration change is marked destructive.** `create_user`, `update_user`, `delete_user`, `save_role`, `delete_role`, `update_instance_settings`, `update_email_settings`, `update_instance_appearance`, and the moderation tools that change or delete are all marked so. That is a hint: whether a client asks a person first is the client's policy, not something Flare enforces. Codex CLI refuses destructive tools in a non-interactive run (`codex exec`), and asks first in an interactive one.
- **A rate limit of its own.** An account can make 30 administration changes a minute through MCP, across all its tokens and connections. A change refused for missing access (a scope, a role permission, an argument's needs, moderation, or the role's rank over the account or role it names) is given back, while one that fails for any other reason, the limit itself included, keeps its cost.
- **A short lifetime.** An agent that signed in with an administration scope is disconnected 30 days after it was allowed, used or not; turning administration off or on, or editing its permissions, never brings it back, and the agent has to sign in again. The consent screen shows the date (**This connection ends on** and the date), and **Connected agents** shows **Ends** and the date on that agent. A token with one must expire within 90 days: while an administration permission is ticked, the token form offers no expiry longer than **90 days**.
- **Granted only when connecting.** **Edit permissions** can remove an administration scope from a connected agent but never add one. One the agent does not hold is locked with **Connect the agent again to grant this.**: disconnect it and sign it in again instead.
- **The switch stops new calls, not ones already running.** Turning administration off ends stored permissions and refuses every later call, but a call in progress, such as one that deletes up to 50 files of another account, completes.
- **Everything is audited.** Every call is an `mcp.` event with the token or connection that made it, which you can filter in the audit log, and which an agent with **View administration** can search with `search_audit_log`.

Use a separate connection for administration, apart from the agent you use for your own files, and give it only the scopes the task needs: **View administration** alone for questions about the instance, **Moderate content** for a cleanup. A connection that reads files other people uploaded is the one most likely to meet text written to mislead it, so it should hold the least.

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

Nothing is deleted. Tokens are kept as they are, and so are the connections of agents that signed in. Turning the server on again lets the same tokens connect again, so turning it off is a pause, not a cleanup. An agent that signed in cannot renew its access while the server is off; when it is back on within 90 days the agent can carry on, though a client that gave up in the meantime asks its owner to sign in again. While the server is off, a token made for an agent still works on the [REST API](/api/authentication#scope-reference) for the scopes that work there, such as uploading and listing files. To end a connection for good, its owner disconnects the agent or revokes the token. Turning the server off leaves [administration through MCP](#administration-through-mcp) as it was, and takes no administration scope away; to do that, turn administration off.

## Review what agents did

Every tool call an agent makes is recorded in the [audit log](./audit). Set **Category** to `mcp` to see them; the category is offered once the first call has been recorded:

- **Action** is `mcp.` and the tool, such as `mcp.read_file`, `mcp.set_file_sharing`, or `mcp.delete_files`. The tools this page describes above are `mcp.extract_archive`, `mcp.create_archive`, `mcp.export_account`, `mcp.update_profile`, `mcp.save_upload_profile`, and `mcp.delete_upload_profile`. The invite and administration tools are recorded the same way, from `mcp.list_invites` to `mcp.update_instance_appearance`, with the invite, user, role, or settings section as the target. A moderator mode call is recorded under its tool, such as `mcp.delete_files`, with the other account's file as the target.
- **Outcome** is `success`, `denied` when the connection or the role did not allow the call, or `failure`.
- The actor is the account. The event's details carry the ID of the token used, or `connection:` and the connection's ID for an agent that signed in, never a secret. The target is the file, folder, tag, short link, or upload profile, or the account itself for a settings change or an export.
- `mcp.administration.scopesRemoved` means saving the administration switch took administration scopes from tokens and connections. Its details give the `count` of named tokens, connections, and token pairs and the `reason`, `administration-off` or `administration-on`.
- Downloads and uploads through the temporary URLs agents receive appear as `mcp.transfer.download` for a file, `mcp.transfer.archive-entry` for one file inside an archive, `mcp.transfer.upload`, and `mcp.transfer.export` for an account export. An `mcp.export_account` event means an agent asked for an export URL; the `mcp.transfer.export` event that follows means the export was downloaded.

The changes themselves also appear as the usual events, such as `file.create`, `user.update`, or `upload_profile.create`, in their own categories. To see what agents changed in the instance, filter **Category** to `mcp` and look for the administration tools, or search by **Action**, such as `mcp.update_instance_settings`. The [reference](/api/mcp#audit) has the details.

<Screenshot src="/screenshots/agents/audit-mcp.webp" alt="Audit log filtered to the mcp category: a denied MCP delete files call, then successful set file sharing, search files, tag files, move files and transfer upload events by Alex, with invoice-2026-10.pdf, 2 files and team-offsite.png as targets" caption="Two agents at work on demonstration files. The read-only one was refused when it tried to delete." />

Connecting is recorded in the `authentication` category, beside the sign-ins of people. Set **Category** to `authentication` and choose an **Action**, or search for `agent_connection` or `oauth`:

| Action                        | What happened                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_connection.create`     | A person allowed an agent, and it connected. The event names the account, the name the client gave itself, and the scopes granted.                                                                                                                                                                                                               |
| `agent_connection.updateMany` | A connection was edited or ended. The details show the scopes before and after, and for an ending its `revokedReason`: `disconnected` by its owner, `revoked` by the client, or `replay` or `code-reuse` when Flare ended it itself, or `expired` for an administration connection past its 30 days that saving the administration switch ended. |
| `agent_connection.revokeAll`  | Every agent an account had signed in was disconnected because the account was signed out everywhere. The details give the count.                                                                                                                                                                                                                 |
| `oauth.token` with `denied`   | An old sign-in credential of an agent was used again, and Flare ended that connection. This can mean a copy of the credential was taken, so it is worth asking the account's owner about.                                                                                                                                                        |
| `oauth.register`              | A client registered itself. Anyone can, so these alone mean little; a burst of refused ones from one address is the registration limit at work.                                                                                                                                                                                                  |
| `oauth.authorize`             | A browser started a sign-in, a request was refused, or a person answered the consent screen.                                                                                                                                                                                                                                                     |

An agent renewing its access, which a busy one does about once an hour, is not recorded.

## For operators

No environment variable turns the server on, and it runs inside Flare: there is no extra process or port. The upgrade adds five database tables. [Configuration](/hosting/configuration#mcp-server) covers the public address, reverse proxies and their logs, and browser-based clients; [reverse proxy](/hosting/reverse-proxy#agent-sign-in) covers what sign-in needs from a proxy; the [upgrade note](/hosting/maintenance#mcp-server) covers the migrations and rollback.
