---
title: Uploading files
description: Upload from your browser or clipboard, choose who can open the files and how long they last, and copy their links.
---

# Uploading files

**Upload** is where files go up and come back as links. Drop, choose or paste them and they start at once, with the settings shown above the list. Dropping files onto any other dashboard page, or using a [screenshot tool](./screenshot-tools), uploads them with your saved settings.

<Screenshot src="/screenshots/workspace/upload.png" alt="Upload page: a row of option buttons, profile, Public, Never expires, Unfiled and No tags, above a large drop area that says the files upload right away" caption="Check the options, then drop, choose or paste files." />

## Upload from your browser

1. Open **Upload** and check the [options row](#choose-the-options) at the top. Each button shows what the next files will get.
2. Add files: drop them anywhere on the page, click the drop area to choose them, or copy files or a screenshot and press <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd>+<kbd>V</kbd> on a Mac). On a phone or tablet, tap **Choose files**.
3. They upload right away, one at a time. When they finish, choose **Copy 3 links** (the count follows the files), or press <kbd>Ctrl</kbd>+<kbd>C</kbd> (<kbd>⌘</kbd>+<kbd>C</kbd>) with nothing selected, and paste the links where you need them.

Each file keeps the settings that were showing when you added it. Changing a button affects the files you add next, never a file that is already waiting or sending, so you can upload one batch as public and the next as private without waiting in between. Files you add while others are still uploading join their batch and wait their turn.

While a file uploads, its row fills from left to right and shows the bytes sent, the speed and the percentage; the line above the list says which file of how many is going, the speed and about how long is left, and the browser tab's title starts with the percentage. Choose **×** on a waiting or uploading file to cancel it: nothing of it is kept, and Flare frees the parts of a large file it had already received. Once every byte has been sent the row says **Finishing…** while the server stores the file, and it can no longer be cancelled; delete it afterwards if you didn't want it. When a file arrives, its row shows its link with **Copy**, a check on its thumbnail, and icons for what it got: a lock when it is private, a key when it has a password and a clock when it expires.

A screenshot copied to the clipboard usually reaches the browser as `image.png`, so Flare names it by when you pasted it, for example `Pasted image 2026-11-22 09.05.07.png`. A copied file keeps its own name. Pressing <kbd>Ctrl</kbd>+<kbd>V</kbd> in a text field, an open menu or a dialog pastes there instead. Pasting text instead of a file offers **Make a paste**, which opens [Paste](./pastes) with the text, and pasting a single link offers **Shorten it**, which opens [Links](./short-links) with it filled in. Neither puts the text or link in the address bar.

The speed is measured over the last few seconds, appears about half a second after a file starts, and disappears once every byte has been sent. Earlier versions listed files first and uploaded them only when you chose **Upload 3 files**.

<Screenshot src="/screenshots/workspace/upload-queue.png" alt="Upload page with the expiration button changed to Deleted after 1 week and the folder to Project launch, both highlighted. Three files are uploaded with their links and Copy buttons; a fourth image is uploading, its row partly filled. Above the list, Uploading 4 of 4 and Copy 3 of 4 links" caption="Files upload as they arrive. Copy says how many links are ready." />

Uploading a ZIP, TAR, TAR.GZ/TGZ, or GZIP stores it as one file. It does not automatically extract or publish its members. Open **Browse archive** from its library menu to inspect it, or [extract into a new folder](./archives#extract-into-your-library). Archive browsing supports archives of any size, but an upload succeeding does not mean every entry can be previewed or the archive extracted; extraction has its own limits.

Anyone who can access a supported archive's [share page](./archives#browse-an-archive-shared-with-you) can browse and download its entries under the file's visibility/password rules. This does not create separate library files. Review the archive's contents before making it public.

## Choose the options

The row above the drop area starts with your saved settings: your account defaults with your default [upload profile](./upload-profiles) on top. Change a button and it is highlighted with a dot, and its menu offers **Use saved setting** to go back. Your choices apply to every file you add until you change them again or leave the page. A file waiting its turn keeps its visibility, expiration and tags, even if you edit a profile, change your default profile or change your account defaults meanwhile: Flare sends them as they were when you added it. An expiration such as **After 1 day** still counts from when the file arrives. Random or original names and the share page style come from the profile when the file arrives.

| Button                                             | What it sets                                                                                                                                                                                                                                                   | Shown to                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Profile, such as **Screenshots** or **No profile** | Which profile supplies the starting values. Each profile in the menu lists what it does: visibility, expiration, original or random names, tags and share page style. **No profile** uses your account settings only. **Manage profiles** opens your profiles. | `uploadProfiles.manage`, once you have a profile                             |
| **Public** or **Private**                          | Who can open the files: anyone with the link, or only you. A public upload can also have a password; the button then reads **Public · password**.                                                                                                              | `files.share`. Without it the row shows **Private** and uploads are private. |
| Expiration, such as **Never expires**              | **Never**, **After 1 hour**, **1 day**, **1 week** or **1 month** (counted from when each file arrives), or **Pick a date…** for a set date and time. Then choose **Delete it** or **Make it private**. The button names both, as in **Deleted after 1 day**.  | Everyone                                                                     |
| Folder, such as **Unfiled** or **Screenshots**     | Which of your folders the files go into.                                                                                                                                                                                                                       | `folders.manage`, once you have a folder                                     |
| Tags, such as **No tags** or **2 tags**            | Tags for the files. Your profile's tags start checked; changing the selection replaces them for this batch.                                                                                                                                                    | `tags.manage`, once you have a tag                                           |

A link to **Upload** can preselect a folder (`/dashboard/upload?folder=<id>`), as **Upload here** in **Files** does. Without `folders.manage`, the folder is ignored and uploads are unfiled. If the folder has since been deleted, the folder button reads **Folder unavailable**; it never moves the upload somewhere else on its own. Choosing a shared folder adds a line under the row: public files there also appear on the folder's shared link.

When the options would make an upload fail (a password that breaks the rules, a deleted folder, or a profile that does something your role can't), the reason appears under the row and files you add wait in the list as **waiting** instead of uploading. Fix the option, then choose **Upload 2 files** above the list.

Passwords apply to the files you add while one is set. They are never saved in upload profiles or exported recipes, the page forgets each file's copy once it has been sent, and a private upload ignores one. Flare accepts file passwords with at least 8 characters and at most 72 bytes; accented characters and emoji can use more than one byte each. A password that breaks the rule turns the button into **Check password**, and the reason appears under the row.

If your default profile adds tags but your role can't apply tags (`tags.manage`), the page says so and holds files until you choose another profile. If you can't choose profiles, ask your administrator to change your role or default profile.

Earlier versions kept these settings in selects and a closed **Upload options** section, and had no tag choice.

## Set an expiration

An upload with a **Delete it** expiration requires `files.delete`; **Make it private** requires `files.share`. The menu disables an action your role can't use, and picking a time keeps an action it can. A role with neither can only choose **Never**. If your saved profile or account default expires files with an action your role can't use, the page says so under the options row and holds files until you choose **Never** or the other action. To change it for good, update the profile or default, or ask the administrator for the permission.

The 1 hour to 1 month choices count from when each file arrives, so a file uploaded a minute after another expires a minute later. **Pick a date…** opens a dialog with shortcuts, a calendar and a time, and sets one moment for every file you add with it.

<Screenshot src="/screenshots/workspace/upload-expiration.png" alt="Expiration menu open on the Upload page, with Never, After 1 hour to After 1 month and Pick a date, and Delete it or Make it private below" caption="Choose when the files expire and what happens to them then." />

The server checks for due expirations every 5 seconds, so access changes a few seconds after the time you chose, not at that exact second. If an expiration can't be applied, for example while storage is unreachable, Flare tries again 1, 5 and 30 minutes later. If the last attempt also fails, the file stays as it is and **Files** stops showing its expiration; set it again from **Files → file menu → Manage expiration**, where you can also change or remove an existing schedule.

## Quick drag-and-drop

When you drop files onto a dashboard page outside **Upload**, the overlay uploads them with your default profile and account settings, without opening the Upload page.

If you are viewing a folder in **Files** and your role can organize folders (`folders.manage`), the dropped files go into that folder. Otherwise, and in **All files**, **Unfiled**, or other dashboard pages, they are unfiled. An active tag filter does not automatically tag new uploads: use a profile's tag selection or an automatic tag rule for that.

Dropped files join the same list as **Upload**, so they appear there with their links, and files dropped while others are still uploading wait their turn. The progress card in the notifications corner (bottom right, or the top on a phone-sized screen) shows the file being sent, and a notification with the links appears when the batch finishes. If a file fails, the notification says why, how many others uploaded, and offers **Open Upload**, where you can retry it and copy the others' links. Earlier builds refused files dropped while another drop was still uploading, with **An upload is already in progress**.

<Screenshot src="/screenshots/workspace/global-drop.png" alt="Dashboard file drop overlay" caption="Drop files onto the workspace for a quick upload using your saved defaults." />

## Use the finished links

**Copy** above the list copies the links of the newest batch, one per line, and so does <kbd>Ctrl</kbd>+<kbd>C</kbd> (<kbd>⌘</kbd>+<kbd>C</kbd>) or **Edit → Copy** while nothing on the page is selected and no field, menu or dialog has focus. While some files in the batch are still uploading, the button says how many links are ready, as in **Copy 2 of 3 links**. Each row's **Copy** copies that file's link. On phones and tablets with a share sheet, **Share** sends the links to another app.

The menu beside **Copy** chooses what it copies. Flare remembers the choice in this browser.

| Choice          | What is copied                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link**        | The share page, such as `https://files.example.com/alex/lake.jpg`. Chat apps show its [preview](./embeds).                                                                |
| **Direct link** | The file itself, the share page's address with `/raw` added, for embedding in a forum post or another site.                                                               |
| **Markdown**    | `![lake.jpg](https://files.example.com/alex/lake.jpg/raw)` for an image, so it shows in a README or issue; `[report.pdf](…)` linking to the share page for anything else. |

A row's menu (**⋯**) offers the other formats for that file, **Open**, and the settings the file got. Copied links never include a file password: a direct link or Markdown image of a private or password-protected file opens only for you. Screenshot tools keep copying the share page, as their [configurations](./screenshot-tools) say.

If a file went up public by mistake, choose **Make private** in its menu, or **Make 3 private** in the menu next to **Copy** for the batch; it needs `files.share`. **Delete…** in a row's menu deletes the file after you confirm, with `files.delete`; its link stops working for everyone.

The newest batch stays at the top of the list. Earlier batches move under **Earlier**, which keeps their links and menus. The list lives as long as the browser tab: go to **Files** and back and your links are still there, and uploads carry on meanwhile. Reloading or closing the tab ends it, and the browser asks first while files are still waiting or uploading. Only the latest 100 finished files are kept, and signing in as another account clears it. **Clear list** removes finished files from the list; they stay uploaded in **Files**. Files and links are kept in the tab's memory only, never in browser storage.

The link ends in a URL-friendly version of the filename: `My Report.PDF` is shared as `my-report.pdf`, and the file keeps its original name everywhere else in Flare. Uploading another file with a name you've already used gives the new file its own link with a short random suffix, such as `my-report-3f9c2a71-b04.pdf`; the earlier link doesn't change. A filename with no A to Z letters or digits, such as `日本語.png`, gets a short random link name instead. Choose random names in an [upload profile](./upload-profiles) if you'd rather not show filenames in links at all. The [file API guide](/api/files#upload-one-file) lists the exact rules.

If the browser refuses clipboard access, open the file and copy the address from there.

<Screenshot src="/screenshots/workspace/upload-complete.png" alt="Four uploaded files in Project launch, each row with a clock icon for its expiration, its link, Copy and a menu button. Above the list, Open Project launch, Link, Copy 4 links with its keyboard shortcut, and a menu button" caption="Copy gives the newest batch’s links in the format you choose." />

## Tips on an empty Upload page

Until you hide them, an empty Upload page shows up to two tips under the drop area:

- **Upload profiles** explains [profiles](./upload-profiles), and **Create a profile** opens **Profile → Uploads** at your profiles. It shows while your role has `uploadProfiles.manage` and you haven't saved a profile yet.
- **Screenshot tools** explains that [ShareX, iTake, Flameshot, Spectacle and the Bash script](./screenshot-tools) upload with your saved settings, including your default profile once you choose one, and **Set up a tool** opens their downloads. It shows while your role has `files.upload` and `tokens.manage`.

<Screenshot src="/screenshots/workspace/upload-tips.png" alt="Upload page for a new account: the options row and the drop area, then a box with two tips, Upload profiles with a Create a profile link and Screenshot tools with a Set up a tool link, and a close button" caption="A new account’s Upload page. The tips step aside while files are listed." />

The tips step aside while files are listed and come back when the list is empty. Choose **×** (**Hide these tips**) to hide them for good. Flare saves that on your account, so they stay hidden on your other devices too. If the choice can't be saved, the tips stay and Flare says so; try again. Nothing brings them back once hidden: profiles and the tools stay under **Profile → Uploads**.

## Size limits and larger files

The drop area shows the maximum allowed file size. A larger file isn't added to the list, and the page says how many weren't. Your account may also have a total storage quota, visible under **Profile → Your data**. A file can fit the per-file limit and still exceed your remaining quota. A file over either limit is refused as a whole: Flare shows **A file exceeds the upload size limit.** or **This would exceed your storage quota.**, and none of the file is saved or counted against your quota. Uploads that finish at the same time are checked one after another against your remaining quota, so together they can't go over it. Extracting or creating an [archive](./archives) applies the same limits with the same messages. Earlier versions worded these refusals six ways, for example **You have reached your storage quota.** or **The output files would exceed your storage quota.**

The browser automatically uses chunked transfers for files larger than 10 MiB. You do not need to split files yourself. Keep the tab open: this uploader does not offer a resume-after-browser-restart interface.

File types may be restricted by the administrator, and the server checks file contents as well as the reported type. Renaming a blocked file's extension does not make it an allowed file.

## Fix an upload problem

| What you see                                                                        | What to do                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File rejected before upload                                                         | Compare its size with the displayed maximum. Remove the oversized file and upload the others.                                                                                                                                                                                                                             |
| This would exceed your storage quota                                                | Check **Profile → Your data**, delete files you no longer need, or ask your administrator about the quota. Making files private does not free space.                                                                                                                                                                      |
| One file fails and the rest carry on                                                | Flare refused that file itself, for example its name or type. Its row says why, with **Retry** and **×** to remove it.                                                                                                                                                                                                    |
| **Paused · 2 waiting**                                                              | A failure that would stop every file came first: the connection, your sign-in or role, too many requests at once, your storage quota, or a server error. Files sent before it keep their links; the files after it wait. Fix the cause, then choose **Resume**, or remove the failed file with **×** to go on without it. |
| Folder unavailable                                                                  | The folder was deleted. Choose another folder. Flare will not silently move the upload somewhere else.                                                                                                                                                                                                                    |
| Storage changed during this upload (`409`)                                          | Start the affected file again. A backend change or an upgrade from older chunk-session metadata prevents reusing that upload session; completed files remain available. Earlier builds showed "Upload failed: Conflict" for files over 10 MiB instead.                                                                    |
| Network error                                                                       | Check your connection and sign-in session, then choose **Resume**. If the outcome is uncertain, check Files before uploading the file again.                                                                                                                                                                              |
| **Finishing…** but no link yet                                                      | Every byte has arrived and the server is storing the file. Wait for the link; it can't be cancelled at this point.                                                                                                                                                                                                        |
| The upload is larger than the server's request size limit                           | A reverse proxy or CDN in front of Flare refused the request, even though the file fits the maximum file size. Ask your administrator to raise its limit; see [align all upload limits](/hosting/reverse-proxy#align-all-upload-limits). Earlier builds called this a storage quota problem.                              |
| Small files work, large files fail                                                  | Give your administrator the approximate size and error message so they can check storage, proxy limits, and chunked uploads.                                                                                                                                                                                              |
| A name with accents or other scripts looks garbled, such as `cafÃ©.png`             | Earlier builds misread non-English characters in names of files up to 10 MB uploaded from the browser or with curl. New uploads keep their names, for example `café.png`. Files uploaded earlier keep the garbled name, but their links and contents are unaffected; upload the file again if you need the correct name.  |
| An uploaded file is smaller than the original, and you were near your storage quota | Earlier builds could save only the part of a file that fit in your remaining quota, or under the maximum file size, and still report success. Delete the short copy and upload the file again; Flare now refuses it with a quota or size message instead.                                                                 |

An administrator with `audit.read` can investigate [Audit log](/admin/audit) using the filename, account, time, and available request context. Upload/finalization records retain the file ID and name when the server can identify them, including useful context for some failures; they do not contain file bytes or submitted passwords. An early proxy rejection or interrupted request may not reach Flare at all, so provide the visible error and approximate time rather than assuming every failed transfer has an audit event. OCR and later background work have separate outcomes after upload acceptance. An image OCR can't read is marked as read with no text, and an `ocr.failed` event records it. Earlier versions also left a text-recognition worker running for each such image until Flare restarted, so many unreadable images could slowly use up the server's memory.

## If Upload is missing or refuses

Uploading requires `files.upload`, including drag-and-drop, screenshot tools, and chunked uploads. Role changes apply on the next request; an existing upload credential cannot bypass them. Revoking a [named API token](/api/authentication#rotate-or-revoke-a-token), or reaching its expiry, also stops an upload it is still sending: when the file has arrived, Flare refuses it and keeps none of it. Sharing changes use `files.share`. Without that permission, new uploads are private even if a profile or request selected public visibility; you can still upload when `files.upload` is granted. Existing public links stay public until explicitly changed. If Upload is unavailable, ask the instance administrator to review your [roles](/admin/roles).

<Screenshot src="/screenshots/workspace/restricted-upload.webp" alt="Upload page for a restricted role: the options row shows a plain Private label and the expiration button only, without profile, folder or tag buttons, above an uploaded file marked with a lock" caption="Restricted roles can still upload privately. The row offers only what the role can choose." />

For repeatable upload choices, continue with [upload profiles](./upload-profiles). For what recipients can see, read [sharing and privacy](./sharing).
