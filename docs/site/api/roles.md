---
title: Roles and session contracts
description: Session-only role management, account role assignments, settings delegation, and migration compatibility for dashboard contributors.
---

# Roles and session contracts

The dashboard uses a **browser session** to administer roles and accounts. These routes do not accept named API tokens or a legacy upload credential as a substitute for that session. They are listed here for contributors and existing dashboard clients; the [named-token OpenAPI document](/openapi.json) deliberately excludes them.

Authorization uses the current account's permissions from Everyone plus all assigned roles, reloaded for authenticated requests. The server rechecks authority inside serialized role/account mutations, so a stale open editor does not preserve permission after revocation. See the [roles guide](/admin/roles) for the permission catalog and safety rules.

## Role routes

| Method and path          | Permission                                            | Response                                        |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------- |
| `GET /api/roles`         | Any of `roles.manage`, `users.roles`, or `users.read` | `{ "roles": [...], "permissionGroups": [...] }` |
| `POST /api/roles`        | `roles.manage`, plus delegation checks                | `201` and the created role object               |
| `PATCH /api/roles/{id}`  | `roles.manage`, plus delegation checks                | `200` and the updated role object               |
| `DELETE /api/roles/{id}` | `roles.manage`, plus delegation checks                | `200` and `{ "success": true }`                 |

Administrator satisfies all permission checks. Role writes enforce same-origin requests. POST/PATCH require `Content-Type: application/json` and a body no larger than 32 KiB, including streamed bodies. GET responses use `Cache-Control: private, no-store`. Role IDs are opaque strings. The list is ordered by descending position, then name, and includes Everyone. Its `memberCount` counts every account for Everyone and explicit assignments for other roles.

A role has this shape; this example is demonstration data:

```json
{
  "id": "example_role_id",
  "name": "Content moderators",
  "description": "Review shared content and respond to reports.",
  "color": "#6366f1",
  "position": 20,
  "systemKey": null,
  "permissions": [
    "users.read",
    "content.read",
    "content.update",
    "content.delete"
  ]
}
```

`memberCount` is added by the list route. `permissionGroups` is an array of `{ id, label, description, permissions }`, where each permission is `{ key, label, description }`. Render the server catalog rather than inferring grants from the role's display name or color.

### Write validation

| Field         | Create default and rules                                           |
| ------------- | ------------------------------------------------------------------ |
| `name`        | Required, trimmed, 1–50 characters.                                |
| `description` | Empty string by default; trimmed, at most 300 characters.          |
| `color`       | `#64748b` by default; exactly `#` plus six hex digits.             |
| `position`    | `1` by default; integer from 1 through 1,000,000. Higher is above. |
| `permissions` | Empty array by default; unique keys from the permission catalog.   |

PATCH accepts a nonempty subset of these fields. Unknown fields, duplicate permissions, unknown permission keys, and invalid values produce `400`. The maximum is **100 roles**, including built-in roles. Everyone's position is zero and cannot change; only it can use zero. Its name is fixed, it cannot be deleted, and it cannot receive `administrator`.

`systemKey` identifies the built-in roles and is server-owned. The initial Admin role can be renamed, recolored, reordered, edited, or deleted subject to the administrator recovery safeguard. Permission checks use its grants, not its system key or name.

### Delegation and errors

A non-administrator can change only roles below their own highest role and grant only permissions they currently hold. Both a role’s current and proposed position and full permission set are checked. A delegated manager cannot rename or delete a lower role that currently contains a permission the manager lacks, even when the proposed edit would remove that permission. Assigning/removing a role also checks the affected role's grants; removing an assignment is not an escape from the delegation boundary.

Errors use an `error` string; validation errors may additionally include `details`. A missing session returns `401`; insufficient permission/hierarchy returns `403`; an unknown role returns `404`. A mutation that would remove the last accessible administrator returns `409` and rolls back. Invalid Everyone changes and the total role limit return `400`; cross-origin writes return `403`, oversized JSON `413`, and an unsupported content type `415`.

Role edits/deletion apply to all members, including accounts with other, higher roles; authorization checks the edited role itself. Direct account writes and assignments instead check the target account’s full hierarchy and grants. Deleting a role removes its assignments. It does not delete accounts or files. Everyone and other roles continue granting their own permissions, so deleting one role is not a guarantee that all its former members lose each permission.

## Account contract changes

The former scalar `role: "USER" | "ADMIN"` no longer exists. Use:

- **Create:** `POST /api/users` with `name`, `email`, optional `password`, and optional `roleIds`. Empty/omitted roles uses Everyone alone; adding roles also requires `users.roles`.
- **Edit:** `PUT /api/users` with `id` and the fields being changed. A role-only edit can send `{ "id": "…", "roleIds": ["…"] }`. Role assignment needs `users.roles`; identity edits need `users.update`.
- **Read:** directory, account-creation, and account-update responses expose `roles`, an array of role summaries including implicit Everyone; session users also expose effective `permissions`. Read permission keys instead of comparing role names. The legacy `/api/users/{id}/login` metadata response contains only explicitly assigned roles and does not expose effective permissions.
- **Filter:** `GET /api/users?roleId=ROLE_ID` replaces the old scalar role filter. Filtering by Everyone returns all accounts. Pagination still uses `page` and `limit`, with an optional `search` value.

`roleIds` is a replacement set of at most 100 distinct, existing, non-Everyone role IDs. Omitting it on update preserves assignments; passing `[]` removes additional roles. Never send Everyone's ID: it applies implicitly. The old `role` field is no longer supported; update custom dashboard clients with the server migration.

A non-administrator also cannot manage an account whose effective permissions include grants the actor lacks, even when its role position is lower. This prevents credential-reset escalation. Account actions obey the [individual permission matrix](/admin/users#roles-and-permissions), target-account hierarchy, and last-accessible-administrator protection. A successful role-only update does not grant identity-edit authority. Assignments change server authorization on the next request, even if a browser's old session display has not refreshed.

## Run a request against a disposable instance

This example runs in the developer console of an **already signed-in, disposable local Flare instance**. It creates a real role and then assigns it to an existing demonstration account. Replace the account ID with the real ID from that local instance. Do not run it on the documentation site or paste credentials into it. Your session needs Administrator, or `roles.manage`, `users.roles`, `users.read`, and `content.read` together and must pass the hierarchy and delegation checks. The latter two grants are needed because the example gives them to the role.

```js
async function request(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

const role = await request('/api/roles', 'POST', {
  name: 'Demo reviewers',
  description: 'Disposable permission walkthrough.',
  color: '#6366f1',
  position: 20,
  permissions: ['users.read', 'content.read'],
})
console.log(role.id)

const targetUserId = 'REPLACE_WITH_DISPOSABLE_ACCOUNT_ID'
await request('/api/users', 'PUT', {
  id: targetUserId,
  roleIds: [role.id],
})
```

The assignment replaces that account's additional roles, so use an account created for this demonstration. Sign in as that account in another browser context and verify that content reading works while content changes, deletion, role editing, and instance settings remain denied. Clean up with the original privileged session:

```js
await request(`/api/roles/${encodeURIComponent(role.id)}`, 'DELETE')
```

Removing the demo role removes its assignments, leaving the account's Everyone permissions. This is a session example, not a token recipe. The [API request builder](/api/#explore-a-request) continues to offer only supported named-token operations.

## Content moderation deletion

`DELETE /api/users/{id}/urls/{urlId}` requires an interactive session with `content.delete` and a same-origin request. It deletes only a short link whose owner matches the target account in the path; a missing link or wrong owner returns `404`. Success is `204 No Content`; do not parse a successful response body as JSON. This is separate from the named-token `DELETE /api/urls/{id}`, which remains limited to the token owner's links. Public redirects stop after deletion.

## Delegated settings writes

`GET /api/settings` returns private settings only for an interactive session with `settings.read`; named tokens receive the public projection. Storage and OIDC secrets are masked in that response.

For `PATCH /api/settings`, send a partial `{ "settings": { ... } }` body. Every supplied section is checked before any changes are accepted:

| Field                                                     | Permission          |
| --------------------------------------------------------- | ------------------- |
| `settings.general.credits`, `settings.general.ocr`        | `settings.general`  |
| `settings.general.registrations`, `settings.general.oidc` | `settings.security` |
| `settings.general.storage`                                | `settings.storage`  |
| `settings.appearance`                                     | `appearance.manage` |
| `settings.advanced` (custom CSS/head HTML)                | `administrator`     |

Empty/unknown sections do not grant an escape from these checks. Custom CSS/head HTML can execute code in the instance browser context and therefore requires Administrator. The legacy whole-settings `POST /api/settings` operation also requires Administrator. Email and the appearance studio retain their dedicated routes. Reading settings does not grant permission to write any section; writing a section does not authorize replacing the whole configuration.

## Tokens, events, and compatibility

Named-token scope names and their supported paths are unchanged. They now intersect the owner's current permissions: for example `files:upload` also needs `files.upload`; creating a link with `urls:write` needs `links.create`, and deleting one needs `links.delete`. See [authentication](/api/authentication#scopes-and-account-roles).

Role edits and account assignments do not emit a webhook event. The existing `file.ready` payload, version, signing format, retry policy, and event JSON Schema are unchanged. Webhook management itself requires `webhooks.manage`; it is not a named-token capability.
