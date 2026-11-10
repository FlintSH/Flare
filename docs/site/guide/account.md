---
title: Account, email, and data
description: Manage your identity, passphrase and sign-in details, verify or change email, check storage, and export your Flare data.
---

# Account, email, and data

Your [roles](/admin/roles) determine which profile actions are available. Editing identity/avatar or upload defaults uses `profile.update`, downloading account data requires `profile.export`, `files.read`, and `links.read` together, managing tokens uses `tokens.manage`, and managing webhooks uses `webhooks.manage`. Personal appearance uses `appearance.personal`. Missing controls can reflect your permissions; contact the person managing roles for your instance.

Select your avatar at the right of the dashboard bar and choose **Profile** to manage settings that belong to you. **Settings**, in the **Admin** menu, is the administrators' separate area for instance-wide behavior.

<Screenshot src="/screenshots/roles/profile-roles.webp" alt="Profile Account section showing the demonstration account’s Moderator, Creator, and Everyone roles above its identity fields" caption="Your roles shows the account’s current grants alongside identity and personal preferences." />

Verification, recovery-address enrollment, passphrase recovery, and confirmed email-change flows remain available under their own identity and email-policy checks, even without `profile.update`. Role restrictions on application preferences do not remove those account-security paths.

## Protect your sign-in

**Profile → Account → Sign-in security** contains authenticator setup, recovery codes, and passkeys. [Follow the complete security guide](./security) to enable two-factor authentication, save a recovery method, and test passkey sign-in. These controls remain available without `profile.update` and require their own identity confirmation. Adding/removing sign-in methods and replacing recovery codes end existing browser sessions, so save any newly displayed recovery codes before signing in again.

**Require passkey to sign in** is a separate opt-in setting, off by default. It blocks passphrase and SSO sign-in and gives you ten dedicated emergency codes, each capable of signing in with only your account email. Save these separately from authenticator recovery codes. Registration alone does not enable the requirement. [Enable it and prepare recovery](./security#require-a-passkey-for-sign-in).

## Login history and active sessions

Open **Profile → Account** and scroll to **Active sessions** and **Login history**. These account-security controls are available independently of `profile.update`; you do not need permission to manage other users. A session belongs to one completed browser sign-in, so several tabs in the same browser can share a session while another browser or private window has its own.

<Screenshot src="/screenshots/audit/sessions-desktop.webp" alt="Profile Account section showing active browser sessions, a This browser marker, individual Revoke session actions, and Revoke all sessions" caption="Review the sign-in time, last activity, method, and recorded client details before revoking a session." />

### Revoke one session or all sessions

1. In **Active sessions**, find the browser sign-in you want to end. The current session is marked **This browser**.
2. Choose **Revoke session** and confirm **Revoke session**. A different browser loses access on its next authenticated request. For **This browser**, confirm **Revoke and sign out**; this ends your current session.
3. To end every browser sign-in, choose **Revoke all sessions**, review the confirmation, and choose **Revoke all and sign out**. This includes the current session; sign in again with an allowed method to continue.
4. Use **Refresh** to reload the list after activity in another browser. If a revocation fails, read the error and retry after resolving it; an error does not confirm the session ended.

To end only this browser's session, select your avatar and choose **Sign out**. The same action is under **Account** in the navigation sheet on a phone and at the top of **Profile**. Other browsers stay signed in. Every sign-out, including **Revoke and sign out** and **Revoke all and sign out**, opens the local sign-in form (`/auth/login?local=1`), even if your instance normally redirects sign-in to SSO, so your provider doesn't sign you straight back in.

<Screenshot src="/screenshots/audit/revoke-session.webp" alt="Revoke this session confirmation explains that the other browser loses access on its next request" caption="Ending another session preserves the browser you are using." />

<Screenshot src="/screenshots/audit/revoke-all.webp" alt="Revoke all sessions confirmation warns that every browser including this one will be signed out, with a Revoke all and sign out button" caption="The all-session confirmation includes the current browser explicitly." />

Sessions expire after 30 days. **Last active** reflects authenticated server activity and is refreshed at most once per minute; it is not a precise timeline of every click. Browser/user-agent information and IP addresses describe the reported client, not a verified physical device or location. Several devices can share an IP, and an address can change. [Proxy configuration](/hosting/reverse-proxy#client-addresses-in-session-history) determines whether those addresses are trustworthy.

Revocation affects subsequent authorization checks. It cannot recall a downloaded file, stop an already authorized response, or revoke an existing signed storage URL. Named API tokens and the legacy upload credential are separate: [revoke or rotate them](/api/authentication) as well when responding to a suspected compromise. Changing a password or sign-in security method can also invalidate sessions as described above and in the [security guide](./security).

### Switch accounts in the same tab

These lists show the currently signed-in account’s activity. Signing in as another account, or signing in again with a new browser session, reloads the lists and resets the history filter and open revocation confirmations. The **This browser** marker is determined again for the new sign-in. Switching accounts cannot undo a revocation already accepted by the server; check the original account’s sessions before retrying.

An open [file library](./library#change-accounts-or-sign-in-again) also reloads for the new account or session and clears its selections and dialogs, including when it detects a sign-in change made in another tab. Filters saved in the page address remain, so check them if the new account appears empty.

<Screenshot src="/screenshots/audit/account-switch.webp" alt="Active sessions after a same-tab account switch and new sign-in, with This browser marking the replacement session" caption="The replacement sign-in has its own current-browser marker. This real-server regression uses deliberately supplied, reserved example IP addresses to distinguish disposable sessions." />

### Review successful and failed sign-ins

**Login history** shows completed sign-in successes and recorded failures attributed to your account, with time, sign-in method, and available client details. Choose **All attempts**, **Successful**, or **Failed**, then **Load more attempts** for older entries. The list covers the last 90 days in pages of 25. History starts when this feature is installed; earlier logins cannot be reconstructed. Some failed sign-ins cannot be associated with an account and therefore do not appear in a personal history. The intermediate authenticator prompt is not a failed login. Rate-limited attempts and failures handled only by an external SSO provider may not appear. A failed attempt is not an active session.

<Screenshot src="/screenshots/audit/login-history.webp" alt="Login history showing successful and failed password attempts with timestamps, browser details, IP addresses, and an All attempts filter" caption="A failed attempt stays in history without becoming an active session." />

If you see an unfamiliar successful sign-in, revoke it or all sessions, change the affected sign-in credential, review your registered passkeys and integration tokens, and contact your administrator. Repeated failures alone do not prove someone accessed your files; an administrator can investigate the [audit log](/admin/audit).

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/audit/sessions-mobile.webp" alt="Mobile Profile view showing the active-session list, the current-browser marker, and revocation controls" caption="The same session review and revocation controls work on a phone." />
</div>

[Watch the session-management demonstration](/demos#review-and-revoke-browser-sessions). Existing installations require everyone to sign in again after the [session-tracking migration](/hosting/maintenance#sessions-and-audit-log-migration).

## See your roles

**Profile → Account → Your roles** shows your current role badges. Everyone applies automatically. Additional roles add permissions; a role name or color alone does not describe its authority. Ask the instance administrator to review a missing capability in [Roles](/admin/roles).

## Update your name and avatar

Under **Profile → Account**, update **Username** and choose **Save changes**, which becomes available once you edit a field. A username needs at least one character, the same rule as registration, setup, and **Users**. Earlier versions asked for two characters here, so a one-character name given during setup couldn't be saved again. The name can appear as uploader attribution on share pages when the administrator enables it.

Choose **Change avatar** and select a PNG, JPEG, GIF, or WebP image of at most 2 MB to update your photo. A larger file shows **File too large** and another format, such as SVG, HEIC, or AVIF, shows **Invalid file type**; nothing is uploaded, so resize or convert the image and try again. The server checks the same rules again and also checks that the content really is a PNG, JPEG, GIF, or WebP image, though not necessarily the one its name says: a JPEG saved as `photo.png` works. Earlier versions accepted an image of any type and size, but refused one whose content was another format than its name said. When your instance enforces [storage quotas](#check-storage-and-usage), the image must fit in your remaining space, although it isn't added to your used space. An avatar may appear wherever the instance presents your identity, so use an image you are comfortable associating with your account.

If Flare refuses the image, **Upload failed** gives its reason, for example **This would exceed your storage quota.** or **File content is not a PNG, JPEG, GIF, or WebP image.** Earlier versions said **Failed to upload avatar** whatever the reason, which is still the message when Flare gives none.

Wait for the avatar save to finish. Your existing photo stays in place if publication fails. If your account is deleted or its profile-edit permission is removed while the upload is running, the new image is not published; any written bytes are retained for cleanup. Sign in again or ask the instance administrator about an access error before retrying.

Changing your username does not automatically change file URL paths. For a memorable upload path, use **Vanity URL** under [account upload defaults](./upload-profiles#account-upload-defaults). The field keeps capital letters as you type them, because links use the vanity URL exactly as written; earlier versions turned everything into lowercase. Flare refuses a vanity URL that another account already uses as its vanity URL or URL ID, or that is your own URL ID, and says which.

## Change your passphrase

An account signs in with a **passphrase** that never leaves your browser, and has a 24-word **recovery phrase**. Both belong to the encryption keys of your account. [Passphrase and recovery phrase](./passphrase) explains them in full; this section is the short version for **Profile → Account → Passphrase and recovery**.

- **Show recovery phrase** asks for your passphrase and shows the 24 words again.
- **Change passphrase** makes new keys for your account. It ends every session, including the one you are using, deletes every API token, replaces your upload token, and gives you a new recovery phrase. The dialog lists this before it asks for anything. [Read the steps and the consequences](./passphrase#change-your-passphrase) first; screenshot tools need their configuration installed again afterwards.

A passphrase change asks for your current passphrase and nothing else. Two-factor authentication, recovery codes, passkeys, and a passkey requirement stay as they are, so the next sign-in still asks for them.

An account that was created before passphrases and has not signed in since still has a password. It cannot open the dashboard with it: the first sign-in goes straight to [Set up encryption](./passphrase#accounts-from-before-passphrases), which replaces the password with a passphrase. The card title **Change your password** and its form remain only for an account without a sign-in email address, which cannot set up encryption until an administrator adds one.

For an account managed entirely through SSO, change your identity-provider password with that provider. Such an account still chooses a Flare passphrase, which unlocks its keys after each SSO sign-in.

### Recover a forgotten passphrase

If your instance offers recovery by email, choose **Forgot your passphrase?** on the sign-in page, enter your account email address, and follow the emailed reset link. The link offers two paths with different results:

- **I have my recovery phrase** lets you choose a new passphrase and keeps access to your encrypted files.
- **I lost my recovery phrase** gives the account new keys. Its encrypted files can never be opened again, by anyone.

[Forgot your passphrase](./passphrase#forgot-your-passphrase) describes both. Recovery availability depends on the administrator's email configuration and policy, and the link is sent only to a verified address. Neither path removes two-factor authentication, either recovery-code set, registered passkeys, or a passkey requirement. When passkeys are required, use a passkey or [dedicated passkey recovery code](./security#recover-when-required-passkeys-are-unavailable) to sign in; a new passphrase does not restore passphrase or SSO sign-in.

Follow the result shown on the reset page. Invalid, expired, incomplete, or already used links require starting the recovery process again; choose **Request a new link**. If email recovery is unavailable, the recovery page says so; contact your instance administrator. An administrator cannot set a passphrase for you.

## Sign in with SSO

Your administrator may offer an OpenID Connect identity provider. Choose its sign-in button and complete the provider's flow. Account identity is based on the provider and its subject identifier, not merely the email address it returns.

An existing local account with a matching email is not automatically converted or linked to SSO. Continue using its passphrase login. If your instance automatically redirects to SSO, `/auth/login?local=1` opens the local-login route.

There is currently no user-facing flow to link an existing local account to an SSO identity. An administrator precreating a local account with the same email also does not create that link.

## Verify your email

When email features are enabled, **Profile → Account** shows your address and verification status. Choose **Verify my email** if offered, [confirm your passphrase](./passphrase#confirm-it-is-you-for-account-changes) if the form asks, and open the message sent to your inbox. A passphrase sign-in within the last five minutes already counts, and the form then says so.

For SSO accounts, Flare may require a recent SSO sign-in instead of a password before a sensitive email action. If prompted, sign in with the provider again and retry within five minutes. If Flare keeps asking right after you sign in, ask your administrator to check the server clocks: a sign-in timed ahead of the clock of the server checking it doesn't count.

If you require passkeys, starting email enrollment requires a recent passkey or dedicated passkey-recovery sign-in instead, including for SSO-only accounts. This confirmation does not waive mailbox verification.

Your administrator can make verification optional, require it for new users, or require it more broadly after a grace period. Follow the deadline shown in your account. If verification is required before continuing, the verification page provides the next available steps. Opened while you are signed out, it asks you to **Sign in** first so it can show your status. The confirmation link in the email works without signing in.

<Screenshot src="/screenshots/email/account.png" alt="Account email verification and address management controls" caption="Email features show their current status and the actions your instance allows." />

If the message does not arrive, check spam, confirm the address, and wait for the resend cooldown before requesting another. If you no longer control that inbox, contact the administrator rather than repeatedly requesting mail.

## Change your email address

When email features are disabled, edit the email field with your basic account information, [confirm your passphrase](./passphrase#confirm-it-is-you-for-account-changes) unless you signed in with it in the last five minutes, enter any **Authenticator or recovery code** requested, and save. You then sign in with the new address and the same passphrase. The address change ends existing browser sessions. An SSO-only account instead needs a recent SSO or passkey sign-in.

With a passkey requirement enabled, both the basic and confirmed email-change flows require a passkey or dedicated passkey-recovery sign-in within five minutes. The address change keeps the requirement and both recovery-code sets; use your new email address with dedicated passkey recovery codes afterward.

If a recent sign-in expires while you edit the address, saving reveals the **Confirm passphrase** control or the code field before changing the email. Your edits remain available; complete the requested confirmation and save again. An SSO-only account is asked to confirm with SSO again. If Flare cannot refresh the confirmation requirements, the change stays unsent until you can retry.

When email features are enabled:

1. Choose **Change email address** in the email controls.
2. Enter the new address and complete the requested identity confirmation. An account requiring passkeys needs a recent passkey or dedicated recovery sign-in.
3. Follow the confirmation links Flare sends.
4. If the instance requires approval from both addresses, check both your current and new inboxes.

Your current address remains active until the change is approved. The controls show the pending address and offer **Cancel pending change**. A policy requiring old-address approval may first require you to verify your current email.

An address another account uses is unavailable, whatever its capitalization. Only capitalization is ignored: `a_b@example.com` and `axb@example.com` are different addresses. Earlier versions read `_` and `%` as wildcards here and could refuse an address because it resembled another account's.

These behaviors depend on the administrator's [email settings](../admin/email). If the action is unavailable, use the explanation shown in the interface or contact the administrator.

## Check storage and usage

Open **Profile → Your data** to see space used, your available quota when enabled, total files, and shortened-link count. Sizes use binary units, so 1 GB is 1,024 MB. The usage bar highlights accounts approaching their quota.

**Uncapped storage** means the instance is not enforcing the displayed account quota. Physical disk or object-storage capacity and the maximum size of an individual upload still matter.

To free space, download anything you need and delete unwanted files. Switching files to private, moving them into folders, removing tags, or deleting short links does not reclaim uploaded-file storage.

[Creating or extracting an archive](./archives) also keeps the originals and adds the new outputs to your storage usage. Archive creation is a way to package selected files; it does not replace the personal data export below or an operator's complete backup.

<Screenshot src="/screenshots/workspace/profile-data.png" alt="Your data section showing storage usage, export, and account controls" caption="Review your usage and download your data before making permanent changes." />

## Export your data

Choose **Export all data** under **Profile → Your data**. Flare builds the ZIP while your browser downloads it, reading one file at a time from storage. The browser saves it as `flare-data-export-` followed by the time the export started, in milliseconds, for example `flare-data-export-1767225600000.zip`. Allow enough disk space on your device. You can keep using Flare in the same tab while it works: the export continues, and the ZIP downloads when it's ready. Closing or reloading the tab cancels the export, and Flare stops reading your files on the server too.

While the export runs, the button shows **Preparing…** with the percentage of your files already added to the ZIP, and the bar below it fills to match. The percentage holds while Flare reads a large file, so a slow export can stay on one number for a while. Each export reports only its own progress: a new export starts from 0%, and exports running in two tabs at once each show their own. Progress comes from the Flare process building your ZIP. On an instance running [several application replicas](/hosting/#multiple-replicas-and-serverless-hosts) that don't keep your requests on one replica, it can stay at 0% while the download still completes.

The archive contains:

- `user-data.json` with basic account details, file metadata, saved OCR text, and shortened URLs with click counts.
- Available uploaded files under `files/`, in one folder per upload date (`files/2026-10-01/report.pdf`). Entries use each file's display name.

Two files with the same name from the same day both appear. The older one keeps the plain name and the others get a number before the extension: `report.pdf`, `report (2).pdf`, `report (3).pdf`. Names that differ only in capitals, such as `Report.PDF` and `report.pdf`, count as the same name, because Windows and macOS would otherwise overwrite one with the other when extracting.

This is a personal content export. It is not a full instance backup or a one-click restore package. Current exports do not include folder/tag organization, upload profiles, appearance preferences, API credentials, webhook configuration, authenticator setup secrets, either recovery-code set, passkeys, the passkey requirement, active-session records, login history, or instance audit events. Export profile recipes separately if you want to keep those settings.

If Flare refuses to start the export, the error gives its reason, for example **Permission denied** after your role changed, or **Failed to export data** when it gives none. Earlier versions showed only the status, such as **Export failed with status: 403**.

### An account with encrypted files

The server cannot decrypt an [encrypted file](./encryption), so for an account that has at least one, your browser builds the export. **Export all data** then downloads each file, decrypts the encrypted ones with your keys, and writes one ZIP on your device. Plain files and the account record are in the same ZIP. An account with only plain files gets the export described above, unchanged.

Where the ZIP goes depends on the browser:

1. **A file you choose.** Chrome, Edge and other Chromium browsers on a computer open a save dialog first. The ZIP is written to that file as it is built.
2. **A streamed download.** Firefox, Safari and mobile browsers save it like any download, through Flare's [service worker](./encryption#video-audio-and-downloads). It appears in your downloads at once and grows as the export runs.
3. **Memory.** A browser with neither (a private window in some browsers, or a page on plain HTTP) builds the ZIP in memory, up to 512 MB of files. Above that the export stops before it starts and says which browsers can do it.

The button shows **Exporting…** with a percentage, and below it the file being written, how much is done, and a **Cancel** button. Keep the tab open: closing it, reloading it or pressing **Cancel** stops the export. Nothing is saved from a stopped export to a chosen file; a stopped download shows as failed in your browser. An export does not resume. Start it again, and it reads every file again.

The ZIP contains:

- `user-data.json`: the same account record. Each file also has `exportPath`, the path of its entry in the ZIP. An encrypted file that was decrypted has its real `name` and `mimeType` and `"decrypted": true`. Its sealed records stay listed.
- `files/<upload date>/<name>`: each file, plain files as they are stored and encrypted files decrypted, under the name you uploaded them with. The name comes from the file's sealed metadata and is cleaned to one safe file name. Repeated names on one day are numbered as above, across plain and encrypted files.
- `files/<upload date>/<file ID>.flare-encrypted`: an encrypted file that your keys do not open, for example one from before you [reset your keys without the recovery phrase](./passphrase). It is included as ciphertext, with `"decrypted": false`.
- `export-report.json`: when the export ran, how many files were written, how many were decrypted, which were included as ciphertext, and which were left out with the reason for each.

A file that fails part-way is left out and the export goes on: a file that fails its integrity check, a file the server no longer sends, or a lost connection during that file. The summary under the button says how many were left out, and `export-report.json` names them. Export again to retry.

If your encryption keys are locked in this browser, the page says so and offers two buttons. **Unlock** asks for your passphrase and then exports decrypted files. **Export without decrypting** gives the server's export: each encrypted file as ciphertext named `<file ID>.flare-encrypted`, with the records that open it listed in `user-data.json`.

Decrypted data goes only to the ZIP: to the file you chose or to your browser's download. Flare writes none of it to browser storage. Building the export takes time and bandwidth in proportion to your library, because every file passes through your device.

### After an export

Inspect the archive and open important files before deleting their originals. A file that storage cannot open, for example because it is missing, is skipped and the rest of the export continues. If storage fails partway through a file, the download stops with an error rather than saving an archive with a cut-off file; start the export again. If an expected file is absent, or an export keeps failing, download the file individually if possible and ask the administrator to check storage.

## Integrations and connected tools

**Profile → Uploads** contains capture tools and the account upload token. Replacing that token disconnects generated configurations using it; re-download them afterward.

**Profile → Integrations** contains [named API tokens](../api/authentication), [webhooks](../api/webhooks), and delivery history. Use separate named tokens when different custom tools need independent permissions or revocation. While **Integrations** is the open section of Profile and its browser tab is visible, the page reloads its lists every five seconds, so delivery statuses update on their own. An error from a failed reload clears when a later one succeeds. Earlier versions kept reloading every five seconds after you switched to another section of Profile, and kept showing an error after the next reload succeeded. Tokens and webhooks belong to your account, including when the account has Administrator. Removing `tokens.manage` blocks credential management but does not revoke existing tokens; their current operation permissions still decide what they can do.

## Invite people

When your roles include **Create invites**, **Profile → Invites** lets you create invite links so people can make their own account, even while registration is closed. You choose how many people each link admits and when it expires, then copy, track, and revoke your links in the same place. [Read the invite guide](./invites).

## Delete your account

Deleting your own account requires `profile.update` and removes its content even when `files.delete` is absent. The last-accessible-administrator safeguard also applies.

Under **Profile → Your data**, choose **Delete account** and review the confirmation. Confirming removes your account, file records, short links, integrations, and invite links from Flare, then signs you out. Accounts that joined with your invites keep their accounts. The same database transaction saves per-file deletion audit evidence and cleanup work for your stored files and uploaded avatar. If that audit insert fails, the account deletion and cleanup work roll back together; ask the operator to resolve the database problem before retrying. A background worker removes those bytes after the account deletion succeeds and retries storage failures automatically. There is no account-restore button.

After deleting the account, Flare opens the local sign-in form (`/auth/login?local=1`), even if your instance normally redirects sign-in to SSO. On such an instance, earlier versions opened the usual sign-in page, where a still-active provider session could sign you straight into a new, empty account.

Export and inspect anything you want to keep first. If this is an administrator account, make sure another administrator can manage the instance before removing it.

Storage cleanup can remain pending while the storage service is unavailable, its configuration has changed, or an operator must verify an older file's original storage location. An already-issued S3 link can still read an object until the worker removes it or the link expires. Account deletion removes its personal session/history records but does not erase retained instance audit events, operator backups, external caches, or avatars hosted by another service. Ask the operator to check [pending account cleanup](/hosting/maintenance#account-storage-cleanup) and their retention procedures if complete data removal matters for your use case.

For a normal end to a session, use **Sign out** instead of deleting the account.
