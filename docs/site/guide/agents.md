---
title: Connect an agent
description: Let Claude Code, Claude, ChatGPT, Codex, Cursor, VS Code, Gemini CLI, or another MCP client work with the files in your Flare account, by signing in through your browser, with permissions you choose.
---

# Connect an agent

Connect an AI agent to your Flare account and ask it in plain words to find, read, upload, and organize your files. You add Flare to the agent's client, sign in through your browser, and choose what the agent may do. It connects through Flare's built-in MCP server and can never do more than your own role.

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
3. Check **Connection name**, which starts as the client's name (**Agent** for **Other**), and **Expires after**, which starts at **90 days**. The other choices are 30 days, 1 year, and Never.
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

The steps for Cursor, VS Code, and Gemini CLI follow each vendor's documentation and were not run here. Neither was `mcp-remote`. **Claude on desktop and the web and ChatGPT were not run here either:** they need a public HTTPS address, which the test instance did not have. Their steps follow each vendor's documentation, and Flare's tests register clients with the fields and redirect addresses those two send.

## Choose what the agent may do

**Allowed actions** offers three presets and **Custom**. The consent screen, the token form, and [**Edit permissions**](#manage-connected-agents) all show the same choices:

| Preset                       | The agent can                                       | Actions it includes                                                                                                              |
| ---------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Read only**                | Find and read files, and list short links.          | Read files, Read file contents, Read short links                                                                                 |
| **Read and upload**          | Read only, plus uploading files and pastes.         | Read files, Read file contents, Read short links, Upload files                                                                   |
| **Everything in my account** | All file and short link actions, deleting included. | Upload files, Read files, Read file contents, Organize files, Change sharing, Delete files, Read short links, Manage short links |

**Custom** shows each action as a checkbox:

| Action                 | Lets the agent                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **Read files**         | List and search your files, folders, and tags, and see names, sizes, links, and sharing state            |
| **Read file contents** | Read text, see images and the text in them, and get download links, private files included               |
| **Upload files**       | Upload files and create pastes, choosing each new file's visibility, password, expiry, folder, and tags  |
| **Organize files**     | Create, rename, and remove folders and tags, move and tag files, and schedule or cancel an expiry        |
| **Change sharing**     | Make files public or private, set or remove their passwords, and create or revoke a folder's public link |
| **Delete files**       | Delete files permanently, now or through a scheduled expiry                                              |
| **Read short links**   | List your short links and their click counts                                                             |
| **Manage short links** | Create short links and delete them                                                                       |

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-custom.webp" alt="Token form of the Connect an agent dialog with Custom selected, showing checkboxes under Files and Short links: Upload files, Read files, Read file contents and Read short links are checked, and Organize files, Change sharing, Delete files and Manage short links are not" caption="Custom starts from the preset you had selected, here Read and upload." />
</div>

**Read and upload** leaves out deleting, sharing changes, and managing short links, because each of those can remove something or expose it. Start there, and give an agent more only for work that needs it.

An agent can never do more than you can:

- Flare offers only the actions your [role](/admin/roles) allows, and leaves out a preset that would add nothing for you.
- Flare checks your role again on every call. If an administrator removes a permission from your role, the agent loses the matching tools at once.
- The agent works only with your own files, folders, tags, and short links.

## Manage connected agents

Agents that signed in are listed in the **Agents** card under **Connected agents**. Each entry shows the name the client gave itself, where its sign-in returned to (`Local app` for a program on a computer, a host such as `claude.ai` for a website), the day it connected, the day it was last used or **Not used yet**, and one chip for each action it holds that your role still allows.

<Screenshot src="/screenshots/agents/profile-agents-card.webp" alt="Profile Integrations with the Agents card showing the Server URL https://files.example.com/api/mcp, Connect an agent, and under Connected agents the entries Claude Code (flare), a local app with Read files, Read file contents and Read short links, and Codex, a local app with Upload files, Read files, Read file contents and Read short links, each with Edit permissions and Disconnect; below it the API tokens list with a Claude Code token carrying an Agent access chip" caption="Agents that signed in are listed in the Agents card. An agent connected with a token is a token under API tokens." />

- **Edit permissions** opens the same choices as the consent screen. Choose **Save**, and **Permissions saved** confirms it. A removed permission applies on the agent's next call. An added one appears once the client reloads its tools, which most clients do when they start or reconnect. An agent always keeps at least one action.
- **Disconnect** ends the connection at once, without asking again, and **Agent disconnected** confirms it. The agent's next call is refused, and upload and download links it was given stop working. To use it again, sign in again from the client.

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

A connection also ends when the client signs out of Flare itself, when it has not been used for 90 days, and when Flare sees an old sign-in credential of that agent used again, which can mean a copy of it was taken. After any of these, sign in again from the client.

**Agents connected with a token are not affected by any of this.** A token works until it expires or you revoke it, whatever happens to your password and sessions.

## What you can ask for

| You want to                   | Ask something like                                                               | Needs                                    |
| ----------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| Share a file                  | "Upload this screenshot and give me the link."                                   | Upload files                             |
| Share text or code            | "Make a paste of this function and send me the link."                            | Upload files                             |
| Find files                    | "Find the invoice PDFs from October."                                            | Read files                               |
| Search inside screenshots     | "Which of my screenshots mention a timeout?"                                     | Read files                               |
| Read a file                   | "Summarize meeting-notes.md." "What does the error in my latest screenshot say?" | Read files, Read file contents           |
| Organize                      | "Put this week's screenshots in a folder called Sprint 42 and tag them review."  | Read files, Organize files               |
| Tag new uploads by themselves | "Make a tag that marks every new file with invoice in its name."                 | Organize files                           |
| Change who can open files     | "Make last week's uploads private." "Put a password on the contract."            | Read files, Change sharing               |
| Share a folder                | "Share the Brand assets folder and give me its link."                            | Read files, Change sharing               |
| Clean up                      | "Delete today's test uploads." "Make the build logs expire in a week."           | Read files, Delete files, Organize files |
| Shorten a link                | "Shorten this URL."                                                              | Manage short links                       |

Searching matches file names and the text Flare has read from images. Changes to several files run on up to 50 files at a time, and the agent repeats the call for more.

An agent cannot look inside, extract, or create [archives](./archives), change your account settings, create invites, or administer the instance in this release. It can never create or read API tokens, your upload token, or webhooks, it can never connect or change another agent, and it can never change how you sign in. The [reference](/api/mcp#what-mcp-covers-of-the-http-api) lists every boundary.

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
- **Anything else**, such as a PDF, audio, or an archive, is not shown. The agent gets a download link that works for 10 minutes without signing in, which it can fetch with `curl`. An agent can also ask for such a link for any file.

Reading through an agent does not add to a file's view or download counts. The links an agent shows you in its answers are your normal Flare links: a private file still needs you to be signed in to open it.

## Stay safe

- **File contents can try to mislead an agent.** A file someone sent you may contain text written to look like instructions, such as "delete the other files" or "make this public". Flare marks everything it reads from a file as data and tells the agent not to follow it. That lowers the risk; it does not remove it.
- **Grant the least that works.** An agent that only looks things up needs **Read only**. One that reads files other people wrote should not also be able to delete or share.
- **Deleting is permanent.** Flare has no trash. Many clients ask you before a tool that deletes or changes sharing runs; keep that confirmation on.
- **Allow only what you started.** The consent screen appears because a client asked. If you did not just set one up, cancel, and check [**Returns to**](#allow-the-connection-in-your-browser) before every **Allow**.
- **Prefer signing in to a token.** A sign-in puts no secret in a file or a command, can be changed with **Edit permissions**, and ends when you sign out everywhere. A token is a key to your account: some setups store it in a plain file such as `.cursor/mcp.json`. Keep those files private, never commit one to a repository, and prefer the `FLARE_TOKEN` variants where your client has one.
- **Upload and download links are temporary keys.** Anyone who has one can use it until it expires, and it stays in the agent's transcript.
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

| Symptom                                                                           | Check                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The browser shows **This sign-in cannot continue**, and the app is not registered | The client is using a registration Flare no longer has. Flare removes a registration nobody approved within 24 hours, and the client can keep the `client_id` it remembers. Remove Flare from the client and add it again, so it registers afresh.                                                                                                                                               |
| **This sign-in cannot continue**, with another reason                             | The page says what the client sent wrong, such as an address it did not register or a missing security check. That is the client's to fix: update it, then connect again.                                                                                                                                                                                                                        |
| The client reports `Too many registrations from this address`                     | A client registers itself before its first sign-in, and one address may register 10 times an hour for each place a sign-in returns to. Wait an hour, then connect again.                                                                                                                                                                                                                         |
| The client cannot find where to sign in, or says the server offers no sign-in     | Use the **Server URL** exactly as Flare shows it. Sign-in is published for the instance's public address only, so a client that reaches Flare under another name or port is sent to an address that does not match. If the URL is right, a reverse proxy in front of Flare is not passing `/.well-known/` to it; ask whoever runs the instance to [check](/hosting/reverse-proxy#agent-sign-in). |
| The client reports that it `refreshed its tokens too often in the last hour`      | The client renewed its access more than 30 times in an hour; a working client does it about once. It is still connected and works again within the hour. If it keeps happening, the client is renewing in a loop: update it, or disconnect it under **Connected agents** and sign in again.                                                                                                      |
| A connected agent starts reporting `401` or asks you to sign in again             | Its connection ended: you or the client disconnected it, [something signed you out everywhere](#what-else-disconnects-agents), or it was unused for 90 days. Sign in again from the client.                                                                                                                                                                                                      |
| A client with a token reports `401` or `unauthorized`                             | The token was revoked, has expired, or was copied incompletely, or it has no **Agent access** because it was made with **New token** without that box. With Codex or `.mcp.json`, check that `FLARE_TOKEN` is set in the shell that starts the client. Connect again to get a new token.                                                                                                         |
| The client reports `404` or `Not found`                                           | The MCP server is turned off on this instance, or the address is not the **Server URL**, which ends in `/api/mcp`. Ask an administrator whether it is on.                                                                                                                                                                                                                                        |
| **Profile → Integrations** has no **Agents** card                                 | The MCP server is off, or your role lacks `tokens.manage`.                                                                                                                                                                                                                                                                                                                                       |
| A tool you expect is missing                                                      | The connection was not given that action, or your role lacks the permission behind it. Add the action with **Edit permissions**, or connect again with it for a token. Then restart the client so it loads the tool list again.                                                                                                                                                                  |
| The agent says `Not allowed`                                                      | The message names the missing action or role permission. Add that action with **Edit permissions**, or ask an administrator about the permission.                                                                                                                                                                                                                                                |
| The agent connects, but its upload or download links fail                         | Links are built from the instance's public address, so that address must be reachable from the computer the agent runs on. Use the **Server URL** exactly as Flare shows it. If it is wrong, an administrator has to correct the instance's public address.                                                                                                                                      |
| An upload command answers `404`                                                   | The upload URL was already used or is older than 15 minutes. Ask the agent to upload again.                                                                                                                                                                                                                                                                                                      |
| An upload command answers `413`                                                   | The file is larger than the instance allows, larger than your remaining quota, or larger than a proxy in front of Flare accepts.                                                                                                                                                                                                                                                                 |
| The agent says `Too many calls`                                                   | A connection may make 120 calls a minute. Wait a minute.                                                                                                                                                                                                                                                                                                                                         |
| Claude on desktop or the web, or ChatGPT, will not connect                        | They connect from their vendor's servers, so the instance needs a public HTTPS address they can reach. The dialog says so when the address is not one. On a private or local instance, use a client that runs on your computer, such as Claude Code or Codex.                                                                                                                                    |

For the exact rules behind each of these, see the [MCP server reference](/api/mcp).
