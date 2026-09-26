---
description: Connect an OpenID Connect provider, understand provisioning and email proof, and keep a working local recovery path.
---

# Single sign-on with OIDC

Flare supports one configured OpenID Connect provider. Users can sign in through your existing identity service while Flare retains its own accounts, file ownership, and roles. Configure it under **Settings → Access → Single Sign-On (OIDC)** with `settings.security`.

The 2.1 dependency refresh preserves existing provider settings and issuer/subject bindings; it does not enable email-only account linking. After [upgrading](/hosting/maintenance#upgrading-from-2-0-to-2-1), test both a linked SSO account and your local administrator fallback.

## Connect a provider

The administrator recovery safeguard checks that an SSO-only administrator’s saved issuer matches the configured, enabled provider. Disabling or changing the only working administrator provider is refused; create and test a local-password administrator before making that change.

1. Keep a working local administrator account and test `/auth/login?local=1` before changing the normal sign-in flow.
2. Create a confidential OIDC application in your identity provider.
3. Register this exact redirect URI, replacing the hostname:

   ```text
   https://files.example.com/api/auth/callback/oidc
   ```

4. Ensure the provider permits the `openid email profile` scopes and returns a stable subject plus an email claim.
5. Enter the issuer URL, client ID, and client secret in Flare. The issuer must serve discovery at `ISSUER/.well-known/openid-configuration`.
6. Enable OIDC, set the sign-in button label, and save.
7. Test sign-in in a separate browser/private window using a new eligible provider identity before enabling auto-login.

Flare uses provider discovery, ID tokens, PKCE, and state checks. The callback origin should match `NEXTAUTH_URL` and your public HTTPS hostname. Do not enter a discovery-document URL as the issuer: Flare appends the discovery path itself.

<Screenshot src="/screenshots/preferences/settings-access.png" alt="Access settings with registration and OIDC provider controls" caption="Password registration and OIDC provisioning are separate access decisions." />

## Provider settings

| Setting                   | Default            | Behavior                                                                                  |
| ------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| Enable OIDC Sign-In       | Off                | Makes the provider available when issuer, client ID, and client secret are also present   |
| Issuer URL                | Empty              | Identity provider's issuer; trailing slash is normalized for subject identity             |
| Client ID / Client Secret | Empty              | Credentials for the provider application                                                  |
| Sign-In Button Text       | `Sign in with SSO` | Label shown to users                                                                      |
| Auto-Provision Users      | On                 | Allows a new eligible provider identity to create a Flare account inheriting Everyone     |
| Require Verified Email    | On                 | Requires `email_verified=true` for a new identity before account creation                 |
| OIDC Auto-login           | Off                | Redirects the usual login page to OIDC; `/auth/login?local=1` still exposes local sign-in |

These settings are stored in the database. There are no `FLARE_OIDC_*` server environment overrides in the current implementation.

## Account creation and identity

Flare identifies an OIDC account by **issuer and subject**, not by its email alone. New provisioned accounts inherit **Everyone**, just like local registrations. Assign additional roles through **Users** when needed. Provider groups or role claims are not mapped to Flare roles; changing identity-provider membership does not edit Flare role assignments. Existing OIDC accounts keep their assigned Flare roles on sign-in.

| Situation                                                             | Result                                      |
| --------------------------------------------------------------------- | ------------------------------------------- |
| Original issuer/subject already linked                                | Sign in to the existing Flare account       |
| New identity, auto-provision on, unused email, required claim present | Create an account inheriting Everyone       |
| New identity, auto-provision off                                      | Sign-in rejected; no account is created     |
| New identity using an existing local account's email                  | Sign-in rejected; no automatic linking      |
| Different identity using an existing linked account's email           | Sign-in rejected; the original link remains |
| New identity without an email                                         | Sign-in rejected                            |
| New identity without verified email when required                     | Sign-in rejected                            |

Precreating a local user with the same email does **not** provision an SSO identity. An explicit account-linking flow is not available. Local users continue using their password, and linked users use their original provider identity. Older configuration data containing `allowLinking` may be accepted, but that field is ignored.

Changing providers or issuer URLs can make previously linked identities appear new. Plan such a move as an account migration; simply preserving email addresses does not preserve the link. Flare does not expose a general unlink/relink workflow.

## Registration and auto-login

**Allow Registrations** controls public local password-account creation. **Auto-Provision Users** independently controls new OIDC account creation. For a private team, restrict access in your identity provider and review both Flare switches.

OIDC Auto-login simplifies the normal login screen; it is not a mechanism for deleting or cryptographically disabling all local credentials. The local sign-in escape URL is deliberate. The setting also suppresses local email password recovery, so administrators should keep their local fallback password available.

## Verified email versus Flare email policy

The OIDC **Require Verified Email** setting decides whether a new provider identity can be provisioned. **Settings → Email → Trust verified SSO email** separately decides whether provider proof satisfies Flare's email-verification policy. It is off by default.

When trust is enabled, Flare accepts a verified claim tied to the current account email. It does not use that claim to merge accounts. If trust is later disabled, those users may need local mailbox verification when required by your email policy. [Account email and recovery](/admin/email).

## Common sign-in messages

| Message                                 | Administrator action                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Provider did not share an email address | Configure the email claim and requested scopes                                                           |
| Account with this email already exists  | Ask the person to use local sign-in or their original linked identity; do not expect email-based linking |
| Automatic sign-up is disabled           | Review whether auto-provisioning should be enabled for eligible provider users                           |
| Provider has not verified this email    | Complete provider verification or deliberately reconsider the verified-email requirement                 |
| Generic sign-in failure                 | Check callback URI, issuer discovery, secret, provider logs, public origin, and connectivity             |

If auto-login prevents reaching the normal form, open `/auth/login?local=1`, sign in locally, and repair OIDC in Settings. If the local account is also gated by email verification, use the documented [email operator recovery](/admin/email#recover-from-an-email-lockout) to relax that policy while preserving authentication.
