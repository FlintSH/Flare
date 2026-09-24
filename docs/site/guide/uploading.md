---
title: Uploading files
description: Upload from your browser, manage a queue, choose access and expiration, and recover from upload failures.
---

# Uploading files

Use **Upload** when you want to review settings before sending files. For quick uploads with your saved defaults, drop files onto another dashboard page or use a [screenshot tool](./screenshot-tools).

<Screenshot src="/screenshots/workspace/upload.png" alt="Flare upload page with a file drop area and sharing options" caption="The upload page brings file selection and sharing choices into one flow." />

## Upload from your browser

1. Open **Upload**.
2. Click the file-selection area or drag files into it. You can select several files and add more to the queue before starting.
3. Review filenames and sizes. Remove an individual file, or clear the queue if you want to start again.
4. If you have folders, choose **Save to**. **Unfiled** leaves the upload outside a folder.
5. Choose an upload profile and any one-time sharing options.
6. Start the upload. Wait for the completion links before closing the tab.

The same selected options apply to the queued files. To give different files different passwords or destinations, upload them in separate batches. The open form keeps its chosen settings after a successful batch, including the password and visibility override. Review or reset them before uploading something different.

<Screenshot src="/screenshots/workspace/upload-queue.png" alt="Several selected files in the upload queue" caption="Review your queue before uploading. Each file displays its size and transfer progress." />

## Choose your upload settings

| Setting                 | What it does                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Save to**             | Puts the file in one of your folders. A public file placed directly in a shared folder also appears on that folder's share page. |
| **Upload profile**      | Applies a saved collection of upload choices. Use account settings directly to bypass the default profile.                       |
| **Visibility**          | Inherit from the selected/default profile, or explicitly choose public or private.                                               |
| **Password protection** | Requires recipients of a public file to enter the password before opening it. Owners and administrators retain access.           |
| **File expiration**     | Inherit the profile's expiration, choose a time and action, or explicitly select no expiration.                                  |

Choosing **From upload profile** also includes the account defaults that the profile inherits. If you have not configured a default profile, account and instance settings supply the starting values. See [upload profiles](./upload-profiles) for the exact order.

Passwords are specific to these uploads. They are never saved in upload profiles or exported profile recipes. Flare accepts file passwords up to 72 bytes; accented characters and emoji can use more than one byte each.

## Set an expiration

Open **File expiration** and choose what should happen:

- **Delete file:** remove the file and its stored contents.
- **Set to private:** keep the file in your account and stop public access. The file still uses storage.

Use the one-hour, one-day, one-week, or one-month shortcuts, or choose a custom date and time. Confirm the choice before starting the upload. **No expiration** explicitly turns an inherited expiration off for this upload; **Use profile expiration** returns to the saved behavior.

<Screenshot src="/screenshots/workspace/upload-expiration-custom.png" alt="Custom file expiration date and time controls" caption="Choose an expiration date together with the action Flare should take." />

Expiration is processed by the server's scheduled worker. Allow for its processing interval; it is not a promise that access changes at an exact second. You can change or remove an existing file's schedule with **Files → file menu → Manage expiration**.

## Quick drag-and-drop

When you drop files onto a dashboard page outside **Upload**, the overlay starts uploading with your default profile and account settings. It does not pause for the full upload form.

If you are viewing a folder in **Files**, the dropped files go into that folder. In **All files**, **Unfiled**, or other dashboard pages, they are unfiled. An active tag filter does not automatically tag new uploads: use a profile's tag selection or an automatic tag rule for that.

<Screenshot src="/screenshots/workspace/global-drop.png" alt="Dashboard file drop overlay" caption="Drop files onto the workspace for a quick upload using your saved defaults." />

## Use the finished links

The completion section gives each successful upload an open action and **Copy link**. With multiple results, **Copy all links** copies one share-page URL per line. You can also find every completed file in **Files**.

These controls always copy the plain share-page URL. They do not include a password or grant access to a private file. If the browser refuses clipboard access, select the displayed link and copy it manually.

<Screenshot src="/screenshots/workspace/upload-complete.png" alt="Successful uploads with share links and copy actions" caption="Successful upload results stay available so you can open or copy each link." />

## Size limits and larger files

The selection area shows the maximum allowed file size. Your account may also have a total storage quota, visible under **Profile → Your data**. A file can fit the per-file limit and still exceed your remaining quota.

The browser automatically uses chunked transfers for files larger than 10 MiB. You do not need to split files yourself. Keep the tab open: this uploader does not offer a resume-after-browser-restart interface.

File types may be restricted by the administrator, and the server checks file contents as well as the reported type. Renaming a blocked file's extension does not make it an allowed file.

## Fix an upload problem

| What you see                              | What to do                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| File rejected before upload               | Compare its size with the displayed maximum. Remove the oversized file and upload the others.                                                        |
| Storage quota exceeded                    | Check **Profile → Your data**, delete files you no longer need, or ask your administrator about the quota. Making files private does not free space. |
| A batch stops partway through             | Keep the successful links. Completed files leave the queue; retry uploads for the files still waiting.                                               |
| Folder unavailable                        | Choose another destination. Flare will not silently move the upload somewhere else if its destination was deleted.                                   |
| Network error                             | Check your connection and sign-in session, then retry the remaining files. If the outcome is uncertain, check Files before submitting again.         |
| Progress reaches 100% but no link appears | File transfer has finished, but finalization may still be running. Wait for the completion result.                                                   |
| Small files work, large files fail        | Give your administrator the approximate size and error message so they can check storage, proxy limits, and chunked uploads.                         |

For repeatable upload choices, continue with [upload profiles](./upload-profiles). For what recipients can see, read [sharing and privacy](./sharing).
