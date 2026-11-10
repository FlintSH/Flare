---
title: Screenshot tools and scripts
description: Set up ShareX, Flameshot, Spectacle, iTake or a shell upload with flare-upload, the program that encrypts on your machine.
---

# Screenshot tools and scripts

Capture, upload, and copy a link without opening your browser. **Profile → Uploads → Screenshot tools and scripts** writes what each tool needs.

The card requires both `tokens.manage` and `files.upload`. Your account's [roles](/admin/roles) apply to every configuration you already installed: removing upload permission stops its uploads without changing the token.

<Screenshot src="/screenshots/preferences/profile-upload-tools.png" alt="The Screenshot tools and scripts card with a configuration ready for an encrypted profile: flare-upload, ShareX, iTake, Flameshot, Spectacle and Bash rows" caption="A configuration for an encrypted profile. Every tool starts flare-upload; iTake cannot start a program, so it is not offered." />

## How a tool uploads

Flare [encrypts files on your device](./encryption). A screenshot tool cannot do that by itself: a ShareX or iTake uploader file, or a `curl` command, describes one web request. So an encrypted upload goes through **flare-upload**, a small command-line program that encrypts the file on your machine, uploads it with a token, and prints the share link with the key after `#`. Your tool starts it after each capture.

What a tool can do depends on the **Encryption** setting of its [upload profile](./upload-profiles#encryption):

| Profile                 | What uploads                                                                                          | What Flare writes                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Encrypted** (default) | `flare-upload`. The server stores ciphertext and cannot read the file or its name.                    | The flare-upload configuration, ShareX action settings, and scripts that start it.  |
| **Plain**               | The tool's own request. The server can read the file, and its link can show a preview on other sites. | The declarative files as before: ShareX `.sxcu`, iTake `.itup`, and `curl` scripts. |

Formats that cannot encrypt are not offered for an encrypted profile. The card says so on the row: an uploader file describes one web request and cannot encrypt or start a program.

## Create a configuration

1. Open **Profile → Uploads → Screenshot tools and scripts**.
2. Choose the **Upload profile**. **Follow my default profile** uses whichever profile is your default at upload time. The badge shows whether the configuration will be **Encrypted** or **Plain**.
3. Optionally choose a **Folder** for the uploads.
4. Select **Create configuration**. For an encrypted profile your encryption keys must be unlocked: the configuration pins your account's public key from this browser.
5. Download what your tools need from the rows below.

Each configuration gets its own upload token, named **Upload tools: profile name** and bound to that profile. Flare shows the token only now, inside the files you download. Leave the page and the downloads turn off again; create another configuration if you need more files. You can revoke a configuration's token at any time in [Integrations](./account#integrations-and-connected-tools).

::: warning The files contain your upload token
Keep the configuration and any script with a token private. Do not commit them or attach them to a support request. A person with the token can upload to your account until you revoke it. They cannot read your files: the token is not a key.
:::

## Install flare-upload

1. Select **Get the program** in the flare-upload row. It opens the [releases page](https://github.com/FlintSH/flare/releases) of Flare, where each release has the program for Windows, macOS (Apple silicon and Intel) and Linux (Intel and ARM), each with a SHA-256 file. Flare never downloads or starts a program for you.
2. Check the download against its `.sha256` file, rename it to `flare-upload` (`flare-upload.exe` on Windows), and on Linux or macOS make it executable and put it on your `PATH`.
3. Run `flare-upload --self-test`. It ends with `self-test passed`.
4. Select **Download configuration** and save the file in the flare-upload folder of your user configuration:

| System  | Folder                                                          |
| ------- | --------------------------------------------------------------- |
| Windows | `%APPDATA%\flare-upload\`                                       |
| macOS   | `~/Library/Application Support/flare-upload/`                   |
| Linux   | `~/.config/flare-upload/` (or `$XDG_CONFIG_HOME/flare-upload/`) |

The file is named after the profile, for example `work-captures.json`, or `config.json` when it follows your default profile. `config.json` is what the program reads by default; pick another with `--use work-captures`. On Linux and macOS run `chmod 600` on the file.

Then upload something:

```sh
flare-upload ./screenshot.png
# https://files.example.com/alex/e_3kGq0v8mJtYw2nHc5sLp7A#m3Jq…
flare-upload --copy ./screenshot.png         # also copies the link
flare-upload --password ./contract.pdf       # asks for a password, prints a #p. link
```

The program's own [README](https://github.com/FlintSH/flare/blob/main/clients/flare-upload/README.md) lists every option, exit code and security note.

## Automatic tags and image text for tool uploads

Your [automatic tag rules](./tags#rules-run-in-your-browser) are encrypted, so the server cannot apply them when a tool uploads a file. Tags that an [upload profile](./upload-profiles) adds are applied at once, because a profile names tags by ID. Everything that depends on a rule happens the next time you open Flare in a browser with your keys unlocked:

- the file gets the tags of the rules that match its name,
- an encrypted file gets its thumbnail, and an image gets its text read, in your browser,
- a rule on image text runs once that text exists (the server reads the text of a plain image),
- a status at the edge of the page reads **Finishing new files** while your browser works.

If Flare stays open in a tab, it picks up new uploads about once a minute and whenever you return to the tab.

## ShareX on Windows

### Encrypted profile

ShareX starts flare-upload as an **action** after it saves a capture.

1. Install flare-upload and save the configuration as described above.
2. In Flare select **Set up ShareX**. The dialog shows the values for your configuration, each with a copy button.
3. In ShareX open **Task settings → Actions** and select **Add**. Enter the **Name**, select your `flare-upload.exe` as the **File path**, and paste the **Arguments**, for example `--use work-captures --copy "$input"`. Turn on **Hidden window**, then tick the new action in the list.
4. Under **After capture tasks** turn on **Save image to file** and **Perform actions**, and turn off **Upload image to host**.
5. Take a capture. The link is on your clipboard.

<Screenshot src="/screenshots/preferences/profile-sharex-flare-upload.png" alt="The Set up ShareX dialog with the configuration file path, the action name and the arguments, each with a copy button" caption="The values to enter in a ShareX action, for the configuration you just created." />

What ShareX cannot do this way: it does not read the link that an action prints, so the ShareX history, its upload notification and its after-upload tasks (copy URL, open URL, shorten, QR code) do not have the link. `--copy` puts it on the clipboard instead; add `--open` to the arguments to open it. ShareX shows no error of an action either: if no link arrives, turn off **Hidden window** once to read the message. Text, clipboard and URL uploads of ShareX do not pass through an action. The capture that ShareX saved stays on your disk, not encrypted.

### Plain profile

Select **Download config** and open the `.sxcu` file to import it, as in earlier versions. ShareX uploads by itself and its history has the link. See the [ShareX custom uploader documentation](https://getsharex.com/docs/custom-uploader) for its destination controls.

## Flameshot on Linux

Select **Download script**, set the two switches, and download:

- **Wayland clipboard support** copies the link with `wl-copy` instead of `xsel`.
- **Hyprland compatibility** sets `XDG_CURRENT_DESKTOP=sway` before capturing. Flameshot doesn't detect Hyprland, and this is the usual workaround.

For an encrypted profile the script checks for `flameshot`, `flare-upload` and its clipboard tool, captures to a temporary file, starts flare-upload with your configuration, removes the capture, and copies the link. Its notification says **Link copied to clipboard** and does not show the link, because the link of an encrypted file is its key and a notification can stay in a history. The script holds no token: the configuration file does. Set `FLARE_UPLOAD_CONFIG` to use a configuration at another path.

For a plain profile the script uses `curl` and `jq` with the token inside it, as in earlier versions.

```sh
bash ./flare-work-captures-flameshot.sh
```

Bind the script to a desktop keyboard shortcut. Without a script, this does the same:

```sh
flameshot gui --raw | flare-upload --name screenshot.png --copy -
```

## Spectacle on KDE

Open Spectacle's **Download script** action and select **Screenshot** or **Screen recording**. Screenshot choices are full desktop, current monitor, active window, or a selected region. A recording covers a selected region or, with **Current monitor recording**, the whole screen under the pointer. The form also offers Wayland clipboard support and an option to include the mouse pointer.

The script follows the profile in the same way as the Flameshot script: `flare-upload` for an encrypted profile, `curl` and `jq` for a plain one. The dialog lists the commands it needs.

<Screenshot src="/screenshots/preferences/profile-spectacle-options.png" alt="Spectacle script configuration with screenshot and recording modes" caption="Choose the capture mode and desktop environment before downloading the Spectacle script." />

## macOS

For encrypted uploads use the screenshot tool of macOS with a short script, and bind it to a keyboard shortcut with a **Run Shell Script** action in the Shortcuts app:

```sh
#!/bin/sh
file="${TMPDIR:-/tmp}/flare-capture-$$.png"
screencapture -i "$file" && [ -s "$file" ] && flare-upload --copy "$file"
rm -f "$file"
```

[iTake](https://github.com/SerStars/iTake) reads a declarative `.itup` uploader file and cannot start a program, so it works with a **Plain** profile only. With one selected, **Set up iTake → Download config** gives the file to import, and the dialog lists the steps in iTake. For an encrypted profile the row is turned off and says why.

## Bash: upload any file

Select **Download script** in the Bash row. For an encrypted profile the script is a thin wrapper: it checks for `flare-upload`, passes your file to it, and copies the link with `wl-copy`, `xsel`, `xclip` or `pbcopy`. You can also call `flare-upload` directly. For a plain profile the script uses `curl`, `jq` and `file`.

```sh
bash ./flare-work-captures-upload.sh ./screenshot.png
```

A file larger than 8 MiB goes through Flare's chunked upload with flare-upload. The plain `curl` script sends one request.

## After the upgrade: configurations from before encryption {#old-configurations}

Earlier versions gave every account one upload token and wrote it into each download. Those configurations keep working after the upgrade, with three changes:

- **They upload plain files.** A tool with an old configuration cannot encrypt, so the server can read what it sends, whatever the profile's Encryption setting says. The same holds for a named API token created before the upgrade.
- **Flare no longer has the token.** The upgrade replaced the stored token with its hash. Nothing in Flare can show, copy or return it, and the **Manual setup and upload token** section is gone. Your installed tools still hold their copy.
- **A warning asks you to replace them.** While the old token still works, the card shows **Configurations from before encryption upload plain files**, with the day a tool last used it. Create a configuration for each tool, install it, then select **Revoke old token**. Revoking cannot be undone and stops every tool that still uses the old token. Flare does not issue that kind of token again.

<Screenshot src="/screenshots/preferences/profile-upload-tools-upgrade.png" alt="The Screenshot tools and scripts card with a warning that configurations from before encryption upload plain files, a Revoke old token button, and the downloads turned off until a configuration is created" caption="An account from before the upgrade. The old token still works until you revoke it." />

If your administrator turns on [Forbid plain uploads](/admin/#forbid-plain-uploads), old configurations stop uploading at once: they can only send plain files. A passphrase change or key rotation also revokes the old token and every named token; create new configurations afterwards.

Accounts created after the upgrade never had such a token and see no warning.

## Troubleshooting

| Symptom                                                                          | Check                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The download buttons are turned off                                              | Create a configuration first. A file needs a token, and Flare shows a token only when it makes it.                                                                               |
| **Create configuration** asks to unlock                                          | An encrypted configuration pins your account public key from this browser. Unlock with your passphrase and select it again.                                                      |
| flare-upload exits with code 3 and says to download a new configuration          | Your passphrase or keys changed, or the token was revoked. Create a new configuration and replace the file.                                                                      |
| flare-upload exits with code 5: **takes encrypted uploads** or **plain uploads** | The profile's Encryption setting changed after you made the configuration, or the file belongs to another profile. Create a new configuration.                                   |
| flare-upload exits with code 5: **accepts encrypted uploads only**               | The administrator forbids plain uploads. Use a configuration for an encrypted profile.                                                                                           |
| flare-upload exits with code 4                                                   | The server no longer accepts the program's protocol version, or the configuration is for a newer one. Download the current flare-upload.                                         |
| A script prints `No flare-upload configuration at …`                             | Save the configuration file at that path, or set `FLARE_UPLOAD_CONFIG`.                                                                                                          |
| A tool with an old configuration answers `403`                                   | Plain uploads are forbidden on the server, or the old token tried an encrypted upload. Create a new configuration.                                                               |
| A tool with an old configuration answers `401`                                   | The old token was revoked, by you or by a passphrase change. Create a new configuration.                                                                                         |
| Link was created but clipboard is empty                                          | Add `--copy`, or install the clipboard utility the script names (`xsel`, or `wl-copy` with Wayland clipboard support).                                                           |
| The link does not open the file                                                  | The part after `#` was cut off, often by a chat app or a shortener. Copy the whole link. Flare cannot recover the key.                                                           |
| The generated address uses an old host                                           | Ask the administrator to correct the instance's public URL (`NEXTAUTH_URL`), then create the configuration again.                                                                |
| The card fails with `Invalid server URL configuration`                           | The instance has no usable public address. Ask the administrator to set `NEXTAUTH_URL` to its public `http` or `https` origin, without a username, password, query, or fragment. |
| A script prints `Upload failed: Network error or invalid URL`                    | A plain script's curl could not reach Flare. Check your connection, any TLS certificate error, and the address on the script's `API_URL` line.                                   |
| Linux script exits with a missing-command error                                  | Install the command it names.                                                                                                                                                    |
