---
title: Connect an agent
description: Let Claude Code, Codex, Cursor, VS Code, Gemini CLI, or another MCP client work with the files in your Flare account, with permissions you choose.
---

# Connect an agent

Connect an AI agent to your Flare account and ask it in plain words to find, read, upload, and organize your files. It connects through Flare's built-in MCP server and can do only what you allow, never more than your own role.

## Before you start

- **An administrator has turned on the MCP server.** Until then, **Profile → Integrations** shows no **Agents** card. Administrators turn it on in [Settings → Access](/admin/agents).
- **Your role has `tokens.manage`.** Every account has it unless an administrator removed it from Everyone.
- **Your client connects with a token.** Claude Code, Codex, Cursor, VS Code, Gemini CLI, and any other client that can send a request header do. The [Claude and ChatGPT apps](#claude-and-chatgpt-apps) cannot connect yet.

## Connect your client

1. Open **Profile → Integrations**. In the **Agents** card, choose **Connect an agent**.
2. Under **Client**, pick your client.
3. Under **Allowed actions**, [choose what the agent may do](#choose-what-the-agent-may-do). **Read and upload** is selected to begin with.
4. Check **Connection name**, which starts as the client's name (**Agent** for **Other**), and **Expires after**, which starts at **90 days**. The other choices are 30 days, 1 year, and Never.
5. Choose **Create token**. Flare creates a token for the agent and shows the steps for your client with the token already filled in.
6. Follow the steps, then choose **Done**.

[Watch the recorded walkthrough](/demos#connect-an-agent), which ends by revoking the token again.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-dialog.webp" alt="Connect an agent dialog with Claude Code selected under Client, Read and upload selected under Allowed actions, the connection name Claude Code, and Expires after set to 90 days" caption="Pick the client and what the agent may do, then create its token." />
</div>

::: details The same dialog on a phone

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-dialog-mobile.webp" alt="Connect an agent dialog on a 390-pixel phone screen, with the client choices wrapped over three rows, the four choices under Allowed actions stacked, and Create token above Cancel" caption="On a phone the choices stack, and the rest of the form scrolls inside the dialog." />
</div>

:::

The token is shown only this once. Copy what you need before you close the dialog: under **Other ways to set it up** it also offers a configuration file for your client and the token on its own. If you lose it, [revoke it](#disconnect-an-agent) and connect again.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-steps.webp" alt="Connect Claude Code dialog with two numbered steps, the claude mcp add command with its token blurred, the claude mcp list command, each with a copy button, and a collapsed Other ways to set it up section" caption="The steps for Claude Code on a local demonstration instance. The token is blurred in this screenshot." />
</div>

Below, `https://files.example.com/api/mcp` stands for your **Server URL** and `flr_YOUR_TOKEN` for your token. The dialog fills in both.

### Claude Code

Run this in a terminal, in the project you want to use Flare from. Add `--scope user` to use it in every project.

```sh
claude mcp add --transport http flare https://files.example.com/api/mcp --header "Authorization: Bearer flr_YOUR_TOKEN"
```

Check that `flare` is listed as connected:

```sh
claude mcp list
```

To share the setup with a project, put this in `.mcp.json` instead. It reads the token from `FLARE_TOKEN`, so the file holds no secret:

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

### Codex

Run this in a terminal:

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

### Cursor

In the dialog, choose **Add to Cursor** on the computer that runs Cursor, then confirm the install in Cursor. The link contains the token and hands it to Cursor, so it is not shown here. Do not share it.

To set it up by hand, put this in `.cursor/mcp.json` in a project, or in `~/.cursor/mcp.json` for every project:

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

In the dialog, choose **Add to VS Code** on the computer that runs VS Code, then confirm the install in VS Code. The link contains the token and hands it to VS Code, so it is not shown here. Do not share it.

From a terminal:

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

### Gemini CLI

Run this in a terminal:

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

Send this header with every request:

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

### Claude and ChatGPT apps

Claude on desktop and the web, and ChatGPT, cannot connect yet. They connect from their vendor's servers and sign in through your browser instead of using a token, and this release has no browser sign-in. When it arrives it will also need your instance to have a public HTTPS address. Claude Code and Codex work today.

<div style="max-width: 576px; margin-inline: auto">
<Screenshot src="/screenshots/agents/connect-unavailable.webp" alt="Connect an agent dialog with Claude selected and a notice that Claude on desktop and the web cannot connect yet because it signs in through the browser, and that Claude Code works today" caption="The dialog says so when you pick one of them, and offers no token." />
</div>

### Tested clients

Two clients were exercised end to end against a local instance on 2026-11-21, with a model making real tool calls through the client:

- **Claude Code 2.1.325**, connected with the `claude mcp add` command above. It looked up the account, uploaded text from the conversation, uploaded a file from disk through an upload URL and `curl`, searched, read text and an image back, and deleted.
- **Codex CLI 0.169.0**. It looked up the account, uploaded text, and read it back. It stopped to ask for approval before deleting, because Flare marks that tool as destructive.

The steps for Cursor, VS Code, and Gemini CLI follow each vendor's documentation and were not run here. Neither was `mcp-remote`.

## Choose what the agent may do

**Allowed actions** offers three presets and **Custom**:

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
<Screenshot src="/screenshots/agents/connect-custom.webp" alt="Connect an agent dialog with Custom selected, showing checkboxes under Files and Short links: Upload files, Read files, Read file contents and Read short links are checked, and Organize files, Change sharing, Delete files and Manage short links are not" caption="Custom starts from the preset you had selected, here Read and upload." />
</div>

**Read and upload** leaves out deleting, sharing changes, and managing short links, because each of those can remove something or expose it. Start there, and connect a separate agent with more only for work that needs it.

An agent can never do more than you can:

- The dialog offers only the actions your [role](/admin/roles) allows, and leaves out a preset that would add nothing for you.
- Flare checks your role again on every call. If an administrator removes a permission from your role, the agent loses the matching tools at once.
- The agent works only with your own files, folders, tags, and short links.

A connected agent appears under **API tokens** with an **Agent access** chip and one chip for each action. A token's actions cannot be edited afterwards. To change them, revoke the token and connect the agent again.

<Screenshot src="/screenshots/agents/profile-agents-card.webp" alt="Profile Integrations with the Agents card showing the Server URL and Connect an agent, and below it the API tokens list with a Claude Code token carrying Agent access, Upload files, Read files, Read file contents and Read short links chips above three other tokens" caption="The Agents card, and the token each connected agent gets under API tokens." />

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

An agent cannot look inside, extract, or create [archives](./archives), change your account settings, create invites, or administer the instance in this release. It can never create or read API tokens, your upload token, or webhooks, and it can never change how you sign in. The [reference](/api/mcp#what-mcp-covers-of-the-http-api) lists every boundary.

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

Small content can go through the conversation instead: up to 256 KB of text, such as a note or a code file the agent just wrote, or 64 KB of binary data. A client that cannot run commands can upload only that way.

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
- **The token is a key to your account.** Some setups store it in a plain file such as `.cursor/mcp.json`. Keep those files private, never commit one to a repository, and prefer the `FLARE_TOKEN` variants where your client has one.
- **Upload and download links are temporary keys.** Anyone who has one can use it until it expires, and it stays in the agent's transcript.
- **Give each agent its own connection**, with an expiry. You can then cut one off without touching the others.

Everything an agent does is recorded in the instance's [audit log](/admin/audit), which administrators can read.

## Disconnect an agent

In **Profile → Integrations**, find the agent's token under **API tokens** and choose **Revoke**. The agent is cut off on its next call, and upload and download links it was given stop working at once.

<div style="max-width: 446px; margin-inline: auto">
<Screenshot src="/screenshots/agents/token-agent-access.webp" alt="Claude Code token in the API tokens list, not used yet, with an expiry date, a Revoke button, and chips for Agent access, Upload files, Read files, Read file contents and Read short links" caption="Revoke disconnects the agent that uses this token." />
</div>

Then remove the server from the client, so it stops trying to connect:

```sh
claude mcp remove flare
```

```sh
codex mcp remove flare
```

For the other clients, delete the `flare` entry from the configuration file you added it to.

Signing out of your browser sessions and changing your password do not disconnect agents. Revoke their tokens.

## Troubleshooting

| Symptom                                                    | Check                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The client reports `401` or `unauthorized`                 | The token was revoked, has expired, or was copied incompletely, or it has no **Agent access** because it was made with **New token** without that box. With Codex or `.mcp.json`, check that `FLARE_TOKEN` is set in the shell that starts the client. Connect again to get a new token. |
| The client reports `404` or `Not found`                    | The MCP server is turned off on this instance, or the address is not the **Server URL**, which ends in `/api/mcp`. Ask an administrator whether it is on.                                                                                                                                |
| **Profile → Integrations** has no **Agents** card          | The MCP server is off, or your role lacks `tokens.manage`.                                                                                                                                                                                                                               |
| A tool you expect is missing                               | The connection was not given that action, or your role lacks the permission behind it. Connect again with the action included. After a role change, restart the client so it loads the tool list again.                                                                                  |
| The agent says `Not allowed`                               | The message names the missing action or role permission. Connect again with that action, or ask an administrator about the permission.                                                                                                                                                   |
| The agent connects, but its upload or download links fail  | Links are built from the instance's public address, so that address must be reachable from the computer the agent runs on. Use the **Server URL** exactly as Flare shows it. If it is wrong, an administrator has to correct the instance's public address.                              |
| An upload command answers `404`                            | The upload URL was already used or is older than 15 minutes. Ask the agent to upload again.                                                                                                                                                                                              |
| An upload command answers `413`                            | The file is larger than the instance allows, larger than your remaining quota, or larger than a proxy in front of Flare accepts.                                                                                                                                                         |
| The agent says `Too many calls`                            | A connection may make 120 calls a minute. Wait a minute.                                                                                                                                                                                                                                 |
| Claude on desktop or the web, or ChatGPT, will not connect | They are not supported until browser sign-in ships. Use Claude Code or Codex.                                                                                                                                                                                                            |

For the exact rules behind each of these, see the [MCP server reference](/api/mcp).
