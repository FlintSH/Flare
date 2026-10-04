---
title: Sign-in security contracts
description: Browser-session contracts for authenticator enrollment, WebAuthn passkeys, optional passkey requirements, and separate emergency recovery codes.
---

# Sign-in security contracts

These routes support Flare's interactive [sign-in security controls](/guide/security). Security management requires a **browser session** with a current session version; sensitive changes also require fresh identity proof. Neither named API tokens nor the legacy upload credential can authorize these routes. They are deliberately excluded from the named-token [OpenAPI document](/openapi.json) and request builder.

Security features are available independently of `profile.update`. They do not grant application permissions or bypass email verification. The normal account/role/email checks continue after sign-in.

## Origin and credential boundaries

Mutations require the exact canonical `Origin` from `NEXTAUTH_URL` and reject an `Authorization` header, even if a session cookie is also present. Passkey requests also use the relying-party hostname and expected origin from that configured URL, rather than choosing them from an incoming Host header. Use HTTPS; `http://localhost` is accepted for local development.

A local account with `passkeyRequired: false` confirms management actions with its current password and, when enrolled, an unused authenticator or authenticator recovery code. A session authenticated with a passkey or password plus authenticator recovery code within the last **five minutes** satisfies fresh identity proof without consuming another code. An account without a local password can use a fresh OIDC or passkey sign-in. TOTP enrollment itself additionally requires an existing local password.

With `passkeyRequired: true`, all security management requires a passkey or dedicated passkey-recovery sign-in within five minutes. Password, TOTP, authenticator recovery, and OIDC proof cannot satisfy it. Enabling the requirement specifically needs a recent **passkey** sign-in, at least one registered passkey, and a nonempty account email address. Disabling it or replacing its dedicated codes requires recent passkey or passkey-recovery proof. These checks are server-owned; client session updates cannot establish or extend them.

Completing authenticator enrollment, disabling it, replacing either recovery-code set, adding/removing a passkey, or changing the passkey requirement increments the account's session version and invalidates existing browser sessions and pending account challenges. The success response tells the client to sign in again. Save displayed recovery codes before navigating away. API/upload credentials remain independent and are not revoked by these changes.

## Routes and JSON shapes

Management mutation bodies require `Content-Type: application/json` and are limited to **64 KiB**, including streamed requests. All successful operations below return `200` JSON with `Cache-Control: no-store`. `proof` means an object with optional `password` and `code` strings; the server decides which fields are required from the account's current state and the session's authentication method. Local password confirmation accepts at most 256 characters; `code` accepts at most 80 characters so it can hold either a six-digit TOTP value or a recovery code. Never put either in a URL.

| Method and path                                   | Request body                                                                 | Response                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/security`                          | None.                                                                        | Status object described below.                                                                                 |
| `POST /api/auth/security/totp/setup`              | `proof`.                                                                     | `{ "secret": "…", "uri": "otpauth://…", "challengeId": "…" }`; private setup material for the current account. |
| `POST /api/auth/security/totp/enable`             | `{ "code": "123456", "challengeId": "…" }`.                                  | `{ "recoveryCodes": ["…"], "signInAgain": true }`.                                                             |
| `POST /api/auth/security/totp/disable`            | `proof`.                                                                     | `{ "signInAgain": true }`.                                                                                     |
| `POST /api/auth/security/recovery-codes`          | `proof`.                                                                     | `{ "recoveryCodes": ["…"], "signInAgain": true }`.                                                             |
| `POST /api/auth/security/passkeys/options`        | `proof` plus `name`.                                                         | `{ "options": { … }, "challengeId": "…" }`; WebAuthn registration options.                                     |
| `POST /api/auth/security/passkeys/verify`         | `{ "challengeId": "…", "response": { … } }`.                                 | `{ "signInAgain": true }`.                                                                                     |
| `POST /api/auth/security/passkeys/require`        | `{ "required": true }` or `{ "required": false }`; fresh session proof only. | `{ "recoveryCodes": ["…"], "signInAgain": true }` when enabling; `{ "signInAgain": true }` when disabling.     |
| `POST /api/auth/security/passkeys/recovery-codes` | `{}`; fresh session proof only.                                              | `{ "recoveryCodes": ["…"], "signInAgain": true }`; replaces the dedicated passkey recovery set.                |
| `PATCH /api/auth/security/passkeys/{id}`          | `proof` plus `name`.                                                         | `{ "success": true }`; a rename keeps existing sessions.                                                       |
| `DELETE /api/auth/security/passkeys/{id}`         | `proof`, including an empty JSON object when recent proof suffices.          | `{ "signInAgain": true }`.                                                                                     |
| `POST /api/auth/passkeys/options`                 | No body.                                                                     | `{ "options": { … }, "challengeId": "…" }`; WebAuthn authentication options and a browser-binding cookie.      |

Passkey names are trimmed and must contain **1–64 characters**. Each account can register **10 passkeys**. The ID in a passkey URL is the opaque credential ID; encode it as a path segment. An owned credential must exist before rename/removal succeeds. Removing the last registered passkey is rejected while the requirement is on.

The status response contains:

```json
{
  "twoFactorEnabled": false,
  "recoveryCodesRemaining": 0,
  "hasPassword": true,
  "passkeys": [],
  "passkeysAvailable": true,
  "passkeyRequired": false,
  "passkeyRecoveryCodesRemaining": 0,
  "canUseRecentPasskey": false,
  "canUseRecentPasskeyRecovery": false,
  "canUseRecentRecovery": false,
  "canUseRecentSso": false
}
```

Each `passkeys` entry contains `id`, `name`, `createdAt`, and nullable `lastUsedAt`. Dates are ISO strings. `passkeysAvailable` reports whether the server's origin configuration supports passkeys; the browser must separately support WebAuthn. `passkeyRequired` is an account-level requirement, off by default. `recoveryCodesRemaining` counts authenticator recovery codes; `passkeyRecoveryCodesRemaining` counts the independent passkey recovery set. `canUseRecentPasskey`, `canUseRecentPasskeyRecovery`, `canUseRecentRecovery`, and `canUseRecentSso` describe whether the session presently supplies each kind of recent proof, subject to the requirement rules above. No setup secret or recovery-code value is returned by this status route.

### Run a session request on a disposable instance

Run this example in the developer console of an **already signed-in, disposable Flare instance**, never on the documentation site. It reads your own status without displaying secret material. It needs no role grant and uses the existing browser cookie; do not copy that cookie into a script or bearer header.

```js
async function securityRequest(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

const security = await securityRequest('/api/auth/security')
console.log({
  twoFactorEnabled: security.twoFactorEnabled,
  recoveryCodesRemaining: security.recoveryCodesRemaining,
  registeredPasskeys: security.passkeys.length,
  passkeyRequired: security.passkeyRequired,
  passkeyRecoveryCodesRemaining: security.passkeyRecoveryCodesRemaining,
})
```

For a real mutation, use the [demonstrated account controls](/guide/security). A registration client must obtain options, complete `navigator.credentials.create()` through a WebAuthn client, serialize the credential, then submit it to `/api/auth/security/passkeys/verify` with the returned `challengeId`. Passing options or a challenge ID without a verified authenticator response is insufficient.

For password sign-in, the NextAuth `credentials` provider accepts `email`, `password`, and optional `code`. Once the password is correct for a TOTP-enrolled account, omitting `code` reports `TwoFactorRequired`; the first step creates no session. Submit the password again with a current authenticator or unused recovery code to complete sign-in. Throttled password callbacks report `TooManyAttempts`; callback response conventions are managed by NextAuth rather than the JSON security routes above.

An account requiring passkeys instead reports `PasskeyRequired` after correct-password verification, even if a correct authenticator code was supplied. OIDC sign-in redirects to `/auth/login?local=1&error=OidcPasskeyRequired`. Both paths leave the account signed out; use a passkey or the dedicated recovery provider.

Passkey login obtains public authentication options and completes the browser's credential request. The NextAuth `passkey` credentials provider takes `challengeId` and a JSON-serialized `response`; keep the standard NextAuth CSRF flow. The options response sets an HttpOnly, same-site Strict browser-binding cookie at path `/`, expiring after five minutes. HTTPS uses the Secure host-only `__Host-flare-passkey-challenge` cookie; local HTTP development uses `flare-passkey-challenge`. Verification requires the same browser binding. Do not try to turn that browser flow into a named-token endpoint.

The in-account **Confirm with a passkey** flow additionally sends `expectedUserId` to that provider. Verification rejects a credential for another account before issuing a session; this field narrows the accepted account and is not identity proof by itself. Ordinary sign-in can omit it.

Emergency passkey recovery uses the NextAuth `passkey-recovery` credentials provider with `email` and `code`, retaining the standard NextAuth CSRF flow. It accepts one unused dedicated passkey recovery code only while the account requires passkeys. No password or TOTP value is required; authenticator recovery codes cannot substitute. An accepted code is consumed atomically and records the `passkey-recovery` authentication method. The requirement remains enabled after sign-in.

### Errors and throttling

Errors contain `{ "error": "…" }` with `Cache-Control: no-store`. Invalid proof, used/expired challenges, invalid enrollment codes, and passkey limits return `400`; missing/revoked sessions or an `Authorization` header return `401`; an incorrect or missing mutation origin returns `403`; an unknown owned passkey returns `404`; oversized requests return `413`; unsupported body content types return `415`; throttled requests return `429`; unavailable canonical-origin configuration returns `503`. A throttled response includes `Retry-After: 900`.

Management is limited to **20 attempts per account per 15 minutes**. Password sign-in is limited to **30 attempts per account** and **100 per IP** per 15 minutes. Dedicated passkey-recovery sign-in has its own **30-per-account** and **100-per-IP** limits per 15 minutes. Public passkey options and passkey sign-in callbacks each have a limit of **100 per IP per 15 minutes**. The limits are shared through PostgreSQL across application replicas. Keep the [proxy's client-IP headers trustworthy](/hosting/reverse-proxy#keep-access-decisions-in-flare).

Expired counter records are pruned by the [background cleanup worker](/hosting/maintenance#authentication-rate-limit-cleanup), independently of authentication requests. Pending cleanup does not extend a counter's 15-minute limit window.

## Authenticator behavior

Flare uses six-digit TOTP codes with a **30-second** period and permits one adjacent time step in each direction. A successful code stores its time counter; that or an earlier counter cannot be redeemed again. Recovery-code consumption is also atomic, so concurrent attempts cannot both use the same code.

Keep the returned setup `challengeId` in memory and send it with the current code when enabling; a session alone cannot confirm a different pending setup. `123456` in the shape above illustrates the six-digit format, not a reusable code. Authenticator setup is pending for **five minutes** and does not enable protection until a correct setup code is confirmed. The setup key is encrypted using AES-256-GCM with a domain-separated key derived from `NEXTAUTH_SECRET`; the email encryption override does not replace this key. [Preserve it during upgrades](/hosting/maintenance#two-factor-authentication-and-passkey-migration).

Enabling protection or replacing recovery codes returns **ten** codes once. The database stores their hashes, bound to the account, rather than recoverable values. Recovery input ignores spaces/hyphens and letter case. Each code can be consumed only once. A successful password-plus-recovery-code sign-in records the server-issued `recovery` authentication method; that session provides fresh security-management proof for five minutes. This allows the last code to restore access and replace the set, disable/re-enroll the authenticator, or add a passkey without needing another code. The browser cannot set or extend this proof through a session update. Replacing the set invalidates unused codes in the previous set; disabling the authenticator removes the set.

## Passkey behavior

Passkeys use WebAuthn registration and authentication with **user verification required**. Flare stores the credential public key, credential ID, counter, and transports. It does not receive the authenticator's private key or biometric data.

Challenges expire after five minutes and are one-use. Registration binds the pending ceremony to the signed-in account and its current session version. Verification checks the expected challenge, origin, relying-party ID, and user verification before publishing a credential or issuing a session. Replaying an accepted response cannot create a second sign-in.

With the requirement off, passkey sign-in is an alternative to password plus TOTP. A TOTP-enrolled account cannot bypass its factor through a password-only callback or a linked OIDC sign-in. SSO-only accounts rely on their identity provider's MFA when using SSO. An independently registered passkey can sign in without consulting the provider again.

### Required passkeys and dedicated recovery

Enabling `passkeyRequired` blocks both password credentials callbacks (including correct TOTP or authenticator recovery codes) and OIDC sign-in. It preserves the password, provider binding, TOTP enrollment, and authenticator recovery set. Fresh passkey/passkey-recovery sessions can still manage TOTP while the requirement is on, but that authenticator does not authorize a password login until the requirement is explicitly disabled.

Successful activation or dedicated-code replacement returns **ten** independently generated **128-bit** passkey recovery codes once. Replacement requires the flag to be on; otherwise it returns `400`. Each code is 32 hexadecimal characters, displayed in four groups of eight. Input ignores whitespace, hyphens, and letter case. Hashes are bound to the account and stored separately from authenticator recovery hashes. Each code grants complete emergency sign-in using the account email address; treat it as a standalone credential, not as a second factor.

The recovered session provides five minutes of fresh proof for adding a passkey, replacing the dedicated set, or disabling the requirement, including after spending the last available code. Replacing the dedicated set invalidates its prior codes. Disabling the requirement deletes that set; re-enabling issues a new set. Neither operation consumes or replaces the authenticator recovery set. Adding/removing a passkey alone does not toggle the requirement, and the last passkey cannot be removed while it is on.

Disabling the requirement or removing the last optional passkey also requires a configured fallback. The server checks a local password plus current email, or the account's binding to the enabled OIDC issuer with a client ID and secret and no local TOTP enrollment that would block OIDC, inside the account transaction. Missing fallback returns `400`; a failed disable leaves the dedicated codes intact. This configuration check does not contact the provider or establish that the owner can still use it. Repeating an already-enabled/already-disabled requirement change also returns `400` rather than generating another code set.

Password changes, email changes, administrator password resets, and emailed password resets preserve the flag and both enrolled sign-in methods and code sets. API tokens remain valid according to their existing scopes and permissions; there is no instance-wide passkey requirement or new bearer scope.

## Password and plain email changes

`PUT /api/profile` retains its general profile permissions and response shape, but changing `newPassword` or the plain `email` field also requires a browser session and fresh security proof. An upload credential cannot change either field. With the passkey requirement off, send `currentPassword` and, when TOTP is enabled, `securityCode` with an unused authenticator or recovery code, unless recent eligible proof suffices. With it on, a recent passkey or dedicated passkey-recovery session is required. A password change still requires the current-password field because it changes an existing local password.

A new password must use **8 or more characters** and at most **72 UTF-8 bytes**. A successful password or plain email change increments the session version and invalidates pending email-action tokens; sign in again afterward. It preserves TOTP enrollment, both recovery-code sets, passkeys, and the passkey requirement. Use the new email address for dedicated recovery sign-in after an address change. Name/upload-preference changes retain the existing profile behavior.

When account email features are enabled, the plain email field remains rejected; use the separate confirmed email-change flow. With the requirement off, email actions retain their existing current-password or recent-SSO identity requirements. With it on, `/api/auth/email/change` and `/api/auth/email/enroll` require fresh passkey or dedicated passkey-recovery proof, including for SSO-only accounts; the transaction rechecks that proof. Other email routes retain their existing checks. Email password resets preserve enrolled factors, both code sets, and the passkey requirement while invalidating browser sessions. Resetting a password does not authorize password sign-in while the requirement remains on.

## Compatibility and events

The additive passkey-requirement migration defaults the flag to false on new and existing accounts and preserves previously enrolled authenticators/passkeys. Registration alone does not enable the requirement. An old custom login client that sends only a password must handle the second-factor requirement after TOTP enrollment and cannot sign in after the account explicitly requires passkeys. Use the maintained Flare login UI for the complete sign-in flow, including both recovery methods and browser passkey ceremonies.

Password changes and email password resets do not disable TOTP, replace either recovery-code set, remove passkeys, or turn off the passkey requirement. Session revocation ends current sessions without removing the methods that could create a new one. Email verification remains enforced after successful password, authenticator, passkey, or dedicated recovery sign-in.

The named-token scopes, OpenAPI operations, upload-tool formats, and webhook contracts are unchanged. Security changes do not emit a webhook event; the only documented event remains `file.ready`. Do not repurpose a file webhook as an authentication audit stream.
