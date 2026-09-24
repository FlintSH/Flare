---
description: A complete operator configuration reference with environment variables, defaults, email overrides, and persisted settings.
---

# Configuration reference

Flare separates server connection details from instance preferences. Configure PostgreSQL and authentication in the environment. Configure storage, registration, OIDC, appearance, and most product behavior in **Settings**. Those settings are stored in PostgreSQL, so they survive container recreation when the database persists.

## How changes take effect

| Configuration source        | Used for                                                          | How to apply                                                                 |
| --------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Deployment environment      | Database, public origin, secrets, logging, webhook network policy | Recreate/redeploy the app process                                            |
| Settings in PostgreSQL      | Instance behavior, storage credentials, access, design, email     | Save in the appropriate Settings section                                     |
| Profile in PostgreSQL       | Personal appearance, upload defaults, recipes, tokens, webhooks   | Save in Profile                                                              |
| Email environment overrides | Any operator-facing email setting                                 | Recreate/redeploy; overridden controls are marked **Managed by environment** |

For email, precedence is **environment or secret file → saved value → default**. Removing an override reveals the saved fallback; the override is not copied into the database. Other settings do not have an equivalent generic environment mapping.

## Core environment variables

| Variable                              | Default                                      | Purpose                                                                                                                                |
| ------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | Required                                     | PostgreSQL connection string, for example `postgresql://flare:password@db:5432/flare?schema=public`                                    |
| `NEXTAUTH_URL`                        | Set explicitly                               | Canonical public origin, including `https://`; used for authentication, generated links, origin checks, and email's default public URL |
| `NEXTAUTH_SECRET`                     | Set explicitly                               | Stable random authentication secret; also the fallback encryption key for stored SMTP/outbox and webhook secrets                       |
| `LOG_LEVEL`                           | `info` in production; `debug` in development | `fatal`, `error`, `warn`, `info`, `debug`, or `trace`                                                                                  |
| `FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK` | Disabled                                     | Only the exact value `true` permits HTTP webhook URLs and private/reserved destination addresses                                       |
| `FLARE_EMAIL_ENCRYPTION_KEY`          | `NEXTAUTH_SECRET`                            | Optional dedicated key for encrypted SMTP credentials, mail payloads, and webhook signing secrets; at least 32 characters              |
| `FLARE_EMAIL_ENCRYPTION_KEY_FILE`     | Unset                                        | Read the dedicated encryption key from a file; mutually exclusive with the direct variable                                             |
| `FLARE_RELEASE_CHANNEL`               | `stable`                                     | `rolling` selects prerelease update-check behavior and display; other values resolve to stable                                         |
| `FLARE_COMMIT_SHA`                    | Unset                                        | Build identity shown for rolling releases; use the actual source commit                                                                |

`DATABASE_URL` and `NEXTAUTH_SECRET` do not have Flare-provided `_FILE` variants. If your host supplies these through secret files, use its supported environment injection mechanism. Never assume every environment variable in this table supports a `_FILE` suffix.

Use a stable, random `NEXTAUTH_SECRET` of at least 32 characters from the beginning. Creating webhooks needs encryption even when account email is disabled. Changing the active encryption key without migrating encrypted values prevents existing secrets from being decrypted; [plan key rotation](/hosting/maintenance#secrets-and-key-rotation).

### Webhook network access

The default webhook policy accepts public HTTPS destinations only. Flare resolves and validates the destination at delivery time. Setting `FLARE_WEBHOOK_ALLOW_PRIVATE_NETWORK=true` lets instance users configure receivers on networks reachable by the server, including HTTP services. Enable it only when that access matches your deployment's intended users and network boundaries. There is no environment-configured per-host allowlist in this release.

## Container and framework variables

These belong to the app runtime or build tooling, rather than saved instance configuration.

| Variable                                 | Official image behavior                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PORT`                                   | `3000`; the bundled Docker health check also targets port 3000, so change that check if you change the port |
| `HOSTNAME`                               | Set to `0.0.0.0` in the image                                                                               |
| `NODE_ENV`                               | `production`; development uses `pnpm dev`                                                                   |
| `NEXT_TELEMETRY_DISABLED`                | `1` in the image; controls Next.js telemetry                                                                |
| `NEXT_RUNTIME`                           | Set by Next.js; Flare initializes background workers for the Node runtime                                   |
| `METICULOUS_BUILD`                       | Docker build argument, default `false`; `true` includes production browser source maps for visual testing   |
| `NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN` | Optional public recording token for development/preview or explicitly enabled test deployments              |
| `METICULOUS_RECORDING_ENABLED`           | Explicit `true` enables recording eligibility outside development/preview when a token exists               |
| `METICULOUS_BACKEND_RECORDER_MODE`       | `replay` enables the backend replay path used by visual tests                                               |
| `VERCEL_ENV`                             | A platform marker; `preview` enables recording eligibility when a recording token is present                |

The Dockerfile also sets Corepack/pnpm installation variables (`COREPACK_ENABLE_DOWNLOAD_PROMPT`, `COREPACK_HOME`, `npm_config_verify_deps_before_run`, and `HUSKY`) to make its packaged runtime work. They are not Flare feature controls. Build identity arguments `FLARE_RELEASE_CHANNEL` and `FLARE_COMMIT_SHA` are baked into the official image by release workflows.

Meticulous's hosted CI workflow has been retired. Its recorder variables and disposable test image remain available for [local visual testing](/contributing#local-visual-testing-with-meticulous); ordinary production recording still requires explicit opt-in and a recording token. `METICULOUS_API_TOKEN` authenticates the optional CLI, not Flare's server or users, and is no longer required as a repository Actions secret.

## Email environment variables

Every variable in the following tables also accepts a `_FILE` variant. For example, `FLARE_EMAIL_SMTP_PASSWORD_FILE=/run/secrets/smtp_password` reads that file's contents, trimming trailing whitespace. Set **one** of the direct variable or its `_FILE` variant. Booleans must be exactly `true` or `false`; numbers must be nonnegative integer strings and satisfy the listed range.

### Connection and sending

| Variable                           | Default                | Accepted values / effect                                                                 |
| ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `FLARE_EMAIL_ENABLED`              | `false`                | Turns automatic email sending and local email policies on or off                         |
| `FLARE_EMAIL_SMTP_HOST`            | Empty                  | SMTP server hostname                                                                     |
| `FLARE_EMAIL_SMTP_PORT`            | `465`                  | `1`–`65535`                                                                              |
| `FLARE_EMAIL_SMTP_SECURITY`        | `tls`                  | `tls`, `starttls`, `none`                                                                |
| `FLARE_EMAIL_SMTP_AUTHENTICATION`  | `true`                 | Whether SMTP login is required                                                           |
| `FLARE_EMAIL_SMTP_USERNAME`        | Empty                  | SMTP username                                                                            |
| `FLARE_EMAIL_SMTP_PASSWORD`        | Empty                  | SMTP password; prefer its `_FILE` form for mounted secrets                               |
| `FLARE_EMAIL_SMTP_CA`              | Empty                  | PEM custom certificate authority content, not a filename; use `_FILE` to read a PEM file |
| `FLARE_EMAIL_SMTP_TIMEOUT_SECONDS` | `15`                   | `3`–`120` seconds                                                                        |
| `FLARE_EMAIL_FROM_NAME`            | `Flare`                | Sender display name                                                                      |
| `FLARE_EMAIL_FROM_ADDRESS`         | Empty                  | Provider-authorized sender email address                                                 |
| `FLARE_EMAIL_REPLY_TO`             | Empty                  | Optional reply-to email address                                                          |
| `FLARE_EMAIL_PUBLIC_URL`           | Empty → `NEXTAUTH_URL` | Public account-link base; HTTPS required except for loopback testing                     |

### Recovery, verification, and address changes

| Variable                                   | Default   | Accepted values / effect                                                       |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------ |
| `FLARE_EMAIL_RECOVERY_ENABLED`             | `false`   | Password recovery for verified local accounts                                  |
| `FLARE_EMAIL_RECOVERY_TOKEN_MINUTES`       | `30`      | `5`–`120` minutes                                                              |
| `FLARE_EMAIL_RECOVERY_ROTATE_UPLOAD_TOKEN` | `false`   | Rotate the legacy upload token after a successful password reset               |
| `FLARE_EMAIL_VERIFICATION_MODE`            | `off`     | `off`, `optional`, `new_users`, `all_users`                                    |
| `FLARE_EMAIL_VERIFICATION_GRACE_DAYS`      | `7`       | `0`–`90` days for existing users when all-user enforcement is activated        |
| `FLARE_EMAIL_VERIFICATION_ADMIN_CREATED`   | `inherit` | `inherit` or `exempt` for accounts created by administrators                   |
| `FLARE_EMAIL_VERIFICATION_TRUST_OIDC`      | `false`   | Accept trusted provider proof for matching email when `email_verified` is true |
| `FLARE_EMAIL_VERIFICATION_TOKEN_HOURS`     | `24`      | `1`–`168` hours                                                                |
| `FLARE_EMAIL_CHANGES_ENABLED`              | `true`    | Allow confirmed address changes when email is enabled                          |
| `FLARE_EMAIL_CHANGES_REQUIRE_OLD_EMAIL`    | `false`   | Require old-address approval as well as new-address confirmation               |

Policy activation timestamps and the internal applied-mode marker are server-owned; they cannot be overridden through environment variables. Entering `all_users` starts a fresh existing-user grace window. Environment policy changes have no dashboard confirmation step, so verify an administrator's recovery address or exemption before applying them.

### Limits and delivery

| Variable                              | Default | Allowed range                                       |
| ------------------------------------- | ------- | --------------------------------------------------- |
| `FLARE_EMAIL_LIMITS_RESEND_SECONDS`   | `60`    | `30`–`3600`                                         |
| `FLARE_EMAIL_LIMITS_ADDRESS_PER_HOUR` | `5`     | `1`–`100`                                           |
| `FLARE_EMAIL_LIMITS_IP_PER_HOUR`      | `20`    | `1`–`1000`                                          |
| `FLARE_EMAIL_LIMITS_DAILY_LIMIT`      | `500`   | `1`–`100000`                                        |
| `FLARE_EMAIL_DELIVERY_MAX_ATTEMPTS`   | `3`     | `1`–`10`                                            |
| `FLARE_EMAIL_DELIVERY_RETRY_SECONDS`  | `60`    | `10`–`3600`; starting delay for exponential backoff |
| `FLARE_EMAIL_DELIVERY_CONCURRENCY`    | `2`     | `1`–`10` across the instance                        |
| `FLARE_EMAIL_DELIVERY_RETENTION_DAYS` | `14`    | `1`–`90`                                            |

### Email branding

| Variable                                    | Default                          |
| ------------------------------------------- | -------------------------------- |
| `FLARE_EMAIL_BRANDING_INSTANCE_NAME`        | `Flare`                          |
| `FLARE_EMAIL_BRANDING_LOGO_URL`             | Empty                            |
| `FLARE_EMAIL_BRANDING_ACCENT_COLOR`         | `#6366f1`; six-digit hex color   |
| `FLARE_EMAIL_BRANDING_FOOTER`               | Empty                            |
| `FLARE_EMAIL_BRANDING_SUPPORT_ADDRESS`      | Empty                            |
| `FLARE_EMAIL_BRANDING_SUBJECT_PREFIX`       | Empty                            |
| `FLARE_EMAIL_BRANDING_VERIFICATION_SUBJECT` | `Verify your email address`      |
| `FLARE_EMAIL_BRANDING_RESET_SUBJECT`        | `Reset your password`            |
| `FLARE_EMAIL_BRANDING_CHANGE_SUBJECT`       | `Confirm your new email address` |
| `FLARE_EMAIL_BRANDING_INTRO_TEXT`           | Empty                            |

Text is escaped into Flare's HTML and plain-text messages. These settings are not arbitrary executable templates. See [the email guide](/admin/email) for a staged rollout and delivery diagnostics.

## Settings stored in the database

These defaults describe a new instance before your setup choices. Existing instances retain saved settings during upgrades.

| Setting                         | Default                                                               | Guide                                                             |
| ------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Public registration             | Enabled; empty disabled message                                       | [Access and users](/admin/users)                                  |
| Background OCR                  | Enabled                                                               | [General settings](/admin/#general)                               |
| Credits footer                  | Shown                                                                 | [Appearance](/admin/appearance)                                   |
| Storage provider                | Local                                                                 | [Storage](/hosting/storage)                                       |
| S3 credentials / endpoint       | Empty; force path style off                                           | [S3](/hosting/storage#s3-compatible-storage)                      |
| Maximum file size               | 100 MB                                                                | [Limits](/hosting/storage#maximum-upload-size)                    |
| Ordinary-user quota             | Disabled; 10 GB when enabled                                          | [Quotas](/hosting/storage#user-quotas)                            |
| OIDC                            | Disabled                                                              | [SSO](/admin/sso)                                                 |
| OIDC auto-provision             | Enabled                                                               | [SSO](/admin/sso)                                                 |
| OIDC verified-email requirement | Enabled                                                               | [SSO](/admin/sso)                                                 |
| OIDC auto-login                 | Disabled                                                              | [SSO](/admin/sso)                                                 |
| OIDC button                     | `Sign in with SSO`                                                    | [SSO](/admin/sso)                                                 |
| Legacy appearance               | Dark, default Flare colors, no custom favicon                         | [Appearance](/admin/appearance)                                   |
| Studio theme                    | Disabled; dark default mode; glow background; Inter font; radius 0.75 | [Appearance](/admin/appearance)                                   |
| Default share style             | Framed; show uploader, filename, and size; contain images             | [Sharing design](/admin/appearance#sharing)                       |
| Custom CSS / head HTML          | Empty                                                                 | [Advanced appearance](/admin/appearance#custom-css-and-head-html) |

There are no supported `FLARE_STORAGE_*`, `FLARE_OIDC_*`, `FLARE_REGISTRATION_*`, or quota environment variables in the current implementation. Edit those controls in Settings. The `FLARE_URL`, `FLARE_TOKEN`, and `FLARE_WEBHOOK_SECRET` names used by example client scripts configure those scripts, not the server.

### Saved general and access fields

The following paths are relative to `settings` in Flare's saved configuration. They help operators compare a backup or a configuration export with the interface; use Settings to change them so validation and related updates run. They are **not environment variable names**.

| Saved path                              | Initial value      | Meaning                                                                                                         |
| --------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `general.registrations.enabled`         | `true`             | Allow local account registration                                                                                |
| `general.registrations.disabledMessage` | Empty string       | Message shown when registration is closed                                                                       |
| `general.storage.provider`              | `local`            | `local` or `s3`; one active provider for the instance                                                           |
| `general.storage.s3.bucket`             | Empty string       | Existing bucket name                                                                                            |
| `general.storage.s3.region`             | Empty string       | Provider region                                                                                                 |
| `general.storage.s3.accessKeyId`        | Empty string       | Configured S3 credential identifier                                                                             |
| `general.storage.s3.secretAccessKey`    | Empty string       | Configured S3 credential secret; protect database backups                                                       |
| `general.storage.s3.endpoint`           | Empty string       | Optional custom S3 API endpoint; saved settings normalize a missing scheme to HTTPS and remove trailing slashes |
| `general.storage.s3.forcePathStyle`     | `false`            | Use path-style addressing with a custom endpoint                                                                |
| `general.storage.quotas.enabled`        | `false`            | Apply the shared allowance to ordinary users                                                                    |
| `general.storage.quotas.default.value`  | `10`               | Allowance amount per ordinary user                                                                              |
| `general.storage.quotas.default.unit`   | `GB`               | Dashboard choices are MB or GB, using binary units                                                              |
| `general.storage.maxUploadSize.value`   | `100`              | Maximum size of one uploaded file                                                                               |
| `general.storage.maxUploadSize.unit`    | `MB`               | Dashboard choices are MB or GB, using binary units                                                              |
| `general.credits.showFooter`            | `true`             | Show the instance's Flare credit footer                                                                         |
| `general.ocr.enabled`                   | `true`             | Queue background image text extraction                                                                          |
| `general.oidc.enabled`                  | `false`            | Enable the configured OIDC provider                                                                             |
| `general.oidc.issuer`                   | Empty string       | Provider issuer; discovery path is appended by Flare                                                            |
| `general.oidc.clientId`                 | Empty string       | OIDC application identifier                                                                                     |
| `general.oidc.clientSecret`             | Empty string       | OIDC application secret; protect database backups                                                               |
| `general.oidc.buttonText`               | `Sign in with SSO` | Sign-in button label                                                                                            |
| `general.oidc.autoProvision`            | `true`             | Create eligible new OIDC User accounts                                                                          |
| `general.oidc.requireEmailVerified`     | `true`             | Require provider verification for a new identity                                                                |
| `general.oidc.enforceSso`               | `false`            | OIDC auto-login and suppression of local email recovery; explicit local password login remains available        |

Setup also maintains `general.setup.completed` (initially `false`) and `general.setup.completedAt` (initially `null`). These are lifecycle state, not controls for recreating the first administrator. The top-level `version` is internal configuration-migration metadata, not the installed Flare release number. Do not reset setup fields or change version markers as an upgrade procedure.

### Saved appearance fields

Legacy appearance remains in `settings.appearance`: `theme` defaults to `dark`; `favicon` is initially `null`; `customColors` is the original HSL palette. `settings.advanced.customCSS` and `settings.advanced.customHead` are empty strings initially. The favicon and custom styles are separate from studio packs.

The studio's published document lives under `settings.customization.published`. The same shape is used for a saved `draft` and `previous` document. Paths in this table are relative to that appearance document.

| Appearance path               | Initial value                                            | Choices or limit                                                      |
| ----------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| `brand.name`                  | `Flare`                                                  | 1–60 characters                                                       |
| `brand.tagline`               | `A free, modern, open source file upload platform`       | Up to 180 characters                                                  |
| `brand.logoLight`             | Empty string                                             | Embedded PNG/JPEG/WebP data URL, up to 256 KB                         |
| `brand.logoDark`              | Empty string                                             | Embedded PNG/JPEG/WebP data URL, up to 256 KB                         |
| `brand.footerText`            | `Flare is a free, open source, self-hostable file host.` | Up to 200 characters                                                  |
| `theme.enabled`               | `false`                                                  | Apply studio palettes rather than the original theme behavior         |
| `theme.defaultMode`           | `dark`                                                   | `system`, `light`, `dark`                                             |
| `theme.light`                 | Light palette below                                      | Full palette with six-digit hex colors                                |
| `theme.dark`                  | Dark palette below                                       | Full palette with six-digit hex colors                                |
| `theme.radius`                | `0.75`                                                   | 0–1.5 rem                                                             |
| `theme.background`            | `glow`                                                   | `glow`, `plain`, `grid`                                               |
| `theme.font`                  | `inter`                                                  | `inter`, `system`, `mono`                                             |
| `sharing.defaultStyle`        | `framed`                                                 | `minimal`, `framed`, `delivery`                                       |
| `sharing.showUploader`        | `true`                                                   | Show uploader attribution                                             |
| `sharing.showFilename`        | `true`                                                   | Show filename                                                         |
| `sharing.showSize`            | `true`                                                   | Show formatted file size                                              |
| `sharing.showFooter`          | `null`                                                   | `null` inherits `general.credits.showFooter`; `true`/`false` override |
| `sharing.imageFit`            | `contain`                                                | `contain` shows the whole image; `cover` fills the frame              |
| `sharing.titleTemplate`       | Empty string                                             | Automatic title when empty; up to 500 characters                      |
| `sharing.descriptionTemplate` | Empty string                                             | Automatic description when empty; up to 500 characters                |

Both social templates support `{{instanceName}}`, `{{filename}}`, `{{size}}`, and `{{uploader}}`. Hidden details are omitted. [Appearance](/admin/appearance) describes the publish and recovery workflows.

The customization wrapper also contains `version` (currently `1`), `revision` (initially `0`), `draft` and `previous` (initially `null`), and `publishedAt` (initially `null`). Flare manages these fields during saves, publishing, imports, and restoration. Revision checks protect against concurrent editors; do not strip or manually increment them to force a stale save.

### Palette fields and defaults

The studio uses the same field names for `theme.light` and `theme.dark`. The legacy `appearance.customColors` map uses these names too, with HSL components rather than hex values. The full starting values are:

| Field                   | Studio light | Studio dark | Legacy HSL          |
| ----------------------- | ------------ | ----------- | ------------------- |
| `background`            | `#f8fafc`    | `#020817`   | `222.2 84% 4.9%`    |
| `foreground`            | `#0f172a`    | `#f8fafc`   | `210 40% 98%`       |
| `card`                  | `#ffffff`    | `#020817`   | `222.2 84% 4.9%`    |
| `cardForeground`        | `#0f172a`    | `#f8fafc`   | `210 40% 98%`       |
| `popover`               | `#ffffff`    | `#020817`   | `222.2 84% 4.9%`    |
| `popoverForeground`     | `#0f172a`    | `#f8fafc`   | `210 40% 98%`       |
| `primary`               | `#0f172a`    | `#f8fafc`   | `210 40% 98%`       |
| `primaryForeground`     | `#f8fafc`    | `#0f172a`   | `222.2 47.4% 11.2%` |
| `secondary`             | `#e2e8f0`    | `#1e293b`   | `217.2 32.6% 17.5%` |
| `secondaryForeground`   | `#0f172a`    | `#f8fafc`   | `210 40% 98%`       |
| `muted`                 | `#f1f5f9`    | `#1e293b`   | `217.2 32.6% 17.5%` |
| `mutedForeground`       | `#475569`    | `#94a3b8`   | `215 20.2% 65.1%`   |
| `accent`                | `#e2e8f0`    | `#1e293b`   | `217.2 32.6% 17.5%` |
| `accentForeground`      | `#0f172a`    | `#f8fafc`   | `210 40% 98%`       |
| `destructive`           | `#dc2626`    | `#991b1b`   | `0 62.8% 30.6%`     |
| `destructiveForeground` | `#ffffff`    | `#f8fafc`   | `210 40% 98%`       |
| `border`                | `#cbd5e1`    | `#1e293b`   | `217.2 32.6% 17.5%` |
| `input`                 | `#cbd5e1`    | `#1e293b`   | `217.2 32.6% 17.5%` |
| `ring`                  | `#64748b`    | `#cbd5e1`   | `212.7 26.8% 83.9%` |

Account-specific settings are stored separately from the instance configuration: personal theme preference, upload defaults and profiles, tool options, scoped tokens, and webhook destinations are managed in **Profile**. Their values do not override operator limits or grant administrator permissions. See [the user handbook](/guide/) and [API authentication](/api/authentication).

## Test-only database variables

The repository's integration suites use explicit disposable databases: `FLARE_SETUP_DATABASE_URL`, `FLARE_FOLDERS_DATABASE_URL`, `FLARE_TAGS_DATABASE_URL`, `FLARE_CUSTOMIZATION_DATABASE_URL`, `FLARE_EMAIL_AUTH_DATABASE_URL`, `FLARE_EMAIL_DELIVERY_DATABASE_URL`, and `FLARE_EMAIL_CONFIG_DATABASE_URL`. They are not production connection settings. These tests delete fixtures; never point them at an application database.
