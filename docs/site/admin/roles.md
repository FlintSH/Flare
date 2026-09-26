---
description: Create reusable permission groups, combine roles, delegate administration, and keep a safe recovery path.
---

# Roles and permissions

Roles let you give people the tools they need: a contributor can upload, a moderator can review content, and a designer can publish appearance without changing storage or account access. Open **Roles** in the dashboard to manage them. You need **Manage roles** (`roles.manage`), or **Administrator**, to change roles.

Every account receives **Everyone**, the instance's shared starting permissions. Additional roles add permissions to that baseline. A person can have several roles, and there is no separate “normal user” or “admin user” account type.

<Screenshot src="/screenshots/roles/roles-overview.webp" alt="Roles screen with Admin, Support, Moderator, Creator, and Everyone and an explanation of full administrator access" caption="Real demonstration instance: Everyone supplies the baseline; additional roles describe separate responsibilities." />

## Your first roles

A new instance creates two roles automatically:

| Role         | Starting behavior                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Everyone** | Applies automatically to every account, including future local and SSO accounts. Includes the existing personal file, organization, link, profile, integration, and appearance capabilities. |
| **Admin**    | Assigned to the first account. Its **Administrator** permission grants every permission, including newly added permissions, and bypasses role hierarchy.                                     |

Everyone does not initially grant account administration, content moderation, instance settings, role management, or quota bypass. Administrators still follow maximum upload sizes, file validation, and applicable email verification rules.

Everyone cannot be deleted, renamed, reordered, manually assigned, or granted Administrator. You can change its permissions, color, and description. Removing a permission from Everyone affects every account that does not receive it through another role. Review that impact before saving: adding a restricted role does not subtract anything Everyone already grants.

## Create and assign a role

[Watch the recorded create-and-assign walkthrough](/demos#create-and-assign-a-role), then follow these steps on your own instance.

1. Open **Roles** and choose **Create role**. Give it a clear name, such as **Content moderators**, a short description, and a distinguishable color.
2. Under **Permissions**, use the grouped switches, **Find a permission…**, or **Enable group** / **Clear group** to choose the grants. Choose individual permissions for a narrowly scoped role.
3. Set **Position** below the roles that should manage it. Higher positions mean higher authority for managing roles and accounts; position does not add feature permissions.
4. Choose **Save role**. Creating it does not assign it to anyone.
5. In **Users**, open **Edit User → Roles** and select the additional roles it should receive. Everyone is already included automatically. Save the account.
6. Ask the person to refresh their workspace. Confirm that their intended workflow works and unrelated administrative actions are unavailable.

Role names are 1–50 characters, descriptions up to 300 characters, and colors use six-digit hex values. An instance can have at most 100 roles, including Everyone and Admin. Several roles may have the same permissions. Use a small set of clear responsibilities before introducing many overlapping roles.

<Screenshot src="/screenshots/roles/role-editor.webp" alt="Moderator role editor filtered to the content moderation group, showing read, edit, and delete switches" caption="Search for a permission or group, review the grants, then save the role." />

<Screenshot src="/screenshots/roles/user-roles.webp" alt="Edit User dialog with both Moderator and Creator selected while Everyone applies automatically" caption="An account can combine several roles. Clearing one selection does not remove grants from its other roles." />

## How permissions combine

Permissions are **additive**. Flare combines Everyone and all assigned roles. If any role grants an action, the account can perform it. A disabled permission switch means that role does not grant it; it does not deny a permission granted elsewhere.

For example, removing **Upload files** from a **Readers** role will not stop uploads while Everyone still grants them. To make uploads opt-in, remove that permission from Everyone and grant it through a **Contributors** role. Existing files are not deleted when upload permission is removed. Without `files.share`, new uploads are forced private; removing that permission does not revoke existing public links.

The **Administrator** permission is a wildcard with full access. A role named “Administrator” without that permission is just another role; a differently named role containing it has full administrator access. Grant it only to people trusted with the entire instance.

<RoleLab />

## Permission reference

These are the keys used in role records and the session permission list. The interface groups them by the work they enable.

| Area                | Permission keys                                                                                              | What they allow                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full administration | `administrator`                                                                                              | Every permission and hierarchy bypass; does not disable email policy or maximum file size.                                                             |
| Personal files      | `files.read`, `files.upload`, `files.update`, `files.delete`, `files.share`                                  | Browse owned files, upload, edit, delete, and change sharing. These do not grant access to someone else's private files.                               |
| Pastes              | `pastes.create`                                                                                              | Create a paste as a hosted text file. Upload access is also needed.                                                                                    |
| Organization        | `folders.manage`, `folders.share`, `tags.manage`                                                             | Manage owned folders, publish/revoke folder links, and manage tags and rules.                                                                          |
| Short links         | `links.read`, `links.create`, `links.delete`                                                                 | List, create, and delete owned short links separately.                                                                                                 |
| Profile and data    | `profile.update`, `profile.export`                                                                           | Change personal profile settings, including self-deletion, or export account data.                                                                     |
| Saved uploads       | `uploadProfiles.manage`                                                                                      | Create, update, import, export, and choose upload profiles.                                                                                            |
| Integrations        | `tokens.manage`, `webhooks.manage`                                                                           | Manage one's own upload credentials/named tokens, or webhook destinations and delivery controls.                                                       |
| Personal appearance | `appearance.personal`                                                                                        | Change personal appearance preferences.                                                                                                                |
| Accounts            | `users.read`, `users.create`, `users.update`, `users.delete`, `users.sessions`, `users.email`, `users.roles` | List, create, edit, delete accounts; invalidate sessions; manage email access; assign roles. These are independent permissions and obey hierarchy.     |
| Content moderation  | `content.read`, `content.update`, `content.delete`                                                           | Inspect other accounts' files/links, change their file settings, or delete their content. Reading includes private and password-protected file access. |
| Role administration | `roles.manage`                                                                                               | Create and maintain roles within the delegation rules below.                                                                                           |
| Instance settings   | `settings.read`, `settings.general`, `settings.security`, `settings.storage`, `settings.email`               | Inspect instance settings, change General, change registration/SSO, change storage/limits, or manage email configuration and delivery.                 |
| Instance appearance | `appearance.manage`                                                                                          | Manage the appearance studio, branding, assets, and favicon. Executable custom CSS/head HTML requires Administrator.                                   |
| Storage allowance   | `quotas.bypass`                                                                                              | Bypass the shared per-account storage quota, while retaining maximum file-size limits.                                                                 |

Scheduling expiration needs `files.update` plus `files.delete` for deletion or `files.share` for making a file private. An expiring upload also requires the action permission, including inherited profile/account expiry. `profile.update` allows deleting your own account and its content even without `files.delete`, subject to administrator recovery protection. `profile.export`, `files.read`, and `links.read` are all required for the full account export, so removing reading permission cannot be bypassed by downloading an archive.

Your own verification, enrollment, recovery, and confirmed email-change flows remain available under their existing identity/email checks even without `profile.update`. They preserve a way to secure or recover the account and do not grant access to role administration.

Permissions do not transfer file ownership, create per-folder membership lists, encrypt content from operators, or create separate storage pools. A role does not have its own numeric quota. Public URLs retain their sharing behavior: removing dashboard access does not revoke a previously shared public file, folder link, or short URL.

## Delegate without handing over the instance

A person with **Manage roles** can manage only roles **strictly below** their highest assigned role. The same hierarchy protects accounts: delegated account management cannot affect someone whose highest role is equal to or above the manager's. Equal positions are peers, even when the role names differ. The target account must also have no effective permission the manager lacks. This prevents a manager from acquiring a more capable account by resetting its credentials, even if its role has a lower position. Administrator bypasses these delegation checks.

Editing or deleting a role affects every account assigned that role, including accounts whose other roles have higher positions. That operation checks authority over the role itself; directly editing an account or its assignments checks the account’s complete authority.

A delegated manager cannot grant a permission they do not currently hold, including through editing an existing role, creating a role, or assigning a more powerful role. Editing or deleting an existing role also requires every permission it currently grants to be within the manager’s own grants, even for a rename or removal of a permission. **Manage roles** does not itself include **Assign roles** (`users.roles`), and **Edit users** does not allow changing role assignments. Give both role and account capabilities only where needed.

Example responsibilities:

| Role                 | Useful grants beyond Everyone                                    | Intended scope                                                                            |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Content moderators   | `users.read`, `content.read`, `content.update`, `content.delete` | Review accounts and moderate content without changing login details or settings.          |
| Appearance designers | `settings.read`, `appearance.manage`                             | Publish the instance's design without storage or email administration.                    |
| Account support      | `users.read`, `users.update`, `users.sessions`, `users.email`    | Help accounts below their role recover access; cannot assign roles without `users.roles`. |
| Contributors         | `files.upload`, `pastes.create`                                  | Restore upload/paste capabilities after those permissions are removed from Everyone.      |

Custom CSS/head HTML requires Administrator because it can execute code in other people’s browser sessions; a delegated designer cannot use those advanced editors.

Content moderation is instance-wide and does not use the account-management hierarchy: these grants can apply to content owned by higher-ranked accounts. Content reading is sensitive: a moderator with `content.read` can see private content and bypass file passwords. Explain this access to the people using your instance. [Sharing and privacy](/guide/sharing) describes the reader-facing boundaries.

### Manage permissions on a phone

The same role groups and permission search are available on narrow screens. Open the navigation menu, choose **Roles**, select a role, then use its permission switches and **Save role**. Role hierarchy and validation are the same as on desktop.

<div style="max-width: 390px; margin-inline: auto">
<Screenshot src="/screenshots/roles/roles-mobile.webp" alt="Mobile role editor with separate View all content, Edit all content, and Delete all content switches" caption="Content reading, editing, and deletion remain separate choices on a phone." />
</div>

## Changes take effect on the next request

The server loads current permissions for authenticated requests. Removing a role or changing its permissions takes effect on the next request without waiting for a browser session to expire. A screen already open may still show old controls until refreshed; the server rejects actions that are no longer allowed.

[Named API tokens](/api/authentication#scopes-and-account-roles) must satisfy both their selected scope and their owner's current role permissions. An existing upload token stops authorizing uploads when its owner's upload permission is removed. Changing a role does not erase tokens or their stored scope choices; granting the permission again can restore access to an otherwise valid token. Revoke the token too when you intend permanent retirement.

Removing `tokens.manage` stops credential management, but existing tokens keep working while their scopes and the owner’s operation permissions allow them. Revoke/rotate the credential or remove those operation grants to stop its use. Saved profiles, preferences, and rules are not erased by removing their management permissions.

Existing scheduled expiration actions continue after role revocation. Removing `webhooks.manage` stops management access, but enabled webhook destinations and queued deliveries continue. Disable/delete the destination to retire it. Existing public links and already-issued S3 signed URLs have their own lifetimes. Permission changes cannot retract bytes already downloaded. Review [storage access](/hosting/storage#private-files-and-signed-links) when revoking sensitive content access.

## Protect a recovery account

Flare refuses role and account changes that would leave no **accessible administrator**. That means an account with the Administrator permission, a local password or an OIDC identity matching the currently enabled provider, and durable access under the email policy. A temporary all-user verification grace period alone is not a recovery path. The check verifies the configured issuer and enabled state; it cannot prove that the identity provider is online or its credentials work. Settings changes cannot disable the only administrator’s matching SSO provider; establish a local-password administrator first.

Before removing an administrator role, deleting an administrator account, or tightening email policy, establish and test another administrator's sign-in. Keep a local administrator login even if you use SSO. Verify its recovery address or maintain a deliberate policy exemption.

If an action is refused, assign a role granting Administrator to another trusted account, confirm its sign-in and email access, then retry. Removing Everyone permissions cannot remove Administrator's wildcard. These safeguards protect supported application operations; they cannot repair direct database edits, lost credentials, or a failed identity provider. Restore a known-good [backup](/hosting/maintenance) when no administrator can sign in, and use the [email lockout recovery](/admin/email#recover-from-an-email-lockout) procedure only when email enforcement is the cause.

## Upgrade an existing instance

The database migration replaces the former `USER`/`ADMIN` field with role assignments. Existing `ADMIN` accounts receive the Admin role. All accounts receive Everyone automatically, preserving the former personal capabilities without assigning an extra role to every user. Files, ownership, tokens, profiles, and SSO identities stay in place.

Existing dashboard clients must replace scalar `role` values with `roleIds` on create/update and `roles` in responses. The user-list filter becomes `roleId`. Legacy values are not a compatibility API. See the [session API contract](/api/roles) and [upgrade checklist](/hosting/maintenance#upgrading-to-roles).

## Troubleshoot access

| Symptom                                        | Check and recovery                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A permission seems impossible to remove        | Inspect Everyone and every assigned role. Another grant wins; there are no explicit denies.                                                  |
| A person can use an unexpected feature         | Check every role for that permission or Administrator, including the Everyone baseline.                                                      |
| A role or account is uneditable                | Your highest role must be strictly higher, the target account cannot have permissions you lack, and you need the specific action permission. |
| A former administrator has no settings access  | Confirm the migration completed and the account has a role containing `administrator`; inspect migration logs before changing data.          |
| A saved token stops working                    | Check its scope, the owner's current role grants, token revocation/expiry, and email access.                                                 |
| A user sees stale controls after a role change | Refresh the page. Authorization already uses current server permissions.                                                                     |
| Removing a role or account is refused          | Establish another accessible administrator before retrying.                                                                                  |

## Reproduce the permission checks locally

Contributors can run the real browser/API regression script against an isolated local instance. Start Flare on `http://127.0.0.1:3060` (or set `FLARE_ROLES_TEST_ORIGIN` to another loopback origin), complete setup with the demonstration name **Alex**, email `alex@example.test`, and password `Roles-demo-only-2026!`. Use a disposable database and local storage; the script creates accounts, roles, tokens, and files and temporarily changes Everyone and edits instance settings. These credentials are public fixtures, never production credentials.

From the repository root:

```sh
npm ci --prefix docs/site
cd docs/site
npx playwright install chromium
cd ../..
node scripts/roles/verify.cjs
```

Linux hosts also need Playwright's browser system libraries; a machine administrator can install those using `npx playwright install-deps chromium`. The script rejects non-loopback hostnames. `PW_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium binary.

The checks exercise first-account grants, additive roles, role and account hierarchy, self-escalation rejection, administrator recovery guards, delegated settings writes, credential redaction, live session/token revocation, and private uploads without sharing permission. Review its JSON results and exit status. It restores Everyone's starting grants on completion but deliberately leaves demonstration fixtures for inspection; discard the whole isolated instance afterward. The [session request walkthrough](/api/roles#run-a-request-against-a-disposable-instance) provides a smaller manual create/assign/remove example.
