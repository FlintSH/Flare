# Flare End-to-End Encryption Specification

| Field   | Value                                               |
| ------- | --------------------------------------------------- |
| Status  | Draft 9. Not implemented. Not reviewed.             |
| Version | Protocol version 1 (`v1`)                           |
| Author  | Claude Fable 5.2, with assistance from birb         |
| Date    | 2026-11-10                                          |
| Applies | Flare, branch `feat/e2ee`, based on `main` 79a88c22 |

Each section has one of these labels:

- **AGREED**: The design discussion made this decision.
- **PROPOSED**: This text is a proposal. No decision is made.
- **OPEN**: No proposal is complete. Section 13 lists the questions.

Most sections start with three short paragraphs:

- **Goal**: what the section must achieve.
- **Idea**: the method, in one or two sentences.
- **Restriction**: the fact about Flare or about the web that limits the design.

## 1. Introduction

### 1.1 Purpose

This document specifies how Flare encrypts files on the client. The server
stores ciphertext only. The server operator cannot read an encrypted file.

### 1.2 Scope

This document specifies:

- the keys of an account and their derivation,
- the sign-in procedure that keeps the passphrase away from the server,
- the encrypted file format,
- the upload procedure for browsers and for script clients,
- the share link format.

This document does not specify the user interface or the database schema.

### 1.3 Writing rules

This document uses short sentences in the active voice. Each term has one
meaning. Section 2 defines the terms.

The word "must" shows a mandatory requirement. The words "must not" show a
prohibition. The word "can" shows an option.

Procedures are numbered lists. Do the steps in the given sequence. If a step
fails, stop the procedure and reject the input.

Each value has a full name in `snake_case`. The name says what the value is.
This document does not use single-letter names.

### 1.4 Design in one page

1. Each account has one random secret, the `root_entropy`. The user keeps it
   as a list of words (the mnemonic). All account keys come from it.
2. The user types a passphrase. The client stretches the passphrase and
   splits the result into two keys. The `auth_private_key` signs a challenge
   as proof for the server. The `wrap_key` stays in the client and encrypts
   the `root_entropy`.
3. The server keeps the encrypted `root_entropy`. The server releases it only
   after the proof and the second factor are correct.
4. Each file has its own random `file_key`. The client encrypts the file in
   chunks. Each chunk has its own authentication tag.
5. The client encrypts the `file_key` to the public key of the account. The
   result is a stanza. Encryption to a public key needs no secret, thus an
   upload script can do it.
6. A share link carries the `file_key` after the `#` character. The browser
   does not send that part to the server.
7. A user can select a plain upload, for one file or in an upload profile,
   when a file must show its content in a link preview. An encrypted file
   gets a generic preview.

## 2. Terms and notation

### 2.1 Terms

| Term          | Definition                                                            |
| ------------- | --------------------------------------------------------------------- |
| Client        | Software that the user controls: the browser application or a script. |
| Server        | The Flare application, its database and its storage.                  |
| Operator      | The person who administers the server.                                |
| Account       | One Flare user.                                                       |
| Passphrase    | The secret text that the user types to unlock the account keys.       |
| Mnemonic      | A list of words that encodes the `root_entropy` of an account.        |
| Account key   | The Ed25519 key pair of an account.                                   |
| File key      | A random secret key that encrypts one file.                           |
| Stanza        | A small record that contains one file key in encrypted form.          |
| Script client | A non-browser upload tool. Examples: ShareX helper, shell script.     |
| Plain file    | A file that the user uploads without encryption (section 11).         |

### 2.2 Notation

| Notation       | Meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `a \|\| b`     | Concatenation of byte strings `a` and `b`.                  |
| `LE64(n)`      | The integer `n` as 8 bytes, little-endian.                  |
| `length(a)`    | The length of `a` in bytes.                                 |
| `random(n)`    | `n` bytes from a cryptographically secure random generator. |
| `zeros(n)`     | `n` bytes with the value zero.                              |
| `base64url(a)` | Base64url encoding of `a` without padding.                  |

All context strings are ASCII. A context string does not have a terminator.

### 2.3 Names of values

| Name                    | Size     | Meaning                                                               |
| ----------------------- | -------- | --------------------------------------------------------------------- |
| `root_entropy`          | 32 bytes | Root secret of the account. The mnemonic encodes it.                  |
| `account_seed`          | 32 bytes | Seed of the account key pair.                                         |
| `account_private_key`   | 32 bytes | Ed25519 private key of the account.                                   |
| `account_public_key`    | 32 bytes | Ed25519 public key of the account.                                    |
| `exchange_private_key`  | 32 bytes | X25519 form of `account_private_key`.                                 |
| `exchange_public_key`   | 32 bytes | X25519 form of `account_public_key`.                                  |
| `passphrase_salt`       | 32 bytes | Random input to Argon2id. Not secret.                                 |
| `passphrase_root`       | 32 bytes | Output of Argon2id.                                                   |
| `auth_seed`             | 32 bytes | Seed of the sign-in key pair.                                         |
| `auth_private_key`      | 32 bytes | Ed25519 key that proves the passphrase. Never leaves the client.      |
| `auth_public_key`       | 32 bytes | Its public key. The server stores it.                                 |
| `wrap_key`              | 32 bytes | Key that encrypts `root_entropy`. Never leaves the client.            |
| `wrapped_root`          | 88 bytes | `root_entropy` encrypted with `wrap_key`.                             |
| `file_key`              | 32 bytes | Random key of one file.                                               |
| `content_cipher_key`    | 32 bytes | Encrypts the chunks of a file.                                        |
| `content_mac_key`       | 32 bytes | Authenticates the chunks of a file.                                   |
| `metadata_key`          | 32 bytes | Encrypts the name and the type of a file.                             |
| `header_hash`           | 32 bytes | BLAKE3 hash of the file header.                                       |
| `ephemeral_private_key` | 32 bytes | X25519 private key that the sender uses for one stanza.               |
| `ephemeral_public_key`  | 32 bytes | Its public key. It is part of the stanza.                             |
| `shared_secret`         | 32 bytes | Output of X25519.                                                     |
| `stanza_key`            | 32 bytes | Key that encrypts one `file_key` in one stanza.                       |
| `link_secret`           | 32 bytes | Random secret in the share link of a file with a password.            |
| `password_key`          | 32 bytes | Key that encrypts `file_key` in a password stanza.                    |
| `keyring_key`           | 32 bytes | Key that encrypts the list of old account private keys.               |
| `sealed_keyring`        | variable | The encrypted list of old account private keys. The server stores it. |
| `folder_private_key`    | 32 bytes | X25519 private key of one folder. A shared folder link carries it.    |
| `folder_public_key`     | 32 bytes | Its public key. The server stores it.                                 |

## 3. Threat model

**AGREED**

### 3.1 Assumption

The operator is honest at the time of deployment. An attacker can compromise
the server at any later time. The design must limit what the attacker gets.

### 3.2 Security goals

1. A person who reads the database, the storage or a backup cannot read
   encrypted file content.
2. The same person cannot read encrypted metadata (section 9).
3. The server never receives the passphrase.
4. The server never receives an account private key or a file key.
5. A moderator cannot read the encrypted files of a different account.
6. The server cannot change a file that a share link refers to. The client
   detects the change.
7. After a compromise of the passphrase or of an account key, the user can
   rotate the keys. Files that the user uploads after the rotation are safe
   (section 8.3).

### 3.3 Limits

These limits are accepted. The public documentation must state them.

1. **Served code.** The server supplies the browser application. An attacker
   who changes the served code can steal keys. No web application can prevent
   this. Script clients with a pinned public key do not have this limit for
   uploads.
2. **No sender authentication.** A person who knows the account public key can
   create a file that decrypts correctly. The server always knows this key.
   This is deliberate. It gives deniability and it keeps secrets off the
   upload machine. For the same reason, a person who knows
   `folder_public_key` can add a file to the list of a shared folder.
3. **Limited forward secrecy.** The owner must be able to read old files. Thus
   the current account private key opens all current stanzas. Key rotation
   (section 8.3) protects the files that come after it. It cannot protect an
   old file if the attacker has the old key and a copy of the old stanza.
4. **Offline guesses.** A person who has the database has `wrapped_root` and
   `passphrase_salt`. That person can test passphrases offline. Only the
   strength of the passphrase and the cost of Argon2id give protection.
5. **Second factor.** The second factor protects the release of
   `wrapped_root` (section 6). It gives no protection against a database
   copy. It gives no protection against a device that received
   `wrapped_root` before.
6. **Browser storage.** The browser keeps `account_private_key` during a
   session. Code that runs in the page during that session can use the key.
7. **Visible metadata.** The server sees the size of each file, the time of
   each upload and each access, and the network address of each client.

## 4. Primitives

**AGREED**, except where a line shows a different label.

| Primitive | Use                                    | Parameters                                             |
| --------- | -------------------------------------- | ------------------------------------------------------ |
| Ed25519   | Signatures                             | RFC 8032                                               |
| X25519    | Key agreement                          | RFC 7748                                               |
| ed2curve  | Conversion of an Ed25519 key to X25519 | Section 4.1                                            |
| XChaCha20 | Stream cipher                          | 32-byte key, 24-byte nonce                             |
| BLAKE3    | Hash, keyed hash, key derivation       | 32-byte output                                         |
| Argon2id  | Passphrase stretching                  | **PROPOSED**: 64 MiB, 3 passes, 1 lane, 32-byte output |
| BIP39     | Mnemonic encoding                      | **PROPOSED**: 256-bit entropy, 24 words                |

BLAKE3 has three modes. This document names them as follows:

- `blake3_hash(message)`
- `blake3_keyed_hash(key, message)`. The key is 32 bytes.
- `blake3_derive_key(context, key_material)`. The output is 32 bytes.

**Reason for BLAKE3 as the authentication code:** a BLAKE3 tag is
key-committing. One ciphertext cannot be valid under two keys. Poly1305 does
not have this property. The property is necessary when a key comes from a
password (section 8.2).

### 4.1 Key conversion

One Ed25519 key pair serves for signatures and for key agreement.

- `exchange_public_key = ed2curve_public(account_public_key)`
- `exchange_private_key = ed2curve_private(account_private_key)`

If `ed2curve_public` fails, reject the key.

### 4.2 Sealed box construction

**Goal:** encrypt and authenticate one short message, for example a key.

**Idea:** encrypt with XChaCha20, then calculate a keyed BLAKE3 tag of the
ciphertext (encrypt-then-MAC).

`seal(key, nonce, associated_data, message)`:

1. `cipher_key = blake3_derive_key("flare e2ee v1 seal cipher", key)`
2. `mac_key = blake3_derive_key("flare e2ee v1 seal mac", key)`
3. `ciphertext = XChaCha20(cipher_key, nonce, message)`
4. `tag = blake3_keyed_hash(mac_key, LE64(length(associated_data)) || associated_data || nonce || ciphertext)`
5. The output is `nonce || ciphertext || tag`.

`open(key, associated_data, sealed_box)`:

1. Split `sealed_box` into `nonce` (24 bytes), `ciphertext` and `tag`
   (32 bytes).
2. Calculate `cipher_key` and `mac_key` as in `seal`.
3. Calculate `expected_tag` as in step 4 of `seal`.
4. Compare `expected_tag` and `tag` in constant time. If they are different,
   reject.
5. The output is `XChaCha20(cipher_key, nonce, ciphertext)`.

Section 13 contains an open question about the two derived keys.

## 5. Account keys

**AGREED** for the structure. **PROPOSED** for the exact derivation strings.

**Goal:** the user owns keys that the server cannot read, and can get them on
any device with only a passphrase.

**Idea:** one random root secret makes all keys. The passphrase encrypts the
root secret. The server stores the encrypted form.

**Restriction:** Flare sign-in sends the password to the server today. The
passphrase must never reach the server, thus sign-in must change (section 6).

### 5.1 Key hierarchy

```
mnemonic  <->  root_entropy
                 |
                 +-- account_seed = blake3_derive_key("flare e2ee v1 account seed", root_entropy)
                       |
                       +-- (account_private_key, account_public_key) = Ed25519 key pair from account_seed
                             |
                             +-- (exchange_private_key, exchange_public_key) by ed2curve

passphrase + passphrase_salt --Argon2id--> passphrase_root
                                             |
                                             +-- auth_seed = blake3_derive_key("flare e2ee v1 auth", passphrase_root)
                                             |     |
                                             |     +-- (auth_private_key, auth_public_key) = Ed25519 key pair from auth_seed
                                             |
                                             +-- wrap_key = blake3_derive_key("flare e2ee v1 wrap", passphrase_root)
```

- `root_entropy` is the root of the account. The mnemonic is the recovery key.
- `auth_private_key` proves knowledge of the passphrase to the server. It
  signs a challenge. It never leaves the client.
- `wrap_key` encrypts `root_entropy`. `wrap_key` never leaves the client.

**Reason for one Argon2id operation:** two operations make the user wait two
times. An attacker with the database needs only one operation for each guess.

**Reason for a sign-in key pair:** the client cannot use the account key to
sign in, because the account key is inside `wrapped_root`. The proof must
come from the passphrase. A signature sends no value that a person can use
again. The server stores a public key only, thus a copy of the database
gives nothing that a person can present to sign in.

`auth_private_key` and `wrap_key` are independent. A person who has one
cannot calculate the other.

### 5.2 Passphrase rules

Each account must have a passphrase. This rule applies to accounts that sign
in with a passkey or with OIDC too. Those methods give the client no secret
that the server cannot see.

#### 5.2.1 Strength check

The client must measure each new secret with zxcvbn before it uses the
secret. This applies to:

- the passphrase of an account, and
- the password of a file (section 8.2).

The client must reject a secret with a zxcvbn score less than
`minimum_strength_score`. **PROPOSED**: the value is `3`.

The client gives the account identifier and the instance name to zxcvbn as
user inputs. A secret that contains them gets a lower score.

The check occurs only in the client. The server never gets the secret, thus
the server cannot do the check. A client that a person changes can skip the
check. The check protects a user from a weak selection. It is not a security
boundary.

### 5.3 Data that the server stores for each account

| Field                | Content                                                                               | Readable by the server |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `account_public_key` | Account public key                                                                    | Yes                    |
| `passphrase_salt`    | `random(32)`                                                                          | Yes                    |
| `auth_public_key`    | Public key of the sign-in key pair                                                    | Yes                    |
| `wrapped_root`       | `seal(wrap_key, random(24), account_public_key, root_entropy)`                        | No                     |
| `sealed_keyring`     | Old account private keys, encrypted (section 8.3.3). Empty before the first rotation. | No                     |

A person who copies the database gets `wrapped_root` and `auth_public_key`.
That person cannot sign in. That person can test passphrases offline
(section 3.3, limit 4).

### 5.4 Account creation

The client does these steps:

1. `root_entropy = random(32)`.
2. Calculate `account_seed`, `account_private_key` and `account_public_key`.
3. `passphrase_salt = random(32)`.
4. `passphrase_root = Argon2id(passphrase, passphrase_salt)`.
5. Calculate `auth_private_key`, `auth_public_key` and `wrap_key`.
6. `wrapped_root = seal(wrap_key, random(24), account_public_key, root_entropy)`.
7. Send `account_public_key`, `passphrase_salt`, `auth_public_key` and
   `wrapped_root` to the server.
8. Show the mnemonic of `root_entropy` to the user. Tell the user to keep it
   offline.
9. Erase `passphrase_root`, `auth_private_key` and `wrap_key` from memory.

## 6. Sign-in and unlock

**AGREED** for the structure. **PROPOSED** for the message details.

**Goal:** the user gets a server session and the account private key. The
server learns nothing that opens a file.

**Idea:** the client proves the passphrase with a signature from
`auth_private_key`. The server
releases `wrapped_root` only after that proof and the second factor. The
client opens `wrapped_root` with `wrap_key`.

**Restriction:** after the client has the account private key, the server
cannot take it back. Thus the second factor must protect the release of
`wrapped_root`, not only the session.

### 6.1 Salt and challenge request

1. The client sends the account identifier.
2. The server returns `passphrase_salt` and `challenge = random(32)`. The
   challenge is valid for one use and for 60 seconds.

For an unknown identifier, the server must return a fake salt. The fake salt
is `blake3_keyed_hash(server_secret, identifier)`. The response for an
unknown identifier must have the same form and timing as a real response.

### 6.2 Password sign-in

1. The client gets `passphrase_salt` and `challenge` (section 6.1).
2. `passphrase_root = Argon2id(passphrase, passphrase_salt)`.
3. The client calculates `auth_private_key` and `wrap_key`.
4. `sign_in_signature = Ed25519_sign(auth_private_key, "flare e2ee v1 sign-in" || challenge || blake3_hash(identifier))`.
   The client sends the identifier, `challenge`, `sign_in_signature` and the
   second-factor response.
5. The server deletes `challenge`.
6. The server verifies `sign_in_signature` with `auth_public_key`.
7. The server checks the second factor.
8. If steps 6 and 7 pass, the server creates a session and returns
   `wrapped_root`.
9. `root_entropy = open(wrap_key, account_public_key, wrapped_root)`.
10. The client calculates `account_private_key` from `root_entropy`.
11. The client checks that `account_private_key` gives `account_public_key`.
    If not, reject.
12. The client erases the passphrase, `passphrase_root`, `auth_private_key`,
    `wrap_key` and `root_entropy`.

The server must limit the rate of step 4 for each identifier and each address.

### 6.3 Passkey and OIDC sign-in

1. The user signs in with the passkey or OIDC. The server creates a session.
2. The client asks the user for the passphrase.
3. The client does steps 1 to 3 of section 6.2.
4. The client calculates `sign_in_signature` and sends it in the session.
5. The server does steps 5 and 6 of section 6.2.
6. If the check passes, the server returns `wrapped_root`.
7. The client does steps 9 to 12 of section 6.2.

A session alone must not release `wrapped_root`. A person who steals a
session thus cannot start offline guesses.

### 6.4 Key storage in the browser

- The client keeps `account_private_key` in IndexedDB for the life of the
  session. It keeps the old private keys of the keyring in the same way.
- The client deletes it on sign-out and when the session expires.
- The client must not store the passphrase, `passphrase_root`, `wrap_key` or
  `root_entropy`.

**Reason:** the user reads the library all the time, and each read needs the
private key. The more valuable secrets (`root_entropy`, the passphrase) are
necessary only for rare operations.

### 6.5 Operations that need the passphrase again

The client must ask for the passphrase before each of these operations:

- show the mnemonic,
- change the passphrase,
- rotate the keys (section 8.3).

### 6.6 Signed requests

Signed requests are for two purposes only:

- to get a session or a bearer token with the account key, and
- to authorize an operation that changes key material.

Procedure:

1. The client requests a challenge. The server returns
   `challenge = random(32)`. The challenge is valid for one use and for
   60 seconds.
2. `signed_message = "flare e2ee v1 request" || challenge || blake3_hash(method || " " || path) || blake3_hash(body)`.
3. `signature = Ed25519_sign(account_private_key, signed_message)`.
4. The client sends the request with `challenge` and `signature`.
5. The server verifies `signature` with `account_public_key`. The server
   deletes `challenge`.

**Reason for the challenge:** a time window permits a replay in that window.
A challenge for one use does not.

### 6.7 Passphrase change

A passphrase change is always a key rotation (section 8.3). There is no
procedure that changes the passphrase and keeps `root_entropy`.

**Reason:** a person who knew the old passphrase possibly has
`wrapped_root`. That person then has `root_entropy`, and a new passphrase
gives no protection. The user cannot know if this occurred. One procedure
prevents the selection of the wrong one.

Results for the user:

- Each passphrase change gives a new mnemonic. The user must save it.
- Each passphrase change cancels the bearer tokens. The user installs a new
  configuration for each script client (section 8.3.6).

### 6.8 Recovery

Recovery is for a user who lost the passphrase and has the mnemonic.

1. The user proves control of the account to the server. Email reset is one
   method.
2. The user types the mnemonic. The client decodes the old `root_entropy`.
3. The client calculates `account_public_key` from it and compares it with
   the stored one. If they are different, reject.
4. The client does the rotation procedure of section 8.3.3 from step 2. The
   mnemonic replaces the old passphrase as the source of the old keys.

Recovery sets a new passphrase, thus recovery is a key rotation too.

A reset by email or by an administrator restores sign-in only. It must not
restore keys. Without the mnemonic, the encrypted files stay unreadable.

## 7. File encryption

**AGREED** for the structure. **PROPOSED** for the byte layout.

**Goal:** encrypt a file of any size. Permit the read of any part of the file
without the other parts. Detect each change to the file.

**Idea:** one random key for each file. Encrypt in chunks of 64 KiB. Each
chunk has a tag that includes its position.

**Restriction:** video playback and large downloads use HTTP range requests.
One tag for the full file would force a full download before any byte is
safe to use.

### 7.1 File keys

- `file_key = random(32)`. Each file has a different file key.
- `content_cipher_key = blake3_derive_key("flare e2ee v1 content cipher", file_key)`
- `content_mac_key = blake3_derive_key("flare e2ee v1 content mac", file_key)`
- `metadata_key = blake3_derive_key("flare e2ee v1 file metadata", file_key)`

### 7.2 Header

| Field             | Size     | Content                                                                    |
| ----------------- | -------- | -------------------------------------------------------------------------- |
| `magic`           | 8 bytes  | ASCII `FLAREE2E`                                                           |
| `format_version`  | 1 byte   | `0x01`                                                                     |
| `chunk_size_log2` | 1 byte   | `16`. The chunk size is 65536 bytes.                                       |
| `nonce_prefix`    | 16 bytes | `random(16)`                                                               |
| `metadata_length` | 4 bytes  | Length of `sealed_metadata`, little-endian.                                |
| `sealed_metadata` | variable | `seal(metadata_key, random(24), magic \|\| format_version, file_metadata)` |

`file_metadata` is the encrypted metadata of the file (section 9).

`header_hash = blake3_hash(header)` is the hash of all header bytes.

### 7.3 Content

Split the plaintext into chunks of 65536 bytes. The last chunk can be
shorter. An empty file has one chunk of length zero.

For the chunk with the number `chunk_index`, where the first chunk is `0`:

1. `chunk_nonce = nonce_prefix || LE64(chunk_index)`
2. `chunk_ciphertext = XChaCha20(content_cipher_key, chunk_nonce, chunk_plaintext)`
3. `final_flag = 0x01` if the chunk is the last one. If not, `final_flag = 0x00`.
4. `chunk_tag = blake3_keyed_hash(content_mac_key, header_hash || LE64(chunk_index) || final_flag || chunk_ciphertext)`
5. The stored chunk is `chunk_ciphertext || chunk_tag`.

The encrypted file is the header and then all stored chunks in sequence.

**Reason for one nonce for each chunk:** each chunk is an independent cipher
operation. The format does not depend on the block counter of the cipher,
which has a limit of 256 GiB in the common variant.

### 7.4 Decryption

1. Read the header. Check `magic`, `format_version` and `chunk_size_log2`.
2. Calculate `header_hash`.
3. For each chunk, calculate the tag and compare it in constant time.
4. Do not release the plaintext of a chunk before its tag is correct.
5. The last stored chunk must have `final_flag = 0x01`. If not, reject the
   file.
6. A chunk that is not the last one must have exactly 65536 bytes.

### 7.5 Properties

- `chunk_index` in the tag prevents a change of sequence.
- `final_flag` prevents truncation.
- `header_hash` in the tag prevents the move of a chunk to a different file.
- A client can read one chunk without the others. The stored chunk starts at
  offset `length(header) + chunk_index * 65568`.

## 8. Stanzas

**Goal:** give the file key to each party that can read the file, and to no
other party.

**Idea:** the file content is encrypted one time with `file_key`. Each
recipient gets a small encrypted copy of `file_key`. A new recipient or a new
account key needs a new stanza only. The file content does not change.

### 8.1 Account stanza

**AGREED**

This stanza gives the file key to the owner of the account. The sender needs
only `account_public_key`. The sender needs no secret.

Wrap:

1. `exchange_public_key = ed2curve_public(account_public_key)`
2. Make an X25519 key pair
   `(ephemeral_private_key, ephemeral_public_key)`.
3. `shared_secret = X25519(ephemeral_private_key, exchange_public_key)`.
   If `shared_secret = zeros(32)`, reject.
4. `stanza_key = blake3_derive_key("flare e2ee v1 account stanza", shared_secret || ephemeral_public_key || exchange_public_key)`
5. `wrapped_file_key = seal(stanza_key, zeros(24), header_hash, file_key)`
6. The stanza is `ephemeral_public_key || wrapped_file_key`.
7. Erase `ephemeral_private_key`, `shared_secret` and `stanza_key`.

The nonce is zero because `stanza_key` encrypts one message only.

Unwrap:

1. `shared_secret = X25519(exchange_private_key, ephemeral_public_key)`.
   If `shared_secret = zeros(32)`, reject.
2. Calculate `stanza_key` as in step 4 of the wrap procedure.
3. `file_key = open(stanza_key, header_hash, wrapped_file_key)`

### 8.2 Password stanza

**AGREED** for the structure. **PROPOSED** for the exact strings.

**Goal:** replace the file password. Today the server compares the password.
A compromised server could ignore that comparison.

**Idea:** the password and a secret in the link make a key together. That
key encrypts `file_key`. The key derivation includes the public key of the
owner and the hash of the file header.

**Restriction:** a person selects a password, thus a password is weak. The
server stores the stanza. If the password alone made the key, a person with
the database could test passwords offline. The secret in the link prevents
this, because the server never gets it.

Wrap:

1. `password_salt = random(32)`
2. `link_secret = random(32)`
3. `owner_public_key` = the `account_public_key` of the owner at this time.
4. `stretched_password = Argon2id(password, password_salt)`
5. `password_key = blake3_derive_key("flare e2ee v1 password stanza", stretched_password || link_secret || owner_public_key || header_hash)`
6. `wrapped_file_key = seal(password_key, zeros(24), header_hash, file_key)`
7. `link_secret_key = blake3_derive_key("flare e2ee v1 link secret copy", file_key)`
8. `sealed_link_secret = seal(link_secret_key, zeros(24), header_hash, link_secret)`
9. The stanza is `password_salt || owner_public_key || wrapped_file_key || sealed_link_secret`.
10. The share link carries `link_secret` (section 10.3).

Unwrap:

1. The client reads `link_secret` from the link.
2. The client reads `password_salt` and `owner_public_key` from the stanza.
3. The recipient types the password.
4. The client calculates `password_key` as in steps 4 and 5 of the wrap
   procedure.
5. `file_key = open(password_key, header_hash, wrapped_file_key)`

Properties:

- A person who has the link and not the password cannot read the file.
- A person who has the password and not the link cannot read the file.
- The server has neither, and cannot test passwords offline.
- `owner_public_key` and `header_hash` in the derivation bind the stanza to
  one owner key and one file. A stanza does not open with a different file.
  This is a binding to the context. It does not prove who made the stanza
  (section 3.3, limit 2).

The owner reads the file through the account stanza. The owner does not need
the password.

**Reason for `sealed_link_secret`:** the owner has `file_key`, thus the owner
can open `sealed_link_secret` and show the share link again. Without it, the
owner could not get the link back after the upload.

**Key rotation and password stanzas:** a rotation does not change a password
stanza. The owner does not have the password, thus the owner cannot make the
stanza again. The stanza records `owner_public_key`, thus it continues to
open after the account key changes. The share link and the password stay
valid.

### 8.3 Key rotation

**AGREED** for the goal and the structure. **PROPOSED** for the steps.

**Goal:** after a compromise, the user can change the secrets, and the files
that the user uploads from then on are safe.

**Idea:** a rotation replaces `root_entropy`. All account keys come from
`root_entropy`, thus all of them change. The client makes new stanzas for
the old files, and the server deletes the old stanzas.

**Restriction:** a person who knows the passphrase and gets `wrapped_root`
has `root_entropy`. That person can calculate each key that comes from it. A
new key from the same `root_entropy` gives no protection. Only a new
`root_entropy` does.

#### 8.3.1 One procedure

Three operations use the rotation procedure:

- a passphrase change (section 6.7),
- recovery with the mnemonic (section 6.8),
- a rotation that the user requests.

No operation changes the passphrase without a rotation.

#### 8.3.2 When the user must rotate

- A different person knows the passphrase.
- A different person saw the mnemonic.
- A device with an open session is lost, or malicious code ran in a session.
- A person copied the database, and the passphrase is possibly weak.

#### 8.3.3 Rotation procedure

**Goal:** the time of a rotation must not depend on the number of files. An
account can have tens of thousands of files.

**Idea:** the rotation keeps the old account private keys in an encrypted
list, the `sealed_keyring`. The old stanzas stay valid. A later task moves
the stanzas to the new key (section 8.3.4).

1. The client asks for the passphrase and gets the old `root_entropy` and
   the old `account_private_key` (section 6.2). In recovery, the mnemonic
   gives them (section 6.8).
2. The client asks for a new passphrase. The strength check of section 5.2.1
   applies. The new passphrase must be different from the old one.
3. The client makes a new `root_entropy`, a new account key pair, a new
   `passphrase_salt`, a new `auth_public_key`, a new `wrap_key` and a new
   `wrapped_root` (section 5.4).
4. `keyring_key = blake3_derive_key("flare e2ee v1 keyring", new root_entropy)`
5. `sealed_keyring = seal(keyring_key, random(24), new account_public_key, old_private_keys)`.
   `old_private_keys` is the list of all old account private keys that still
   have stanzas. It includes the keys of the old keyring.
6. The client sends the new account data and `sealed_keyring` in a request
   that is signed with the old account key (section 6.6).
7. The server replaces the account data. The server deletes the old
   `wrapped_root` and the old `sealed_keyring`.
8. The server cancels all other sessions and all bearer tokens of the
   account.
9. The client shows the new mnemonic. The user must save it. The old
   mnemonic does not open the account after this step.

The server returns `sealed_keyring` together with `wrapped_root` at sign-in.
The client opens it and keeps the old private keys with the current one
(section 6.4).

The work of a rotation is constant. It does not depend on the number of
files. From step 7, each new upload uses the new public key.

#### 8.3.4 Stanza migration

After a rotation, the old stanzas are still for the old keys. A person who
has an old key and gets a later copy of the database could read those files.
The migration removes this risk. It is a background task of the client.

Each account stanza records the `account_public_key` that it is for.

1. The client requests a batch of account stanzas that are for an old key.
2. For each stanza: the client opens it with the old key and makes a new
   account stanza for the current public key (section 8.1).
3. The client sends the batch. The server replaces the old stanzas.
4. The client does steps 1 to 3 again until no stanza is for the old key.
5. The client makes a new `sealed_keyring` without that old key and sends it.
   The client must have `root_entropy` for this step. Thus it occurs at the
   next sign-in.

The migration can stop at any time and continue in a later session. The file
content does not change. The cost for each file is two X25519 operations and
about 100 bytes.

The migration does not touch password stanzas (section 8.2).

The migration also makes a new `owner_folder_stanza` for each folder
(section 8.4.2). The key pairs of the folders do not change.

#### 8.3.5 What rotation gives and does not give

| Attacker has before the rotation                          | Result                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| The passphrase only                                       | Reads nothing.                                        |
| The old keys                                              | Does not read files that come after the rotation.     |
| The old keys, and a copy of the database after migration  | Reads nothing. The old stanzas are deleted.           |
| The old keys, and a copy of the database before migration | Reads the old files that are not migrated.            |
| The old keys and a copy of the old stanzas                | Reads the old files. Does not read new files.         |
| A share link                                              | Reads that file. Rotation does not change `file_key`. |

To protect an old file from an attacker who has its old stanza, the client
must encrypt the file again with a new `file_key`. This breaks the share
links of that file. This document does not specify it. See section 13.

#### 8.3.6 Script clients after a rotation

A script client has the old `account_public_key` in its configuration
(section 10.2). After a rotation:

- The server rejects an upload with a stanza for the old key.
- The server cancels the bearer token (step 8 of section 8.3.3).
- The user installs a new configuration for each script client.

A rotation is a rare operation after a compromise. Thus a new configuration
is acceptable. No separate signing key is necessary, and one Ed25519 key
pair continues to serve both purposes (section 4.1).

### 8.4 Folder keys and folder stanzas

**AGREED** for the structure. **PROPOSED** for the exact strings.

**Goal:** a person who has the link of a shared folder can read the files in
that folder and in all folders below it. Files that arrive later become
readable without a new link.

**Idea:** each folder has an X25519 key pair. A file key is encrypted to the
public key of its folder. The private key of a folder is encrypted to the
public key of its parent folder. The share link carries the private key of
one folder. That key opens the folder and each folder below it.

**Restriction:** a script client has no secret (section 10.2). It must be
able to put a file in a folder. Thus the operation must need a public key
only.

#### 8.4.1 Public-key wrap

The procedure of section 8.1 encrypts a secret to an X25519 public key. This
section uses the same procedure with three parameters:

`public_wrap(recipient_public_key, context, associated_data, secret)`:

1. Make an X25519 key pair
   `(ephemeral_private_key, ephemeral_public_key)`.
2. `shared_secret = X25519(ephemeral_private_key, recipient_public_key)`.
   If `shared_secret = zeros(32)`, reject.
3. `stanza_key = blake3_derive_key(context, shared_secret || ephemeral_public_key || recipient_public_key)`
4. The output is `ephemeral_public_key || seal(stanza_key, zeros(24), associated_data, secret)`.

`public_unwrap` is the reverse operation with the private key of the
recipient.

The account stanza of section 8.1 is
`public_wrap(exchange_public_key, "flare e2ee v1 account stanza", header_hash, file_key)`.

#### 8.4.2 Folder keys

When the client creates a folder:

1. Make an X25519 key pair `(folder_private_key, folder_public_key)`.
2. `folder_metadata_key = blake3_derive_key("flare e2ee v1 folder metadata", folder_private_key)`
3. `sealed_folder_metadata = seal(folder_metadata_key, random(24), folder_public_key, folder_metadata)`.
   `folder_metadata` is a JSON object with the field `name`.
4. `owner_folder_stanza = public_wrap(exchange_public_key, "flare e2ee v1 owner folder stanza", folder_public_key, folder_private_key)`
5. If the folder has a parent:
   `parent_folder_stanza = public_wrap(parent folder_public_key, "flare e2ee v1 parent folder stanza", folder_public_key, folder_private_key)`
6. Send `folder_public_key`, `sealed_folder_metadata` and the stanzas to the
   server.

The key pair of a folder does not come from the key pair of its parent. A
person who has the key of a folder cannot calculate the key of a folder
above it.

#### 8.4.3 Folder stanza of a file

When a file with public visibility is in a folder, the file has a folder
stanza:

`folder_file_stanza = public_wrap(folder_public_key, "flare e2ee v1 folder file stanza", header_hash, file_key)`

A file with private visibility must not have a folder stanza. A shared
folder does not show private files.

A file with a password stanza (section 8.2) does not get a folder stanza for
`file_key`. It gets this stanza:

`folder_link_secret_stanza = public_wrap(folder_public_key, "flare e2ee v1 folder link secret stanza", header_hash, link_secret)`

A visitor of the shared folder then has `link_secret`. The visitor must
type the password to read the file.

#### 8.4.4 Who can open what

| Person has                    | Can open                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| The account private key       | Each folder, through `owner_folder_stanza`.                          |
| The private key of one folder | The name of that folder, its public files, and each folder below it. |
| The private key of one folder | Not the folders above it. Not its private files.                     |
| Only `folder_public_key`      | Nothing. That person can add a file to the folder.                   |

## 9. Metadata

**PROPOSED**. The authors have not confirmed this section.

**Goal:** the server must not learn what a file is from its name or type.

**Idea:** put the name and the type in the encrypted file header. Leave only
the values that the server needs for its work.

**Restriction:** the file name is in the URL, the storage path, the audit
records and the database today. The server searches and sorts by name.

### 9.1 Encrypted metadata

`file_metadata` in the file header is a JSON object with these fields:

| Field  | Content            |
| ------ | ------------------ |
| `name` | The file name      |
| `type` | The full MIME type |

A person who has `file_key` can read `file_metadata`. The server cannot.

### 9.2 Metadata that stays visible to the server

- the size of the ciphertext,
- the upload time and the expiry time,
- the visibility setting,
- the owner,
- the view count and the download count,
- the identifiers of the folder and of the tags.

### 9.3 Results

- The file name is not in the URL or in the storage path.
- The server cannot search file names. The client decrypts the names and
  searches them locally.
- The server cannot sort by name. The client sorts.
- Tag rules that use the file name run in the client at upload time.
- Audit records, expiry events and webhooks contain the file identifier only.
- The `file.ready` webhook needs a new schema version.

### 9.4 Folders

**AGREED** for the structure. **PROPOSED** for the exact steps.

A folder is not a container. It is a record in the database. A file has a
reference to at most one folder. A folder has a reference to at most one
parent folder. These references stay visible to the server. The server
needs them to list a folder.

#### 9.4.1 What the server sees

- which file is in which folder,
- which folder is the parent of which folder,
- `folder_public_key` of each folder,
- if a folder is shared.

The server does not see the name of a folder.

#### 9.4.2 Names

The name is in `sealed_folder_metadata` (section 8.4.2). The server cannot
compare names. Thus the server cannot reject two folders with the same name
in one parent. The client does this check. Two folders with the same name
can exist if two clients create them at the same time. This causes no
damage.

#### 9.4.3 Shared folder link

```
https://{host}/s/folders/{share_token}#{base64url(folder_private_key)}
```

- `share_token` is a random value that the server makes, as today. The
  server gives the list of the folder only to a request with the token.
- The part after `#` is the private key of the folder. The server does not
  get it.
- The shared folder shows its public files and all folders below it, with
  their public files. This is a change. Today a shared folder shows only its
  direct files. The project owner confirmed that the old behaviour was not
  intentional.

Procedure for the visitor:

1. The client requests the list with `share_token`. The server returns
   `sealed_folder_metadata`, the folder stanzas of the files, and the
   `parent_folder_stanza` of each folder directly below.
2. The client opens the name and each file key with `folder_private_key`.
3. For a folder below, the client opens `parent_folder_stanza` and gets the
   private key of that folder. Then it does this procedure for that folder.

#### 9.4.4 Operations of the owner

| Operation              | What the client does                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| Put a file in a folder | Make a folder stanza for the new folder. Delete the old folder stanza.        |
| Make a file private    | Delete its folder stanza.                                                     |
| Make a file public     | Make its folder stanza.                                                       |
| Rename a folder        | Make a new `sealed_folder_metadata`.                                          |
| Delete a folder        | Its files and folders move up one level. Make new stanzas for the new parent. |
| Rotate the account key | Make new `owner_folder_stanza` values in the migration (section 8.3.4).       |

A script client that puts files in a folder has `folder_public_key` of that
folder in its configuration, together with `account_public_key`.

#### 9.4.5 Stop sharing

When the owner stops sharing a folder:

1. The server deletes `share_token`. The old link gives no list.
2. The client makes a new key pair for the folder and for each folder below
   it.
3. The client makes new stanzas for these folders and their files.

Step 1 has an immediate effect if the server is honest. Steps 2 and 3
protect the files that arrive later, also if the server is compromised.

**What stop sharing does not do.** A visitor of a shared folder gets the
`file_key` and the file identifier of each file in the list. These two
values are the same as the share link of that file (section 10.3). Thus a
visitor has a share link for each file that was in the folder at that time.

Stop sharing changes the keys of the folder. It does not change the
`file_key` of a file. If the file stays public, the old visitor can open it
with its own link.

This is the same as today. Today a visitor of a shared folder sees the
public address of each file, and that address continues to work after the
owner stops sharing the folder.

To remove the access of an old visitor to one file, the owner must make the
file private or delete it.

The work of steps 2 and 3 increases with the number of files and folders
below the folder.

#### 9.4.6 Decisions

- A shared folder link always includes the folders below it. No link shows
  a folder without them.
- Each public file in a folder has a folder stanza, also when the folder is
  not shared. The owner can then share the folder with no work for each
  file, and a script client does not need to know if a folder is shared.

### 9.5 Tags and OCR

**OPEN**. See section 13.

## 10. Upload and share links

### 10.1 Upload from the browser

**AGREED**

1. Make `file_key`.
2. Build the header (section 7.2).
3. Encrypt the content (section 7.3).
4. Make an account stanza for the account of the user (section 8.1).
5. Send the encrypted file and the stanza to the server.
6. The server returns the file identifier.

### 10.2 Upload from a script client

**AGREED**

**Goal:** screenshot tools must continue to work. They are a primary use of
Flare.

**Idea:** encryption to a public key needs no secret. The script has the
public key of the account and a bearer token.

A script client has two values in its configuration:

- a bearer token, and
- `account_public_key`.

The script client has no private key.

The application writes `account_public_key` into the configuration when the
user creates it. The script client must not get the key from the server
without verification. A compromised server could give a different key.

The procedure is the same as section 10.1. The bearer token authorizes
step 5.

### 10.3 Share link

**PROPOSED**

A file without a password:

```
https://{host}/{user}/{file_id}#{base64url(file_key)}
```

A file with a password (section 8.2):

```
https://{host}/{user}/{file_id}#p.{base64url(link_secret)}
```

The prefix `p.` tells the client that the secret is a `link_secret` and that
it must ask for the password.

- The browser does not send the part after `#` to the server.
- The uploading client makes the link. It knows the secret and it gets
  `file_id` from the server.
- A person who has the link (and the password, if there is one) can read the
  file until the file is deleted.
- Account key rotation does not change `file_key`. Share links continue to
  work after a rotation.
- A link without the part after `#` cannot open an encrypted file.

### 10.4 Limit for declarative upload tools

A ShareX custom uploader file is a declarative HTTP description. It cannot
encrypt. It cannot add `file_key` to the URL that it copies. A helper program
must do the encryption, the upload and the copy of the link.

## 11. Plain files and link previews

**AGREED**

**Goal:** keep link previews on other sites for users who want them. Keep
share links useful for encrypted files too.

**Restriction:** a crawler does not run the client and does not get the part
of the URL after `#`. To show the content, the server must give the content
to the crawler. Thus the content of an encrypted file cannot be in a link
preview. No design can change this.

### 11.1 Encryption is the default

- A new file is encrypted unless the user selects a plain upload.
- The server marks each plain file. The application shows the mark.
- Link previews with content, server OCR and server archive tools operate
  only on plain files.

### 11.2 Where the user selects a plain upload

1. **For one file**, in the upload dialog.
2. **In an upload profile.** An upload profile has the setting
   `encryption`, with the value `encrypted` or `plain`. The default is
   `encrypted`.

A bearer token can be bound to an upload profile. Thus a user can have one
token that encrypts and one token that does not. Example: a screenshot tool
configuration for chat messages uses a `plain` profile, and a second
configuration for private files uses an `encrypted` profile.

The client reads the setting and acts on it. The server cannot encrypt. The
server must reject an encrypted upload to a `plain` profile, and a plain
upload to an `encrypted` profile. This prevents a plain upload by mistake
from a wrong configuration.

### 11.3 Link preview of an encrypted file

A share link of an encrypted file gives a generic preview. The preview tells
the reader to open the link to see the file.

The server makes the preview from values that it has:

| Preview field | Content                                                   |
| ------------- | --------------------------------------------------------- |
| Site name     | The name of the instance.                                 |
| Title         | A fixed text. Example: "Encrypted file".                  |
| Description   | A fixed text. Example: "Open the link to view this file." |
| Image         | A fixed image of the instance. Not the file.              |

The preview must not contain the file name or the type of the file. The
server does not have them (section 9).

The server must not redirect a crawler to the content of an encrypted file.
Today the server redirects known crawlers to the raw file.

### 11.4 What the user must be told

- The upload dialog and the upload profile settings must say that an
  encrypted file has a generic preview only.
- The application must show which files are plain.

## 12. Requirements for the server and the application

**PROPOSED**

1. The application must send a Content-Security-Policy that blocks inline
   scripts and scripts from other origins.
2. The "Custom head" setting must not accept `script` or `base` elements.
3. The server must not write a file key or a share link fragment
   to a log, an audit record, a webhook or a URL query.
4. A moderator permission must not give access to encrypted content.
5. The legacy upload token is stored without a hash today. The server must
   store a hash only.

## 13. Open questions

1. **Folders.** Closed. See section 9.4.
2. **Tags.** Do tag names get encryption under a key of the account?
3. **OCR.** Does OCR move to the client? Where does the encrypted text go, and
   how does search use it?
4. **One key or two in `seal`.** This draft derives separate cipher and MAC
   keys. One shared key has no known attack with XChaCha20 and BLAKE3. The
   separate keys agree with the standard encrypt-then-MAC proof.
5. **Size.** Does the format pad the content to hide the exact size?
6. **Argon2id parameters.** 64 MiB and 3 passes are a first proposal. They
   must work in a browser on a slow device.
7. **Old files after a rotation.** Does the client encrypt old files again
   with new file keys? Which share links break?
8. **Automatic rotation.** This draft has no automatic rotation. Is a
   rotation after a number of uploads necessary?
9. **Existing accounts.** Sign-in sends the password to the server today. How
   does an existing account move to section 6.2?
10. **Existing files.** Do old plain files stay plain, or does the client
    encrypt them after the user gets keys?
11. **Thumbnails.** Does the client make an encrypted thumbnail at upload
    time?
12. **Archives and export.** Do these move to the client for encrypted files?
13. **Public upload links.** An unmerged feature lets other persons upload to
    an account. Section 10.2 fits this use. The design must confirm it.
14. **Script helper.** Which language and distribution does the helper of
    section 10.4 use?

## 14. Change log

| Draft | Date       | Change                                                                                                                                                                                        |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 2026-11-10 | First draft.                                                                                                                                                                                  |
| 1     | 2026-11-10 | Full names for all values. Goal, idea and restriction for each section. One-page design summary. Account key rotation with generations.                                                       |
| 2     | 2026-11-10 | Sign-in uses a signature from a passphrase-derived key pair. The bearer `auth_key` and `auth_verifier` are removed.                                                                           |
| 3     | 2026-11-10 | Password stanza needs a secret from the link and binds to the owner key and the file. Strength check with zxcvbn for each passphrase and password.                                            |
| 4     | 2026-11-10 | Key rotation replaces `root_entropy`. Key generations and the separate signing key proposal are removed.                                                                                      |
| 5     | 2026-11-10 | A passphrase change and recovery are always a key rotation.                                                                                                                                   |
| 6     | 2026-11-10 | Rotation is constant time with a keyring of old keys and a background stanza migration. Password stanzas record the owner key and survive a rotation. The owner can get a password link back. |
| 7     | 2026-11-10 | Folders: a key pair for each folder, stanzas from a folder to its files and to the folders below it, shared folder links that include the folders below.                                      |
| 8     | 2026-11-10 | Folder decisions closed. Clear statement of what stop sharing does not do.                                                                                                                    |
| 9     | 2026-11-10 | Plain uploads in upload profiles. Generic link preview for encrypted files.                                                                                                                   |
