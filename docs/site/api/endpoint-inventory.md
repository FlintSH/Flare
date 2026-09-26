---
title: Endpoint inventory
description: Every Flare HTTP API route, its purpose, and its authentication boundary.
---

# Endpoint inventory

Flare's dashboard also talks to HTTP routes. Their existence does not make all of them part of the named-token API. This inventory distinguishes the supported automation surface from session-based account/admin actions and public content routes.

Use the [OpenAPI document](/openapi.json) for custom clients using `flr_…` tokens. It describes the **12 supported method/path combinations** across seven paths. The rest of this page is a map for operators and contributors, not a promise of a general administrator REST API.

Paths use `{id}` for a dynamic segment. `{path}` and `{nextauth}` are catch-all path segments. Methods listed here are the implemented handlers; do not assume another method is supported because the path exists.

## Named-token API

All of these routes also use Flare's shared account authentication helper. A named token must have the specific scope and its owner must currently have the matching role permission. Results are limited to its owner's account. See the [scope-to-permission table](./authentication#scopes-and-account-roles).

| Path                                             | Method | Scope          | Purpose                                                               |
| ------------------------------------------------ | ------ | -------------- | --------------------------------------------------------------------- |
| `/api/files`                                     | GET    | `files:read`   | Paginated file metadata, search, filters, and image neighbors.        |
| `/api/files`                                     | POST   | `files:upload` | One multipart file upload.                                            |
| `/api/files/types`                               | GET    | `files:read`   | MIME types present in the account.                                    |
| `/api/files/chunks`                              | POST   | `files:upload` | Initialize a chunk upload.                                            |
| `/api/files/chunks`                              | GET    | `files:upload` | Obtain a part URL using `uploadId` and `partNumber` query parameters. |
| `/api/files/chunks`                              | PUT    | `files:upload` | Complete an upload, returning a `data` wrapper.                       |
| `/api/files/chunks/{uploadId}/part/{partNumber}` | GET    | `files:upload` | Obtain a part upload URL.                                             |
| `/api/files/chunks/{uploadId}/part/{partNumber}` | PUT    | `files:upload` | Upload raw part bytes through Flare.                                  |
| `/api/files/chunks/{uploadId}/complete`          | POST   | `files:upload` | Complete an upload, returning links without a wrapper.                |
| `/api/urls`                                      | GET    | `urls:read`    | List the account's short links.                                       |
| `/api/urls`                                      | POST   | `urls:write`   | Create a short link.                                                  |
| `/api/urls/{id}`                                 | DELETE | `urls:write`   | Delete an owned short link.                                           |

See [files](./files), [short links](./short-links), and [authentication](./authentication) for request/response details. Chunk part and completion routes reject `409` when the actual storage target changed or older session metadata lacks provenance; initialize a fresh upload. This does not add scopes or alter successful response shapes.

## File content and access checks

These routes check the file's visibility, password, and an optional **browser session**. They do not use named bearer tokens to grant file access. Public unprotected files can be fetched anonymously. Private files require an owner session with `files.read`, or a session with `content.read` and return `404` to ineligible viewers. A password-protected public file requires its password unless the browser session belongs to its owner with `files.read`, or a person with `content.read`.

| Path                        | Methods   | Purpose                                                                                                                            |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/api/files/{path}`         | GET       | Raw stored content by file URL path; `download=true` requests attachment handling.                                                 |
| `/api/files/{id}/download`  | GET, POST | Download content. GET accepts a password query value; POST accepts password JSON. S3 storage can redirect after access validation. |
| `/api/files/{id}/thumbnail` | GET       | Serve an image for thumbnail display; currently streams the original image.                                                        |
| `/api/files/{id}/ocr`       | GET       | Fetch image OCR text, processing it if necessary, after access validation.                                                         |

Raw/thumbnail/OCR GET requests accept a `password` query parameter when applicable. Prefer the normal share-page password flow for people using a browser; URLs containing passwords can be retained in history or logs.

The public-facing route `/{userUrlId}/{filename}/raw` also enforces file access. `/{userUrlId}/{filename}/direct` is a video-only lookup that returns JSON containing a signed storage URL or raw-route fallback after checking access; it does not stream the file itself. An issued S3 URL can remain valid until its own expiry after Flare access settings change. `/{userUrlId}/{filename}` is the rendered share page. `GET /u/{shortCode}` publicly redirects a short link and increments its count.

## Dashboard account routes requiring a browser session

These routes explicitly read an interactive session. Neither a named API token nor a legacy account upload token by itself supplies that session. Ownership, current role permission, and feature-policy checks still apply. Profile edits use `profile.update`; full exports require `profile.export`, `files.read`, and `links.read` together (progress alone uses `profile.export`); upload profiles `uploadProfiles.manage`; token and uploader-configuration management `tokens.manage`; webhooks `webhooks.manage`; personal appearance `appearance.personal`. File changes separately check `files.share`, `files.update`, or `files.delete`.

| Path                               | Methods       | Purpose                                                                                                                           |
| ---------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/api/integrations`                | GET, POST     | List/manage named tokens, webhooks, and deliveries. POST uses action commands and validates same-origin JSON requests.            |
| `/api/upload-profiles`             | GET, POST     | List profiles; create/import a profile.                                                                                           |
| `/api/upload-profiles/{id}`        | PUT, DELETE   | Update an owned profile using its revision or delete it.                                                                          |
| `/api/upload-profiles/{id}/export` | GET           | Export a portable profile recipe.                                                                                                 |
| `/api/upload-profiles/default`     | PUT           | Select or clear the account's default profile.                                                                                    |
| `/api/customization`               | GET           | Read published appearance; sessions with `appearance.manage` also receive draft/history state.                                    |
| `/api/customization/preferences`   | GET, PATCH    | Read/save personal appearance preference.                                                                                         |
| `/api/profile/avatar`              | POST          | Upload an account avatar with a durable write intent and live authorization at publication; success remains `{success:true,url}`. |
| `/api/profile/sharex`              | GET           | Download a ShareX uploader configuration.                                                                                         |
| `/api/profile/itake`               | GET           | Download an iTake uploader configuration.                                                                                         |
| `/api/profile/bash`                | GET           | Download the Bash uploader script.                                                                                                |
| `/api/profile/flameshot`           | POST          | Generate a Flameshot script from submitted tool options.                                                                          |
| `/api/profile/spectacle`           | POST          | Generate a Spectacle script from submitted tool options.                                                                          |
| `/api/profile/export/progress`     | GET           | Stream account-export progress using server-sent events.                                                                          |
| `/api/files/{id}`                  | PATCH, DELETE | Change an owned file's visibility/password or delete it.                                                                          |

Profile and appearance mutations have explicit origin/content-type guards. Integration commands likewise enforce same-origin JSON and a bounded body size. Generated uploader configurations contain a credential and should be treated as private downloads.

### Email account flows

Email enrollment and change operations use an account session that remains available for verification/recovery flows. They deliberately do not use upload bearer credentials. These verification, enrollment, recovery, and confirmed address-change paths remain available independently of `profile.update`, subject to identity proof and email policy, including restricted verification sessions.

| Path                            | Methods | Authentication and purpose                                                              |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `/api/auth/email/status`        | GET     | Session; current verification, enrollment, change, and recovery eligibility.            |
| `/api/auth/email/enroll`        | POST    | Session and recent identity/password requirements; begin local verification enrollment. |
| `/api/auth/email/change`        | POST    | Session and identity/policy checks; request an address change.                          |
| `/api/auth/email/resend`        | POST    | Session; resend an eligible pending verification.                                       |
| `/api/auth/email/cancel-change` | POST    | Session; cancel the pending address change.                                             |
| `/api/auth/email/request-reset` | POST    | Public recovery request, rate-limited with a generic eligibility response.              |
| `/api/auth/email/reset`         | POST    | A valid one-time reset token and new password; not an API bearer token.                 |
| `/api/auth/email/verify`        | POST    | A valid one-time email action token.                                                    |
| `/api/auth/email/capabilities`  | GET     | Public view of enabled email capabilities.                                              |

Email session mutations validate the request origin when provided. Password/identity confirmation, feature enablement, verified-address policy, and cooldowns are additional checks beyond the authentication column.

## Dashboard routes using the shared account helper

These routes use `requireAuth`, whose compatibility path accepts a browser session or the **legacy account upload token**. They are absent from the named-token allowlist, so an `flr_…` token cannot authorize them. This is why the legacy token should not be described as a narrowly scoped credential.

| Path                        | Methods           | Purpose                                                                                                                                     |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/profile`              | PUT, DELETE       | Update the account, or delete it with `profile.update`; DELETE returns `204` after account removal and durable storage-cleanup work commit. |
| `/api/profile/upload-token` | GET, POST         | Read or regenerate the legacy account upload credential.                                                                                    |
| `/api/profile/export`       | GET               | Export account data/files.                                                                                                                  |
| `/api/files/{id}/expiry`    | GET, POST, DELETE | Inspect, schedule, or cancel expiration for an owned file.                                                                                  |
| `/api/folders`              | GET, POST         | List or create folders.                                                                                                                     |
| `/api/folders/{id}`         | PATCH, DELETE     | Rename/move or delete an owned folder.                                                                                                      |
| `/api/files/folders`        | POST              | Move owned files into a folder or make them unfiled.                                                                                        |
| `/api/tags`                 | GET, POST         | List or create tags and their rules.                                                                                                        |
| `/api/tags/{id}`            | PATCH, DELETE     | Edit or delete an owned tag.                                                                                                                |
| `/api/tags/{id}/apply`      | POST              | Apply a tag's rule to existing files.                                                                                                       |
| `/api/files/tags`           | PATCH             | Change tag associations for selected owned files.                                                                                           |

Folder/tag mutations also require their origin and content-type guards. This table describes actual authentication code, not a recommendation to use the legacy token to automate account changes. New integrations should use the documented named-token API, and people should use the dashboard for these operations.

## Delegated administration session routes

These operations require a browser session and the permission listed below. Administrator grants every permission. Account writes and role assignments also check hierarchy; role/account mutations preserve an accessible administrator. Named tokens do not inherit these capabilities from their owner. [Role and account request/response contracts](./roles) document replacement of the old scalar role field.

| Path                             | Methods        | Required permission and purpose                                                                                                                           |
| -------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/roles`                     | GET, POST      | GET: any of `roles.manage`, `users.roles`, `users.read`; POST: `roles.manage`. List the catalog/roles or create a role.                                   |
| `/api/roles/{id}`                | PATCH, DELETE  | `roles.manage`; edit/delete a role within hierarchy and delegation limits.                                                                                |
| `/api/users`                     | GET, POST, PUT | GET: `users.read`; POST: `users.create`; PUT identity: `users.update`. Assignment additionally requires `users.roles`; role-only PUT needs `users.roles`. |
| `/api/users/{id}`                | DELETE         | `users.delete`; remove an account within delegation limits. Returns `204` after account removal and durable storage-cleanup work commit.                  |
| `/api/users/{id}/avatar`         | DELETE         | `users.update`; clear an account's avatar and queue its stored bytes for cleanup; `204` after commit.                                                     |
| `/api/users/{id}/sessions`       | DELETE         | `users.sessions`; invalidate an account’s browser sessions. Success is `204 No Content`, with no JSON body. API credentials remain active.                |
| `/api/users/{id}/email`          | GET, POST      | `users.email`; inspect/manage email access.                                                                                                               |
| `/api/users/{id}/files`          | GET            | `content.read`; inspect an account's files.                                                                                                               |
| `/api/users/{id}/files/{fileId}` | PATCH, DELETE  | PATCH: `content.update`; DELETE: `content.delete`.                                                                                                        |
| `/api/users/{id}/urls`           | GET            | `content.read`; inspect an account's short links.                                                                                                         |
| `/api/users/{id}/urls/{urlId}`   | DELETE         | `content.delete`; session-only deletion of a short link owned by that target account. Returns `204`; wrong owner/missing URL returns `404`.               |
| `/api/users/{id}/login`          | POST           | `users.read`; fetch target account information. Does not itself issue a login session.                                                                    |
| `/api/settings`                  | PATCH, POST    | PATCH: corresponding section permission; legacy whole-settings POST: Administrator. [Field mapping](./roles#delegated-settings-writes).                   |
| `/api/settings/favicon`          | POST           | `appearance.manage`; upload a legacy instance favicon.                                                                                                    |
| `/api/settings/email`            | GET, PUT       | `settings.email`; read/save email configuration and diagnostics.                                                                                          |
| `/api/settings/email/impact`     | GET, POST      | `settings.email`; preview email-policy impact.                                                                                                            |
| `/api/settings/email/test`       | POST           | `settings.email`; test SMTP or send a test message.                                                                                                       |
| `/api/settings/email/retry`      | POST           | `settings.email`; retry an eligible outbox entry.                                                                                                         |
| `/api/customization`             | POST           | `appearance.manage`; save/import/publish/restore appearance.                                                                                              |
| `/api/customization/assets`      | POST           | `appearance.manage`; upload an appearance asset.                                                                                                          |
| `/api/updates/check`             | GET            | `settings.read`; check release availability.                                                                                                              |

Email administration validates origins for mutations; appearance administration uses same-origin/content-type guards. Permission checks are independent of these request guards. A valid role does not bypass malformed requests, email eligibility, or ownership rules.

## Public and bootstrap routes

| Path                            | Methods   | Authentication and purpose                                                                                                                                                                  |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`                   | GET       | Public process liveness: `{ "success": true, "data": { "status": "ok" } }`. Does not probe PostgreSQL or storage.                                                                           |
| `/api/storage/type`             | GET       | Public storage kind (`local` or `s3`); falls back to `local` on an initialization error. Not a storage health check.                                                                        |
| `/api/setup/check`              | GET       | Public setup-completion state.                                                                                                                                                              |
| `/api/setup`                    | POST      | First-run bootstrap only while no users exist; creates Everyone, the full-access Admin role, the first account assignment, and settings atomically and rate-limits attempts.                |
| `/api/auth/registration-status` | GET       | Public registration availability and message.                                                                                                                                               |
| `/api/auth/register`            | POST      | Public account creation, subject to registration settings, validation, email policy, and rate limits.                                                                                       |
| `/api/auth/{nextauth}`          | GET, POST | NextAuth session, sign-in/out, provider, CSRF, and callback flows; protocol-specific protections apply.                                                                                     |
| `/api/settings`                 | GET       | Returns public settings by default. A browser session with `settings.read` receives private settings with storage/OIDC credentials masked; named tokens receive only the public projection. |
| `/api/favicon`                  | GET       | Serve the configured favicon/fallback.                                                                                                                                                      |
| `/api/avatars/{filename}`       | GET       | Serve a currently referenced avatar; `404` for obsolete/unowned keys and `503` when its recorded storage target is unavailable.                                                             |

Public does not mean unrestricted mutation: registration can be closed and bootstrap stops once a user exists. Email one-time-token routes are listed separately because possession of the relevant action token is their authorization.

## Maintaining an integration

Build new automation against the named-token routes and their [OpenAPI schemas](/openapi.json). For dashboard behavior, treat route bodies and session flows as application internals that can evolve with Flare. There is currently no named-token administrator API, no general token-authorized file deletion/download API, and no chunk-cancel endpoint.

The route inventory is checked against the source tree when the documentation is validated, so a newly added route prompts a documentation update instead of silently expanding a token's authority.
