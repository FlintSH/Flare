---
title: Folders and collections
description: Organize files and subfolders, move files in bulk, and share a collection without exposing your private library.
---

# Folders and collections

Browsing folders uses `files.read`; creating and organizing them requires `folders.manage`. Moving existing files also needs `files.update`, and uploading into a folder also needs `files.upload`. Publishing or revoking a folder link requires `folders.share` as well as `folders.manage`. These grants come from your [roles](/admin/roles), not from membership in the folder.

Folders give a project or collection its own place while **All files** keeps your entire library available. Each file belongs to one folder or is unfiled. [Tags](./tags) work across folders when a file belongs to several topics.

Folder and file organization changes can leave names and IDs in the [instance audit log](/admin/audit), visible to people with `audit.read` even when the folder is not shared.

Everyone initially includes folder permissions; an administrator can restrict them through roles. Creating a folder does not change file links, storage paths, visibility, or passwords.

<Screenshot src="/evidence/vault-folders/folder-desktop.jpg" alt="A folder containing files, a child folder, tags, and Share and Upload here controls" caption="Browse a project's direct files while keeping subfolders and sharing controls close by." />

## Create and browse folders

1. Open **Files**. On a phone with existing folders, expand **Folders** (or **Subfolders**) first, then choose **New folder**. Otherwise choose **New folder** beside the scope controls.
2. Give it a name and save.
3. Choose **Folders** and its count, then open the folder to see its direct files. Choose **Subfolders** to browse its children. Expanded folder cards sit below the dropdown with space between them.
4. Choose **New folder** inside it to create a subfolder, or **Upload here** to add files.

Folder names can be up to 80 characters. Use a plain-text name without `/` or `\`; `.` and `..` are reserved. Flare trims the ends of a name and saves each run of spaces as one space; unlike a tag name, a folder name can't contain a tab or line break. Names must be distinct within the same parent, ignoring letter case, so `Photos` and `photos` can't share a parent. The same name can be useful in separate projects. Folders that [archive extraction](./archives#extract-into-your-library) creates follow the same rules.

The folder directory starts collapsed so it does not push files down the page. **Folders** or **Subfolders** expands it; choose the same control again to close it. Your choice is remembered on this device for your account and each library scope. If browser storage is unavailable, the control still works for the current visit. A long directory scrolls inside a bounded area; at its edge, scrolling continues through the page.

The current folder path, **All files**, **Unfiled**, and permitted sharing controls remain available with the directory closed. On phones with folders, the labeled **New folder** action lives inside the expanded directory. With no folders to browse, it stays beside the scope controls. Existing folders, share links, and saved folder bookmarks need no migration.

**All files** includes files from every folder. **Unfiled** includes files that do not belong to a folder. Opening a specific folder shows its direct files; open a subfolder to see the files inside that subfolder.

In **All files**, a [file card](./library#read-a-file-card) shows the name of the folder its file belongs to, beside the file's tags. Choose that name to open the folder. Inside a folder, cards leave out the folder you are viewing, which leaves room for two tags.

Search, tag filters, sorting, dates, and image browsing stay within the folder you are viewing. Its direct files use the same [continuous scrolling and date rail](./library#scroll-through-your-library) as **All files**; the rail covers only the matching files in that folder. Resetting those filters keeps the folder selected.

## Move files

For one file, open its menu and choose **Move to folder**. For several files, choose **Select**, select individual files or **Select visible files**, and choose **Move**. Pick a destination and confirm.

A selection can include up to 100 files and stays selected as you scroll. **Select visible files** adds only loaded files currently on screen, not every file in the folder. Changing the folder or filters clears the selection; finish the move first.

Choose **Unfiled** to remove files from their current folder. Moving a file preserves its share link, tags, password, visibility, and expiration.

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

[Archive extraction](./archives#extract-into-your-library) creates a new wrapper folder inside the chosen destination and preserves the archive's subfolders. It requires `files.read`, `files.upload`, and `folders.manage`. With **Private (no profile)**, extracted files stay private even in a shared destination. Explicitly selecting an upload profile can instead publish them with that profile’s visibility and expiration; check the summary before confirming. Choosing **Unfiled** in that flow creates a top-level wrapper rather than leaving the extracted files unfiled.

## Share a folder

Folders start private. To publish a collection:

1. Open the folder menu and choose **Share**.
2. Choose **Create share link**.
3. Copy the generated URL and send it to your recipients.
4. Review the page in a signed-out browser window to check what visitors see.

**Share** and **Share folder** appear only when your role has both `folders.share` and `folders.manage`, the permissions Flare checks when it creates or disables a link. Earlier versions showed them with `folders.share` alone, and creating or disabling the link then failed.

The shared page uses a link under `/s/folders/…`. It lists up to 48 files per page and follows changes to the collection: newly added public files appear, and files moved out or made private disappear.

A visitor who opens a file from the shared page sees **Back to** and the folder's name above the file, including on the password page of a locked tile, to return to the listing page they opened it from. From a locked tile, both its password page and the unlocked file return to the first page. Flare shows the link only while the file is still a public member of that folder. The file's own link doesn't change: the folder pages pass their address, as the browser's referrer, only to your Flare instance, so the folder link never appears in a file URL or reaches other sites. A browser set to send no referrer opens the file without the link.

<Screenshot src="/evidence/vault-folders/shared-folder-desktop.jpg" alt="Public shared collection: tiles for public files with each file's type and size under its name, and a generic password-protected tile" caption="The public collection excludes private files and hides the filename and preview of locked files." />

| Item in your folder                   | What a visitor sees                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Direct public file without a password | A file tile and access to its viewer.                                               |
| Direct public file with a password    | A locked tile without a filename or preview; opening it asks for the file password. |
| Private file                          | Nothing; it is excluded from the listing.                                           |
| Subfolder and its files               | Nothing; sharing does not recursively publish subfolders.                           |
| Tags and account details              | Not listed.                                                                         |

A tile without an image preview shows the same icon for the file's kind as your [library cards](./library#read-a-file-card): video, audio, text or PDF, code, table, archive, or a plain file. Earlier versions told only video and audio apart, and showed a plain file for everything else.

Under its name, each tile says what the file is, such as **JPEG image** or **Plain text**, followed by its size unless the instance hides sizes. A locked tile says **Password required** instead.

An image tile shows a thumbnail that Flare resizes for the tile, as library cards do, so a folder of large photos opens without downloading every original. Animated GIFs and SVG images are shown as they are. Opening the folder adds no [views](./sharing#view-counts) to its files. Earlier versions loaded each image tile from the file's raw link at full size, which was slow for photo collections and added a view to every image on each visit.

A short list sits in the middle of the page, like a shared file; a longer one starts under the header.

There is no separate folder password. Protect individual public files with their own passwords, or keep them private. A shared folder is a collection for viewing, not a collaborative upload or editing space.

The protected-file route reached through a folder also checks that the share is still enabled and that the file is still a public member of that folder. Moving the file out or disabling the share stops access through that folder route.

Recipients opening a public archive can [browse and download its entries](./archives#browse-an-archive-shared-with-you) after any file-password check. This does not publish archive members as separate folder items or add them to the recipient's account. The canonical public file URL remains independent of the folder entrypoint: disabling this share or moving the archive does not revoke an already-known public file URL. Change the archive's own visibility, password, or existence to change access through that URL.

## Disable a folder link

Choose **Share → Disable link**. This stops new requests to that folder share. If you enable sharing again, Flare generates a new link; distribute the new URL to recipients.

Disabling the collection does not revoke the individual public file links that people may already have copied. To stop access to a file itself, change it to private or delete it.

## Rename or remove a folder

Use the folder menu to rename a folder. Renaming does not rename its files or alter their URLs.

Removing a folder **keeps its contents**:

- Its files and subfolders move up one level.
- Removing a top-level folder leaves its direct files unfiled and promotes its subfolders to the top level.
- Its folder share link stops working.
- If a promoted subfolder would conflict with a sibling name, rename the conflicting folder first.

::: warning Check a shared parent before removing a folder
If the parent folder is shared, public files promoted into it become part of that parent's public collection. Review their visibility before removing the child folder.
:::

## Example: hand off a project

Create a **Client handoff** folder. Put approved public deliverables directly inside it, put work-in-progress into a private subfolder, and keep sensitive files private. Create a share link for **Client handoff**. Your recipient sees the direct public deliverables, while the subfolder and private files stay out of the listing.

Use tags such as **Approved** or **Needs revision** for your own workflow. Those labels stay private even when the file appears in the collection.

Watch [real browser recordings of organizing and sharing folders](/demos) to see this workflow in motion.
