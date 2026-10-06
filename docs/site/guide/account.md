---
title: Account, email, and data
description: Manage your identity and sign-in details, verify or change email, check storage, and export your Flare data.
---

# Account, email, and data

Your [roles](/admin/roles) determine which profile actions are available. Editing identity/avatar or upload defaults uses `profile.update`, downloading account data requires `profile.export`, `files.read`, and `links.read` together, managing tokens uses `tokens.manage`, and managing webhooks uses `webhooks.manage`. Personal appearance uses `appearance.personal`. Missing controls can reflect your permissions; contact the person managing roles for your instance.

Open **Profile** from the account menu to manage settings that belong to you. **Settings** is the administrator's separate area for instance-wide behavior.

<Screenshot src="/screenshots/roles/profile-roles.webp" alt="Profile Account section showing the demonstration account’s Moderator, Creator, and Everyone roles above its identity fields" caption="Your roles shows the account’s current grants alongside identity and personal preferences." />

Verification, recovery-address enrollment, password recovery, and confirmed email-change flows remain available under their own identity and email-policy checks, even without `profile.update`. Role restrictions on application preferences do not remove those account-security paths.

## Protect your sign-in

**Profile → Account → Sign-in security** contains authenticator setup, recovery codes, and passkeys. [Follow the complete security guide](./security) to enable two-factor authentication, save a recovery method, and test passkey sign-in. These controls remain available without `profile.update` and require their own identity confirmation. Adding/removing sign-in methods and replacing recovery codes end existing browser sessions, so save any newly displayed recovery codes before signing in again.

**Require passkey to sign in** is a separate opt-in setting, off by default. It blocks password and SSO sign-in and gives you ten dedicated emergency codes, each capable of signing in with only your account email. Save these separately from authenticator recovery codes. Registration alone does not enable the requirement. [Enable it and prepare recovery](./security#require-a-passkey-for-sign-in).

## See your roles

**Profile → Account → Your roles** shows your current role badges. Everyone applies automatically. Additional roles add permissions; a role name or color alone does not describe its authority. Ask the instance administrator to review a missing capability in [Roles](/admin/roles).

## Update your name and avatar

Under **Profile → Account**, update **Username** and choose **Save Changes**. The name can appear as uploader attribution on share pages when the administrator enables it.

Choose **Change Avatar** and select an image to update your photo. Flare checks that the supplied content is an image. An avatar may appear wherever the instance presents your identity, so use an image you are comfortable associating with your account.

Wait for the avatar save to finish. Your existing photo stays in place if publication fails. If your account is deleted or its profile-edit permission is removed while the upload is running, the new image is not published; any written bytes are retained for cleanup. Sign in again or ask the instance administrator about an access error before retrying.

Changing your username does not automatically change file URL paths. For a memorable upload path, use **Vanity URL** under [account upload defaults](./upload-profiles#account-upload-defaults).

## Change your password

In **Profile → Account → Change your password**, enter your current password, choose a new password of at least eight characters and at most 72 UTF-8 bytes, and confirm it. If two-factor authentication is enabled, complete **Authenticator or recovery code** with a fresh code unless the form confirms a recent passkey or recovery-code sign-in already supplies that proof. Choose **Update Password**, then sign in again; registered factors remain in place.

If you require passkeys, confirm with a passkey or dedicated passkey-recovery sign-in within five minutes before changing the password; the current password is still needed to replace it. Updating or resetting the password preserves the requirement, so the new password alone still cannot sign you in.

If that recent sign-in expires while you fill in the form, **Update Password** first reveals the code field and asks **Enter an authenticator or recovery code to continue.** Your entered passwords stay in the form; enter a fresh code and submit again. Flare checks the current confirmation requirements before sending the password change.

<Screenshot src="/screenshots/security/proof-expired.webp" alt="Change your password form preserves concealed password entries and asks for an authenticator or recovery code after recent sign-in proof expires" caption="The real form requests a fresh code before sending the change. This regression capture uses a disposable session with its sign-in time adjusted beyond five minutes; password values are masked." />

For an account managed entirely through SSO, change your identity-provider password with that provider. Flare's local password form requires an existing local password; it is not an SSO account-linking or local-password creation flow.

### Recover a forgotten password

If your instance offers password recovery, use the login page's password-recovery option, enter your account email address, and follow the emailed reset link. Recovery availability depends on the administrator's email configuration and policy. Resetting your password does not remove two-factor authentication, either recovery-code set, registered passkeys, or a passkey requirement. When passkeys are required, use a passkey or [dedicated passkey recovery code](./security#recover-when-required-passkeys-are-unavailable); resetting the password does not restore password or SSO sign-in.

Follow the result shown on the reset page. Invalid, expired, incomplete, or already used links require starting the recovery process again. If email recovery is unavailable, contact your instance administrator.

## Sign in with SSO

Your administrator may offer an OpenID Connect identity provider. Choose its sign-in button and complete the provider's flow. Account identity is based on the provider and its subject identifier, not merely the email address it returns.

An existing local account with a matching email is not automatically converted or linked to SSO. Continue using its password login. If your instance automatically redirects to SSO, `/auth/login?local=1` opens the local-login route.

There is currently no user-facing flow to link an existing local account to an SSO identity. An administrator precreating a local account with the same email also does not create that link.

## Verify your email

When email features are enabled, **Profile → Account** shows your address and verification status. Choose **Verify my email** if offered, complete any current-password confirmation, and open the message sent to your inbox.

For SSO accounts, Flare may require a recent SSO sign-in instead of a password before a sensitive email action. If prompted, sign in with the provider again and retry.

If you require passkeys, starting email enrollment requires a recent passkey or dedicated passkey-recovery sign-in instead, including for SSO-only accounts. This confirmation does not waive mailbox verification.

Your administrator can make verification optional, require it for new users, or require it more broadly after a grace period. Follow the deadline shown in your account. If verification is required before continuing, the verification page provides the next available steps.

<Screenshot src="/screenshots/email/account.png" alt="Account email verification and address management controls" caption="Email features show their current status and the actions your instance allows." />

If the message does not arrive, check spam, confirm the address, and wait for the resend cooldown before requesting another. If you no longer control that inbox, contact the administrator rather than repeatedly requesting mail.

## Change your email address

When email features are disabled, edit the email field with your basic account information, confirm your current password and any **Authenticator or recovery code** requested, and save. The address change ends existing browser sessions. An SSO-only account instead needs a recent SSO or passkey sign-in.

With a passkey requirement enabled, both the basic and confirmed email-change flows require a passkey or dedicated passkey-recovery sign-in within five minutes. The address change keeps the requirement and both recovery-code sets; use your new email address with dedicated passkey recovery codes afterward.

If a recent sign-in expires while you edit the address, saving reveals the required password/code fields before changing the email. Your edits remain available; complete the requested confirmation and save again. An SSO-only account is asked to confirm with SSO again. If Flare cannot refresh the confirmation requirements, the change stays unsent until you can retry.

When email features are enabled:

1. Choose **Change email address** in the email controls.
2. Enter the new address and complete the requested identity confirmation. An account requiring passkeys needs a recent passkey or dedicated recovery sign-in.
3. Follow the confirmation links Flare sends.
4. If the instance requires approval from both addresses, check both your current and new inboxes.

Your current address remains active until the change is approved. The controls show the pending address and offer **Cancel pending change**. A policy requiring old-address approval may first require you to verify your current email.

These behaviors depend on the administrator's [email settings](../admin/email). If the action is unavailable, use the explanation shown in the interface or contact the administrator.

## Check storage and usage

Open **Profile → Your data** to see space used, your available quota when enabled, total files, and shortened-link count. The usage bar highlights accounts approaching their quota.

**Uncapped Storage** means the instance is not enforcing the displayed account quota. Physical disk or object-storage capacity and the maximum size of an individual upload still matter.

To free space, download anything you need and delete unwanted files. Switching files to private, moving them into folders, removing tags, or deleting short links does not reclaim uploaded-file storage.

[Creating or extracting an archive](./archives) also keeps the originals and adds the new outputs to your storage usage. Archive creation is a way to package selected files; it does not replace the personal data export below or an operator's complete backup.

<Screenshot src="/screenshots/workspace/profile-data.png" alt="Your data section showing storage usage, export, and account controls" caption="Review your usage and download your data before making permanent changes." />

## Export your data

Choose **Export All Data** under **Profile → Your data**. Flare prepares a ZIP download and shows preparation and download progress. Keep the page open while it works, and allow enough disk space on your device.

The archive contains:

- `user-data.json` with basic account details, file metadata, saved OCR text, and shortened URLs with click counts.
- Available uploaded files under `files/`, grouped by upload date.

This is a personal content export. It is not a full instance backup or a one-click restore package. Current exports do not include folder/tag organization, upload profiles, appearance preferences, API credentials, webhook configuration, authenticator setup secrets, either recovery-code set, passkeys, or the passkey requirement. Export profile recipes separately if you want to keep those settings.

Inspect the archive and open important files before deleting their originals. Files that are missing from storage or cannot be retrieved can be skipped during export. If an expected file is absent, download it individually if possible and ask the administrator to check storage.

## Integrations and connected tools

**Profile → Uploads** contains capture tools and the account upload token. Replacing that token disconnects generated configurations using it; re-download them afterward.

**Profile → Integrations** contains [named API tokens](../api/authentication), [webhooks](../api/webhooks), and delivery history. Use separate named tokens when different custom tools need independent permissions or revocation. Tokens and webhooks belong to your account, including when the account has Administrator. Removing `tokens.manage` blocks credential management but does not revoke existing tokens; their current operation permissions still decide what they can do.

## Delete your account

Deleting your own account requires `profile.update` and removes its content even when `files.delete` is absent. The last-accessible-administrator safeguard also applies.

Under **Profile → Your data**, choose **Delete account** and review the confirmation. Confirming removes your account, file records, short links, and integrations from Flare, then signs you out. The same database transaction saves cleanup work for your stored files and uploaded avatar. A background worker removes those bytes after the account deletion succeeds and retries storage failures automatically. There is no account-restore button.

Export and inspect anything you want to keep first. If this is an administrator account, make sure another administrator can manage the instance before removing it.

Storage cleanup can remain pending while the storage service is unavailable, its configuration has changed, or an operator must verify an older file's original storage location. An already-issued S3 link can still read an object until the worker removes it or the link expires. Account deletion does not erase operator backups, external caches, or avatars hosted by another service. Ask the operator to check [pending account cleanup](/hosting/maintenance#account-storage-cleanup) and their retention procedures if complete data removal matters for your use case.

For a normal end to a session, use **Log out** instead of deleting the account.
