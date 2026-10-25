---
title: Sharing and privacy
description: Understand public and private files, password protection, expiration, direct links, and recipient previews.
---

# Sharing and privacy

Every file has a share-page URL. Its visibility and password decide who can open it; the page's design decides how it looks. Copying a URL, choosing a layout, or hiding a filename does not change file access.

## Choose who can open a file

| File setting               | Owner   | Account with `content.read` | Other signed-in users | Signed-out visitors |
| -------------------------- | ------- | --------------------------- | --------------------- | ------------------- |
| Public, no password        | Allowed | Allowed                     | Allowed               | Allowed             |
| Public, password-protected | Allowed | Allowed                     | Password required     | Password required   |
| Private                    | Allowed | Allowed                     | Denied                | Denied              |
| Private, with a password   | Allowed | Allowed                     | Denied                | Denied              |

The Owner column assumes the signed-in owner has `files.read`. The moderation column includes Administrator and delegated content readers, even when their role has no settings access. Removing `files.read` removes the owner’s privileged access to private/password-protected files; public visitor rules still apply.

Private files deliberately return a not-found response to people without access. Another person signing in to the same instance does not make your private file accessible to them. Giving them its password does not override private visibility.

The signed-in library is account-specific. When an open tab detects a different account or replacement browser session, it discards the previous files, selection, and dialogs before loading the current account's library. [Saved URL filters still apply](./library#change-accounts-or-sign-in-again); they do not grant access to the previous account's files.

Flare is operated by your instance administrator. Private files and file passwords are access controls in the application; they do not provide end-to-end encryption from the server operator.

## Activity visible to administrators

Flare records [instance audit events](/admin/audit) for application activity, including file operations and background processing. People with `audit.read` can inspect recorded filenames, account attribution, outcomes, and selected metadata, including activity involving private files. This permission does not itself grant file-content access. Deleting a file or account does not erase the retained audit record; ask your operator about retention and backups. Downloaded copies and direct object-storage requests are outside Flare's application audit boundary.

## Share a public file

1. Set its visibility to **Public** while uploading, or choose **Change visibility** from its library menu.
2. Choose **Copy link**.
3. Send the copied URL to your recipient.
4. If you added a password, send that separately.

Test with a signed-out browser window if you want to see the recipient experience. As an owner, you bypass your own file's password prompt.

Public files can be opened by anyone who obtains their URL, including someone a recipient forwards it to. Flare does not make your whole library public merely because an individual file is public. [Sharing a folder](./folders#share-a-folder) explicitly creates a listing of that folder's direct public files.

## Protect a link with a password

Add a password in the upload form, or use **Files → file menu → Add password**. For an already protected file, **Manage password** lets you replace or remove it. Recipients open the link and enter the password to unlock the viewer.

<Screenshot src="/screenshots/workspace/share-protected.png" alt="Password-protected share page asking a visitor to unlock the file" caption="A protected public file asks visitors for its password before showing the content." />

Changing a password changes what future access checks accept. It cannot remove a copy that somebody already downloaded. For a temporary handoff, combine a password with an expiration.

If you need to stop public access while keeping your copy, set the file to **Private**. Removing password protection from a public file makes it accessible without a password.

## What recipients can preview

| Content       | Viewer experience                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Images        | An inline preview with an expanded viewer for zoom and pan.                                                                                  |
| Video         | In-browser video controls when the browser supports the format and codec.                                                                    |
| Audio         | In-browser playback controls for supported formats.                                                                                          |
| PDF           | A browser PDF preview when supported.                                                                                                        |
| Text and code | A read-only, scrollable text view; supported code types receive syntax highlighting.                                                         |
| CSV           | A scrollable table for CSV files up to 1 MiB. Larger CSV files can be downloaded.                                                            |
| Archives      | Browse folders and paths, preview supported entries, and download an entry or the complete archive. Extraction stays in the owner's library. |
| Other formats | A download-focused fallback when an inline viewer is unavailable.                                                                            |

<Screenshot src="/screenshots/workspace/share-code.png" alt="Public code file with syntax highlighting and file actions" caption="Text and code are displayed as read-only content on the share page." />

<Screenshot src="/screenshots/workspace/share-video.png" alt="Video share page with playback controls" caption="Recordings can play directly in the browser when their codec is supported." />

Browser preview support is separate from upload support. If a preview fails, try downloading the file and opening it in an appropriate application. A share page expanded image viewer shows that shared image; it does not reveal the owner's surrounding library.

Flare never lets an uploaded file run as part of its own site. Raw links, file paths under `/api/files/`, and image previews are served in a browser sandbox, so an HTML page, SVG drawing, or other active document opened from a Flare link cannot run scripts, read the viewer's Flare session, or act on their behalf. SVG images still display; only their scripts are blocked. This protects people who open a link, including administrators reviewing other accounts' uploads.

A public archive exposes its member paths and bytes to authorized recipients through the [archive browser](./archives#browse-an-archive-shared-with-you), even if those files originally had private links or Flare passwords. Protected public archives require the file password before browsing or entry downloads; a private archive remains unavailable to other ordinary users even if they know its password. Share-page browsing does not add files to an account or offer extraction. [Archive creation](./archives#create-an-archive-from-selected-files) defaults to private and does not embed source sharing controls or encrypt the result. An explicitly selected public upload profile can make the new archive public immediately; review its contents and the profile summary before confirming.

## Share pages, raw links, and downloads

The usual share link has a path such as `/your-id/screenshot.png`. It opens the Flare viewer with the instance's presentation and access checks.

Appending `/raw` requests the file content without the surrounding page. For video files, `/direct` is a helper that returns JSON containing a playback URL; it is not a general-purpose download route. Both check file access before returning a response. Appending one does not bypass private visibility or passwords. Use the page's **Download** action when you want to save a copy.

On S3 storage, an authorized response can provide a temporary signed storage URL. Anyone who obtains that already-issued URL can use it until it expires, even if you subsequently change the Flare file's access settings. Changing visibility or a password affects new Flare access checks; it does not immediately revoke existing storage URLs.

Dashboard copy buttons and generated screenshot tools copy the normal share-page URL. For automation that needs a different response URL, see the [API guide](../api/index).

### Browser and CDN caching

Content from a private or password-protected file, including what a visitor unlocks with the password, is sent with `Cache-Control: private, no-store`, so browsers and shared caches such as a CDN do not keep a copy. Public files without a password can be cached: their video at the `/api/files/...` content URL that upload tools return, and their image thumbnails, for up to a year.

That cache is not recalled when access changes. If you make a cached public file private or add a password, a visitor's browser or a CDN in front of Flare can keep serving the copy it already has. Ask the operator to purge the file's paths from the CDN. A browser keeps its copy until it expires or its cache is cleared. Earlier releases also marked private and password-protected video at `/api/files/...` as cacheable for a year; [operators with a CDN](../hosting/reverse-proxy#keep-access-decisions-in-flare) should purge those paths once after upgrading.

### View counts

The view total on a [library file card](./library#understand-activity-and-refresh) includes share-page visits and successful `GET` requests to `/{userUrlId}/{filename}/raw`. Each raw request adds one view, including a `206` byte-range response used for media playback. Raw requests denied by visibility or password checks, missing files, storage failures before a stream is opened, and `HEAD` probes do not add views.

This is a request count, not a count of unique people or completed transfers. Bots, link previews, repeat requests, and each media range request can add views. Opening a share page that loads its content through `/raw` can add both a page view and raw-content views. Browser or external-cache hits that do not reach Flare add no raw views; `/direct` lookups and reads from an issued S3 URL do not add raw views either.

After upgrading, existing totals are retained and new raw requests contribute immediately. Earlier raw requests are not backfilled; no configuration change or database migration is needed. Refresh the library after opening a raw link to see its updated total.

If a raw request returns `500`, Flare may have failed to open the stored file or save its view count. The request stops and its storage stream is closed. Ask the operator to [check storage and database availability](../hosting/troubleshooting#raw-links-return-500), then retry; a failed counter write does not add a view.

<Screenshot src="/screenshots/sharing/raw-view-count.webp" alt="Real Flare library showing nine views for raw-view-fixture.txt after one full raw request and one range request" caption="This disposable local file started with seven views. A full raw request and a range request raised its displayed total to nine; a HEAD probe left it unchanged." />

## Give a file a lifetime

With `files.update`, use **Manage expiration** to schedule one of two actions:

- **Delete:** also requires `files.delete`; remove the saved file and stop the link from serving it.
- **Set to private:** also requires `files.share`; stop public access while keeping your file and its storage usage.

A previously scheduled expiration keeps running if a role grant is later revoked; cancel the schedule explicitly to stop it. Expiry work runs through the server's scheduled worker. A link can remain available until that worker processes the action. Downloaded copies and external caches cannot be recalled by expiration or deletion.

Changing account or profile defaults affects future uploads. To change the lifetime of a file already in the library, update that file's expiration directly.

## Control presentation

The instance administrator can select **Minimal**, **Framed**, or **Delivery** share-page styles and choose which details to show. An upload profile can select a style for its new uploads.

<Screenshot src="/screenshots/customization/share-minimal.png" alt="Minimal Flare share layout centered on the uploaded content" caption="Minimal keeps the focus on the content. Framed and Delivery offer different presentation choices." />

Uploader attribution, filename, size, footer, image fit, and social preview text are presentation choices. Hiding the filename on a page does not rename the downloaded file or remove a filename already present in its URL. For archives, the outer label can be **Shared file**, while authorized viewers can still see member paths and names inside the archive. Hidden details are also omitted from generated social text, but content already fetched by an external service may remain cached there.

See [appearance](./appearance) for personal settings and [upload profiles](./upload-profiles) for selecting a style per workflow.

::: details My recipient sees “not found,” but the file opens for me
Check visibility first. You can open your private files while another person cannot. Also check whether the link uses an old vanity path, the file was deleted or expired, or the recipient has a disabled folder-share link.
:::

::: details My protected file doesn't ask me for a password
Owners with `files.read` and accounts with `content.read` bypass file-password prompts. Open the link while signed out to check the visitor experience.
:::

::: details Will disabling a folder link revoke the file links inside it?
No. It stops that folder-share route. Individual public file links continue to work. Make individual files private or delete them if those links should stop working too.
:::
