---
description: A practical map of Flare's instance settings, administrator responsibilities, and day-to-day controls.
---

# Administer your instance

Flare gives administrators control over who can join, how files are stored, what the site looks like, and how account recovery works. Open the **Admin** menu at the end of the dashboard bar and choose **Settings** for instance-wide choices, **Users** for account management, **Roles** for reusable permission groups, or **Audit log** for instance activity. The menu lists only the pages your roles allow; when they allow just one, that page appears in the bar by itself. Each area and action follows your assigned permissions. Your own upload defaults, tokens, and account preferences remain in **Profile**, in the account menu under your avatar. [Find your way around](/guide/#find-your-way-around) shows both menus.

## Find the right control

| Section                   | What you can do                                                                                                                                    | Detailed guide                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Settings → General**    | Enable background image OCR, show credits, inspect installed version and update information                                                        | [General](#general)                                                 |
| **Settings → Access**     | Open/close registration, set the closed-registration message, choose who can invite and member invite limits, configure OIDC, forbid plain uploads | [Users](/admin/users), [SSO](/admin/sso), [Encryption](#encryption) |
| **Settings → Storage**    | Select local/S3 storage, set maximum file size, enable storage quotas                                                                              | [Storage](/hosting/storage)                                         |
| **Settings → Appearance** | Brand the instance, design light/dark themes and share pages, import/export packs, edit legacy colors/favicon and custom CSS/HTML                  | [Appearance](/admin/appearance)                                     |
| **Settings → Email**      | Configure SMTP, test delivery, enable recovery and verification, inspect the outbox                                                                | [Email](/admin/email)                                               |
| **Roles**                 | Create, organize, and combine permission groups; delegate account, content, or settings work                                                       | [Roles and permissions](/admin/roles)                               |
| **Audit log**             | Search instance events and inspect actors, filenames, processing outcomes, and administrative changes; requires `audit.read`                       | [Audit log](/admin/audit)                                           |
| **Users**                 | Create/edit accounts, change roles, moderate content, remove avatars, inspect email access, review and revoke invite links                         | [Users and roles](/admin/users)                                     |

Settings lives at `/dashboard/settings`; Users at `/dashboard/users`; Roles at `/dashboard/roles`; Audit log at `/dashboard/audit`. Settings links can open a section directly, for example `/dashboard/settings?section=storage`. Older `section=about` links lead to General's instance information; `section=advanced` leads to Appearance's custom styles.

Choose **Documentation** in the **Settings** header to open the handbook in a new tab. The link stays available in every settings section, including on phones, so you can read a guide while keeping unsaved changes in the original tab.

Stable builds open the archive for their installed release; rolling builds open the published rolling handbook. During setup, versions before 2.1.0 open their archive homepage for the original setup instructions; newer versions open the dedicated setup guide. Rolling documentation follows the latest published rolling commit, so it may be ahead of an older rolling installation. An unknown or other prerelease version opens [Versions](/versions) for you to choose. Custom builds use their package version and configured release channel; see [build identity](/hosting/configuration#core-environment-variables) if those do not match your source.

<Screenshot src="/screenshots/documentation-links/settings-desktop.webp" alt="Settings on desktop with a Documentation link above the General controls" caption="Open Documentation from the settings header without leaving your working form." />

::: details Find the link on a phone
<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/documentation-links/settings-mobile.webp" alt="Settings on a phone with the Documentation link in its header" caption="The handbook is also one tap away in mobile settings." />
</div>
:::

## General

Reading instance settings needs `settings.read`; changing General needs `settings.general`. Access/SSO uses `settings.security`, Storage uses `settings.storage`, Email uses `settings.email`, and instance appearance uses `appearance.manage`. Custom CSS/head HTML requires Administrator because it can execute browser code. Give the read permission alongside the relevant edit permission when delegating dashboard settings work.

### Background image OCR

OCR extracts text from uploaded images so it can be searched and used by OCR-based tag rules. It is enabled by default. Disable **Background OCR processing** if you do not need it or want to reduce processing work on a small server.

The switch covers both kinds of file, and the work happens in different places:

- **Plain images** are read by the server, one at a time, as before.
- **Encrypted images** are read in the browser of their owner, because the server holds only ciphertext. That costs your server nothing but serving the recognition program and its language data, about 7 MB that each browser caches. With the switch off, browsers do not read new images by themselves either.

In both cases a person can still choose **Extract text (OCR)** on one image.

OCR processing outcomes can be investigated in [Audit log](./audit); the audit details do not include extracted text. Changing this switch does not erase existing OCR text. Upload options can opt individual uploads out of OCR, and extracting text is asynchronous. A successful upload does not mean text recognition is already finished or that the image contains recognizable text.

### Credits

**Show credits footer** controls the instance's Flare credit footer. Share pages can inherit that choice or explicitly show/hide their footer through the appearance studio; shared folders, file password pages, and the not-found page follow the share pages. The studio's footer text is a separate design field.

### Instance information

View the installed version and release channel. Official rolling images include a commit identity and check for newer rolling releases. A custom image needs the corresponding build metadata to show it accurately. Update notices are informational; deploy a new image through your hosting system to upgrade.

## Encryption

**Settings → Access → Encryption** needs `settings.security` to change. Files are encrypted in the browser, or by the [flare-upload](/guide/screenshot-tools) program, before they reach the server. There is no switch that turns encryption off, for the instance or for a user.

### Forbid plain uploads

By default people can still choose a [plain upload](/guide/encryption#choose-encrypted-or-plain), for one file or through an upload profile, when a link must show its content in a preview on other sites. Turn on **Forbid plain uploads** to refuse every upload that is not encrypted. It is off on a new instance and after an upgrade.

<Screenshot src="/screenshots/preferences/settings-encryption.png" alt="The Encryption card in Access settings with the Forbid plain uploads switch turned on and marked as changed" caption="Forbid plain uploads is in Settings → Access. It takes effect when you save." />

With the switch on:

| Where                                                     | What happens                                                                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload form and paste form                                | The **Encryption** choice is not shown. Every upload is encrypted.                                                                                                          |
| Upload profiles                                           | **Plain** cannot be selected. A profile that is already Plain stays as it is and its uploads are refused.                                                                   |
| Tools with a token for a Plain profile                    | Refused with `403` and the code `plain_uploads_forbidden`.                                                                                                                  |
| Tool configurations and API tokens from before encryption | Refused in the same way. They can only send plain files, so they stop uploading until the person [creates a new configuration](/guide/screenshot-tools#old-configurations). |
| Archive extraction and archive creation                   | Refused: the server would write plain files.                                                                                                                                |
| Uploads already in progress                               | A chunked plain upload that started before the save is refused when it completes.                                                                                           |

The switch does not touch files that are plain already: they stay readable by the server, keep their link previews, and can still be viewed, downloaded and deleted. It does not encrypt anything by itself.

Before you turn it on, tell people who use screenshot tools. Each of them needs flare-upload and a new configuration first, or their captures stop arriving. The public settings (`GET /api/settings`) say whether the switch is on, so a tool can tell its user why an upload was refused.

Turning it off again restores the Plain choice at once. Uploads that were refused in between are not kept or retried.

## Save changes deliberately

Most Settings forms maintain a working copy until you save. Changed fields are marked and can be discarded before saving. The appearance studio has its own **Save draft / Publish appearance** workflow, and Email has dedicated testing, policy review, and save behavior. A saved studio draft does not alter the live site.

When a save fails, its message gives Flare's reason. If something between your browser and Flare, such as a reverse proxy or a sign-in gateway, answers with its own page instead, the screen shows its usual failure message, for example **Appearance could not be saved.** in the appearance studio, **Could not save this role.** in **Roles**, or **Failed to update user** in **Users**. Earlier versions showed a script error such as `Unexpected token '<'` on those screens.

Environment-managed email controls are read-only in the dashboard. Adjust the deployment override or remove it to restore the saved fallback. [Configuration precedence](/hosting/configuration#how-changes-take-effect) explains the distinction.

## A good first-day checklist

1. Complete [setup](/admin/setup) and keep a working local administrator login.
2. Confirm local persistence or S3 access with an upload/download/delete test.
3. Choose registration and quota policies before inviting users.
4. Set your public domain and verify generated links use it.
5. If enabling email, verify the administrator's recovery address before requiring verification for everyone.
6. Publish an appearance after checking light, dark, mobile, and protected-file previews.
7. Create and restore a [backup](/hosting/maintenance).

## What administration means for privacy

Accounts with `content.read`, including Administrator, can inspect private and password-protected files. Content changes and deletion have separate permissions. File privacy is an application access rule, not encryption that hides bytes from the server operator. When a visitor submits a file password on a share page, it travels in the page's address (`?password=…`), and once accepted, in the addresses of the page's preview and download requests too, so reverse-proxy access logs can record it. Signed-in accounts with `content.read` open protected files without the password form. Grant administrator roles only to people who should control the whole instance.

Every account inherits Everyone and can hold multiple additional roles. Assign narrowly scoped roles for moderation, account support, or appearance design. The [roles guide](/admin/roles) explains additive grants, hierarchy, immediate revocation, and recovery protection. There are no per-user numeric quota overrides or built-in account suspension states.
