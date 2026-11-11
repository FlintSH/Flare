---
title: Folders and collections
description: Organize files and subfolders, move files in bulk, and share a folder and the folders inside it with one link. Folder names are encrypted in your browser.
---

# Folders and collections

Browsing folders uses `files.read`; creating and organizing them requires `folders.manage`. Moving existing files also needs `files.update`, and uploading into a folder also needs `files.upload`. Publishing or revoking a folder link requires `folders.share` as well as `folders.manage`. These grants come from your [roles](/admin/roles), not from membership in the folder.

Folders give a project or collection its own place while **All files** keeps your entire library available. Each file belongs to one folder or is unfiled. [Tags](./tags) work across folders when a file belongs to several topics.

Folder and file organization changes leave IDs in the [instance audit log](/admin/audit), visible to people with `audit.read` even when the folder is not shared. The log has no folder names once your folders have keys: when your browser encrypts the name of a folder from before encryption, Flare also removes that name from the audit records it wrote earlier. Database backups made before that still hold it.

Everyone initially includes folder permissions; an administrator can restrict them through roles. Creating a folder does not change file links, storage paths, visibility, or passwords.

<Screenshot src="/evidence/vault-folders/folder-desktop.jpg" alt="A folder containing files, a child folder, tags, and Share and Upload here controls" caption="Browse a project's direct files while keeping subfolders and sharing controls close by." />

## Folder names are encrypted

Each folder has a key pair that your browser makes. The folder's name is sealed with that key, and the server stores the sealed name, the folder's public key, and a copy of the private key that only your account key opens. The server does not have the name.

The server still sees the structure: which folder is inside which, which file is in which folder, how many folders you have, and whether a folder is shared.

What this changes for you:

- **Your keys must be unlocked to create, rename or share a folder.** While they are locked, each folder shows as **Encrypted folder** and the folder dialogs say to unlock. Enter your [passphrase](./passphrase) to bring the names back.
- **Folders you had before this release are converted the first time you unlock.** Your browser makes keys for each folder and seals its name, and the server then deletes the plain name. The folder keeps its ID, its files, its place in the tree and its share link. A shared link from before the conversion needs a new copy from the Share dialog, because the link now ends with the folder's key.
- **Accounts that never sign in again keep plain folder names.** The server cannot encrypt a name for you.
- **An API request cannot create or rename a folder for an account that has keys.** `POST /api/folders` with a plain `name` answers `409`. See the [API reference](../api/files#folders-with-keys).

## Create and browse folders

1. Open **Files**. On a phone with existing folders, expand **Folders** (or **Subfolders**) first, then choose **New folder**. Otherwise choose **New folder** beside the scope controls.
2. Give it a name and save.
3. Choose **Folders** and its count, then open the folder to see its direct files. Choose **Subfolders** to browse its children.
4. Choose **New folder** inside it to create a subfolder, or **Upload here** to add files.

Folder names can be up to 80 characters. Use a plain-text name without `/` or `\`; `.` and `..` are reserved. Flare trims the ends of a name and saves each run of spaces as one space; unlike a tag name, a folder name can't contain a tab or line break. Names must be distinct within the same parent, ignoring letter case, so `Photos` and `photos` can't share a parent. The same name can be useful in separate projects. Your browser checks these rules, because the server cannot compare sealed names. Two browsers that create the same name at the same moment can both succeed; rename one of the folders. Folders that [archive extraction](./archives#extract-into-your-library) creates follow the same rules.

The folder directory starts collapsed so it does not push files down the page. **Folders** or **Subfolders** expands it; choose the same control again to close it. Your choice is remembered on this device for your account and each library scope. If browser storage is unavailable, the control still works for the current visit. A long directory scrolls inside a bounded area; at its edge, scrolling continues through the page.

The current folder path, **All files**, **Unfiled**, and permitted sharing controls remain available with the directory closed. On phones with folders, the labeled **New folder** action lives inside the expanded directory. With no folders to browse, it stays beside the scope controls. Existing folders, share links, and saved folder bookmarks need no migration.

**All files** includes files from every folder. **Unfiled** includes files that do not belong to a folder. Opening a specific folder shows its direct files; open a subfolder to see the files inside that subfolder.

In **All files**, a [file card](./library#read-a-file-card) shows the name of the folder its file belongs to, beside the file's tags. Choose that name to open the folder. Inside a folder, cards leave out the folder you are viewing, which leaves room for two tags.

Search, tag filters, sorting, dates, and image browsing stay within the folder you are viewing. Its direct files use the same [continuous scrolling and date rail](./library#scroll-through-your-library) as **All files**; the rail covers only the matching files in that folder. Resetting those filters keeps the folder selected.

## Move files

For one file, open its menu and choose **Move to folder**. For several files, choose **Select**, select individual files or **Select visible files**, and choose **Move**. Pick a destination and confirm.

A selection can include up to 100 files and stays selected as you scroll. **Select visible files** adds only loaded files currently on screen, not every file in the folder. Changing the folder or filters clears the selection; finish the move first.

Choose **Unfiled** to remove files from their current folder. Moving a file preserves its share link, tags, password, visibility, and expiration.

A public encrypted file in a folder has a small record, a folder stanza, that lets the folder's share link open it. The server deletes that record when the file moves or becomes private, and your browser makes a new one for the new folder right away. A status at the edge of the page shows **Updating folder keys** while it works. If you close the tab first, the work finishes the next time you open Flare with your keys unlocked.

<Screenshot src="/screenshots/timeline/library-selection.webp" alt="A library selection retained while scrolling, with Select visible files and Move controls" caption="Select visible files, scroll to add others, then choose Move to pick a destination for the selection." />

::: tip Moving changes collection membership
When a folder has a share link, moving a public file into it adds that file to the collection. Moving it out removes it from the collection. Its separate file link continues to follow its own access settings.
:::

## Upload into the right place

- **Upload here**, beside the folder's path and in an empty folder, opens the upload page with the current folder selected. It appears only when your role has both `files.upload` and `folders.manage`, because Flare saves uploads into a folder only for roles that can manage folders. Earlier versions showed it with `files.upload` alone, and the upload then failed.
- **Save to** on the upload page lets you choose a folder when you have folders. It appears only with `folders.manage`; without it, uploads are unfiled, even from a link that opens the upload page with a folder selected. Earlier versions showed it anyway, and the upload then failed.
- Dropping files onto the library uploads them into the folder currently open when your role has `folders.manage`, and leaves them unfiled otherwise. Earlier versions tried the open folder, and the upload then failed. See [quick drag-and-drop](./uploading#quick-drag-and-drop).
- Dropping files elsewhere in the dashboard leaves them unfiled.

An empty folder's message suggests only what your role allows: uploading here, or moving existing files in, which needs `files.update` and `folders.manage`. With neither, it says your role can't add files to folders.

The destination is chosen for the upload; it is not saved inside an upload profile. If a folder is removed while an upload is running, finalization can fail instead of quietly putting the file somewhere else. Choose a valid destination and retry.

[Archive extraction](./archives#extract-into-your-library) creates a new wrapper folder inside the chosen destination and preserves the archive's subfolders. It requires `files.read`, `files.upload`, and `folders.manage`. With **Private (no profile)**, extracted files stay private even in a shared destination. Explicitly selecting an upload profile can instead publish them with that profile’s visibility and expiration; check the summary before confirming. Choosing **Unfiled** in that flow creates a top-level wrapper rather than leaving the extracted files unfiled. The server names the extracted folders from the archive, so they start with plain names; your browser seals them in the background like [folders from before this release](#folder-names-are-encrypted).

## Share a folder

Folders start private. To publish a collection:

1. Open the folder menu and choose **Share**.
2. Choose **Create share link**.
3. Copy the generated URL and send it to your recipients.
4. Review the page in a signed-out browser window to check what visitors see.

**Share** and **Share folder** appear only when your role has both `folders.share` and `folders.manage`, the permissions Flare checks when it creates or disables a link. Earlier versions showed them with `folders.share` alone, and creating or disabling the link then failed.

The shared page uses a link under `/s/folders/…`. The link ends with `#` and the folder's key:

```text
https://flare.example.com/s/folders/7fQ2…tK9#mV4c…Xw
```

Browsers do not send the part after `#`, so Flare's server never receives the key. The visitor's browser uses it to open the folder's name, the names of its files and the folders inside it. Copy the link from the Share dialog: your browser builds it from your own keys.

The page lists the folders inside the shared folder first, then up to 48 files per page. It follows changes to the collection: newly added public files appear, and files moved out or made private disappear.

::: warning A folder link now includes the folders inside it
Before this release a shared folder showed only the files directly inside it. It now shows every folder below it too, with their public files. That was always the intent, and it is how one key can open a whole tree. If you shared a folder that has subfolders, review what is in them: a public file in a subfolder is now reachable from the parent's link. Make a file private to keep it out.
:::

| What the visitor's link looks like         | What the page shows                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Complete                                   | The folder's name, its folders and its files.                                                                               |
| Cut at `#`, as some chat apps do           | **This link is missing its key**. Plain files in the folder are still listed, because they need no key.                     |
| A key that is not this folder's            | **This link does not open this folder**. Ask for the current link.                                                          |
| Opened while your browser is updating keys | **This folder is not ready yet**, for a moment after you move or re-key a folder and before your browser finished the work. |

A visitor who opens a file from the shared page sees **Back to** above the file, including on the password page of a locked tile, to return to the listing page they opened it from. For a folder with keys the label is **Back to the shared folder**, because the server cannot read the name, and the link goes back in the browser's history, where the address still has the key. From a locked tile, both its password page and the unlocked file return to the first page. Flare shows the link only while the file is still a public member of that folder. The file's own link doesn't change: the folder pages pass their address, as the browser's referrer, only to your Flare instance, so the folder link never appears in a file URL or reaches other sites. A browser set to send no referrer opens the file without the link.

<Screenshot src="/screenshots/encryption/shared-folder.webp" alt="Shared folder page of a folder inside the shared folder: a path back to Tax Papers 2026, the name Receipts March, and three tiles, two encrypted images with thumbnails and a password-protected file without a name" caption="A visitor's browser opens the names and thumbnails with the key in the link. A folder inside the shared folder shows the path back." />

<Screenshot src="/evidence/vault-folders/shared-folder-desktop.jpg" alt="Public shared collection with public files and a generic password-protected tile" caption="The public collection excludes private files and hides the filename and preview of locked files." />

| Item in your folder               | What a visitor sees                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Public file without a password    | A file tile and access to its viewer. An encrypted image or video shows its thumbnail.        |
| Public file with a password       | A locked tile without a filename or preview; opening it asks for the file password.           |
| Private file                      | Nothing; it is excluded from the listing, in every folder of the tree.                        |
| Folder inside the shared folder   | A folder tile with its name. Opening it lists that folder the same way.                       |
| Plain file beside encrypted files | The same tile as before this release. Plain and encrypted files share one list, newest first. |
| Tags and account details          | Not listed.                                                                                   |

An encrypted file appears on the shared page only when it has a folder stanza for the folder's current key. Your browser makes one when you upload a public file into a folder, and for every other case in the background. A file that a screenshot tool or a moderator made public shows up on the shared page after you next open Flare.

A tile without an image preview shows the same icon for the file's kind as your [library cards](./library#read-a-file-card): video, audio, text or PDF, code, table, archive, or a plain file. Earlier versions told only video and audio apart, and showed a plain file for everything else.

There is no separate folder password. Protect individual public files with their own passwords, or keep them private. A shared folder is a collection for viewing, not a collaborative upload or editing space.

The protected-file route reached through a folder also checks that the share is still enabled and that the file is still a public member of that folder. Moving the file out or disabling the share stops access through that folder route.

Recipients opening a public archive can [browse and download its entries](./archives#browse-an-archive-shared-with-you) after any file-password check. This does not publish archive members as separate folder items or add them to the recipient's account. The canonical public file URL remains independent of the folder entrypoint: disabling this share or moving the archive does not revoke an already-known public file URL. Change the archive's own visibility, password, or existence to change access through that URL.

## Disable a folder link

Choose **Share → Disable link**. Two things happen:

1. The server deletes the link's token. The old address stops listing the folder at once.
2. Your browser gives the folder and every folder inside it a new key pair, and makes new stanzas for their folders and files. The key in the old link then opens nothing, also if someone gets a later copy of the database.

Creating a link again waits until step 2 is done, which takes a moment for a small tree and longer for a large one. The new link has a new address and a new key; distribute it to recipients.

Disabling the link does not take back what a visitor already has. A person who opened the shared page got the key of each file that was listed, which is the same as that file's own share link. Those links keep working while the file is public. To end that, make the file private or delete it. Plain files behave the same way: their public addresses were on the page.

## Rename or remove a folder

Use the folder menu to rename a folder. Renaming does not rename its files or alter their URLs. Your browser seals the new name with the folder's key; the key and the share link stay the same.

Removing a folder **keeps its contents**:

- Its files and subfolders move up one level. Your browser then makes the stanzas that let the parent's share link open them.
- Removing a top-level folder leaves its direct files unfiled and promotes its subfolders to the top level.
- Its folder share link stops working.
- If a promoted subfolder would conflict with a sibling name, rename the conflicting folder first.

::: warning Check a shared parent before removing a folder
If the parent folder is shared, public files promoted into it become part of that parent's public collection. Review their visibility before removing the child folder.
:::

## Example: hand off a project

Create a **Client handoff** folder with a **Final** and a **Drafts** folder inside it. Put approved deliverables in **Final** as public files and keep work-in-progress in **Drafts** as private files. Create a share link for **Client handoff**. Your recipient sees both folders and the public deliverables. The drafts stay out of the listing because they are private, not because of the folder they are in.

Use tags such as **Approved** or **Needs revision** for your own workflow. Those labels stay private even when the file appears in the collection.

Watch [real browser recordings of organizing and sharing folders](/demos) to see this workflow in motion.
