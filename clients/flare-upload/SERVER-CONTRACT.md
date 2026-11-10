# The HTTP contract between flare-upload and Flare

This file states each request that `flare-upload` sends and each answer it
reads. The rules for the bytes are in
[`docs/e2ee-spec.md`](../../docs/e2ee-spec.md); section numbers below refer
to it. The browser application sends the same upload requests with a session
cookie in place of the token, so one contract exists.

The server side is `lib/uploads/direct.ts`, `lib/uploads/chunks.ts`,
`lib/uploads/encrypted.ts`, `lib/files/encrypted.ts` and
`lib/uploads/encryption-policy.ts`. The mock server of
`tests/mock_server.rs` and `scripts/e2ee/verify-script-upload.cjs` check this
file against the program and against the real server.

## Encodings

| Value                 | Form                                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| Binary value in text  | base64url without padding (section 4.4, rule 14).                               |
| Stanza, sealed record | `0x01 \|\| record`: the `record_version` byte, then the record (rule 12).       |
| File header           | The 26 bytes of section 7.2, without a version byte of its own.                 |
| Public key            | 32 bytes, without a version byte.                                               |
| Boolean in a field    | The text `true` or `false`.                                                     |
| Origin                | `https://host[:port]`. `http://` is accepted for `localhost` and loopback only. |

All addresses below are relative to the origin of the configuration.

## What the server never receives

`file_key`, `link_secret`, the password, the name and the type of an
encrypted file, and any private key. The name and the type travel only
inside `sealedMetadata`. The part of a share link after `#` is never in a
request. The token is in the `Authorization` header only, never in a URL.

## 1. Protocol versions

`GET /api/settings`, without an `Authorization` header.

```json
{
  "success": true,
  "data": {
    "version": "…",
    "encryption": { "protocolVersions": [1], "forbidPlainUploads": false },
    "settings": {}
  }
}
```

The program reads `data.encryption.protocolVersions` before each encrypted
run (section 1.5.3, rule 5). If the list does not hold its version, or the
field is absent, it sends nothing more and exits with code 4. A plain upload
uses no protocol version and skips this request.

## 2. Encrypted upload in one request

For a plaintext of at most 8 MiB.

```
POST /api/files
Authorization: Bearer <token>
X-Flare-Encrypted: true
X-Upload-Profile: <profile_id>        (if the configuration names a profile)
X-Upload-Folder: <folder_id>          (if the configuration names a folder)
Content-Type: multipart/form-data; boundary=…
Content-Length: <exact length>
```

The form fields come first, in this sequence, then the file part.

| Field                    | Required | Content                                                                                                                |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `header`                 | yes      | base64url of the 26 header bytes.                                                                                      |
| `sealedMetadata`         | yes      | base64url of `0x01 \|\| sealed_metadata` (section 9.1). The plaintext is `{"name": …, "type": …}`. At most 4097 bytes. |
| `accountStanza`          | yes      | base64url of `0x01 \|\| account_stanza` (section 8.1): 97 bytes.                                                       |
| `stanzaAccountPublicKey` | yes      | base64url of the `account_public_key` that the stanza is for: the pinned key of the configuration.                     |
| `passwordStanza`         | no       | base64url of `0x01 \|\| password_stanza` (section 8.2): 217 bytes. Only with `--password`.                             |
| `folderStanza`           | no       | base64url of `0x01 \|\| stanza`: 97 bytes. See below.                                                                  |
| `folderPublicKey`        | no       | base64url of the `folder_public_key` that `folderStanza` is for.                                                       |
| `rulesApplied`           | yes      | Always `false`: the program has no key that opens tag rules (section 9.7).                                             |
| `isImage`                | yes      | `true` if the type of the file starts with `image/`, else `false`.                                                     |
| `visibility`             | no       | `PUBLIC` or `PRIVATE`, if the configuration sets it.                                                                   |
| `expiration`             | no       | `DISABLED`, `HOUR`, `DAY`, `WEEK` or `MONTH`, if the configuration sets it.                                            |
| `file`                   | yes      | File part with `filename="encrypted"` and `Content-Type: application/octet-stream`. The body is the encrypted file.    |

The body of the file part is `header || stored chunks` (sections 7.2 and
7.3). Its first 26 bytes equal the `header` field. Its length is
`26 + plaintext_length + 32 * chunk_count`.

`folderStanza` is sent only when the configuration has `folder_public_key`
and `visibility` is `PUBLIC` (section 8.4.3). Without a password it is the
`folder_file_stanza`. With a password it is the `folder_link_secret_stanza`.

The program sends no `sealedOcrText`, `sealedThumbnail`, `ruleTagIds` or
`thumbnail`: it does no text recognition, makes no thumbnail and applies no
tag rule. The browser of the owner does that work later (section 9.7). The
server accepts those fields from a client that does the work.

The server refuses each other field with `400`. A field such as `name`,
`filename`, `mimeType` or `password` could only be a secret sent by mistake.

Answer, `200`:

```json
{
  "success": true,
  "data": {
    "encrypted": true,
    "id": "cm…",
    "url": "https://host/alex/e_3kGq0v8mJtYw2nHc5sLp7A",
    "pageUrl": "https://host/alex/e_3kGq0v8mJtYw2nHc5sLp7A",
    "size": 12345
  }
}
```

The program requires `encrypted: true` and takes only the **path** of
`pageUrl`. The link it prints is

```
{origin of the configuration}{path of pageUrl}#{base64url(file_key)}
{origin of the configuration}{path of pageUrl}#p.{base64url(link_secret)}
```

(section 10.3). The server cannot move a key to a different host. A
`pageUrl` with a query, a fragment or other characters is refused and no
link is printed.

## 3. Encrypted upload in parts

For a larger plaintext.

### Start

```
POST /api/files/chunks
Authorization: Bearer <token>
Content-Type: application/json
X-Upload-Profile, X-Upload-Folder as above
```

```json
{
  "encrypted": true,
  "size": 9442657,
  "header": "…",
  "sealedMetadata": "…",
  "accountStanza": "…",
  "stanzaAccountPublicKey": "…",
  "rulesApplied": "false",
  "isImage": "true"
}
```

`size` is the length of the encrypted file. The other fields are the form
fields of section 2 with the same text values, also `rulesApplied` and
`isImage`. `filename`, `mimeType` and `password` are refused.

The server checks the records, the size, the `encryption` setting of the
profile and `stanzaAccountPublicKey` now, before any part is sent.

Answer, `200`: `{ "data": { "uploadId": "…", "fileKey": "…" } }`. The program
uses `uploadId`.

### Parts

```
PUT /api/files/chunks/{uploadId}/part/{n}        n = 1, 2, …
Authorization: Bearer <token>
Content-Type: application/octet-stream
Content-Length: <part length>
```

The body is the next bytes of the encrypted file. Each part except the last
has 5 245 440 bytes (80 stored chunks), more for a file that would otherwise
need over 10 000 parts, and at most 64 MiB. Answer, `200`:
`{ "data": { "etag": "…" } }`.

### Completion

```
POST /api/files/chunks/{uploadId}/complete
Authorization: Bearer <token>
Content-Type: application/json

{ "parts": [ { "ETag": "…", "PartNumber": 1 }, … ] }
```

Answer, `200`: the object of section 2 **without** the `data` envelope:
`{ "encrypted": true, "id": …, "url": …, "pageUrl": …, "size": … }`.

## 4. Plain upload

With a configuration in `plain` mode the program sends what Flare's
declarative tool configurations send. The server can read the file.

- One request: `POST /api/files`, no `X-Flare-Encrypted` header, the file
  part with the real name and type, and the optional `visibility` and
  `expiration` fields. Answer: `data.url`, which the program prints as it
  is.
- In parts: `POST /api/files/chunks` with `filename`, `mimeType`, `size`
  and the optional fields, then the part and completion requests of
  section 3.

## 5. Errors

An error answer is JSON with a message for a person and, where a client
must act on it, a `code`:

```json
{
  "error": "This upload profile takes plain uploads, and …",
  "code": "profile_requires_plain"
}
```

| Status | `code`                          | Meaning                                                                                                         | Exit code |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| 409    | `account_key_not_current`       | `stanzaAccountPublicKey` is not the current key of the account: a key rotation happened (section 8.3.6).        | 3         |
| 409    | `account_keys_missing`          | The account has no keys on this server.                                                                         | 3         |
| 401    | none                            | The token is revoked, expired or unknown. A key rotation cancels each token.                                    | 3         |
| 400    | `protocol_version_not_accepted` | The header or a record has a version that the server does not accept.                                           | 4         |
| 403    | `profile_requires_encrypted`    | A plain upload to a profile whose `encryption` is `encrypted` (section 11.2).                                   | 5         |
| 403    | `profile_requires_plain`        | An encrypted upload to a profile whose `encryption` is `plain`.                                                 | 5         |
| 403    | `plain_uploads_forbidden`       | The administrator forbids plain uploads (section 11.1).                                                         | 5         |
| 403    | `token_predates_encryption`     | An encrypted upload with a token from before the upgrade. Such a token uploads plain files only (section 14.4). | 5         |
| other  | any                             | Each other refusal: a size limit (`413`), a rate limit (`429`), a record that is not valid (`400`).             | 1         |

The program prints `error` as one line, without control characters and cut
at 300 characters. For exit codes 3 and 4 it prints its own instruction:
download a new configuration, or update the program.

## Rules for the token

| Token                                           | Encrypted upload                    | Plain upload                        |
| ----------------------------------------------- | ----------------------------------- | ----------------------------------- |
| New token, profile with `encryption: encrypted` | accepted                            | `profile_requires_encrypted`        |
| New token, profile with `encryption: plain`     | `profile_requires_plain`            | accepted                            |
| New token, no profile resolved                  | accepted (the default is encrypted) | `profile_requires_encrypted`        |
| Token from before the upgrade                   | `token_predates_encryption`         | accepted, whatever the profile says |
| Any, with "Forbid plain uploads" on             | as above                            | `plain_uploads_forbidden`           |

A token that is bound to a profile cannot select a different profile, and
cannot send a `visibility` or `expiration` that is different from the
profile: the server answers `403`.
