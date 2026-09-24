---
description: A practical map of Flare's instance settings, administrator responsibilities, and day-to-day controls.
---

# Administer your instance

Flare gives administrators control over who can join, how files are stored, what the site looks like, and how account recovery works. Open **Settings** for instance-wide choices and **Users** for account management. Your own upload defaults, tokens, and account preferences remain in **Profile**.

## Find the right control

| Section                   | What you can do                                                                                                                   | Detailed guide                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Settings → General**    | Enable background image OCR, show credits, inspect installed version and update information                                       | [General](#general)                      |
| **Settings → Access**     | Open/close registration, set the closed-registration message, configure OIDC                                                      | [Users](/admin/users), [SSO](/admin/sso) |
| **Settings → Storage**    | Select local/S3 storage, set maximum file size, enable ordinary-user quotas                                                       | [Storage](/hosting/storage)              |
| **Settings → Appearance** | Brand the instance, design light/dark themes and share pages, import/export packs, edit legacy colors/favicon and custom CSS/HTML | [Appearance](/admin/appearance)          |
| **Settings → Email**      | Configure SMTP, test delivery, enable recovery and verification, inspect the outbox                                               | [Email](/admin/email)                    |
| **Users**                 | Create/edit accounts, change roles, moderate content, remove avatars, inspect email access                                        | [Users and roles](/admin/users)          |

Settings lives at `/dashboard/settings`; Users at `/dashboard/users`. Settings links can open a section directly, for example `/dashboard/settings?section=storage`. Older `section=about` links lead to General's instance information; `section=advanced` leads to Appearance's custom styles.

<Screenshot src="/screenshots/preferences-grouping/settings-general-desktop.png" alt="Flare General settings showing image search and credits controls" caption="Settings uses the same navigation and visual language as setup and Profile." />

## General

### Background image OCR

OCR extracts text from uploaded images so it can be searched and used by OCR-based tag rules. It is enabled by default. Disable **Background OCR Processing** if you do not need it or want to reduce processing work on a small server.

Changing this switch does not erase existing OCR text. Upload options can opt individual uploads out of OCR, and extracting text is asynchronous. A successful upload does not mean text recognition is already finished or that the image contains recognizable text.

### Credits

**Show Credits Footer** controls the instance's Flare credit footer. Share pages can inherit that choice or explicitly show/hide their footer through the appearance studio. The studio's footer text is a separate design field.

### Instance information

View the installed version and release channel. Official rolling images include a commit identity and check for newer rolling releases. A custom image needs the corresponding build metadata to show it accurately. Update notices are informational; deploy a new image through your hosting system to upgrade.

## Save changes deliberately

Most Settings forms maintain a working copy until you save. Changed fields are marked and can be discarded before saving. The appearance studio has its own **Save draft / Publish appearance** workflow, and Email has dedicated testing, policy review, and save behavior. A saved studio draft does not alter the live site.

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

Administrators can inspect and moderate user content, including private and password-protected files. File privacy is an application access rule, not encryption that hides bytes from the server operator. Grant administrator roles only to people who should control the whole instance.

Flare currently has two roles, **Admin** and **User**. There are no organization groups, delegated moderators, per-user quota overrides, or built-in account suspension state. The [role matrix](/admin/users#roles-and-permissions) describes the supported boundaries.
