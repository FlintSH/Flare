---
title: Text and code pastes
description: Turn text and code into shareable files with upload profiles, passwords, and a read-only preview.
---

# Text and code pastes

Creating pastes requires both `pastes.create` and `files.upload`. Pastes remain files owned by your account and follow its sharing, storage, size, and expiration policies. Your [roles](/admin/roles) can enable ordinary uploads without enabling paste creation.

**Paste** saves text directly into Flare without first creating a file on your device. Use it for code snippets, configuration examples, logs, notes, and small text handoffs. A paste becomes a file in your library with the same access controls as other uploads.

<Screenshot src="/screenshots/workspace/paste.png" alt="Paste form with an upload profile, text editor, filename, visibility, and password" caption="Paste your content, choose its sharing settings, and create a link." />

## Create a paste

1. Open **Paste** in the navigation.
2. Select an upload profile, or keep the current default.
3. Enter your text or code in **Content**. The character count helps you see how much you have entered; it groups thousands with commas, such as `12,345`, in every browser language.
4. Optionally enter a filename. If you leave it blank, Flare uses `paste.txt`.
5. Keep visibility from the profile or explicitly choose **Public** or **Private**.
6. Add a password if you want recipients of a public paste to unlock it.
7. Choose **Create paste**.

Whitespace-only content cannot be submitted. While the request is running, the controls are disabled to avoid duplicate submissions.

After creation, use **Copy link**, **Open paste**, or **Create another paste**. The displayed share link can also be selected and copied manually. Creating another paste clears its content, filename, and password; review the retained profile and visibility before submitting your next one.

<Screenshot src="/screenshots/workspace/paste-complete.png" alt="Paste created result with a share link and copy and open actions" caption="A completed paste gives you the same share-page link as an uploaded file." />

## Choose a useful filename

A meaningful filename helps recipients and future searches. Include an extension appropriate to the content, such as `.js`, `.py`, `.json`, `.md`, or `.txt`.

The paste form saves content as `text/plain`, and the share page picks the syntax highlighting from the extension:

| Highlighting    | Extensions                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| JavaScript, JSX | `.js`, `.mjs`, `.cjs`, `.jsx`                                                   |
| TypeScript, TSX | `.ts`, `.mts`, `.cts`, `.tsx`                                                   |
| Web             | `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.xml`, `.svg`              |
| Data and docs   | `.json`, `.yaml`, `.yml`, `.md`, `.markdown`, `.sql`                            |
| Other languages | `.py`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.hpp`, `.rs`, `.php`, `.go`, `.wat` |

Flare reads the last extension, in any case: `notes.MD` is Markdown and `report.final.py` is Python. Any other extension, including `.txt` and `.log`, shows plain text without coloring. Uploaded files with a code MIME type, such as `text/x-python`, are highlighted by that type when it's one of the languages above. Code in other languages, such as shell scripts, Ruby or TOML, shows plain text. Files with another text type, such as `text/x-csharp`, are highlighted by their extension, like a paste. The extension also helps a recipient open the download in the right application.

Markdown pastes wrap long lines to fit the screen, so they stay readable on a phone. Code, logs and other plain text keep their line breaks and scroll sideways, so columns stay aligned; the bottom edge fades while more lines follow.

The viewer is read-only. HTML and Markdown shown as text/code are not a hosted website or a collaborative editor. If you need to revise the content, create a new paste and distribute its new link; the paste form does not edit an existing file.

::: tip Review content before making it public
Logs and configuration snippets can contain passwords, access tokens, email addresses, or internal URLs. The public setting permits anyone with the link to read them. Choose your intended visibility before creating the paste.
:::

## Use profiles for repeatable sharing

The paste form uses the same [upload profiles](./upload-profiles) as other uploads. A profile can choose visibility, relative expiration and its action, randomized URL naming, share-page style, and tags.

There is no separate expiration picker on the paste form. To create pastes with a recurring lifetime, choose a profile that defines it. After creation, you can adjust the individual paste under **Files → file menu → Manage expiration**.

For example, create a **One-day snippets** profile with public visibility, a one-day expiration, and **Delete file**. Select it when sharing a temporary diagnostic snippet. For a retained private archive, use private visibility and disable expiration.

Pastes start unfiled because the paste form has no folder selector. Move the saved paste to a folder from the library afterward.

## Manage pastes in your library

Find a paste by its filename in **Files**. You can download it, add tags, move it to a folder, change visibility, update password protection or expiration, and delete it.

Pastes count toward storage and are subject to upload restrictions. [Library search](./search) finds pastes by their contents as well as their names: Flare reads the first 1 MiB of each paste in the background after you save it.

A private paste stays accessible only to its owner and accounts with `content.read` (including Administrator). A password does not turn a private paste into a link accessible to other users. See [sharing and privacy](./sharing).

## If creation fails

The error stays beside the form and your text remains available to retry. Check your connection, sign-in state, storage quota, and any instance restrictions. Before leaving the page or reloading, copy content you need to keep: the form is not a persistent drafts system.

If the request's outcome is unclear, check **Files** before submitting again. A request that reached the server but lost its response may already have created the paste.
