---
title: Sign-in security contracts
description: Browser-session contracts for authenticator enrollment, one-time recovery codes, and WebAuthn passkey registration and sign-in.
---

# Sign-in security contracts

These routes support Flare's interactive [sign-in security controls](/guide/security). Security management requires a **browser session** with a current session version; sensitive changes also require fresh identity proof. Neither named API tokens nor the legacy upload credential can authorize these routes. They are deliberately excluded from the named-token [OpenAPI document](/openapi.json) and request builder.

Security features are available independently of `profile.update`. They do not grant application permissions or bypass email verification. The normal account/role/email checks continue after sign-in.

## Origin and credential boundaries

Mutations require the exact canonical `Origin` from `NEXTAUTH_URL` and reject an `Authorization` header, even if a session cookie is also present. Passkey requests also use the relying-party hostname and expected origin from that configured URL, rather than choosing them from an incoming Host header. Use HTTPS; `http://localhost` is accepted for local development.

A local account confirms management actions with its current password and, when enrolled, an unused authenticator or recovery code. A session authenticated with a passkey or password plus recovery code within the last **five minutes** satisfies fresh identity proof without consuming another code. An account without a local password must have a fresh OIDC or passkey sign-in within five minutes. TOTP enrollment itself additionally requires an existing local password.

Completing authenticator enrollment, disabling it, replacing recovery codes, adding a passkey, or removing one increments the account's session version and invalidates existing browser sessions and pending account challenges. The success response tells the client to sign in again. Save displayed recovery codes before navigating away. API/upload credentials remain independent and are not revoked by these changes.

## Routes and JSON shapes

Management mutation bodies require `Content-Type: application/json` and are limited to **64 KiB**, including streamed requests. All successful operations below return `200` JSON with `Cache-Control: no-store`. `proof` means an object with optional `password` and `code` strings; the server decides which fields are required from the account's current state and the session's authentication method. Local password confirmation accepts at most 256 characters; `code` accepts at most 80 characters so it can hold either a six-digit TOTP value or a recovery code. Never put either in a URL.

| Method and path                            | Request body                                                        | Response                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/security`                   | None.                                                               | Status object described below.                                                                                 |
| `POST /api/auth/security/totp/setup`       | `proof`.                                                            | `{ "secret": "…", "uri": "otpauth://…", "challengeId": "…" }`; private setup material for the current account. |
| `POST /api/auth/security/totp/enable`      | `{ "code": "123456", "challengeId": "…" }`.                         | `{ "recoveryCodes": ["…"], "signInAgain": true }`.                                                             |
| `POST /api/auth/security/totp/disable`     | `proof`.                                                            | `{ "signInAgain": true }`.                                                                                     |
| `POST /api/auth/security/recovery-codes`   | `proof`.                                                            | `{ "recoveryCodes": ["…"], "signInAgain": true }`.                                                             |
| `POST /api/auth/security/passkeys/options` | `proof` plus `name`.                                                | `{ "options": { … }, "challengeId": "…" }`; WebAuthn registration options.                                     |
| `POST /api/auth/security/passkeys/verify`  | `{ "challengeId": "…", "response": { … } }`.                        | `{ "signInAgain": true }`.                                                                                     |
| `PATCH /api/auth/security/passkeys/{id}`   | `proof` plus `name`.                                                | `{ "success": true }`; a rename keeps existing sessions.                                                       |
| `DELETE /api/auth/security/passkeys/{id}`  | `proof`, including an empty JSON object when recent proof suffices. | `{ "signInAgain": true }`.                                                                                     |
| `POST /api/auth/passkeys/options`          | No body.                                                            | `{ "options": { … }, "challengeId": "…" }`; WebAuthn authentication options and a browser-binding cookie.      |

Passkey names are trimmed and must contain **1–64 characters**. Each account can register **10 passkeys**. The ID in a passkey URL is the opaque credential ID; encode it as a path segment. An owned credential must exist before rename/removal succeeds.

The status response contains:

```json
{
  "twoFactorEnabled": false,
  "recoveryCodesRemaining": 0,
  "hasPassword": true,
  "passkeys": [],
  "passkeysAvailable": true,
  "canUseRecentPasskey": false,
  "canUseRecentRecovery": false,
  "canUseRecentSso": false
}
```

Each `passkeys` entry contains `id`, `name`, `createdAt`, and nullable `lastUsedAt`. Dates are ISO strings. `passkeysAvailable` reports whether the server's origin configuration supports passkeys; the browser must separately support WebAuthn. `canUseRecentPasskey`, `canUseRecentRecovery`, and `canUseRecentSso` describe whether the session presently supplies recent proof. No setup secret or recovery-code value is returned by this status route.

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
})
```

For a real mutation, use the [demonstrated account controls](/guide/security). A registration client must obtain options, complete `navigator.credentials.create()` through a WebAuthn client, serialize the credential, then submit it to `/api/auth/security/passkeys/verify` with the returned `challengeId`. Passing options or a challenge ID without a verified authenticator response is insufficient.

For password sign-in, the NextAuth `credentials` provider accepts `email`, `password`, and optional `code`. Once the password is correct for a TOTP-enrolled account, omitting `code` reports `TwoFactorRequired`; the first step creates no session. Submit the password again with a current authenticator or unused recovery code to complete sign-in. Throttled password callbacks report `TooManyAttempts`; callback response conventions are managed by NextAuth rather than the JSON security routes above.

Passkey login obtains public authentication options and completes the browser's credential request. The NextAuth `passkey` credentials provider takes `challengeId` and a JSON-serialized `response`; keep the standard NextAuth CSRF flow. The options response sets an HttpOnly, same-site Strict browser-binding cookie at path `/`, expiring after five minutes. HTTPS uses the Secure host-only `__Host-flare-passkey-challenge` cookie; local HTTP development uses `flare-passkey-challenge`. Verification requires the same browser binding. Do not try to turn that browser flow into a named-token endpoint.

### Errors and throttling

Errors contain `{ "error": "…" }` with `Cache-Control: no-store`. Invalid proof, used/expired challenges, invalid enrollment codes, and passkey limits return `400`; missing/revoked sessions or an `Authorization` header return `401`; an incorrect or missing mutation origin returns `403`; an unknown owned passkey returns `404`; oversized requests return `413`; unsupported body content types return `415`; throttled requests return `429`; unavailable canonical-origin configuration returns `503`. A throttled response includes `Retry-After: 900`.

Management is limited to **20 attempts per account per 15 minutes**. Password sign-in is limited to **30 attempts per account** and **100 per IP** per 15 minutes. Public passkey options and passkey sign-in callbacks each have a limit of **100 per IP per 15 minutes**. The limits are shared through PostgreSQL across application replicas. Keep the [proxy's client-IP headers trustworthy](/hosting/reverse-proxy#keep-access-decisions-in-flare).

Expired counter records are pruned by the [background cleanup worker](/hosting/maintenance#authentication-rate-limit-cleanup), independently of authentication requests. Pending cleanup does not extend a counter's 15-minute limit window.

## Authenticator behavior

Flare uses six-digit TOTP codes with a **30-second** period and permits one adjacent time step in each direction. A successful code stores its time counter; that or an earlier counter cannot be redeemed again. Recovery-code consumption is also atomic, so concurrent attempts cannot both use the same code.

Keep the returned setup `challengeId` in memory and send it with the current code when enabling; a session alone cannot confirm a different pending setup. `123456` in the shape above illustrates the six-digit format, not a reusable code. Authenticator setup is pending for **five minutes** and does not enable protection until a correct setup code is confirmed. The setup key is encrypted using AES-256-GCM with a domain-separated key derived from `NEXTAUTH_SECRET`; the email encryption override does not replace this key. [Preserve it during upgrades](/hosting/maintenance#two-factor-authentication-and-passkey-migration).

Enabling protection or replacing recovery codes returns **ten** codes once. The database stores their hashes, bound to the account, rather than recoverable values. Recovery input ignores spaces/hyphens and letter case. Each code can be consumed only once. A successful password-plus-recovery-code sign-in records the server-issued `recovery` authentication method; that session provides fresh security-management proof for five minutes. This allows the last code to restore access and replace the set, disable/re-enroll the authenticator, or add a passkey without needing another code. The browser cannot set or extend this proof through a session update. Replacing the set invalidates unused codes in the previous set; disabling the authenticator removes the set.

## Passkey behavior

Passkeys use WebAuthn registration and authentication with **user verification required**. Flare stores the credential public key, credential ID, counter, and transports. It does not receive the authenticator's private key or biometric data.

Challenges expire after five minutes and are one-use. Registration binds the pending ceremony to the signed-in account and its current session version. Verification checks the expected challenge, origin, relying-party ID, and user verification before publishing a credential or issuing a session. Replaying an accepted response cannot create a second sign-in.

Passkey sign-in is an alternative to password plus TOTP. A TOTP-enrolled account cannot bypass its factor through a password-only callback or a linked OIDC sign-in. SSO-only accounts rely on their identity provider's MFA rather than local TOTP. An independently registered passkey can sign in without consulting the provider again.

## Password and plain email changes

`PUT /api/profile` retains its general profile permissions and response shape, but changing `newPassword` or the plain `email` field also requires a browser session and fresh security proof. An upload credential cannot change either field. Send `currentPassword` and, when TOTP is enabled, `securityCode` with an unused authenticator or recovery code. Recent passkey or recovery-code authentication can satisfy the security-proof check; a password change still requires the current-password field because it changes an existing local password.

A new password must use **8 or more characters** and at most **72 UTF-8 bytes**. A successful password or plain email change increments the session version and invalidates pending email-action tokens; sign in again afterward. It preserves TOTP enrollment, recovery codes, and passkeys. Name/upload-preference changes retain the existing profile behavior.

When account email features are enabled, the plain email field remains rejected; use the separate confirmed email-change flow. Those email routes keep their existing current-password or recent-SSO identity requirements. Email password resets also preserve enrolled factors and invalidate browser sessions. They do not become a way to remove two-factor authentication.

## Compatibility and events

Existing accounts start without authenticator enrollment or passkeys. An old custom login client that sends only a password must handle the second-factor requirement after a user enables TOTP. Use the maintained Flare login UI for the complete sign-in flow, including recovery and browser passkey ceremonies.

Password changes and email password resets do not disable TOTP, replace recovery codes, or remove passkeys. Session revocation ends current sessions without removing the methods that could create a new one. Email verification remains enforced after successful password, authenticator, or passkey sign-in.

The named-token scopes, OpenAPI operations, upload-tool formats, and webhook contracts are unchanged. Security changes do not emit a webhook event; the only documented event remains `file.ready`. Do not repurpose a file webhook as an authentication audit stream.
