# Flare End-to-End Encryption Specification

| Field   | Value                                               |
| ------- | --------------------------------------------------- |
| Status  | Draft 23. Phases 1 to 6 implemented. Not reviewed.  |
| Version | Protocol version 1 (`v1`)                           |
| Author  | Claude Fable 5.2, with assistance from birb         |
| Date    | 2026-11-10                                          |
| Applies | Flare, branch `feat/e2ee`, based on `main` 79a88c22 |

Each section has one of these labels:

- **AGREED**: The design discussion made this decision.
- **PROPOSED**: This text is a proposal. No decision is made.
- **OPEN**: No proposal is complete. Section 15 lists the questions.

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
- the share link format,
- folders, tags, search and the other functions that use file content,
- the migration of an existing instance.

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

### 1.5 Protocol versions

**AGREED**

**Goal:** the project can change a primitive, a parameter or a format later.
Old files must stay readable. A client must never guess which rules apply.

This document specifies protocol version 1.

#### 1.5.1 Where the version is

| Place                         | How the version is recorded                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| Each context string           | The text `v1`, for example `"flare e2ee v1 account stanza"`.          |
| The file header               | `format_version` (section 7.2).                                       |
| Each stanza and sealed record | One byte `record_version` before the record. The value is `0x01`.     |
| The account record            | `protocol_version` (section 5.3).                                     |
| A share link                  | The prefix before the first `.` in the part after `#` (section 10.3). |
| A script client configuration | `protocol_version`.                                                   |

`record_version` and `protocol_version` are not secret and are not
authenticated by themselves. They tell the client which rules to use. The
context string is part of each key derivation, thus a record of one version
does not open with the rules of a different version. A person who changes
the version byte causes a failure only.

#### 1.5.2 Rules for a client

1. A client writes only the newest version that it knows.
2. A client must be able to read each version that was released.
3. A client that finds a version that it does not know must stop and tell
   the user to update. It must not try a different version.
4. A client uses only the Argon2id parameters of its protocol version
   (section 4.3). The server does not send parameters. A compromised server
   thus cannot make the test of passphrases easier.

#### 1.5.3 Rules for a new version

1. A new version uses new context strings, for example `"flare e2ee v2 ..."`.
2. A new version gets a new `format_version`, `record_version` or link
   prefix where the format changes.
3. Existing files are not changed. An account moves to a new version at a
   key rotation (section 8.3), because a rotation makes each account record
   again.
4. A change of the Argon2id parameters needs a new protocol version.
5. The server tells a script client which versions it accepts. The server
   can reject uploads of a version that is retired.

## 2. Terms and notation

### 2.1 Terms

| Term          | Definition                                                                               |
| ------------- | ---------------------------------------------------------------------------------------- |
| Client        | Software that the user controls: the browser application or a script.                    |
| Server        | The Flare application, its database and its storage.                                     |
| Operator      | The person who administers the server.                                                   |
| Account       | One Flare user.                                                                          |
| Passphrase    | The secret text that the user types to unlock the account keys.                          |
| Mnemonic      | A list of words that encodes the `root_entropy` of an account.                           |
| Account key   | The Ed25519 key pair of an account.                                                      |
| File key      | A random secret key that encrypts one file.                                              |
| Stanza        | A small record that contains one key or one secret in encrypted form, for one recipient. |
| Script client | A non-browser upload tool. Examples: ShareX helper, shell script.                        |
| Plain file    | A file that the user uploads without encryption (section 11).                            |

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
| `folder_owner_key`      | 32 bytes | Key of the owner that encrypts the private key of each folder.        |
| `tag_key`               | 32 bytes | Key of the owner that encrypts the name and the rule of each tag.     |
| `ocr_text_key`          | 32 bytes | Encrypts the text that the recognition found in one image.            |
| `thumbnail_key`         | 32 bytes | Encrypts the thumbnail of one file.                                   |

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
4. The server never receives an account private key. The server never
   receives the file key of a file that a client encrypted. The one exception
   is the migration of section 14.2, where the server encrypts a file that it
   has as plaintext already.
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
   this. The "Custom head" setting of an administrator is served code too
   (section 13.1). Script clients with a pinned public key do not have this
   limit for uploads.
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
6. **Browser storage.** The browser keeps `account_private_key` and the old
   private keys of the keyring during a session. Code that runs in the page
   during that session can use these keys. The keys are in the storage of
   the browser on the disk of the device. If a session ends while the
   application is not open, the keys stay there until the application is
   opened again and deletes them (draft 23, from the security review).
7. **Visible metadata.** The server sees the size of each file, the time of
   each upload and each access, and the network address of each client.
8. **Hidden and old records.** A compromised server can hide a file. It can
   give an old version of a name, a tag, a folder list or a stanza. The
   client cannot detect this. The server cannot make a false record that the
   owner encrypted with a secret key.

## 4. Primitives

**AGREED**, except where a line shows a different label.

| Primitive | Use                                    | Parameters                                                     |
| --------- | -------------------------------------- | -------------------------------------------------------------- |
| Ed25519   | Signatures                             | RFC 8032                                                       |
| X25519    | Key agreement                          | RFC 7748                                                       |
| ed2curve  | Conversion of an Ed25519 key to X25519 | Section 4.1                                                    |
| XChaCha20 | Stream cipher                          | 32-byte key, 24-byte nonce                                     |
| BLAKE3    | Hash, keyed hash, key derivation       | 32-byte output                                                 |
| Argon2id  | Passphrase stretching                  | 64 MiB memory, 3 passes, 4 lanes, 32-byte output (section 4.3) |
| BIP39     | Mnemonic encoding                      | 256-bit entropy, 24 words                                      |

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

A `sealed_box` that has less than 56 bytes is not valid. Reject it.

#### 4.2.1 Sealed box for a key that is used one time

A stanza key encrypts one message only. For such a key, the nonce is not a
random value and is not part of the output.

`seal_once(key, associated_data, message)`:

1. `nonce = the first 24 bytes of blake3_derive_key("flare e2ee v1 one-time nonce", key)`
2. `sealed_box = seal(key, nonce, associated_data, message)`
3. The output is `sealed_box` without its first 24 bytes: `ciphertext || tag`.

`open_once(key, associated_data, sealed_once_box)`:

1. Calculate `nonce` as in step 1 of `seal_once`.
2. The output is `open(key, associated_data, nonce || sealed_once_box)`.

A `sealed_once_box` that has less than 32 bytes is not valid. Reject it.

**Reason:** the nonce comes from the key, as in HPKE. The record has one
valid form only, and it is 24 bytes shorter. A reader has no nonce to
examine. The security depends on a key that is not used again. This is the
same condition as for a fixed nonce. A caller must never use `seal_once`
two times with one key.

**Reason for two derived keys:** one key for both operations has no known
attack with XChaCha20 and BLAKE3. Two keys agree with the standard proof of
encrypt-then-MAC, and they cost one more derivation.

### 4.3 Argon2id parameters

**AGREED**

RFC 9106 gives two recommended parameter sets for Argon2id:

| Set    | Memory | Passes | Lanes | Use                                |
| ------ | ------ | ------ | ----- | ---------------------------------- |
| First  | 2 GiB  | 1      | 4     | A computer with much memory        |
| Second | 64 MiB | 3      | 4     | An environment with a memory limit |

This document uses the second set. A browser on a phone cannot supply 2 GiB.

The salt is 32 bytes. RFC 9106 recommends 16 bytes for these sets. A longer
salt is permitted.

These parameters are fixed for protocol version 1. They apply to the
passphrase of an account and to the password of a file. No record stores
them and no party can select different values. Different parameters need a
new protocol version (section 1.5.3).

A browser without threads calculates the 4 lanes one after the other. The
result is the same. The time is longer. The implementation must measure the
time on a slow phone before the release. If the time is not acceptable, the
authors must change this section before the release of version 1.

### 4.4 Encodings

**PROPOSED**. These rules remove each ambiguity that an implementation
would otherwise decide by itself. Two implementations that obey them give
the same bytes.

1. **Ed25519 private key.** `account_private_key` is the 32-byte seed of
   RFC 8032. It is the same value as `account_seed`. `auth_private_key` is
   the same value as `auth_seed`. Each derivation from a private key uses
   these 32 bytes.
2. **`ed2curve_private`.** Calculate SHA-512 of the seed. Take the first 32
   bytes. Clamp them as RFC 7748 specifies for X25519.
3. **`ed2curve_public`.** Decode the Edwards point as RFC 8032 specifies.
   Reject a `y` that is not less than `2^255 - 19`, and a `y` that has no
   `x`. The X25519 public key is `u = (1 + y) / (1 - y)` in the field, as 32
   bytes little-endian. If `y = 1`, fail.
   3a. **X25519 public key.** A public key is valid only in its canonical form:
   the value is less than `2^255 - 19` and the highest bit of the last byte
   is zero. Reject each other form. This applies to `ephemeral_public_key`,
   `folder_public_key` and each `recipient_public_key`.
   3b. **X25519 private key.** A private key is 32 random bytes as they are.
   The X25519 function clamps them. `folder_private_key` is stored, sealed
   and put in a link in this form, without clamping.
4. **XChaCha20.** The block counter starts at `0`.
5. **Passphrase and file password.** Normalize the text with Unicode NFKC.
   Encode it as UTF-8. Do not remove spaces.
6. **Argon2id.** Version `0x13`. No secret value. No associated data. The
   output has 32 bytes. Memory is in units of KiB: 64 MiB is `65536`.
7. **Account identifier.** Normalize with Unicode NFKC. Remove the
   characters with the Unicode property White_Space at the start and the
   end. This is not the same set as the `trim` function of JavaScript. Change to lower case with the default Unicode mapping, without a
   locale. Encode as UTF-8. Each place that uses the identifier uses this
   form: the signatures of sections 6.2 and 6.3 and the fake salt of
   section 6.1.
8. **Signed request.** `method` is one or more of the letters `A` to `Z`. A
   verifier rejects each other form. `path` is the path and the query of the request line,
   in the percent-encoded form that the client sends. The server must use
   the request line as it arrived, before a proxy or a base path changes it.
   The server cannot see a change that a proxy made before the request
   arrived. Thus a proxy must not change the path, and the server must not
   take the path from a request header.
   `body` is the bytes of the request body. For a request without a body, use
   `blake3_hash` of the empty byte string.
9. **JSON records.** `file_metadata`, `folder_metadata` and `tag_metadata`
   are UTF-8 JSON. A field that is absent and a field with the value `null`
   both mean "no value". `ocr_text` is UTF-8 text without normalization. The reader accepts each valid JSON object. The writer
   does not have to use a canonical form, because the reader never compares
   the bytes.
10. **Mnemonic.** BIP39 with the English word list. 32 bytes of entropy give
    24 words. The writer gives lower case words with one space between them.
    The reader accepts upper case and more than one space.
11. **List of old private keys.** `old_private_keys` in `sealed_keyring` is
    the concatenation of the 32-byte seeds, newest first. An account with no
    old key has no `sealed_keyring`. A client must not store a sealed empty
    list. A reader rejects a sealed empty list.
12. **`record_version`.** Each stanza and each sealed value that the server
    stores is `0x01 || record`. This includes `wrapped_root`,
    `sealed_keyring`, `sealed_metadata`, `sealed_ocr_text`,
    `sealed_thumbnail`, `sealed_tag_metadata`, `sealed_folder_metadata`,
    `sealed_folder_private_key` and each stanza. The byte is not an input of
    `seal` or of `public_wrap`. The client adds the byte before it sends a
    record. The server stores the record as it arrives. The sizes in section 2.3 do not include it.
13. **Unicode version.** NFKC and the lower case mapping depend on the
    Unicode version of the program. Two programs with different versions can
    give different bytes for a character that Unicode added recently. This
    document does not fix a version. It is a known limit.
14. **Text form.** Where a value is in JSON or in a URL, it is base64url
    without padding. Test vectors use lower case hexadecimal.

### 4.5 Test vectors

The file `lib/e2ee/vectors/v1.json` contains test vectors for each
procedure of this document. Each vector gives each random input, thus the
output is fixed. A separate reference program made the vectors from this
document. Each implementation must give the same outputs.

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
`minimum_strength_score`. The value is `3`.

The client gives the account identifier and the instance name to zxcvbn as
user inputs. A secret that contains them gets a lower score.

The check occurs only in the client. The server never gets the secret, thus
the server cannot do the check. A client that a person changes can skip the
check. The check protects a user from a weak selection. It is not a security
boundary.

### 5.3 Data that the server stores for each account

| Field                | Content                                                                                    | Readable by the server |
| -------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| `account_public_key` | Account public key                                                                         | Yes                    |
| `passphrase_salt`    | `random(32)`                                                                               | Yes                    |
| `protocol_version`   | The protocol version of the account record                                                 | Yes                    |
| `auth_public_key`    | Public key of the sign-in key pair                                                         | Yes                    |
| `wrapped_root`       | `seal(wrap_key, random(24), account_public_key, root_entropy)`                             | No                     |
| `sealed_keyring`     | Old account private keys, encrypted (section 8.3.3). Absent if the account has no old key. | No                     |

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
7. Send `account_public_key`, `passphrase_salt`, `protocol_version`,
   `auth_public_key` and `wrapped_root` to the server.
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
2. The server returns `passphrase_salt`, `protocol_version` and
   `challenge = random(32)`. The challenge is valid for one use and for
   60 seconds.

For an unknown identifier, the server must return a fake salt. The fake salt
is `blake3_keyed_hash(server_secret, identifier)`, with the identifier in
the form of section 4.4, rule 7. The response for an
unknown identifier must have the same form and timing as a real response.

### 6.2 Passphrase sign-in

Sign-in has two requests. The first creates the session. The second
releases the key material. Each request has its own challenge.

1. The client gets `passphrase_salt` and `challenge` (section 6.1).
2. `passphrase_root = Argon2id(passphrase, passphrase_salt)`.
3. The client calculates `auth_private_key` and `wrap_key`.
4. `sign_in_signature = Ed25519_sign(auth_private_key, "flare e2ee v1 sign-in" || challenge || blake3_hash(identifier))`.
   The client sends the identifier, `challenge`, `sign_in_signature` and the
   second-factor response.
5. The server deletes `challenge`.
6. The server verifies `sign_in_signature` with `auth_public_key`.
7. The server checks the second factor.
8. If steps 6 and 7 pass, the server creates a session.
9. The client does the unlock procedure of section 6.3 from step 3. It uses
   the `auth_private_key` and the `wrap_key` that it has in memory. It does
   not calculate Argon2id again.

The server deletes the challenge at the first use, also when the second
factor is missing or wrong. The client then requests a new challenge and
signs again. It uses the keys that it has in memory.

The server must limit the rate of step 4 for each identifier and each address.

### 6.3 Unlock

Unlock gives the key material to a client that has a session. A client does
it after a passphrase sign-in, and after a sign-in with a passkey or OIDC.

1. After a sign-in with a passkey or OIDC, the client asks the user for the
   passphrase.
2. The client does steps 1 to 3 of section 6.2, if it does not have the
   keys in memory.
3. The client requests a new `challenge` (section 6.1).
4. `unlock_signature = Ed25519_sign(auth_private_key, "flare e2ee v1 unlock" || challenge || blake3_hash(identifier))`.
   The client sends `challenge` and `unlock_signature` in the session.
5. The server deletes `challenge` and verifies `unlock_signature` with
   `auth_public_key`.
6. If the check passes, the server returns `wrapped_root` and
   `sealed_keyring`.
7. `root_entropy = open(wrap_key, account_public_key, wrapped_root)`.
8. The client calculates `account_private_key` from `root_entropy`.
9. The client checks that `account_private_key` gives `account_public_key`.
   If not, reject.
10. The client erases the passphrase, `passphrase_root`, `auth_private_key`,
    `wrap_key` and `root_entropy`.

A session alone must not release `wrapped_root`. A person who steals a
session thus cannot start offline guesses.

In step 4, the identifier is the one that the server stores for the
account. The server gives it to the client together with the challenge.

The sign-in signature and the unlock signature have different context
strings. A signature for one request is not valid for the other.

The server must limit the rate of step 4 for each account and each address.

### 6.4 Key storage in the browser

- The client keeps `account_private_key` in IndexedDB for the life of the
  session. It keeps the old private keys of the keyring in the same way.
- The client deletes these keys on sign-out and when the session expires.
- The client must not store the passphrase, `passphrase_root`, `wrap_key` or
  `root_entropy`.

**Reason:** the user reads the library all the time, and each read needs the
private key. The more valuable secrets (`root_entropy`, the passphrase) are
necessary only for rare operations.

### 6.5 Operations that need the passphrase again

The client must ask for the passphrase before each of these operations:

- show the mnemonic,
- change the passphrase or rotate the keys. These are one operation
  (section 8.3).

### 6.6 Signed requests

A signed request authorizes an operation that changes key material. It is
an addition to the session. It does not replace the session.

A signed request must not create a session or a bearer token. The browser
stores the account private key. A person who steals it must not be able to
sign in without the passphrase and without the second factor. No client in
this document needs such a sign-in.

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

### 6.9 Reset without the mnemonic

**AGREED**

This procedure is for a user who lost the passphrase and the mnemonic. It
is also the only thing that a reset by email or by an administrator can do.

1. The user proves control of the account to the server. Email reset is one
   method.
2. The client does the account creation of section 5.4 with a new
   passphrase. The account gets a new `root_entropy` and new keys.
3. The server replaces the account data. No signature with the old account
   key is possible, thus the server accepts the request after step 1 only.
4. The server deletes `sealed_keyring`, cancels all sessions and all bearer
   tokens, and marks each encrypted file of the account as unreadable.
5. The application tells the user that the old encrypted files cannot be
   opened. The user can delete them. Plain files are not changed.

A person who controls the email of the user can do this procedure. That
person gets the account and its plain files. That person cannot read an
encrypted file. An administrator cannot set a passphrase for a user, because
the passphrase never reaches the server.

Share links of the old encrypted files continue to work. They do not depend
on the account key.

**PROPOSED.** The old account key sealed each `sealed_folder_private_key`
and each `sealed_tag_metadata`. A reset loses them. In step 4 the server
also does this for each folder that has keys and for each tag that has a
sealed record: it deletes the keys, the sealed records and the stanzas, and
it stores a placeholder name. It deletes the `share_token` of such a folder,
because the key in the old link opens nothing that the new owner key can
continue. The folder keeps its files and its place in the tree. The browser
of the owner makes new keys at the next unlock (section 9.4.7).

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

| Field             | Size     | Content                              |
| ----------------- | -------- | ------------------------------------ |
| `magic`           | 8 bytes  | ASCII `FLAREE2E`                     |
| `format_version`  | 1 byte   | `0x01`                               |
| `chunk_size_log2` | 1 byte   | `16`. The chunk size is 65536 bytes. |
| `nonce_prefix`    | 16 bytes | `random(16)`                         |

The header has 26 bytes. It does not change after the upload.

`header_hash = blake3_hash(header)` is the hash of the 26 header bytes.

**Reason for a header without the file name:** `header_hash` is in each
chunk tag and in each stanza. If the name were in the header, a new name
would need a new tag for each chunk and a new stanza for each recipient.
The name is in a separate record (section 9.1).

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
7. No data must follow the last chunk. If data follows, reject the file.
8. A last chunk of length zero is valid only if it is chunk `0`, thus only
   for an empty file. Reject it in each other position. Each plaintext then
   has one valid encrypted form.
9. `chunk_size_log2` must be `16`. Reject each other value.

A reader that works as a stream releases each chunk after its tag is
correct. It can find a truncation only when it reaches the end. Thus a
program must not use the output as a complete file before the reader
verified the last chunk. A read of a byte range proves nothing about the
end of the file, unless the range contains the last chunk.

### 7.5 Properties

- `chunk_index` in the tag prevents a change of sequence.
- `final_flag` prevents truncation.
- `header_hash` in the tag prevents the move of a chunk to a different file.
- A client can read one chunk without the others. The stored chunk starts at
  offset `26 + chunk_index * 65568`.

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
5. `wrapped_file_key = seal_once(stanza_key, header_hash, file_key)`
6. The stanza is `ephemeral_public_key || wrapped_file_key`. It has 96 bytes.
7. Erase `ephemeral_private_key`, `shared_secret` and `stanza_key`.

`stanza_key` encrypts one message only, thus the stanza uses `seal_once`
(section 4.2.1) and contains no nonce.

Unwrap:

1. Reject an `ephemeral_public_key` that is not canonical (section 4.4,
   rule 3a).
2. `shared_secret = X25519(exchange_private_key, ephemeral_public_key)`.
   If `shared_secret = zeros(32)`, reject.
3. Calculate `stanza_key` as in step 4 of the wrap procedure. The client
   calculates `exchange_public_key` from its private key.
4. `file_key = open_once(stanza_key, header_hash, wrapped_file_key)`

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
4. `stretched_password = Argon2id(password, password_salt)`, with the fixed
   parameters of section 4.3.
5. `password_key = blake3_derive_key("flare e2ee v1 password stanza", stretched_password || link_secret || owner_public_key || header_hash)`
6. `wrapped_file_key = seal_once(password_key, header_hash, file_key)`
7. `link_secret_key = blake3_derive_key("flare e2ee v1 link secret copy", file_key)`
8. `sealed_link_secret = seal(link_secret_key, random(24), header_hash, link_secret)`
9. The stanza is `password_salt || owner_public_key || wrapped_file_key || sealed_link_secret`.
10. The share link carries `link_secret` (section 10.3).

Unwrap:

1. The client reads `link_secret` from the link.
2. The client reads `password_salt` and `owner_public_key` from the stanza.
3. The recipient types the password.
4. The client calculates `password_key` as in steps 4 and 5 of the wrap
   procedure.
5. `file_key = open_once(password_key, header_hash, wrapped_file_key)`

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

A password does not change `file_key`. If the owner adds a password after
a link without a password was given to a person, that person still has
`file_key` and can read the file. The application must tell the owner this.
To stop that person, the owner must delete the file and upload it again.

The owner can change the password. The client then makes a new
`link_secret` and a new stanza, and the old link stops. `link_secret_key`
does not change, thus `sealed_link_secret` must have a random nonce. A zero
nonce would use one key and one nonce for two different secrets.

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
`root_entropy`, thus all of them change. The old private keys stay in an
encrypted list until a background task moves each old stanza to the new key.

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
   the old `account_private_key` (sections 6.2 and 6.3). In recovery, the mnemonic
   gives them (section 6.8).
2. The client asks for a new passphrase. The strength check of section 5.2.1
   applies. The new passphrase must be different from the old one.
3. The client makes a new `root_entropy`, a new account key pair, a new
   `passphrase_salt`, a new `auth_public_key`, a new `wrap_key` and a new
   `wrapped_root` (section 5.4).
4. `keyring_key = blake3_derive_key("flare e2ee v1 keyring", new account_private_key)`
5. `sealed_keyring = seal(keyring_key, random(24), new account_public_key, old_private_keys)`.
   `old_private_keys` is the list of all old account private keys that still
   have stanzas. It includes the keys of the old keyring.
6. The client sends the new account data and `sealed_keyring` in a request
   that has two proofs:
   - a signature with the old account key (section 6.6), and
   - a `sign_in_signature` with the old `auth_private_key` on a new
     challenge (section 6.2). In recovery, the proof of section 6.8, step 1,
     replaces this signature.
7. The server replaces the account data. The server deletes the old
   `wrapped_root` and the old `sealed_keyring`.
8. The server cancels all sessions and all bearer tokens of the account.
   This includes the session that made the request. The user signs in again
   with the new passphrase.
9. The client shows the new mnemonic. The user must save it. The old
   mnemonic does not open the account after this step.

In step 6, the client also sends a new `sealed_tag_metadata` for each tag
(section 9.5.5) and a new `sealed_folder_private_key` for each folder
(section 8.4.2).

**Reason for two proofs:** the browser stores the account private key. A
person who steals it from the browser must not be able to rotate the account
and lock the owner out. That person does not have the passphrase.

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
3. The client sends the batch. The server replaces the old stanzas. It
   replaces only a stanza that is for an old key (**PROPOSED**, draft 23):
   a request that replaced a stanza for the current key could only destroy
   a file key.
4. The client does steps 1 to 3 again until no stanza is for the old key.
5. The client makes a new `sealed_keyring` without that old key and sends it
   in a signed request (section 6.6).

The migration can stop at any time and continue in a later session. The file
content does not change. The cost for each file is two X25519 operations and
about 100 bytes.

The migration does not touch password stanzas (section 8.2).

The rotation request already contains the new `sealed_folder_private_key`
of each folder (section 8.3.3).

**PROPOSED** (draft 23, from the security review). The old account key
opened the private key of each folder, and a folder key opens each public
file and each folder that the owner adds to that folder later. Thus the
key pairs of folders change after a rotation:

1. In the rotation, the server marks each folder that no shared folder link
   opens. A link opens the folder that it shares and each folder below it.
2. The client of the owner gives each marked folder a new key pair, with
   the procedure of section 9.4.5, steps 2 and 3. This is a background
   task, as the stanza migration is.
3. A folder that a link opens keeps its key pair. Each person who has the
   link has that key, and a new key pair would break the link. To change
   the key of such a folder, the owner stops the sharing (section 9.4.5).

Drafts before 23 said that the key pairs of the folders do not change.

#### 8.3.5 What rotation gives and does not give

| Attacker has before the rotation                          | Result                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| The passphrase only                                       | Reads nothing.                                        |
| The old keys                                              | Does not read files that come after the rotation.     |
| The old keys, and a copy of the database after migration  | Reads only what a shared folder link opens (below).   |
| The old keys, and a copy of the database before migration | Reads the old files that are not migrated.            |
| The old keys and a copy of the old stanzas                | Reads the old files. Does not read new files.         |
| A share link                                              | Reads that file. Rotation does not change `file_key`. |

**PROPOSED** (draft 23). The old account key opened the key of each
folder. After the folder migration of section 8.3.4, the old keys open only
the folders that a shared folder link opens, and the public files in them,
as each person who has that link does. The owner stops the sharing to
change those keys. The third row of the table was "Reads nothing" in
drafts before 23, which was not correct for folders.

To protect an old file from an attacker who has its old stanza, a client
would have to encrypt the file again with a new `file_key`. This document
does not include that operation. It would break the share links of the file,
and it adds little. The behaviour is the same as before encryption: a person
who copied a file keeps the copy.

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

1. Reject a `recipient_public_key` that is not canonical (section 4.4,
   rule 3a).
2. Make an X25519 key pair
   `(ephemeral_private_key, ephemeral_public_key)`.
3. `shared_secret = X25519(ephemeral_private_key, recipient_public_key)`.
   If `shared_secret = zeros(32)`, reject.
4. `stanza_key = blake3_derive_key(context, shared_secret || ephemeral_public_key || recipient_public_key)`
5. The output is `ephemeral_public_key || seal_once(stanza_key, associated_data, secret)`.

`public_unwrap(recipient_private_key, context, associated_data, stanza)`:

1. Reject an `ephemeral_public_key` that is not canonical.
2. Calculate `recipient_public_key` from `recipient_private_key`.
3. `shared_secret = X25519(recipient_private_key, ephemeral_public_key)`.
   If `shared_secret = zeros(32)`, reject.
4. Calculate `stanza_key` as in step 4 of `public_wrap`.
5. The output is `open_once(stanza_key, associated_data, sealed part of the stanza)`.

Each call of `public_wrap` makes a new ephemeral key pair. A caller must
not use one ephemeral key pair for two stanzas.

The account stanza of section 8.1 is
`public_wrap(exchange_public_key, "flare e2ee v1 account stanza", header_hash, file_key)`.

#### 8.4.2 Folder keys

When the client creates a folder:

1. Make an X25519 key pair `(folder_private_key, folder_public_key)`.
2. `folder_metadata_key = blake3_derive_key("flare e2ee v1 folder metadata", folder_private_key)`
3. `sealed_folder_metadata = seal(folder_metadata_key, random(24), folder_public_key, folder_metadata)`.
   `folder_metadata` is a JSON object with the field `name`.
4. `folder_owner_key = blake3_derive_key("flare e2ee v1 folder owner", account_private_key)`
   `sealed_folder_private_key = seal(folder_owner_key, random(24), folder_public_key, folder_private_key)`
5. If the folder has a parent:
   `parent_folder_stanza = public_wrap(parent folder_public_key, "flare e2ee v1 parent folder stanza", folder_public_key, folder_private_key)`
6. Send `folder_public_key`, `sealed_folder_metadata`,
   `sealed_folder_private_key` and the stanza to the server.

**Reason for a secret key in step 4:** a public-key wrap has no sender
authentication. If the copy of the owner were a public-key wrap, a
compromised server could replace it with a wrap of a key pair that the
server made. The owner would then encrypt file keys to the key of the
server. Only the owner creates folders, thus a secret key of the owner can
protect this copy.

The client of the owner must get `folder_public_key` from
`folder_private_key`. It must not use the copy that the server gives.

A client that opens `sealed_folder_private_key` or a
`parent_folder_stanza` must calculate the public key from the private key
that it got. If the result is not the `folder_public_key` of the record,
reject.

The key pair of a folder does not come from the key pair of its parent. A
person who has the key of a folder cannot calculate the key of a folder
above it.

#### 8.4.3 Folder stanza of a file

When a file with public visibility is in a folder, the file has a folder
stanza:

`folder_file_stanza = public_wrap(folder_public_key, "flare e2ee v1 folder file stanza", header_hash, file_key)`

A file with private visibility must not have a folder stanza. A shared
folder does not show private files. The server must reject a folder stanza
in the upload of a private file, and must delete the folder stanza when a
file becomes private.

A file with a password stanza (section 8.2) does not get a folder stanza for
`file_key`. It gets this stanza:

`folder_link_secret_stanza = public_wrap(folder_public_key, "flare e2ee v1 folder link secret stanza", header_hash, link_secret)`

A visitor of the shared folder then has `link_secret`. The visitor must
type the password to read the file.

**PROPOSED.** A folder stanza can be wrong for the file that it comes with:
the file is private, the file is in no folder, or the stanza is for a
`folder_public_key` that the folder no longer has (section 9.4.5).

- A browser of the owner gets an error and sends the upload again with the
  current key.
- A script client has only the `folder_public_key` of its configuration. It
  cannot make a new stanza. The server stores its file without the folder
  stanza. The browser of the owner makes the stanza later (section 9.4.7).

A stanza for an old key opens nothing, thus the server loses no data when
it does not store that stanza.

#### 8.4.4 Who can open what

| Person has                    | Can open                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| The account private key       | Each folder, through `sealed_folder_private_key`.                    |
| The private key of one folder | The name of that folder, its public files, and each folder below it. |
| The private key of one folder | Not the folders above it. Not its private files.                     |
| Only `folder_public_key`      | Nothing. That person can add a file to the folder.                   |

## 9. Metadata

**AGREED**

**Goal:** the server must not learn what a file is from its name or type.

**Idea:** encrypt the name and the type with a key from `file_key`. Leave
visible only the values that the server needs for its work.

**Restriction:** the file name is in the URL, the storage path, the audit
records and the database today. The server searches and sorts by name.

### 9.1 Encrypted metadata

`file_metadata` is a JSON object with these fields:

| Field  | Content            |
| ------ | ------------------ |
| `name` | The file name      |
| `type` | The full MIME type |

`sealed_metadata = seal(metadata_key, random(24), header_hash, file_metadata)`

A person who has `file_key` can read `file_metadata`. The server cannot.

`sealed_metadata` is not part of the stored file. The server keeps it in
the database, together with a copy of the 26-byte header. The server sends
both in each list of files. The client needs the header to calculate
`header_hash`, and it needs `header_hash` to open a stanza and
`sealed_metadata`.

The server must accept a `sealed_metadata` only:

- in the upload request of the file, or
- from a session of the owner.

Results:

- The owner can change the name of a file with a new `sealed_metadata`. The
  content and the stanzas do not change. Flare has no rename function today.
  This format permits one.
- A stored file does not contain its name. A person who restores a file
  from the storage only, without the database, gets a file without a name.

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
- Tag rules run in a client that can read the file name (section 9.7).
- Audit records and expiry events contain the file identifier and no name.
- The `file.ready` webhook has a new version without the name (section 12.7).

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

**PROPOSED.** The part after `#` has no prefix in protocol version 1. A `.`
in that part shows the prefix of a later version, as in section 10.3. The
address of a folder below the shared folder has the identifier of that
folder as a query parameter. The part after `#` stays the private key of the
shared folder.

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
| Rotate the account key | Make a new `sealed_folder_private_key` for each folder (section 8.3.3).       |

A script client that puts files in a folder has `folder_public_key` of that
folder in its configuration, together with `account_public_key`. After the
owner stops sharing the folder (section 9.4.5), that key is old. The server
rejects a stanza for an old folder key, and the user installs a new
configuration.

A moderator can change the visibility of a file of a different account. A
moderator has no keys.

**PROPOSED** (draft 23, from the security review). A moderator can make an
encrypted file private. A moderator cannot make an encrypted file public:
the server refuses the request. The browser of the owner makes a folder
stanza for each public file in a folder (section 9.4.7), and that stanza
gives the file to each person who has a link to the folder. Thus a
moderator who made a private file public would give it to those persons,
and to itself if it has the link. Only the owner publishes an encrypted
file (section 13, requirement 4).

#### 9.4.5 Stop sharing

When the owner stops sharing a folder:

1. The server deletes `share_token`. The old link gives no list.
2. The client makes a new key pair for the folder and for each folder below
   it.
3. The client makes new stanzas for these folders and their files.

Step 1 has an immediate effect if the server is honest. Steps 2 and 3
protect the files that arrive later against a server that becomes
compromised after step 2 is done.

**PROPOSED** (draft 23, from the security review). Steps 2 and 3 do not
protect against a server that is compromised at the time of step 1. The
client starts step 2 when the server lists the folder (section 9.4.7). A
compromised server can leave the folder out of the list, or give the old
`folder_public_key` and the old `sealed_folder_private_key` again, which
the account key still opens. The owner then continues to encrypt for the
old key. Drafts before 23 claimed more. Section 15, question 3, is about a
record that would let the client detect this.

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

**PROPOSED.** In step 1 the server marks the folder and each folder below
it. A marked folder gives no stanza to a visitor and accepts one new key
pair. When the server stores the new key pair, it deletes the mark and each
stanza that was for the old `folder_public_key`. The server refuses a new
`share_token` for a folder that has the mark. Thus a new link exists only
after step 2 is done for that folder.

#### 9.4.6 Decisions

- A shared folder link always includes the folders below it. No link shows
  a folder without them.
- Each public file in a folder has a folder stanza, also when the folder is
  not shared. The owner can then share the folder with no work for each
  file, and a script client does not need to know if a folder is shared.

#### 9.4.7 Records that the browser of the owner makes later

**PROPOSED**

Some changes leave a folder or a file without a record that only the owner
can make:

- A folder from before encryption has no key pair.
- A folder whose sharing stopped waits for a new key pair (section 9.4.5).
- A folder got a new parent, or its parent got a new key pair. Its
  `parent_folder_stanza` is for a key that the parent does not have.
- A public file is in a folder and has no folder stanza for the current
  `folder_public_key`. A moderator, the expiry of a file, a script client
  without the folder key and a move by a client that stopped can cause this.

The server stores for each stanza the public key that it is for. Thus the
server can list these cases without a key. The browser of the owner
requests the list when the account is unlocked and after each such change.
It makes the records and sends them. The server accepts a stanza only for
the key that the folder has at that time.

For a folder from before encryption, the browser makes the key pair and
`sealed_folder_metadata` from the plain name. The server deletes the plain
name when it stores them. The browser does the same for a tag from before
encryption (section 9.5.2). In the same operation the server deletes the
plain name from the audit records that it wrote before, and it writes no
name into the audit record of the operation itself. Copies of the database
from before that time keep the name.

**Limit** (draft 23, from the security review). The browser makes these
records from a list that the server gives. The browser cannot check that
list. A server that is compromised and that knows the private key of one
folder can list a private file as a public file of that folder, or list a
folder as a folder below it. The browser then makes a stanza that gives the
file key or the folder key to each person who has that folder key. The
attacker does not need to change the served code for this, so this is more
than limit 1 of section 3.3. Section 15, question 3, is about the fix.

### 9.5 Tags

**AGREED** for the structure. **PROPOSED** for the exact strings.

**Goal:** the server must not learn the names of tags or the text of tag
rules. The filter by tag must continue to work.

**Idea:** the reference from a file to a tag stays visible, as for folders.
The name and the rule of a tag are encrypted with a key that only the owner
has.

**Restriction:** a tag can have an automatic rule. Example: "add this tag if
the file name contains `invoice`". Only a client that can read the rule and
the file name can apply it. The server cannot. A script client cannot,
because it has no key that opens the rules.

#### 9.5.1 Tag key

`tag_key = blake3_derive_key("flare e2ee v1 tag metadata", account_private_key)`

Tags are not shared. Thus a tag needs no key pair and no stanza.

#### 9.5.2 Tag record

`sealed_tag_metadata = seal(tag_key, random(24), account_public_key, tag_metadata)`

`tag_metadata` is a JSON object with these fields:

| Field         | Content                                          |
| ------------- | ------------------------------------------------ |
| `name`        | The name of the tag                              |
| `rule_source` | `filename`, `ocr`, or no value                   |
| `rule_text`   | The text that the rule searches for, or no value |

#### 9.5.3 What the server sees

- the number of tags of an account,
- which file has which tag,
- that the user removed a tag from a file by hand.

The server does not see the name of a tag, and does not see if a tag has a
rule.

The server cannot compare names. The client rejects a second tag with the
same name.

#### 9.5.4 Tags from an upload profile

An upload profile can add fixed tags to each upload. These are references
to tags. The server adds them, as today. No key is necessary.

#### 9.5.5 Key rotation

A rotation changes `account_private_key`, thus it changes `tag_key`. In the
rotation procedure (section 8.3.3), the client makes a new
`sealed_tag_metadata` for each tag and sends them with the new account data.
An account has few tags, thus this work is small.

### 9.6 Text from images (OCR)

**AGREED** for the structure. **PROPOSED** for the exact strings.

**Goal:** the user can search for text that is in an image. The server must
not learn that text.

**Idea:** a client that has the plaintext image does the recognition. It
encrypts the text with a key from `file_key`. The server stores the result.

**Restriction:** the recognition needs the plaintext image. Flare uses
tesseract.js on the server today. The same library operates in a browser.

#### 9.6.1 Encrypted text

1. `ocr_text_key = blake3_derive_key("flare e2ee v1 ocr text", file_key)`
2. `sealed_ocr_text = seal(ocr_text_key, random(24), header_hash, ocr_text)`

A person who has `file_key` can read the text. That person can read the
image too, thus the text gives that person nothing new.

The server sees the length of `sealed_ocr_text`. Thus the server knows
approximately how much text an image contains.

#### 9.6.2 Where the recognition occurs

| Client                       | When                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Browser of the owner, upload | At the time of the upload.                                                                                                    |
| Script client                | At the time of the upload, if a tesseract program is on the machine. This is optional. Most machines do not have the program. |
| Browser of the owner, later  | For each image that has no text (section 9.7).                                                                                |
| Browser of a visitor         | When the visitor selects "Extract text" and no text is stored. The result is not stored.                                      |

The instance setting for automatic recognition continues to apply. If it is
off, the recognition occurs only on the request of the user.

The application must supply the recognition program and the language data
from its own origin. It must not load them from a different site.

#### 9.6.3 Who can store text

A visitor is not trusted. The server must accept `sealed_ocr_text` only:

- in the upload request of the file, or
- from a session of the owner.

A visitor who has `file_key` can make a valid `sealed_ocr_text`. The server
must reject it. The text that the browser of a visitor makes stays in that
browser.

#### 9.6.4 Plain files

For a plain file (section 11), the server does the recognition, as today.

### 9.7 Work that waits for the browser of the owner

**AGREED**

A script client cannot apply tag rules, and frequently cannot do the
recognition. The browser of the owner does this work later.

Each file has three flags that the server stores:

| Flag                | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `rules_pending`     | No client applied the tag rules to this file.      |
| `ocr_pending`       | The file is an image and has no `sealed_ocr_text`. |
| `thumbnail_pending` | The file has no `sealed_thumbnail` (section 12.1). |

The uploading client tells the server which work it did. The server sets
the flags for the work that is not done. The server cannot examine the file
to decide `ocr_pending`. Thus the uploading client tells the server that
the file is an image.

When the owner opens the library, the client does this in the background:

1. Request the files that have a flag.
2. For each file with `ocr_pending`: get the file, decrypt it, do the
   recognition, and send `sealed_ocr_text`.
3. For each file with `rules_pending`: decrypt the name and the text, apply
   each tag rule, and send the new tag references.
4. The server clears the flags.

Results for the user:

- A file from a script client gets its automatic tags when the owner next
  opens the library. It does not get them at the time of the upload.
- The text of such a file is not in the search before step 2 is done.
- Step 2 downloads each image one time. Step 3 is fast.

**PROPOSED.** Additions to this section:

- A plain file gets `rules_pending` too, if the account has a tag with a
  sealed record. The server can read the name of a plain file. It cannot
  read the rule. Thus the browser of the owner applies the rules to plain
  files. For a plain image, the server sets the flag again when it has read
  the text.
- When the owner stores `sealed_ocr_text` and does not send tag references
  in the same request, the server sets `rules_pending`. A rule on text can
  match the new text.
- A client that cannot do the work for a file tells the server. The server
  counts each failed attempt. After 3 failed attempts the server does not
  list the file in step 1. Thus no client repeats the work without end. The
  owner can still request the work for that file.
- The uploading client can tell the server that no thumbnail is possible
  for a file. The server then does not set `thumbnail_pending`.

### 9.8 Search

**AGREED** for the structure. **PROPOSED** for the storage details.

**Goal:** the owner can search the names and the image text of all files.
The search must stay fast for an account with tens of thousands of files.

**Idea:** the client keeps a local copy of the encrypted records. It
decrypts them into memory for the session and searches there.

**Restriction:** the server cannot search encrypted names or encrypted
text. The data can be large. An estimate for 50 000 screenshots is 50 MB to
250 MB of text. A download of all records in each session is too slow.

#### 9.8.1 Local cache of encrypted records

The client keeps the header, `sealed_metadata`, the account stanza and
`sealed_ocr_text` of each file in the Origin Private File System (OPFS) of
the browser.

- The cache contains ciphertext only. A person who reads the cache gets
  nothing that the server does not have.
- The client updates the cache in steps. It requests only the records that
  changed after the last update.
- The client deletes the cache on sign-out.
- If OPFS is not available, the client gets the records from the server in
  each session. A private window of some browsers has no OPFS.
- The browser can delete the cache when storage is low. The client must
  operate correctly without it.

**PROPOSED.** Details of the update:

- The server gives each encrypted file a sequence number. The number
  increases when a value changes that the cache keeps: a sealed record of
  the file, its stanzas, its tags, its folder, its visibility. The view
  count and the download count do not change the number.
- The client requests the records with a number greater than the largest
  number in its cache.
- Each answer contains the count of the encrypted files of the account and
  the sum of their sequence numbers. The client calculates both values for
  its cache. If they are different, the cache missed a deleted file or a
  change. The client then requests the identifier and the number of each
  file and corrects only the differences.
- The cache also keeps the values of section 9.2 for each file. The server
  has them already. The client needs them to apply the other filters of a
  view to the search result and to show the result.
- The client asks the server for the plain files that match a view, and
  merges them with its own result. The client does not tell the server
  which encrypted files matched. The server gets the search text for the
  plain files, as today.

#### 9.8.2 Plaintext in memory

1. A background worker of the client reads the cache.
2. The worker opens each account stanza and gets `file_key`.
3. The worker decrypts the names and the text and keeps them in memory.
4. The plaintext exists only in memory. The client must not write decrypted
   names or text to OPFS, IndexedDB or any other storage.

#### 9.8.3 Search method

Search today is a test for a substring, without regard to upper and lower
case. The worker does the same test on the text in memory. No search index
is necessary for this test.

The worker must use the X25519 function of the browser, not an
implementation in JavaScript. A test on a server computer gave 0.07 ms for
each account stanza. That is approximately 4 seconds for 50 000 files. A
phone is slower. The client shows the first files before the worker is
done.

The same method applies to the sort by name and to the "apply to existing
files" operation of a tag rule.

## 10. Upload and share links

### 10.1 Upload from the browser

**AGREED**

1. Make `file_key`.
2. Build the header (section 7.2) and `sealed_metadata` (section 9.1).
3. Encrypt the content (section 7.3).
4. Make an account stanza for the account of the user (section 8.1).
5. If the file is public and in a folder, make a folder stanza (section
   8.4.3).
6. If the file has a password, make a password stanza (section 8.2).
7. If the client did the work, make `sealed_ocr_text` (section 9.6) and
   `sealed_thumbnail` (section 12.1), and apply the tag rules (section 9.5).
8. Send the encrypted file, `sealed_metadata`, the stanzas and the results
   of step 7 to the server. Tell the server which work of step 7 is done.
9. The server returns the file identifier.

### 10.2 Upload from a script client

**AGREED**

**Goal:** screenshot tools must continue to work. They are a primary use of
Flare.

**Idea:** encryption to a public key needs no secret. The script has the
public key of the account and a bearer token.

A script client has these values in its configuration:

- a bearer token,
- `account_public_key`,
- the upload profile, which says if the upload is encrypted (section 11.2),
- `folder_public_key`, if the profile puts files in a folder.

The script client has no private key.

The application writes `account_public_key` into the configuration when the
user creates it. The script client must not get the key from the server
without verification. A compromised server could give a different key.

The procedure is the same as section 10.1. A script client frequently
skips step 7 (section 9.7). The bearer token authorizes step 8.

**PROPOSED.** Before an encrypted upload, the script client requests the
list of protocol versions that the server accepts (section 1.5.3, rule 5).
The list is in the public settings of the server. The request has no bearer
token. If the list does not contain the protocol version of the script
client, the script client sends no upload and tells the user to update.

**PROPOSED.** The server rejects an upload whose account stanza is for a
different key than the current `account_public_key` (section 8.3.6). The
error code is `account_key_not_current`. The script client then tells the
user to install a new configuration.

### 10.3 Share link

**AGREED**

**The file name is not in the address.** Today the address of a file is
`/{user}/{file name}`, for example `/birb/holiday-photo.png`. The server
reads the name from the address. The name of an encrypted file is secret,
thus it cannot be in the address. `file_id` replaces it.

`file_id` is a value that the server can see. It is a random value by
default. A name pattern of an upload profile can make it, if the pattern
does not use the original file name.

The server makes a random `file_id` as `e_` and then
`base64url(random(16))`: 24 characters. The address of a plain file never
has this form. Thus a proxy can identify the address of an encrypted file
without a query to the database (section 11.3).

A plain file keeps its address with the file name, as today.

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

The base64url alphabet has no `.` character. Thus the client can always
separate a prefix from the secret. A link without a prefix is a `file_key`
of protocol version 1. A later version uses a new prefix. A client that
finds a prefix that it does not know must tell the user to update (section
1.5.2).

- The browser does not send the part after `#` to the server.
- The uploading client makes the link. It knows the secret and it gets
  `file_id` from the server.
- **PROPOSED.** A script client makes the link from the address of the
  server in its configuration and from the path that the server returns.
  It does not use a host that the server returns. Thus a compromised server
  cannot make the script client put a key in a link to a different site.
- **PROPOSED** (draft 23, from the security review). The browser client
  obeys the same rule. It puts a key only into an address of the origin of
  the page: it takes the path from the answer of the server and drops the
  host. This applies to the link of an upload and to each link on a shared
  folder page.
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
- Link previews with content and server OCR operate only on plain files.
- An administrator can forbid plain uploads for the instance. An
  administrator cannot turn encryption off for the instance.

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
from a wrong configuration. The server identifies an encrypted upload by a
field of the request and by the `magic` value of the header.

One exception exists. An upload with a token from before the migration is
always a plain upload (section 14.4).

If the administrator forbids plain uploads (section 11.1), the server
rejects each plain upload, also from an old token.

**PROPOSED.** These rules settle what the text above does not say.

1. The rule of the server applies to an upload with a bearer token. A
   script client has no upload dialog, thus its upload profile decides.
2. An upload from the application has the selection of the upload dialog.
   That selection is explicit and it wins. The upload profile sets only the
   value that the dialog shows first. The server does not compare an upload
   from the application with the profile.
3. An upload with a bearer token that selects no profile uses the default
   profile of the account. If the account has no default profile, the value
   is `encrypted`. Thus a plain upload with a bearer token needs a profile
   with the value `plain`.
4. A request cannot set `encryption`. It is a setting of the profile only.
5. The server gives the reason of a rejection as an error code that a
   script client can read: `profile_requires_encrypted`,
   `profile_requires_plain` or `plain_uploads_forbidden`.

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

## 12. Features that use file content

**Rule:** an encrypted file must have the same functions as a plain file,
where a client can do the work. The functions move from the server to the
client. They are not removed.

### 12.1 Thumbnails

**AGREED**

1. The client makes a small image of the file. **PROPOSED**: WebP, longest
   side 480 pixels.
2. `thumbnail_key = blake3_derive_key("flare e2ee v1 thumbnail", file_key)`
3. `sealed_thumbnail = seal(thumbnail_key, random(24), header_hash, thumbnail)`

The server accepts `sealed_thumbnail` only in the upload request or from a
session of the owner (as in section 9.6.3).

A file from a script client that has no thumbnail gets the flag
`thumbnail_pending`. The browser of the owner makes the thumbnail later
(section 9.7).

### 12.2 Video and audio

**AGREED**

A player requests parts of a file. The chunk format permits this (section
7.5).

1. The page gives `file_key` to a service worker of the application.
2. The player requests a local address. The service worker gets the request.
3. The service worker calculates which stored chunks contain the requested
   bytes. It requests them from the server with a range request.
4. It verifies the tag of each chunk and decrypts the chunk.
5. It answers the player with the requested bytes.

The service worker keeps `file_key` in memory only.

If a browser has no service worker, the client downloads and decrypts the
full file before the player starts.

#### 12.2.1 Local address

**PROPOSED**

**Goal:** the decrypted bytes must never become a page of the application.

**Restriction:** a person who knows `account_public_key` can make a file
that decrypts correctly (section 3.3, limit 2). Thus the bytes that a local
address answers with are not trusted. The address is in the origin of the
application.

The local address is `/_flare/local/{local_token}`. `local_token` is
`base64url(random(32))`. The page makes it. No URL ID and no vanity ID
contains `_`, thus no file has this address. `file_key` is never part of an
address.

The address of the mode `frame` is
`/_flare/local/{local_token}/document.pdf`. A PDF viewer shows the last part
of the address as the title. The last part is the same for all files. The
file name is never part of an address: a browser with no service worker
sends the address to the server.

The page gives the service worker a `local_resource` through a
`MessageChannel`: `local_token`, the mode, the type, the address of the
ciphertext, `file_key`, the header and the stored length. The service worker
records which page sent it.

Each `local_resource` has one mode:

| Mode       | Who gets an answer                                        | Type of the answer                           |
| ---------- | --------------------------------------------------------- | -------------------------------------------- |
| `media`    | An image, video or audio element of the page that sent it | The type, if it is on the list below         |
| `frame`    | A navigation in a frame                                   | `application/pdf` only                       |
| `download` | A navigation, one time                                    | `application/octet-stream`, as an attachment |

The list of types for `media` is the raster image, video and audio types
that the application shows from a decrypted file. HTML, SVG and XML are not
on the list. The service worker must refuse to record a `local_resource`
with a type that its mode does not permit.

Each answer of the service worker, also an error, must have these headers:

- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: sandbox; default-src 'none'`
- `Content-Disposition`: `inline` for `media` and `frame`, `attachment` for
  `download`

Thus a navigation to a local address shows no document that can run script
in the origin of the application. A `media` address refuses each
navigation.

The service worker must not answer a request that is not for a local
address. It must not use Cache Storage or IndexedDB.

#### 12.2.2 Ranges and the end of the file

**PROPOSED**

1. The service worker calculates the stored chunks that contain the
   requested plaintext bytes (section 7.5) and requests those stored bytes.
2. The answer of the server must be the requested range, and its total must
   be the stored length that the page gave. If not, reject.
3. Before the service worker gives out a byte of a file, it must read the
   last stored chunk and verify its tag with `final_flag = 0x01`. A server
   that cuts a file at a chunk border and reports the shorter length thus
   causes a failure, and the file does not play as a complete file
   (section 7.4).
4. The answer has status `206`, `Content-Range` and `Accept-Ranges: bytes`.
   A request without a range gets status `200` and the full length.

#### 12.2.3 A service worker that stops

**PROPOSED**

A browser stops a service worker that is idle. The keys in its memory are
lost. The page keeps each `local_resource` that it made, in memory.

1. A service worker that gets a request for a `local_token` that it does not
   have asks the page for it.
2. The page sends the `local_resource` again.
3. The service worker answers the request. The address does not change.

On sign-out, and when the account keys are locked or replaced, the page
erases each `local_resource` and tells the service worker to erase all that
it has.

#### 12.2.4 Downloads and PDF

**PROPOSED**

A download uses a `download` address. The browser writes the answer to a
file as it arrives, thus the plaintext is not complete in memory. If a
chunk tag is wrong, the service worker breaks the answer. The browser then
has a failed download and not a file.

A PDF can use a `frame` address. The sandbox of the answer gives the
document an origin that is not the origin of the application.

### 12.3 Archives

**AGREED**

The server reads, extracts and creates archives today. For an encrypted
file, the client does this work.

| Operation         | What the client does                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| List the content  | Read the necessary chunks with range requests, decrypt them, read the index. |
| Open one entry    | Read and decrypt the chunks of that entry.                                   |
| Extract           | Decrypt the entries. Encrypt each entry as a new file. Upload them.          |
| Create an archive | Download and decrypt the files. Build the archive. Encrypt and upload it.    |

A visitor of a share page can list an archive and open an entry. The client
of the visitor does the work. No unlock cookie from the server is necessary,
because `file_key` or the password stanza controls access.

Limits:

- Extract and create operations move the data through the device of the
  user. A large archive needs time and bandwidth.
- The client must process the data as a stream. It must not hold a full
  large archive in memory.

#### 12.3.1 The archive is not trusted

**PROPOSED**

The list of entries of an archive is content of an encrypted file. A person
who knows `account_public_key` can make it (section 3.3, limit 2). Thus:

1. The client applies the limits that the server applies to a plain
   archive: the number of entries, the depth and the length of a path, the
   size of one entry, the total size after expansion, and the largest ratio
   that the compression method can give.
2. The client must not extract an archive that has an entry with a path
   that leaves the archive, a link, or two names that are equal when the
   case of the letters is ignored.
3. The client shows an entry only as text, or as one of the media types of
   section 12.2.1, which it selects from the name of the entry. It must not
   show an entry as a document.
4. The client must not send the name of an entry to the server. A folder
   that the client makes for extracted files must have a sealed name
   (section 8.4.2).

A new file from an extract or create operation is an encrypted file. The
client makes it with the upload procedure of section 10.1.

### 12.4 Export of the account data

**AGREED**

For encrypted files, the client downloads and decrypts each file and builds
the archive on the device. The server cannot do it.

#### 12.4.1 Procedure

**PROPOSED**

1. The client requests the list of the files of the account, with
   `sealed_metadata`, the header and the account stanza of each encrypted
   file.
2. The client opens each account stanza and `sealed_metadata`. The name of
   an entry comes from `file_metadata`. The client must make the name one
   safe path segment before it uses it.
3. For each file, the client reads the stored file, verifies each chunk and
   the last chunk (section 7.4), and writes the plaintext to the archive.
4. A plain file goes into the same archive as the server stores it.
5. If no key opens a file, the client writes its ciphertext to the archive.
6. If a file fails, the client leaves it out and continues. The archive
   contains a report that names each file that is not complete in it.

The client must write the archive as a stream, to a file that the user
selects or to a download of the browser (section 12.2.4). The client must
not write decrypted data to the Origin Private File System, to IndexedDB or
to any other storage of the browser.

### 12.5 Pastes

**AGREED**

A paste is a file. It is encrypted by default, as each file.

### 12.6 Short links

**AGREED**

A short link stays as today. The server stores the target address as plain
text and redirects to it.

A short link must not contain a key. If the user makes a short link from a
share link, the part after `#` would go to the server. The client must
reject a target address that contains a Flare key and tell the user the
reason.

Result: a short link cannot open an encrypted file. An encrypted short link
is possible but is not part of this document.

**PROPOSED**: the server rejects such a target address too. A script that
sends one has sent the key already, thus this check protects only the
stored record. The server must not write the rejected address to a log or
to an audit record (section 13, requirement 3).

### 12.7 Webhook `file.ready`

**AGREED**

Flare sends this event to the receiver of a user when a file is ready. Today
the event contains: the identifier, the file name, the MIME type, the size,
the visibility, and if the file has a password. The schema permits no other
fields.

The server does not have the name or the type of an encrypted file. Thus
the event needs version 2:

| Field                    | Version 1 | Version 2                                            |
| ------------------------ | --------- | ---------------------------------------------------- |
| `version`                | `1`       | `2`                                                  |
| `data.encrypted`         | Not there | `true` or `false`                                    |
| `data.name`              | Text      | Text for a plain file. `null` for an encrypted file. |
| `data.mimeType`          | Text      | Text for a plain file. `null` for an encrypted file. |
| `data.passwordProtected` | Yes or no | `true` if the file has a password stanza.            |

A receiver that needs the name must have `file_key`. The server cannot give
it.

A receiver cannot select a version. The server sends version 2 for each
file, also for a plain file. A delivery that was in the queue before the
upgrade keeps its version 1 content.

## 13. Requirements for the server and the application

1. **AGREED.** The application must send a Content-Security-Policy that
   permits scripts and WebAssembly only from the origin of the application.
   The framework of Flare puts inline scripts in each page. Thus the policy
   must permit an inline script only if it has the random nonce of that
   response. It must block each other inline script. The scripts of the
   "Custom head" setting get the nonce (section 13.1). The policy has
   `'strict-dynamic'`, which is the method that the framework documents: a
   script that operates with the nonce can add other scripts. The policy
   blocks a script that an attacker adds as markup. It does not limit a
   script that operates already.
2. **AGREED.** The "Custom head" setting continues to operate as today,
   with scripts (section 13.1).
3. **AGREED.** The server must not write a file key or a share link fragment
   to a log, an audit record, a webhook or a URL query.
4. **AGREED.** A moderator permission must not give access to encrypted
   content. A moderator sees the visible metadata of section 9.2 and can
   delete a file. The project owner accepted this.
5. **AGREED.** The server must store a hash of each upload token only
   (section 14.4).

### 13.1 The "Custom head" setting

**AGREED** (decision of birb). The project owner can change it.

An administrator can type HTML in this setting. Flare puts it in the head of
each page, also the share pages. It accepts `script`, `style`, `link`,
`meta`, `base`, `noscript`, `template` and `title` elements. Administrators
use it for analytics programs, fonts, site verification and small changes.

**Decision:** the setting continues to operate as today. The application
gives the nonce of the response to each `script` element of the setting.
Thus the Content-Security-Policy of requirement 1 permits these scripts,
also when they come from a different origin.

**Reason:** in most instances the administrator is the person who operates
the server. That person can change the code of the application. A
restriction of this setting prevents nothing for that person, and it removes
a function that administrators use.

**Accepted limit.** A script of this setting operates in each page. It can
read the account private key of each user who opens the application, and
the key in each share link. Thus these persons can read keys without a
change of the application code:

- a person who controls an administrator account of the application, for
  example after a stolen session,
- a person who can write to the database,
- each site from which a script of this setting comes.

This is a part of limit 1 of section 3.3. The public documentation must say
that the "Custom head" setting is equal to a change of the application code.

## 14. Migration of an existing instance

### 14.1 Existing accounts

**AGREED**

1. The user signs in with the old method. The server gets the password one
   more time and checks it.
2. The client immediately does the account creation of section 5.4. The
   server accepts the new account record only in a session whose sign-in
   was less than 5 minutes before. The request does not contain the old
   password.
3. The user can use the current password as the passphrase, if it passes
   the strength check (section 5.2.1). If not, the user selects a new one.
4. The server deletes the old password hash in the same operation. The old
   method does not operate for this account after that.
5. The client shows the mnemonic.

An account that signs in with a passkey or OIDC selects a passphrase at
step 3.

An administrator can create an account for a different person. Such an
account starts with a temporary password and has no keys. The person signs
in one time with that password and then does steps 2 to 5.

After an account has keys, no party can set a password for it. An
administrator cannot. The email reset cannot. Only the procedures of
sections 6.7, 6.8 and 6.9 change its secrets.

The server saw the old password before the migration. A user who does not
trust the past of the server selects a new passphrase.

**PROPOSED** (draft 23, from the security review). There is a second
reason. A copy of the database from before the migration has a bcrypt hash
of the old password. A person who has such a copy can test passwords
against that hash at a much lower cost than Argon2id (section 3.3, limit
4). If the user keeps the old password as the passphrase, that person then
opens `wrapped_root` from a later copy of the database. The application
must tell the user this where it offers to keep the password. Question 6 of
section 15 asks if the offer should stay.

During the migration, the sign-in page must know which method an account
uses. The answer for an account that has a password and no keys is
different from the answer for an unknown identifier (section 6.1). Thus a
person can learn that such an account exists. This stops when the account
has keys.

### 14.2 Existing files

**AGREED**

**Idea:** the encryption of a file to a public key needs no secret (section
3.3, limit 2). The server has the plaintext of each existing file. Thus the
server can encrypt the files of an account after the account has a public
key. The browser of the user does not have to download them.

For each file, the server:

1. makes `file_key`,
2. builds the header (section 7.2) and `sealed_metadata` with the name and
   the type (section 9.1),
3. encrypts the content (section 7.3),
4. makes the account stanza and, if the file is public and in a folder, the
   folder stanza,
5. encrypts the stored image text, if there is one (section 9.6.1),
6. replaces the plaintext in the storage with the ciphertext,
7. erases `file_key` and deletes the plain name, type and text from the
   database.

Before the server starts, the browser of the owner makes the key pairs of
the folders and the encrypted tag records. These need the owner.

**When:** after the account has keys (section 14.1), the application asks
the user one time. The user selects which existing files the server
encrypts: none, the private files, or all files. The table shows the result
for each type of file and the default selection.

**Which files:**

| File                        | Action                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Private                     | The default is to encrypt. No link exists that can break.                                                                                                    |
| Public                      | Stays plain. The owner can request encryption. The old link then stops, and the owner gets a new link.                                                       |
| With a server-side password | Stays plain. The server has only a hash of the password, thus it cannot make a password stanza. The owner can request encryption and set the password again. |

**Limits:**

- The server reads each file one more time. This is acceptable because the
  server has the plaintext already. The design assumes an honest server at
  this time (section 3.1).
- The server needs free storage for one file during its encryption.
- Old backups of the storage and the database contain the plaintext. The
  operator must delete or replace them. The documentation must say this.
- Files get the flag `thumbnail_pending`. The browser makes thumbnails later.

### 14.3 Accounts that do not come back

**AGREED**

An account that never signs in again has no keys. Its files stay plain.

### 14.4 Upload tokens and old configurations of screenshot tools

**AGREED**

Today each account has one upload token. The database stores it as plain
text. An endpoint returns it. Each screenshot tool configuration contains
it. A person who copies the database can upload as each user.

Procedure:

1. A database migration replaces each stored token with its hash. The old
   configurations continue to authenticate.
2. The endpoint that returns the token is removed. A hash cannot give the
   token back.
3. A new configuration contains a new token, the `account_public_key`, and
   the upload profile (section 11.2).

An old configuration cannot encrypt. The server accepts its uploads as
plain files. The application shows a warning until the user installs a new
configuration. The screenshot tools of each user thus continue to operate
after the upgrade.

**PROPOSED.** These rules complete the procedure.

1. A named bearer token from before the migration is an old token too. The
   migration marks each of them. The uploads of a marked token are plain
   files, and the `encryption` setting of its upload profile does not
   apply.
2. The server rejects an encrypted upload with an old token. The error code
   is `token_predates_encryption`.
3. An account that is created after the migration gets no upload token of
   the old type.
4. The user can revoke the old upload token. A key rotation revokes it
   (section 8.3.3, step 8). The server makes no new token of the old type.
5. The application writes each new configuration in the browser. The
   server has only the hash of the token, and `account_public_key` must
   come from the client (section 10.2).

## 15. Open questions

1. **Time of Argon2id on a slow phone.** Section 4.3. A measurement is
   necessary.
2. **Public upload links.** This feature is not merged. It must use the
   upload procedure of section 10.2.
3. **A record of the owner for the place of a file.** From the security
   review. Sections 9.4.5 and 9.4.7 state the problem: the browser of the
   owner adds a reader (a folder stanza, a parent stanza, a new key pair)
   because the server says that a file is public in a folder, that a folder
   is below a different folder, or that a folder waits for a key. A proposal:
   the owner writes a tag with each such change,
   `keyed_hash(derive_key("flare e2ee v1 placement", account_private_key),
file_id || folder_id || visibility)` for a file and the same with the two
   folder identifiers for a folder, and the browser makes a record later
   only if the tag is correct. A script client has no account private key
   and cannot make the tag, so its files in a folder would wait until the
   owner agrees. A second proposal: the place of the file (the folder
   identifier and the visibility) is a part of `sealed_metadata`, which
   `file_key` protects. The uploader writes it, the owner writes it again
   with each move and each change of visibility, and the browser makes a
   folder stanza later only for the place that the metadata names. A script
   client can do this, because it has `file_key`. A server that gives an
   old `sealed_metadata` (section 3.3, limit 8) can only give back a reader
   that the file had before. This proposal does not cover the stanza of a
   folder in its parent. A third proposal: the owner agrees to each repair
   that adds a reader. No decision is made.
4. **Storage quota of sealed records.** From the security review. A
   `sealed_ocr_text` and a `sealed_thumbnail` can each have 256 KiB, and the
   server does not count them in the storage quota of the account. Thus an
   account can use much more database storage than its quota. The proposal
   is to count them.
5. **The keyring after a migration.** The client deletes an old key from
   `sealed_keyring` when the server says that no stanza is for that key
   (section 8.3.4, step 5). A compromised server can say this too early.
   The result is the loss of files, not their disclosure.
6. **The old password as the passphrase.** Section 14.1 lets the user keep
   it. The alternative is to demand a new passphrase from each account.

The program for script clients is `flare-upload`, in `clients/flare-upload`.
It is written in Rust. The project builds it for Linux (x86_64 and aarch64),
macOS (x86_64 and aarch64) and Windows (x86_64). This closes the earlier
question 2.

All other questions of the earlier drafts are closed. The change log shows
when.

## 16. Change log

| Draft | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 2026-11-10 | First draft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1     | 2026-11-10 | Full names for all values. Goal, idea and restriction for each section. One-page design summary. Account key rotation with generations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2     | 2026-11-10 | Sign-in uses a signature from a passphrase-derived key pair. The bearer `auth_key` and `auth_verifier` are removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3     | 2026-11-10 | Password stanza needs a secret from the link and binds to the owner key and the file. Strength check with zxcvbn for each passphrase and password.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4     | 2026-11-10 | Key rotation replaces `root_entropy`. Key generations and the separate signing key proposal are removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5     | 2026-11-10 | A passphrase change and recovery are always a key rotation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6     | 2026-11-10 | Rotation is constant time with a keyring of old keys and a background stanza migration. Password stanzas record the owner key and survive a rotation. The owner can get a password link back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7     | 2026-11-10 | Folders: a key pair for each folder, stanzas from a folder to its files and to the folders below it, shared folder links that include the folders below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8     | 2026-11-10 | Folder decisions closed. Clear statement of what stop sharing does not do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9     | 2026-11-10 | Plain uploads in upload profiles. Generic link preview for encrypted files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 10    | 2026-11-10 | Tags, text from images, work that waits for the browser of the owner, and search.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 11    | 2026-11-10 | Only the upload request and the owner can store image text. Search uses an encrypted local cache in OPFS and plaintext in memory only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 12    | 2026-11-10 | Decisions on the open questions. Argon2id parameters from RFC 9106. New sections for features that use file content and for migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13    | 2026-11-10 | Closed: file address, webhook version 2, token hashes, old tool configurations upload as plain, existing files after a prompt. Custom head stays open with the objection and the conflict with the script policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 14    | 2026-11-10 | Review of the full document. Corrections: random nonce for `sealed_link_secret`; the folder key copy of the owner uses a secret key; a rotation needs a proof of the passphrase; a signed request cannot create a session; the script policy permits inline scripts with a nonce; the server stores the full header. New: reset without the mnemonic, limit 8, three open questions. Stale text removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 15    | 2026-11-10 | The file name moves out of the header into a separate sealed record. The header has 26 bytes. No sign-in with the account key. The "Custom head" setting continues to operate with scripts, as an accepted limit. Reset without the mnemonic is agreed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 16    | 2026-11-10 | Protocol versions: where the version is recorded, rules for a client, rules for a new version. The account record stores its Argon2id parameters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 17    | 2026-11-10 | Protocol versions agreed. Exact encodings for each value. Test vectors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 18    | 2026-11-11 | Results of the first implementation. `seal_once` for stanzas: the nonce comes from the key and is not stored. Argon2id parameters are fixed for a protocol version; the account record does not store them. One valid encrypted form for each file. Canonical X25519 public keys. Exact identifier form, also for the fake salt. Each stored record has the version byte. No sealed empty keyring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 19    | 2026-11-11 | Sign-in has two requests: one for the session, one for the key material. Unlock is one procedure for each sign-in method, with its own context string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 20    | 2026-11-11 | Results of the server implementation of accounts. A rotation ends each session. The client adds the version byte. Existing accounts get keys in a session of the last 5 minutes, without the old password. Accounts that an administrator creates. A proxy must not change the path of a signed request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 21    | 2026-11-10 | Results of the implementation of encrypted files. The form of a random `file_id`. A password that the owner adds later does not stop a person who has `file_key`. The script policy has `'strict-dynamic'`. The server sends webhook version 2 for each file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 22    | 2026-11-10 | Results of the implementation of the library, of the content features and of script uploads. All additions are PROPOSED. Reset deletes folder keys, tag records and stanzas. The form of the shared folder link. Re-key of a subtree after the owner stops sharing. Records that the browser of the owner makes later. Plain files can wait for tag rules. The sequence number and the repair of the local cache. The local address of the service worker, ranges, the end of the file, a worker that stops, downloads and PDF. An archive is not trusted. The export procedure. The server also rejects a short link that contains a key. A script client checks the accepted versions and builds the link from its own origin. Rules for the `encryption` setting and for old tokens. A folder stanza that a script client cannot renew is not stored. The program for script clients is `flare-upload`. |
| 23    | 2026-11-10 | Results of the security review. All additions are PROPOSED. After a rotation, each folder that no shared folder link opens gets a new key pair (sections 8.3.4 and 8.3.5). A moderator cannot make an encrypted file public (section 9.4.4). The claim of section 9.4.5 about a compromised server is corrected, and section 9.4.7 states the limit of the repair list. The browser builds each link with a key on its own origin (section 10.3). The server replaces only a stanza for an old key (section 8.3.4). The plain names of folders and tags leave the audit records (section 9.4.7). Section 14.1 states the risk of the old password hash in old copies of the database. New open questions 3 to 6.                                                                                                                                                                                           |
