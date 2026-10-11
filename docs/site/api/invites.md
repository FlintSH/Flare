---
title: Invite contracts
description: Browser-session APIs for creating, listing, and revoking invite links, the Everyone invite switch, and registering with an invite.
---

# Invite contracts

These routes serve [Profile → Invites](/guide/invites), **Users → Invites**, and the [invite settings](/admin/users#invite-links). Except for registration, they require a current browser session. **Neither named API tokens nor the legacy upload credential authorize them**, and bearer requests without a session cookie receive `401`. Mutations reject cross-origin requests, and `POST`/`PUT` bodies must be `application/json`.

The [OpenAPI document](/openapi.json) continues to describe only named-token operations under `paths`; these session routes are deliberately excluded. Existing token scopes and the `file.ready` webhook contract are unchanged.

| Method and path             | Permission                                                                                        | Result                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /api/invites`          | `scope=mine`: `invites.create` or `invites.manage`; `scope=all`: `invites.manage`                 | `{ invites, pagination, policy }`                  |
| `POST /api/invites`         | `invites.create`; `users.roles` and delegation authority to attach roles; member limits may apply | `201 { invite }`, including the new link's `token` |
| `DELETE /api/invites/{id}`  | `invites.create` for your own invite, or `invites.manage` for anyone's                            | `{ invite }` with status `revoked`                 |
| `GET /api/settings/invites` | `settings.read`                                                                                   | `{ everyoneCanInvite, limits }`                    |
| `PUT /api/settings/invites` | `settings.security` and your own `invites.create`                                                 | `{ everyoneCanInvite }`                            |
| `POST /api/auth/register`   | Public; an active `invite` works while registration is closed                                     | `{ user, nextAction }`, unchanged                  |

Invite data is private: these routes send `Cache-Control: private, no-store` with their results. Do not cache them in shared storage.

## Invite objects

```json
{
  "id": "example_invite_id",
  "note": "For Sam",
  "status": "active",
  "maxUses": 1,
  "uses": 0,
  "expiresAt": "2026-10-18T10:00:00.000Z",
  "revokedAt": null,
  "createdAt": "2026-10-11T10:00:00.000Z",
  "creator": { "id": "example_user_id", "name": "Alex Morgan" },
  "roles": [
    { "id": "example_role_id", "name": "Moderator", "color": "#f59e0b" }
  ],
  "members": [],
  "memberCount": 0,
  "token": "example-token-only-returned-to-its-creator",
  "canRevoke": true
}
```

| Field                    | Meaning                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                 | `active`, `paused`, `used`, `expired`, or `revoked`. `paused` means the creator can no longer create invites or grant the listed roles; it can become `active` again. Treat unknown values as unusable. |
| `maxUses`, `uses`        | Use limit, or `null` for no limit, and how many accounts the link has created.                                                                                                                          |
| `expiresAt`, `revokedAt` | ISO timestamps or `null`. `expiresAt: null` never expires.                                                                                                                                              |
| `creator`                | Account that created the invite. `name` can be `null`.                                                                                                                                                  |
| `roles`                  | Additional roles the link grants. Everyone always applies and is never listed.                                                                                                                          |
| `members`, `memberCount` | Up to ten accounts that joined with the link, oldest first, and their total. Deleted accounts are no longer counted, while `uses` keeps counting them.                                                  |
| `token`                  | The link's secret, returned only to its creator while the invite is `active` or `paused`. `null` for ended invites, other people's invites, and links that can no longer be decrypted.                  |
| `canRevoke`              | Whether the current session can revoke this invite now.                                                                                                                                                 |

Build a link with the instance's public origin: `https://files.example.com/auth/register?invite=<token>`. Tokens contain 43 URL-safe Base64 characters. They are secrets: never log them, place them in issue reports, or send them to a third-party service.

## List invites

`GET /api/invites` accepts these query parameters. Invalid values return `400`; other parameters are ignored.

| Parameter | Default  | Values                                                                                     |
| --------- | -------- | ------------------------------------------------------------------------------------------ |
| `scope`   | `mine`   | `mine` lists your invites; `all` lists every account's invites and needs `invites.manage`. |
| `status`  | `active` | `active` (includes `paused`), `ended` (`used`, `expired`, `revoked`), or `all`.            |
| `page`    | `1`      | Integer 1–100,000; a page beyond the end returns the last page.                            |
| `limit`   | `20`     | Integer 1–50.                                                                              |

Results are newest first. `pagination` contains `{ total, pageCount, page, limit }`. `policy` describes the caller:

```json
{
  "canCreate": true,
  "canManage": false,
  "canGrantRoles": false,
  "limits": { "activeInvites": 5, "usesPerInvite": 1, "lifetimeDays": 30 },
  "activeCount": 2
}
```

`limits` is `null` when member limits do not apply to the caller, because the caller has `users.create`. `activeCount` counts the caller's invites that are not used up, expired, or revoked; paused invites count.

## Create an invite

`POST /api/invites` accepts a strict JSON object. Omitted fields use the defaults below; unknown fields are rejected.

| Field            | Default | Validation                                                                             |
| ---------------- | ------- | -------------------------------------------------------------------------------------- |
| `note`           | `""`    | Trimmed text, at most 100 characters. Visible to the creator and invite managers only. |
| `maxUses`        | `1`     | Integer 1–1,000, or `null` for no limit.                                               |
| `expiresInHours` | `168`   | Integer 1–8,760 counted from creation, or `null` to never expire.                      |
| `roleIds`        | `[]`    | Up to 100 distinct role IDs. Everyone is not accepted; it always applies.              |

The response is `201 { "invite": { … } }` with the new `token`. For a caller without `users.create`, the server enforces the instance's member limits: `maxUses` must be at most `usesPerInvite`, `expiresInHours` must be at most `lifetimeDays × 24`, neither may be `null`, and the caller must have fewer than `activeInvites` active invites. Other callers can have up to 1,000 active invites.

Attaching roles requires `users.roles` and follows role delegation: each role must be below the caller's highest role and grant only permissions the caller holds, unless the caller has Administrator. The checks run again whenever someone uses the link; failing them pauses the invite instead of creating an account.

## Revoke an invite

`DELETE /api/invites/{id}` revokes an invite immediately and returns it with status `revoked`. The creator can revoke with `invites.create`; anyone with `invites.manage` can revoke any invite. Revoking an already ended invite marks it revoked. Accounts that joined are unaffected. An unknown ID, or another person's invite without `invites.manage`, returns `404`.

## Change who can invite

`GET /api/settings/invites` returns `{ "everyoneCanInvite": false, "limits": { "activeInvites": 5, "usesPerInvite": 1, "lifetimeDays": 30 } }`. `PUT /api/settings/invites` accepts exactly `{ "everyoneCanInvite": true }` or `false` and adds or removes `invites.create` on the Everyone role. Repeating the current value succeeds without another change. Change member limits through the [delegated settings route](./roles#delegated-settings-writes) using `settings.general.registrations.inviteLimits`, which requires `settings.security`.

## Register with an invite

`POST /api/auth/register` accepts an optional `invite` string alongside `name`, `email`, and `password`. When registration is closed, a request without `invite` still returns `404` with an empty body. A request with `invite` is checked even when registration is open, so an unusable invite never silently creates an account without its roles.

The invite is used in the same transaction that creates the account. A rejected registration, such as a duplicate email address, does not use it up. Concurrent requests cannot exceed `maxUses`. Invite failures return `400`:

```json
{ "error": "This invite link has already been used.", "code": "invite_used" }
```

| `code`           | Meaning                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| `invite_invalid` | Malformed or unknown token, including an invite deleted with its creator's account. |
| `invite_expired` | The invite expired.                                                                 |
| `invite_used`    | The invite reached its use limit.                                                   |
| `invite_revoked` | The invite was revoked.                                                             |
| `invite_paused`  | The creator can no longer create invites or grant the invite's roles.               |

The existing rate limit, email-verification policy, and validation rules apply. The response keeps its existing `{ "user": { … }, "nextAction": "sign_in" }` shape; `nextAction` is `verify_email` when the new account must verify its address. The created account appears in `GET /api/users` with `invitedBy: { "id": "…", "name": "…" }`; see [account contract changes](./roles#account-contract-changes).

## Run requests against a disposable instance

Use the developer console of a signed-in administrator on a **disposable local Flare instance**. The browser sends its own cookies to the same origin; never copy them into a shell, URL, or the documentation playground.

```js
async function inviteRequest(path, method = 'GET', body) {
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

const { invite } = await inviteRequest('/api/invites', 'POST', {
  note: 'Console example',
  maxUses: 1,
  expiresInHours: 24,
})
console.log(invite.status, invite.expiresAt)
const link = new URL('/auth/register', location.origin)
link.searchParams.set('invite', invite.token)
console.log('Open in a private window:', link.href)

const mine = await inviteRequest('/api/invites?scope=mine&status=all')
console.table(
  mine.invites.map(({ note, status, uses }) => ({ note, status, uses }))
)
await inviteRequest(`/api/invites/${encodeURIComponent(invite.id)}`, 'DELETE')
```

Opening the printed link after revocation shows **Invite unavailable**. Do not paste a real instance's invite link into a public report.

## Errors and compatibility

Missing sessions return `401` and insufficient permission returns `403`. Invalid query values or bodies return `400`; create validation errors include a `details` object. Reaching the active-invite limit returns `409`. Bodies over 32 KB return `413`, non-JSON mutations return `415`, and cross-origin mutations return `403`. Creating and revoking invites count toward Flare's general in-memory limit of 60 requests per minute per client address and process, which upload-token requests also use; `429` includes `Retry-After: 60`. If the server has no encryption key of at least 32 characters, creating an invite returns `503`; see [configuration](/hosting/configuration#core-environment-variables).

Every invite change is recorded under the `invites` [audit](/admin/audit) category without token values. The migrations add invite tables, an optional indexed `User.inviteId`, and two permissions that Everyone does not receive by default. Clients that list users should tolerate the added `invitedBy` field. See the [operator upgrade notes](/hosting/maintenance#invite-links-migration).
