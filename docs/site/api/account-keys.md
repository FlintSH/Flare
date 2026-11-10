---
title: Account key and passphrase contracts
description: Browser-session contracts for passphrase sign-in, unlock, key setup, key rotation, the keyring, recovery, and reset.
---

# Account key and passphrase contracts

These routes are the server side of Flare's end-to-end encryption accounts. Each account has an **account record**: two public keys, a salt, and an encrypted root secret that only the account's passphrase opens. The passphrase never reaches the server. A client proves it with a signature instead, and the server answers with ciphertext that the client opens itself.

This page is for people who build or audit a client. The protocol, with every key derivation and byte layout, is the [end-to-end encryption specification](https://github.com/FlintSH/Flare/blob/main/docs/e2ee-spec.md); section numbers below refer to it. The repository's `lib/e2ee` library implements the client side of every procedure, and its test vectors fix the outputs.

::: warning Files are not encrypted yet
This part of the design covers accounts and sign-in only. Uploads, downloads, and sharing still handle plain files. The registration and first-run setup pages of this build still send a password, which those two routes now refuse, and no page calls the routes below yet. The browser flows that use them ship next.
:::

Named API tokens and the legacy upload credential cannot call any route on this page. They are excluded from the named-token [OpenAPI document](/openapi.json) and the request builder.

## What the server stores

| Field              | Size     | The server can read it | Purpose                                                                                   |
| ------------------ | -------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `accountPublicKey` | 32 bytes | Yes                    | Ed25519 public key of the account. Verifies signed requests.                              |
| `passphraseSalt`   | 32 bytes | Yes                    | Random Argon2id salt. The client stretches the passphrase with it.                        |
| `protocolVersion`  | integer  | Yes                    | Always `1`. The Argon2id parameters are fixed for a version and are never sent.           |
| `authPublicKey`    | 32 bytes | Yes                    | Ed25519 public key of the sign-in key pair, which comes from the passphrase.              |
| `wrappedRoot`      | 89 bytes | No                     | The root secret, sealed with a key that comes from the passphrase.                        |
| `sealedKeyring`    | variable | No                     | Old account private keys, sealed with a key of the current account key. Absent or `null`. |

A copy of the database gives nobody a way to sign in: the server holds public keys only. It does let its holder test passphrases offline against `wrappedRoot`, so the strength of the passphrase matters. The client checks that strength; the server cannot.

An account has all of these fields or none of them, and an account that has them has no password hash. The database enforces both rules.

### Encodings

- Every binary value in JSON, and in the two signature headers, is **base64url without padding**. The decoder is strict: padding, characters outside the alphabet, and unused bits are refused.
- `wrappedRoot` and `sealedKeyring` travel and are stored in their **stored form**: one `record_version` byte, `0x01`, followed by the record (section 4.4, rule 12). The client writes that byte, with `encodeStoredRecord` in `lib/e2ee`. The server checks the byte and the length of the record type, never opens the record, and returns the same bytes.
- Both public keys must decode to a point on the curve and have an X25519 form (section 4.1). Other values are refused with `400`.
- A `sealedKeyring` holds between 1 and 64 old keys. An account with no old key has `null`; a sealed empty list is refused.
- **Request bodies are strict.** A field that a route does not read is refused with `400` and `Unrecognized key: "…"`. A client that sends a passphrase, a private key, or any other extra field by mistake therefore fails at once, and the value is never stored or logged.

### The identifier

The identifier of an account is its sign-in email address. Each signature of the sign-in key binds to the identifier in one form: Unicode NFKC, then without leading and trailing characters that have the Unicode property White_Space, then in lower case, as UTF-8 (section 4.4, rule 7). `normalizeIdentifier` in `lib/e2ee` gives that form, and the signing functions apply it. Any spelling with the same form reaches the same account, so ` Alex@Example.COM` and `alex@example.com` sign in the same account with the same signature.

Older instances can hold addresses that differ only in letter case. The account whose stored address matches the typed address exactly then wins, and an identifier that matches none of them exactly names nobody.

## Challenges

Every proof on this page signs a **challenge**: 32 random bytes that the server issued, valid for **60 seconds** and for **one use**. The server deletes a challenge the first time a request presents it, whether or not the proof is valid, so a failed request needs a new challenge. A request that fails validation before the proof is checked, such as one with an unknown field, does not use its challenge up.

A challenge is bound to what issued it and is refused everywhere else:

| Issued by                                | For                                                   | Accepted by                                           |
| ---------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `POST /api/auth/e2ee/challenge`          | The account of an identifier, before sign-in.         | The `passphrase` sign-in only.                        |
| `POST /api/auth/e2ee/session-challenge`  | The account and session version of a browser session. | Unlock, rotation (both proofs), and keyring requests. |
| `POST /api/auth/e2ee/recovery/challenge` | The account of an email reset link.                   | `POST /api/auth/e2ee/recovery` only.                  |

An account can hold several challenges at once. Changing the keys of an account deletes its pending challenges.

## Routes and JSON shapes

Mutation bodies require `Content-Type: application/json` and are limited to **64 KiB**. Every response carries `Cache-Control: no-store`. Mutations must come from Flare's own pages, as every [browser-session write](./authentication#browser-session-writes) must, and every route refuses an `Authorization` header. `account` means an account record object:

```json
{
  "accountPublicKey": "…43 characters…",
  "passphraseSalt": "…43 characters…",
  "protocolVersion": 1,
  "authPublicKey": "…43 characters…",
  "wrappedRoot": "…119 characters…"
}
```

| Method and path                          | Authentication                                                | Request body                                        | Response                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/e2ee/challenge`          | Public.                                                       | `{ "identifier": "…" }`                             | `{ "method": "passphrase", "passphraseSalt", "protocolVersion", "challenge" }`, or `{ "method": "password" }`.         |
| `POST /api/auth/e2ee/session-challenge`  | Session; the account has keys.                                | None; a body is ignored.                            | `{ "challenge", "identifier", "passphraseSalt", "protocolVersion", "accountPublicKey" }`.                              |
| `POST /api/auth/e2ee/unlock`             | Session and an unlock signature.                              | `{ "challenge", "signature" }`                      | `{ "accountPublicKey", "protocolVersion", "wrappedRoot", "sealedKeyring" }`.                                           |
| `GET /api/auth/e2ee/keys`                | Session.                                                      | None.                                               | `{ "hasKeys", "identifier", "protocolVersion", "accountPublicKey", "hasKeyring" }`.                                    |
| `POST /api/auth/e2ee/keys`               | Session from a sign-in in the last five minutes; no keys yet. | `{ "account" }`                                     | `{ "ok": true }`.                                                                                                      |
| `POST /api/auth/e2ee/rotation`           | Session, a signed request, and a passphrase proof.            | `{ "account", "sealedKeyring", "passphraseProof" }` | `{ "ok": true, "signInAgain": true }`.                                                                                 |
| `PUT /api/auth/e2ee/keyring`             | Session and a signed request.                                 | `{ "sealedKeyring" }`                               | `{ "ok": true }`.                                                                                                      |
| `POST /api/auth/e2ee/recovery/challenge` | An email reset link.                                          | `{ "token": "…" }`                                  | `{ "hasKeys": true, "accountPublicKey", "protocolVersion", "sealedKeyring", "challenge" }`, or `{ "hasKeys": false }`. |
| `POST /api/auth/e2ee/recovery`           | An email reset link and a signed request.                     | `{ "token", "account", "sealedKeyring" }`           | `{ "message": "…" }`.                                                                                                  |
| `POST /api/auth/e2ee/reset`              | An email reset link.                                          | `{ "token", "account" }`                            | `{ "message": "…" }`.                                                                                                  |

`sealedKeyring` is a stored-form string or `null`, and the field itself is required wherever it appears. The session routes also work for an account that must still verify its email address, because an account sets up and unlocks its keys before anything else.

### Salt and challenge request

`POST /api/auth/e2ee/challenge` starts a passphrase sign-in (section 6.1). `identifier` holds 1 to 320 characters.

- For an account that has keys, the answer has its real `passphraseSalt` and a new `challenge`.
- For an **unknown identifier**, the answer has the same fields. Its salt is `blake3_keyed_hash(server_secret, identifier)` over the identifier in its normalized form, so the same identifier always gets the same salt, as a real account does. `server_secret` comes from `NEXTAUTH_SECRET` through HKDF with a label of its own; a new `NEXTAUTH_SECRET` gives new fake salts. The server does the same lookup and stores a challenge that no request can ever present with success.
- For an account that has **no keys and a password hash**, the answer is `{ "method": "password" }`: the sign-in page must show the password form. This answer differs from the answer for an unknown identifier, so a person can learn that such an account exists. That is accepted for the migration and stops when the account has keys (section 14.1).
- An account with no keys and no password, which signs in with a passkey or SSO only, answers as an unknown identifier does.

### Passphrase sign-in

Sign-in goes through NextAuth, like the other sign-in methods: the `passphrase` credentials provider, which the browser calls with `signIn('passphrase', …)` or a client posts to `/api/auth/callback/passphrase` with the NextAuth CSRF token.

| Field        | Value                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `identifier` | The address as typed, up to 320 characters.                                                            |
| `challenge`  | The challenge from `POST /api/auth/e2ee/challenge`, as it was returned.                                |
| `signature`  | `Ed25519_sign(auth_private_key, "flare e2ee v1 sign-in" \|\| challenge \|\| blake3_hash(identifier))`. |
| `code`       | Optional authenticator code or authenticator recovery code.                                            |

The server deletes the challenge, verifies the signature with the stored `authPublicKey`, and then applies **the same rules as the password sign-in**, through the same code:

- The same attempt limits, and the same counters: 30 attempts per account and 100 per IP per 15 minutes, counted together with password attempts for the same address.
- An account that requires passkeys answers `PasskeyRequired`.
- An account with an authenticator answers `TwoFactorRequired` when `code` is missing, and only after the signature was valid. The client then requests a **new challenge**, signs it with the keys it already has in memory, and sends the code with the new proof. It does not run Argon2id again.
- Every other failure is the generic `CredentialsSignin`. A failed attempt for a known account is recorded in its [login history](./activity) with the method `passphrase`. The proof is never recorded.

The session's `authMethod` is `passphrase`, or `recovery` when an authenticator recovery code was used.

The session is the only result. **Sign-in returns no key material.** The client unlocks next.

### Unlock

`POST /api/auth/e2ee/unlock` releases `wrappedRoot` and `sealedKeyring` (section 6.3). A client calls it after every sign-in: directly after a passphrase sign-in, with the keys still in memory, and after a passkey or SSO sign-in once the person has typed the passphrase.

1. `POST /api/auth/e2ee/session-challenge` returns a challenge, the `identifier` to sign, and the `passphraseSalt` for a client that must derive the keys first.
2. `signature = Ed25519_sign(auth_private_key, "flare e2ee v1 unlock" || challenge || blake3_hash(identifier))`.
3. `POST /api/auth/e2ee/unlock` with `{ "challenge", "signature" }`.

**A session alone never gets `wrappedRoot`.** A person who steals a session cookie therefore gets nothing to guess the passphrase against. The session itself already passed the account's second factor, which is how the second factor protects the release of the key material.

The sign-in signature and the unlock signature use different context strings. A signature made for one request is refused by the other, also on a fresh challenge. Unlock is limited to **30 attempts per account** and **100 per IP** per 15 minutes.

### Key setup

`POST /api/auth/e2ee/keys` gives keys to a signed-in account that has none (sections 5.4 and 14.1):

- an account from before encryption, directly after it signed in with its password, and
- an account that signs in with a passkey or SSO and now chooses a passphrase.

The session must come from a sign-in within the last **five minutes**, by any method; otherwise the answer is `403` with `code: "recent_sign_in_required"`. The request carries no password. The same update deletes the account's password hash, so password sign-in stops for the account at that moment and `POST /api/auth/e2ee/challenge` answers `passphrase` for it from then on. The session continues, so the client can unlock next. An account that already has keys answers `409` with `code: "keys_exist"`: only a rotation replaces keys.

New accounts never call this route. `POST /api/auth/register` and `POST /api/setup` take the account record in their own body; see [changed account routes](#changed-account-routes).

### Signed requests

Rotation, the keyring update, and recovery are **signed requests** (section 6.6). A signed request adds a proof of the account private key to the session. It never replaces the session and never creates one.

```text
signed_message = "flare e2ee v1 request" || challenge
                 || blake3_hash(method || " " || path)
                 || blake3_hash(body)
signature      = Ed25519_sign(account_private_key, signed_message)
```

Send the two values as headers, in base64url:

| Header                   | Value                              |
| ------------------------ | ---------------------------------- |
| `X-Flare-E2EE-Challenge` | The challenge, as it was returned. |
| `X-Flare-E2EE-Signature` | The 64-byte signature.             |

- `method` is the request method in upper case, for example `POST`.
- `path` is the path and the query string of the request, in the percent-encoded form that the client sends: `pathname + search` of the URL that a browser fetches.
- `body` is the exact bytes of the request body. Sign the bytes that you send; do not serialize the JSON a second time.

The server verifies against the method, the path, and the body bytes that it received. **A reverse proxy must pass the path to Flare unchanged.** A proxy that adds or removes a path prefix, or that decodes and encodes the path again, makes the two sides sign different text, and every signed request then fails with `400`. Flare does not read a forwarded-prefix header to undo such a change, because a client could set that header itself. See [reverse proxy requirements](/hosting/reverse-proxy).

### Rotation and passphrase change

`POST /api/auth/e2ee/rotation` replaces the whole account record (sections 6.7 and 8.3.3). It is also the **only way to change a passphrase**: a passphrase change always makes a new root secret, a new account key, and a new mnemonic.

The session is not enough, and neither proof is enough alone:

1. The request is a [signed request](#signed-requests) with the **old** account key.
2. `passphraseProof` is `{ "challenge", "signature" }`: a **sign-in** signature (`"flare e2ee v1 sign-in"`) with the **old** sign-in key, on its own challenge from `POST /api/auth/e2ee/session-challenge`.

The two proofs need two different challenges. The browser stores the account key, so a person who steals it there can make the first proof. That person has no passphrase, cannot make the second, and so cannot rotate the account and lock its owner out. Both challenges are used up when either proof fails.

`account` must hold a new `accountPublicKey`, a new `authPublicKey`, and a new `passphraseSalt`; a value that the account already has is refused. `sealedKeyring` holds the old account private keys that still open files, sealed for the new account key, or `null`.

On success, in one transaction:

- the account record and the keyring are replaced;
- **every browser session ends, including the one that made the request.** The response says `signInAgain: true`, and the client signs in with the new passphrase. The specification asks for the other sessions to end; Flare ends all of them, because moving the session version on is also what stops a sign-in that verified the old key a moment earlier;
- **every named API token of the account is deleted and its legacy upload token is replaced.** Install new tokens in each script and upload tool;
- pending challenges, unused email links, and a pending email address change are cancelled.

The authenticator, recovery codes, passkeys, and the passkey requirement are not changed. The route is limited to the 20 management attempts per account per 15 minutes, and to 30 rotation attempts per account and 100 per IP.

The request does not yet carry new sealed records for folders and tags. Those arrive with encrypted folders and tags, and until then a body that carries them is refused as an unknown field.

### Keyring update

`PUT /api/auth/e2ee/keyring` stores a new `sealedKeyring`, or `null` to store none, after the client moved the last file off an old key (section 8.3.4, step 5). It is a [signed request](#signed-requests) with the current account key. Nothing else changes: sessions and tokens stay.

### Recovery and reset by email

Both procedures start from the existing email reset link: `POST /api/auth/email/request-reset` sends it under the same policy as before, and an account that signs in with a passphrase is eligible exactly as an account with a password is. The link's `token` is the proof of control of the mailbox.

`POST /api/auth/e2ee/recovery/challenge` reads what a link can do **without using it up**:

- `{ "hasKeys": false }` for an account that still has a password. The client can set a new password with `POST /api/auth/email/reset`, or give the account keys with the reset route below.
- Otherwise the account's `accountPublicKey`, its `sealedKeyring`, and a challenge. The client compares the public key with the one that the mnemonic gives before it sends anything. The answer never has `wrappedRoot`: a person who holds the link and no mnemonic must not get anything to guess the passphrase against. `sealedKeyring` is safe to return, because only the account private key opens it.

**Recovery** (`POST /api/auth/e2ee/recovery`, section 6.8) is for a person who lost the passphrase and has the mnemonic. It is a rotation whose proofs are the email link and a [signed request](#signed-requests) with the account key that the mnemonic gives, on the challenge above. The link replaces the passphrase proof. The result is the result of a rotation, and the keyring continues, so the old files stay readable.

**Reset** (`POST /api/auth/e2ee/reset`, section 6.9) is for a person who lost the passphrase and the mnemonic. The link is the only proof. The account gets a new account record from a new root secret, its keyring is deleted, and every session and token is cancelled as in a rotation. No key of the account opens its old encrypted files after a reset. Plain files are not changed. The route also gives keys to an account that still has a password, and deletes that password hash.

A link is used up only when recovery or reset succeeds, so a refused recovery leaves it for another try. Neither procedure changes the authenticator, the passkeys, or the passkey requirement: after a reset, sign-in still asks for the account's second factor. An account with no password and no keys cannot get keys from a link, as it could never get a password from one. Both routes count against the email request limit for each client address.

## Changed account routes

| Route                                 | Change                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/register`             | Takes `account` in place of `password`: `{ "name", "email", "account", "invite"? }`. The account is created with its keys and no password hash. A body that still carries `password` is refused with `400`.                        |
| `POST /api/setup`                     | `admin` is `{ "name", "email", "account" }`. A body that carries `admin.password` is refused with `400`.                                                                                                                           |
| `POST /api/auth/callback/credentials` | Password sign-in works only for an account that has no keys. After key setup it answers as a wrong password does.                                                                                                                  |
| `PUT /api/profile`                    | `newPassword` answers `409` with `code: "passphrase_account"` for an account that has keys. Use the rotation route.                                                                                                                |
| `PUT /api/users`                      | `password` answers `409` with `code: "passphrase_account"` for an account that has keys. An administrator cannot set a passphrase, because it never reaches the server; the owner resets it by email. Other fields save as before. |
| `POST /api/users`                     | Unchanged. An administrator can still create an account with a temporary password. That account signs in with it and then sets up its keys, which deletes the password.                                                            |
| `POST /api/auth/email/reset`          | Sets a password only for an account that has none of these keys. For an account that has keys it answers `409` with `code: "passphrase_account"` and leaves the link unused, for the recovery and reset routes above.              |
| `GET /api/auth/security`              | Adds `hasPassphrase` and `canUseRecentPassphrase`.                                                                                                                                                                                 |

### Identity proof for accounts that have keys

The [security management routes](./security) and the email enrollment and change routes ask an account with a password to confirm that password. An account that has keys has no password, and its passphrase cannot be sent. For such an account the proof is **a passphrase sign-in within the last five minutes** (a session whose method is `passphrase` or `recovery`), in the same way that a recent SSO sign-in is the proof for an account without a local secret. When the proof is stale the routes answer `400` with `Sign in again with your passphrase, then retry within five minutes.` A security change still uses up an authenticator code when the account has an authenticator. `canUseRecentPassphrase` in `GET /api/auth/security` reports whether the session qualifies now.

With the passkey requirement on, nothing changes: only a recent passkey or dedicated passkey-recovery sign-in satisfies it.

## Errors and throttling

Errors contain `{ "error": "…" }`, some with a machine-readable `code`:

| Status | Meaning                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | An invalid body or an unknown field; an invalid proof or a used or expired challenge (`code: "invalid_proof"` for a passphrase proof); an invalid or expired email link. |
| `401`  | No session, a session that was signed out, or an `Authorization` header.                                                                                                 |
| `403`  | A request from another origin, or key setup without a recent sign-in (`code: "recent_sign_in_required"`).                                                                |
| `409`  | `keys_required`: the account has no keys yet. `keys_exist`: it already has them. `passphrase_account`: a password route was used for an account that has keys.           |
| `413`  | A body over 64 KiB.                                                                                                                                                      |
| `415`  | A body that is not `application/json`.                                                                                                                                   |
| `429`  | An attempt limit; the response has `Retry-After`.                                                                                                                        |
| `500`  | Anything else: `Unable to complete this encryption request. Please try again.` The server logs the cause.                                                                |

A refused proof never says which part was wrong: an unknown challenge, an expired one, a used one, and a wrong signature all read the same.

`POST /api/auth/e2ee/challenge` is limited to **300 requests per IP** per 15 minutes, `POST /api/auth/e2ee/session-challenge` to **120 per account**, and `POST /api/auth/e2ee/recovery/challenge` to **30 per IP**. The limits are shared through PostgreSQL across replicas, like the [other sign-in limits](./security#errors-and-throttling), and requests with no usable client address share one count in each per-IP limit.

## Audit events

Key requests appear in the [audit log](./activity) in the `authentication` category as `auth.keys.unlock`, `auth.keys.setup`, `auth.keys.rotate`, `auth.keys.keyring`, `auth.keys.recover`, and `auth.keys.reset`, with the outcome of the request. The challenge routes and the status route are recorded as ordinary requests. Passphrase sign-ins appear as `auth.login` with the method `passphrase`. Account changes also record which columns changed. No event contains a key, a salt, a signature, a challenge, or a sealed record.

## Upgrading an existing instance

The database migration only adds columns. No account changes until its owner acts:

1. An existing account signs in with its password, as before.
2. The client makes the account record in the browser and calls `POST /api/auth/e2ee/keys` within five minutes of that sign-in.
3. The server deletes the password hash. From then on the account signs in with its passphrase, and every password route refuses it.

An account that signs in with a passkey or SSO sets up its keys the same way, after that sign-in. An account that never comes back keeps its password and has no keys.

Custom clients must change with the server: registration and first-run setup no longer accept a password, and password sign-in stops for each account when it sets up its keys.
