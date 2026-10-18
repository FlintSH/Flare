---
title: Archive API contracts
description: Archive listings that read only the file list, ranged entry reads for previews, share-page browsing, and owner-session extraction and ZIP or TAR.GZ creation.
---

# Archive API contracts

The [archive workspace](/guide/archives) has separate owner-library and share-page routes. Owner-library operations require the owner's **browser session**. Shared reads follow ordinary file visibility/password rules and can be anonymous for an unprotected public file. Named tokens and legacy upload credentials do not grant access to either set of routes.

These routes are documented separately from the [named-token OpenAPI document](/openapi.json) and request builder. Ordinary file listing/upload scopes remain unchanged. Shared archives support browsing and entry downloads only; extraction and creation remain owner-only library operations.

## Routes and permissions

### Owner-library routes

These routes require a browser session, reject an `Authorization` header, and require ownership of every source. `content.read` does not substitute for ownership on these routes.

| Method and path                        | Permission                                                                     | Request                                                                                                    | Successful response                    |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `GET /api/files/{id}/archive`          | `files.read`                                                                   | Optional `progress=1` and `after` query parameters                                                         | JSON listing, or `202` progress        |
| `GET /api/files/{id}/archive/entry`    | `files.read`                                                                   | `path` or `entry` query parameter; optional `disposition=inline` and `Range` header                        | Entry bytes                            |
| `POST /api/files/{id}/archive/extract` | `files.read`, `files.upload`, `folders.manage`                                 | JSON `{ "folderId": null, "name": "Extracted project", "profileId": null }`                                | JSON describing the new wrapper folder |
| `POST /api/files/archive`              | `files.read`, `files.upload`; also `folders.manage` for a non-null destination | JSON `{ "fileIds": ["FILE_ID"], "name": "Project", "format": "zip", "folderId": null, "profileId": null }` | JSON describing the generated file     |

Every source file and non-null destination folder in an owner-library request must belong to the session account. `folderId: null` means the top level: extracted content receives a new top-level wrapper folder, while a generated archive remains unfiled. Archive creation accepts `format: "zip"` or `"tar.gz"`.

Owner-library POST requests require same-origin JSON with a maximum body of **16 KiB**, including streamed bodies. Unknown fields are rejected. `profileId` is optional: omitted or `null` explicitly uses private/no-expiration defaults and does not inherit the account's default profile. A non-null value selects an owned upload profile; additional tag and expiration permissions apply as described below. The folder destination stays independent of the profile.

For a selected profile, optional `profileRevision` carries its ISO `updatedAt` timestamp from `GET /api/upload-profiles`. Optional `profileEffectiveRevision` carries that profile's `effectiveRevision`, a 64-character lowercase hexadecimal digest of its effective settings, including inherited account and instance defaults. Either field requires a non-null `profileId`, otherwise the request returns `400`. The browser sends both values from the settings it displayed.

A stale supplied revision, or a selected profile deleted after either revision was captured, returns `409` before source staging or object writes. The effective-settings digest covers visibility, relative expiration, expiry action, URL naming, tags, and share style; it excludes the computed expiration deadline and unrelated account edits. Omitting the optional fields snapshots settings at request start. All requests recheck the selected profile and effective settings before publication, so a relevant default changed during processing also rejects the operation. Fixed **Private (no profile)** output remains independent of those defaults.

Creation requires 1–100 distinct `fileIds`. Its `name` is trimmed, 1–180 characters, and cannot be `.`, `..`, contain slashes, or contain control/format characters. The matching `.zip` or `.tar.gz` suffix is appended when absent. Extraction uses the normal folder-name rules: Unicode normalization, trimmed/collapsed whitespace, 1–80 characters, no slashes/control characters, and neither `.` nor `..`. A conflicting sibling folder is not overwritten.

Successful JSON responses use the usual `{ "success": true, "data": ... }` envelope. Entry downloads are binary responses rather than JSON. Sizes, `totalBytes`, and `archiveBytes` are **bytes**, unlike the existing file-list `size` field, which is MiB.

Responses use `Cache-Control: private, no-store`. Entry responses also send `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, and a restrictive sandbox policy. They use attachment disposition and `application/octet-stream` unless the request asks for `disposition=inline` and Flare detects, from the entry's own bytes, a PNG, JPEG, GIF, WebP, AVIF, BMP, or ICO image, MP4, MOV, WebM, Matroska, or Ogg video, or MP3, MP4, AAC, WAV, Ogg, or FLAC audio. Only those are served inline with their detected type. Names and extensions are never trusted, and HTML, SVG, PDF, and other active documents are always attachments; the browser UI shows text in its own preview.

### Share-page routes

| Method and path                            | Body                                                                                                                                                 | Successful response                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `POST /api/files/{id}/archive/share`       | JSON `{ "password": "FILE_PASSWORD" }`, or `{}` for an unprotected file; optional `progress` and `after`                                             | The same JSON listing, or `202` progress |
| `GET /api/files/{id}/archive/share/entry`  | `path` or `entry` query parameter; optional `disposition=inline` and `Range` header. Access from the session, public visibility, or an unlock cookie | Entry bytes                              |
| `POST /api/files/{id}/archive/share/entry` | JSON or URL-encoded form `{ "path": "project/readme.txt", "password": "FILE_PASSWORD" }`; omit `password` for an unprotected file                    | Entry bytes as an attachment             |

All shared routes reject any `Authorization` header, even alongside a valid cookie, and require a same-origin request; a browser's `Sec-Fetch-Site: cross-site` request is refused, so other sites cannot embed shared entries. Passwords belong in a request body, never in an archive URL or query string. Shared request bodies have the same **16 KiB** limit. `password` is an optional string of at most 1,024 characters; `null` and unknown fields return `400`. An empty string passes structural validation but cannot unlock a file requiring a password. `progress` is an optional boolean and `after` an optional non-negative integer, as for the owner listing. A POSTed `path` is required for an entry and must contain 1–4,096 characters matching a listed file path. URL-encoded entry forms reject duplicate or unknown fields. The form variant allows a browser to download an attachment without first buffering the complete entry in JavaScript.

When a listing request verifies a visitor's file password, the response also sets an **unlock cookie** named `flare_archive_unlock`. It is `HttpOnly`, `SameSite=Strict`, `Secure` when `NEXTAUTH_URL` uses HTTPS, scoped to `Path=/api/files/{id}/archive/share`, and expires after **one hour**. It is an HMAC over the file ID, the file's current password hash, and the expiry, keyed from `NEXTAUTH_SECRET`. A later shared request without a `password` field can use it in place of the password: `GET .../share/entry` for image, video, and audio elements and download links, which cannot carry a body. It satisfies only the password check; private visibility and every other rule still apply. Using the cookie never renews it; only another submitted password issues a new one. The share page repeats its listing request with the in-memory password every 45 minutes while it stays open. Changing or removing the file's password invalidates it immediately. Owner and moderator sessions do not need it. Without a `NEXTAUTH_SECRET` of at least 32 characters, unlocks use a per-process random key and stop working after a restart or on another replica.

Shared requests pass the header/origin and IP-rate checks first. Body reading then has its own **five-second deadline** and a separate limit of **32 pending body reads per application process**, shared across the POST routes. A stalled body returns `408`; a full body-read pool returns `429` with `Retry-After: 5`. Every completion, failure, or cancellation releases that body-read slot. The body is parsed and validated, and file access authorized, **before** any archive data is read. Incomplete, malformed, or unauthorized requests therefore never start reading an archive.

The file's current [sharing rules](/guide/sharing#choose-who-can-open-a-file) determine access: an unprotected public file is readable anonymously; a protected public file needs its password or a current unlock cookie; a private file requires an eligible owner session with `files.read` or a session with `content.read`. Owners and content moderators bypass file-password prompts under those same rules. Signing in as an unrelated account or presenting a file password does not override private visibility.

Every request checks access before reading. When a request had to read the archive's file list first, rather than finding it already in memory, access, the source record, and its password are checked again before the listing or entry is returned. A removed or newly private source can return `404`; a changed visitor password returns `401`; changed source identity, name, content path, MIME type, or recorded storage target returns `409`. If a session or role loses its bypass, ordinary visitor rules apply: an unprotected public file can still be read, but a private/protected one requires the corresponding current access. A previous successful listing is not an access grant for later downloads. The normal expiry worker still controls scheduled expiration. A disabled folder share or moved folder member blocks that folder entrypoint, but does not revoke the independent canonical URL of a file that remains public.

These routes do not extract into an account, publish new files, or change the archive. Shared listings allow **120 requests per IP per minute** and shared entry reads **600 requests per IP per minute** in each application process, so polling a slow listing never uses the budget that image loads and video seeking need.

## Listings and entry reads

A listing reads only the archive's index, never every member. For a ZIP that is the central directory at the end of the file. A TAR is listed by reading each member's header and skipping its data. A TAR.GZ or GZIP has to be decompressed once from the start; during that pass Flare records byte-aligned resume points in the compressed stream, so later entry reads start near the requested data. Finished listings stay in an in-memory cache of about **128 MiB** per process. Concurrent requests for the same archive share one read.

Without `progress`, a listing request waits until the listing is complete. With `progress=1` (or `"progress": true` in a shared body), Flare waits up to 750 ms and then, if the archive is still being read (typically a large TAR, TAR.GZ, or GZIP), returns **`202 Accepted`** with `Retry-After: 1` and a progress object. Poll again with `after` set to the number of entries already received; each response returns only entries after that cursor, in archive order. The final `200` response completes the listing in the same way. An unfinished read that nobody polls for 30 seconds is stopped.

```json
{
  "success": true,
  "data": {
    "status": "indexing",
    "format": "tar.gz",
    "archiveBytes": 352935936,
    "bytesRead": 117440512,
    "entries": [
      { "path": "frames/batch-001.log", "type": "file", "size": 5488890 }
    ],
    "entriesFound": 17
  }
}
```

An entry is selected by `path`, its exact listed path, or by `entry`, its zero-based position in the listing's `entries` array. The browser uses positions so that member names stay out of URLs; positions are stable for a stored archive. A position that is a directory or out of range returns `404`. A repeated path refers to its last copy.

Entry reads honor one `Range: bytes=start-end` (or `bytes=start-` and `bytes=-suffix`) with **`206 Partial Content`** and `Content-Range`. An unsatisfiable range returns `416` with `Content-Range: bytes */SIZE`; multiple ranges are ignored and the whole entry is sent. Stored ZIP and plain TAR entries are read directly at the requested offset. Deflated ZIP entries are decompressed from the entry's start, and TAR.GZ or GZIP entries from the nearest resume point. When a request covers a whole ZIP entry, its CRC-32 and size are verified before the last bytes are sent. Responses of up to 512 KiB are verified before any header, so damage returns `400` with an `error` message; a longer response stops before its final bytes. A partial range can't be verified.

Requesting an entry listed with an `issue` returns `415` with an explanation instead of its contents. `HEAD` returns the same headers without opening the entry. A streamed response whose body isn't read for 60 seconds is closed; media players request the next range when they resume.

## Browse a shared archive

Run this on the Flare origin with an accessible archive ID. Use `{}` for an unprotected public archive; for a protected public file, replace the example body with `{ password: 'FILE_PASSWORD' }` using the password provided by its owner:

```js
const sharedArchiveId = 'SHARED_ARCHIVE_FILE_ID'
const sharedResponse = await fetch(
  `/api/files/${encodeURIComponent(sharedArchiveId)}/archive/share`,
  {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }
)
const sharedResult = await sharedResponse.json()
if (!sharedResponse.ok)
  throw new Error(sharedResult.error || 'Shared archive is unavailable')
console.log(sharedResult.data)
```

For an unprotected public archive, or after a listing request has set the unlock cookie, link to `GET /api/files/{id}/archive/share/entry?entry=POSITION` (or `?path=` with the encoded path). Without a cookie, submit the exact listed path in a POST form instead. Add a `password` field only when required. Use an existing in-memory value from the password form; do not put it in local storage or the URL:

```js
const form = document.createElement('form')
form.method = 'POST'
form.target = '_blank'
form.rel = 'noopener'
form.action = `/api/files/${encodeURIComponent(sharedArchiveId)}/archive/share/entry`
const entryPath = document.createElement('input')
entryPath.type = 'hidden'
entryPath.name = 'path'
entryPath.value = 'project/readme.txt'
form.append(entryPath)
document.body.append(form)
form.submit()
form.remove()
```

## Inspect a manifest

Run this in an authenticated browser on your Flare origin, using an archive ID from your library. It relies on your session cookie and adds no bearer header:

```js
const archiveId = 'YOUR_ARCHIVE_FILE_ID'
const response = await fetch(
  `/api/files/${encodeURIComponent(archiveId)}/archive`,
  {
    credentials: 'same-origin',
  }
)
const result = await response.json()
if (!response.ok) throw new Error(result.error || 'Archive inspection failed')
console.log(result.data)
```

Example response:

```json
{
  "success": true,
  "data": {
    "format": "zip",
    "entries": [
      { "path": "project", "type": "directory", "size": 0 },
      { "path": "project/readme.txt", "type": "file", "size": 42 },
      {
        "path": "project/secret.txt",
        "type": "file",
        "size": 9,
        "issue": "encrypted"
      }
    ],
    "fileCount": 2,
    "totalBytes": 51,
    "archiveBytes": 512,
    "entryCount": 3,
    "truncated": null,
    "extraction": {
      "available": false,
      "reason": "Extract all isn’t available because it contains encrypted files. You can still preview and download individual files."
    }
  }
}
```

The listing contains files and directories in archive order. Parent folders that have no entry of their own are not listed; clients infer them from paths. It does not create file records or make entries independently public.

| Field                     | Meaning                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entries[].issue`         | Present when the entry is listed but can't be read: `encrypted`, `compression` (an unsupported ZIP method), `link`, `special` (device, FIFO, or other non-file entry), `unsafe-path` (absolute or escaping the archive), `sparse`, `damaged`, or `incomplete` (a GZIP whose listing stopped before the end of its file, so its size is unknown). |
| `fileCount`, `totalBytes` | Files and their uncompressed bytes among the listed entries.                                                                                                                                                                                                                                                                                     |
| `archiveBytes`            | The compressed archive's size.                                                                                                                                                                                                                                                                                                                   |
| `entryCount`              | Entries the archive declares, or the number listed when it doesn't declare a count. A ZIP can declare more entries than are listed.                                                                                                                                                                                                              |
| `truncated`               | `null` for a complete listing. `entries`: the 100,000-entry limit. `time` or `size`: the listing time or uncompressed-data limit. `damaged`: the archive ended early or is damaged after the listed entries.                                                                                                                                     |
| `extraction`              | Whether **Extract all** is expected to succeed: `{ "available": true }`, or `false` with a `reason`. Extraction requests still validate everything themselves.                                                                                                                                                                                   |

Paths use forward slashes without a leading `./`. Control and formatting characters in names are shown as U+FFFD. Names in ZIP entries without the UTF-8 flag are read as UTF-8 when valid, otherwise as code page 437, and Info-ZIP Unicode path fields are honored.

## Download one entry

Use the exact file path returned by the listing and encode it as a query value, or pass `entry` with its position. Directory entries cannot be downloaded as individual files.

```js
const entryUrl = new URL(
  `/api/files/${encodeURIComponent(archiveId)}/archive/entry`,
  location.origin
)
entryUrl.searchParams.set('path', 'project/readme.txt')
const entryResponse = await fetch(entryUrl, { credentials: 'same-origin' })
if (!entryResponse.ok) throw new Error('Archive entry download failed')
const entry = await entryResponse.blob()
const downloadUrl = URL.createObjectURL(entry)
const link = document.createElement('a')
link.href = downloadUrl
link.download = 'readme.txt'
link.click()
setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
```

This downloads a copy without adding it to the account's library. To read only part of an entry, such as the first 256 KiB of a log, add a `Range` header:

```js
const head = await fetch(entryUrl, {
  credentials: 'same-origin',
  headers: { Range: 'bytes=0-262143' },
})
console.log(head.status, head.headers.get('Content-Range'), await head.text())
```

The dashboard renders supported images, video, and audio from `disposition=inline` URLs and loads text in 256 KiB ranges, with HTML and SVG treated as text.

## Extract into a new folder

```js
const response = await fetch(
  `/api/files/${encodeURIComponent(archiveId)}/archive/extract`,
  {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderId: null,
      name: 'Extracted project',
      profileId: null,
    }),
  }
)
const result = await response.json()
if (!response.ok) throw new Error(result.error || 'Archive extraction failed')
console.log(result.data.folderId, result.data.fileCount, result.data.totalBytes)
```

Example success: `{ "success": true, "data": { "folderId": "NEW_FOLDER_ID", "fileCount": 1, "totalBytes": 42 } }`. The new wrapper contains the preserved archive hierarchy. Extraction does not overwrite an existing destination or change the source archive. A failed operation does not publish a partial set of file records.

## Create a new archive

```js
const response = await fetch('/api/files/archive', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fileIds: ['FIRST_OWNED_FILE_ID', 'SECOND_OWNED_FILE_ID'],
    name: 'Project',
    format: 'tar.gz',
    folderId: null,
    profileId: null,
  }),
})
const result = await response.json()
if (!response.ok) throw new Error(result.error || 'Archive creation failed')
console.log(result.data.file, result.data.totalBytes)
```

Example response:

```json
{
  "success": true,
  "data": {
    "file": {
      "id": "NEW_FILE_ID",
      "name": "Project.tar.gz",
      "urlPath": "/abc123/project-tar.gz",
      "folderId": null
    },
    "totalBytes": 180
  }
}
```

`totalBytes` is the generated archive's compressed size. The result is one new file, private when no profile was selected. Members use portable, normalized basenames at the archive root: path-like source names are flattened, separators and unsafe punctuation are cleaned, and duplicate names receive suffixes such as ` (2)`. Library-folder membership is not recreated. The selected originals remain unchanged. Source visibility, passwords, expiration, and upload-profile settings are not copied into the output as sharing controls.

New library files retain their display names separately from their URL names. When a Unicode display filename has no usable URL slug, Flare uses a random URL filename while preserving the display name. Extraction detects MIME types from file signatures and uses recognized text extensions as a fallback, allowing normal Flare text previews after publication.

## Select a reviewed upload profile

To use an owned profile, read its current settings and send both reviewed revisions with either mutation. Listing saved profiles requires a browser session with `uploadProfiles.manage`. `GET /api/upload-profiles` returns `data.profiles` with each profile's `id`, `name`, `options`, `updatedAt`, and `effectiveRevision`; `data.accountOptions` supplies inherited account/instance defaults, and `data.canShare` reports whether the current account may create public output. Review those defaults together with the selected `profile.options`; when `canShare` is false, output visibility is forced private. The digest already reflects that permission. Treat it as an opaque value returned for the selected account/profile. The separate `data.effective` value describes the account's default profile, which can differ from the explicit profile selected here.

```js
const profilesResponse = await fetch('/api/upload-profiles', {
  credentials: 'same-origin',
})
const profilesResult = await profilesResponse.json()
if (!profilesResponse.ok) throw new Error('Unable to read upload profiles')
const profile = profilesResult.data.profiles.find(
  (item) => item.id === 'OWNED_PROFILE_ID'
)
if (!profile) throw new Error('Upload profile is unavailable')
const selectedProfile = {
  profileId: profile.id,
  profileRevision: profile.updatedAt,
  profileEffectiveRevision: profile.effectiveRevision,
}
const archiveResponse = await fetch('/api/files/archive', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fileIds: ['FIRST_OWNED_FILE_ID', 'SECOND_OWNED_FILE_ID'],
    name: 'Reviewed project',
    format: 'zip',
    folderId: null,
    ...selectedProfile,
  }),
})
const archiveResult = await archiveResponse.json()
if (!archiveResponse.ok)
  throw new Error(archiveResult.error || 'Archive creation failed')
console.log(archiveResult.data.file)
```

## Limits and publication

Browsing accepts ZIP (stored, deflated, and, for previews, Zstandard members; ZIP64; archives with a prepended self-extractor), ustar, PAX, and GNU TAR, TAR.GZ/TGZ, and GZIP, including concatenated GZIP members. RAR, 7z, and split archives are unsupported. Encrypted entries, links, special files, sparse files, unsafe paths, and unsupported compression are listed with an `issue` rather than rejecting the archive. A normal Flare password on an owned archive is independent of archive encryption and does not prevent owner access through these routes.

Browsing limits are: 100,000 listed entries; a 64 MiB ZIP central directory; 2 minutes to list a TAR, TAR.GZ, or GZIP, and 64 GiB of uncompressed data for a TAR.GZ or GZIP; and 4,096 characters per entry path. Exceeding them produces a `truncated` listing rather than an error. There is no archive-size limit for browsing beyond what the instance accepted as an upload.

Extraction and creation keep their fixed limits and validate every member. Extraction accepts only stored or deflated ZIP members and rejects encrypted entries, links, special files, unsafe paths, and conflicting normalized paths. Paths cannot escape the archive root; folder components follow the normal 80-character folder-name limit, and filenames are limited to 255 characters. Parent directories inferred from member paths count toward the entry limit. The limits are 256 MiB per source archive, generated archive, or individual member/source file; 512 MiB expanded or combined selected source bytes; 1,000 members including directories; 100 selected files; 20 path levels; and 1,024 characters per archive path. One MiB is 1,048,576 bytes. These operations have a **120-second deadline**, starting before their request body is read. A listing's `extraction` field predicts the outcome but is not a reservation.

Per application process, and not distributed across replicas:

| Work                           | Limit                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Reading archive file lists     | 2 at once; up to 32 more archives wait in a queue, after which requests return `429` |
| Entry responses being streamed | 64 at once, and 8 per account (owner routes) or per IP address (shared routes)       |
| Extraction and creation        | 2 operations at once, at most one per account                                        |
| Shared listing requests        | 120 per IP per minute                                                                |
| Shared entry requests          | 600 per IP per minute                                                                |
| Pending shared request bodies  | 32, each read within five seconds                                                    |

A full queue, too many open entry responses, busy extraction capacity, or a full body-read pool returns `429` with `Retry-After: 5`; the per-IP shared limits return `429` with `Retry-After: 60`.

Publication also applies the instance maximum file size and remaining account quota. Without an explicit profile, new outputs are private, have no password or expiration, and do not inherit the account's default profile. An explicit profile supplies visibility, tags, expiration, naming, and share style. The normal upload rules apply: lacking `files.share` forces private visibility; profile tags need `tags.manage`; `DELETE` expiration needs `files.delete`, and `SET_PRIVATE` needs `files.share`. The profile's ownership, existence, revision, and effective inherited settings are checked again before atomic publication; changes return `409` without publishing outputs.

The normal filename-tag, OCR, and `file.ready` processing applies to newly published files. Listing an archive or reading one entry does not publish files or emit new-file events. See [webhook semantics](./webhooks) and [operator resource requirements](/hosting/storage#archive-processing).

Archive requests also produce [audit evidence](/admin/audit) under category `archives`, with request outcomes for `archive.browse`, `archive.entry.read`, `archive.extract`, and `archive.create`; every entry request, including each video range request, records its own `archive.entry.read` outcome. Preparing an entry response that starts at the entry's first byte adds `archive.member.read` with its path in `details.name`, its size in `details.size`, and the bytes being sent in `details.bytes`; later ranges of the same entry, such as seeking, don't repeat it. Extraction and creation stage their sources and add `archive.source.read`; browsing and entry reads don't stage anything. Committed extraction adds `archive.member.extract` targeting the new file, with its source archive ID in `details.fileId` and member path in `details.name`. Sizes are bytes. Normal file/folder mutation events can accompany those records. These events use the existing audit permissions, retention, and best-effort limits, add no webhook type, and do not change the response contracts above. Read success describes preparation of the response, not completion of its stream.

## Errors and retries

Errors use the usual API error response with an `error` message. No source files are removed on failure. Mutations recheck current permissions, session version, source records, destination ownership, and the selected profile before publishing their outputs.

| Status | Meaning and recovery                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `202`  | A `progress` listing is still being read. Poll again with `after` after `Retry-After` seconds.                                                                                                                                                                                                   |
| `400`  | Invalid fields or entry selectors, an archive whose structure can't be read, unsafe/conflicting paths on extraction, or a damaged entry that failed integrity verification. Correct the input or download the archive.                                                                           |
| `401`  | Missing/revoked owner-library session, any `Authorization` header, or a missing/invalid file password or expired unlock cookie on shared reads. Sign in when required, omit bearer credentials, or re-enter the current file password.                                                           |
| `403`  | Missing permission or cross-origin request. Check the account and normal upload/profile permissions.                                                                                                                                                                                             |
| `404`  | Source file, selected entry, profile, or destination is unavailable. Shared private files also return not found to ineligible viewers.                                                                                                                                                           |
| `408`  | Request cancelled, shared body reading exceeded five seconds, or extraction or creation exceeded 120 seconds. Retry a stalled submission on a stable connection; reduce oversized processing work.                                                                                               |
| `409`  | Source/destination/profile or its effective inherited settings changed, a wrapper name conflicts, or the recorded storage target is unavailable. Refresh choices or ask the operator to reconcile storage.                                                                                       |
| `413`  | Request body exceeds 16 KiB, an extraction or creation limit is exceeded, or output size/quota checks fail.                                                                                                                                                                                      |
| `415`  | Unsupported archive format, an entry listed with an `issue` (encrypted, unsupported compression, link, special, sparse, unsafe path, damaged, or incomplete), unsupported extraction compression, or an unsupported request content type. Only shared entry POSTs also accept URL-encoded forms. |
| `416`  | The `Range` starts at or beyond the end of the entry. Request a range inside its size.                                                                                                                                                                                                           |
| `429`  | The listing queue, open entry responses, extraction capacity, the shared body-read pool, or a per-IP shared limit. Honor `Retry-After`: 5 seconds for capacity, 60 seconds for the per-minute IP limits.                                                                                         |
| `500`  | Storage or processing failure. Inspect instance logs before repeating the operation.                                                                                                                                                                                                             |

Creation and extraction have no idempotency key. If the connection fails after the database commit, refresh the library before retrying so a successful operation is not repeated accidentally. A committed wrapper-name collision is rejected rather than merged into the existing folder.
