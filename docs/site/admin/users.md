---
description: Manage registration, accounts, administrator roles, content moderation, vanity links, and email access.
---

# Users, roles, and access

Open **Users** in the dashboard to find accounts by name or email, filter by role, and inspect file counts, storage use, and shortened links. The list is paginated so you can manage a larger instance without loading every account at once.

<Screenshot src="/screenshots/workspace/users.png" alt="User management table showing accounts, roles, file counts, and actions" caption="Administrators can manage accounts and open each user's content from one list." />

## Roles and permissions

| Capability                                                                                   | User                       | Admin                          |
| -------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------ |
| Upload, organize, share, and delete own files                                                | Yes, within instance rules | Yes                            |
| Create pastes, shortened links, upload profiles, API tokens, and webhooks                    | Yes                        | Yes                            |
| Change own profile and personal appearance                                                   | Yes                        | Yes                            |
| Access another user's private or password-protected file through administrator access checks | No                         | Yes                            |
| Manage accounts and moderate their files/links                                               | No                         | Yes                            |
| Change instance settings and published appearance                                            | No                         | Yes                            |
| Subject to the instance's ordinary-user storage quota                                        | Yes, when enabled          | No                             |
| Subject to maximum file size                                                                 | Yes                        | Yes                            |
| Subject to applicable email verification policy                                              | Yes                        | Yes, unless exempt or verified |

An Admin role grants instance-wide control. There is no intermediate moderator role, per-folder permission group, per-account quota setting, or built-in suspended-account state. A private file is accessible to its owner and administrators; its password protects other authorized viewers rather than hiding content from the server operator.

## Open or close registration

Go to **Settings → Access → Registration**. Disable registration to prevent public password-account sign-ups, then add a useful message such as “This is a private team instance. Contact the administrator for access.” Existing users retain their accounts, and administrators can still create users.

OIDC auto-provisioning is a separate setting. Closing password registration does not by itself define which identities your identity provider may provision. Review both controls when operating a private instance.

## Create an account

1. In Users, choose the create-user action.
2. Enter the person's name and email.
3. Set a password of at least eight characters for an account that should sign in locally.
4. Choose **User** for ordinary access or **Admin** for trusted instance administrators.
5. Save and communicate the sign-in details through your normal secure channel.

The account form requires a name of at least two characters and a valid email. When email is enabled, password inputs are limited to 72 UTF-8 bytes. Do not treat a passwordless local account as an invitation or an SSO link: there is no email-based automatic account linking. [SSO provisioning](/admin/sso#account-creation-and-identity) explains how new SSO accounts are created.

With email enabled, new administrator-created accounts follow the configured **inherit/exempt** verification policy. Flare can queue a verification message when recovery or verification is active, but that is not a substitute for creating a working sign-in method.

## Edit identity and links

The edit dialog lets you change name, email, role, password, URL ID, and vanity URL. Leave the password empty when you do not intend to replace it.

<Screenshot src="/screenshots/workspace/users-edit.png" alt="Administrator editing a user's identity, role, and URL settings" caption="Account edits include both identity details and the user's share-link identifiers." />

The normal **URL ID** is five alphanumeric characters. A **vanity URL** is a friendlier optional identifier, 3–32 characters using letters, numbers, and internal hyphens. It cannot start or end with a hyphen, collide with another user's identifiers, or use reserved application paths such as `api`, `dashboard`, or `setup`. Clearing the vanity field removes it.

Changing the normal URL ID updates existing file URL records but keeps storage paths unchanged. Previously distributed links containing the old identifier can stop working; coordinate this with the account owner. Changing an email address resets proof of that address and cancels obsolete account tokens. When email is enabled, relevant email/password changes invalidate existing sessions as well.

Keep at least one accessible local administrator account. Do not rely on the interface to protect every possible last-admin deletion or role-change scenario. All-user email policy saves do protect against losing the last verified/exempt administrator recovery path, but that is not a general guarantee for every account action.

## Manage verification and recovery access

The user edit dialog exposes email verification state and exemption controls when email is enabled. You can exempt a user, remove their exemption, or resend an eligible pending verification message.

An exemption permits access under the verification policy; it does not make an address verified or recoverable. Older accounts must enroll their recovery address from their own signed-in Profile. If resend says the user must enroll their address, ask them to complete that flow rather than assuming an old saved email is trustworthy.

Removing the last administrator exemption under an all-user policy requires a verified administrator recovery path. [Email policy details](/admin/email#choose-an-access-policy).

## Moderate files and shortened links

Choose **View Content** on a user to inspect their files and shortened URLs. The content dialog provides search, pagination, and file filters. You can open files, adjust visibility, delete a file, inspect link destinations/clicks, and remove shortened links. Removing a user's avatar is available from their row.

<Screenshot src="/screenshots/workspace/users-content.png" alt="Administrator content dialog listing a user's files and moderation actions" caption="Review an account's content without switching to its identity." />

Deletion has no recycle bin. File deletion removes the database record and attempts to remove its bytes. If the storage backend is unavailable during administrative cleanup, check logs for objects that may need reconciliation. Never make broad direct bucket deletions from a UI count alone.

## Delete an account

Read the confirmation carefully: deleting an account removes its account data and associated content, including file records, profiles, integrations, and short links. The UI invalidates its browser sessions before deletion and the server attempts to delete its stored files and uploaded avatar.

Offer a data export or make a backup before deleting content that may need to be retained. Account deletion is not temporary suspension; restoring it requires a suitable backup. Deleting a user also removes their API tokens and webhook configurations, so automations owned by that account stop working.
