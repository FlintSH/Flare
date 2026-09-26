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

Flare is operated by your instance administrator. Private files and file passwords are access controls in the application; they do not provide end-to-end encryption from the server operator.

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

| Content       | Viewer experience                                                                    |
| ------------- | ------------------------------------------------------------------------------------ |
| Images        | An inline preview with an expanded viewer for zoom and pan.                          |
| Video         | In-browser video controls when the browser supports the format and codec.            |
| Audio         | In-browser playback controls for supported formats.                                  |
| PDF           | A browser PDF preview when supported.                                                |
| Text and code | A read-only, scrollable text view; supported code types receive syntax highlighting. |
| CSV           | A scrollable table for CSV files up to 1 MiB. Larger CSV files can be downloaded.    |
| Other formats | A download-focused fallback when an inline viewer is unavailable.                    |

<Screenshot src="/screenshots/workspace/share-code.png" alt="Public code file with syntax highlighting and file actions" caption="Text and code are displayed as read-only content on the share page." />

<Screenshot src="/screenshots/workspace/share-video.png" alt="Video share page with playback controls" caption="Recordings can play directly in the browser when their codec is supported." />

Browser preview support is separate from upload support. If a preview fails, try downloading the file and opening it in an appropriate application. A share page expanded image viewer shows that shared image; it does not reveal the owner's surrounding library.

## Share pages, raw links, and downloads

The usual share link has a path such as `/your-id/screenshot.png`. It opens the Flare viewer with the instance's presentation and access checks.

Appending `/raw` requests the file content without the surrounding page. For video files, `/direct` is a helper that returns JSON containing a playback URL; it is not a general-purpose download route. Both check file access before returning a response. Appending one does not bypass private visibility or passwords. Use the page's **Download** action when you want to save a copy.

On S3 storage, an authorized response can provide a temporary signed storage URL. Anyone who obtains that already-issued URL can use it until it expires, even if you subsequently change the Flare file's access settings. Changing visibility or a password affects new Flare access checks; it does not immediately revoke existing storage URLs.

Dashboard copy buttons and generated screenshot tools copy the normal share-page URL. For automation that needs a different response URL, see the [API guide](../api/index).

## Give a file a lifetime

With `files.update`, use **Manage expiration** to schedule one of two actions:

- **Delete:** also requires `files.delete`; remove the saved file and stop the link from serving it.
- **Set to private:** also requires `files.share`; stop public access while keeping your file and its storage usage.

A previously scheduled expiration keeps running if a role grant is later revoked; cancel the schedule explicitly to stop it. Expiry work runs through the server's scheduled worker. A link can remain available until that worker processes the action. Downloaded copies and external caches cannot be recalled by expiration or deletion.

Changing account or profile defaults affects future uploads. To change the lifetime of a file already in the library, update that file's expiration directly.

## Control presentation

The instance administrator can select **Minimal**, **Framed**, or **Delivery** share-page styles and choose which details to show. An upload profile can select a style for its new uploads.

<Screenshot src="/screenshots/customization/share-minimal.png" alt="Minimal Flare share layout centered on the uploaded content" caption="Minimal keeps the focus on the content. Framed and Delivery offer different presentation choices." />

Uploader attribution, filename, size, footer, image fit, and social preview text are presentation choices. Hiding the filename on a page does not rename the downloaded file or remove a filename already present in its URL. Hidden details are also omitted from generated social text, but content already fetched by an external service may remain cached there.

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
