---
title: Uploading files
description: Upload from your browser or clipboard, choose who can open the files and how long they last, and copy their links.
---

# Uploading files

**Upload** is where you send files with the settings you choose and leave with their links. For quick uploads with your saved settings, drop files onto any other dashboard page or use a [screenshot tool](./screenshot-tools).

<Screenshot src="/screenshots/workspace/upload.png" alt="Upload page with a large drop area and a row of option buttons: profile, Public, Never expires, Unfiled and No tags, with the Upload button at the end" caption="Drop or paste files, check the options row, and upload." />

## Upload from your browser

1. Open **Upload**.
2. Add files: drop them on the dashed area, click it to choose files, or copy files or a screenshot and press <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd>+<kbd>V</kbd> on a Mac) anywhere on the page. On a phone or tablet, tap **Choose files**. Add more at any time before uploading. Remove one with **×**, or choose **Clear** to start again.
3. Check the [options row](#choose-the-options) under the drop area. Each button shows what this upload will get. Change any of them for this batch.
4. Choose **Upload 3 files** (the count follows your list).

Every file stays in one list. While a file uploads, its row shows the bytes sent, the speed and the percentage; files waiting their turn say **waiting**. When a file arrives, its row shows its link with **Copy link** and an open button, and a check on its thumbnail. With two or more uploaded, **Copy all links** copies one link per line, and **Open** with the folder's name appears when the batch went into a folder. The list stays until you choose **Clear** or leave the page.

A screenshot copied to the clipboard usually reaches the browser as `image.png`, so Flare names it by when you pasted it, for example `Pasted image 2026-11-22 09.05.07.png`. A copied file keeps its own name. Pressing <kbd>Ctrl</kbd>+<kbd>V</kbd> in a text field, an open menu or a dialog pastes there instead.

The speed is measured over the last few seconds, appears about half a second after a file starts, and disappears once every byte has been sent, while the server stores the file. The progress card in the notifications corner (bottom right, or the top on a phone-sized screen) shows the same details. If you leave **Upload** while files are still sending, the upload carries on and a notification with the links appears when it finishes.

<Screenshot src="/screenshots/workspace/upload-queue.png" alt="Four files in the upload list with thumbnails and sizes, the expiration button changed to Deleted after 1 week and highlighted, and Upload 4 files at the end of the options row" caption="Files wait in the list until you upload them. A changed option is highlighted." />

Uploading a ZIP, TAR, TAR.GZ/TGZ, or GZIP stores it as one file. It does not automatically extract or publish its members. Open **Browse archive** from its library menu to inspect it, or [extract into a new folder](./archives#extract-into-your-library). Archive browsing supports archives of any size, but an upload succeeding does not mean every entry can be previewed or the archive extracted; extraction has its own limits.

Anyone who can access a supported archive's [share page](./archives#browse-an-archive-shared-with-you) can browse and download its entries under the file's visibility/password rules. This does not create separate library files. Review the archive's contents before making it public.

## Choose the options

The row under the drop area starts with your saved settings: your account defaults with your default [upload profile](./upload-profiles) on top. Change a button and it is highlighted with a dot, and its menu offers **Use saved setting** to go back. Choices apply to every file in the batch and stay for the next batch until you leave the page. To give files different settings, upload them in separate batches.

| Button                                             | What it sets                                                                                                                                                                                                                                                   | Shown to                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Profile, such as **Screenshots** or **No profile** | Which profile supplies the starting values. Each profile in the menu lists what it does: visibility, expiration, original or random names, tags and share page style. **No profile** uses your account settings only. **Manage profiles** opens your profiles. | `uploadProfiles.manage`, once you have a profile                             |
| **Public** or **Private**                          | Who can open the files: anyone with the link, or only you. A public upload can also have a password; the button then reads **Public · password**.                                                                                                              | `files.share`. Without it the row shows **Private** and uploads are private. |
| Expiration, such as **Never expires**              | **Never**, **After 1 hour**, **1 day**, **1 week** or **1 month** (counted from when each file arrives), or **Pick a date…** for a set date and time. Then choose **Delete it** or **Make it private**. The button names both, as in **Deleted after 1 day**.  | Everyone                                                                     |
| Folder, such as **Unfiled** or **Screenshots**     | Which of your folders the files go into.                                                                                                                                                                                                                       | `folders.manage`, once you have a folder                                     |
| Tags, such as **No tags** or **2 tags**            | Tags for the files. Your profile's tags start checked; changing the selection replaces them for this batch.                                                                                                                                                    | `tags.manage`, once you have a tag                                           |

A link to **Upload** can preselect a folder (`/dashboard/upload?folder=<id>`), as **Upload here** in **Files** does. Without `folders.manage`, the folder is ignored and uploads are unfiled. If the folder has since been deleted, the folder button reads **Folder unavailable** and Flare won't upload until you choose another; it never moves the upload somewhere else on its own. Choosing a shared folder adds a line under the row: public files there also appear on the folder's shared link.

Passwords apply to this batch only. They are never saved in upload profiles or exported recipes, and a private upload ignores one. Flare accepts file passwords with at least 8 characters and at most 72 bytes; accented characters and emoji can use more than one byte each. A password that breaks the rule turns the button into **Check password**, and the reason appears under the row.

If your default profile adds tags but your role can't apply tags (`tags.manage`), the page says so and won't upload. Choose another profile, or, if you can't choose profiles, ask your administrator to change your role or default profile.

Earlier versions kept these settings in selects and a closed **Upload options** section, and had no tag choice.

## Set an expiration

An upload with a **Delete it** expiration requires `files.delete`; **Make it private** requires `files.share`. The menu disables an action your role can't use, and picking a time keeps an action it can. A role with neither can only choose **Never**. If your saved profile or account default expires files with an action your role can't use, the page says so under the options row and won't upload until you choose **Never** or the other action. To change it for good, update the profile or default, or ask the administrator for the permission.

The 1 hour to 1 month choices count from when each file arrives, so a file uploaded a minute after another expires a minute later. **Pick a date…** opens a dialog with shortcuts, a calendar and a time, and sets one moment for the whole batch.

<Screenshot src="/screenshots/workspace/upload-expiration.png" alt="Expiration menu open on the Upload page, with Never, After 1 hour to After 1 month and Pick a date, and Delete it or Make it private below" caption="Choose when the files expire and what happens to them then." />

The server checks for due expirations every 5 seconds, so access changes a few seconds after the time you chose, not at that exact second. If an expiration can't be applied, for example while storage is unreachable, Flare tries again 1, 5 and 30 minutes later. If the last attempt also fails, the file stays as it is and **Files** stops showing its expiration; set it again from **Files → file menu → Manage expiration**, where you can also change or remove an existing schedule.

## Quick drag-and-drop

When you drop files onto a dashboard page outside **Upload**, the overlay starts uploading with your default profile and account settings. It does not pause for the full upload form.

If you are viewing a folder in **Files** and your role can organize folders (`folders.manage`), the dropped files go into that folder. Otherwise, and in **All files**, **Unfiled**, or other dashboard pages, they are unfiled. An active tag filter does not automatically tag new uploads: use a profile's tag selection or an automatic tag rule for that.

Each drop is its own batch, sent one file at a time. If a file fails, the files after it aren't sent, and the failure message offers **Retry**, which sends the files that weren't uploaded to the same destination. The next drop sends only its own files. Files dropped while an earlier drop is still uploading aren't added: the drop overlay doesn't appear, and Flare shows **An upload is already in progress**. Drop them again when it finishes. Earlier builds kept failed files and sent them again before the next drop's files, so a file that kept failing, for example because of your storage quota, stopped every later drop with its own error until the page was reloaded.

<Screenshot src="/screenshots/workspace/global-drop.png" alt="Dashboard file drop overlay" caption="Drop files onto the workspace for a quick upload using your saved defaults." />

## Use the finished links

Each uploaded file's row shows its link with **Copy link** and an open button, and **Copy all links** copies every link in the list, one per line. You can also find every uploaded file in **Files**.

These buttons copy the plain share-page link. They don't include a password or grant access to a private file. If the browser refuses clipboard access, open the file and copy the address from there.

The link ends in a URL-friendly version of the filename: `My Report.PDF` is shared as `my-report.pdf`, and the file keeps its original name everywhere else in Flare. Uploading another file with a name you've already used gives the new file its own link with a short random suffix, such as `my-report-3f9c2a71-b04.pdf`; the earlier link doesn't change. A filename with no A to Z letters or digits, such as `日本語.png`, gets a short random link name instead. Choose random names in an [upload profile](./upload-profiles) if you'd rather not show filenames in links at all. The [file API guide](/api/files#upload-one-file) lists the exact rules.

<Screenshot src="/screenshots/workspace/upload-complete.png" alt="Four uploaded files, each row with its link, Copy link and an open button, and Copy all links and Clear above the list" caption="Uploaded files keep their links in the list until you clear it." />

## Tips on an empty Upload page

Until you hide them, an empty Upload page shows up to two tips under the options row:

- **Upload profiles** explains [profiles](./upload-profiles), and **Create a profile** opens **Profile → Uploads** at your profiles. It shows while your role has `uploadProfiles.manage` and you haven't saved a profile yet.
- **Screenshot tools** explains that [ShareX, iTake, Flameshot, Spectacle and the Bash script](./screenshot-tools) upload with your saved settings, including your default profile once you choose one, and **Set up a tool** opens their downloads. It shows while your role has `files.upload` and `tokens.manage`.

<Screenshot src="/screenshots/workspace/upload-tips.png" alt="Upload page for a new account: under the drop area and the options row, a box with two tips, Upload profiles with a Create a profile link and Screenshot tools with a Set up a tool link, and a close button" caption="A new account's Upload page. The tips step aside while files are listed." />

The tips step aside while files are listed and come back when you clear the list. Choose **×** (**Hide these tips**) to hide them for good. Flare saves that on your account, so they stay hidden on your other devices too. If the choice can't be saved, the tips stay and Flare says so; try again. Nothing brings them back once hidden: profiles and the tools stay under **Profile → Uploads**.

## Size limits and larger files

The drop area shows the maximum allowed file size. A larger file isn't added to the list, and the page says how many weren't. Your account may also have a total storage quota, visible under **Profile → Your data**. A file can fit the per-file limit and still exceed your remaining quota. A file over either limit is refused as a whole: Flare shows **A file exceeds the upload size limit.** or **This would exceed your storage quota.**, and none of the file is saved or counted against your quota. Uploads that finish at the same time are checked one after another against your remaining quota, so together they can't go over it. Extracting or creating an [archive](./archives) applies the same limits with the same messages. Earlier versions worded these refusals six ways, for example **You have reached your storage quota.** or **The output files would exceed your storage quota.**

The browser automatically uses chunked transfers for files larger than 10 MiB. You do not need to split files yourself. Keep the tab open: this uploader does not offer a resume-after-browser-restart interface.

File types may be restricted by the administrator, and the server checks file contents as well as the reported type. Renaming a blocked file's extension does not make it an allowed file.

## Fix an upload problem

| What you see                                                                        | What to do                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File rejected before upload                                                         | Compare its size with the displayed maximum. Remove the oversized file and upload the others.                                                                                                                                                                                                                            |
| This would exceed your storage quota                                                | Check **Profile → Your data**, delete files you no longer need, or ask your administrator about the quota. Making files private does not free space.                                                                                                                                                                     |
| A batch stops partway through                                                       | Files sent before the failure keep their links. On **Upload**, the file that failed shows why, and it and the files after it stay in the list: choose **Retry**. After a drag-and-drop, choose **Retry** in the failure message or drop the remaining files again.                                                       |
| Folder unavailable                                                                  | The folder was deleted. Choose another folder. Flare will not silently move the upload somewhere else.                                                                                                                                                                                                                   |
| Storage changed during this upload (`409`)                                          | Start the affected file again. A backend change or an upgrade from older chunk-session metadata prevents reusing that upload session; completed files remain available. Earlier builds showed "Upload failed: Conflict" for files over 10 MiB instead.                                                                   |
| Network error                                                                       | Check your connection and sign-in session, then retry the remaining files. If the outcome is uncertain, check Files before submitting again.                                                                                                                                                                             |
| Progress reaches 100% but no link appears                                           | File transfer has finished, but finalization may still be running. Wait for the completion result.                                                                                                                                                                                                                       |
| The upload is larger than the server's request size limit                           | A reverse proxy or CDN in front of Flare refused the request, even though the file fits the maximum file size. Ask your administrator to raise its limit; see [align all upload limits](/hosting/reverse-proxy#align-all-upload-limits). Earlier builds called this a storage quota problem.                             |
| Small files work, large files fail                                                  | Give your administrator the approximate size and error message so they can check storage, proxy limits, and chunked uploads.                                                                                                                                                                                             |
| A name with accents or other scripts looks garbled, such as `cafÃ©.png`             | Earlier builds misread non-English characters in names of files up to 10 MB uploaded from the browser or with curl. New uploads keep their names, for example `café.png`. Files uploaded earlier keep the garbled name, but their links and contents are unaffected; upload the file again if you need the correct name. |
| An uploaded file is smaller than the original, and you were near your storage quota | Earlier builds could save only the part of a file that fit in your remaining quota, or under the maximum file size, and still report success. Delete the short copy and upload the file again; Flare now refuses it with a quota or size message instead.                                                                |

An administrator with `audit.read` can investigate [Audit log](/admin/audit) using the filename, account, time, and available request context. Upload/finalization records retain the file ID and name when the server can identify them, including useful context for some failures; they do not contain file bytes or submitted passwords. An early proxy rejection or interrupted request may not reach Flare at all, so provide the visible error and approximate time rather than assuming every failed transfer has an audit event. OCR and later background work have separate outcomes after upload acceptance. An image OCR can't read is marked as read with no text, and an `ocr.failed` event records it. Earlier versions also left a text-recognition worker running for each such image until Flare restarted, so many unreadable images could slowly use up the server's memory.

## If Upload is missing or refuses

Uploading requires `files.upload`, including drag-and-drop, screenshot tools, and chunked uploads. Role changes apply on the next request; an existing upload credential cannot bypass them. Revoking a [named API token](/api/authentication#rotate-or-revoke-a-token), or reaching its expiry, also stops an upload it is still sending: when the file has arrived, Flare refuses it and keeps none of it. Sharing changes use `files.share`. Without that permission, new uploads are private even if a profile or request selected public visibility; you can still upload when `files.upload` is granted. Existing public links stay public until explicitly changed. If Upload is unavailable, ask the instance administrator to review your [roles](/admin/roles).

<Screenshot src="/screenshots/workspace/restricted-upload.webp" alt="Upload page for a restricted role: the options row shows a plain Private label and the expiration button only, without profile, folder or tag buttons" caption="Restricted roles can still upload privately. The row offers only what the role can choose." />

For repeatable upload choices, continue with [upload profiles](./upload-profiles). For what recipients can see, read [sharing and privacy](./sharing).
