# flare-upload

`flare-upload` encrypts a file on your machine, uploads it to your Flare
server with a token, and prints the share link. Screenshot tools and scripts
start it after each capture.

Flare encrypts in the browser. A ShareX uploader file, an iTake uploader
file or a `curl` command describes one web request and cannot encrypt. This
program does the encryption for them
([specification](../../docs/e2ee-spec.md), sections 10.2 and 10.4).

```sh
flare-upload screenshot.png
# https://flare.example/alex/e_3kGq0v8mJtYw2nHc5sLp7A#m3Jq…
```

## Install

Download the file for your system from the
[releases page](https://github.com/FlintSH/flare/releases) of Flare. Each
binary has a `.sha256` file next to it, and `flare-upload-SHA256SUMS` lists
all of them.

| System                | File                                      |
| --------------------- | ----------------------------------------- |
| Windows, 64-bit Intel | `flare-upload-x86_64-pc-windows-msvc.exe` |
| macOS, Apple silicon  | `flare-upload-aarch64-apple-darwin`       |
| macOS, Intel          | `flare-upload-x86_64-apple-darwin`        |
| Linux, 64-bit Intel   | `flare-upload-x86_64-unknown-linux-musl`  |
| Linux, 64-bit ARM     | `flare-upload-aarch64-unknown-linux-musl` |

1. Check the download:
   `sha256sum --check flare-upload-x86_64-unknown-linux-musl.sha256`
   (macOS: `shasum -a 256 --check …`, Windows PowerShell:
   `Get-FileHash flare-upload-x86_64-pc-windows-msvc.exe`, and compare).
2. Rename it to `flare-upload` (`flare-upload.exe` on Windows).
3. Linux and macOS: `chmod +x flare-upload` and move it to a directory of
   your `PATH`, for example `~/.local/bin`. On macOS the first start of an
   unsigned program needs **System Settings → Privacy & Security → Open
   Anyway**, or `xattr -d com.apple.quarantine flare-upload`.
4. Run `flare-upload --self-test`. It checks the cryptography of the build
   on your machine against known answers and ends with `self-test passed`.

The binaries are not signed. The checksum shows that the download is the
file that the project's build made. The Flare application only links to the
releases page. It never downloads or starts a program for you.

To build it yourself you need Rust 1.99 or newer:

```sh
cd clients/flare-upload
cargo build --release --locked      # target/release/flare-upload
```

## Configure

In Flare open **Profile → Uploads → Screenshot tools and scripts**:

1. Select the upload profile that the tool uses.
2. Select **Create configuration**. Flare makes a new upload token for this
   configuration and shows it only now.
3. In the **flare-upload** row select **Download configuration**.

Save the file in the `flare-upload` directory of your user configuration:

| System  | Directory                                                           |
| ------- | ------------------------------------------------------------------- |
| Linux   | `~/.config/flare-upload/` (or `$XDG_CONFIG_HOME/flare-upload/`)     |
| macOS   | `~/Library/Application Support/flare-upload/`                       |
| Windows | `%APPDATA%\flare-upload\` (paste it in the address bar of Explorer) |

`config.json` in that directory is the default. A configuration for a
named profile downloads as `<profile-name>.json`; select it with
`--use <profile-name>`, or rename it to `config.json` if it is your only
one. The file holds your token: on Linux and macOS run
`chmod 600 <file>`. The program warns if other users can read it.

```json
{
  "format": "flare-upload-config",
  "version": 1,
  "origin": "https://flare.example",
  "token": "flr_…",
  "protocol_version": 1,
  "account_public_key": "…",
  "profile_id": "…",
  "encryption": "encrypted"
}
```

| Field                | Meaning                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `origin`             | The address of the server. `https://` only; `http://` is accepted for `localhost`.                         |
| `token`              | The upload token of this configuration. `FLARE_UPLOAD_TOKEN` or `--token-file` can supply it instead.      |
| `protocol_version`   | The protocol version of the configuration. The program refuses a version it does not know.                 |
| `account_public_key` | The public key of your account, pinned when you made the configuration. Files are encrypted to it.         |
| `profile_id`         | The upload profile. `null` follows the default profile of the account.                                     |
| `encryption`         | `encrypted` or `plain`. It must agree with the **Encryption** setting of the profile; the server checks.   |
| `folder_id`          | Optional. The folder that uploads go to.                                                                   |
| `folder_public_key`  | Optional. The public key of that folder, for the folder stanza of a public file. Needs `visibility`.       |
| `visibility`         | Optional. `PUBLIC` or `PRIVATE`. A token bound to a profile cannot send a value the profile does not have. |
| `expiration`         | Optional. `DISABLED`, `HOUR`, `DAY`, `WEEK` or `MONTH`, with the same limit.                               |

The file has no private key, and the program has no option that takes one.

## Use

```
flare-upload [options] <file>...
```

Each link is printed on its own line on standard output. Warnings and
errors go to standard error.

| Option                                                               | Effect                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `-c`, `--config <path>`                                              | A configuration file at any path.                                                                   |
| `--use <name>`                                                       | The configuration `<name>.json` in the default directory.                                           |
| `--copy`                                                             | Copy the links to the clipboard (`clip` on Windows, `pbcopy` on macOS, `wl-copy`, `xclip`, `xsel`). |
| `--open`                                                             | Open the first link in the browser.                                                                 |
| `--json`                                                             | Print one JSON object in place of the links.                                                        |
| `--password`                                                         | Protect the link with a password. The program asks for it, or reads `FLARE_UPLOAD_PASSWORD`.        |
| `--name <name>`                                                      | The name of the upload, for one file or for standard input.                                         |
| `--mode`, `--visibility`, `--expiration`, `--origin`, `--token-file` | Replace a value of the configuration for one run.                                                   |
| `-q`, `--quiet`                                                      | No warnings.                                                                                        |
| `--self-test`                                                        | Check the cryptography of this build and exit.                                                      |

A file name of `-` reads standard input, which the program holds in memory
(at most 512 MiB). A file is read in chunks of 64 KiB and is never in
memory as a whole.

A token in an argument is refused: other users of a machine can read the
arguments of a process.

| Exit code | Meaning                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| 0         | Uploaded.                                                                                                        |
| 1         | An upload failed: the file, the network, or a refusal such as a size limit.                                      |
| 2         | The arguments or the configuration are not valid.                                                                |
| 3         | The configuration is old. The account keys were rotated, or the token was revoked. Download a new configuration. |
| 4         | The protocol version is not accepted. Update `flare-upload`.                                                     |
| 5         | A setting of the server refused the upload: the profile's Encryption setting, or plain uploads are forbidden.    |

### What an encrypted upload does and does not do

The program makes a random key for the file, encrypts the content in 64 KiB
chunks, seals the name and the type, and encrypts the file key to your
account public key. With `--password` it also makes a password stanza: the
link then carries a second secret, and the recipient needs both.

It does not recognize text in images, does not make a thumbnail and does
not apply your automatic tag rules: those need keys that only your browser
has. It tells the server so, and your browser does this work the next time
you open your library.

## ShareX on Windows

A ShareX custom uploader (`.sxcu`) describes one web request, so it can
only upload plain files. For encrypted uploads ShareX starts `flare-upload`
as an **action** after each capture.

1. Put `flare-upload.exe` in a folder you keep, for example
   `%LOCALAPPDATA%\Programs\flare-upload\`.
2. Save the configuration as `%APPDATA%\flare-upload\config.json`, or as
   `%APPDATA%\flare-upload\<name>.json` if you have several.
3. In ShareX open **Task settings → Actions** and select **Add**:
   - **Name:** `Flare`
   - **File path:** select `flare-upload.exe` with the browse button
   - **Arguments:** `--copy "$input"`, or `--use <name> --copy "$input"`
     for a named configuration
   - Turn on **Hidden window**
4. Tick the new action in the list of actions.
5. In the ShareX main window open **After capture tasks**. Turn on **Save
   image to file** and **Perform actions**. Turn off **Upload image to
   host**, or ShareX also sends the capture to its own destination.

After a capture the link is on your clipboard. Flare's Upload tools card
shows these values, with the name of your configuration, under **Set up
ShareX**.

What ShareX cannot do with an action:

- It does not read the link that the action prints. The ShareX history, its
  "upload completed" notification and its **After upload tasks** (copy URL,
  open URL, shorten URL, show QR code) do not have the link. `--copy` and
  `--open` of `flare-upload` replace the first two.
- It shows no progress and no error of the action. If no link arrives, turn
  off **Hidden window** once, or run the same command in a terminal, to
  read the message.
- An action receives a file. **Upload text**, **Upload from clipboard** and
  **Upload from URL** still go to the ShareX destination, not through
  `flare-upload`.
- It keeps the captured file where ShareX saves it. That copy is not
  encrypted.

These steps follow the settings of ShareX 15 and later. The authors of this
file did not run them on Windows: the program is built and tested on
Windows in CI, and the steps come from the ShareX settings as documented,
not from a capture. If your ShareX names a setting differently, the three
things that matter are: the action runs `flare-upload.exe`, its arguments
end with the captured file, and ShareX's own upload is off.

## Flameshot

Flare writes a script for an encrypted profile: **Screenshot tools and
scripts → Flameshot → Download script**. It captures with
`flameshot gui --raw`, starts `flare-upload`, and copies the link. By hand:

```sh
flameshot gui --raw | flare-upload --name screenshot.png --copy -
```

Bind either to a keyboard shortcut of your desktop.

## Spectacle

Use the script that Flare writes (**Spectacle → Download script**), or:

```sh
file=$(mktemp --suffix=.png)
spectacle --region --background --nonotify --output "$file" && flare-upload --copy "$file"
rm -f "$file"
```

## macOS

The screenshot tool of macOS saves a file or copies an image. To upload a
region with one shortcut:

```sh
#!/bin/sh
file="${TMPDIR:-/tmp}/flare-capture-$$.png"
screencapture -i "$file" && [ -s "$file" ] && flare-upload --copy "$file"
rm -f "$file"
```

Save it as a script, then add a **Run Shell Script** action for it in the
Shortcuts app (or an Automator Quick Action) and give it a keyboard
shortcut. A tool that can run a program after a capture can call
`flare-upload --copy <file>` directly.

iTake reads a declarative uploader file and cannot start a program, so it
uploads plain files only. Use an upload profile set to **Plain** for it.

## Any shell

```sh
flare-upload report.pdf                      # print the link
flare-upload --copy *.png                    # several files, links on the clipboard
flare-upload --password contract.pdf         # asks for a password, prints a #p. link
tar cz notes/ | flare-upload --name notes.tar.gz -
link=$(flare-upload --quiet shot.png) || echo "failed with $?"
flare-upload --json a.png | jq -r '.uploads[0].url'
```

## Plain uploads

A configuration for a profile whose **Encryption** is **Plain** has
`"encryption": "plain"`. The program then uploads the file as it is, as
Flare's declarative configurations do, and prints the address that the
server gives. The server and its administrators can read a plain file, and
its link can show a preview on other sites. An administrator can forbid
plain uploads for a server; the program then exits with code 5.

## Security notes

- **The link is the key.** The part after `#` is the key of the file (or,
  with a password, a secret that is needed together with the password).
  Anyone who has the link can read the file until you delete it or make it
  private. A browser does not send that part to the server, and this
  program never puts it in a request. `--copy` puts it on your clipboard,
  where clipboard managers can keep it.
- **The program holds no private key.** It encrypts to the public key of
  your account. It cannot read your library and cannot decrypt what it
  uploaded. A stolen configuration lets a person upload to your account
  until you revoke its token in Flare (**Profile → Integrations**); it does
  not let them read anything.
- **The account public key is pinned.** It comes from the configuration,
  which your unlocked browser wrote. The program never asks the server for
  it, so a compromised server cannot give it a key of its own
  (specification, sections 3.3 and 10.2). Protect the configuration file
  from changes as you protect it from readers.
- **Uploads are not authenticated as yours.** Anyone who knows your account
  public key can make a file that decrypts correctly, and the server always
  knows that key. A file in your library proves that someone with a valid
  upload token sent it, not that you made it (specification, section 3.3,
  limit 2).
- **After a key rotation** (a passphrase change is one) the server cancels
  each token and refuses a file that is encrypted to the old key. The
  program exits with code 3. Download a new configuration.
- **What the server sees:** the size of the ciphertext, the time, your
  address, the upload profile and the folder. Not the name, the type or the
  content.
- **The password of `--password`** is stretched with Argon2id (64 MiB, 3
  passes) on your machine and never sent. The program warns about a weak
  password and does not refuse it: the browser application enforces the
  strength rule, this program does not include its word lists.
- The temporary files of a screenshot tool are not encrypted. The scripts
  that Flare writes remove them after the upload.

## Development

```sh
cargo test                       # unit tests, shared vectors, mock server, the built binary
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

- `tests/vectors.rs` loads `lib/e2ee/vectors/v1.json`, the test vectors
  that an independent reference program made from the specification, and
  checks every vector of every procedure a script client performs (100 of
  137), including the vectors that must be rejected. The 37 others belong
  to procedures that need the account private key or the passphrase; the
  test lists each with its reason and fails on a procedure it does not
  know.
- `tests/ed2curve_cross_check.rs` compares the key conversion, written
  from section 4.4 with its own field arithmetic, against curve25519-dalek.
- `tests/mock_server.rs` runs the program against a server in the test
  process, checks each request against
  [SERVER-CONTRACT.md](SERVER-CONTRACT.md), decrypts what arrived with the
  private key of a test account, and searches every recorded byte for the
  name, the content, the file key and the link fragment.
- `scripts/e2ee/verify-script-upload.cjs` in the repository root runs the
  release binary against a real Flare server and opens each printed link
  in a browser.

The library can decrypt (a file, a stanza with a given private key), for
these tests and for `--self-test`. The command line cannot.

Every dependency has an exact version in `Cargo.toml`, and `Cargo.lock` is
committed; build with `--locked`. TLS is rustls with the certificate store
of the operating system. There is no OpenSSL and no `unsafe` code in this
crate.

`.github/workflows/flare-upload.yml` builds and tests on Linux (x86_64 and
aarch64, static musl), macOS (x86_64 and aarch64) and Windows (x86_64),
and keeps each binary with its SHA-256 as an artifact. Started with a
release tag, it attaches them to that release.
