---
description: Manage registration, accounts, administrator roles, content moderation, vanity links, and email access.
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

With `settings.security`, go to **Settings → Access → Registration**. Disable registration to prevent public password-account sign-ups, then add a useful message such as “This is a private team instance. Contact the administrator for access.” Existing users retain their accounts, and administrators can still create users.

OIDC auto-provisioning is a separate setting. Closing password registration does not by itself define which identities your identity provider may provision. Review both controls when operating a private instance.

## Create an account

1. With `users.create`, open Users and choose **New User**. Assigning additional roles also requires `users.roles`.
2. Enter the person's name and email.
3. Set a password of at least eight characters for an account that should sign in locally.
4. Select any additional **Roles** the person needs. Everyone applies automatically; leave the additional roles empty to use only that baseline. Assign the Admin role only for full instance control.
5. Save and communicate the sign-in details through your normal secure channel.

The account form requires a name of at least two characters and a valid email. When email is enabled, password inputs are limited to 72 UTF-8 bytes. Do not treat a passwordless local account as an invitation or an SSO link: there is no email-based automatic account linking. [SSO provisioning](/admin/sso#account-creation-and-identity) explains how new SSO accounts are created.

With email enabled, new administrator-created accounts follow the configured **inherit/exempt** verification policy. Flare can queue a verification message when recovery or verification is active, but that is not a substitute for creating a working sign-in method.

## Edit identity and links

The edit dialog lets you change name, email, roles, password, URL ID, and vanity URL, when your permissions allow those actions. Role assignment requires `users.roles`; identity edits require `users.update`. Delegated managers can affect only accounts below their highest role. Leave the password empty when you do not intend to replace it.

<Screenshot src="/screenshots/roles/user-roles.webp" alt="Edit User dialog with multiple role selections, identity fields, and URL settings" caption="Account edits include both identity details and the user's share-link identifiers." />

The normal **URL ID** is five alphanumeric characters. A **vanity URL** is a friendlier optional identifier, 3–32 characters using letters, numbers, and internal hyphens. It cannot start or end with a hyphen, collide with another user's identifiers, or use reserved application paths such as `api`, `dashboard`, or `setup`. Clearing the vanity field removes it.

Changing the normal URL ID updates existing file URL records but keeps storage paths unchanged. Previously distributed links containing the old identifier can stop working; coordinate this with the account owner. Changing an email address resets proof of that address and cancels obsolete account tokens. When email is enabled, relevant email/password changes invalidate existing sessions as well.

Keep at least one accessible local administrator account. Flare rejects supported account and role changes that would remove the last accessible administrator. Establish another trusted administrator with a working sign-in and durable email access before demoting or deleting one. See [recovery protection](./roles#protect-a-recovery-account).

## Manage verification and recovery access

With `users.email`, the user edit dialog exposes email verification state and exemption controls when email is enabled. This capability is separate from changing the instance email policy (`settings.email`). You can exempt a user, remove their exemption, or resend an eligible pending verification message.

An exemption permits access under the verification policy; it does not make an address verified or recoverable. Older accounts must enroll their recovery address from their own signed-in Profile. If resend says the user must enroll their address, ask them to complete that flow rather than assuming an old saved email is trustworthy.

Removing the last administrator exemption under an all-user policy requires a verified administrator recovery path. [Email policy details](/admin/email#choose-an-access-policy).

## Moderate files and shortened links

With `users.read` and `content.read`, choose **View Content** on a user to inspect their files and shortened URLs. Changing their file settings needs `content.update`; deleting content needs `content.delete`. Content permissions are instance-wide, including content owned by accounts above your role; they do not grant role assignment or instance settings access. The content dialog provides search, pagination, and file filters. You can open files, adjust visibility, delete a file, inspect link destinations/clicks, and remove shortened links. Removing a user's avatar is available from their row.

<Screenshot src="/screenshots/roles/users-content.webp" alt="Administrator content dialog listing a user's files and moderation actions" caption="Review an account's content without switching to its identity." />

Deletion has no recycle bin. Individual file deletion removes the database record and attempts to remove its bytes; it does not use the account-cleanup queue described below. If the storage backend is unavailable during individual file deletion, check logs for objects that may need reconciliation. Never make broad direct bucket deletions from a UI count alone.

## Revoke browser sessions

Choose **Revoke Sessions** on an account, review **Sign out {name}?**, then confirm **Revoke sessions**. This requires `users.sessions` and authority above that account. On success, the confirmation closes and **Sessions revoked** appears; the person must sign in again. The server returns an empty `204 No Content`, which is a successful result. It invalidates browser sessions; it does not revoke named API tokens or the legacy upload credential. Revoke or rotate those separately when retiring an integration.

If the request fails, the confirmation stays open and shows an error so you can address the cause and retry.

<Screenshot src="/screenshots/roles/sessions-revoked.webp" alt="Users list with a Sessions revoked notification saying Morgan Lee will need to sign in again" caption="Successful session revocation closes the confirmation and reports that the account must sign in again." />

## Delete an account

With `users.delete` and authority above the target account, read the confirmation carefully: deleting an account removes its account data and associated content, including file records, profiles, integrations, and short links. Account removal and durable cleanup jobs for stored files and the uploaded avatar commit together. A permission or last-administrator refusal leaves both the account and its stored bytes untouched. Once deletion succeeds, the removed account can no longer authenticate; no separate session-revocation permission is required.

A successful response means the account is gone and cleanup is queued. A background worker removes the bytes after commit and retries failures automatically, including after a restart. Storage downtime can delay that cleanup; already-issued S3 links or public avatar URLs can remain usable until the objects are deleted or links expire. For pending work, ask the operator to follow [account storage cleanup](/hosting/maintenance#account-storage-cleanup). External avatar URLs, backups, and external caches are outside that cleanup.

Offer a data export or make a backup before deleting content that may need to be retained. Account deletion is not temporary suspension; restoring it requires a suitable backup. Deleting a user also removes their API tokens and webhook configurations, so automations owned by that account stop working.
