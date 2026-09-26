---
title: Files API
description: Upload files, choose sharing options, search your library, and complete chunked uploads.
---

# Files API

File listing needs both the `files:read` scope and `files.read` on the token owner. Uploads and every chunk step need `files:upload` plus `files.upload`. Current role grants are rechecked; a stored token does not retain revoked authority. Without `files.share`, new uploads are private. An upload with expiration also needs `files.delete` for `DELETE`, or `files.share` for `SET_PRIVATE`, including expiration inherited from profiles/defaults; otherwise finalization returns `403`. See [scope and role intersection](./authentication#scopes-and-account-roles).

Use `files:upload` to add files and `files:read` to browse your account's metadata. The API uses the same storage and sharing policies as Flare's dashboard.

## Upload one file

**`POST /api/files`** · Scope: **`files:upload`** · Body: **`multipart/form-data`**

Send one file in the `file` field. Use a separate request for each file. This route streams file bytes to storage; it does not require the entire file to fit in application memory.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -F 'file=@./report.pdf;type=application/pdf' \
  -F 'visibility=PRIVATE' \
  -F 'expiration=WEEK' \
  -F 'expiryAction=DELETE' \
  "$FLARE_URL/api/files"
```

Successful uploads return **200**, with this shape:

```json
{
  "success": true,
  "data": {
    "url": "https://files.example.com/alex/report.pdf",
    "pageUrl": "https://files.example.com/alex/report.pdf",
    "rawUrl": "https://files.example.com/api/files/abc123/report.pdf",
    "downloadUrl": "https://files.example.com/api/files/cm_example/download",
    "copyText": "https://files.example.com/alex/report.pdf",
    "name": "report.pdf",
    "size": 204800,
    "type": "application/pdf"
  }
}
```

| Response field    | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `pageUrl`         | The Flare share page. Uses a vanity ID when the account has one.       |
| `url`, `copyText` | Compatibility aliases for `pageUrl`.                                   |
| `rawUrl`          | Flare's raw-content route, using the underlying account URL ID.        |
| `downloadUrl`     | Flare's download route. May redirect to storage after checking access. |
| `name`            | File's display name.                                                   |
| `size`            | File size in **bytes**.                                                |
| `type`            | MIME type associated with the stored file.                             |

Returned Flare links obey the file's sharing settings. A link to a private file is not a public access grant, and supplying the upload token to a download URL does not unlock it. Private content requires an eligible owner browser session with `files.read`, or a browser session with `content.read`. A public password-protected file requires its password for other viewers.

After an allowed download, S3 can issue a temporary signed storage URL. That URL carries its own access grant and can remain usable until its expiry even if the Flare file's visibility or password changes. Changing Flare's access settings does not recall an already issued storage URL or a downloaded copy.

Flare chooses safe URL names and handles collisions. Always use the returned URL instead of predicting a path from the original filename. The public origin in these responses comes from the operator's `NEXTAUTH_URL` setting.

### Select a profile and folder before sending bytes

Use request headers or query parameters for decisions that affect where and how the upload starts:

| Selection          | Header                         | Query alternative       | Special value                                   |
| ------------------ | ------------------------------ | ----------------------- | ----------------------------------------------- |
| Upload profile     | `X-Upload-Profile: PROFILE_ID` | `?profileId=PROFILE_ID` | `none` bypasses your account's default profile. |
| Destination folder | `X-Upload-Folder: FOLDER_ID`   | `?folderId=FOLDER_ID`   | `none` leaves the file unfiled.                 |

IDs must belong to your account. If both header and query are supplied, they must agree. A bound token cannot use a different profile or `none`.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H "X-Upload-Profile: $FLARE_PROFILE_ID" \
  -H "X-Upload-Folder: $FLARE_FOLDER_ID" \
  -F 'file=@./screenshot.png' \
  "$FLARE_URL/api/files"
```

For ordinary multipart uploads, a `profileId` or `folderId` form field cannot change a selection after the upload starts. Choose them in the header/query instead. Likewise, choose URL randomization in a saved profile or your account defaults before sending the file; a differing multipart `randomizeFileUrls` value is rejected.

### Upload options

Omitting an option inherits the selected profile or account/default value. Supplying an explicit value overrides it, subject to [bound-token restrictions](./authentication#bind-uploads-to-a-profile).

| Option              | Values                                             | Behavior                                                                                                                                                   |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visibility`        | `PUBLIC`, `PRIVATE`                                | Public files are shareable; private files require an eligible owner/admin session. Default without a profile override is `PUBLIC`.                         |
| `password`          | String, or `null`                                  | Adds a password for other viewers. Maximum 72 UTF-8 bytes. Omitted means no password unless already selected for this chunk session; empty/null clears it. |
| `expiration`        | `DISABLED`, `HOUR`, `DAY`, `WEEK`, `MONTH`         | Relative expiration. `DISABLED` explicitly turns expiration off. Month means a UTC calendar-month increment, not a fixed 30 days.                          |
| `expiresAt`         | Future ISO 8601 timestamp with timezone, or `null` | Absolute expiration override. `null` explicitly disables expiration. A supplied value takes precedence over the relative duration.                         |
| `expiryAction`      | `DELETE`, `SET_PRIVATE`                            | Delete the file or make it private when its scheduled expiration is processed.                                                                             |
| `shareStyle`        | `minimal`, `framed`, `delivery`                    | The presentation style saved for this upload's share page.                                                                                                 |
| `tagIds`            | Array of owned tag IDs, maximum 20                 | Adds the selected profile/manual tags. For multipart forms, send a JSON array encoded as a string.                                                         |
| `randomizeFileUrls` | Boolean                                            | Randomized URL naming. Set before upload via profile/account settings, or in the chunk initialization JSON.                                                |
| `profileId`         | Owned profile ID, or `null`                        | Selects a profile. For multipart use the header/query described above; chunk initialization also accepts JSON.                                             |
| `folderId`          | Owned folder ID, or `null`                         | Selects a destination folder. This is a request option, not a saved profile option.                                                                        |

Multipart fields are strings: use `true`/`false` for booleans, and an empty string or `null` string for nullable `password`, `expiresAt`, `profileId`, and `folderId`. In JSON bodies use actual booleans, arrays, and `null`.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -F 'file=@./diagram.png' \
  -F 'tagIds=["TAG_ID"]' \
  -F 'shareStyle=minimal' \
  -F 'expiration=DISABLED' \
  "$FLARE_URL/api/files"
```

Base defaults are public visibility, no expiration, delete on expiration, original-name URLs, no tags, and framed sharing. Account defaults supply naming and expiration settings, and the instance's published sharing configuration supplies the base share style. A selected profile overrides those defaults; permitted request options take final precedence. The retired `copyFormat` option is ignored for compatibility.

### Upload errors and limits

| Status | Common cause                                                                                                                                                    | Recovery                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `400`  | Missing file; wrong content type; invalid options; changing profile/folder/naming too late; duplicate chunk part; expiration already passed; file type mismatch | Fix the request. Select profile and folder before upload.                                                     |
| `401`  | Authentication or scope failure                                                                                                                                 | Check the [authentication guide](./authentication).                                                           |
| `403`  | Profile binding conflict; token invalidated before finalization                                                                                                 | Use the allowed profile or replace the credential.                                                            |
| `404`  | Selected profile/folder/tag or chunk session not found                                                                                                          | Verify ownership and IDs. Start a new chunk session if it expired.                                            |
| `409`  | Storage configuration changed during chunk upload; part sent after completion                                                                                   | Start again after a storage change. Do not upload new parts to a completed session.                           |
| `413`  | Instance upload limit, remaining quota, or part-size limit exceeded                                                                                             | Check the instance limit, free storage, or send smaller parts.                                                |
| `429`  | Too many upload starts                                                                                                                                          | Honor `Retry-After: 60`.                                                                                      |
| `500`  | Upload/storage operation failed                                                                                                                                 | Check instance health and operator logs. Avoid blindly repeating a multipart upload if its response was lost. |

`POST /api/files` and `POST /api/files/chunks` share a limit of **30 requests per 60 seconds per client IP per application process**. It runs before authentication. Limits reset on process restart and are not a distributed rate-limit service. Proxies should supply accurate client IP headers. Other file-read and part/completion routes do not use this upload-start limiter.

Maximum file size and quota are operator settings, not fixed API constants. Flare uses powers of 1024 for its MB/GB limits. Accounts with `quotas.bypass` or Administrator are exempt from the default quota, but still subject to the maximum upload size. Quota and size are checked again when a file is finalized, so concurrent uploads cannot rely only on the earlier quota check.

The server checks detected file bytes against the claimed MIME type. A successful file-ready event means the upload was committed; optional OCR may finish later. Ordinary multipart uploads have no idempotency-key parameter: retrying after a lost response can create another file.

## List and search files

**`GET /api/files`** · Scope: **`files:read`**

Returns only files owned by the authenticated account, including its private files. Results use deterministic ordering and include pagination metadata.

```sh
curl --fail-with-body --get \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  --data-urlencode 'search=invoice' \
  --data-urlencode 'types=application/pdf,image/png' \
  --data-urlencode 'sortBy=newest' \
  --data-urlencode 'limit=24' \
  "$FLARE_URL/api/files"
```

| Parameter          | Default        | Meaning                                                                                                                                                        |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`             | `1`            | Positive integer, starting at 1.                                                                                                                               |
| `limit`            | `24`           | Positive integer, capped at 100.                                                                                                                               |
| `search`           | Empty          | Case-insensitive match against filename or stored OCR text.                                                                                                    |
| `sortBy`           | `newest`       | `newest`, `oldest`, `largest`, `smallest`, `name`, `most-viewed`, `least-viewed`, `most-downloaded`, `least-downloaded`. Unrecognized values use newest order. |
| `types`            | All types      | Comma-separated exact MIME types, such as `image/png,image/jpeg`.                                                                                              |
| `dateFrom`         | No lower bound | Inclusive upload date/time lower bound. Prefer ISO 8601 timestamps with a timezone.                                                                            |
| `dateTo`           | No upper bound | Inclusive upper bound. A date-only value includes the final day using server-local time; explicit timestamps preserve the supplied instant.                    |
| `visibility`       | All files      | Comma-separated `public`, `private`, `hasPassword`. Multiple values are ORed together.                                                                         |
| `folder`           | All folders    | Owned folder ID or `unfiled`. A folder filter matches that folder directly, not its descendants.                                                               |
| `tag`              | All tags       | Owned tag ID or `untagged`. Excluded automatic tags do not count as active tags.                                                                               |
| `galleryAnchor`    | None           | An image's file ID, used together with `galleryDirection` for neighboring images.                                                                              |
| `galleryDirection` | None           | `next` or `previous`; requires `galleryAnchor`.                                                                                                                |

Different filter categories combine with AND. For example, `types=image/png&visibility=private,hasPassword` returns PNGs that are private **or** password-protected.

```json
{
  "success": true,
  "data": [
    {
      "id": "cm_example",
      "name": "invoice.png",
      "urlPath": "/abc123/invoice.png",
      "mimeType": "image/png",
      "size": 0.1953125,
      "uploadedAt": "2026-09-20T12:00:00.000Z",
      "visibility": "PRIVATE",
      "views": 0,
      "downloads": 0,
      "folderId": null,
      "user": { "urlId": "abc123" },
      "tags": [{ "id": "TAG_ID", "name": "Finance" }],
      "hasPassword": false,
      "expiresAt": null
    }
  ],
  "pagination": { "total": 1, "pageCount": 1, "page": 1, "limit": 24 }
}
```

::: warning Size units differ by endpoint
The file list's `size` is in **MiB** (`bytes / 1,048,576`). Upload responses and webhook `sizeBytes` are in **bytes**. Convert explicitly when comparing them.
:::

The response excludes password hashes and OCR text. `hasPassword` indicates protection; search can match OCR without returning the text itself. `expiresAt` is a timestamp or `null`. An empty library has `data: []`, `total: 0`, and `pageCount: 0`. List responses include `Cache-Control: private, no-store`.

Normal pages use offsets, so a library changing between requests can move entries between pages. For image navigation, provide both gallery parameters. Anchored requests restrict results to images within your other filters, exclude the anchor itself, and return neighbors in the requested direction. Their pagination also includes an `offset`. A missing or filtered-out anchor returns `404`; supplying only one gallery parameter returns `400`.

## Discover file types

**`GET /api/files/types`** · Scope: **`files:read`**

Returns the distinct MIME types currently present in your account, sorted alphabetically. This is not a list of server-allowed upload formats.

```json
{
  "success": true,
  "data": { "types": ["application/pdf", "image/jpeg", "image/png"] }
}
```

## Chunked uploads

Chunked uploads let a client transfer parts before finalizing one file. Both local and S3 storage support Flare's authenticated part-upload route. S3 can additionally provide direct presigned part URLs.

All steps require **`files:upload`**. Use the same account throughout and keep the returned `uploadId` and each part's ETag. Flare's dashboard uses 5 MiB parts; choose part sizes compatible with your storage provider. Parts sent through Flare must be at most **64 MiB** and cannot exceed the declared total file size.

### 1. Start the upload

**`POST /api/files/chunks`** · Body: **`application/json`**

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"filename":"archive.zip","mimeType":"application/zip","size":10485760,"visibility":"PRIVATE"}' \
  "$FLARE_URL/api/files/chunks"
```

Required fields are `filename` (1–255 characters), `mimeType` (1–255 characters), and `size` (positive integer **bytes**). The body also accepts the upload options above, including `profileId`, `folderId`, and `randomizeFileUrls`. Header/query profile/folder choices must agree with JSON choices if both are present. Unknown JSON fields are rejected, except the retired `copyFormat` compatibility field.

```json
{
  "data": {
    "uploadId": "0123456789abcdef0123456789abcdef",
    "fileKey": "uploads/abc123/unique-object/archive.zip"
  }
}
```

Treat `fileKey` as an opaque internal key. It is not a share link or proof that a file has been published.

### 2. Upload parts through Flare

**`PUT /api/files/chunks/{uploadId}/part/{partNumber}`** · Body: **raw file bytes**

```sh
curl --fail-with-body --request PUT \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary '@./part-1.bin' \
  "$FLARE_URL/api/files/chunks/$UPLOAD_ID/part/1"
```

```json
{ "data": { "etag": "\"provider-etag\"" } }
```

Number parts from 1 through 10,000. Save the exact returned `data.etag`, including any quote characters in the value. The response field is lowercase `etag`; completion expects uppercase **`ETag`**. Retry a part using the same part number if necessary, and retain the ETag from the successful final write.

### Optional: send parts directly to S3

**`GET /api/files/chunks/{uploadId}/part/{partNumber}`** returns:

```json
{ "data": { "url": "https://storage.example.com/presigned-part-url" } }
```

For S3, PUT the raw part bytes to that URL and retain the storage response's `ETag` header. The URL already carries storage authorization; **do not send your Flare bearer token to it**. Presigned URLs expire after one hour. Browser clients also need appropriate storage CORS rules, including access to the ETag response header.

For local storage, the returned value uses the `local://` scheme and cannot be fetched over HTTP. Upload via Flare's authenticated PUT route instead.

The compatibility endpoint **`GET /api/files/chunks?uploadId=…&partNumber=…`** performs the same lookup but returns both aliases: `{ "data": { "url": "…", "presignedUrl": "…" } }`. It is a part-URL endpoint, not a status or list-parts endpoint.

### 3. Complete the upload

**`POST /api/files/chunks/{uploadId}/complete`** · Body: **`application/json`**

```json
{
  "parts": [
    { "PartNumber": 1, "ETag": "\"first-etag\"" },
    { "PartNumber": 2, "ETag": "\"second-etag\"" }
  ]
}
```

Send every part once. There must be 1–10,000 entries with unique integer part numbers. ETags must be nonempty strings of at most 512 characters. Flare sorts parts by number, assembles the object, verifies its actual size equals your declared size, rechecks policy, and creates the file.

This endpoint returns the **upload-link object directly**:

```json
{
  "url": "https://files.example.com/abc123/archive.zip",
  "pageUrl": "https://files.example.com/abc123/archive.zip",
  "rawUrl": "https://files.example.com/api/files/abc123/archive.zip",
  "downloadUrl": "https://files.example.com/api/files/cm_example/download",
  "copyText": "https://files.example.com/abc123/archive.zip",
  "name": "archive.zip",
  "size": 10485760,
  "type": "application/zip"
}
```

Alternatively, **`PUT /api/files/chunks`** accepts the same body plus `uploadId` and returns **`{ "data": { ...uploadLinks } }`**. Use one completion route consistently in your client.

Completion accepts permitted upload-option overrides, but cannot change the profile, folder, or naming strategy chosen at initialization. Bound-token restrictions still apply. Repeating completion after a lost response returns the existing file while the upload session remains available; it does not publish another copy or enqueue another normal file-ready event.

### Session lifetime and recovery

Upload metadata expires after **one hour of inactivity**. Requesting a part URL or successfully sending a part updates activity. Completion does not create an indefinite retention guarantee. The session ID is scoped to its account and, for bound tokens, its profile.

Metadata is stored under `tmp/uploads` on the application filesystem. Multi-replica deployments must ensure all requests for a chunk session can reach its metadata and, for local storage, its temporary parts. An ephemeral restart can lose an in-progress upload even when finalized files are safely stored in S3.

Changing storage provider/configuration during an upload causes `409`; start again against the current storage. Each new chunk session also records the actual provider identity that initialized its parts. Part-URL, part-write, and completion requests return `409` when that provider differs or the session lacks recorded provenance, including sessions started before the storage-provenance upgrade. Restart the entire affected upload with a new initialization request; repeatedly resending completion or old part numbers cannot repair it. Successfully completed files and successful request/response formats are unchanged. Flare currently has no API for cancelling a chunk session or querying which parts were uploaded. Preserve your own part state, let stale sessions expire, and configure storage cleanup for abandoned multipart objects as part of server operations.
