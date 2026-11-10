# Flare End-to-End Encryption Specification

| Field   | Value                                               |
| ------- | --------------------------------------------------- |
| Status  | Draft 1. Not implemented. Not reviewed.             |
| Version | Protocol version 1 (`v1`)                           |
| Date    | 2026-11-10                                          |
| Applies | Flare, branch `feat/e2ee`, based on `main` b03f841e |

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
   splits the result into two keys. The `auth_key` goes to the server as
   proof. The `wrap_key` stays in the client and encrypts the `root_entropy`.
3. The server keeps the encrypted `root_entropy`. The server releases it only
   after the proof and the second factor are correct.
4. Each file has its own random `file_key`. The client encrypts the file in
   chunks. Each chunk has its own authentication tag.
5. The client encrypts the `file_key` to the public key of the account. The
   result is a stanza. Encryption to a public key needs no secret, thus an
   upload script can do it.
6. A share link carries the `file_key` after the `#` character. The browser
   does not send that part to the server.
7. A user can select a plain upload when a file must have a link preview.

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

| Name                    | Size     | Meaning                                                     |
| ----------------------- | -------- | ----------------------------------------------------------- |
| `root_entropy`          | 32 bytes | Root secret of the account. The mnemonic encodes it.        |
| `account_seed`          | 32 bytes | Seed of the account key pair.                               |
| `account_private_key`   | 32 bytes | Ed25519 private key of the account.                         |
| `account_public_key`    | 32 bytes | Ed25519 public key of the account.                          |
| `exchange_private_key`  | 32 bytes | X25519 form of `account_private_key`.                       |
| `exchange_public_key`   | 32 bytes | X25519 form of `account_public_key`.                        |
| `passphrase_salt`       | 32 bytes | Random input to Argon2id. Not secret.                       |
| `passphrase_root`       | 32 bytes | Output of Argon2id.                                         |
| `auth_key`              | 32 bytes | Proof of the passphrase. The client sends it to the server. |
| `auth_verifier`         | 32 bytes | Hash of `auth_key`. The server stores it.                   |
| `wrap_key`              | 32 bytes | Key that encrypts `root_entropy`. Never leaves the client.  |
| `wrapped_root`          | 88 bytes | `root_entropy` encrypted with `wrap_key`.                   |
| `file_key`              | 32 bytes | Random key of one file.                                     |
| `content_cipher_key`    | 32 bytes | Encrypts the chunks of a file.                              |
| `content_mac_key`       | 32 bytes | Authenticates the chunks of a file.                         |
| `metadata_key`          | 32 bytes | Encrypts the name and the type of a file.                   |
| `header_hash`           | 32 bytes | BLAKE3 hash of the file header.                             |
| `ephemeral_private_key` | 32 bytes | X25519 private key that the sender uses for one stanza.     |
| `ephemeral_public_key`  | 32 bytes | Its public key. It is part of the stanza.                   |
| `shared_secret`         | 32 bytes | Output of X25519.                                           |
| `stanza_key`            | 32 bytes | Key that encrypts one `file_key` in one stanza.             |

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
7. The theft of one account private key does not expose files that the user
   uploads after the next key rotation (section 8.3).

### 3.3 Limits

These limits are accepted. The public documentation must state them.

1. **Served code.** The server supplies the browser application. An attacker
   who changes the served code can steal keys. No web application can prevent
   this. Script clients with a pinned public key do not have this limit for
   uploads.
2. **No sender authentication.** A person who knows the account public key can
   create a file that decrypts correctly. The server always knows this key.
   This is deliberate. It gives deniability and it keeps secrets off the
   upload machine.
3. **Limited forward secrecy.** The owner must be able to read old files. Thus
   the current account private key opens all current stanzas. Key rotation
   (section 8.3) limits the damage of a stolen key. It cannot protect a file
   if the attacker has the old key and a copy of the old stanza.
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
                                             +-- auth_key = blake3_derive_key("flare e2ee v1 auth", passphrase_root)
                                             +-- wrap_key = blake3_derive_key("flare e2ee v1 wrap", passphrase_root)
```

- `root_entropy` is the root of the account. The mnemonic is the recovery key.
- `auth_key` proves knowledge of the passphrase to the server.
- `wrap_key` encrypts `root_entropy`. `wrap_key` never leaves the client.

**Reason for one Argon2id operation:** two operations make the user wait two
times. An attacker with the database needs only one operation for each guess.

### 5.2 Passphrase rule

Each account must have a passphrase. This rule applies to accounts that sign
in with a passkey or with OIDC too. Those methods give the client no secret
that the server cannot see.

### 5.3 Data that the server stores for each account

| Field                | Content                                                        | Readable by the server |
| -------------------- | -------------------------------------------------------------- | ---------------------- |
| `account_public_key` | Account public key                                             | Yes                    |
| `passphrase_salt`    | `random(32)`                                                   | Yes                    |
| `auth_verifier`      | `blake3_derive_key("flare e2ee v1 auth verifier", auth_key)`   | Yes                    |
| `wrapped_root`       | `seal(wrap_key, random(24), account_public_key, root_entropy)` | No                     |

The server must not store `auth_key`. The server stores only `auth_verifier`.
A person who copies the database cannot sign in with `auth_verifier`.

### 5.4 Account creation

The client does these steps:

1. `root_entropy = random(32)`.
2. Calculate `account_seed`, `account_private_key` and `account_public_key`.
3. `passphrase_salt = random(32)`.
4. `passphrase_root = Argon2id(passphrase, passphrase_salt)`.
5. Calculate `auth_key` and `wrap_key`.
6. `wrapped_root = seal(wrap_key, random(24), account_public_key, root_entropy)`.
7. Send `account_public_key`, `passphrase_salt`, `auth_key` and
   `wrapped_root` to the server.
8. Show the mnemonic of `root_entropy` to the user. Tell the user to keep it
   offline.
9. Erase `passphrase_root`, `auth_key` and `wrap_key` from memory.

The server calculates `auth_verifier` from `auth_key`. Then the server
discards `auth_key`.

## 6. Sign-in and unlock

**AGREED** for the structure. **PROPOSED** for the message details.

**Goal:** the user gets a server session and the account private key. The
server learns nothing that opens a file.

**Idea:** the client proves the passphrase with `auth_key`. The server
releases `wrapped_root` only after that proof and the second factor. The
client opens `wrapped_root` with `wrap_key`.

**Restriction:** after the client has the account private key, the server
cannot take it back. Thus the second factor must protect the release of
`wrapped_root`, not only the session.

### 6.1 Salt request

1. The client sends the account identifier.
2. The server returns `passphrase_salt`.

For an unknown identifier, the server must return a fake salt. The fake salt
is `blake3_keyed_hash(server_secret, identifier)`. The response for an
unknown identifier must have the same form and timing as a real response.

### 6.2 Password sign-in

1. The client gets `passphrase_salt` (section 6.1).
2. `passphrase_root = Argon2id(passphrase, passphrase_salt)`.
3. The client calculates `auth_key` and `wrap_key`.
4. The client sends the identifier, `auth_key` and the second-factor response.
5. The server calculates a verifier from the received `auth_key`.
6. The server compares it with `auth_verifier` in constant time.
7. The server checks the second factor.
8. If steps 6 and 7 pass, the server creates a session and returns
   `wrapped_root`.
9. `root_entropy = open(wrap_key, account_public_key, wrapped_root)`.
10. The client calculates `account_private_key` from `root_entropy`.
11. The client checks that `account_private_key` gives `account_public_key`.
    If not, reject.
12. The client erases the passphrase, `passphrase_root`, `auth_key`,
    `wrap_key` and `root_entropy`.

The server must limit the rate of step 4 for each identifier and each address.

### 6.3 Passkey and OIDC sign-in

1. The user signs in with the passkey or OIDC. The server creates a session.
2. The client asks the user for the passphrase.
3. The client does steps 1 to 3 of section 6.2.
4. The client sends `auth_key` in the session.
5. The server does steps 5 and 6 of section 6.2.
6. If the check passes, the server returns `wrapped_root`.
7. The client does steps 9 to 12 of section 6.2.

A session alone must not release `wrapped_root`. A person who steals a
session thus cannot start offline guesses.

### 6.4 Key storage in the browser

- The client keeps `account_private_key` in IndexedDB for the life of the
  session.
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
- rotate the account key on the request of the user.

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

1. The client authenticates with the old passphrase and gets `root_entropy`.
2. The client makes a new `passphrase_salt`, `auth_key`, `wrap_key` and
   `wrapped_root` (section 5.4).
3. The client sends them in a signed request (section 6.6).

The account key does not change. No file changes.

### 6.8 Recovery

Recovery is for a user who lost the passphrase and has the mnemonic.

1. The user proves control of the account to the server. Email reset is one
   method.
2. The user types the mnemonic. The client decodes `root_entropy`.
3. The client calculates `account_public_key` from `root_entropy` and
   compares it with the stored one.
4. The client makes a new `passphrase_salt`, `auth_key`, `wrap_key` and
   `wrapped_root`.
5. The client sends them in a signed request.

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

**PROPOSED**

**Goal:** replace the file password. Today the server compares the password.
A compromised server could ignore that comparison.

**Idea:** the password makes a key, and that key encrypts `file_key`. The
password becomes part of the cryptography.

1. `password_salt = random(32)`
2. `password_key = blake3_derive_key("flare e2ee v1 password stanza", Argon2id(password, password_salt))`
3. `wrapped_file_key = seal(password_key, zeros(24), header_hash, file_key)`
4. The stanza is `password_salt || wrapped_file_key`.

The share link of a file with a password stanza does not contain `file_key`.
The recipient types the password. The client calculates `file_key`.

### 8.3 Account key rotation

**PROPOSED**. One part is **OPEN** (section 8.3.5).

**Goal:** a stolen account private key must not expose files that the user
uploads after the theft is over. Rotation must be possible on demand and
automatically after a number of uploads.

**Idea:** the account key has generations. Each generation comes from
`root_entropy` and a number. A rotation makes the next generation, makes new
stanzas for all files, and deletes the old stanzas and the old private key.

**Restriction:** the browser stores `account_private_key` (section 6.4). This
is the key that an attacker can most easily steal. The browser does not store
`root_entropy`. Thus a theft from the browser gives one generation only.

#### 8.3.1 Generations

`key_generation` is an integer. It starts at `0`.

`account_seed = blake3_derive_key("flare e2ee v1 account seed", root_entropy || LE64(key_generation))`

The key of one generation does not reveal the key of a different generation.
Each account stanza records the `key_generation` of its recipient key.

#### 8.3.2 What rotation gives and does not give

| Attacker has                                         | Result after rotation                         |
| ---------------------------------------------------- | --------------------------------------------- |
| An old private key only                              | Reads nothing.                                |
| An old private key, and later a copy of the database | Reads nothing. The old stanzas are deleted.   |
| An old private key and a copy of the old stanzas     | Reads the old files. Does not read new files. |
| `root_entropy` or the passphrase                     | Reads all files. Use section 8.3.4.           |

#### 8.3.3 Rotation procedure

The client must have `root_entropy`. It has it during sign-in, and after the
user types the passphrase.

1. Calculate the key pair for `key_generation + 1`.
2. For each file: open the account stanza with the old key. Make a new
   account stanza for the new public key (section 8.1).
3. Send the new public key and the new stanzas in a request that is signed
   with the old key (section 6.6).
4. The server replaces each stanza and the public key. The server deletes
   the old stanzas.
5. The client deletes the old private key.

The procedure can stop and continue. A stanza with the old `key_generation`
shows that the file is not done.

The file content does not change. The cost for each file is two X25519
operations and about 100 bytes.

When rotation occurs:

- when the user requests it, for example after a lost device,
- automatically at sign-in, after `rotation_upload_limit` uploads since the
  last rotation. The value is **OPEN**.

#### 8.3.4 Rotation of the root

If `root_entropy` or the passphrase is compromised, the generations give no
protection. The client makes a new `root_entropy`, a new mnemonic and a new
passphrase. Then it does the procedure of section 8.3.3. The user must save
the new mnemonic.

#### 8.3.5 Conflict with script clients

**OPEN**

A script client has `account_public_key` in its configuration (section
10.2). After a rotation, that key is old. Three solutions are possible:

1. **Accept old keys.** The client keeps old private keys to read script
   uploads. This cancels the benefit of rotation.
2. **New configuration after each rotation.** The server rejects uploads to
   an old generation. The user installs a new configuration. This is
   acceptable after a compromise. It is not acceptable for automatic
   rotation.
3. **Signed key certificate.** The account has a signing key that does not
   rotate. The script client pins that key. The signing key signs the public
   key of each generation. The script client gets the current public key
   from the server and verifies the signature.

Solution 3 keeps automatic rotation and pinned keys. It needs a signing key
that is separate from the key that rotates. This conflicts with the use of
one Ed25519 key pair for both purposes (section 4.1). The authors must
decide.

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

### 9.4 Folders, tags and OCR

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

```
https://{host}/{user}/{file_id}#{base64url(file_key)}
```

- The browser does not send the part after `#` to the server.
- The uploading client makes the link. It knows `file_key` and it gets
  `file_id` from the server.
- A person who has the link can read the file until the file is deleted.
- Account key rotation does not change `file_key`. Share links continue to
  work after a rotation.

### 10.4 Limit for declarative upload tools

A ShareX custom uploader file is a declarative HTTP description. It cannot
encrypt. It cannot add `file_key` to the URL that it copies. A helper program
must do the encryption, the upload and the copy of the link.

## 11. Plain files

**AGREED**

**Goal:** keep link previews on other sites for users who want them.

**Restriction:** a crawler does not run the client and does not get the part
of the URL after `#`. The server must give the content to the crawler. Thus a
file with a link preview cannot be encrypted.

- Encryption is the default.
- A user can upload a plain file. The user must select this for each file or
  in an upload configuration.
- The server marks each plain file. The application shows the mark.
- Link previews, server OCR and server archive tools operate only on plain
  files.

## 12. Requirements for the server and the application

**PROPOSED**

1. The application must send a Content-Security-Policy that blocks inline
   scripts and scripts from other origins.
2. The "Custom head" setting must not accept `script` or `base` elements.
3. The server must not write `auth_key`, a file key or a share link fragment
   to a log, an audit record, a webhook or a URL query.
4. A moderator permission must not give access to encrypted content.
5. The legacy upload token is stored without a hash today. The server must
   store a hash only.

## 13. Open questions

1. **Folders.** Folder names are plain text today. Shared folders have a
   server token. Does a folder get a folder key that wraps the file keys in
   it? How does a shared folder link carry that key?
2. **Tags.** Do tag names get encryption under a key of the account?
3. **OCR.** Does OCR move to the client? Where does the encrypted text go, and
   how does search use it?
4. **One key or two in `seal`.** This draft derives separate cipher and MAC
   keys. One shared key has no known attack with XChaCha20 and BLAKE3. The
   separate keys agree with the standard encrypt-then-MAC proof.
5. **Size.** Does the format pad the content to hide the exact size?
6. **Argon2id parameters.** 64 MiB and 3 passes are a first proposal. They
   must work in a browser on a slow device.
7. **Rotation and script clients.** See section 8.3.5.
8. **Rotation limit.** The value of `rotation_upload_limit`.
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

| Draft | Date       | Change                                                                                                                                  |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | 2026-11-10 | First draft.                                                                                                                            |
| 1     | 2026-11-10 | Full names for all values. Goal, idea and restriction for each section. One-page design summary. Account key rotation with generations. |
