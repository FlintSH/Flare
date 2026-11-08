---
title: Your first five minutes
description: Get comfortable with Flare, upload your first file, and choose how to share it.
---

# Your first five minutes

Flare gives you a home for screenshots, recordings, files, text, and links on a server you control. Upload something, get a link, and decide who can open it. Your library keeps everything together, with folders, tags, search, and previews when you need them.

This guide is for people using an existing Flare instance. Everyone supplies the starting permissions; additional [roles](/admin/roles) can add capabilities, and administrators can restrict the baseline. A missing navigation item or unavailable action may reflect your current permissions. If you're installing your own, start with the [administrator guide](../admin/index).

<Screenshot src="/screenshots/timeline/library-desktop.webp" alt="Flare file library with image previews, search, folders, and file controls" caption="Scroll through every file and use the date rail to jump through your upload history." />

## Join your instance

Open the address your administrator gave you and sign in. Depending on the instance, you may see a registration option, a sign-in button for an identity provider, or only a local email and password form.

- **Registration available:** create an account, then follow any email-verification instructions. The password field keeps its requirements visible: at least eight characters and at most 72 bytes. Plain English letters use one byte each; emoji and accented letters can use more. Some combined emoji count as several characters toward the minimum. After leaving an invalid password field or trying to submit, an error stays beside that field until corrected; confirmation errors identify the confirmation field. A password outside those limits must be corrected before registration is sent.
- **Registration closed:** ask the administrator for access, or open an [invite link](./invites#what-the-invited-person-sees) if someone sent you one. A public file link does not require an account unless the file's access settings require one.
- **Two-factor authentication:** after your password, enter your authenticator code or a saved recovery code if you enabled this protection. [Set it up](./security).
- **Passkeys:** choose **Sign in with a passkey** to use a passkey already registered to your account. [Add a passkey](./security#add-a-passkey).
- **Passkey required:** password and SSO sign-in are blocked after you explicitly enable this setting. A refused attempt brings the passkey action and dedicated recovery forward; **Change account** returns to the ordinary form. Use your passkey, or **Use a passkey recovery code** with your email and one dedicated emergency code. [Understand the requirement](./security#require-a-passkey-for-sign-in).
- **Single sign-on:** use the provider offered by your instance. Existing local accounts are not automatically linked to SSO accounts with the same email address.

The name, colors, logo, and background can differ between instances. The tasks and controls described here stay the same.

<Screenshot src="/screenshots/security/passkey-login.webp" alt="Flare login with email and password fields and a separate Sign in with a passkey button" caption="Use an allowed account method. Requiring passkeys disables password and SSO sign-in; dedicated passkey recovery codes remain an emergency option." />

## Upload and share your first file

1. Open **Upload** in the navigation.
2. Drop a file into the selection area, or click it to browse your device.
3. Open **Upload options** to change visibility. Choose **Public (anyone with the link)** to share it with another person, or **Private (only me)** to keep it in your account; accounts with `content.read` also retain access. Roles without sharing permission upload privately and see **Expiration options** instead.
4. Optionally add a password or expiration.
5. Start the upload and wait for the completion result.
6. Choose **Copy link**, then send that link to your recipient.

The copied link opens a Flare share page. A password or private setting still applies after copying. For a useful access check, open a public link in a signed-out browser window: your own signed-in session can access files that other people cannot.

Continue with [uploading files](./uploading) and [sharing and privacy](./sharing).

## Find your way around

Keyboard users can press **Tab** to reveal **Skip to content**, then **Enter** to move past the navigation to the page.

The bar at the top of the dashboard holds your own places: **Files**, **Upload**, **Paste**, and **Links**. Select your avatar at the right of the bar for the account menu, which has **Profile** and **Sign out**. If your roles let you help run the instance, the bar ends with an **Admin** menu after a thin divider.

<Screenshot src="/screenshots/navigation/admin-menu.webp" alt="Dashboard bar with Files, Upload, Paste, and Links, then a divider and an open Admin menu listing Users, Roles, Audit log, and Settings, each with a short description" caption="Administration pages share one Admin menu, so the bar stays the same length however much access you have." />

| Place                      | What you can do                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Files**                  | Search, preview, download, organize, and manage access to uploaded files and pastes.                                 |
| **Upload**                 | Queue files and choose the destination, upload profile, visibility, password, and expiration.                        |
| **Paste**                  | Save text or code as a shareable file.                                                                               |
| **Links**                  | Create short redirects under your instance's domain and see their click counts.                                      |
| **Profile → Account**      | Update identity, password, email, appearance, login history, and active sessions.                                    |
| **Profile → Uploads**      | Configure screenshot tools, reusable upload profiles, and account upload defaults.                                   |
| **Profile → Integrations** | Create scoped API tokens and outgoing webhooks.                                                                      |
| **Profile → Your data**    | Check storage use, export data, or delete your account.                                                              |
| **Admin → Users**          | Manage accounts and their roles. Needs `users.read`; the **Invites** tab needs `invites.create` or `invites.manage`. |
| **Admin → Roles**          | Create and combine permission groups. Needs `roles.manage`.                                                          |
| **Admin → Audit log**      | Investigate activity across the instance. Needs `audit.read`.                                                        |
| **Admin → Settings**       | Configure the instance. Needs `settings.read`.                                                                       |

The **Admin** menu lists only the pages your roles allow. If they allow just one, that page sits in the bar by itself instead of in a menu, for example **Audit log** for an account whose only administration permission is `audit.read`. Without any of these permissions there is no **Admin** menu. While you are on one of its pages, the **Admin** button is highlighted and the menu marks the current page. On **Profile**, a ring around your avatar shows where you are.

The instance name and logo at the start of the bar open **Files**, or **Profile** if your roles don't include `files.read`. A bookmark or link to a page your roles don't allow opens **Profile** instead.

**Upload**, **Paste**, and **Links** have a **Workspace** label above their page title. An unknown `/dashboard/...` address shows **Page not found** while keeping the dashboard navigation. Choose **Go to your files**, or **Go to Profile** when your roles do not allow Files, to return to a page you can open. The dashboard checks sign-in and required email verification before showing its navigation, including for a mistyped address.

A missing workspace page returns HTTP 404, including nested or file-like addresses. If you are signed out, sign in first; required email verification still applies.

The dashboard requires JavaScript. If a page stays on loading placeholders or a missing-page screen is blank, enable JavaScript for this site, check whether a browser extension blocked its scripts, and reload.

<Screenshot src="/screenshots/navigation/account-menu.webp" alt="Account menu open below the avatar, showing the account's name and email address, then Profile and Sign out" caption="Your avatar opens the account menu. Sign out here, from the navigation sheet on a phone, or from the top of Profile." />

When the window is too narrow for the bar, choose the menu button next to your avatar. It lists your places, then the administration pages under an **Admin** heading, then **Profile** and **Sign out** under **Account**. Your avatar still opens the account menu too. With four places or fewer, the full bar shows from 768 pixels wide; with more, including the **Admin** menu, it shows from 900 pixels.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/navigation/mobile-sheet.webp" alt="Navigation sheet on a phone listing Files, Upload, Paste, and Links, then Users, Roles, Audit log, and Settings under an Admin heading, then Profile and Sign out under an Account heading" caption="On a phone, the sheet groups administration and your account under their own headings." />
</div>

Earlier versions put every page in the bar, including **Profile**, **Users**, **Roles**, **Audit log**, and **Settings**, and showed the menu button to everyone below 1280 pixels. Page addresses haven't changed, so bookmarks such as `/dashboard/settings` and `/dashboard/profile` still work.

On touch devices, shared buttons, inputs, selects, and menu rows have larger targets; switches and radio controls keep compact visuals with larger hit areas, and calendar days use a compact seven-column grid while the desktop keeps compact controls. Keyboard focus stays visible, and reduced-motion preferences suppress UI animation.

If a dashboard page cannot load, **Try again** appears inside the workspace so navigation remains available.

Profile and Settings remember the selected section in the page address, so browser Back and Forward work when moving between sections.

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

In a confirmation dialog’s bottom button group, **Cancel**, **Keep account**, or the other keep action appears before the confirming action: above it on phones and to its left when the buttons fit in a row. The action names state what you are confirming, such as **Delete link**, **Revoke**, or **Delete account**.

## A few things to know early

**An instance is its own service.** Accounts, limits, storage, registration, email, and branding belong to that installation. Ask its administrator about availability and backups.

**Use a current browser.** Flare supports Chrome, Edge, and Firefox 111 or later and Safari 16.4 or later. On an iPhone or iPad every browser uses Safari's engine, so the device needs iOS or iPadOS 16.4 or later. Older browsers aren't supported, and the dashboard and share pages may not work in them, for you or for the people you send links to.

**Public means accessible by link.** Treat the link as something recipients can forward. A folder share can also list public files placed directly in that folder.

**Private and password-protected are different.** A password on a public file lets another person unlock it. A password on a private file does not give other people access.

**Defaults affect future uploads.** Changing a profile, default expiration, or URL-naming choice does not rewrite files already uploaded.

**Deletion is permanent in Flare.** Download or export anything you need before deleting a file or account. There is no user-facing trash or undo flow.

**Error messages give Flare's reason.** When Flare refuses a change, such as a save, upload, or delete, the message says why, such as **Permission denied** or **File not found**. If a proxy or sign-in gateway in front of Flare answers with its own page instead, you see the screen's usual message, such as **Couldn’t update folders. Please try again.**; earlier versions showed a script error such as `Unexpected token '<'` in folder and tag dialogs, **Profile → Integrations**, and your appearance preference. Ask the operator if such messages keep appearing.

If the shared API request cannot receive or finish reading a response, it shows **Connection problem. Check the result before trying again.** rather than browser text such as `Failed to fetch`. Check your connection. Before repeating a save, creation, or deletion, check whether it already completed; a lost response does not mean the server rejected the change. This request helper does not automatically repeat the action. A server refusal still keeps its own explanation.

## Where to go next

- [Browse, search, and preview your library](./library)
- [Organize with folders](./folders) and [tags](./tags)
- [Share text and code](./pastes), or [shorten a URL](./short-links)
- [Choose your workspace appearance](./appearance)
- [Manage your account and export data](./account)
