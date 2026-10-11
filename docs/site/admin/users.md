---
description: Manage registration, invite links, accounts, administrator roles, content moderation, vanity links, and email access.
---

# Users, roles, and access

Open **Users** in the dashboard to find accounts by name or email, filter by role, and inspect file counts, storage use, and shortened links. The list is paginated so you can manage a larger instance without loading every account at once.

<Screenshot src="/screenshots/roles/users-overview.webp" alt="User management table showing accounts, roles, file counts, and actions" caption="Administrators can manage accounts and open each user's content from one list." />

## Roles and permissions

Accounts use reusable [roles](./roles), not a fixed Admin/User choice. Everyone applies to every account; additional roles combine their permissions. The list's role filter matches a role assignment. You need `users.read` to browse accounts, and individual actions require their corresponding permissions.

| Task                                       | Required permission                                                |
| ------------------------------------------ | ------------------------------------------------------------------ |
| List accounts                              | `users.read`                                                       |
| Create an account                          | `users.create`; also `users.roles` to assign additional roles      |
| Edit identity, password, or avatar         | `users.update`                                                     |
| Assign or remove roles                     | `users.roles`                                                      |
| Invalidate sessions                        | `users.sessions`                                                   |
| Inspect/change email access                | `users.email`                                                      |
| Delete an account                          | `users.delete`                                                     |
| Read, edit, or remove other users' content | `content.read`, `content.update`, or `content.delete` respectively |

Administrator grants all these permissions. Delegated managers can manage only accounts below their own highest role whose effective permissions are within their own grants. They cannot acquire extra permissions by resetting another account’s credentials or assigning a role they cannot grant. There are no per-folder membership roles, per-account numeric quota overrides, or suspended-account states. See the [complete permission reference](./roles#permission-reference) before delegating sensitive content access.

## Open or close registration

With `settings.security`, go to **Settings → Access → Registration**. Disable registration to prevent public password-account sign-ups, then add a useful message such as “This is a private team instance. Ask a member for an invite link.” Existing users retain their accounts, administrators can still create users, and people with an active [invite link](#invite-links) can still create an account.

OIDC auto-provisioning is a separate setting. Closing password registration does not by itself define which identities your identity provider may provision. Review both controls when operating a private instance.

## Invite links

An invite link lets a person create their own local password account while registration is closed. It is the friendlier alternative to choosing someone's password with **New User**: the invited person picks their own username, email address, and password. The [invite guide](/guide/invites) covers creating, copying, sharing, tracking, and revoking links; this section covers who may invite and how to oversee invites across the instance.

### Choose who can invite

Invites use two [permissions](./roles#permission-reference) in the **Invitations** group. Neither is part of the default Everyone role, so **only administrators can invite until you grant them**.

| Permission                                | Allows                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Create invites** (`invites.create`)     | Create invite links from **Profile → Invites** (or **Users → Invites** with `users.read`), copy your own links, and revoke them.    |
| **Manage all invites** (`invites.manage`) | View every account's invites, including their notes and who joined, and revoke any invite. It does not reveal other people's links. |

To let every account invite people, open **Settings → Access → Invites**, turn on **Let everyone create invites**, and choose **Save settings**. This switch grants Create invites to the Everyone role, and the Roles page shows the same change. Turning it off removes the grant again. Changing it requires `settings.security` and your own `invites.create`; administrators have both.

<Screenshot src="/screenshots/invites/settings-invites.webp" alt="Settings Access Invites card with Let everyone create invites turned on and member limits of 5 active invites, 1 use per invite, and 30 days longest expiry" caption="One switch lets every account invite people; the limits keep member invites modest." />

To let only some people invite, leave the switch off and add **Create invites** to a role instead, for example a “Community host” role, then assign it in Users. Grant **Manage all invites** to people who should oversee and revoke links; it is instance-wide and does not follow the account hierarchy, like content moderation.

<Screenshot src="/screenshots/invites/roles-invitations.webp" alt="Everyone role editor filtered to the Invitations group, with Create invites turned on and Manage all invites turned off" caption="Invite access is an ordinary role permission. Here the Settings switch has granted Create invites to Everyone." />

### Set member limits

**Limits for members** apply to anyone who can invite but lacks **Create users** (`users.create`). People with Create users, including administrators, can already create accounts directly, so these limits do not apply to them.

| Setting                       | Default | Range | Effect                                                                          |
| ----------------------------- | ------- | ----- | ------------------------------------------------------------------------------- |
| **Active invites per person** | 5       | 1–100 | Invites a person can have that are not used up, expired, or revoked.            |
| **Uses per invite**           | 1       | 1–100 | Most accounts one member invite can create. Members cannot choose **No limit**. |
| **Longest expiry (days)**     | 30      | 1–365 | Latest expiry a member can choose. Members cannot choose **Never**.             |

Choose **Save settings** after editing them. Limits apply when an invite is created; existing invites keep the uses and expiry chosen at the time. Lowering a limit does not revoke anything, so revoke invites individually if you need to shorten them. Accounts without member limits can choose any expiry, **No limit** for uses, and up to 1,000 active invites each.

### Review and revoke every invite

Open **Users → Invites**. With **Manage all invites**, **Created by** defaults to **Anyone** and each link shows its creator, note, status, uses, expiry, granted roles, and the accounts that joined. Without it, the tab shows only your own invites. Choose **Revoke** and confirm to stop a link immediately; accounts already created with it are unaffected. Statuses reflect each creator's permissions when the list loads, so choose **Refresh** after changing roles elsewhere.

<Screenshot src="/screenshots/invites/users-invites.webp" alt="Users Invites tab showing invites created by Jamie Rivera that are paused or revoked, and Show set to All invites" caption="Managers see every invite. Here member invites are paused after Let everyone create invites was turned off." />

For security, nobody can copy another person's invite link, even with Administrator. Ask the creator for the link or create a new invite.

A link shows **Paused** when its creator can no longer create invites or grant its roles, for example after you turn off **Let everyone create invites**, remove a role, or the creator's account must verify its email. Paused links stop working but resume if that access returns before they expire. Revoke them if they should never work again.

### Grant roles with an invite

People with **Assign roles** (`users.roles`) can choose **Roles for new accounts** while creating an invite. The usual [delegation rules](./roles#delegate-without-handing-over-the-instance) apply: a delegated manager can grant only roles below their highest role whose permissions they already have. Selecting a role with Administrator shows a warning, because anyone using that link becomes a full administrator.

Flare checks the grants again when someone uses the link. If the creator has lost Create invites or can no longer grant one of the roles, the link is paused rather than creating an account with unexpected access. Deleting a role removes it from pending invites; they then create accounts without it. Everyone always applies.

### Trace who invited whom

Accounts created with an invite show **Invited by** and the creator's name in the Users list. Each invite lists the accounts that joined with it. The [audit log](./audit) records invites under the `invites` category: `invite.create`, `invite.update` for uses and revocation, `invite.redeem` with the new account's name and granted role IDs, and `invite.delete` when an account deletion removes its creator's invites. Invite tokens never appear in audit details.

<Screenshot src="/screenshots/invites/users-invited-by.webp" alt="Users list where Sam Rivera shows Invited by Alex Morgan with the Moderator role and Priya Shah shows Invited by Jamie Rivera" caption="Accounts created with an invite show who invited them." />

Deleting an account also deletes the invites it created, so they stop working. Accounts that joined with those invites remain, but no longer show **Invited by**; the audit log keeps the history.

### Keep invites safe

- **Possession is enough.** Anyone with an active link can create an account. Prefer single-use links, short expiry times, and private channels. Revoke a link that was posted publicly.
- **Invites create local accounts.** The invited person signs in with the password they choose. Invites do not create or link SSO identities; [OIDC auto-provisioning](./sso#registration-and-auto-login) remains a separate control.
- **Usual sign-up checks apply.** Registration rate limits, the email-verification policy for new users, and the password rules apply to invited people too.
- **Links are stored safely.** Flare stores a SHA-256 digest of each 256-bit token for lookup and an encrypted copy so the creator can copy it again. Creating invites requires the encryption key used for webhook secrets; see [secrets](/hosting/configuration#core-environment-variables).
- **Closing registration is still worthwhile.** Invite pages are reachable only with a valid link. The ordinary `/auth/register` page stays unavailable while registration is closed.

## Create an account

1. With `users.create`, open Users and choose **New User**. Assigning additional roles also requires `users.roles`.
2. Enter the person's name and email.
3. Set a password of at least eight characters for an account that should sign in locally.
4. Select any additional **Roles** the person needs. Everyone applies automatically; leave the additional roles empty to use only that baseline. Assign the Admin role only for full instance control.
5. Save and communicate the sign-in details through your normal secure channel.

The account form requires a name of at least two characters and a valid email. When email is enabled, password inputs are limited to 72 UTF-8 bytes. Do not treat a passwordless local account as an invitation or an SSO link: there is no email-based automatic account linking. To let a person choose their own password, send an [invite link](#invite-links) instead. [SSO provisioning](/admin/sso#account-creation-and-identity) explains how new SSO accounts are created.

With email enabled, new administrator-created accounts follow the configured **inherit/exempt** verification policy. Flare can queue a verification message when recovery or verification is active, but that is not a substitute for creating a working sign-in method.

## Edit identity and links

The edit dialog lets you change name, email, roles, password, URL ID, and vanity URL, when your permissions allow those actions. Role assignment requires `users.roles`; identity edits require `users.update`. Delegated managers can affect only accounts below their highest role. Leave the password empty when you do not intend to replace it.

<Screenshot src="/screenshots/roles/user-roles.webp" alt="Edit User dialog with multiple role selections, identity fields, and URL settings" caption="Account edits include both identity details and the user's share-link identifiers." />

The normal **URL ID** is five alphanumeric characters. A **vanity URL** is a friendlier optional identifier, 3–32 characters using letters, numbers, and internal hyphens. It cannot start or end with a hyphen, collide with another user's identifiers, or use reserved application paths such as `api`, `dashboard`, or `setup`. Clearing the vanity field removes it.

Changing the normal URL ID updates existing file URL records but keeps storage paths unchanged. Previously distributed links containing the old identifier can stop working; coordinate this with the account owner. Changing an email address resets proof of that address and cancels obsolete account tokens. Email/password changes invalidate existing browser sessions even when account email features are disabled; the owner must sign in again using an allowed method.

Keep at least one accessible local administrator account. Flare rejects supported account and role changes that would remove the last accessible administrator. Establish another trusted administrator with a working sign-in and durable email access before demoting or deleting one. See [recovery protection](./roles#protect-a-recovery-account).

## Manage verification and recovery access

With `users.email`, the user edit dialog exposes email verification state and exemption controls when email is enabled. This capability is separate from changing the instance email policy (`settings.email`). You can exempt a user, remove their exemption, or resend an eligible pending verification message.

An exemption permits access under the verification policy; it does not make an address verified or recoverable. Older accounts must enroll their recovery address from their own signed-in Profile. If resend says the user must enroll their address, ask them to complete that flow rather than assuming an old saved email is trustworthy.

Removing the last administrator exemption under an all-user policy requires a verified administrator recovery path. [Email policy details](/admin/email#choose-an-access-policy).

## Moderate files and shortened links

With `users.read` and `content.read`, choose **View Content** on a user to inspect their files and shortened URLs. Changing their file settings needs `content.update`; deleting content needs `content.delete`. Content permissions are instance-wide, including content owned by accounts above your role; they do not grant role assignment or instance settings access. The content dialog provides search, pagination, and file filters. You can open files, adjust visibility, delete a file, inspect link destinations/clicks, and remove shortened links. Removing a user's avatar is available from their row. It clears the profile image immediately and queues the owned object for durable cleanup; stored bytes and cached copies can remain until cleanup or cache expiry.

<Screenshot src="/screenshots/roles/users-content.webp" alt="Administrator content dialog listing a user's files and moderation actions" caption="Review an account's content without switching to its identity." />

Deletion has no recycle bin. Individual file deletion removes the database record and attempts to remove its bytes; it does not use the account-cleanup queue described below. If the storage backend is unavailable during individual file deletion, check logs for objects that may need reconciliation. Never make broad direct bucket deletions from a UI count alone.

The [archive workspace](/guide/archives) separates owner-library mutations from share-page reads. A moderator with `content.read` can browse and download archive entries through the share viewer under the ordinary file-access rules, but cannot extract or create archives from another account's files using owner-library routes. Public visitors can browse accessible shared archives, subject to file passwords. Extracted files and newly created archives remain ordinary file records and follow existing content-moderation rules after publication. They default to private; an explicitly selected upload profile can choose different visibility and expiration.

## Revoke browser sessions

Choose **Revoke Sessions** on an account, review **Sign out {name}?**, then confirm **Revoke sessions**. This requires `users.sessions` and authority above that account. On success, the confirmation closes and **Sessions revoked** appears; the person must sign in again. The server returns an empty `204 No Content`, which is a successful result. It invalidates browser sessions; it does not revoke named API tokens or the legacy upload credential. Revoke or rotate those separately when retiring an integration.

If the request fails, the confirmation stays open and shows an error so you can address the cause and retry. Owners can also review their own [active sessions and login history](/guide/account#login-history-and-active-sessions) and revoke one session at a time from Profile. Their self-service controls do not require `users.sessions`.

The [audit log](./audit) records account/session, role, and moderation activity. Reading it requires the separate `audit.read` permission; account-management access alone does not expose the instance-wide history.

<Screenshot src="/screenshots/roles/sessions-revoked.webp" alt="Users list with a Sessions revoked notification saying Morgan Lee will need to sign in again" caption="Successful session revocation closes the confirmation and reports that the account must sign in again." />

## Delete an account

With `users.delete` and authority above the target account, read the confirmation carefully: deleting an account removes its account data and associated content, including file records, profiles, integrations, and short links. Per-file deletion audit evidence, account removal, and durable cleanup jobs for stored files and the uploaded avatar commit together. A failure to write that audit evidence rolls back the deletion and cleanup queue; resolve the database error before retrying. A permission or last-administrator refusal leaves both the account and its stored bytes untouched. Once deletion succeeds, the removed account can no longer authenticate; no separate session-revocation permission is required.

A successful response means the account is gone and cleanup is queued. A background worker removes the bytes after commit and retries failures automatically, including after a restart. Storage downtime or unverified historical storage locations can delay that cleanup; already-issued S3 links or public avatar URLs can remain usable until the objects are deleted or links expire. For pending work, ask the operator to follow [account storage cleanup](/hosting/maintenance#account-storage-cleanup). External avatar URLs, backups, and external caches are outside that cleanup.

Deleting a large account can take longer while its files are queued in bulk. If the request times out, refresh Users to check whether the account was removed before trying again.

Offer a data export or make a backup before deleting content that may need to be retained. Account deletion is not temporary suspension; restoring it requires a suitable backup. Retained audit events keep their recorded actor and target metadata after account deletion; account deletion is not audit-history erasure. [Retention and backup handling](./audit#retention-and-operational-limits) are operator responsibilities.

Deleting a user also removes their API tokens and webhook configurations, so automations owned by that account stop working.

## Account sign-in security

Users manage [authenticator apps, recovery codes, and passkeys](/guide/security) in **Profile → Account → Sign-in security**, including when their role cannot edit ordinary profile preferences. These features are opt-in per account; there is no instance-wide enforcement switch or administrator factor-reset button.

Users can explicitly enable **Require passkey to sign in** after registering and confirming a passkey. The setting is off by default and blocks password and SSO sign-in, including for SSO-only accounts. Its ten dedicated emergency codes are separate from authenticator recovery codes and each can grant full account access using only the email address. Ask owners to keep a spare passkey and protect those codes; administrators should never ask owners to disclose them.

Changing a user's password or email does not remove their authenticator, either recovery-code set, registered passkeys, or passkey requirement. After an address change, dedicated recovery sign-in uses the new email address. **Revoke sessions** ends browser sessions but does not remove registered sign-in methods or API credentials. When responding to a lost device or a compromised account, distinguish an existing browser session from the credentials that could create a new one. Ask the account owner to remove a lost passkey or replace the appropriate recovery set using the required identity proof. While passkeys are required, the owner needs a recent passkey or dedicated passkey-recovery sign-in and cannot remove the last registered key until adding another or explicitly disabling the requirement.

Dedicated passkey recovery matches the current email without regard to capitalization. If legacy accounts have addresses that differ only by case, recovery refuses that ambiguous address without consuming a code and shows a generic sign-in failure. Verify ownership under your instance's recovery process, then use the authorized **Users** email-edit flow to give the separate accounts distinct addresses. Changing capitalization alone does not resolve the collision. Coordinate the new addresses with their owners: email edits end existing sessions but preserve passkeys, the requirement, and unused recovery codes. Never request the codes to investigate an address collision.

Keep a tested administrator recovery method outside a single phone or laptop. A local administrator password is not a fallback while that account requires passkeys. The last-accessible-administrator safeguard does not prove that an administrator still possesses their authenticator, passkey, or recovery codes. There is no administrator control to turn off another account's passkey requirement. [Operator precautions](/hosting/maintenance#two-factor-authentication-and-passkey-migration) cover encryption keys, backups, and hostname changes.

Flare rejects an authenticator secret if its encrypted record is malformed or fails its integrity check. Do not shorten or edit encrypted values to repair an account. Restore the matching secret and valid backup, or help the owner use an available recovery code or passkey. Valid existing authenticator records require no re-enrollment after integrity-check hardening.
