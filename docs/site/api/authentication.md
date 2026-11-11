---
title: Authentication & scopes
description: Create, restrict, rotate, and troubleshoot Flare API tokens.
---

# Authentication & scopes

With `tokens.manage`, create one named API token for each script or service in **Profile → Integrations**. Give it only the permissions it uses. You can revoke a connection without interrupting your other tools.

## Create a token

1. In **Profile → Integrations**, choose **New token** to open the creation dialog. Choose a name of 1–80 characters. Use the name to identify the machine, service, or purpose.
2. Select one or more scopes from the table below. The form offers a scope only while your role allows at least one of its operations, as listed in [Scopes and account roles](#scopes-and-account-roles). For example, `urls:write` appears with either `links.create` or `links.delete`.
3. Review **Expires after**, which starts at **90 days**. Choose 30 days, 90 days, 1 year, or Never; Never keeps the token active until revoked.
4. If it uploads files, optionally bind it to one of your saved upload profiles.
5. Create the token and save the displayed `flr_…` secret in your tool's secret store.

The full value is shown once. Flare stores a hash rather than the recoverable token. If you lose it, revoke the token and create a replacement. Each account can have **50 active named tokens**. Expired and revoked tokens do not count toward that limit. Token and webhook changes for one account run one at a time, so concurrent requests cannot exceed it. The integrations screen retrieves the latest 100 token records and shows creation, expiration, revocation, and last-use information. Each token also lists the scopes it can still use with your current role, and the upload profile it's bound to, if any. The bound profile is the outlined chip with a sliders icon; the filled chips are scopes.

## Send a token

```http
Authorization: Bearer flr_YOUR_TOKEN
```

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  "$FLARE_URL/api/files?limit=10"
```

For that listing request, the token needs `files:read`. Authentication schemes are case-insensitive (`Bearer` and `bearer` work); the secret itself is case-sensitive. Tokens belong in the header, not in the URL.

A named `flr_` bearer token uses its own authority even if browser cookies accompany the request. A signed-in administrator's cookie does not add permissions to a named token on these routes. Scripts, servers and command-line clients can call Flare as shown. A web app running in a browser on another site also needs the instance to allow its origin; see [call Flare from a web app](#call-flare-from-a-web-app). The docs builder does not act as an authenticated proxy to your instance.

## Call Flare from a web app

Browsers refuse to let a page read answers from another site unless that site allows it with CORS headers. Flare sends none by default, so a web app on its own origin, such as a PWA at `https://app.example.com` or a dev server at `http://localhost:5173`, gets `TypeError: Failed to fetch` and a CORS error in the console, even with a valid token. The same request from `curl` works.

The instance operator turns cross-origin access on with [`FLARE_CORS_ORIGINS`](/hosting/configuration#cross-origin-browser-access) and restarts Flare:

```sh
FLARE_CORS_ORIGINS=https://app.example.com,http://localhost:5173
```

Then the app sends a named token in the `Authorization` header, as any client does:

```js
const flare = 'https://files.example.com'
const token = 'flr_YOUR_TOKEN' // from the person using the app, never hardcoded

const response = await fetch(`${flare}/api/files?limit=10`, {
  headers: { Authorization: `Bearer ${token}` },
})
if (!response.ok) throw new Error((await response.json()).error)
const { data } = await response.json()

// File content follows the file's own access rules, not the token,
// so this works for public files.
const bytes = await fetch(`${flare}/api/files/${data[0].id}/download`)
const blob = await bytes.blob()
```

What other sites can reach:

- **Every method a named token can call**, listed in the [scope reference](#scope-reference). The token's scopes and its owner's role permissions apply exactly as they do elsewhere. Browsers send a preflight `OPTIONS` request first; Flare answers it for these routes and caches it in the browser for 10 minutes.
- **File content for anonymous visitors**, with `GET` and `HEAD`: `/{userUrlId}/{filename}/raw`, `/{userUrlId}/{filename}/direct`, `/api/files/{path}`, and `/api/files/{id}/download`, `/thumbnail` and `/ocr`. Public files work, password-protected ones with the `password` query value. Private files stay unavailable to other sites: named tokens [don't unlock file content](./endpoint-inventory#file-content-and-access-checks), and a page can't read an answer that Flare's session cookie authorized.
- **Response headers** an app needs: `Retry-After` on API routes, and `Accept-Ranges`, `Content-Disposition` and `Content-Range` on file content.

What stays on Flare's own pages:

- **The session cookie never works for another site.** Flare doesn't send `Access-Control-Allow-Credentials`. A request without `credentials: 'include'` carries no Flare cookie and answers `401`. With it, a browser can still send the cookie, for example between two ports of `localhost` or two subdomains of one site, but it won't let the page read the answer, and a change the cookie authorizes is refused with `403` by the [browser-session write rule](#browser-session-writes). Such a `GET` does reach Flare, so it can count a file view, as an `<img>` tag on that page already could. A signed-in person visiting a hostile page doesn't let it read their files or act as them.
- **Routes named tokens can't call** get no CORS headers, whatever the setting: account settings, organization, tags, folders, file changes, invites, roles, audit and the rest of the [endpoint inventory](./endpoint-inventory). The legacy upload token works from another site only on the named-token routes it can also call, such as uploads.

The token sits in the app's storage in the visitor's browser, where any script the app runs can read it. Create a separate token for the app with only the scopes it uses, set an expiration, and revoke it from **Profile → Integrations** if the app or device is lost.

On S3 storage, `/api/files/{id}/download` redirects to a signed storage URL, and the browser follows it. The bucket needs its own CORS rule for the app's origin to read that answer; Flare's setting doesn't reach the bucket. The same applies to presigned chunk part URLs, as [chunked uploads](./files#optional-send-parts-directly-to-s3) describe. Builds before this setting existed sent no CORS headers, so browser apps on other sites could not use the API at all.

## Browser-session writes

Flare's own pages call these routes with the browser's session cookie. A browser also attaches that cookie to requests other pages send, so a request the cookie authenticates that changes something, with any method except `GET`, `HEAD` and `OPTIONS`, must come from Flare's pages:

- Its `Origin` header must be the origin of `NEXTAUTH_URL`, or the address the app itself serves, such as `http://localhost:3000` in development. A request without an `Origin` header, such as one a script sends, passes. A browser request marked `Sec-Fetch-Site: cross-site` doesn't. Otherwise the answer is `403` with `Cross-origin requests are not allowed.`
- A JSON body must be sent as `Content-Type: application/json`, and an image upload as `multipart/form-data`. Another type answers `415`, such as `Use application/json.`

Named tokens and the legacy upload token are never checked this way, because a browser doesn't attach them on its own. Send their JSON as `application/json` all the same, as the examples here do.

Earlier builds skipped the origin check on `POST /api/files`, `POST /api/files/chunks`, `POST /api/files/chunks/{uploadId}/complete`, `POST /api/files/{id}/expiry`, `POST /api/urls` and `POST /api/profile/upload-token`, and read their JSON whatever type it was sent as. A page on another subdomain of the same site could therefore upload files, create short links, schedule expirations or replace the upload token in a signed-in visitor's account. They also checked the origin and type of legacy-token requests to the folder and tag routes, which now accept those like other token requests.

## Scope reference

| Scope          | Allowed methods and paths                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files:read`   | `GET /api/files`; `GET /api/files/types`; `GET /api/files/timeline`                                                                                                  |
| `files:upload` | `POST /api/files`; `POST`, `GET`, `PUT /api/files/chunks`; `GET`, `PUT /api/files/chunks/{uploadId}/part/{partNumber}`; `POST /api/files/chunks/{uploadId}/complete` |
| `urls:read`    | `GET /api/urls`                                                                                                                                                      |
| `urls:write`   | `POST /api/urls`; `DELETE /api/urls/{id}`                                                                                                                            |

Scopes are independent. `files:upload` does not include listing, and `urls:write` does not include listing. Select both relevant scopes when a service needs both capabilities.

The `{uploadId}` and `{id}` path segments in these routes accept letters, digits, `_`, and `-`, which covers every ID Flare returns. A path whose ID contains any other character is outside the allowlist: a named token gets `401`, and a browser session or the legacy upload token gets `403`.

`files:read` returns your file metadata, including private files. It does **not** authorize private file downloads, thumbnails, or OCR routes. Those use the file's sharing rules and browser session. `files:upload` does not provide a chunk cancellation or uploaded-parts listing endpoint.

Named tokens do not authorize the following operations:

- Creating or revoking tokens, managing webhooks, or retrieving the account upload token.
- Enrolling or disabling two-factor authentication, replacing recovery codes, or registering/managing passkeys.
- Editing accounts, server settings, branding, email policy, or users.
- Creating or editing upload profiles, folders, or tags.
- Deleting files or editing existing files' visibility, passwords, or expiration.
- Using owner-library archive routes to browse, download entries, extract, or create archives; these require the owner's browser session. Separate share-page browsing and entry downloads use file visibility/password checks and reject bearer headers too.

This remains true when the token's owner is an administrator. See [all route boundaries](./endpoint-inventory) if you are investigating a request used by the dashboard.

## Scopes and account roles

A scope restricts the token; it does not grant a permission missing from the owner's current [roles](/admin/roles). Every request must satisfy both checks:

| Token operation                     | Named-token scope | Current account permission |
| ----------------------------------- | ----------------- | -------------------------- |
| List files, MIME types, or timeline | `files:read`      | `files.read`               |
| Upload, upload parts, or finalize   | `files:upload`    | `files.upload`             |
| List short links                    | `urls:read`       | `links.read`               |
| Create a short link                 | `urls:write`      | `links.create`             |
| Delete an owned short link          | `urls:write`      | `links.delete`             |

`tokens.manage` controls issuing, rotating, and revoking credentials. Removing it alone does not disable already-issued named tokens or the legacy upload credential while the owner still holds the required operation permissions. Revoke/rotate the credential or remove its operation grants to stop its use.

Everyone initially grants these personal capabilities. A role change can revoke them on the next request without waiting for token expiration. Granting the permission again restores the authority of an otherwise valid token; revoke it too if it should never be used again. Administrator satisfies account permission checks but does not expand a named token's selected scopes or supported routes.

Additional operation rules still apply: without `files.share`, new uploads become private; without `folders.manage` or `tags.manage`, uploads targeting a folder or applying tags are rejected, including options inherited from a profile. An expiring upload also needs `files.delete` for a deletion action or `files.share` for a make-private action, including inherited expiration. Profile bindings, ownership, verification, size, and storage limits remain in force. Roles and account administration remain browser-session-only even when the token owner can administer the instance.

## Bind uploads to a profile

A profile binding makes the token use one saved upload profile. For example, an “Internal screenshots” profile can produce private files, randomize URL names, and set a one-week lifetime. Bind your screenshot automation token to that profile to enforce those options.

The token must include `files:upload`, and the selected profile must belong to the same account. With a bound token:

- Omitting `X-Upload-Profile` automatically selects the bound profile.
- Choosing another profile or `none` fails with `403`.
- Overriding resolved profile options with different values fails with `403`.
- Setting an explicit `expiresAt` fails with `403`, including `null`.
- Chunk requests can only access upload sessions created with that bound profile.

Bindings apply to the profile's resolved sharing, expiration, naming, style, and tag options. A folder is a request-only destination and is still selectable from the account's folders. Upload passwords are also request-only; they are not saved upload-profile options. Avoid sending redundant option fields for bound tokens: send the file and let the selected profile supply its policy.

New uploads use the profile's current settings. Chunked uploads keep the option snapshot selected when they start. Removing a bound profile does not turn the token into an unrestricted token; uploads fail until the connection is replaced with a valid configuration.

## Named tokens and the account upload token

Flare also has an older account upload token. Generated ShareX, iTake, Flameshot, Spectacle, and Bash configurations use it for compatibility. Regenerating it invalidates existing generated configurations, so download them again afterward.

`GET /api/profile/upload-token` returns `{ "uploadToken": "…" }`, and `POST` replaces the token and returns the new one. Both answer with `Cache-Control: private, no-store`, like the generated configurations, so browsers and shared caches don't keep the credential; earlier versions sent no caching header. A password reset replaces the token too when the administrator turned on **Rotate upload tokens after a password reset**.

The legacy credential is accepted by the shared account authentication helper and does not have the named-token scope allowlist. Its supported route surface is therefore broader than `files:upload` on routes that use that helper, but current role permissions still restrict each request. It still does not satisfy routes that explicitly require a browser session or an administrator session. Prefer scoped named tokens for new custom integrations.

## Two-factor authentication and passkeys

[Account sign-in security](/guide/security) protects interactive browser sign-in. API tokens and the legacy upload credential continue working without a code or passkey ceremony; enabling two-factor authentication or **Require passkey to sign in** does not revoke them or add an interactive step. A passkey requirement blocks password and SSO browser sign-in but preserves integrations under their existing permissions. Review existing integrations and revoke/rotate any credential you no longer trust.

Security management requires a browser session and fresh identity proof. Neither named tokens nor the legacy upload credential can authorize those endpoints. The [session security contract](./security) documents their separate boundaries. The named-token OpenAPI document and request builder intentionally keep their existing supported operations.

## Rotate or revoke a token

For planned rotation, create a replacement, update the tool's stored credential, and run a small test. Then revoke the old token in **Profile → Integrations**. Revocation takes effect on subsequent authentication. Upload finalization also checks whether a named token expired or was revoked while bytes were being transferred.

The last-used timestamp is best-effort activity metadata, not a full audit log. Never put bearer tokens into a public repository, a screenshot, a URL, or a support report. A token is a credential even when it can only upload.

## Troubleshoot a 401 or 403

| Symptom                                             | What to check                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401 Unauthorized` on every request                 | Confirm the complete token, header, instance URL, expiration, and revocation status. Make sure your reverse proxy forwards `Authorization`.                                                                                                                                                                              |
| Upload works but listing returns `401`              | Add `files:read` by creating a replacement token with the required scopes.                                                                                                                                                                                                                                               |
| Named token works on files but not account settings | The route is outside the named-token allowlist. Use the dashboard for account administration.                                                                                                                                                                                                                            |
| A previously working account loses API access       | Check whether the administrator now requires email verification. A user who must verify their email cannot use named or legacy token authentication until eligible again. Also check current role grants: removing an operation’s permission stops both kinds of token.                                                  |
| `403` says you lack permission                      | Ask the administrator to review the owner’s current role grants. Token scope alone does not grant account authority.                                                                                                                                                                                                     |
| `403` mentions an upload profile                    | Remove conflicting overrides, select the bound profile, and confirm it still exists.                                                                                                                                                                                                                                     |
| A web app on another site gets `Failed to fetch`    | The instance hasn't allowed the app's origin. Ask the operator to add it to [`FLARE_CORS_ORIGINS`](#call-flare-from-a-web-app), written exactly as the browser sends it, such as `http://localhost:5173`. Session-only routes never work from another site, and a page can't read answers the session cookie authorized. |
| `403` says an upload token expired or was revoked   | The credential became invalid before upload finalization. Replace it and begin again.                                                                                                                                                                                                                                    |

Missing credentials, unknown tokens, expired tokens, revoked tokens, missing scopes, and required email verification intentionally share a generic `401` response. The server does not reveal which authentication check failed to an unauthenticated caller. An authenticated request lacking a current role permission returns `403`; restoring that role grant can restore access without issuing another token.

## Browser-session revocation and audit access

[Active sessions](/guide/account#login-history-and-active-sessions) tracks interactive sign-ins only. Revoking one or all browser sessions does not revoke named API tokens or rotate the legacy upload credential. Retire those separately in Profile when responding to compromised access. Tokens are never accepted by the session-history or [audit API](./activity), even when their owner has Administrator or `audit.read`. Recorded token-authorized activity identifies the account and applicable operation without retaining the token secret.
