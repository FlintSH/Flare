# Account email

Flare can send account verification, password recovery, and email-change messages
through an SMTP server. Email delivery, password recovery, and signup verification
are independent settings. No email service, queue service, or extra container is
required: delivery uses the existing PostgreSQL database and application process.

## Upgrading an existing instance

Email is disabled by default. An upgrade adds settings and tables without changing
existing login, registration, SSO, upload tokens, or setup completion. Existing
instances do not run the setup wizard again. SMTP credentials alone never enable
email or require verification.

Open **Settings → Email** to configure delivery. You can test a draft configuration
before saving or enabling automatic sending. **Test connection** checks SMTP
connectivity/authentication; **Send test email** checks whether the mail server
accepts the sender and recipient. Check the recipient's inbox to confirm delivery.
Test messages are explicit administrator actions and count against the daily cap.

Old `emailVerified` timestamps do not prove that someone received a message. Flare
previously set some timestamps without contacting a mailbox. Old accounts retain
access, but must enroll a recovery address while signed in before email can reset
their password. Users confirm their current password (or recently authenticate
with SSO) and follow the verification link. An administrator can still help users
who lost access before enrolling. No upgrade sends enrollment mail automatically.

## First-time setup

After creating the initial administrator and configuring storage/registration, the
optional email step offers **Set up later**, **Password recovery**, and **Verify new
accounts**. The administrator is already authenticated before connection tests
become available. Email errors do not undo completed setup or lock the
administrator out. The initial administrator has an explicit verification
exemption; this is not mailbox proof. Finish by verifying their recovery address.

## Account policies

- **Off:** no signup verification requirement. Recovery enrollment is still
  available when email is enabled.
- **Optional:** new users receive verification mail and can continue using Flare.
- **Required for new users:** accounts created from the activation time must verify
  before accessing protected features. Existing users keep access. After turning
  enforcement off and back on, the new activation starts a new boundary.
- **Required for all users:** administrators explicitly review the affected-user
  count before saving. Existing users get the configured grace period; new users
  must verify immediately. At least one administrator must have trusted proof or
  an explicit exemption before this policy can be saved through the dashboard.

Exemptions preserve access and never enable password recovery on their own.
Administrator-created users can inherit the instance policy or be exempt. The
Users dialog exposes verification status, resend, and exemption actions.

Recovery only applies to local-password accounts with proof bound to their current
address. SSO-only users recover through their identity provider. Enforced SSO
disables local email recovery without changing Flare's existing local administrator
login fallback. The separate OIDC `requireEmailVerified` setting retains its
existing meaning. **Trust verified SSO email** controls whether a verified claim
from the configured provider also satisfies Flare's email policy; disabling trust
stops accepting proof based solely on that claim. Accounts are never linked by
matching email addresses.

Password reset links expire after 30 minutes by default. Successful reset consumes
the link and invalidates browser sessions. Upload tokens are preserved unless the
administrator enables their rotation. Verification links expire after 24 hours by
default. Opening a link does not consume it: users explicitly confirm or submit a
new password, so automatic email link scanners do not complete account actions.

Email changes require recent authentication. Flare keeps the current address until
the new address is confirmed, and can optionally require confirmation from the old
address too. Cancellation invalidates pending links. A changed password/address
invalidates obsolete recovery credentials. Changing a legacy unproven address
does not require receiving mail at that old address unless the administrator has
explicitly selected the two-address policy.

## SMTP and branding

Use the SMTP details supplied by your provider. Prefer **STARTTLS (required)** on
port 587 or **TLS** on port 465. Certificate verification remains enabled; a custom
CA certificate can be supplied for a private relay. Unencrypted/no-auth delivery
is available as an explicit option for a trusted local relay.

Set a sender address your provider permits, then configure sender name, optional
Reply-To, and the public Flare URL. The URL defaults to `NEXTAUTH_URL`; public
account links require HTTPS (localhost permits HTTP for testing). Do not use a
container's private hostname as the public URL.

Configure SPF, DKIM, and DMARC with your mail provider/domain administrator as
appropriate. SMTP acceptance is not a guarantee of inbox placement; Flare does
not receive bounce webhooks in this release. Check spam folders and provider logs
when a successfully accepted message is missing.

Advanced settings include instance name, logo URL, accent color, support address,
footer, introductory text, subject prefix, and account-message subjects. HTML and
plain-text versions are generated from escaped values. Arbitrary HTML templates,
attachments, and executable template code are not accepted.

## Environment and secret files

Every operator-facing email setting supports an environment override. Environment
values take precedence over saved settings, then defaults. Overridden controls are
marked **Managed by environment** and cannot be changed in the dashboard. Removing
an override restores the saved fallback; Flare does not copy overrides into it.

Names start with `FLARE_EMAIL_`. Nested paths use underscores, and camelCase becomes
upper snake case: `smtp.timeoutSeconds` becomes
`FLARE_EMAIL_SMTP_TIMEOUT_SECONDS`. Boolean values are exactly `true` or `false`;
numeric values are integers. Any setting also accepts a `_FILE` variant whose file
contents supply its value. Set either the direct variable or its `_FILE` variant,
not both. Activation timestamps and the internal applied-policy marker are
server-controlled and cannot be overridden.

Example SMTP deployment:

```dotenv
FLARE_EMAIL_ENABLED=true
FLARE_EMAIL_SMTP_HOST=smtp.example.com
FLARE_EMAIL_SMTP_PORT=587
FLARE_EMAIL_SMTP_SECURITY=starttls
FLARE_EMAIL_SMTP_AUTHENTICATION=true
FLARE_EMAIL_SMTP_USERNAME=flare
FLARE_EMAIL_SMTP_PASSWORD_FILE=/run/secrets/flare_smtp_password
FLARE_EMAIL_FROM_NAME=Flare
FLARE_EMAIL_FROM_ADDRESS=flare@example.com
FLARE_EMAIL_PUBLIC_URL=https://files.example.com
FLARE_EMAIL_RECOVERY_ENABLED=true
FLARE_EMAIL_VERIFICATION_MODE=new_users
```

| Setting suffix                                                                                                       | Default / allowed values                           |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `ENABLED`                                                                                                            | `false`                                            |
| `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_CA`                                                             | Empty                                              |
| `SMTP_PORT`                                                                                                          | `465`; 1–65535                                     |
| `SMTP_SECURITY`                                                                                                      | `tls`; `tls`, `starttls`, `none`                   |
| `SMTP_AUTHENTICATION`                                                                                                | `true`                                             |
| `SMTP_TIMEOUT_SECONDS`                                                                                               | `15`; 3–120                                        |
| `FROM_NAME`                                                                                                          | `Flare`                                            |
| `FROM_ADDRESS`, `REPLY_TO`, `PUBLIC_URL`                                                                             | Empty; public URL falls back to `NEXTAUTH_URL`     |
| `RECOVERY_ENABLED`, `RECOVERY_ROTATE_UPLOAD_TOKEN`                                                                   | `false`                                            |
| `RECOVERY_TOKEN_MINUTES`                                                                                             | `30`; 5–120                                        |
| `VERIFICATION_MODE`                                                                                                  | `off`; `off`, `optional`, `new_users`, `all_users` |
| `VERIFICATION_GRACE_DAYS`                                                                                            | `7`; 0–90, applies to existing accounts            |
| `VERIFICATION_ADMIN_CREATED`                                                                                         | `inherit`; `inherit`, `exempt`                     |
| `VERIFICATION_TRUST_OIDC`                                                                                            | `false`                                            |
| `VERIFICATION_TOKEN_HOURS`                                                                                           | `24`; 1–168                                        |
| `CHANGES_ENABLED`                                                                                                    | `true` (effective only when email is enabled)      |
| `CHANGES_REQUIRE_OLD_EMAIL`                                                                                          | `false`                                            |
| `LIMITS_RESEND_SECONDS`                                                                                              | `60`; 30–3600                                      |
| `LIMITS_ADDRESS_PER_HOUR`                                                                                            | `5`; 1–100                                         |
| `LIMITS_IP_PER_HOUR`                                                                                                 | `20`; 1–1000                                       |
| `LIMITS_DAILY_LIMIT`                                                                                                 | `500`; 1–100000                                    |
| `DELIVERY_MAX_ATTEMPTS`                                                                                              | `3`; 1–10                                          |
| `DELIVERY_RETRY_SECONDS`                                                                                             | `60`; 10–3600 (exponential backoff)                |
| `DELIVERY_CONCURRENCY`                                                                                               | `2`; 1–10 across the instance                      |
| `DELIVERY_RETENTION_DAYS`                                                                                            | `14`; 1–90                                         |
| `BRANDING_INSTANCE_NAME`                                                                                             | `Flare`                                            |
| `BRANDING_ACCENT_COLOR`                                                                                              | `#6366f1`; six-digit hex color                     |
| `BRANDING_LOGO_URL`, `BRANDING_FOOTER`, `BRANDING_SUPPORT_ADDRESS`, `BRANDING_SUBJECT_PREFIX`, `BRANDING_INTRO_TEXT` | Empty                                              |
| `BRANDING_VERIFICATION_SUBJECT`                                                                                      | `Verify your email address`                        |
| `BRANDING_RESET_SUBJECT`                                                                                             | `Reset your password`                              |
| `BRANDING_CHANGE_SUBJECT`                                                                                            | `Confirm your new email address`                   |

Environment-based policy changes are intentional operator actions. Switching to
`all_users` records a fresh existing-user grace period even when `new_users` was
previously active. Unlike the dashboard, environment changes have no interactive
impact confirmation; verify administrator recovery access first.

## Encryption and recovery

Saved SMTP passwords and temporary token-bearing outbox messages are encrypted
using AES-256-GCM with purpose-separated keys. The key comes from
`FLARE_EMAIL_ENCRYPTION_KEY` (or `FLARE_EMAIL_ENCRYPTION_KEY_FILE`), falling back to
`NEXTAUTH_SECRET`. The secret must be at least 32 characters. Preserve it across
restarts and replicas; store backups separately from database backups. Disabled
instances do not need an additional key.

SMTP passwords are write-only in the settings API. An empty input preserves the
saved password; use the explicit clear action to remove it. Credentials and
recovery links are omitted from diagnostics and application request URL logs.

Rotating the encryption key does not automatically re-encrypt existing data. Plan
rotation by pausing email, allowing/cancelling queued messages, changing the key,
and re-entering SMTP credentials before enabling email again. Old queued encrypted
messages cannot be delivered under a new key; issue fresh account links. A
dedicated email key allows rotating the session secret independently.

For operator recovery, set `FLARE_EMAIL_ENABLED=false` and restart the application.
This disables sending and local email enforcement even if the old key is lost.
It does not alter SSO settings or change passwords. Sign in through the existing
local administrator path (`/auth/login?local=1`), fix configuration, and remove the
override when ready. To relax verification while retaining email delivery, set
`FLARE_EMAIL_VERIFICATION_MODE=off` instead.

## Delivery operation

The database outbox persists across restarts. Workers claim jobs atomically with
leases, limit concurrent sends across replicas, and retry temporary failures with
backoff. Expired/revoked account links are cancelled. SMTP is at-least-once: a crash
after server acceptance can cause the same message/link to be sent again; the
account token is still usable only once. Retrying never issues a new token.

The Email tab shows pending, processing, accepted, and failed messages with masked
recipients and sanitized errors. Expired/replaced links cannot be retried. Message
bodies are purged after successful delivery or expiry; diagnostic history follows
the retention setting. Account tokens are hashed in their validation table.

SMTP outages do not fail container liveness or automatically relax access policy.
Request throttles and the daily admission cap are persisted in PostgreSQL. Configure
the reverse proxy to replace untrusted forwarding headers before forwarding client
IP addresses. All replicas must share the database and encryption secret.

## Development and validation

Use a local SMTP capture server such as Mailpit or a test-only SMTP fixture. Never
send automated test messages to real users. Unit tests exercise policy, crypto,
configuration, rendering, and the SMTP protocol. Database suites opt in only to
explicitly supplied disposable databases:

```sh
FLARE_EMAIL_AUTH_DATABASE_URL=postgresql://dev@127.0.0.1:55432/flare_email_test \
FLARE_EMAIL_DELIVERY_DATABASE_URL=postgresql://dev@127.0.0.1:55432/flare_email_delivery \
FLARE_EMAIL_CONFIG_DATABASE_URL=postgresql://dev@127.0.0.1:55432/flare_email_config_test \
pnpm test
```

Create and migrate those databases before running the tests. These suites delete
their fixtures and must not point at an application database. The Code Quality CI
job provisions these databases and runs the integration tests on every PR.
