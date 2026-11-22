---
title: Text and code pastes
description: Write or paste text and code in an editor that highlights it like the share page, then share it as a file with the same options as an upload.
---

# Text and code pastes

**Paste** saves text straight into Flare as a file in your library, without creating it on your device first. Use it for code snippets, configuration examples, logs, notes and small text handoffs. The editor shows your text the way recipients will see it on the share page.

<Screenshot src="/screenshots/workspace/paste.png" alt="Paste page with an editor showing TypeScript code with line numbers and highlighting, deploy.ts as the filename, TypeScript in the language menu, the options row and Create paste" caption="Write or paste, name the file, check the options and create the paste." />

## Create a paste

1. Open **Paste**. On a computer, the editor is ready to type in.
2. Type or paste your text.
3. Optionally name the file in the bar above the editor. Left empty, it's saved as `paste.txt`. To highlight code, choose its language from the menu at the right of that bar, or type a name with its extension, such as `deploy.ts`.
4. Check the options row under the editor. It works as on [Upload](./uploading#choose-the-options): profile, **Public** or **Private** with an optional password, expiration, folder and tags.
5. Choose **Create paste**, or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac) in the editor.

The finished paste shows its name, its language, visibility and expiration, and its link with **Copy link** and **Open**. Choose **New paste** for another. Your options stay for the next paste, except the password, which clears.

<Screenshot src="/screenshots/workspace/paste-complete.png" alt="A created paste named deploy.ts, described as TypeScript, Public, Never expires, with its link, Copy link, Open and New paste" caption="A paste gets the same kind of share link as an uploaded file." />

In the editor, <kbd>Tab</kbd> indents. To move on to the next control with the keyboard, press <kbd>Esc</kbd> and then <kbd>Tab</kbd>.

Text that is only spaces or empty lines can't be created. While the paste is being created, the editor and options are locked to avoid a duplicate.

### Your draft

What you've written stays while you move around Flare: open **Files** and come back, and the text and name are still there. Reloading the page, closing the tab or signing out ends the draft, and the browser asks before you leave with unsaved text. Drafts are kept in the tab's memory only, never in browser storage, because pastes often hold logs, keys and other private text.

Earlier versions used a plain text box without highlighting or line numbers, had no expiration, folder or tag choices (a profile's or the file menu afterwards), and lost the text when you left the page.

## Choose a useful filename

A meaningful filename helps recipients and future searches. The language menu and the extension are the same setting: choosing **Python** turns `notes` or `notes.md` into `notes.py` (an empty name becomes `paste.py`), and typing `notes.md` switches the menu to **Markdown**. An ending that isn't a language, as in `report.final`, stays part of the name. **Plain text** saves as `.txt`.

The paste is saved as `text/plain`, and the share page picks the highlighting from the extension:

| Highlighting    | Extensions                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| JavaScript, JSX | `.js`, `.mjs`, `.cjs`, `.jsx`                                                   |
| TypeScript, TSX | `.ts`, `.mts`, `.cts`, `.tsx`                                                   |
| Web             | `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.xml`, `.svg`              |
| Data and docs   | `.json`, `.yaml`, `.yml`, `.md`, `.markdown`, `.sql`                            |
| Other languages | `.py`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.hpp`, `.rs`, `.php`, `.go`, `.wat` |

Flare reads the last extension, in any case: `notes.MD` is Markdown and `report.final.py` is Python. Any other extension, including `.txt` and `.log`, shows plain text without coloring. Uploaded files with a code MIME type, such as `text/x-python`, are highlighted by that type when it's one of the languages above. Code in other languages, such as shell scripts, Ruby or TOML, shows plain text. Files with another text type, such as `text/x-csharp`, are highlighted by their extension, like a paste. The extension also helps a recipient open the download in the right application.

Markdown pastes wrap long lines to fit the screen, so they stay readable on a phone. Code, logs and other plain text keep their line breaks and scroll sideways, so columns stay aligned; the bottom edge fades while more lines follow.

The share page is read-only. HTML and Markdown shown as text/code are not a hosted website or a collaborative editor. If you need to revise the content, create a new paste and distribute its new link; **Paste** does not edit an existing file.

::: tip Review content before making it public
Logs and configuration snippets can contain passwords, access tokens, email addresses, or internal URLs. The public setting permits anyone with the link to read them. Choose your intended visibility before creating the paste.
:::

## Use profiles for repeatable sharing

**Paste** uses the same [upload profiles](./upload-profiles) as other uploads. A profile can choose visibility, relative expiration and its action, randomized URL naming, share-page style, and tags. The options row starts from your default profile; pick another from its first button, or change one option for this paste.

For example, create a **One-day snippets** profile with public visibility, a one-day expiration, and **Delete file**. Select it when sharing a temporary diagnostic snippet, or choose **Deleted after 1 day** on the expiration button for a single paste. After creation, you can adjust the paste under **Files → file menu → Manage expiration**.

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
