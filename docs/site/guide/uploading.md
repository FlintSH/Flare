---
title: Uploading files
description: Upload from your browser, manage a queue, choose access and expiration, and recover from upload failures.
---

# Uploading files

Uploading requires `files.upload`, including drag-and-drop, screenshot tools, and chunked uploads. Role changes apply on the next request; an existing upload credential cannot bypass them. Revoking a [named API token](/api/authentication#rotate-or-revoke-a-token), or reaching its expiry, also stops an upload it is still sending: when the file has arrived, Flare refuses it and keeps none of it. Sharing changes use `files.share`. Without that permission, new uploads are private even if a profile or request selected public visibility; you can still upload when `files.upload` is granted. Existing public links stay public until explicitly changed. If Upload is unavailable, ask the instance administrator to review your [roles](/admin/roles).

Use **Upload** when you want to review settings before sending files. For quick uploads with your saved defaults, drop files onto another dashboard page or use a [screenshot tool](./screenshot-tools).

<Screenshot src="/screenshots/workspace/upload.png" alt="Flare upload page with a file drop area, effective upload settings, and collapsed Upload options" caption="The upload page brings file selection and sharing choices into one flow." />

## Encrypted by default

Files you upload in the browser are encrypted on your device before they are sent. The **Encryption** choice in the form has two options:

- **Encrypted** is the default. The server stores ciphertext and cannot read the file, its name or its type. Its link shows a generic preview on other sites.
- **Plain (can show a link preview)** stores the file as it is. The server and its administrators can read it, and its link can show the content in a chat or social preview.

The choice applies to every file in the batch. [Encrypted and plain files](./encryption) explains what the server still sees and what does not work yet for encrypted files.

When you select an [upload profile](./upload-profiles#encryption), the form shows that profile's Encryption setting first: **Plain** for a profile set to Plain. What you select afterwards is what is used. On a server whose administrator [forbids plain uploads](/admin/#forbid-plain-uploads), the form has no choice and says that the server accepts encrypted uploads only.

Encrypting needs your keys. If the form says your encryption keys are locked, choose **Unlock** and enter your [passphrase](./passphrase). Until then **Upload** stays disabled for an encrypted batch. Files dropped elsewhere in Flare are encrypted too; with locked keys the drop is refused with a message and nothing is sent.

Large files are encrypted and sent in parts of about 5 MB, so the browser never holds the whole file in memory. While a batch is being sent, **Cancel upload** stops it. Files already finished stay in your library; the file in progress is not stored.

<Screenshot src="/screenshots/encryption/upload-progress.webp" alt="The upload form while an 11 MB file is encrypted and sent, with a progress bar and a Cancel upload button" caption="An encrypted upload reports progress like any other and can be cancelled." />

After an encrypted upload, the links under **Upload complete** carry the file's key after `#`. Copy them from there or later from the library. A link Flare's server builds, such as the one in an audit record, cannot open the file.

## Upload from your browser

1. Open **Upload**.
2. Click the file-selection area or drag files into it. You can select several files and add more to the queue before starting.
3. Review filenames and sizes. Remove an individual file, or clear the queue if you want to start again.
4. If your role has `uploadProfiles.manage`, choose an **Upload profile**. The line under it shows the effective visibility, password protection, expiration action, and filename behavior for this batch. Without that permission, your saved defaults apply automatically.
5. If you have folders and your role can organize them (`folders.manage`), choose **Save to**. **Unfiled** leaves the upload outside a folder. Open **Upload options** for one-time visibility, password, or expiration overrides. You can leave it closed to use your saved defaults.
6. Start the upload. Wait for the completion links before closing the tab.

While files upload, the queue shows each file's progress, and a progress card shows the file being sent and its percentage. Drag-and-drop uploads use the same card. It has its own place on screen, so notifications such as **Copied to clipboard** don't cover it: the top left, below the navigation bar, or the bottom on a phone-sized screen. Close it with **×** if it's in the way; the upload continues, and the card returns for the next file. Earlier builds showed progress as a notification, so any other notification replaced it for the rest of that file.

The same selected options apply to the queued files. To give different files different passwords or destinations, upload them in separate batches. The open form keeps its chosen settings after a successful batch, including the password and visibility override. Review or reset them before uploading something different.

Uploading a ZIP, TAR, TAR.GZ/TGZ, or GZIP stores it as one file. It does not automatically extract or publish its members. Open **Browse archive** from its library menu to inspect it, or [extract into a new folder](./archives#extract-into-your-library). Archive browsing supports archives of any size, but an upload succeeding does not mean every entry can be previewed or the archive extracted; extraction has its own limits.

Anyone who can access a supported archive's [share page](./archives#browse-an-archive-shared-with-you) can browse and download its entries under the file's visibility/password rules. This does not create separate library files. Review the archive's contents before making it public.

<Screenshot src="/screenshots/workspace/upload-queue.png" alt="Several selected files in the upload queue" caption="Review your queue before uploading. Each file displays its size and transfer progress." />

**Upload options** (or **Expiration options** when your role cannot share) starts closed so file selection and the upload action stay easy to reach. Its status changes to **Customized** after an override. Closing it keeps your choices; when profile selection is available, its effective summary stays visible and updates as you change them. **Save to** stays outside the disclosure so you can always review the destination. Password protection and expiration controls are still available to the same roles as before this layout change.

## Choose your upload settings

| Setting                 | What it does                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upload profile**      | Applies a saved collection of upload choices (`uploadProfiles.manage`). Use account settings directly to bypass the default profile.                                                                                                                                                                                                                                    |
| **Save to**             | Puts the file in one of your folders (`folders.manage`). A public file directly in a shared folder also appears on that folder's share page.                                                                                                                                                                                                                            |
| **Visibility**          | Inherit from the selected/default profile, or explicitly choose public or private.                                                                                                                                                                                                                                                                                      |
| **Password protection** | Requires recipients of a public file to enter the password before opening it. For a plain file the server checks it, and eligible owners and accounts with `content.read` retain access. For an encrypted file the password is part of the key: it must pass a strength check in your browser, the server never receives it, and only you can open the file without it. |
| **File expiration**     | Inherit the profile's expiration, choose a time and action, or explicitly select no expiration.                                                                                                                                                                                                                                                                         |

Without `folders.manage`, the upload page doesn't show **Save to** and uploads are unfiled, including when a link opens **Upload** with a folder selected. Earlier builds showed **Save to** to these roles anyway, and the server refused the upload with "Your role cannot organize uploads into folders."

<Screenshot src="/screenshots/workspace/restricted-upload.webp" alt="Restricted upload page showing private uploads, automatic saved defaults, and expanded Expiration options, without profile selection, sharing, password, or folder controls" caption="Restricted roles can still upload privately. Saved defaults apply automatically, and the page offers only permitted choices." />

Choosing **From upload profile** also includes the account defaults that the profile inherits. If you have not configured a default profile, account and instance settings supply the starting values. See [upload profiles](./upload-profiles) for the exact order.

Passwords are specific to these uploads. They are never saved in upload profiles or exported profile recipes. For plain files Flare accepts file passwords with at least 8 characters and at most 72 bytes; accented characters and emoji can use more than one byte each. An encrypted file's password has no such limit, but a short or common one is refused by the strength meter under the field.

## Set an expiration

An upload with a **Delete file** expiration requires `files.delete`; **Set to private** requires `files.share`. This also applies when expiration comes from a saved profile or account default. If the upload is rejected after a role change, choose no expiration (or a permitted action), update the profile/default, or ask the administrator for the required permission.

Open **File expiration** and choose what should happen:

- **Delete file:** remove the file and its stored contents.
- **Set to private:** keep the file in your account and stop public access. The file still uses storage.

Use the one-hour, one-day, one-week, or one-month shortcuts, or choose a custom date and time. Confirm the choice before starting the upload. **No expiration** explicitly turns an inherited expiration off for this upload; **Use profile expiration** returns to the saved behavior.

<Screenshot src="/screenshots/workspace/upload-expiration-custom.png" alt="Custom file expiration date and time controls" caption="Choose an expiration date together with the action Flare should take." />

The server checks for due expirations every 5 seconds, so access changes a few seconds after the time you chose, not at that exact second. If an expiration can't be applied, for example while storage is unreachable, Flare tries again 1, 5 and 30 minutes later. If the last attempt also fails, the file stays as it is and **Files** stops showing its expiration; set it again from **Files → file menu → Manage expiration**, where you can also change or remove an existing schedule.

## Quick drag-and-drop

When you drop files onto a dashboard page outside **Upload**, the overlay starts uploading with your default profile and account settings. It does not pause for the full upload form.

If you are viewing a folder in **Files** and your role can organize folders (`folders.manage`), the dropped files go into that folder. Otherwise, and in **All files**, **Unfiled**, or other dashboard pages, they are unfiled. An active tag filter does not automatically tag new uploads: use a profile's tag selection or an automatic tag rule for that.

Each drop is its own batch, sent one file at a time. If a file fails, the files after it aren't sent, and the failure message offers **Retry**, which sends the files that weren't uploaded to the same destination. The next drop sends only its own files. Files dropped while an earlier drop is still uploading aren't added: the drop overlay doesn't appear, and Flare shows **An upload is already in progress**. Drop them again when it finishes. Earlier builds kept failed files and sent them again before the next drop's files, so a file that kept failing, for example because of your storage quota, stopped every later drop with its own error until the page was reloaded.

<Screenshot src="/screenshots/workspace/global-drop.png" alt="Dashboard file drop overlay" caption="Drop files onto the workspace for a quick upload using your saved defaults." />

## Use the finished links

The completion section gives each successful upload an open action and **Copy link**. With multiple results, **Copy all links** copies one share-page URL per line. You can also find every completed file in **Files**.

For a plain file these controls copy the share-page URL. For an encrypted file they copy the URL with the file's key after `#`, or with `#p.` and a link secret when you set a password. They never include a password and do not grant access to a private file. If the browser refuses clipboard access, select the displayed link and copy it manually.

The link ends in a URL-friendly version of the filename: `My Report.PDF` is shared as `my-report.pdf`, and the file keeps its original name everywhere else in Flare. Uploading another file with a name you've already used gives the new file its own link with a short random suffix, such as `my-report-3f9c2a71-b04.pdf`; the earlier link doesn't change. A filename with no A to Z letters or digits, such as `日本語.png`, gets a short random link name instead. Choose random names in an [upload profile](./upload-profiles) if you'd rather not show filenames in links at all. The [file API guide](/api/files#upload-one-file) lists the exact rules.

<Screenshot src="/screenshots/workspace/upload-complete.png" alt="Successful uploads with share links and copy actions" caption="Successful upload results stay available so you can open or copy each link." />

## Size limits and larger files

The selection area shows the maximum allowed file size. Your account may also have a total storage quota, visible under **Profile → Your data**. A file can fit the per-file limit and still exceed your remaining quota. A file over either limit is refused as a whole: Flare shows **A file exceeds the upload size limit.** or **This would exceed your storage quota.**, and none of the file is saved or counted against your quota. Uploads that finish at the same time are checked one after another against your remaining quota, so together they can't go over it. Extracting or creating an [archive](./archives) applies the same limits with the same messages. Earlier versions worded these refusals six ways, for example **You have reached your storage quota.** or **The output files would exceed your storage quota.**

The browser automatically uses chunked transfers for files larger than 10 MiB. You do not need to split files yourself. Keep the tab open: this uploader does not offer a resume-after-browser-restart interface.

File types may be restricted by the administrator, and the server checks file contents as well as the reported type. Renaming a blocked file's extension does not make it an allowed file.

## Fix an upload problem

| What you see                                                                        | What to do                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File rejected before upload                                                         | Compare its size with the displayed maximum. Remove the oversized file and upload the others.                                                                                                                                                                                                                            |
| This would exceed your storage quota                                                | Check **Profile → Your data**, delete files you no longer need, or ask your administrator about the quota. Making files private does not free space.                                                                                                                                                                     |
| A batch stops partway through                                                       | Keep the successful links. On **Upload**, completed files leave the queue; start the upload again for the files still waiting. After a drag-and-drop, choose **Retry** in the failure message or drop the remaining files again.                                                                                         |
| Folder unavailable                                                                  | Choose another destination. Flare will not silently move the upload somewhere else if its destination was deleted.                                                                                                                                                                                                       |
| Storage changed during this upload (`409`)                                          | Start the affected file again. A backend change or an upgrade from older chunk-session metadata prevents reusing that upload session; completed files remain available. Earlier builds showed "Upload failed: Conflict" for files over 10 MiB instead.                                                                   |
| Network error                                                                       | Check your connection and sign-in session, then retry the remaining files. If the outcome is uncertain, check Files before submitting again.                                                                                                                                                                             |
| Progress reaches 100% but no link appears                                           | File transfer has finished, but finalization may still be running. Wait for the completion result.                                                                                                                                                                                                                       |
| The upload is larger than the server's request size limit                           | A reverse proxy or CDN in front of Flare refused the request, even though the file fits the maximum file size. Ask your administrator to raise its limit; see [align all upload limits](/hosting/reverse-proxy#align-all-upload-limits). Earlier builds called this a storage quota problem.                             |
| Small files work, large files fail                                                  | Give your administrator the approximate size and error message so they can check storage, proxy limits, and chunked uploads.                                                                                                                                                                                             |
| A name with accents or other scripts looks garbled, such as `cafÃ©.png`             | Earlier builds misread non-English characters in names of files up to 10 MB uploaded from the browser or with curl. New uploads keep their names, for example `café.png`. Files uploaded earlier keep the garbled name, but their links and contents are unaffected; upload the file again if you need the correct name. |
| An uploaded file is smaller than the original, and you were near your storage quota | Earlier builds could save only the part of a file that fit in your remaining quota, or under the maximum file size, and still report success. Delete the short copy and upload the file again; Flare now refuses it with a quota or size message instead.                                                                |

An administrator with `audit.read` can investigate [Audit log](/admin/audit) using the filename, account, time, and available request context. Upload/finalization records retain the file ID and name when the server can identify them, including useful context for some failures; they do not contain file bytes or submitted passwords. An early proxy rejection or interrupted request may not reach Flare at all, so provide the visible error and approximate time rather than assuming every failed transfer has an audit event. OCR and later background work have separate outcomes after upload acceptance. An image OCR can't read is marked as read with no text, and an `ocr.failed` event records it. Earlier versions also left a text-recognition worker running for each such image until Flare restarted, so many unreadable images could slowly use up the server's memory.

For repeatable upload choices, continue with [upload profiles](./upload-profiles). For what recipients can see, read [sharing and privacy](./sharing).

If a password is invalid, one explanation appears beside its field while **Upload options** is open. Closing the options moves that explanation beside **Review password**. Choose **Review password** to reopen the options and focus the field. Correct or remove the password to enable creation.
