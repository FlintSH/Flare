---
title: Authentication & scopes
description: Create, restrict, rotate, and troubleshoot Flare API tokens.
---

# Authentication & scopes

Create one named API token for each script or service in **Profile → Integrations**. Give it only the permissions it uses. You can revoke a connection without interrupting your other tools.

## Create a token

1. Choose a name of 1–80 characters. Use the name to identify the machine, service, or purpose.
2. Select one or more scopes from the table below.
3. Optionally select an expiration in the future. Without an expiration, the token remains active until revoked.
4. If it uploads files, optionally bind it to one of your saved upload profiles.
5. Create the token and save the displayed `flr_…` secret in your tool's secret store.

The full value is shown once. Flare stores a hash rather than the recoverable token. If you lose it, revoke the token and create a replacement. Each account can have **50 active named tokens**. Expired and revoked tokens do not count toward that limit. The integrations screen retrieves the latest 100 token records and shows creation, expiration, revocation, and last-use information.

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

A named `flr_` bearer token uses its own authority even if browser cookies accompany the request. A signed-in administrator's cookie does not add permissions to a named token on these routes. Use a server-side process or command-line client for custom automation; the docs builder does not act as an authenticated proxy to your instance.

## Scope reference

| Scope          | Allowed methods and paths                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files:read`   | `GET /api/files`; `GET /api/files/types`                                                                                                                             |
| `files:upload` | `POST /api/files`; `POST`, `GET`, `PUT /api/files/chunks`; `GET`, `PUT /api/files/chunks/{uploadId}/part/{partNumber}`; `POST /api/files/chunks/{uploadId}/complete` |
| `urls:read`    | `GET /api/urls`                                                                                                                                                      |
| `urls:write`   | `POST /api/urls`; `DELETE /api/urls/{id}`                                                                                                                            |

Scopes are independent. `files:upload` does not include listing, and `urls:write` does not include listing. Select both relevant scopes when a service needs both capabilities.

`files:read` returns your file metadata, including private files. It does **not** authorize private file downloads, thumbnails, or OCR routes. Those use the file's sharing rules and browser session. `files:upload` does not provide a chunk cancellation or uploaded-parts listing endpoint.

Named tokens do not authorize the following operations:

- Creating or revoking tokens, managing webhooks, or retrieving the account upload token.
- Editing accounts, server settings, branding, email policy, or users.
- Creating or editing upload profiles, folders, tags, or saved views.
- Deleting files or editing existing files' visibility, passwords, or expiration.

This remains true when the token's owner is an administrator. See [all route boundaries](./endpoint-inventory) if you are investigating a request used by the dashboard.

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

The legacy credential is accepted by the shared account authentication helper and does not have the named-token scope allowlist. Its authority is therefore broader than `files:upload` on routes that use that helper. It still does not satisfy routes that explicitly require a browser session or an administrator session. Prefer scoped named tokens for new custom integrations.

## Rotate or revoke a token

For planned rotation, create a replacement, update the tool's stored credential, and run a small test. Then revoke the old token in **Profile → Integrations**. Revocation takes effect on subsequent authentication. Upload finalization also checks whether a named token expired or was revoked while bytes were being transferred.

The last-used timestamp is best-effort activity metadata, not a full audit log. Never put bearer tokens into a public repository, a screenshot, a URL, or a support report. A token is a credential even when it can only upload.

## Troubleshoot a 401 or 403

| Symptom                                             | What to check                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized` on every request                 | Confirm the complete token, header, instance URL, expiration, and revocation status. Make sure your reverse proxy forwards `Authorization`.                               |
| Upload works but listing returns `401`              | Add `files:read` by creating a replacement token with the required scopes.                                                                                                |
| Named token works on files but not account settings | The route is outside the named-token allowlist. Use the dashboard for account administration.                                                                             |
| A previously working account loses API access       | Check whether the administrator now requires email verification. A user who must verify their email cannot use named or legacy token authentication until eligible again. |
| `403` mentions an upload profile                    | Remove conflicting overrides, select the bound profile, and confirm it still exists.                                                                                      |
| `403` says an upload token expired or was revoked   | The credential became invalid before upload finalization. Replace it and begin again.                                                                                     |

Missing credentials, unknown tokens, expired tokens, revoked tokens, missing scopes, and required email verification intentionally share a generic `401` response. The server does not reveal which check failed to an unauthenticated caller.
