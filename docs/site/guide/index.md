---
title: Your first five minutes
description: Get comfortable with Flare, upload your first file, and choose how to share it.
---

# Your first five minutes

Flare gives you a home for screenshots, recordings, files, text, and links on a server you control. Upload something, get a link, and decide who can open it. Your library keeps everything together, with folders, tags, search, and previews when you need them.

This guide is for people using an existing Flare instance. Everyone supplies the starting permissions; additional [roles](/admin/roles) can add capabilities, and administrators can restrict the baseline. A missing navigation item or unavailable action may reflect your current permissions. If you're installing your own, start with the [administrator guide](../admin/index).

<Screenshot src="/screenshots/workspace/files-library.png" alt="Flare file library with image previews, search, and file controls" caption="Your file library is the starting point for browsing, organizing, and sharing." />

## Join your instance

Open the address your administrator gave you and sign in. Depending on the instance, you may see a registration option, a sign-in button for an identity provider, or only a local email and password form.

- **Registration available:** create an account, then follow any email-verification instructions.
- **Registration closed:** ask the administrator for access. A public file link does not require an account unless the file's access settings require one.
- **Single sign-on:** use the provider offered by your instance. Existing local accounts are not automatically linked to SSO accounts with the same email address.

The name, colors, logo, and background can differ between instances. The tasks and controls described here stay the same.

## Upload and share your first file

1. Open **Upload** in the navigation.
2. Drop a file into the selection area, or click it to browse your device.
3. Choose **Public (anyone with the link)** to share it with another person. Choose **Private (only me)** to keep it in your account; accounts with `content.read` also retain access.
4. Optionally add a password or expiration.
5. Start the upload and wait for the completion result.
6. Choose **Copy link**, then send that link to your recipient.

The copied link opens a Flare share page. A password or private setting still applies after copying. For a useful access check, open a public link in a signed-out browser window: your own signed-in session can access files that other people cannot.

Continue with [uploading files](./uploading) and [sharing and privacy](./sharing).

## Find your way around

| Place                      | What you can do                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| **Files**                  | Search, preview, download, organize, and manage access to uploaded files and pastes.          |
| **Upload**                 | Queue files and choose the destination, upload profile, visibility, password, and expiration. |
| **Paste**                  | Save text or code as a shareable file.                                                        |
| **Links**                  | Create short redirects under your instance's domain and see their click counts.               |
| **Profile → Account**      | Update identity, password, email, and personal workspace appearance.                          |
| **Profile → Uploads**      | Configure screenshot tools, reusable upload profiles, and account upload defaults.            |
| **Profile → Integrations** | Create scoped API tokens and outgoing webhooks.                                               |
| **Profile → Your data**    | Check storage use, export data, or delete your account.                                       |
| **Users / Settings**       | Administrator controls for accounts and the instance.                                         |

On a small screen, use the navigation menu to reach these pages. Profile and Settings remember the selected section in the page address, so browser Back and Forward work when moving between sections.

## Build a workflow that fits

::: details I share screenshots throughout the day
Create a **Public screenshots** [upload profile](./upload-profiles), review its defaults, and download a [capture-tool configuration](./screenshot-tools) from that profile. A capture can upload and copy its share link without opening the dashboard. Add a filename tag rule to collect related captures automatically.
:::

::: details I need a private working library
Create a private upload profile and make it your default. Use [folders](./folders) for projects and [tags](./tags) for topics that cross project boundaries. Private files are accessible to you (with `files.read`) and accounts with `content.read`. Making a folder public does not expose its private files.
:::

::: details I send temporary reviews or recordings
Use a profile with public visibility, a relative expiration, and **Make private** as its expiry action. The public link stops being accessible after the scheduled action runs, while the file remains in your library. Choose **Delete file** instead if you also want Flare to remove the stored copy.
:::

::: details I want to automate uploads
Start with a generated [Bash script](./screenshot-tools#bash-upload-any-file). For a custom application, use a [named API token](../api/authentication) with only the permissions it needs. [Webhooks](../api/webhooks) notify a receiver when a file is ready.
:::

## A few things to know early

**An instance is its own service.** Accounts, limits, storage, registration, email, and branding belong to that installation. Ask its administrator about availability and backups.

**Public means accessible by link.** Treat the link as something recipients can forward. A folder share can also list public files placed directly in that folder.

**Private and password-protected are different.** A password on a public file lets another person unlock it. A password on a private file does not give other people access.

**Defaults affect future uploads.** Changing a profile, default expiration, or URL-naming choice does not rewrite files already uploaded.

**Deletion is permanent in Flare.** Download or export anything you need before deleting a file or account. There is no user-facing trash or undo flow.

## Where to go next

- [Browse, search, and preview your library](./library)
- [Organize with folders](./folders) and [tags](./tags)
- [Share text and code](./pastes), or [shorten a URL](./short-links)
- [Choose your workspace appearance](./appearance)
- [Manage your account and export data](./account)
