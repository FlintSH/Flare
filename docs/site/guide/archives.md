---
title: Archives
description: Browse archives of any size, preview images, video, audio, and text inside them, save individual entries, extract into a new folder, and package your files with safe defaults or an explicit upload profile.
---

# Work with archives

Open an archive from **Files → file menu → Browse archive**, or browse an accessible archive on its share page. Flare can browse **ZIP, TAR, TAR.GZ/TGZ, and GZIP** files without first adding their contents to a library. It reads only what it needs: the archive's file list, then the entry you open. A multi-gigabyte ZIP opens as quickly as a small one, and an image, video, or log inside it starts showing without the rest of the archive being read. Share-page visitors can preview and download individual entries. In your own library, you can also extract contents into a new folder or create a ZIP or TAR.GZ from files you own.

Share-page browsing follows the archive file's [visibility and password rules](./sharing#choose-who-can-open-a-file). An unprotected public archive can be browsed while signed out. A protected public archive requires its file password; knowing a private file's password does not make it public. Owners with `files.read` and accounts with `content.read` retain their usual privileged file access. Named API tokens do not grant archive access.

Creation and extraction remain **owner-only library operations** requiring a signed-in browser. Share pages provide browsing and downloads, including for signed-in recipients; they do not extract another person's archive into your account.

| Action                                   | Required permissions                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Browse a share page or download an entry | Access to the file under its visibility/password rules                           |
| Browse an archive in your own library    | `files.read`                                                                     |
| Create an archive from owned files       | `files.read` and `files.upload`; also `folders.manage` when saving into a folder |
| Extract into a new folder                | `files.read`, `files.upload`, and `folders.manage`                               |

Existing files and links stay unchanged. **Private (no profile)** is the default for extraction and creation: new files are private, with no file password or expiration. Your account's default upload profile is not selected automatically. You can explicitly choose an owned **Upload profile** to apply its sharing, tags, expiration, naming, and share-page settings. Review the summary before confirming: a public profile can make new outputs public. Original files' Flare passwords and visibility are not copied into the result.

Archive activity can appear in the administrator's [audit log](../admin/audit), including archive filenames, opened member paths, outcomes, and the acting account when available. File passwords and entry contents are not recorded as audit metadata. Making an archive private or deleting it does not remove its existing audit history.

The screenshots below show real operations with disposable demonstration files. Watch the recorded [library workflows](../demos#browse-and-extract-an-archive), [large-archive previews](../demos#preview-files-in-a-large-archive), and [shared browsing](../demos#browse-and-download-a-shared-archive), or [reproduce them locally](../contributing#archive-browser-checks-and-demos).

## Browse and preview entries

1. Upload a supported archive, or find one already in **Files**.
2. Open its menu and choose **Browse archive**. The same action is available among the card's preview actions.
3. Open folders and use the breadcrumbs to return toward **Archive root**. **Search archive** finds files and folders anywhere in the archive by their paths. In the entry list, the up and down arrow keys, **Home**, and **End** move between entries.
4. Select a file to preview it. Use **Download entry** to save that member to your device.

<Screenshot src="/screenshots/archives/browse.webp" alt="Archive browser showing Field kit.zip with four files, four folders, path search, and Extract all" caption="Browse the archive hierarchy before deciding whether to add its contents to your library." />

<Screenshot src="/screenshots/archives/entry-preview.webp" alt="Search for README in Field kit.zip showing the guide/README.md text and Download entry action" caption="Search matches entry paths. This Markdown file is previewed directly from the archive." />

Browsing and downloading an entry do not create new library files or folders. Previews depend on the file type:

| File type                                                                   | What the preview shows                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images: PNG, JPEG, GIF, WebP, AVIF, BMP, ICO                                | The image, once Flare has checked from its bytes that it really is one. **Expand** opens the full-screen viewer; the arrow keys move between images in the open folder or search results. Images over **50 MiB** wait for **Load preview**. |
| Video: MP4, WebM, MOV, MKV, OGV. Audio: MP3, M4A, AAC, WAV, FLAC, OGG, Opus | A player that streams and seeks inside the archive. Your browser decides which codecs it can play.                                                                                                                                          |
| Text, code, data, and logs                                                  | The first **256 KiB**. **Load more** adds the next 256 KiB. HTML and SVG are displayed as text rather than active documents. A file that looks like binary data is not shown as text.                                                       |
| Anything else                                                               | **Download entry**.                                                                                                                                                                                                                         |

::: details See an image entry preview
<Screenshot src="/screenshots/archives/image-preview.webp" alt="Verified PNG image preview of the Flare icon inside Field kit.zip with an Expand button" caption="Supported raster images can be previewed without extracting the archive." />
:::

Flare file passwords and archive encryption are different. A normal Flare file password controls access to the share page and entries. Encrypted entries are listed with a lock, but their contents can't be previewed or downloaded individually after unlocking that page; download the whole archive and open it with its password in a local tool.

### Large archives

How quickly a listing appears depends on the format:

- **ZIP** keeps its file list at the end of the archive. Flare reads that list and nothing else, so a ZIP of any size opens almost immediately. Opening an entry reads only that entry's bytes.
- **TAR** has no file list. Flare reads each entry's small header and skips over its contents.
- **TAR.GZ/TGZ and GZIP** are compressed as one stream, which has to be read from the beginning. The first time you open one, a progress bar shows how much has been read. Files appear in the list as they are found, and you can open them before reading finishes. During that first read, Flare also records points it can resume from, so later previews start near the file you open instead of decompressing everything before it.

Flare keeps recently read file lists in memory, so reopening an archive is immediate until the server restarts or needs the memory for other archives.

<Screenshot src="/screenshots/archives/large-browse.webp" alt="Studio handoff.zip, a 906 MB ZIP with 20,025 files and 114 folders, open in the archive browser with Extract all unavailable" caption="A 906 MB ZIP with 20,025 files lists at once. Extraction limits are explained before you try." />

<Screenshot src="/screenshots/archives/video-preview.webp" alt="share-walkthrough.webm playing at 0:04 of 0:06 inside Studio handoff.zip" caption="Video plays and seeks inside the archive without extracting it." />

::: details See text, gallery, and TAR.GZ previews
<Screenshot src="/screenshots/archives/text-preview-more.webp" alt="A 6 MB server log inside the archive showing the first 512 KB with a Load more button" caption="Long logs load in 256 KiB steps." />

<Screenshot src="/screenshots/archives/image-gallery.webp" alt="Full-screen viewer showing image 2 of 20 from the photos folder inside the archive, with download and close controls" caption="Expand an image to page through every image in the folder." />

<Screenshot src="/screenshots/archives/tgz-indexing.webp" alt="Render outputs.tar.gz being read: 64 MB of 336 MB read, 16 entries found, and the frames folder already listed" caption="A TAR.GZ is read once with visible progress. Files found so far can be opened right away." />

<Screenshot src="/screenshots/archives/tgz-late-entry.webp" alt="The last file in Render outputs.tar.gz, summary/approved-cut.md, previewed after reading finished" caption="Later previews resume near the file instead of decompressing the archive from the start." />
:::

A listing shows at most **100,000** entries. Listing a TAR, TAR.GZ, or GZIP stops after **2 minutes**, and a TAR.GZ or GZIP also stops after **64 GiB** of uncompressed data. When either limit is reached, or the archive ends early, a notice above the list says how many entries are shown. Download the archive to see everything.

### When part of an archive can't be opened

Flare lists every entry it can read and marks the ones it can't open, instead of rejecting the whole archive:

| Mark    | Meaning                                                                                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lock    | The entry is encrypted.                                                                                                                                                                                                                            |
| Link    | A symbolic or hard link, which has no contents of its own.                                                                                                                                                                                         |
| Warning | A compression method Flare can't read (such as Deflate64, BZIP2, LZMA, or XZ inside a ZIP), a sparse TAR file, a special filesystem entry, a path that escapes the archive, or a GZIP file whose end Flare didn't reach within the listing limits. |

Selecting a marked entry explains the problem. Other entries still open normally.

ZIP entries carry a checksum. Flare checks it whenever it reads a whole entry, which includes downloads, image previews, and text previews of files up to 256 KiB. A damaged text file or small entry shows an integrity error, a damaged image doesn't display, and a damaged download stops before it completes; the rest of the archive is unaffected. Reads of part of an entry, such as seeking in a video or **Load more**, can't be checked until the whole entry is read.

<Screenshot src="/screenshots/archives/damaged-entry.webp" alt="Damaged bundle.zip lists all four files; previewing guide/README.md shows Archive integrity verification failed" caption="One damaged entry fails on its own. The checklist beside it still opens." />

If Flare can't read the archive's structure at all, for example an upload that was cut off or a file that isn't really an archive, the browser shows an error instead of a listing.

<Screenshot src="/screenshots/archives/invalid-archive.webp" alt="Archive browser showing that Flare couldn't find Broken upload.zip's file list, in the light theme" caption="A cut-off ZIP has no file list. Upload it again, or download it to inspect it locally." />

## Browse an archive shared with you

1. Open the normal Flare share link. If the public archive is protected, enter **File password** and choose **Access File**.
2. Under **Archive contents**, open folders or use **Search archive** to find member paths. **Archive root** returns to the top level.
3. Select an entry to preview it, then choose **Download entry** to save that file. The share page remains open.
4. Use the ordinary **Download** action below the viewer if you want the complete archive.

<Screenshot src="/screenshots/archives/share-browse.webp" alt="Public Field kit.zip share page with inline Archive contents, four folders, and the whole-file Download action" caption="An anonymous visitor can browse an unprotected public archive without signing in." />

These actions do not add files to an account or expose other files in the owner's library. Share-page browsing is inline; it has no **Extract all** action, including when the owner is signed in. To extract into Flare, the owner uses **Files → Browse archive → Extract all** in their own library. Entry paths and filenames remain visible to authorized viewers even when the outer share-page filename is hidden by a presentation setting.

::: details See shared text and image previews
<Screenshot src="/screenshots/archives/share-entry.webp" alt="Shared archive with the guide folder open, README.md text preview, and Download entry beside the member name" caption="Download entry saves the selected file; the ordinary Download action below saves the whole archive." />

<Screenshot src="/screenshots/archives/share-image.webp" alt="Public archive search for flare-icon showing the verified images/flare-icon.png preview and its download action" caption="Path search also finds image entries elsewhere in the shared archive." />
:::

Each shared archive request checks the current file access rules. Making the archive private, changing its password, or deleting it affects subsequent requests; content already previewed or downloaded cannot be recalled. Expiration follows the normal [scheduled expiry processing](./sharing#give-a-file-a-lifetime).

On a protected archive, the password you enter is checked when the archive contents load. Previews and **Download entry** then use a cookie that only this file's archive requests receive. It lasts **one hour** and the open page renews it in the background; changing or removing the file's password ends it immediately. The password itself is never added to an entry's address. If previews stop loading after the owner changes the password, reload the share page and enter the new one.

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

**Extract all** is available only for archives within the [extraction limits](#supported-sizes-and-formats) whose entries can all be extracted. Otherwise the button is unavailable, and a line below it explains why, such as the archive's size, the number of files and folders, its unpacked size, or an encrypted or unsupported entry. You can still preview and download individual files from those archives.

<Screenshot src="/screenshots/archives/extract.webp" alt="Extract archive dialog saving a new Field kit unpacked folder inside Campaigns with Private no profile selected" caption="Choose the destination and new wrapper name. Private output with no expiration is the default." />

<Screenshot src="/screenshots/archives/extract-result.webp" alt="Archive extracted confirmation showing four private files saved and an Open folder action" caption="The real extraction completed with four files; the source archive remains stored." />

The new wrapper preserves the archive's directory hierarchy. Its name follows the normal [folder rules](./folders#create-and-browse-folders): up to 80 characters and distinct within the chosen parent. The operation does not overwrite existing files or replace the original archive. Extraction reads and checks every entry before anything is published, so a damaged entry that the browser could not detect in advance still stops the operation. A failed operation does not publish a partial set of extracted files. Choose a distinct wrapper name if that destination already contains a folder with the same name.

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

**Select visible files** includes loaded cards currently on screen, not all matching results. Scroll to add files from another part of the library; selected files remain included when their cards leave the screen. Opening **Create archive** reloads the current names and sizes for the full selection. If the refresh fails, retry the action. If a selected file is no longer available, clear the selection with **Done** and choose the remaining files again.

Changing filters, folders, sorting, or grouping clears the selection, as does closing the archive dialog.

You can include up to **100 files** from your account. The result is one new library file; the selected originals keep their locations, links, permissions, and contents. Creating an archive does not reclaim storage or create an instance backup.

<Screenshot src="/screenshots/timeline/library-archive.webp" alt="Create archive dialog listing two selected files after their cards have scrolled out of the library view, with ZIP and Private no profile defaults" caption="The archive dialog keeps the full selection, including files whose cards are no longer visible." />

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

The same archive tools work in the mobile library. Scroll the dialog's fields when necessary; extraction actions remain below the scrolling content. Search, folder navigation, previews, profile choices, and permissions work the same way. Selecting an entry scrolls its preview into view below the list.

<Screenshot src="/screenshots/archives/mobile-browse.webp" alt="Archive browser at 390 pixels wide showing Field kit.zip folders, search, and Extract all" caption="Real mobile browser capture at 390px wide." />

<Screenshot src="/screenshots/archives/mobile-extract.webp" alt="Mobile Extract archive dialog with destination choices and extraction actions" caption="The extraction form scrolls within the dialog so its actions remain reachable on a phone." />

On a share page, the entry list and preview stack vertically. Scroll to **Download entry** for the selected member or the ordinary **Download** action for the whole archive.

<Screenshot src="/screenshots/archives/share-mobile.webp" alt="Shared archive at 390 pixels wide with README search result, text preview, Download entry, and whole-archive Download below" caption="Real shared-page browsing at 390px wide; the full-page capture shows both download actions." />

## Supported sizes and formats

Browsing and previews read only what they need, so they have much higher limits than extraction and creation, which process every file. **MiB** means 1,048,576 bytes and **GiB** 1,073,741,824 bytes.

| Browsing and previews                                 | Limit                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| Archive size                                          | No archive limit; the instance's upload limit still applies |
| Entries listed                                        | 100,000                                                     |
| ZIP file list read                                    | 64 MiB                                                      |
| Time spent listing a TAR, TAR.GZ, or GZIP             | 2 minutes                                                   |
| Uncompressed data read while listing a TAR.GZ or GZIP | 64 GiB                                                      |
| Text shown per preview step                           | 256 KiB                                                     |
| Image shown without choosing **Load preview**         | 50 MiB                                                      |
| Entry path                                            | 4,096 characters                                            |

| Extraction and creation                                    | Maximum          |
| ---------------------------------------------------------- | ---------------- |
| Source archive or generated archive                        | 256 MiB          |
| One archive member or one selected source file             | 256 MiB          |
| Expanded contents, or combined files selected for creation | 512 MiB          |
| Archive members, including parent directories              | 1,000            |
| Files selected for creation                                | 100              |
| Archive path depth                                         | 20 levels        |
| Archive path length                                        | 1,024 characters |
| Processing time                                            | 120 seconds      |

The instance's file-size limit and your remaining quota can impose lower limits when new files are created. Each Flare application process reads up to two archive file lists at a time; more wait briefly in a queue. It serves up to 64 entry previews and downloads at once, and 8 at once for each account or IP address. Share pages allow 120 listing requests and 600 entry requests per IP per minute in each process. Extraction and creation allow two operations per process and one per account. If the service is busy or a limit is reached, the browser waits and retries, or asks you to try again shortly.

After the initial header checks, Flare allows **five seconds** to read a share page's small browsing or download request body before authorizing file access. This submission limit does not require the archive itself to transfer in five seconds. If submission times out, retry on a stable connection.

**Supported:** ZIP with stored or deflated entries (and Zstandard entries for previews), ZIP64 and archives with a self-extractor prefix, ustar, PAX, and GNU TAR, TAR.GZ/TGZ, and GZIP, including GZIP files made of several concatenated parts. **RAR, 7z, and split archives are unsupported**; you can still download them. Encrypted entries, links, special filesystem entries, and unsafe paths are listed but can't be opened individually, and archives that contain them can't be extracted. Flare does not execute extracted programs or restore archive filesystem permissions.

## Troubleshoot an operation

When **Files** detects an account change or replacement sign-in, it closes the previous account's archive dialogs and clears the selection. An archive operation already accepted by the server can still finish. Sign back in to the original account and check its destination before retrying, so you do not create duplicate output.

| What you see                                   | What to do                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No archive action                              | Check the format and entrypoint. Library tools require `files.read`; share-page browsing requires access to the file.                                                                         |
| **Flare can’t open this kind of archive**      | RAR and 7z can't be browsed. Download the archive and open it on your device.                                                                                                                 |
| Flare couldn't find the archive's file list    | The upload was cut off, or the file isn't the archive its name suggests. Upload it again, or download it to inspect it locally.                                                               |
| An entry has a lock, link, or warning mark     | Select it to see why. Download the whole archive to open encrypted or unsupported entries locally.                                                                                            |
| An entry shows an integrity error              | That entry is damaged inside the archive. Other entries still open; extraction stops if you try it.                                                                                           |
| An entry has no preview, or a video won't play | Download it and open it locally. Preview types and your browser's codec support are separate from archive support.                                                                            |
| The list shows only part of the archive        | The notice above the list says why: the 100,000-entry limit, the listing time or size limit, or a damaged archive. Download the archive to see everything.                                    |
| **Extract all** is unavailable                 | Read the reason below the buttons. Split the work into smaller archives, or extract locally and upload the files you need. Raising an upload setting does not raise extraction limits.        |
| No extraction or creation actions              | These are owner-library operations; share pages offer browsing and downloads only. Check upload and folder permissions for your own files.                                                    |
| Destination or wrapper name rejected           | Pick an existing folder you own and a distinct new wrapper name, then retry.                                                                                                                  |
| Quota or time limit reached while extracting   | Split the work into smaller archives or selections, or extract locally and upload the files you need.                                                                                         |
| **Too many archive files are open at once**    | Close another preview or wait for a download to finish, then try again.                                                                                                                       |
| Busy messages                                  | Flare is reading several archives or running other archive operations. The browser retries a listing automatically; otherwise try again shortly.                                              |
| A protected share stops loading previews       | The owner changed the password, or the page was left open without renewing its one-hour unlock (for example, while the computer slept). Reload the share page and enter the current password. |

For contributors, the [archive API](../api/archives) describes exact requests and responses. Operators can review [archive resource requirements](../hosting/storage#archive-processing).
