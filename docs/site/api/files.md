---
title: Files API
description: Upload files, choose sharing options, search your library, and complete chunked uploads.
---

# Files API

File listing needs both the `files:read` scope and `files.read` on the token owner. Uploads and every chunk step need `files:upload` plus `files.upload`. Current role grants are rechecked; a stored token does not retain revoked authority. Without `files.share`, new uploads are private. An upload with expiration also needs `files.delete` for `DELETE`, or `files.share` for `SET_PRIVATE`, including expiration inherited from profiles/defaults; otherwise finalization returns `403`. See [scope and role intersection](./authentication#scopes-and-account-roles).

Use `files:upload` to add files and `files:read` to browse your account's metadata. The API uses the same storage and sharing policies as Flare's dashboard.

Archive uploads use the same upload contract and remain single stored files. [Archive APIs](./archives) provide owner-session browsing/extraction/creation and separate share-page browsing/entry downloads. Share reads use the file's visibility/password rules, while extraction and creation remain owner-only. Neither `files:read` nor `files:upload` authorizes these routes; existing named-token operations and response shapes are unchanged.

## Upload one file

**`POST /api/files`** · Scope: **`files:upload`** · Body: **`multipart/form-data`**

Send one file in the `file` field. Use a separate request for each file. This route streams file bytes to storage; it does not require the entire file to fit in application memory.

This request uploads a **plain** file. A token created after the upgrade to end-to-end encryption may send it only through an upload profile whose **Encryption** is **Plain**; [which uploads a token may send](#which-uploads-a-token-may-send) has the rules, and [encrypted uploads from a token](#encrypted-uploads-from-a-token) the other request.

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

The URL name is built from the original filename, which is kept unchanged as the display name:

- The part after the last dot is the extension only when it is 1 to 16 ASCII letters or digits. It is lowercased. Otherwise the dot and that part stay in the name, so `notes 2026.10.25 final` has no extension.
- The rest is lowercased, and each run of characters other than ASCII letters and digits becomes one hyphen, with none at either end. `My Report.PDF` becomes `my-report.pdf`, and `notes.h#ml` becomes `notes-h-ml`.
- A name with no ASCII letters or digits, such as `日本語.png`, gets six random URL-safe characters before its extension, for example `x7Kp2a.png`. Randomized naming uses the same random part and extension rule for every file.
- If the URL is already used in your account, the upload is published with a hyphen and 12 characters of a random ID before the extension, such as `my-report-3f9c2a71-b04.pdf`.

Uploads made before this rule kept their URLs. Earlier builds could put spaces, capitals, `#`, or a leading dot in new URL names, for example `My Report-1.PDF` or `.png`; those links keep working unchanged.

Signed-out visitors can open a public file's share page, `/raw`, and `/direct` whether or not its URL name has an extension. Earlier builds sent them to the sign-in page instead when the name had no extension, such as `/abc12/readme`, or started with a dot, such as `/abc12/.png`; those links now open too. Private files and passwords are checked by the routes as before. A first path segment that belongs to Flare itself (`api`, `auth`, `dashboard`, `admin`, `settings`, `setup`, `raw`, `direct`, `u`, `profile`, `avatars`, or `_next`) is never read as a URL ID, which is also why vanity IDs can't use those words and new accounts never get one as their URL ID. A first segment longer than 32 characters can't be a URL ID or vanity ID, so signed-out visitors are sent to sign in, as for any other page; earlier builds passed 33-character segments on to the share page.

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

For ordinary multipart uploads, a `profileId` or `folderId` form field cannot change a selection after the upload starts. Choose them in the header/query instead. Likewise, choose URL randomization in a saved profile or your account defaults before sending the file; a differing multipart `randomizeFileUrls` value is rejected. These refusals are the same as when [completing a chunked upload](#chunked-uploads): a different `profileId` answers `403` with `The upload profile cannot change after upload starts.`, and a different `randomizeFileUrls` `400` with `The naming strategy cannot change after upload starts.` Earlier versions answered both with `400` on direct uploads, with `Select the profile using X-Upload-Profile before uploading.` and `Select a naming strategy in your upload profile.`

### Upload options

Omitting an option inherits the selected profile or account/default value. Supplying an explicit value overrides it, subject to [bound-token restrictions](./authentication#bind-uploads-to-a-profile).

| Option              | Values                                             | Behavior                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visibility`        | `PUBLIC`, `PRIVATE`                                | Public files are shareable; private files require an eligible owner/admin session. Default without a profile override is `PUBLIC`.                                                                                                                |
| `password`          | String, or `null`                                  | Adds a password for other viewers: at least 8 characters and at most 72 UTF-8 bytes; otherwise `400`. Omitted means no password unless already selected for this chunk session; empty/null clears it.                                             |
| `expiration`        | `DISABLED`, `HOUR`, `DAY`, `WEEK`, `MONTH`         | Relative expiration. `DISABLED` explicitly turns expiration off. Month means a UTC calendar-month increment, not a fixed 30 days.                                                                                                                 |
| `expiresAt`         | Future ISO 8601 timestamp with timezone, or `null` | Absolute expiration override. `null` explicitly disables expiration. A supplied value takes precedence over the relative duration. The timezone is `Z` or an offset from `-23:59` to `+23:59`, such as `+02:00` or `+0200`; seconds are optional. |
| `expiryAction`      | `DELETE`, `SET_PRIVATE`                            | Delete the file or make it private when its scheduled expiration is processed.                                                                                                                                                                    |
| `shareStyle`        | `minimal`, `framed`, `delivery`                    | The presentation style saved for this upload's share page.                                                                                                                                                                                        |
| `tagIds`            | Array of owned tag IDs, maximum 20                 | Adds the selected profile/manual tags. For multipart forms, send a JSON array encoded as a string.                                                                                                                                                |
| `randomizeFileUrls` | Boolean                                            | Randomized URL naming. Set before upload via profile/account settings, or in the chunk initialization JSON.                                                                                                                                       |
| `profileId`         | Owned profile ID, or `null`                        | Selects a profile. For multipart use the header/query described above; chunk initialization also accepts JSON.                                                                                                                                    |
| `folderId`          | Owned folder ID, or `null`                         | Selects a destination folder. This is a request option, not a saved profile option.                                                                                                                                                               |

Multipart fields are strings: use `true`/`false` for booleans, and an empty string or `null` string for nullable `password`, `expiresAt`, `profileId`, and `folderId`. In JSON bodies use actual booleans, arrays, and `null`.

Flare records `expiresAt` as a UTC instant: `2026-11-06T12:00+0200` is saved as `2026-11-06T10:00:00.000Z` and expires at that moment. Earlier versions saved the value exactly as sent, and an upload whose `expiresAt` used any other form, including `Z` without milliseconds, never expired: the file kept its visibility and storage, and the library stopped showing its expiration. Uploads from the web app always sent the `.000Z` form and were not affected. Files still waiting for their time now expire on schedule. For a file whose time already passed, set the expiration again from **Files → file menu → Manage expiration**, or with `POST /api/files/{id}/expiry` using a browser session or the legacy upload token ([endpoint inventory](./endpoint-inventory#dashboard-routes-using-the-shared-account-helper)).

`POST /api/files/{id}/expiry` takes JSON with `expiresAt`, a future time in the same form as an upload's `expiresAt`, and `action`, `DELETE` (the default) or `SET_PRIVATE`, which needs the same permission as on an upload; `DELETE` on that address removes the schedule. Both answer `404` with `File not found` for a file that isn't yours, including one deleted while the request was waiting. Earlier versions also accepted any date JavaScript could read, such as `2026-11-06 12:00` without a timezone, read in the server's time zone; such a value now answers `400` with `Invalid expiration date. Use an ISO 8601 timestamp with a timezone.` They answered `500` when the file was deleted while scheduling, and `200` with `No expiration found` while removing.
Earlier versions accepted file passwords of any length up to 72 bytes. Clients that send a password shorter than 8 characters now receive `400` with `{"error":"File passwords must be at least 8 characters."}` and no file is created, so update scripts and screenshot-tool configurations that set one. `PATCH /api/files/{id}` applies the same rule when protecting an existing file. Passwords already stored on files keep working.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -F 'file=@./diagram.png' \
  -F 'tagIds=["TAG_ID"]' \
  -F 'shareStyle=minimal' \
  -F 'expiration=DISABLED' \
  "$FLARE_URL/api/files"
```

Base defaults are public visibility, no expiration, delete on expiration, original-name URLs, no tags, and framed sharing. Account defaults supply naming and expiration settings, and the instance's published sharing configuration supplies the base share style. A selected profile overrides those defaults; permitted request options take final precedence. The retired `copyFormat` option is ignored for compatibility, in requests and in saved profiles alike. A saved profile option Flare can't read answers `500` with `Upload could not be completed.`; earlier versions answered `400` with `Invalid upload options.` and logged nothing.

### Upload errors and limits

| Status | Common cause                                                                                                                                                    | Recovery                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Missing file; wrong content type; invalid options; changing the folder or naming too late; duplicate chunk part; expiration already passed; file type mismatch  | Fix the request. Select profile and folder before upload.                                                                     |
| `401`  | Authentication or scope failure                                                                                                                                 | Check the [authentication guide](./authentication).                                                                           |
| `403`  | Profile binding conflict; changing the profile once the upload has started; token invalidated before finalization; a browser-session upload from another origin | Use the allowed profile or replace the credential.                                                                            |
| `404`  | Selected profile/folder/tag or chunk session not found                                                                                                          | Verify ownership and IDs. Start a new chunk session if it expired.                                                            |
| `409`  | Storage configuration changed during chunk upload; part sent after completion                                                                                   | Start again after a storage change. Do not upload new parts to a completed session.                                           |
| `413`  | Instance upload limit, remaining quota, or part-size limit exceeded                                                                                             | Check the instance limit, free storage, or send smaller parts.                                                                |
| `415`  | A browser session sent a chunk step's JSON with another content type                                                                                            | Send `Content-Type: application/json`, as the [browser-session write rule](./authentication#browser-session-writes) requires. |
| `429`  | Too many upload starts                                                                                                                                          | Honor `Retry-After: 60`.                                                                                                      |
| `500`  | Upload/storage operation failed, or saved settings or profile options Flare can't read; the server logs the cause                                               | Check instance health and operator logs. Avoid blindly repeating a multipart upload if its response was lost.                 |

`POST /api/files` and `POST /api/files/chunks` share a limit of **30 requests per 60 seconds per client IP per application process**. It runs before authentication. Limits reset on process restart and are not a distributed rate-limit service. Proxies should supply accurate client IP headers. Other file-read and part/completion routes do not use this upload-start limiter.

Direct uploads and chunk parts can use the full limits described here. Earlier builds truncated any API request body over 10 MB, so direct uploads above that failed with `500`, and uploads with larger parts failed at completion with `400`; see [aligning upload limits](/hosting/reverse-proxy#align-all-upload-limits). Maximum file size and quota are operator settings, not fixed API constants. Flare uses powers of 1024 for its MB/GB limits. Accounts with `quotas.bypass` or Administrator are exempt from the default quota, but still subject to the maximum upload size. Quota and size are checked again when a file is finalized, so concurrent uploads cannot rely only on the earlier quota check. A file over the maximum file size answers `413` with `{"error":"A file exceeds the upload size limit."}`, and one over the remaining quota with `{"error":"This would exceed your storage quota."}`, whether a direct upload, chunk initialization or finalization finds it. Earlier versions worded these four ways, including `You have reached your storage quota.` when no quota was left and `The file exceeds the current upload size limit.` at finalization.

The server checks detected file bytes against the claimed MIME type. A successful file-ready event means the upload was committed; optional OCR may finish later. Ordinary multipart uploads have no idempotency-key parameter: retrying after a lost response can create another file.

Multipart filenames are read as UTF-8, which is what browsers, curl, and most HTTP libraries send, so `café 日本語.png` is stored as written. A client can instead declare the encoding with an RFC 5987 `filename*` parameter, such as `filename*=UTF-8''caf%C3%A9.png`. Builds before this change decoded a plain `filename` as Latin-1, so names with non-ASCII characters were stored garbled; those files keep their stored names.

If Flare rejects an upload after reading the filename but before storing the bytes, for example because of its name or upload options, it answers at once with the error and discards the rest of the request body. Earlier builds could leave such a request waiting with no response until the client timed out.

A multipart upload that exceeds the maximum file size or the remaining quota always returns `413`. Flare stops reading the body as soon as either limit is reached and keeps none of the file, even when the limit is reached before Flare has started writing to storage. Earlier builds could miss the limit when it was reached before Flare had prepared the upload's destination, which is likely when little quota remains and the request arrives quickly. They then stored the first part of the file and returned success: with 1 KB of quota left, a 64 KB upload was saved as a 1,024-byte file. Check recent uploads from accounts close to their quota if the file sizes look wrong.

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

| Parameter          | Default        | Meaning                                                                                                                                                                             |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`             | `1`            | Positive integer, starting at 1.                                                                                                                                                    |
| `limit`            | `24`           | Positive integer, capped at 100.                                                                                                                                                    |
| `ids`              | All files      | One comma-separated list of 1–100 distinct file IDs, each 1–128 characters without whitespace or ASCII control characters. Combined with ownership and every other supplied filter. |
| `search`           | Empty          | Case-insensitive match against filename or stored OCR text.                                                                                                                         |
| `sortBy`           | `newest`       | `newest`, `oldest`, `largest`, `smallest`, `name`, `most-viewed`, `least-viewed`, `most-downloaded`, `least-downloaded`. Unrecognized values use newest order.                      |
| `types`            | All types      | Comma-separated exact MIME types, such as `image/png,image/jpeg`.                                                                                                                   |
| `dateFrom`         | No lower bound | Inclusive upload date/time lower bound. Prefer ISO 8601 timestamps with a timezone.                                                                                                 |
| `dateTo`           | No upper bound | Inclusive upper bound. A date-only value includes the final day using server-local time; explicit timestamps preserve the supplied instant.                                         |
| `visibility`       | All files      | Comma-separated `public`, `private`, `hasPassword`. Multiple values are ORed together. `public` and `private` match in any letter case; `hasPassword` only as written.              |
| `folder`           | All folders    | Owned folder ID or `unfiled`. A folder filter matches that folder directly, not its descendants.                                                                                    |
| `tag`              | All tags       | Owned tag ID or `untagged`. Excluded automatic tags do not count as active tags.                                                                                                    |
| `snapshot`         | No ceiling     | Inclusive upload timestamp ceiling returned by the timeline endpoint; send it unchanged on each window request.                                                                     |
| `galleryAnchor`    | None           | An image's file ID, used together with `galleryDirection` for neighboring images.                                                                                                   |
| `galleryDirection` | None           | `next` or `previous`; requires `galleryAnchor`.                                                                                                                                     |

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
      "expiresAt": null,
      "expiryAction": null
    }
  ],
  "pagination": { "total": 1, "pageCount": 1, "page": 1, "limit": 24 }
}
```

::: warning Size units differ by endpoint
The file list's `size` is in **MiB** (`bytes / 1,048,576`). Upload responses and webhook `sizeBytes` are in **bytes**. Convert explicitly when comparing them.
:::

To refresh metadata for a retained selection, send only `ids` and `limit=100`, without search, date, folder, tag, or snapshot filters. Results still use the requested sort order, not ID-input order. Match rows by `id`. Deleted files and IDs belonging to another account are omitted without revealing which case applies; compare the returned IDs with your selection before offering a bulk operation. This remains a metadata read: it does not grant file-content access or lock the files against later changes. Existing list requests without `ids` behave as before.

Set `FLARE_FILE_IDS` to comma-separated IDs from your own file-list response.

```sh
curl --fail-with-body --get \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  --data-urlencode "ids=$FLARE_FILE_IDS" \
  --data-urlencode 'limit=100' \
  "$FLARE_URL/api/files"
```

Empty IDs, duplicate IDs, whitespace or ASCII control characters, overlong IDs, more than 100 IDs, or repeated `ids` parameters return `400`. The regular page and limit rules still apply; omitting `limit` returns at most 24 records.

The response excludes password hashes and OCR text. `hasPassword` indicates protection; search can match OCR without returning the text itself. `expiresAt` is when the file's earliest pending expiration runs, or `null`, and `expiryAction` is what that expiration does: `DELETE` or `SET_PRIVATE`, or `null` with no expiration pending. Earlier versions sent only `expiresAt`. An empty library has `data: []`, `total: 0`, and `pageCount: 0`. List responses include `Cache-Control: private, no-store`.

Normal pages use offsets, so a library changing between requests can move entries between pages. The optional `snapshot` ceiling excludes files uploaded after that instant; it does not freeze deletions, folder/tag edits, sharing changes, or mutable sort values. Invalid dates, snapshots, or visibility values return `400`. For image navigation, provide both gallery parameters. Anchored requests restrict results to images within your other filters, exclude the anchor itself, and return neighbors in the requested direction. Their pagination also includes an `offset`. A missing or filtered-out anchor returns `404`; supplying only one gallery parameter returns `400`.

### Check raw view counts

`views` includes share-page visits that show the file and successful `GET /{userUrlId}/{filename}/raw` responses. Each full response or `206` range response increments the total once. Raw access denials, missing files, failures opening storage, and `HEAD` requests do not increment it. This counts requests, including bots and repeated media ranges, rather than unique visitors or completed transfers. Existing totals are preserved after upgrading; earlier raw traffic is not backfilled. See [sharing and privacy](/guide/sharing#view-counts) for caching and direct-storage limits.

The stored file must open successfully before Flare writes the counter. A stored object that is gone returns `404`; another storage failure or a failed counter write returns `500`, and the acquired stream is closed. After resolving the [storage or database failure](/hosting/troubleshooting#raw-links-return-500), retry the request.

To check a disposable **public file without a password** that you own, set `FLARE_FILE_IDS` to its ID and `FLARE_FILE_PATH` to its URL-encoded `urlPath` from the list response, such as `/abc123/fixture.txt`. The file must contain at least three bytes. Run the metadata read below before and after the raw requests; in an otherwise idle fixture, `views` increases by two. The bearer token needs `files:read` for the metadata read. Raw content uses the file's public access and receives no bearer token.

```sh
curl --fail-with-body --get \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  --data-urlencode "ids=$FLARE_FILE_IDS" \
  "$FLARE_URL/api/files"

curl --fail-with-body --output /dev/null "$FLARE_URL$FLARE_FILE_PATH/raw"
curl --fail-with-body --range 0-2 --output /dev/null "$FLARE_URL$FLARE_FILE_PATH/raw"

curl --fail-with-body --head "$FLARE_URL$FLARE_FILE_PATH/raw"

curl --fail-with-body --get \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  --data-urlencode "ids=$FLARE_FILE_IDS" \
  "$FLARE_URL/api/files"
```

### Content caching

File content responses set `Cache-Control` from the file's access state, so a shared cache never stores bytes that needed a session or a password:

| Response                                                                | Private or password-protected | Public, no password                                                    |
| ----------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `GET /api/files/{path}` (the `rawUrl` in upload responses), `200`/`206` | `private, no-store`           | `public, max-age=31536000` for `video/*` content, otherwise `no-cache` |
| `GET /{userUrlId}/{filename}/raw`, `200`/`206`                          | `private, no-store`           | No `Cache-Control` header                                              |
| `GET`/`POST /api/files/{id}/download`, including a signed S3 redirect   | `private, no-store`           | No `Cache-Control` header                                              |
| `GET /api/files/{id}/thumbnail`                                         | `private, no-store`           | `public, max-age=31536000, immutable`                                  |

Access denials from these routes, `404` for a private file and `401` for a missing or wrong password, also send `private, no-store`. Archive listings and entries always do. There is no `Vary` header: a public, unprotected response is the same for every requester, and the others are never stored. A response cached while a file was public stays cached after it becomes private or gets a password; see [browser and CDN caching](/guide/sharing#browser-and-cdn-caching).

## Browse the whole file timeline

**`GET /api/files/timeline`** · Scope: **`files:read`** · Account permission: **`files.read`**

This lightweight endpoint supplies calendar bucket counts and offsets for a virtual library or date scrollbar. It applies the same ownership, selected-ID, search, type, date, visibility, folder, and tag filters as `GET /api/files`, using a database-clock read and one aggregate rather than returning every file's metadata. Counts include private files owned by the authenticated account, and never another account's files.

```sh
curl --fail-with-body --get \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  --data-urlencode 'sortBy=newest' \
  --data-urlencode 'groupBy=month' \
  --data-urlencode 'timezone=America/Los_Angeles' \
  "$FLARE_URL/api/files/timeline"
```

| Parameter                                                                     | Default               | Meaning                                                                                                                            |
| ----------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ids`, `search`, `types`, `dateFrom`, `dateTo`, `visibility`, `folder`, `tag` | Same as the file list | All filter rules above apply.                                                                                                      |
| `sortBy`                                                                      | `newest`              | Date order produces calendar buckets. Other supported sorts produce one undated bucket. Unknown values use newest.                 |
| `groupBy`                                                                     | `none`                | `none`, `month`, `week`, or `year`. `none` uses month buckets internally, without requesting visible headings. Weeks start Monday. |
| `timezone`                                                                    | `UTC`                 | IANA time zone for calendar boundaries, such as `America/Los_Angeles`. Browser clients can use their local IANA zone.              |

```json
{
  "success": true,
  "data": {
    "total": 124,
    "snapshot": "2026-10-06T12:00:00.000Z",
    "groupBy": "month",
    "timezone": "America/Los_Angeles",
    "buckets": [
      {
        "key": "2026-10-01T07:00:00.000Z",
        "from": "2026-10-01T07:00:00.000Z",
        "to": "2026-11-01T07:00:00.000Z",
        "count": 24,
        "offset": 0
      },
      {
        "key": "2026-09-01T07:00:00.000Z",
        "from": "2026-09-01T07:00:00.000Z",
        "to": "2026-10-01T07:00:00.000Z",
        "count": 100,
        "offset": 24
      }
    ]
  }
}
```

`from` is inclusive and `to` exclusive. Both are ISO UTC instants for local calendar boundaries; daylight-saving changes can make a week or month shorter or longer. `offset` is the number of matching files before this bucket in the selected order. Empty periods are omitted. `newest` returns newest buckets first; `oldest` returns oldest first. `key` equals `from`. Non-date sorts return `groupBy: "none"` and one bucket with `key: "all"`, null boundaries, and the total count. An empty result returns `total: 0` and `buckets: []`. `groupBy` otherwise preserves the requested value, including `none`.

Treat both boundaries as `string | null` when generating a client from the OpenAPI 3.1 contract. For example, a nonempty `sortBy=largest` response contains an undated bucket like this; do not parse its null boundaries as dates:

```json
{ "key": "all", "from": null, "to": null, "count": 124, "offset": 0 }
```

To load a visible window, request `GET /api/files` with the same filters and sort, the returned `snapshot`, and a bounded `limit` (maximum 100). Within a dated bucket, set `dateFrom` to the later of the original lower bound and `bucket.from`; set `dateTo` to the earlier of the original upper bound and **one millisecond before `bucket.to`**. Page numbers start at 1 **inside that filtered bucket**, not at the bucket's global `offset`. With the undated bucket, keep the original date filters. Never replace a user's narrower date range with the whole bucket.

This executable Node.js example loads the first window of the oldest populated month. It uses a named token from the environment and does not put credentials in a URL:

```js
const origin = process.env.FLARE_URL.replace(/\/$/, '')
const headers = { Authorization: `Bearer ${process.env.FLARE_TOKEN}` }
const filters = new URLSearchParams({ sortBy: 'oldest' })
const timelineQuery = new URLSearchParams(filters)
timelineQuery.set('timezone', 'UTC')
const summaryResponse = await fetch(
  `${origin}/api/files/timeline?${timelineQuery}`,
  { headers }
)
if (!summaryResponse.ok) throw new Error(await summaryResponse.text())
const { data: timeline } = await summaryResponse.json()
const bucket = timeline.buckets[0]
if (bucket) {
  const windowQuery = new URLSearchParams(filters)
  windowQuery.set('snapshot', timeline.snapshot)
  windowQuery.set('limit', '48')
  windowQuery.set('page', '1')
  if (bucket.from) windowQuery.set('dateFrom', bucket.from)
  if (bucket.to)
    windowQuery.set('dateTo', new Date(Date.parse(bucket.to) - 1).toISOString())
  const windowResponse = await fetch(`${origin}/api/files?${windowQuery}`, {
    headers,
  })
  if (!windowResponse.ok) throw new Error(await windowResponse.text())
  console.log(await windowResponse.json())
}
```

The timeline creates a new `snapshot` ceiling from PostgreSQL’s clock on every request, matching the clock used for upload timestamps even when the application host’s clock differs. It is an upload-time boundary, **not a durable database snapshot or continuation token**. Files uploaded later are excluded from subsequent windows that retain that ceiling. Deletions, backdated inserts, sharing/folder/tag changes, and changes to size/name/view/download sorts can still move results; fetch a fresh timeline and clear cached windows after a mutation or when refreshing. Offset reads within a very large bucket or a non-date sort can still cost more than early pages. Ordinary page clients and anchored image navigation remain supported unchanged.

Timeline responses use `Cache-Control: private, no-store`. Invalid groupings, time zones, dates, visibility, or selected-ID filters return `400`; auth and current-role failures use the same `401`/`403` behavior as listing. Pagination and gallery parameters do not apply to timeline summaries.

File-list and timeline reads can appear as request-level `http.get` events in the [instance audit log](/admin/audit). These include the acting account and applicable token ID when available, without recording the bearer secret. The log uses its existing access, retention, and best-effort rules; reading metadata does not itself create file-ready webhook events.

## Byte ranges

`GET /{userUrlId}/{filename}/raw`, `GET /api/files/{path}`, and `GET /api/files/{id}/download` honor one `Range` header per request, so media players can seek and download tools can resume. `Content-Length` always matches the bytes in the body.

| `Range` header                                                                                | Response                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bytes=0-1023`                                                                                | `206` with bytes 0 through 1,023 and `Content-Range: bytes 0-1023/<size>`                   |
| `bytes=1024-`                                                                                 | `206` from byte 1,024 to the end                                                            |
| `bytes=-500`                                                                                  | `206` with the last 500 bytes, or the whole file if it is shorter                           |
| A last byte past the end, such as `bytes=0-999999999`                                         | `206` that stops at the file's last byte; `Content-Range` names the bytes actually sent     |
| A first byte at or past the end, `bytes=-0`, or any range of an empty file                    | `416` with `Content-Range: bytes */<size>` and no body                                      |
| Several ranges such as `bytes=0-99,200-299`, a reversed range such as `bytes=9-1`, or garbage | `200` with the whole file; the header is ignored, which HTTP allows for ranges it can't use |

A `416` keeps the content routes' `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` headers. It does not count as a raw view, and the [audit log](/admin/audit) records it as a failed `file.read` or `file.download` request. Access checks run first, so a private or password-protected file returns `404` or `401` before its size is revealed.

On S3 storage, `GET /api/files/{id}/download` can redirect to a temporary signed URL before reading the header. S3 then handles the `Range` itself: a single range gets `206`, and an unsatisfiable one gets `416`. `/raw` and `/api/files/{path}` read through Flare on both storage providers.

Earlier builds parsed `Range` loosely. On local storage, a suffix range, a reversed or malformed range, or a first byte past the end returned `500` from `/raw` and `404` from `/api/files/{path}`. On S3, a suffix range returned bytes from the start of the file under `Content-Range: bytes NaN-…`. On both, a last byte past the end advertised a `Content-Length` larger than the file, so clients reported a truncated transfer.

To check a disposable public file without a password, reuse `FLARE_URL` and `FLARE_FILE_PATH` from [Check raw view counts](#check-raw-view-counts). The first command prints the file's last five bytes. The second prints the status and `Content-Range` for a range past the end (curl 7.84 or later for `%header{}`):

```sh
curl --fail-with-body --range -5 "$FLARE_URL$FLARE_FILE_PATH/raw"

curl --silent --output /dev/null \
  --write-out '%{http_code} %header{content-range}\n' \
  --range 999999999- "$FLARE_URL$FLARE_FILE_PATH/raw"
```

## Discover file types

**`GET /api/files/types`** · Scope: **`files:read`**

Returns the distinct MIME types currently present in your account, sorted alphabetically. This is not a list of server-allowed upload formats.

```json
{
  "success": true,
  "data": { "types": ["application/pdf", "image/jpeg", "image/png"] }
}
```

## Read current tags for a selection

**`GET /api/files/tags?fileIds=FILE_ID,OTHER_FILE_ID`** · Account browser session or legacy account upload credential · Permission: **`files.read`**

This dashboard route supplies fresh tag membership when opening **Edit tags**, including selected files outside the visible library window. It does **not** accept named `flr_…` tokens and is excluded from the named-token request builder and OpenAPI `paths`. Existing integrations using the named-token file listing can continue reading each file's `tags` there.

Send one `fileIds` parameter containing 1–100 comma-separated, nonempty IDs, each at most 128 characters after trimming. Duplicate IDs are returned once in their first-requested order; the 100-entry limit applies before deduplication. Every file must still belong to the authenticated account. Only active tag assignments are returned, sorted by normalized tag name, then ID. The read does not modify files, tag rules, or manual exclusions, and emits no webhook event.

For a signed-in browser on your disposable local Flare instance, this console example reads two files already returned by its file listing:

```js
const query = new URLSearchParams({ fileIds: [fileId, otherFileId].join(',') })
const response = await fetch(`/api/files/tags?${query}`, {
  credentials: 'same-origin',
  cache: 'no-store',
})
const result = await response.json()
if (!response.ok) throw new Error(result.error || 'Could not read file tags')
console.log(result.data.files)
```

Set `fileId` and `otherFileId` to owned file IDs from that disposable account. Success is **200** with `Cache-Control: private, no-store`:

```json
{
  "success": true,
  "data": {
    "files": [
      { "id": "FILE_ID", "tags": [{ "id": "TAG_ID", "name": "Review" }] },
      { "id": "OTHER_FILE_ID", "tags": [] }
    ]
  }
}
```

Malformed or oversized selections return **400**. Missing authentication or a named token returns **401**; a missing current `files.read` grant returns **403**. If any ID is missing, deleted, or belongs to another account, the whole request returns the same generic **404**, without a partial result. Close the editor, refresh the library, and select the remaining files again. Unexpected backend failures return **500**; retry the read. A successful response reflects this read; it does not lock out later edits by another client.

The [audit log](/admin/audit) records a request-level `http.get` outcome with the verified account when authentication succeeds. It does not include the queried file IDs or returned tag names. An unavailable-file `404` is recorded as a failure; the response and audit summary do not distinguish a missing file from another account’s file.

## Encrypted files

**Tokens from before the upgrade keep uploading plain files, unchanged.** For a named token or the account upload token that existed before the upgrade to end-to-end encryption, `POST /api/files` and the chunked routes behave as before: the request, the response, the stored bytes and the file's address. Screenshot tool configurations that were installed before the upgrade keep working. **A token created after the upgrade sends encrypted uploads by default** and needs an upload profile set to **Plain** to send plain ones; see [which uploads a token may send](#which-uploads-a-token-may-send).

Files are [encrypted on the device](/guide/encryption) by default: in the browser, or by the [`flare-upload`](/guide/screenshot-tools) program for a tool or a script. The server then stores ciphertext and has no name and no type. This affects what a token integration reads:

- **`GET /api/files` lists them with `encrypted: true`**, `name: ""`, `mimeType: "application/octet-stream"`, a `urlPath` that ends in a random file ID such as `/abc123/e_3kGq0v8mJtYw2nHc5sLp7A`, and `size` as the ciphertext size. Each such row also has an `encryption` object of base64url records. A plain file has `encrypted: false` and no `encryption` object.
- **`search`, `types` and `sortBy=name` cannot match encrypted files.** The server cannot read their names or types: a search skips them, a type filter sees only `application/octet-stream`, and an order by name puts them together at one end. Pass `encrypted=false` to list plain files only, or `encrypted=true` for the encrypted ones. `GET /api/files/types` lists the types of plain files only.
- **Three more fields can appear on an encrypted row:** `unreadable: true` after a [reset without the recovery phrase](/guide/passphrase#i-lost-my-recovery-phrase), and `thumbnailPending: true` or `ocrPending: true` while that work [waits for the owner's browser](#work-that-waits-for-the-owner-s-browser). They are left out when false.
- **Tags on a row have an empty `name`** when the tag is sealed. The `id` is what filters and assignments use.
- **`hasPassword` is `true`** for an encrypted file with a password stanza, as for a plain file with a server password.
- **The bytes are ciphertext.** `/api/files/{path}` and `/api/files/{id}/download` send them as `application/octet-stream` attachments, with byte ranges, and never redirect to signed storage. `/raw` and `/direct` answer `404`, the thumbnail route answers `400`, the OCR route answers with sealed text only, and a `password` query value is ignored.
- **Webhooks** send `data.name` and `data.mimeType` as `null` for them. See [version 2](./webhooks#version-2).

Nothing a token can call returns a key, because the server has none. An integration cannot decrypt an encrypted file without the owner's account key or the file's share link.

### Which uploads a token may send

A tool has no upload dialog, so the **Encryption** setting of its [upload profile](/guide/upload-profiles#encryption) decides whether its uploads must be encrypted or plain. The server cannot encrypt; it refuses the upload that does not match, so a wrong configuration cannot upload plain files by mistake.

| Credential                                                    | Encrypted upload                  | Plain upload                        |
| ------------------------------------------------------------- | --------------------------------- | ----------------------------------- |
| Named token, profile with `encryption: "encrypted"` (default) | Accepted                          | `403` `profile_requires_encrypted`  |
| Named token, profile with `encryption: "plain"`               | `403` `profile_requires_plain`    | Accepted                            |
| Named token, no profile                                       | Accepted                          | `403` `profile_requires_encrypted`  |
| Named token created before the upgrade                        | `403` `token_predates_encryption` | Accepted, whatever the profile says |
| Legacy account upload token                                   | `403` `token_predates_encryption` | Accepted, whatever the profile says |
| Browser session                                               | Accepted                          | Accepted: the dialog's choice wins  |
| Any, with **Forbid plain uploads** on                         | As above                          | `403` `plain_uploads_forbidden`     |

"The profile" is the one the upload resolves to: the token's bound profile, else the one named in `X-Upload-Profile`, else the account's default profile. A token that resolves to no profile takes the default, `encrypted`. To upload plain files with a new token, create a profile with **Encryption** set to **Plain** and [bind the token to it](./authentication#bind-uploads-to-a-profile) or select it per request:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -H "X-Upload-Profile: $PLAIN_PROFILE_ID" \
  -F 'file=@./changelog.txt;type=text/plain' \
  "$FLARE_URL/api/files"
```

The refusal is a `403` whose body has the message and a `code` a client can act on:

```json
{
  "error": "This upload profile takes encrypted uploads, and this upload is not encrypted. Upload with flare-upload, or use a token whose upload profile is set to Plain.",
  "code": "profile_requires_encrypted"
}
```

The check runs before the file is stored, and again when the file is published, with the settings as they are then. `encryption` is a setting of the profile only: no upload request can set it, and sending it as an upload option answers `400`. `GET /api/upload-profiles` (session only) returns it in each profile's `options` when it is `plain`, and `POST`/`PUT` accept `"encryption": "encrypted"` or `"plain"`.

An administrator can [forbid plain uploads](/admin/#forbid-plain-uploads) for the instance. `GET /api/settings`, which needs no credential, then answers `data.encryption.forbidPlainUploads: true`.

### Encrypted uploads from a token

A named token with `files:upload` sends an encrypted upload with **the same request the browser sends**: one contract, with a bearer token in place of the session cookie. Encrypting is the client's work. [`flare-upload`](https://github.com/FlintSH/flare/tree/main/clients/flare-upload) does it; its [`SERVER-CONTRACT.md`](https://github.com/FlintSH/flare/blob/main/clients/flare-upload/SERVER-CONTRACT.md) states each request field by field, and [`docs/e2ee-spec.md`](https://github.com/FlintSH/flare/blob/main/docs/e2ee-spec.md) specifies the bytes with shared test vectors in `lib/e2ee/vectors/v1.json`. A client of your own needs four things:

1. **The account public key, from the owner, not from the server.** The Upload tools card writes it into a configuration from the owner's unlocked browser. A client that asked the server for the key would encrypt to whatever key a compromised server gave it. No endpoint for tokens returns it.
2. **The protocol version check.** `GET /api/settings` answers `data.encryption.protocolVersions`, for example `[1]`. A client that does not find its version there must stop and tell its user to update.
3. **The request below**, with the records it made.
4. **The share link**, which the client makes itself: the page address of the answer, then `#` and the base64url file key, or `#p.` and the link secret for a file with a password. The server never has that part.

A client has no private key. Anyone who knows the account public key can make a file that decrypts correctly, so an upload is not proof of who made it.

The body of an encrypted upload is the encrypted file itself: a 26-byte header (`FLAREE2E`, a format version, a chunk size, a random nonce prefix) followed by 64 KiB chunks, each with a 32-byte tag. Four records travel with it, each base64url:

| Field                    | Content                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `header`                 | The same 26 bytes that start the body.                                 |
| `sealedMetadata`         | The file's name and type, sealed with a key derived from the file key. |
| `accountStanza`          | The file key, wrapped for the account public key.                      |
| `stanzaAccountPublicKey` | The account public key the stanza is for.                              |
| `passwordStanza`         | Optional. The file key wrapped for a password and a link secret.       |

`sealedMetadata`, `accountStanza` and `passwordStanza` start with the `record_version` byte `0x01`; `header` and the key do not.

The same request can carry what the uploader did for the library, and says what it did not do. Every field is optional:

| Field             | Content                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folderStanza`    | The file key, or for a file with a password the link secret, wrapped for the public key of the file's folder. 97 bytes with its version byte.                     |
| `folderPublicKey` | The folder public key that `folderStanza` is for. Required with it.                                                                                               |
| `sealedThumbnail` | A WebP thumbnail sealed with a key derived from the file key. At most 256 KiB.                                                                                    |
| `thumbnail`       | `none`: no thumbnail can be made for this file. Not together with `sealedThumbnail`.                                                                              |
| `sealedOcrText`   | The text read from an image, sealed with a key derived from the file key. At most 256 KiB.                                                                        |
| `isImage`         | `true` or `false`: the file is an image that text can be read from.                                                                                               |
| `rulesApplied`    | `true` or `false`: the client applied the owner's tag rules.                                                                                                      |
| `ruleTagIds`      | The IDs of the tags those rules gave: comma-separated, or a list in the JSON body of a chunked upload. Up to 100. IDs that are not the owner's tags are left out. |

In the multipart form these are text fields, with `true` and `false` as text. In the JSON body that starts a chunked upload the two flags can also be JSON booleans.

The server reads none of the sealed records. From the declarations it sets three flags on the file, the same way for every credential:

| Flag               | Set when                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `rulesPending`     | `rulesApplied` is not `true` and the account has a sealed tag.                                                       |
| `ocrPending`       | `isImage` is `true`, no `sealedOcrText` came, and the instance has [automatic OCR](/admin/#background-image-ocr) on. |
| `thumbnailPending` | No `sealedThumbnail` came and `thumbnail` is not `none`.                                                             |

`flare-upload` sends `rulesApplied: false` and `isImage`, because it applies no tag rule, makes no thumbnail and reads no text. A plain upload carries none of these fields. It gets `rulesPending` when the account has a sealed tag, because the server cannot read a sealed rule.

`folderStanza` is refused with `400` for a private file or a file without a folder, and with `409` and `"code": "stale_folder_key"` when `folderPublicKey` is not the key the folder has now, for example after its owner stopped sharing it. A public upload into a folder without a stanza is accepted: the owner's browser makes the stanza later.

- **One request:** `POST /api/files` with the header `X-Flare-Encrypted: true`. The multipart file part must be named `encrypted` with the type `application/octet-stream`; the records and the usual options (`visibility`, `expiresAt`, `expiryAction`, `tagIds`) are form fields. Any other field, such as `name` or `password`, is refused with `400`.
- **In parts:** `POST /api/files/chunks` with `encrypted: true`, `size` (the ciphertext size), the records and the usual options. `filename`, `mimeType` and `password` are refused. Parts and completion are the same routes as for a plain upload.

Before it publishes the file, the server checks what it can: that the stored bytes start with `header`, that the header has the right magic value, version and chunk size, that the stored size is a length an encrypted file can have, that each record has a possible length and version, and that `stanzaAccountPublicKey` is the uploader's current account public key. A failure answers `400`, or `409` for a key that is no longer current, and the stored bytes are removed. The server cannot check that the records open: it has no key. A chunked upload is checked at its start as well, so a client with an old key learns it before it sends a part.

Errors that a script client acts on carry a `code`:

| Status | `code`                          | Meaning                                                                                                                                                        |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `409`  | `account_key_not_current`       | The stanza is for a key that is not the account's current key. The owner changed their passphrase or rotated their keys. The client needs a new configuration. |
| `409`  | `account_keys_missing`          | The account has no keys yet.                                                                                                                                   |
| `400`  | `protocol_version_not_accepted` | The header or a record has a version this server does not accept.                                                                                              |
| `403`  | See the table above             | The upload does not match the profile's Encryption setting, plain uploads are forbidden, or the token is from before the upgrade.                              |

A key rotation also deletes every named token of the account, so a client usually sees `401` first. Both mean the same to its user: create a new configuration.

It does not sniff a type, run tag rules, or read text from these files: it stores what the client sealed and marks the rest as [waiting](#work-that-waits-for-the-owner-s-browser). Quota counts the ciphertext.

The answer has no name and no type:

```json
{
  "encrypted": true,
  "id": "cm_example",
  "url": "https://flare.example.com/abc123/e_3kGq0v8mJtYw2nHc5sLp7A",
  "pageUrl": "https://flare.example.com/abc123/e_3kGq0v8mJtYw2nHc5sLp7A",
  "size": 204890
}
```

The client appends the key after `#` to make the share link. The server never sees that part. `flare-upload` takes only the path of `pageUrl` and puts it behind the origin of its own configuration, so a server cannot move the key to another host.

### Read the records of one file

**`GET /api/files/{id}/encryption`** · Browser session or anonymous, under the file's [access rules](./endpoint-inventory#file-content-and-access-checks)

```json
{
  "id": "cm_example",
  "urlPath": "/abc123/e_3kGq0v8mJtYw2nHc5sLp7A",
  "sizeBytes": 204890,
  "header": "RkxBUkVFMkUBEA...",
  "sealedMetadata": "AQ...",
  "passwordStanza": null
}
```

Anyone who may fetch the ciphertext may read these: a visitor of a public file, the owner, an account with `content.read`. The owner's answer also has `accountStanza` and `stanzaAccountPublicKey`. A private file answers `404` to everyone else, and a plain file answers `400`. None of the records is a key, and none opens without one.

### Set or remove a password

**`PATCH /api/files/{id}`** with `{ "passwordStanza": "<base64url>" }` stores a new password stanza for an encrypted file, and `{ "passwordStanza": null }` removes it. Only the owner's session may send it; `content.update` is not enough, because only the owner's browser can make the stanza. `password` is refused for an encrypted file, and `passwordStanza` for a plain one.

### Sealed thumbnail and image text

**`GET /api/files/{id}/sealed-thumbnail`** · Browser session or anonymous, under the file's access rules

Answers the sealed thumbnail as `application/octet-stream`, or `204` when the file has none. A client that has the file key opens it and gets a WebP image. The bytes came from whoever uploaded the file, so a client should show them only as an image.

**`GET /api/files/{id}/ocr`** for an encrypted file answers `{ "success": true, "encrypted": true, "sealedOcrText": "<base64url>" }`, or `null` in place of the record when no text is stored. The server never reads the image. Sealed text and thumbnails are stored only by the upload request or by [the owner's session](#work-that-waits-for-the-owner-s-browser): a visitor who has the file key can make a valid record, and the server does not take it.

### Read a byte range

The stored chunk `n` starts at byte `26 + n × 65568` of the ciphertext and holds 65536 bytes of content and a 32-byte tag; the last chunk is shorter. To read plaintext bytes, a client requests the chunks that contain them with one `Range` header and checks each tag before it uses a byte. A range proves nothing about the end of the file unless it includes the last chunk.

## The encrypted library

These contracts belong to the dashboard. They need a browser session and refuse tokens. They are documented so operators and reviewers can see what crosses the wire.

### Folders with keys

Each folder of an account that has keys has an X25519 key pair made in the owner's browser. `GET /api/folders` lists a folder with `name: ""` and a `keys` object:

```json
{
  "id": "f3a91c0e5d7b42a6f08e19c4",
  "name": "",
  "parentId": null,
  "fileCount": 4,
  "shareToken": null,
  "keys": {
    "folderPublicKey": "…",
    "sealedFolderMetadata": "AQ…",
    "sealedFolderPrivateKey": "AQ…",
    "parentFolderStanza": null,
    "parentStanzaPublicKey": null,
    "rekeyPending": false
  }
}
```

`sealedFolderMetadata` holds the name, sealed with a key from the folder private key. `sealedFolderPrivateKey` is the owner's copy of the private key, sealed with a key from the account private key. `parentFolderStanza` is the private key wrapped for the parent's public key, which is how a link for a folder opens the folders inside it. A folder from before encryption has `keys: null` and a plain `name` until its owner's browser converts it.

- **`POST /api/folders`** takes `{ "parentId", "folderPublicKey", "sealedFolderMetadata", "sealedFolderPrivateKey" }` and, for a folder inside another, `parentFolderStanza` with `parentFolderPublicKey`. A plain `{ "name" }` answers `409` for an account that has keys, and key records answer `409` for one that has none. A parent stanza for a key that the parent no longer has answers `409` with `"code": "stale_folder_key"`.
- **`PATCH /api/folders/{id}`** renames with `{ "sealedFolderMetadata" }`. `{ "sharing": false }` deletes the share token and marks the folder and every folder below it `rekeyPending`. `{ "sharing": true }` answers `409` with `"code": "rekey_pending"` until the owner's browser stored new keys.
- **`PUT /api/folders/keys`** takes `{ "folders": [{ "id", "folderPublicKey", "sealedFolderMetadata", "sealedFolderPrivateKey" }], "parentStanzas": [{ "id", "parentFolderStanza", "parentFolderPublicKey" }] }`, up to 200 of each. A folder takes keys only when it has none or is `rekeyPending`; anything else answers `409` with `"code": "keys_exist"`. Storing keys deletes the plain name and every stanza that was made for the old key.
- **`PUT /api/files/folder-stanzas`** takes `{ "stanzas": [{ "fileId", "folderStanza", "folderPublicKey" }] }` and answers `{ "stored": 2, "skipped": ["…"] }`.
- **`GET /api/folders/repairs`** answers `{ "folderKeys": ["…"], "parentStanzas": [{ "id", "parentId" }], "fileStanzas": [{ "id", "folderId", "header", "sealedMetadata", "accountStanza", "stanzaAccountPublicKey", "passwordStanza" }], "more": false }`.

The database deletes a file's folder stanza when the file becomes private, changes folder, or changes its password stanza without a new folder stanza in the same change. That holds for every writer: a moderator, the expiry worker and `POST /api/files/folders` included.

A shared folder page gets its list from the server render of `/s/folders/{token}`, optionally with `?folder={id}` for a folder below the shared one and `?page=`. No API route serves it. The list has sealed names, the parent stanza of each folder below, and for each public encrypted file its header, sealed name and folder stanza. The key is in the address after `#` and is never sent.

### Tags with keys

`GET /api/tags` lists a sealed tag with `name: ""`, `ruleSource: null`, `ruleText: null` and `sealed`, the base64url `sealed_tag_metadata` that holds the name and the rule. A tag from before encryption has `sealed: null`.

- **`POST /api/tags`** and **`PATCH /api/tags/{id}`** take `{ "sealedTagMetadata" }` for an account that has keys. The plain form answers `409` for such an account, and the sealed form `409` for an account without keys.
- **`PUT /api/tags/sealed`** takes `{ "tags": [{ "id", "sealedTagMetadata" }] }` and answers `{ "sealed": 3 }`. It changes only tags that are still plain.
- **`POST /api/tags/{id}/apply`** with `{ "fileIds": [...] }` adds the tag to those of the caller's files that do not have it. A file the tag was removed from by hand stays without it.

The server cannot refuse a duplicate sealed name or apply a sealed rule. The browser does both.

### Encrypt existing files on the server

Files from before end-to-end encryption are plain. The server has their content, so it can encrypt them to the owner's account key; no client downloads anything. Only a **browser session of the owner** starts this. A named token, the legacy upload token and a moderator's session are refused: the request records a decision about that person's links and passwords.

**`GET /api/files/existing`** answers the state of your account:

```json
{
  "data": {
    "hasKeys": true,
    "choice": "private",
    "choiceAt": "2026-11-14T09:30:00.000Z",
    "plain": { "private": 0, "public": 3, "password": 1, "total": 4 },
    "plainLater": 2,
    "libraryReady": true,
    "jobs": {
      "waiting": 0,
      "running": 0,
      "failed": 1,
      "encrypted": 212,
      "skipped": 0
    },
    "failed": [
      { "fileId": "cmf0…", "name": "scan.pdf", "code": "source_missing" }
    ],
    "passwordPending": 0
  }
}
```

`plain` counts the plain files from before encryption, which are the files the choice covers: `password` is every such file with a server-side password, `public` and `private` are the rest by visibility. A file counts as from before encryption when its stored upload options have no `encryption` setting, which every upload since this release records. `plainLater` counts the other plain files, uploaded as plain since; no choice queues them. `choice` is `null` until you answered. `libraryReady` is `false` while a folder has no key pair or a tag has no sealed record; the server starts no file of the account until your browser converted them. `jobs` counts the queue rows of the last 7 days. A `failed` entry is a file that is still plain, which is why the server can name it; `code` is one of `source_missing`, `storage_read_failed`, `storage_write_failed`, `verification_failed`, `account_keys_missing`, `interrupted` and `internal_error`. `passwordPending` counts encrypted files that lost a server-side password and are private until you [set a password again](#set-or-remove-a-password).

**`PUT /api/files/existing`** takes exactly `{ "choice": "none" | "private" | "all" }`, records it, and answers the same state. `private` queues each private file from before encryption without a password, and such a job skips a file that you made public or protected in the meantime. `all` queues every plain file from before encryption. A new answer replaces the jobs that have not started, so `none` empties the queue; a file that is being encrypted at that moment is finished. An account without keys gets `409` with `code: "account_keys_missing"`.

**`POST /api/files/existing/encrypt`** takes exactly `{ "fileIds": ["…"] }` with 1 to 500 IDs and answers `{ "data": { "queued": 2 } }`. It queues your plain files among them, whenever they were uploaded, also ones that failed before. Other IDs are left out without an error.

What changes for a file when its job finishes: `encrypted` becomes `true`, `name` becomes empty, `mimeType` becomes `application/octet-stream`, `urlPath` becomes `/{urlId}/e_…`, and `size` grows by 26 bytes plus 32 bytes per 64 KiB. Its ID, tags, folder, visibility, expiry, counters and upload time stay. The old address answers `404`. A file that had a server-side password becomes `PRIVATE` with `passwordPending: true` in the [file list](#list-and-search-files); storing a password stanza restores the visibility it had. Integrations that stored a file's URL must read it again, and a `file.ready` receiver gets no new event for a converted file.

### Work that waits for the owner's browser

**`GET /api/files/pending`** answers `{ "total": 12, "files": [...] }`. An encrypted entry has `id`, `urlPath`, `size`, the three flags, `encryption` with the account stanza, and `sealedOcrText` if text is stored. A plain entry has `id`, `name`, `mimeType`, `ocrText`, `ocrProcessed` and `rulesPending`.

**`POST /api/files/{id}/work`** stores what the browser did. Every field is optional, and at least one is required:

| Field             | Effect                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `sealedThumbnail` | Stored. Clears `thumbnailPending`.                                                                        |
| `thumbnail`       | `none`: clears `thumbnailPending` without a thumbnail.                                                    |
| `sealedOcrText`   | Stored. Clears `ocrPending`. Without `rulesApplied`, sets `rulesPending` if the account has a sealed tag. |
| `ocr`             | `none`: clears `ocrPending` without text, for a file that is not a readable image.                        |
| `rulesApplied`    | `true`: clears `rulesPending`, and adds `ruleTagIds` where the file does not have them.                   |
| `failed`          | `true`: counts one failed attempt. After three, `GET /api/files/pending` stops listing the file.          |

A sealed record for a plain file answers `400`, and for an unreadable file `409`.

### Search records

**`GET /api/files/sync`** has three forms:

- `?since={n}&limit={1-500}` answers `{ "records": [...], "more": false, "state": { "count": 812, "sum": "9914573" } }`. Each record is the row of `GET /api/files` for one encrypted file, with `seq` and `sealedOcrText`. Records come in the order of `seq`, a number that moves whenever a listed value of the file, its tags or its image text changes. Views and downloads do not move it. A page also ends when its `sealedOcrText` values pass 8 MiB together, so it can hold fewer records than `limit`: go on from the last `seq` while `more` is true.
- `?ids=a,b,c`, up to 100, answers the records of those files.
- `?index=1&after={id}` answers `{ "entries": [["id", 41], …], "more": false }`, 5,000 per page.

`state` is the count of the account's encrypted files and the sum of their `seq`. A cache whose own count and sum differ has missed a deleted file or a change, and repairs itself from the index. Unreadable files are in none of these answers.

**`GET /api/files/order`** takes the filters of `GET /api/files`, lists plain files only, and answers `{ "keys": [["id", "2026-03-01T10:00:00.000Z"], …], "more": false }`. The second value is what `sortBy` orders by: the upload time, the size, a count or the name.

### Rotation and reset

`POST /api/auth/e2ee/rotation` and `POST /api/auth/e2ee/recovery` take two more fields, described in [account keys](./account-keys): `folders`, a new `sealedFolderPrivateKey` for each folder that has keys, and `tags`, a new `sealedTagMetadata` for each sealed tag. A request that does not cover exactly those folders and tags answers `409` with `"code": "library_records_incomplete"`, and nothing is changed.

After a rotation **`GET /api/files/stanzas`** answers `{ "stanzas": [{ "id", "header", "sealedMetadata", "accountStanza", "stanzaAccountPublicKey" }], "remaining": 3400, "oldKeys": ["…"] }` and **`PUT /api/files/stanzas`** takes `{ "stanzaAccountPublicKey", "stanzas": [{ "id", "accountStanza" }] }`, up to 100. It replaces only a stanza that is still for an old key: a stanza for the current key stays as it is, and `replaced` in the answer counts what changed. When `oldKeys` no longer names an old key, the browser stores a keyring without it through `PUT /api/auth/e2ee/keyring`.

`POST /api/auth/e2ee/reset` sets `unreadable` on every encrypted file of the account, clears their flags and folder stanzas, and turns each folder with keys and each sealed tag back into a plain one named `Folder` or `Tag` with the last six characters of its ID, without a share link.

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

`filename` names the file; it never selects a folder or storage location. Flare keeps only the part after the last `/` or `\` as the display name and removes control characters, so `photos/2026/shot.png` and `C:\Users\me\shot.png` are both stored as `shot.png`. Multipart uploads to `POST /api/files` treat the form's filename the same way. A chunked `filename` with nothing left after that, such as `folder/` or `..`, returns `400` with `Invalid filename.`; a multipart upload in the same situation is named `file`. Earlier versions stored a chunked `filename` exactly as sent, so clients that put a path there now get only its last part. Files uploaded before this change keep their saved names.

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

Alternatively, **`PUT /api/files/chunks`** accepts the same body plus `uploadId` and returns **`{ "data": { ...uploadLinks } }`**. Use one completion route consistently in your client. A body without a string `uploadId` answers `400` with `Upload ID is required.`, a JSON `null` body included, which earlier builds answered with `500`.

Completion accepts permitted upload-option overrides, but cannot change the profile, folder, or naming strategy chosen at initialization. Bound-token restrictions still apply. Repeating completion after a lost response returns the existing file while the upload session remains available; it does not publish another copy or enqueue another normal file-ready event.

### Session lifetime and recovery

Upload metadata expires after **one hour of inactivity**. Requesting a part URL or successfully sending a part updates activity. Completion does not create an indefinite retention guarantee. The session ID is scoped to its account and, for bound tokens, its profile.

Metadata is stored under `tmp/uploads` on the application filesystem. Multi-replica deployments must ensure all requests for a chunk session can reach its metadata and, for local storage, its temporary parts. An ephemeral restart can lose an in-progress upload even when finalized files are safely stored in S3.

Changing storage provider/configuration during an upload causes `409`; start again against the current storage. Each new chunk session also records the actual provider identity that initialized its parts. Part-URL, part-write, and completion requests return `409` when that provider differs or the session lacks recorded provenance, including sessions started before the storage-provenance upgrade. Restart the entire affected upload with a new initialization request; repeatedly resending completion or old part numbers cannot repair it. Successfully completed files and successful request/response formats are unchanged. Flare currently has no API for cancelling a chunk session or querying which parts were uploaded. Preserve your own part state, let stale sessions expire, and configure storage cleanup for abandoned multipart objects as part of server operations.
