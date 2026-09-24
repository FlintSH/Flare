---
title: Folders and collections
description: Organize files and subfolders, move files in bulk, and share a collection without exposing your private library.
---

# Folders and collections

Folders give a project or collection its own place while **All files** keeps your entire library available. Each file belongs to one folder or is unfiled. [Tags](./tags) work across folders when a file belongs to several topics.

Folders are available without an administrator enabling a setting. Creating a folder does not change file links, storage paths, visibility, or passwords.

<Screenshot src="/evidence/vault-folders/folder-desktop.jpg" alt="A folder containing files, a child folder, tags, and Share and Upload here controls" caption="Browse a project's direct files while keeping subfolders and sharing controls close by." />

## Create and browse folders

1. Open **Files** and choose **New folder**.
2. Give it a name and save.
3. Open the folder to see its direct files and subfolders.
4. Choose **New folder** inside it to create a subfolder, or **Upload here** to add files.

Folder names can be up to 80 characters. Use a plain-text name without `/` or `\`; `.` and `..` are reserved. Names must be distinct within the same parent. The same name can be useful in separate projects.

**All files** includes files from every folder. **Unfiled** includes files that do not belong to a folder. Opening a specific folder shows its direct files; open a subfolder to see the files inside that subfolder.

Search, tag filters, sorting, dates, and image browsing stay within the folder you are viewing. Resetting those filters keeps the folder selected.

Use a [saved view](./saved-views) to return to a folder with your usual filters and grouping. The view still shows only that folder's direct files. Renaming the folder keeps the view connected; deleting the folder makes the view unavailable until you update its filters.

## Move files

For one file, open its menu and choose **Move to folder**. For several files, choose **Select**, select the files or current page, and choose **Move**. Pick a destination and confirm.

Choose **Unfiled** to remove files from their current folder. Moving a file preserves its share link, tags, password, visibility, and expiration.

<Screenshot src="/evidence/vault-folders/bulk-move.jpg" alt="Move dialog with several selected files and a nested folder destination" caption="Move a selection together without changing its file links." />

::: tip Moving changes collection membership
When a folder has a share link, moving a public file into it adds that file to the collection. Moving it out removes it from the collection. Its separate file link continues to follow its own access settings.
:::

## Upload into the right place

- **Upload here** opens the upload page with the current folder selected.
- **Save to** on the upload page lets you choose a folder when you have folders.
- Dropping files onto the library uploads them into the folder currently open.
- Dropping files elsewhere in the dashboard leaves them unfiled.

The destination is chosen for the upload; it is not saved inside an upload profile. If a folder is removed while an upload is running, finalization can fail instead of quietly putting the file somewhere else. Choose a valid destination and retry.

## Share a folder

Folders start private. To publish a collection:

1. Open the folder menu and choose **Share**.
2. Choose **Create share link**.
3. Copy the generated URL and send it to your recipients.
4. Review the page in a signed-out browser window to check what visitors see.

The shared page uses a link under `/s/folders/…`. It lists up to 48 files per page and follows changes to the collection: newly added public files appear, and files moved out or made private disappear.

<Screenshot src="/evidence/vault-folders/shared-folder-desktop.jpg" alt="Public shared collection with public files and a generic password-protected tile" caption="The public collection excludes private files and hides the filename and preview of locked files." />

| Item in your folder                   | What a visitor sees                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Direct public file without a password | A file tile and access to its viewer.                                               |
| Direct public file with a password    | A locked tile without a filename or preview; opening it asks for the file password. |
| Private file                          | Nothing; it is excluded from the listing.                                           |
| Subfolder and its files               | Nothing; sharing does not recursively publish subfolders.                           |
| Tags and account details              | Not listed.                                                                         |

There is no separate folder password. Protect individual public files with their own passwords, or keep them private. A shared folder is a collection for viewing, not a collaborative upload or editing space.

The protected-file route reached through a folder also checks that the share is still enabled and that the file is still a public member of that folder. Moving the file out or disabling the share stops access through that folder route.

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
