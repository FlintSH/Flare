---
title: Connect an agent
description: Let Claude Code, Claude, ChatGPT, Codex, Cursor, VS Code, Gemini CLI, or another MCP client work with the files in your Flare account, by signing in through your browser, with permissions you choose.
---

# Connect an agent

Connect an AI agent to your Flare account and ask it in plain words to find, read, upload, and organize your files, work with archives, change your account settings, and manage your invites. You add Flare to the agent's client, sign in through your browser, and choose what the agent may do. It connects through Flare's built-in MCP server and can never do more than your own role.

## Before you start

- **An administrator has turned on the MCP server.** Until then, **Profile → Integrations** shows no **Agents** card. Administrators turn it on in [Settings → Access](/admin/agents).
- **Your role has `tokens.manage`.** Every account has it unless an administrator removed it from Everyone.
- **Your client can add a remote MCP server.** Claude Code, Codex, Cursor, VS Code, and Gemini CLI run on your computer and work with any address they can reach. [Claude](#claude) on desktop and the web and [ChatGPT](#chatgpt) connect from their vendor's servers, so they need your instance to have a public HTTPS address.

## Connect your client

1. Open **Profile → Integrations**. In the **Agents** card, choose **Connect an agent**.
2. Under **Client**, pick your client. The dialog shows that client's steps, which are also [listed below](#steps-for-each-client).
3. Follow the steps. The client opens Flare in your browser.
4. Sign in if Flare asks you to, then [check the request and choose what the agent may do](#allow-the-connection-in-your-browser).
5. Choose **Allow**. Your browser returns to the client, which is now connected.
6. Back in the dialog, choose **Done**. The agent is listed under [**Connected agents**](#manage-connected-agents) the next time the page loads its lists, within a few seconds.

Nothing in these steps is a secret: no token is created, shown, or copied, so you can share the commands with a teammate, who then signs in as themselves.

[Watch the recorded walkthrough](/demos#connect-an-agent) of the whole flow with the Codex CLI.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-dialog.webp" alt="Connect an agent dialog with Claude Code selected under Client beside Claude, ChatGPT, Cursor, VS Code, Codex, Gemini CLI and Other, two numbered steps with the claude mcp add command for https://files.example.com/api/mcp and a copy button, and Use a token instead beside Done" caption="The dialog opens on the steps for signing in. Use a token instead is at the bottom left." />
</div>

::: details The same dialog on a phone

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-dialog-mobile.webp" alt="Connect an agent dialog on a 390-pixel phone screen, with the eight client choices wrapped over three rows, the two steps for Claude Code with the command wrapped over four lines, and Done above Use a token instead" caption="On a phone the client choices wrap, and long commands break across lines." />
</div>

:::

### Allow the connection in your browser

If you are not signed in to Flare in that browser, the login page says **Sign in to connect an agent to this account.** Sign in the way you usually do, with a password, a passkey, a second factor, or single sign-on, and Flare takes you on to the request. A request waits 10 minutes for you. After that, start again from the client.

<div style="max-width: 448px; margin-inline: auto">
<Screenshot src="/screenshots/agents/signin-login.webp" alt="Flare login page with a notice above the email and password fields reading Sign in to connect an agent to this account" caption="The login page says when an agent is waiting for you." />
</div>

The **Connect an agent** screen then shows what is asking:

| Line           | What it is                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent**      | The name the client gave itself, such as `Codex` or `Claude Code (flare)`. Any program can register under any name, so the name proves nothing.                                                                                                                                                                                                                        |
| **Returns to** | Where your browser goes once you answer, which is where the agent that receives the access lives. `this device` is a program on the computer your browser runs on, which is what Claude Code, Codex, and other local clients are. A website shows its host, such as `claude.ai`. An app opened through its own kind of link shows `an app on this device (cursor://)`. |
| **Account**    | The Flare account the agent will act as.                                                                                                                                                                                                                                                                                                                               |

**Returns to is the line to check.** It should match the client you are setting up: `this device` for a client you just started on this computer, or the website you just came from. A host you do not recognize means someone else's program would receive the access.

Under **Allowed actions**, [choose what the agent may do](#choose-what-the-agent-may-do). **Read and upload** is selected to begin with. A client can ask for less than everything, and the screen then offers only what it asked for. Claude Code and Codex ask for every action, so you see every choice your role allows.

**Only allow a connection you started yourself.** If this screen appears when you were not connecting a client, choose **Cancel** or close the tab: nothing is granted until you choose **Allow**. **Allow** turns on about half a second after the page is in front of you, and turns off while the page is hidden or another window has the focus, so a click meant for another page cannot grant access.

<div style="max-width: 448px; margin-inline: auto">
<Screenshot src="/screenshots/agents/consent.webp" alt="Connect an agent screen reading Only allow a connection you started yourself, with Agent Codex, Returns to this device and Account Alex, the Allowed actions choices Read only, Read and upload (selected), Everything in my account and Custom, and Cancel and Allow buttons" caption="The Codex CLI asking to connect to the demonstration account Alex. It returns to this device because Codex runs on the same computer as the browser." />
</div>

::: details The same screen on a phone

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/agents/consent-mobile.webp" alt="Connect an agent screen on a 390-pixel phone screen with the same three lines, the four Allowed actions choices stacked, and Cancel beside Allow" caption="The screen fits a phone without scrolling." />
</div>

:::

After **Allow**, a local client shows a page of its own, such as Codex's `Authentication complete. You may close this window.` When the client is an app opened through its own kind of link, Flare's screen stays and says **Allowed. You can close this tab. If the app did not open, reload this page and allow again.**

What can stop you here:

- **Your role does not allow connecting agents.** The screen says so and offers only **Cancel**. Ask an administrator for `tokens.manage`.
- **This sign-in request has expired.** The screen was open for more than 10 minutes. Go back to the client and connect again.
- **This account already has 50 connected agents.** [Disconnect](#manage-connected-agents) one you no longer use, then connect again.
- **This sign-in cannot continue.** Flare refused the client's request before showing it to you. See [troubleshooting](#troubleshooting).

### Use a token instead

Every client except Claude and ChatGPT can connect with a named API token in place of signing in. Use one for a client that cannot open a browser, such as an agent on a server, or when you want the connection to end on a date you choose.

1. In **Connect an agent**, pick your client, then choose **Use a token instead**.
2. Under **Allowed actions**, [choose what the agent may do](#choose-what-the-agent-may-do). **Read and upload** is selected to begin with.
3. Check **Connection name**, which starts as the client's name (**Agent** for **Other**), and **Expires after**, which starts at **90 days**. The other choices are 30 days, 1 year, and Never. While an [administration action](#administer-the-instance) is ticked, 1 year and Never are unavailable.
4. Choose **Create token**. Flare creates a token for the agent and shows the steps for your client with the token already filled in. **Back** returns to the sign-in steps without creating anything.
5. Follow the steps, then choose **Done**.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-token.webp" alt="Connect an agent dialog after Use a token instead, with Claude Code selected among six clients, Read and upload selected under Allowed actions, the connection name Claude Code, Expires after set to 90 days, and Back beside Create token" caption="The token form lists only the clients that can take a token." />
</div>

The token is shown only this once. Copy what you need before you close the dialog: under **Other ways to set it up** it also offers a configuration file for your client and the token on its own. If you lose it, [revoke it](#disconnect-an-agent) and connect again.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-steps.webp" alt="Connect Claude Code dialog with two numbered steps, the claude mcp add command with its token blurred, the claude mcp list command, each with a copy button, and a collapsed Other ways to set it up section" caption="The token steps for Claude Code. The token is blurred in this screenshot." />
</div>

## Steps for each client

Below, `https://files.example.com/api/mcp` stands for your **Server URL** and `flr_YOUR_TOKEN` for a token. The dialog fills in both. Each client's first steps sign in through the browser, and **With a token** is the alternative.

### Claude Code

Run this in a terminal, in the project you want to use Flare from. Add `--scope user` to use it in every project.

```sh
claude mcp add --transport http flare https://files.example.com/api/mcp
```

In Claude Code, run `/mcp`, choose flare and authenticate. Flare opens in your browser, where you choose what it may do.

From a terminal, `claude mcp login flare` starts the same sign-in. With `--no-browser` it prints the address to open instead, for a machine that has no browser.

**With a token**, run this instead, with the same choice of `--scope`:

```sh
claude mcp add --transport http flare https://files.example.com/api/mcp --header "Authorization: Bearer flr_YOUR_TOKEN"
```

Check that `flare` is listed as connected:

```sh
claude mcp list
```

To share the token setup with a project, put this in `.mcp.json` instead. It reads the token from `FLARE_TOKEN`, so the file holds no secret:

```json
{
  "mcpServers": {
    "flare": {
      "type": "http",
      "url": "https://files.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer ${FLARE_TOKEN}"
      }
    }
  }
}
```

Set `FLARE_TOKEN` in the shell that starts Claude Code:

```sh
export FLARE_TOKEN=flr_YOUR_TOKEN
```

### Claude

Claude on desktop and the web connects from Anthropic's servers, not from your computer. It can reach only a public HTTPS address, and it signs in: there is no token alternative.

1. In Claude, open **Customize**, then **Connectors**. Choose **+ Add**, then **Add custom connector**.
2. Name it Flare and paste this URL:

   ```text
   https://files.example.com/api/mcp
   ```

3. Add the connector, then sign in. Flare opens in your browser, where you choose what it may do.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-claude.webp" alt="Connect an agent dialog with Claude selected and three numbered steps: open Customize then Connectors and add a custom connector, name it Flare and paste the URL https://files.example.com/api/mcp, then add the connector and sign in" caption="The steps for Claude, on a demonstration instance whose address is a public HTTPS one." />
</div>

When your instance's address is not a public HTTPS one, for example `http://localhost:3000`, an address inside a private network, or a name that ends in `.local`, the dialog shows no steps for Claude or ChatGPT. It says the client needs a public HTTPS address and names a local client that works instead.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-unavailable.webp" alt="Connect an agent dialog with Claude selected and a notice that Claude on desktop and the web connects from Anthropic's servers, so it needs a public HTTPS address, that this instance's address is not one, and that a local client such as Claude Code works with it" caption="The same choice on a local instance whose address is http://localhost:3198." />
</div>

### ChatGPT

ChatGPT connects from OpenAI's servers, so it also needs a public HTTPS address and has no token alternative.

1. In ChatGPT's connector settings, add a custom MCP server (connector) with this URL and OAuth as its authentication:

   ```text
   https://files.example.com/api/mcp
   ```

2. Sign in when ChatGPT asks. Flare opens in your browser, where you choose what it may do.

### Cursor

1. In the dialog, choose **Add to Cursor** on the computer that runs Cursor, then confirm the install in Cursor. The link holds no secret, and **Copy link** copies it to open on another computer.
2. Cursor then offers to sign in. Flare opens in your browser, where you choose what it may do.

To set it up by hand, put this in `.cursor/mcp.json` in a project, or in `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "flare": {
      "url": "https://files.example.com/api/mcp"
    }
  }
}
```

**With a token**, **Add to Cursor** hands Cursor a link that contains the token, so it is not shown here and has no **Copy link**. Do not share it. By hand, the file is:

```json
{
  "mcpServers": {
    "flare": {
      "url": "https://files.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer flr_YOUR_TOKEN"
      }
    }
  }
}
```

### VS Code

1. In the dialog, choose **Add to VS Code** on the computer that runs VS Code, then confirm the install in VS Code. The link holds no secret, and **Copy link** copies it to open on another computer.
2. VS Code asks to sign in the first time it uses the server. Flare opens in your browser, where you choose what it may do.

From a terminal:

```sh
code --add-mcp '{"name":"flare","type":"http","url":"https://files.example.com/api/mcp"}'
```

**With a token**, **Add to VS Code** hands VS Code a link that contains the token, so it is not shown here and has no **Copy link**. Do not share it. From a terminal:

```sh
code --add-mcp '{"name":"flare","type":"http","url":"https://files.example.com/api/mcp","headers":{"Authorization":"Bearer flr_YOUR_TOKEN"}}'
```

Or put this in `.vscode/mcp.json` in a workspace:

```json
{
  "servers": {
    "flare": {
      "type": "http",
      "url": "https://files.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer flr_YOUR_TOKEN"
      }
    }
  }
}
```

### Codex

Run this in a terminal. Codex starts the sign-in itself. Flare opens in your browser, where you choose what it may do.

```sh
codex mcp add flare --url https://files.example.com/api/mcp
```

If Codex did not start the sign-in, run this:

```sh
codex mcp login flare
```

**With a token**, run this instead:

```sh
codex mcp add flare --url https://files.example.com/api/mcp --bearer-token-env-var FLARE_TOKEN
```

Codex reads the token from `FLARE_TOKEN`. Set it in the shell that starts Codex, or in your shell profile to keep it:

```sh
export FLARE_TOKEN=flr_YOUR_TOKEN
```

In place of the first command, you can add this to `~/.codex/config.toml`:

```toml
[mcp_servers.flare]
url = "https://files.example.com/api/mcp"
bearer_token_env_var = "FLARE_TOKEN"
```

### Gemini CLI

Run this in a terminal:

```sh
gemini mcp add --transport http flare https://files.example.com/api/mcp
```

Gemini CLI starts the sign-in the first time it uses the server. Flare opens in your browser, where you choose what it may do.

**With a token**, run this instead:

```sh
gemini mcp add --transport http --header "Authorization: Bearer flr_YOUR_TOKEN" flare https://files.example.com/api/mcp
```

Or put this in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "flare": {
      "httpUrl": "https://files.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer flr_YOUR_TOKEN"
      }
    }
  }
}
```

### Other clients

Add a remote MCP server with this URL. The transport is Streamable HTTP.

```text
https://files.example.com/api/mcp
```

The client signs in with OAuth. Flare opens in your browser, where you choose what it may do. If the client cannot do that, use a token instead. The [reference](/api/mcp#sign-in-with-oauth) has what a client needs to implement.

**With a token**, send this header with every request:

```text
Authorization: Bearer flr_YOUR_TOKEN
```

For a client that only starts local servers, add `mcp-remote` as the server:

```json
{
  "command": "npx",
  "args": [
    "-y",
    "mcp-remote",
    "https://files.example.com/api/mcp",
    "--header",
    "Authorization: Bearer flr_YOUR_TOKEN"
  ]
}
```

When your instance is served over plain `http` from another computer, the dialog adds `--allow-http` to those arguments, because `mcp-remote` otherwise refuses such an address.

### Tested clients

Two clients were run against a local instance on 2026-11-21:

- **Claude Code 2.1.325** signed in through the browser: `claude mcp add --transport http`, authenticate, the consent screen, then `claude mcp list` reported `Connected`. Signing out in Claude Code revoked the connection in Flare.
- **Codex CLI 0.169.0** started the sign-in itself on `codex mcp add`, went through the consent screen, and printed `Successfully logged in.`

Both were also run with a token, with a model making real tool calls through the client: Claude Code looked up the account, uploaded text from the conversation, uploaded a file from disk through an upload URL and `curl`, searched, read text and an image back, and deleted. Codex looked up the account, uploaded text, and read it back, and it stopped to ask for approval before deleting, because Flare marks that tool as destructive.

The archive, account, and export tools were run on 2026-11-22 against a production build of a local instance, with a token that held **Everything in my account** and a model making the calls:

- **Claude Code 2.1.325** read the account settings, uploaded a ZIP from disk through an upload URL and `curl`, listed its entries and read a text entry, extracted it into a new folder (3 files), and made a TAR.GZ from two of them. It uploaded a public image and made it the avatar, changed the display name and the theme, created and deleted an upload profile, and exported the account: the returned `curl -fsS -o flare-export.zip` command downloaded a ZIP holding `user-data.json` and the files. Nothing was refused.
- **Codex CLI 0.169.0**, run non-interactively (`codex exec`), listed 28 tools, looked up the account, searched, listed the archive and read an entry by its position, and created an archive. It did not change account settings: Codex answered `MCP tool call requires approval, but approval policy is never`, because Flare marks that tool as destructive and a non-interactive run cannot ask. See [stay safe](#stay-safe).

The steps for Cursor, VS Code, and Gemini CLI follow each vendor's documentation and were not run here. Neither was `mcp-remote`. The [timeouts for archive calls](#give-archive-calls-enough-time) follow the vendors' documentation as well and were not tested here. **Claude on desktop and the web and ChatGPT were not run here either:** they need a public HTTPS address, which the test instance did not have. Their steps follow each vendor's documentation, and Flare's tests register clients with the fields and redirect addresses those two send.

## Choose what the agent may do

**Allowed actions** offers three presets and **Custom**. The consent screen, the token form, and [**Edit permissions**](#manage-connected-agents) all show the same choices:

| Preset                       | The agent can                                                        | Actions it includes                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read only**                | Find and read files, and list short links.                           | Read files, Read file contents, Read short links                                                                                                          |
| **Read and upload**          | Read only, plus uploading files and pastes.                          | Read files, Read file contents, Read short links, Upload files                                                                                            |
| **Everything in my account** | All file, short link and account setting actions, deleting included. | Upload files, Read files, Read file contents, Organize files, Change sharing, Delete files, Read short links, Manage short links, Change account settings |

**Custom** shows each action as a checkbox:

| Action                      | Lets the agent                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read files**              | List and search your files, folders, and tags, and see names, sizes, links, and sharing state                                                                          |
| **Read file contents**      | Read text, see images and the text in them, look inside archives, and get download links, private files included                                                       |
| **Upload files**            | Upload files and create pastes, choosing each new file's visibility, password, expiry, folder, and tags. With **Read file contents**, extract archives and create them |
| **Organize files**          | Create, rename, and remove folders and tags, move and tag files, and schedule or cancel an expiry                                                                      |
| **Change sharing**          | Make files public or private, set or remove their passwords, and create or revoke a folder's public link                                                               |
| **Delete files**            | Delete files permanently, now or through a scheduled expiry                                                                                                            |
| **Read short links**        | List your short links and their click counts                                                                                                                           |
| **Manage short links**      | Create short links and delete them                                                                                                                                     |
| **Change account settings** | Change your display name, vanity URL, upload defaults, theme, link embed, and avatar, and create, change, and delete upload profiles                                   |
| **Manage invites**          | List your invite links, create new ones, and revoke them. Not in any preset                                                                                            |

**Read files**, **Read file contents**, and **Read short links** together also let an agent [export your account](#export-your-account). All three are in every preset, **Read only** included.

**Manage invites** is in no preset. It appears under **Custom** when your role may create or manage invites, and lets an agent list, create, and revoke your invite links; see [invites](#invite-people). Administrators can also see administration actions there, when the instance allows them; see [administer the instance](#administer-the-instance).

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-custom.webp" alt="Token form of the Connect an agent dialog with Custom selected, showing checkboxes under Files, Short links, Account and Administration: Upload files, Read files, Read file contents and Read short links are checked; Organize files, Change sharing, Delete files, Manage short links, Change account settings, Manage invites, and the four administration actions View administration, Manage users and roles, Moderate content and Change instance settings are not. The Administration group says These let the agent act on other accounts and the instance itself" caption="Custom starts from the preset you had selected, here Read and upload. An administrator on an instance that allows administration through MCP also sees the Administration group." />
</div>

**Read and upload** leaves out deleting, sharing changes, managing short links, and changing account settings, because each of those can remove something, expose it, or change how your account behaves. Start there, and give an agent more only for work that needs it.

An agent can never do more than you can:

- Flare offers only the actions your [role](/admin/roles) allows, and leaves out a preset that would add nothing for you.
- Flare checks your role again on every call. If an administrator removes a permission from your role, the agent loses the matching tools at once.
- The agent works only with your own files, folders, tags, short links, upload profiles, settings, and invites, unless an administrator grants it [administration](#administer-the-instance).

### Before you allow Change account settings

**Change account settings** is in **Everything in my account**, and a checkbox under **Custom**. It lets an agent change what you change under **Profile → Account** (**Identity** and **Appearance**), **Profile → Uploads**, and **Profile → Embeds**. Know this before you allow it:

- **An avatar an agent chooses is public.** The agent picks an image from your files, and Flare shows a copy of it wherever your account appears, to anyone. Picking one also needs **Read file contents**. Flare lets an agent use a private or password-protected image only if it also holds **Change sharing**, because that publishes the picture.
- **Changing an expiry needs Delete files or Change sharing too.** Your default expiration and the expiration in each upload profile act on every later upload. For every way you upload, with no profile named, with your account defaults, or with each profile, Flare works out what a file would take from your saved settings. An agent can make the saved action **delete** only if it also holds **Delete files**, and make it **make private** only if it holds **Change sharing**. That holds even while no expiration length is saved, because an upload can bring its own expiration and take the saved action. Setting a new expiration length needs both, because an upload can name either action itself and take your saved length. All of this includes changes that land elsewhere, such as removing or deleting a default profile so that your uploads take another action or length from your account. Turning an expiration off needs neither.
- **Making your later uploads public needs Change sharing too.** An agent can set an upload profile to public, or remove a private profile you use by default, only if it also holds **Change sharing**, because every upload after that would be public. Making uploads private needs nothing more.
- **Your sign-in is out of reach.** No agent can change your email address, your password, your passkeys, or two-factor authentication, see or revoke your sessions, or delete your account, whatever you allowed. You change those yourself in **Profile**.
- **A new vanity URL breaks links that use the old one.** Links under your account's own URL ID keep working.
- **Upload profiles are shared with your tools.** A changed profile changes how everything that uses it uploads from then on, and a deleted one stops the tokens bound to it from uploading until you replace them.

A token you [bound to an upload profile](/api/authentication#bind-uploads-to-a-profile) cannot change upload profiles or your upload defaults, even with this action: it would otherwise be able to rewrite the settings you bound it to.

## Manage connected agents

Agents that signed in are listed in the **Agents** card under **Connected agents**. Each entry shows the name the client gave itself, where its sign-in returned to (`Local app` for a program on a computer, a host such as `claude.ai` for a website), the day it connected, the day it was last used or **Not used yet**, and one chip for each action it holds that your role still allows. An agent that holds an [administration action](#administer-the-instance) also shows **Ends** and the day its connection ends.

<Screenshot src="/screenshots/agents/profile-agents-card.webp" alt="Profile Integrations with the Agents card showing the Server URL https://files.example.com/api/mcp, Connect an agent, and under Connected agents the entries Claude Code (flare), a local app with Read files, Read file contents and Read short links, and Codex, a local app with Upload files, Read files, Read file contents and Read short links, each with Edit permissions and Disconnect; below it the API tokens list with a Claude Code token carrying an Agent access chip" caption="Agents that signed in are listed in the Agents card. An agent connected with a token is a token under API tokens." />

- **Edit permissions** opens the same choices as the consent screen. Choose **Save**, and **Permissions saved** confirms it. A removed permission applies on the agent's next call. An added one appears once the client reloads its tools, which most clients do when they start or reconnect. An agent always keeps at least one action.
- **Disconnect** ends the connection at once, without asking again, and **Agent disconnected** confirms it. The agent's next call is refused, and upload and download links it was given stop working. A change to your settings that the agent had asked for and Flare had not saved yet is not saved either. To use it again, sign in again from the client.

<div style="max-width: 512px; margin-inline: auto">
<Screenshot src="/screenshots/agents/edit-permissions.webp" alt="Edit permissions dialog for Claude Code (flare) with Read only selected among Read only, Read and upload, Everything in my account and Custom, a note that a removed permission applies on the agent's next call and an added one appears once the client reloads its tools, and Cancel and Save buttons" caption="Changing what a connected agent may do needs no new sign-in." />
</div>

An agent connected with a token is not in this list. It appears under **API tokens** with an **Agent access** chip and one chip for each action. A token's actions cannot be edited afterwards. To change them, revoke the token and connect the agent again.

### What else disconnects agents

An agent that signed in holds a way into your account, as a browser session does. Whatever signs your browsers out therefore disconnects those agents too:

- **Revoke all sessions** in [Profile](./account#login-history-and-active-sessions), or an administrator revoking your sessions.
- Changing or resetting your password, including when an administrator sets it.
- Changing the email address you sign in with.
- Turning [two-factor authentication](./security) on or off, or replacing its recovery codes.
- Adding or removing a passkey, turning **Require passkey to sign in** on or off, or replacing passkey recovery codes.

Signing out of one browser, revoking a single session, and renaming a passkey disconnect nothing.

A connection also ends when the client signs out of Flare itself, when it has not been used for 90 days, 30 days after you allowed it if it holds an administration action, and when Flare sees an old sign-in credential of that agent used again, which can mean a copy of it was taken. After any of these, sign in again from the client.

**Agents connected with a token are not affected by any of this.** A token works until it expires or you revoke it, whatever happens to your password and sessions.

## What you can ask for

| You want to                   | Ask something like                                                                             | Needs                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Share a file                  | "Upload this screenshot and give me the link."                                                 | Upload files                                                              |
| Share text or code            | "Make a paste of this function and send me the link."                                          | Upload files                                                              |
| Find files                    | "Find the invoice PDFs from October."                                                          | Read files                                                                |
| Search inside screenshots     | "Which of my screenshots mention a timeout?"                                                   | Read files                                                                |
| Read a file                   | "Summarize meeting-notes.md." "What does the error in my latest screenshot say?"               | Read files, Read file contents                                            |
| Organize                      | "Put this week's screenshots in a folder called Sprint 42 and tag them review."                | Read files, Organize files                                                |
| Tag new uploads by themselves | "Make a tag that marks every new file with invoice in its name."                               | Organize files                                                            |
| Change who can open files     | "Make last week's uploads private." "Put a password on the contract."                          | Read files, Change sharing                                                |
| Share a folder                | "Share the Brand assets folder and give me its link."                                          | Read files, Change sharing                                                |
| Clean up                      | "Delete today's test uploads." "Make the build logs expire in a week."                         | Read files, Delete files, Organize files                                  |
| Shorten a link                | "Shorten this URL."                                                                            | Manage short links                                                        |
| Look inside an archive        | "What is in release-assets.zip?" "Show me the README inside it."                               | Read files, Read file contents                                            |
| Extract an archive            | "Extract photos.zip into a folder called Trip."                                                | Read files, Read file contents, Upload files                              |
| Bundle files                  | "Zip October's invoices into invoices.zip."                                                    | Read files, Read file contents, Upload files                              |
| Change your profile           | "Use team-logo.png as my avatar." "Switch my theme to dark."                                   | Change account settings; Read files and Read file contents for the avatar |
| Set up an upload profile      | "Make an upload profile called Scratch that keeps files private and deletes them after a day." | Change account settings, Delete files, Change sharing                     |
| Export everything             | "Export my account and save the ZIP in my Downloads folder."                                   | Read files, Read file contents, Read short links                          |
| Invite someone                | "Make an invite link for Sam that works once and expires in two days."                         | Manage invites                                                            |

Searching matches file names and the text Flare has read from images. Changes to several files run on up to 50 files at a time, and the agent repeats the call for more.

Whatever you allow, an agent can never create or read API tokens, your upload token, or webhooks, it can never connect or change another agent, and it can never change how you or anyone else signs in: email addresses, passwords, passkeys, and two-factor authentication. The [reference](/api/mcp#what-mcp-covers-of-the-http-api) lists every boundary.

## Invite people

With **Manage invites**, an agent does what **Profile → Invites** does: it lists your invite links, creates them, and revokes them. It needs your role's `invites.create`, and to see or revoke other people's invites, `invites.manage`.

- **A new invite link lets whoever opens it create an account**, even while registration is closed, until it is used up, expires, or is revoked. The agent gets the link in its answer, so share it only with the person it is for. An invite works once and for 7 days unless you ask for something else, within the [invite limits](./invites#limits-for-members) that apply to your account.
- **Links are shown only for your own current invites.** An agent never sees the link of an invite whose roles hold one of the instance's key permissions, and sees no links at all while the Everyone role holds one; it can still revoke those invites.
- **Giving an invite roles is administration.** It also needs **Manage users and roles**, which is offered only where an administrator has turned on administration through MCP.
- **Revoking is for good.** The link stops working at once; people who already joined keep their accounts.

## Administer the instance

If you administer your instance and an administrator has turned on [administration through MCP](/admin/agents#administration-through-mcp), you can also allow an agent to view administration, manage users and roles, moderate other accounts' content, and change some instance settings. None of these is in a preset, and each is limited by your own role. An agent with one is disconnected 30 days after you allow it, and a token with one must expire within 90 days.

Read [agent access](/admin/agents#administration-through-mcp) before you allow any of them: it says what an agent can then do, what it can never do, and what a misled one could still change. Use a separate connection for administration, with only the actions the task needs.

Where to find them:

- **On the consent screen**, choose **Custom**. The **Administration** group comes after **Account**, and nothing in it is ticked to begin with. It says **These let the agent act on other accounts and the instance itself, and a connection that holds one ends after 30 days.** Once you tick one, the screen says **This connection ends on** and the date.
- **For a token**, under **Custom** in **Use a token instead** or in **New token** with **Agent access**. The group says **These let the agent act on other accounts and the instance itself.** While one is ticked, **Expires after** says **Tokens with administration permissions must expire within 90 days.**, and a longer choice moves to **90 days**.
- **In Edit permissions** you can untick an administration action an agent holds, but not add one: those it does not hold are locked with **Connect the agent again to grant this.** Disconnect the agent and sign it in again to grant one.
- **Under Connected agents**, such an agent shows **Ends** and the date, 30 days after you allowed it. After that date it is disconnected and has to sign in again.

<div style="max-width: 378px; margin-inline: auto">
<Screenshot src="/screenshots/agents/consent-administration.webp" alt="Lower part of the Connect an agent screen under Custom: the Account group with Change account settings and Manage invites unticked, the Administration group with its sentence These let the agent act on other accounts and the instance itself, and a connection that holds one ends after 30 days, View administration ticked, Manage users and roles, Moderate content and Change instance settings unticked, the line This connection ends on December 22, 2026, and Cancel and Allow buttons" caption="A real Claude Code sign-in with View administration ticked. The end date is 30 days from the day of the sign-in." />
</div>

<div style="max-width: 490px; margin-inline: auto">
<Screenshot src="/screenshots/agents/edit-permissions-administration.webp" alt="Administration group in the Edit permissions dialog of an agent that holds View administration: View administration is ticked, and Manage users and roles, Moderate content and Change instance settings are dimmed and unticked, each with the note Connect the agent again to grant this, above the note about when changes apply and Cancel and Save buttons" caption="An agent keeps or loses an administration action here, but gains one only by signing in again." />
</div>

<Screenshot src="/screenshots/agents/connected-agents-ends.webp" alt="Two connected agents: Cursor, a local app connected 11/20/2026 and used 11/21/2026 with Upload files, Read files, Read file contents and Read short links, and Claude Code (flare), a local app connected 11/17/2026, used 11/21/2026 and ending 12/17/2026 with Read files, Read file contents, Read short links and View administration, each with Edit permissions and Disconnect" caption="Only the agent with an administration action has an end date." />

## Upload files from disk

When you ask an agent that can run commands, such as Claude Code or Codex, to upload a file from your computer, it does not read the file into the conversation. It asks Flare for an upload URL and runs one command:

```sh
curl -sS -F "file=@./screenshot.png" "https://files.example.com/api/mcp/transfer/SECRET"
```

The bytes go straight from your computer to Flare. They never pass through the model, so a large file costs nothing extra, arrives intact, and is not sent to the model's provider.

- **The URL works once and for 15 minutes.** If the upload fails, the agent can run the same command again until then.
- **The file's settings are fixed when the URL is made.** Visibility, password, expiry, folder, and tags are what you asked the agent for, and anything you left out comes from your account defaults and upload profile as they are at that moment. The command cannot change them, and neither does editing the profile a minute later. A token you bound to an upload profile yourself is the exception: its uploads follow that profile as it is when they happen.
- **Size.** One file up to your instance's maximum upload size, or what your storage quota has left if that is smaller. The agent is told the limit. A new instance allows 100 MB.
- **Type.** Flare works out what kind of file it is from its contents, so the command needs nothing extra for a video or an archive.

Small content can go through the conversation instead: up to 256 KB of text, such as a note or a code file the agent just wrote, or 64 KB of binary data. A client that cannot run commands, such as Claude on the web or ChatGPT, can upload only that way.

## Read files

What an agent gets depends on the file:

- **Text, code, CSV, and pastes** arrive as text, 24 KB at a time. The agent asks for the next part when it needs more.
- **Images** arrive as a picture, scaled down to at most 1,080 pixels wide, together with any [text Flare has read from the image](./tags).
- **Videos** arrive as one frame.
- **Archives** arrive as a list of what is inside. The agent can then [read single files in them](#work-with-archives).
- **Anything else**, such as a PDF or audio, is not shown. The agent gets a download link that works for 10 minutes without signing in, which it can fetch with `curl`. An agent can also ask for such a link for any file.

Reading through an agent does not add to a file's view or download counts. The links an agent shows you in its answers are your normal Flare links: a private file still needs you to be signed in to open it.

## Work with archives

An agent works with [archives](./archives) the way you do in the library, on ZIP, TAR, TAR.GZ, TGZ, and GZIP files:

- **Look inside.** The agent gets the list of entries, 200 at a time, without unpacking anything. This needs only **Read file contents**. For a large archive Flare may still be reading the list, and the agent is told to ask again in a few seconds.
- **Read one file inside.** Text comes back as text, 24 KB at a time, like any text file. For anything else, such as an image or a PDF inside the archive, the agent gets a 10-minute download link to that one entry.
- **Extract.** The contents go into a new folder you name, in folders that follow the archive's own. This is **Extract all** from the library and has its limits: an archive of up to 256 MB that unpacks to at most 512 MB, 256 MB a file, and 1,000 files and folders. An archive with an entry Flare cannot unpack, such as an encrypted one, is refused as a whole.
- **Create.** Up to 100 of your files, 256 MB each and 512 MB together, become one new ZIP or TAR.GZ file in your library.

Extracting and creating need **Read file contents** and **Upload files** together, and your role's `files.read` and `files.upload`; extracting also needs `folders.manage`. Both are in **Read and upload**.

**What an agent extracts or creates is private and never expires**, whatever your upload defaults and default upload profile say, unless you ask it to use an upload profile by name. That is the same **Private (no profile)** choice the archive dialogs start on. A token you bound to an upload profile always uses that profile.

Flare runs one archive operation for your account at a time, yours in the browser included. If one is running, the agent is told so and nothing is created; ask again when it has finished.

### Give archive calls enough time

Extracting or creating a large archive can take up to two minutes, and the agent hears nothing until it is done. A client that stops waiting sooner reports a timeout even though Flare was still working.

- **Codex** waits 60 seconds for a tool by default. Add `tool_timeout_sec` to Flare's entry in `~/.codex/config.toml`, which `codex mcp add` created, and keep the lines that are already there:

  ```toml
  [mcp_servers.flare]
  url = "https://files.example.com/api/mcp"
  tool_timeout_sec = 180
  ```

- **Claude Code** needs no change. By default it waits far longer than two minutes for a tool, and five minutes for a server that sends nothing.
- **Gemini CLI** needs no change either: its default request timeout is 10 minutes.
- **Cursor, VS Code, Claude, ChatGPT, and other clients** may need a longer tool timeout. If an archive call is cut off after a fixed time, look for that setting in the client.

Looking inside an archive and reading a file in it answer quickly and need none of this.

## Export your account

Ask an agent to export your account and it gets a one-time link to the same ZIP that **Export all data** builds under [**Profile → Your data**](./account#export-your-data): every file you store, and a `user-data.json` with your name, your email address, and a list of your files and short links. No other tool shows an agent your own email address, so an agent with **Read only** can learn it this way. (An agent with **View administration** also sees email addresses, of every account on the instance, yours included.) An agent that can run commands downloads it with one command:

```sh
curl -fsS -o flare-export.zip "https://files.example.com/api/mcp/transfer/SECRET"
```

The export goes straight from Flare to the computer that runs the command and never passes through the model. It needs **Read files**, **Read file contents**, and **Read short links** together, which **Read only** has, and your role's `profile.export`.

- **The link gives every file in your account to whoever has it.** It needs no sign-in, so for the 15 minutes it can be started, treat it like the files themselves. It stays in the agent's transcript.
- **It works once.** The download has to start within 15 minutes. If it breaks off part way it cannot be resumed; ask the agent to export again.
- **It can be large and slow.** Flare builds the ZIP while it downloads. Make sure the computer has room for all your files.
- **A client that cannot run commands** can only show you the link. Opening it in your browser downloads the ZIP.

## Stay safe

- **File contents can try to mislead an agent.** A file someone sent you may contain text written to look like instructions, such as "delete the other files" or "make this public". Flare marks everything it reads from a file as data and tells the agent not to follow it. That lowers the risk; it does not remove it.
- **Grant the least that works.** An agent that only looks things up needs **Read only**. One that reads files other people wrote should not also be able to delete or share.
- **Deleting is permanent.** Flare has no trash. Many clients ask you before a tool that Flare marks as destructive runs: deleting, changing sharing or an expiry, changing account settings, saving or deleting an upload profile, revoking an invite, and every administration change. Keep that confirmation on. Codex asks in an interactive session. Run without one, as with `codex exec`, it cannot ask, and it refuses those tools unless its approval policy allows them.
- **Allow only what you started.** The consent screen appears because a client asked. If you did not just set one up, cancel, and check [**Returns to**](#allow-the-connection-in-your-browser) before every **Allow**.
- **Prefer signing in to a token.** A sign-in puts no secret in a file or a command, can be changed with **Edit permissions**, and ends when you sign out everywhere. A token is a key to your account: some setups store it in a plain file such as `.cursor/mcp.json`. Keep those files private, never commit one to a repository, and prefer the `FLARE_TOKEN` variants where your client has one.
- **Upload and download links are temporary keys.** Anyone who has one can use it until it expires, and it stays in the agent's transcript. An [export link](#export-your-account) is the largest of them: it downloads every file in your account.
- **Give each agent its own connection.** You can then cut one off without touching the others.

Everything an agent does is recorded in the instance's [audit log](/admin/audit), which administrators can read. So are connecting, changing, and disconnecting an agent.

## Disconnect an agent

For an agent that signed in, choose **Disconnect** on its entry under [**Connected agents**](#manage-connected-agents) in **Profile → Integrations**.

For an agent connected with a token, find its token under **API tokens** and choose **Revoke**.

<div style="max-width: 446px; margin-inline: auto">
<Screenshot src="/screenshots/agents/token-agent-access.webp" alt="Claude Code token in the API tokens list, not used yet, with an expiry date, a Revoke button, and chips for Agent access, Upload files, Read files, Read file contents and Read short links" caption="Revoke disconnects the agent that uses this token." />
</div>

Either way the agent is cut off on its next call, and upload and download links it was given stop working at once.

Then remove the server from the client, so it stops trying to connect:

```sh
claude mcp remove flare
```

```sh
codex mcp remove flare
```

For the other clients, delete the `flare` entry from the configuration file you added it to, or remove the connector in the app.

## Troubleshooting

| Symptom                                                                           | Check                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The browser shows **This sign-in cannot continue**, and the app is not registered | The client is using a registration Flare no longer has. Flare removes a registration nobody approved within 24 hours, and the client can keep the `client_id` it remembers. Remove Flare from the client and add it again, so it registers afresh.                                                                                                                                                  |
| **This sign-in cannot continue**, with another reason                             | The page says what the client sent wrong, such as an address it did not register or a missing security check. That is the client's to fix: update it, then connect again.                                                                                                                                                                                                                           |
| The client reports `Too many registrations from this address`                     | A client registers itself before its first sign-in, and one address may register 10 times an hour for each place a sign-in returns to. Wait an hour, then connect again.                                                                                                                                                                                                                            |
| The client cannot find where to sign in, or says the server offers no sign-in     | Use the **Server URL** exactly as Flare shows it. Sign-in is published for the instance's public address only, so a client that reaches Flare under another name or port is sent to an address that does not match. If the URL is right, a reverse proxy in front of Flare is not passing `/.well-known/` to it; ask whoever runs the instance to [check](/hosting/reverse-proxy#agent-sign-in).    |
| The client reports that it `refreshed its tokens too often in the last hour`      | The client renewed its access more than 30 times in an hour; a working client does it about once. It is still connected and works again within the hour. If it keeps happening, the client is renewing in a loop: update it, or disconnect it under **Connected agents** and sign in again.                                                                                                         |
| A connected agent starts reporting `401` or asks you to sign in again             | Its connection ended: you or the client disconnected it, [something signed you out everywhere](#what-else-disconnects-agents), or it was unused for 90 days. Sign in again from the client.                                                                                                                                                                                                         |
| A client with a token reports `401` or `unauthorized`                             | The token was revoked, has expired, or was copied incompletely, or it has no **Agent access** because it was made with **New token** without that box. With Codex or `.mcp.json`, check that `FLARE_TOKEN` is set in the shell that starts the client. Connect again to get a new token.                                                                                                            |
| The client reports `404` or `Not found`                                           | The MCP server is turned off on this instance, or the address is not the **Server URL**, which ends in `/api/mcp`. Ask an administrator whether it is on.                                                                                                                                                                                                                                           |
| **Profile → Integrations** has no **Agents** card                                 | The MCP server is off, or your role lacks `tokens.manage`.                                                                                                                                                                                                                                                                                                                                          |
| A tool you expect is missing                                                      | The connection was not given that action, or your role lacks the permission behind it. Add the action with **Edit permissions**, or connect again with it for a token. An [administration action](#administer-the-instance) cannot be added to an existing connection: sign the agent in again and tick it, or create a new token with it. Then restart the client so it loads the tool list again. |
| The agent says `Not allowed`                                                      | The message names the missing action or role permission and how to grant it. Add an ordinary action with **Edit permissions**; an administration action needs a new sign-in or a new token. Ask an administrator about a role permission.                                                                                                                                                           |
| The agent connects, but its upload or download links fail                         | Links are built from the instance's public address, so that address must be reachable from the computer the agent runs on. Use the **Server URL** exactly as Flare shows it. If it is wrong, an administrator has to correct the instance's public address.                                                                                                                                         |
| An upload command answers `404`                                                   | The upload URL was already used or is older than 15 minutes. Ask the agent to upload again.                                                                                                                                                                                                                                                                                                         |
| An archive call ends with a timeout after about a minute                          | The client stopped waiting before Flare finished. [Give archive calls enough time](#give-archive-calls-enough-time), then ask again.                                                                                                                                                                                                                                                                |
| The agent says `Another archive operation is running`                             | Flare runs one archive operation for your account at a time, and two at once on the instance. Nothing was created. Ask again when the other one has finished, which takes at most two minutes.                                                                                                                                                                                                      |
| An export command fails, or answers `404` or `409`                                | An export link works once, and only if the download starts within 15 minutes. `409` means another download is using it. Ask the agent to export again.                                                                                                                                                                                                                                              |
| The agent says a token is bound to an upload profile                              | A token bound to an upload profile cannot change upload profiles or upload defaults, and extracts and creates archives only with that profile. Use an agent that signed in, or a token without a profile.                                                                                                                                                                                           |
| An upload command answers `413`                                                   | The file is larger than the instance allows, larger than your remaining quota, or larger than a proxy in front of Flare accepts.                                                                                                                                                                                                                                                                    |
| The agent says `Too many calls`                                                   | A connection may make 120 calls a minute. Wait a minute.                                                                                                                                                                                                                                                                                                                                            |
| Claude on desktop or the web, or ChatGPT, will not connect                        | They connect from their vendor's servers, so the instance needs a public HTTPS address they can reach. The dialog says so when the address is not one. On a private or local instance, use a client that runs on your computer, such as Claude Code or Codex.                                                                                                                                       |

For the exact rules behind each of these, see the [MCP server reference](/api/mcp).
