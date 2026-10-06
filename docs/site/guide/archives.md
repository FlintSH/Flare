---
title: Archives
description: Browse archive contents, save individual entries, extract into a new folder, and package your files with safe defaults or an explicit upload profile.
---

# Work with archives

Open an archive from **Files → file menu → Browse archive**, or browse an accessible archive on its share page. Flare can inspect **ZIP, TAR, TAR.GZ/TGZ, and GZIP** files without first adding their contents to a library. Share-page visitors can preview and download individual entries. In your own library, you can also extract contents into a new folder or create a ZIP or TAR.GZ from files you own.

Share-page browsing follows the archive file's [visibility and password rules](./sharing#choose-who-can-open-a-file). An unprotected public archive can be browsed while signed out. A protected public archive requires its file password; knowing a private file's password does not make it public. Owners with `files.read` and accounts with `content.read` retain their usual privileged file access. Named API tokens do not grant archive access.

Creation and extraction remain **owner-only library operations** requiring a signed-in browser. Share pages provide browsing and downloads, including for signed-in recipients; they do not extract another person's archive into your account.

| Action                                   | Required permissions                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Browse a share page or download an entry | Access to the file under its visibility/password rules                           |
| Browse an archive in your own library    | `files.read`                                                                     |
| Create an archive from owned files       | `files.read` and `files.upload`; also `folders.manage` when saving into a folder |
| Extract into a new folder                | `files.read`, `files.upload`, and `folders.manage`                               |

Existing files and links stay unchanged. **Private (no profile)** is the default for extraction and creation: new files are private, with no file password or expiration. Your account's default upload profile is not selected automatically. You can explicitly choose an owned **Upload profile** to apply its sharing, tags, expiration, naming, and share-page settings. Review the summary before confirming: a public profile can make new outputs public. Original files' Flare passwords and visibility are not copied into the result.

The screenshots below show real operations with disposable demonstration files. Watch the recorded [library workflows](../demos#browse-and-extract-an-archive) and [shared browsing](../demos#browse-and-download-a-shared-archive), or [reproduce them locally](../contributing#archive-browser-checks-and-demos).

## Browse and save one entry

1. Upload a supported archive, or find one already in **Files**.
2. Open its menu and choose **Browse archive**. The same action is available among the card's preview actions.
3. Open folders and use the breadcrumbs to return toward **Archive root**. **Search archive** finds entries by their paths.
4. Select a file to inspect its preview. Use **Download entry** to save that member to your device.

<Screenshot src="/screenshots/archives/browse.webp" alt="Archive browser showing Field kit.zip with four files, four folders, path search, and Extract all" caption="Browse the archive hierarchy before deciding whether to add its contents to your library." />

<Screenshot src="/screenshots/archives/entry-preview.webp" alt="Search for README in Field kit.zip showing the guide/README.md text and Download entry action" caption="Search matches entry paths. This Markdown file is previewed directly from the archive." />

Browsing and downloading an entry do not create new library files or folders. Text previews are limited to **256 KiB**, and image previews to **10 MiB**; use the download action for larger entries or unsupported preview types. HTML and SVG are displayed as text rather than active documents. An archive is inspected as a whole before it is accepted: Flare does not silently skip an unsafe entry and show a partial archive.

In both library and share-page browsers, **Download entry** waits while a supported preview loads or retries, so the two requests do not overlap. Entries without a supported preview can be downloaded immediately.

::: details See an image entry preview
<Screenshot src="/screenshots/archives/image-preview.webp" alt="Verified PNG image preview of the Flare icon inside Field kit.zip" caption="Supported raster images can be previewed without extracting the archive." />
:::

Flare file passwords and archive encryption are different. A normal Flare file password controls access to the share page and entries. Encrypted archive contents remain unsupported after unlocking that page; remove the archive's encryption in an appropriate local tool before uploading a copy you intend to inspect.

## Browse an archive shared with you

1. Open the normal Flare share link. If the public archive is protected, enter **File password** and choose **Access File**.
2. Under **Archive contents**, open folders or use **Search archive** to find member paths. **Archive root** returns to the top level.
3. Select an entry to preview supported text or an image, then choose **Download entry** to save that file. The share page remains open.
4. Use the ordinary **Download** action below the viewer if you want the complete archive.

<Screenshot src="/screenshots/archives/share-browse.webp" alt="Public Field kit.zip share page with inline Archive contents, four folders, and the whole-file Download action" caption="An anonymous visitor can browse an unprotected public archive without signing in." />

These actions do not add files to an account or expose other files in the owner's library. Share-page browsing is inline; it has no **Extract all** action, including when the owner is signed in. To extract into Flare, the owner uses **Files → Browse archive → Extract all** in their own library. Entry paths and filenames remain visible to authorized viewers even when the outer share-page filename is hidden by a presentation setting.

::: details See shared text and image previews
<Screenshot src="/screenshots/archives/share-entry.webp" alt="Shared archive with the guide folder open, README.md text preview, and Download entry beside the member name" caption="Download entry saves the selected file; the ordinary Download action below saves the whole archive." />

<Screenshot src="/screenshots/archives/share-image.webp" alt="Public archive search for flare-icon showing the verified images/flare-icon.png preview and its download action" caption="Path search also finds image entries elsewhere in the shared archive." />
:::

Each shared archive request checks the current file access rules. Making the archive private, changing its password, or deleting it affects subsequent requests; content already previewed or downloaded cannot be recalled. Expiration follows the normal [scheduled expiry processing](./sharing#give-a-file-a-lifetime).

::: details See the password gate and unlocked archive
<Screenshot src="/screenshots/archives/share-password.webp" alt="Password Protected File page with an empty File password field and Access File button; archive contents are hidden" caption="A protected public archive requires its file password before a visitor can browse." />

<Screenshot src="/screenshots/archives/share-unlocked.webp" alt="Previously protected archive after successful access, showing README search results, text preview, and Download entry" caption="After the real password check succeeds, the visitor can browse and download entries. No password value is shown." />
:::

If you arrived through a [shared folder](./folders#share-a-folder), that folder's link controls discovery of the file. Disabling the folder share or moving the file out blocks that entrypoint. An already-known canonical public file URL and its archive contents remain accessible under the file's own visibility/password rules. Change the file itself when you need to stop that public access.

## Extract into your library

1. In your own **Files** library, open **Browse archive** and choose **Extract all**. Share-page browsers do not offer extraction.
2. Under **Save to**, choose an existing folder or **Unfiled** for the top level.
3. Set **New folder name** for the wrapper that will contain the extracted items.
4. Keep **Private (no profile)**, or explicitly choose an **Upload profile** and review its visibility and expiration.
5. Choose **Extract files** and wait for the result.
6. Choose **Open folder** to review the new files and their subfolders.

<Screenshot src="/screenshots/archives/extract.webp" alt="Extract archive dialog saving a new Field kit unpacked folder inside Campaigns with Private no profile selected" caption="Choose the destination and new wrapper name. Private output with no expiration is the default." />

<Screenshot src="/screenshots/archives/extract-result.webp" alt="Archive extracted confirmation showing four private files saved and an Open folder action" caption="The real extraction completed with four files; the source archive remains stored." />

The new wrapper preserves the archive's directory hierarchy. Its name follows the normal [folder rules](./folders#create-and-browse-folders): up to 80 characters and distinct within the chosen parent. The operation does not overwrite existing files or replace the original archive. A failed operation does not publish a partial set of extracted files. Choose a distinct wrapper name if that destination already contains a folder with the same name.

Extracted files add to your storage usage while the original archive remains stored. Account quota and the instance's maximum file size still apply. Filename-based automatic tags, automatic OCR when enabled, and `file.ready` webhooks use the normal processing flow for the new files; OCR may finish after extraction completes. These are separate library files, so later edits to them do not change the source archive.

::: details See the preserved folders and new library files
<Screenshot src="/screenshots/archives/extracted-folder.webp" alt="Field kit unpacked library folder containing drafts, empty, guide, and images subfolders" caption="The wrapper preserves the directory hierarchy, including an empty folder." />

<Screenshot src="/screenshots/archives/extracted-files.webp" alt="Extracted guide folder containing README.md and checklist.csv as private library files" caption="The extracted files are ordinary library items, ready for normal previews and organization." />
:::

## Create an archive from selected files

1. In **Files**, choose **Select** and select the files to include.
2. Choose **Create archive**.
3. Set **Archive name**, choose **ZIP** or **TAR.GZ** under **Format**, and choose **Save to**.
4. Keep **Private (no profile)**, or explicitly choose an **Upload profile**. Check its visibility, expiration, and other settings before continuing.
5. Choose **Create archive** and wait for completion.
6. Use **Open archive** to inspect the result, or **Open folder** to see its destination.

<Screenshot src="/screenshots/archives/create.webp" alt="Create archive dialog for two selected files, ZIP format, Campaigns destination, and Private no profile default" caption="Package selected files into ZIP or TAR.GZ without moving or changing the originals." />

Selecting the current page includes that page's files, not all matching results. You can include up to **100 files** from your account. The result is one new library file; the selected originals keep their locations, links, permissions, and contents. Creating an archive does not reclaim storage or create an instance backup.

Selected files are placed at the archive's root rather than recreating their library folders. Names are normalized for portable archive paths: path-like names are flattened and unsafe separators or punctuation are cleaned. Conflicting filenames receive a suffix such as `report (2).pdf` so each selected file remains represented. The output receives the chosen `.zip` or `.tar.gz` extension.

Archive creation does not encrypt the result or carry over each source file's Flare password, visibility, expiration, tags, or share link as archive access controls. Anyone who later obtains the archive bytes can read its contents with an archive tool. Keep the result private until you have reviewed everything it contains.

::: details See a completed archive and its members
<Screenshot src="/screenshots/archives/create-result.webp" alt="Archive created confirmation for Launch handoff.zip with Open folder and Open archive actions" caption="This demonstration explicitly selected the Public handoff profile before creating the archive." />

<Screenshot src="/screenshots/archives/created-archive.webp" alt="Generated Launch handoff.zip opened in the archive browser with Field notes.txt and Launch checklist.csv" caption="Both selected files appear at the archive root; their original library files remain unchanged." />
:::

## Choose an upload profile deliberately

An explicitly selected profile applies to every new extracted file, or to the single generated archive. Its destination remains controlled by **Save to**; the profile does not choose a folder. A public profile can expose all packaged contents through the new archive's public download, even when its source files were private.

<Screenshot src="/screenshots/archives/create-profile.webp" alt="Public handoff selected in Create archive with public visibility, one-week expiration, randomized filenames, Delivery share page, and one tag" caption="This explicit profile replaces the private default. Review the public-content notice and effective settings before confirming." />

The normal [upload-profile permission rules](./upload-profiles) still apply. Without `files.share`, outputs stay private. Applying profile tags needs `tags.manage`; an expiration that deletes files needs `files.delete`, and an expiration that makes them private needs `files.share`. A profile contains no file password. Flare checks that the profile and its inherited account/instance defaults still match the settings shown in the dialog. A profile edit, deletion, or relevant inherited-default or sharing-permission change before submission or during processing stops publication without adding outputs. The dialog refreshes the settings while retaining your choices; review them and submit again. **Private (no profile)** keeps its fixed defaults regardless of account changes.

## Use archives on a phone

The same archive tools work in the mobile library. Scroll the dialog's fields when necessary; extraction actions remain below the scrolling content. Search, folder navigation, profile choices, and permissions work the same way.

<Screenshot src="/screenshots/archives/mobile-browse.webp" alt="Archive browser at 390 pixels wide showing Field kit.zip folders, search, and Extract all" caption="Real mobile browser capture at 390px wide." />

<Screenshot src="/screenshots/archives/mobile-extract.webp" alt="Mobile Extract archive dialog with destination choices and extraction actions" caption="The extraction form scrolls within the dialog so its actions remain reachable on a phone." />

On a share page, the entry list and preview stack vertically. Scroll to **Download entry** for the selected member or the ordinary **Download** action for the whole archive.

<Screenshot src="/screenshots/archives/share-mobile.webp" alt="Shared archive at 390 pixels wide with README search result, text preview, Download entry, and whole-archive Download below" caption="Real shared-page browsing at 390px wide; the full-page capture shows both download actions." />

## Supported sizes and formats

Limits apply to every request, including browsing. **MiB** means 1,048,576 bytes.

| Limit                                                      | Maximum          |
| ---------------------------------------------------------- | ---------------- |
| Source archive or generated archive                        | 256 MiB          |
| One archive member or one selected source file             | 256 MiB          |
| Expanded contents, or combined files selected for creation | 512 MiB          |
| Archive members, including parent directories              | 1,000            |
| Files selected for creation                                | 100              |
| Archive path depth                                         | 20 levels        |
| Archive path length                                        | 1,024 characters |
| Archive processing time                                    | 120 seconds      |

The instance's file-size limit and your remaining quota can impose lower limits when new files are created. Each Flare application process allows two concurrent archive operations. Owner-library work allows at most one per account; share-page work allows at most one per source file. Shared browsing and entry downloads also share a limit of 30 requests per IP per minute in each process. If the service is busy or a rate limit is reached, wait and retry.

After the initial header checks, Flare allows **five seconds** to read a share page's small browsing/download request body, before authorizing file access and starting archive processing. This submission limit is separate from the 120-second processing deadline; it does not require the whole archive to transfer in five seconds. If submission times out, retry on a stable connection. Incomplete or rejected requests do not reserve archive-processing capacity.

**RAR, 7z, encrypted archives, and split archives are unsupported.** Links, special filesystem entries, unsafe paths, conflicting paths, malformed contents, and archives exceeding the limits are rejected. Flare does not execute extracted programs or restore archive filesystem permissions.

## Troubleshoot an operation

| What you see                              | What to do                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No archive action                         | Check the format and entrypoint. Library tools require `files.read`; share-page browsing requires access to the file.                                                    |
| Unsupported, unsafe, or malformed archive | Recreate it as a regular ZIP, TAR, TAR.GZ/TGZ, or GZIP with ordinary files and directories. Remove encryption, links, and conflicting paths first.                       |
| An entry has no preview                   | Download it and open it locally; preview limits and browser format support are separate from archive support.                                                            |
| Extraction or creation is unavailable     | These are owner-library operations; share pages offer browsing and downloads only. Check upload/folder permissions for your own files.                                   |
| Destination or wrapper name rejected      | Pick an existing folder you own and a distinct new wrapper name, then retry.                                                                                             |
| Size, quota, or time limit reached        | Split the work into smaller archives or selections, or extract locally and upload the files you need. Raising an upload setting does not raise the fixed archive limits. |
| Another operation is running              | Finish the current archive request before starting another; the server also limits concurrent operations across accounts.                                                |

<Screenshot src="/screenshots/archives/invalid-archive.webp" alt="Archive browser rejecting Damaged bundle.zip with an integrity error in the light theme" caption="A real damaged ZIP is rejected. An invalid archive does not produce a partial listing or extracted files." />

For contributors, the [archive API](../api/archives) describes exact requests and responses. Operators can review [archive resource requirements](../hosting/storage#archive-processing).
