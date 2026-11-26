---
title: Text and code pastes
description: Write or paste text and code in an editor that highlights it like the share page, then share it as a file with the same options as an upload.
---

# Text and code pastes

**Paste** saves text straight into Flare as a file in your library, without creating it on your device first. Use it for code snippets, configuration examples, logs, notes and small text handoffs. The editor shows your text the way recipients will see it on the share page.

<Screenshot src="/screenshots/workspace/paste.png" alt="Paste page with TypeScript code in the editor, colored, the name deploy typed with .ts shown after it, TypeScript Auto as the language, the options row and Create paste" caption="Paste, and Flare picks the language and the extension." />

## Create a paste

1. Open **Paste**. On a computer, the editor is ready to type in.
2. Paste or type your text. Flare [reads it](#flare-reads-what-you-paste): the language, a name, and anything worth a second look.
3. Check the options row under the editor. It works as on [Upload](./uploading#choose-the-options): profile, **Public** or **Private** with an optional password, expiration, folder and tags. A button with nothing set (**Profile**, **Folder**, **Tags**) has a dashed outline, and the row wraps on a phone instead of scrolling sideways.
4. Choose **Create paste**, or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac) in the editor.

Creating the paste also copies its link, so you can paste it straight into a chat or an issue. The editor stays, read-only, showing exactly what you shared, with the link, **Copied**, **Manage** and **New paste** above it. **Manage** opens the paste's [sheet](./moving-around#a-sheet-for-every-file-and-link), where you can change who can open it and when it expires; hold <kbd>Ctrl</kbd> or <kbd>⌘</kbd> to open its share page instead. A role that can't view your files gets **Open**, the share page, in its place. If the browser didn't allow the copy, for example because you switched tabs while the paste was being created, the button reads **Copy link** instead; the paste was still created once. Choose **New paste** for another. Your options stay for the next paste, except the password, which clears.

<Screenshot src="/screenshots/workspace/paste-complete.png" alt="A created paste: its link with Copied, Open and New paste above the TypeScript code it holds, described as deploy.ts, TypeScript, Public, Never expires" caption="The link is already on your clipboard, and the text stays as it was shared." />

In the editor, <kbd>Tab</kbd> indents. To move on to the next control with the keyboard, press <kbd>Esc</kbd> and then <kbd>Tab</kbd>.

Text that is only spaces or empty lines can't be created. While the paste is being created, the editor and options are locked to avoid a duplicate.

### Your draft

What you've written stays while you move around Flare: open **Files** and come back, and the text and name are still there. Reloading the page, closing the tab or signing out ends the draft, so while it has text the browser asks first, on whichever Flare page is open. A paste that finishes after you left and came back clears its own text only, not anything you typed since. Drafts are kept in the tab's memory only, never in browser storage, because pastes often hold logs, keys and other private text.

Text sent from [Upload](./uploading#upload-from-your-browser) with **Make a paste**, or [pasted on another dashboard page](./moving-around#paste-anywhere) and opened with **Open in Paste**, is added after a blank line at the end of a draft you already have, never in its place, and Flare says so. Text is never shared from another page without passing through Paste.

Earlier versions used a plain text box, offered no expiration, folder or tag choice, and lost the text when you left the page. Before this version you named the language yourself, and creating a paste replaced the text with its link.

## Flare reads what you paste

Everything here happens in your browser. Nothing about the text leaves the page until you create the paste.

- **Its language.** Flare recognizes JSON, Markdown, HTML, XML, CSS and its variants, JavaScript, TypeScript, JSX and TSX, Python, Go, Rust, Java, C, C++, PHP, SQL, YAML, TOML, INI and `.env` files, shell scripts and diffs, and colors the text to match. The language button at the right of the bar above the editor names it with **Auto**. When Flare isn't sure, as with logs, stack traces and prose, it keeps **Plain text**. Choose a language from the menu to set it yourself; **Detect automatically** at the top hands it back to Flare. While you type, Flare waits for a pause before changing its mind, so the colors don't flicker.
- **Its name.** With no name typed, the name field shows what the paste will be saved as: a Markdown paste starting with `# Release notes` becomes `release-notes.md`, an HTML page is named from its `<title>`, and anything else is `paste` with the language's extension, such as `paste.py`. Type your own name to replace it.
- **A credential.** If the text looks like it holds a private key, an access token or key from a well-known service (GitHub, GitLab, Slack, Stripe, Google, AWS, OpenAI and others, or a Flare token), a password inside an address, or lines such as `DB_PASSWORD=…`, and the paste would be public without a password, a warning under the editor names what it found, with **Add a password** and **Make private**. A password lets the people you send it to open it; private means only you can. The warning never stops you creating the paste, and its absence doesn't mean the text is safe to share.
<Screenshot src="/screenshots/workspace/paste-secret.png" alt="Paste page with an environment file detected as INI, named paste.ini, and under the editor a warning that it looks like it has a password or secret in it and anyone with the link could read it, with Add a password and Make private" caption="A credential in a public paste is pointed out before you share it." />

- **A single link.** If the whole paste is one web address, **Shorten it instead** opens [Links](./short-links) with it filled in.
- **A file.** Pasting a copied file or screenshot into the editor offers **Upload it**, which opens [Upload](./uploading) with the file waiting there until you check the options and choose **Upload**. Your draft stays as it was.

Hand-offs between pages keep the text, link or file in the tab's memory, never in the address bar.

## Choose a useful filename

A meaningful filename helps recipients and future searches. A name you type with a language's extension, such as `deploy.ts` or `notes.md`, sets the language. A name without one keeps your words and gains the language's extension, shown after what you typed: `deploy` with TypeScript is saved as `deploy.ts`. Choosing a language while a name is typed changes its extension: **Python** turns `notes.md` into `notes.py`. An ending that isn't a language, as in `report.final`, stays part of the name. **Plain text** saves as `.txt`.

The paste is saved as `text/plain`, and the share page picks the highlighting from the extension:

| Highlighting      | Extensions                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| JavaScript, JSX   | `.js`, `.mjs`, `.cjs`, `.jsx`                                                   |
| TypeScript, TSX   | `.ts`, `.mts`, `.cts`, `.tsx`                                                   |
| Web               | `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.xml`, `.svg`              |
| Data and docs     | `.json`, `.yaml`, `.yml`, `.md`, `.markdown`, `.sql`                            |
| Configuration     | `.toml`, `.ini`, `.env`, `.cfg`, `.properties`                                  |
| Shell and patches | `.sh`, `.bash`, `.zsh`, `.diff`, `.patch`                                       |
| Other languages   | `.py`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.hpp`, `.rs`, `.php`, `.go`, `.wat` |

Flare reads the last extension, in any case: `notes.MD` is Markdown and `report.final.py` is Python. Any other extension, including `.txt` and `.log`, shows plain text without coloring. Uploaded files with a code MIME type, such as `text/x-python` or `text/x-shellscript`, are highlighted by that type when it's one of the languages above. Code in other languages, such as Ruby or Kotlin, shows plain text. Earlier versions showed shell scripts, diffs, TOML and INI files as plain text too. Files with another text type, such as `text/x-csharp`, are highlighted by their extension, like a paste. The extension also helps a recipient open the download in the right application.

Markdown pastes wrap long lines to fit the screen, so they stay readable on a phone. Code, logs and other plain text keep their line breaks and scroll sideways, so columns stay aligned; the bottom edge fades while more lines follow.

The share page is read-only. HTML and Markdown shown as text/code are not a hosted website or a collaborative editor. If you need to revise the content, create a new paste and distribute its new link; **Paste** does not edit an existing file.

::: tip Review content before making it public
Logs and configuration snippets can contain passwords, access tokens, email addresses, or internal URLs. The public setting permits anyone with the link to read them. Flare's [credential warning](#flare-reads-what-you-paste) catches common shapes only; choose your intended visibility before creating the paste.
:::

## Use profiles for repeatable sharing

**Paste** uses the same [upload profiles](./upload-profiles) as other uploads. A profile can choose visibility, relative expiration and its action, randomized URL naming, share-page style, and tags. The options row starts from your default profile; pick another from its first button, or change one option for this paste.

For example, create a **One-day snippets** profile with public visibility, a one-day expiration, and **Delete file**. Select it when sharing a temporary diagnostic snippet, or choose **Deleted after 1 day** on the expiration button for a single paste. After creation, change it in the paste's sheet, under **Expires**.

## Manage pastes in your library

Find a paste by its filename in **Files**. You can download it, add tags, move it to a folder, change visibility, update password protection or expiration, and delete it.

Pastes count toward storage and are subject to upload restrictions. Library search matches filenames and saved OCR text; it does not provide full-text search across paste contents.

A private paste stays accessible only to its owner and accounts with `content.read` (including Administrator). A password does not turn a private paste into a link accessible to other users. See [sharing and privacy](./sharing).

## If creation fails

The error appears under the options and your text stays in the editor to try again. Check your connection, sign-in state, storage quota, and any instance restrictions. Your draft survives moving to another page in Flare but not a reload, so copy text you need to keep before reloading.

If the request's outcome is unclear, check **Files** before submitting again. A request that reached the server but lost its response may already have created the paste.

A password that breaks the rule turns the visibility button into **Check password**, and **Create paste** waits until you correct or remove it.

## If Paste is missing

Creating pastes requires both `pastes.create` and `files.upload`. Pastes are files owned by your account and follow its sharing, storage, size, and expiration policies. Your [roles](/admin/roles) can enable ordinary uploads without enabling paste creation.
