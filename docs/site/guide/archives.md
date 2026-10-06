---
title: Archives
description: Browse archive contents, save individual entries, extract into a new folder, and package your files with safe defaults or an explicit upload profile.
---

# Work with archives

Open an archive from **Files → file menu → Browse archive**. Flare can inspect **ZIP, TAR, TAR.GZ/TGZ, and GZIP** files without first adding their contents to your library. You can download an individual entry, extract the contents into a new folder, or create a ZIP or TAR.GZ from files you already own.

These tools require your signed-in browser and operate on **your own files**. They are unavailable to public-link visitors, named API tokens, and moderators inspecting somebody else's files. A public archive can still be downloaded as a whole through its normal share link; making it public exposes the bytes inside it to recipients who open that downloaded copy.

| Action                                       | Required permissions                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Browse an owned archive or download an entry | `files.read`                                                                     |
| Create an archive from owned files           | `files.read` and `files.upload`; also `folders.manage` when saving into a folder |
| Extract into a new folder                    | `files.read`, `files.upload`, and `folders.manage`                               |

Existing files and links stay unchanged. **Private (no profile)** is the default for extraction and creation: new files are private, with no file password or expiration. Your account's default upload profile is not selected automatically. You can explicitly choose an owned **Upload profile** to apply its sharing, tags, expiration, naming, and share-page settings. Review the summary before confirming: a public profile can make new outputs public. Original files' Flare passwords and visibility are not copied into the result.

The screenshots below show real operations with disposable demonstration files. [Watch the recorded browse/extract and create workflows](../demos#browse-and-extract-an-archive), or [reproduce them locally](../contributing#archive-browser-checks-and-demos).

## Browse and save one entry

1. Upload a supported archive, or find one already in **Files**.
2. Open its menu and choose **Browse archive**. The same action is available among the card's preview actions.
3. Open folders and use the breadcrumbs to return toward **Archive root**. **Search archive** finds entries by their paths.
4. Select a file to inspect its preview. Use **Download entry** to save that member to your device.

<Screenshot src="/screenshots/archives/browse.webp" alt="Archive browser showing Field kit.zip with four files, four folders, path search, and Extract all" caption="Browse the archive hierarchy before deciding whether to add its contents to your library." />

<Screenshot src="/screenshots/archives/entry-preview.webp" alt="Search for README in Field kit.zip showing the guide/README.md text and Download entry action" caption="Search matches entry paths. This Markdown file is previewed directly from the archive." />

Browsing and downloading an entry do not create new library files or folders. Text previews are limited to **256 KiB**, and image previews to **10 MiB**; use the download action for larger entries or unsupported preview types. HTML and SVG are displayed as text rather than active documents. An archive is inspected as a whole before it is accepted: Flare does not silently skip an unsafe entry and show a partial archive.

::: details See an image entry preview
<Screenshot src="/screenshots/archives/image-preview.webp" alt="Verified PNG image preview of the Flare icon inside Field kit.zip" caption="Supported raster images can be previewed without extracting the archive." />
:::

Flare file passwords and archive encryption are different. An owner can browse an otherwise supported archive protected by a normal Flare file password. ZIP/TAR encryption and password-protected archive contents are not supported; remove that encryption in an appropriate local tool before uploading a copy you intend to inspect.

## Extract into your library

1. In the archive browser, choose **Extract all**.
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

The normal [upload-profile permission rules](./upload-profiles) still apply. Without `files.share`, outputs stay private. Applying profile tags needs `tags.manage`; an expiration that deletes files needs `files.delete`, and an expiration that makes them private needs `files.share`. A profile contains no file password. Flare checks that the profile still matches the settings shown in the dialog. If it changes or is deleted before submission or while processing, publication fails without adding outputs; refresh the choice, review its current settings, and retry.

## Use archives on a phone

The same archive tools work in the mobile library. Scroll the dialog's fields when necessary; extraction actions remain below the scrolling content. Search, folder navigation, profile choices, and permissions work the same way.

<Screenshot src="/screenshots/archives/mobile-browse.webp" alt="Archive browser at 390 pixels wide showing Field kit.zip folders, search, and Extract all" caption="Real mobile browser capture at 390px wide." />

<Screenshot src="/screenshots/archives/mobile-extract.webp" alt="Mobile Extract archive dialog with destination choices and extraction actions" caption="The extraction form scrolls within the dialog so its actions remain reachable on a phone." />

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
| Total request time                                         | 120 seconds      |

The instance's file-size limit and your remaining quota can impose lower limits when new files are created. Each Flare application process allows two concurrent archive operations, with at most one per account. If the service is busy, wait for the current operation to finish and retry.

**RAR, 7z, encrypted archives, and split archives are unsupported.** Links, special filesystem entries, unsafe paths, conflicting paths, malformed contents, and archives exceeding the limits are rejected. Flare does not execute extracted programs or restore archive filesystem permissions.

## Troubleshoot an operation

| What you see                              | What to do                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No archive action                         | Check the file format and your `files.read` permission; archive tools are for your own library.                                                                          |
| Unsupported, unsafe, or malformed archive | Recreate it as a regular ZIP, TAR, TAR.GZ/TGZ, or GZIP with ordinary files and directories. Remove encryption, links, and conflicting paths first.                       |
| An entry has no preview                   | Download it and open it locally; preview limits and browser format support are separate from archive support.                                                            |
| Extraction or creation is unavailable     | Ask an administrator to review the required upload/folder permissions. A named token cannot supply a browser session.                                                    |
| Destination or wrapper name rejected      | Pick an existing folder you own and a distinct new wrapper name, then retry.                                                                                             |
| Size, quota, or time limit reached        | Split the work into smaller archives or selections, or extract locally and upload the files you need. Raising an upload setting does not raise the fixed archive limits. |
| Another operation is running              | Finish the current archive request before starting another; the server also limits concurrent operations across accounts.                                                |

<Screenshot src="/screenshots/archives/invalid-archive.webp" alt="Archive browser rejecting Damaged bundle.zip with an integrity error in the light theme" caption="A real damaged ZIP is rejected. An invalid archive does not produce a partial listing or extracted files." />

For contributors, the [archive session API](../api/archives) describes exact requests and responses. Operators can review [archive resource requirements](../hosting/storage#archive-processing).
