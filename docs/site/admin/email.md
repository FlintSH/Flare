---
description: Configure SMTP, recover local accounts, roll out email verification, brand messages, and diagnose delivery safely.
---

# Account email

Flare can send verification, password recovery, and email-change messages through your SMTP provider. **Sending, password recovery, and required verification are separate choices.** You can enable recovery for your users without making verification a condition of using the instance.

Open **Settings → Email**. No additional queue service or worker container is required; messages are queued in PostgreSQL and sent by the running Flare application.

<Screenshot src="/screenshots/email/settings.png" alt="Flare email settings with SMTP provider configuration and testing controls" caption="Test your provider before enabling automatic account mail." />

## Set up delivery

1. Enter the SMTP hostname and port supplied by your provider.
2. Select **TLS** for implicit TLS, usually port 465, or **STARTTLS** for a connection that must upgrade to TLS, usually port 587. Flare defaults to TLS on 465.
3. Enable authentication and enter the provider's username and password. An explicitly trusted local relay can use no authentication and/or no encryption when appropriate to that relay.
4. Set a sender address the provider authorizes, a display name, and optional Reply-To.
5. Set the public Flare URL, or let it use `NEXTAUTH_URL`. It must use HTTPS outside localhost testing.
6. Choose **Test connection**, then **Send test email** to an address you control. Open the inbox to confirm receipt.
7. Enable automatic sending and save when you are satisfied with the result.

Tests can use the draft configuration before saving or enabling automatic email. Connection testing checks connectivity/authentication; sending tests SMTP acceptance of sender and recipient. Test messages count toward the daily cap. Server acceptance does not guarantee inbox delivery.

Certificate verification stays enabled. For a private relay with a custom certificate authority, supply the CA in advanced SMTP settings or through `FLARE_EMAIL_SMTP_CA_FILE`.

Saved SMTP passwords are write-only in the settings view. Leaving the password input empty preserves the existing password; the explicit clear action removes it. Keep the active encryption key stable across deployments.

## Choose an access policy

| Verification mode          | New accounts                                                         | Existing accounts                                            |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Off**                    | No verification gate                                                 | Keep access; recovery enrollment can still be available      |
| **Optional**               | Receive verification mail but can use Flare before verifying         | Keep access                                                  |
| **Required for new users** | Accounts created after activation must verify for protected features | Earlier accounts keep access                                 |
| **Required for all users** | New accounts must verify immediately                                 | Unverified existing accounts get the configured grace period |

The default is **Off**. The default existing-user grace period is **7 days**, configurable from 0–90 days. Activating all-user enforcement requires reviewing the affected-user count in the dashboard. At least one administrator must already have trusted verification proof or an explicit exemption before that policy can be saved.

Turning enforcement off and back on establishes a new activation boundary. Moving into all-user mode starts a new existing-user grace window. Do not treat a policy toggle as a permanent record of which historical users were once required to verify.

When verification is required, a user can sign in to the restricted account flow and complete verification, but normal protected features and authenticated uploads remain gated until they do. Exempt users retain access without proving an address. You can choose whether administrator-created users **inherit** the policy or are **exempt**.

<Screenshot src="/screenshots/email/policies.png" alt="Email policy controls for verification, recovery, and existing-user grace periods" caption="Recovery and verification can be rolled out independently." />

### A staged rollout for an existing instance

1. Configure and test SMTP with recovery/verification enforcement still off.
2. Enable sending and password recovery.
3. Enroll and verify your administrator recovery address from Profile.
4. Ask existing users to enroll their own addresses while they still have access.
5. Enable optional or new-user verification if desired.
6. Only move to all-user enforcement after reviewing its impact and allowing a realistic grace period.

An upgrade leaves email disabled and keeps existing access unchanged. Older `emailVerified` timestamps may have been created without an actual mailbox confirmation, so Flare does not accept them as proof. No upgrade automatically sends enrollment mail to old accounts.

## Password recovery

Recovery works for **local-password accounts whose current email address has verified proof**. It is disabled by default. Once enabled, an eligible user can request a reset from the sign-in flow, open the link, and submit a new password.

Reset links expire after **30 minutes** by default, configurable from 5–120 minutes. Opening the link does not consume it; submitting the reset does. Successful reset invalidates browser sessions and obsolete recovery credentials. The legacy upload token is preserved unless **Rotate upload token** is enabled; scoped API tokens should be managed separately.

Recovery requests do not reveal whether the submitted email belongs to an eligible account. If an old user never enrolled a recovery address, an administrator must help them regain access; the stored address alone is insufficient. An exemption from verification does not enable recovery.

SSO-only accounts recover through the identity provider. OIDC auto-login's `enforceSso` setting also disables local email recovery, while preserving the explicit local password sign-in fallback. Keep a usable local administrator credential for identity-provider outages.

## Email changes

With email enabled, confirmed changes are available by default. Users recently authenticate, request a new address, and confirm it before it replaces the current one. You can additionally require approval at the old address.

The old address stays active until the required confirmations finish. Cancelling a change invalidates its pending links. Verification links default to **24 hours**, configurable from 1–168 hours. Link scanners opening a message do not finish the confirmation; a user must explicitly confirm.

A legacy unverified address does not need to receive approval mail unless the two-address policy explicitly requires it. If you enable old-address approval while a change is already pending, that user may need to restart their change so both links can be issued.

## SSO email trust

Two separate controls affect SSO:

- **Settings → Access → Require Verified Email** controls whether a new OIDC identity needs the provider's `email_verified=true` claim before Flare creates its account.
- **Settings → Email → Trust verified SSO email** controls whether that provider proof also satisfies Flare's account-email policy.

The second control is off by default. When enabled, proof is tied to the account's current email and configured identity. Disabling trust stops accepting proof based solely on an OIDC claim. Neither option links accounts with matching email addresses. [Full SSO guide](/admin/sso).

## Brand account messages

Advanced branding includes instance name, logo URL, accent color, support address, footer, introductory text, subject prefix, and separate verification/reset/change subjects. Flare generates HTML and plain-text versions and escapes the configured text. It does not accept arbitrary HTML email templates, attachments, or executable template code.

Use sender-domain SPF, DKIM, and DMARC settings as provided by your mail service. Flare does not receive provider bounce webhooks in this release, so investigate provider logs when mail is accepted but does not arrive.

## Limits and delivery history

Defaults are a 60-second resend interval, 5 messages per address per hour, 20 per IP per hour, and a daily admission cap of 500. Rate-limit accounting is stored in PostgreSQL. Your reverse proxy must supply trusted client-IP headers for IP limits to work as intended.

Queued messages survive restarts. Workers use leases to coordinate attempts and default to 2 concurrent sends, 3 attempts, and 60-second initial retry delay with exponential backoff. An expired or revoked account link cannot be made useful by retrying its old message.

Settings → Email shows pending, processing, accepted/sent, and failed deliveries with masked recipients and sanitized error messages. Retry an eligible failed message after fixing its cause. Retrying uses the same token rather than creating a new account action. Successful/expired message bodies are cleared, and diagnostic history follows the default 14-day retention setting.

SMTP delivery is at-least-once: a crash after acceptance can cause the same message to be sent again. Account tokens are still single-use. Disabling email through the settings save cancels pending/processing mail. SMTP failure does not automatically relax verification policy or make container liveness fail.

## Environment-managed configuration

For deployment-managed SMTP, add settings to the app's environment. This example uses a mounted password file:

```dotenv
FLARE_EMAIL_ENABLED=true
FLARE_EMAIL_SMTP_HOST=smtp.example.com
FLARE_EMAIL_SMTP_PORT=587
FLARE_EMAIL_SMTP_SECURITY=starttls
FLARE_EMAIL_SMTP_AUTHENTICATION=true
FLARE_EMAIL_SMTP_USERNAME=flare
FLARE_EMAIL_SMTP_PASSWORD_FILE=/run/secrets/flare_smtp_password
FLARE_EMAIL_FROM_ADDRESS=flare@example.com
FLARE_EMAIL_PUBLIC_URL=https://files.example.com
FLARE_EMAIL_RECOVERY_ENABLED=true
FLARE_EMAIL_VERIFICATION_MODE=new_users
```

Mount the referenced file so the app user can read it, and add these variables to the Flare service's environment; putting new keys in Compose's `.env` alone does not automatically pass them into the container. Redeploy after changes.

Every operator-facing email setting has an override and optional `_FILE` form. Overrides take precedence, are marked in the UI, and never overwrite the saved fallback. See the [complete variable/default reference](/hosting/configuration#email-environment-variables).

## Recover from an email lockout

At the deployment layer, set:

```dotenv
FLARE_EMAIL_ENABLED=false
```

Recreate/redeploy the app with that value passed into its environment. It disables sending and local email verification enforcement, even if an old encryption key is lost. To keep sending while relaxing the access gate, use `FLARE_EMAIL_VERIFICATION_MODE=off` instead.

Sign in with the existing local administrator password at `/auth/login?local=1`, repair the configuration, verify recovery access, then remove the override and redeploy. This does not reset passwords, bypass authentication, or disable SSO configuration.

If decryption is the problem, restore the original key from your secret backup. Changing to a new key requires re-entering credentials and replacing affected queued messages; it also affects encrypted webhook secrets. [Key rotation and backups](/hosting/maintenance#secrets-and-key-rotation).
