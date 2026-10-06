---
title: Sessions and audit contracts
description: Browser-session APIs for personal login history, active-session revocation, and filtered instance audit events.
---

# Sessions and audit contracts

These routes serve the interactive [profile session controls](/guide/account#login-history-and-active-sessions) and [audit viewer](/admin/audit). They require a current browser session backed by a live server-side session record. **Neither named API tokens nor the legacy upload credential authorize them.** Do not attach an `Authorization` header as a substitute for the browser session.

The [OpenAPI document](/openapi.json) continues to describe named-token operations under `paths`; its `x-flare-browser-session-api` extension identifies this separate contract. The documentation request builder deliberately offers only named-token operations and never sends live requests. Existing token scopes and the `file.ready` webhook contract are unchanged.

## Personal sessions and login history

These routes operate only on the signed-in account, independently of `profile.update` and `users.sessions`. Responses are private and must not be shared-cached. Mutation requests must have an `Origin` matching `NEXTAUTH_URL`; an `Authorization` header is rejected even when a session cookie is present. The existing restricted session used for email verification can still use these self-service security routes.

| Method and path                     | Result                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/profile/sessions`         | `{ "sessions": [...] }` containing active, unexpired sessions for the caller.                                                                   |
| `DELETE /api/profile/sessions/{id}` | `{ "revokedCount": 1, "signedOut": false }` when revoking a different session; `signedOut` is true when the caller revokes the current session. |
| `DELETE /api/profile/sessions`      | `{ "revokedCount": 2, "signedOut": true }`; revokes every session for the caller, including the current one.                                    |
| `GET /api/profile/login-history`    | `{ "attempts": [...], "nextCursor": null }`; account-attributed successes/failures, newest first.                                               |

Counts above are examples, not fixed values. Session IDs are opaque record identifiers, not credentials. Use the server's `current` flag instead of matching user-agent strings to identify the current session.

A session has these fields:

```json
{
  "id": "example_session_id",
  "createdAt": "2026-10-06T10:00:00.000Z",
  "lastSeenAt": "2026-10-06T10:05:00.000Z",
  "expiresAt": "2026-11-05T10:00:00.000Z",
  "authMethod": "credentials",
  "ipAddress": "127.0.0.1",
  "userAgent": "Example browser",
  "current": true
}
```

`authMethod` currently uses `credentials` for password sign-in, `recovery` for authenticator recovery, `passkey`, `passkey-recovery`, or `oidc`. Render unknown future methods safely.

Login-history entries expose `id`, `createdAt`, `authMethod`, `outcome` (`success` or `failure`), `ipAddress`, and `userAgent`. IP and browser fields can be absent/null when unavailable. These fields do not prove a physical device, location, or attacker identity. No submitted password, authenticator code, recovery value, or bearer credential appears in the response.

History covers the last 90 days and returns at most 25 entries per page. Use `outcome=all`, `outcome=success`, or `outcome=failure` to filter history. Pass the returned opaque `nextCursor` in `cursor` (at most 512 characters) to fetch the next page with the same outcome filter; `null` means the current result is exhausted. A failure is included only when it can be attributed to that account. The unfinished authenticator challenge is not counted as a failure. Provider-side SSO failures and rate-limited attempts are not guaranteed to appear. History is not reconstructed for logins before the migration.

The security worker prunes login attempts older than 90 days and session rows whose fixed expiry is more than 90 days old, using bounded batches. This login-history retention is separate from the unbounded audit log.

Sessions have a fixed 30-day lifetime. Last-seen updates are throttled to one minute. Session revocation is enforced at subsequent authenticated requests; it does not cancel an already authorized transfer, retract downloaded bytes, or invalidate issued object-storage URLs. Account session-version invalidation from password/security changes continues to invalidate all prior browser sessions. Named tokens and legacy upload credentials retain their independent lifetime.

Do not confuse these JSON responses with `DELETE /api/users/{id}/sessions`, which requires delegated account-management authority and returns **204 No Content**. [Administrator session revocation](./roles#revoke-browser-sessions) keeps its existing response contract.

### Run the profile requests

Use the developer console of an already signed-in **disposable local Flare instance**. This code sends browser cookies to that same origin; do not copy them into a shell, URL, or documentation playground. Sign in to the same demonstration account in another browser first if you want to revoke that other session.

```js
async function activityRequest(path, method = 'GET') {
  const response = await fetch(path, { method, credentials: 'same-origin' })
  const result = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

const { sessions } = await activityRequest('/api/profile/sessions')
console.table(sessions)
const history = await activityRequest('/api/profile/login-history?outcome=all')
console.table(history.attempts)

const other = sessions.find((session) => !session.current)
if (other) {
  const result = await activityRequest(
    `/api/profile/sessions/${encodeURIComponent(other.id)}`,
    'DELETE'
  )
  console.log(result)
}
```

The other browser's next protected request should require sign-in. To exercise **all sessions**, including the console's own browser:

```js
await activityRequest('/api/profile/sessions', 'DELETE')
location.assign('/auth/login')
```

## Audit query

`GET /api/audit` requires a browser session with **`audit.read`**. Administrator satisfies that permission. It returns records across the whole instance; it is not limited by ownership or account-management role hierarchy. No write, purge, or token-authorized audit endpoint is provided.

| Query parameter                                          | Default and validation                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                                                      | Optional text, at most 200 characters; case-insensitive substring search across actor name, action, target name/ID, and request ID.                                  |
| `category`, `action`, `actorId`, `targetId`, `requestId` | Optional exact-match strings, at most 200 characters each.                                                                                                           |
| `outcome`                                                | Optional `success`, `failure`, or `denied`; omit for all outcomes.                                                                                                   |
| `from`, `to`                                             | Optional ISO timestamps bounding event time. Timezone offsets are accepted; `from` must not be later than `to`. Use UTC timestamps with a `Z` suffix in API clients. |
| `page`                                                   | Integer 1–100,000; default `1`.                                                                                                                                      |
| `limit`                                                  | Integer 1–100; default `50`.                                                                                                                                         |

The result has `{ events, total, page, limit, pages, filters }`. `filters` supplies global category and action choices as `{ categories: string[], actions: string[] }`, capped at 100 categories and 500 actions. The default query covers all time, and `pages` is at least `1` even with zero matches. Results are ordered newest first; page navigation reflects a live dataset, so new events can shift later pages. Keep the same filters across page requests. Dates are serialized as ISO strings.

Each event exposes `id`, `createdAt`, `action`, `category`, `outcome`, `actorId`, `actorName`, `targetType`, `targetId`, `targetName`, `requestId`, `method`, `route`, `status`, and `details`. Fields without available context can be null. `details` contains selected safe metadata, not a stable snapshot of an entire account/file/settings record. File snapshot `details.before.size` and `details.after.size` are database file sizes in MiB (1,048,576 bytes), not upload-request byte counts. Clients should tolerate new actions and extra metadata keys rather than treating the action list as a closed enum.

For example, from a signed-in disposable administrator's console, after defining `activityRequest` above:

```js
const query = new URLSearchParams({
  q: 'quarterly-report.txt',
  from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  to: new Date().toISOString(),
  page: '1',
  limit: '25',
})
const result = await activityRequest(`/api/audit?${query}`)
console.table(result.events)
console.log(result.total, result.filters)
```

Upload and change visibility/delete a disposable file with that name before running the query, or substitute a real demonstration filename. For failures, remove `q`, set `outcome=failure`, and compare with application logs. Do not print real instance audit records into public issue reports.

## Errors and compatibility

Missing or invalid browser sessions return `401`; insufficient audit permission returns `403`. Invalid query values, unknown audit query keys, repeated audit query keys, or an inverted date range return `400`. Audit-database failures return `503` with a retryable diagnostic message. A cross-origin revocation is rejected. Revocation of an unknown, expired, revoked, or differently owned session returns `404`; session IDs longer than 100 characters return `400`. Session mutations share the account-security management limit of 20 attempts per 15 minutes; `429` includes `Retry-After: 900`. Wait before retrying. Ownership checks prevent using another account's session ID to revoke that account's sign-in. Always test `response.ok` before treating a returned body as success.

The migration creates server-side session and audit records. Cookies issued before the migration do not have a session ID and must sign in again; custom browser clients should handle a fresh authentication challenge. Earlier login and audit history is not backfilled. See [operator upgrade and retention guidance](/hosting/maintenance#sessions-and-audit-log-migration) before rollout.

Most audit writes are best effort and events are retained independently of deleted actors/targets. Account deletion’s per-file audit insert is transactional: failure rolls back account removal and cleanup work. They are not a complete access log or tamper-evident ledger. See the [audit coverage and limitations](/admin/audit#retention-and-operational-limits) before using the data as evidence.
