---
title: Archive API contracts
description: Share-page archive browsing and entry downloads, plus owner-session extraction and ZIP or TAR.GZ creation.
---

# Archive API contracts

The [archive workspace](/guide/archives) has separate owner-library and share-page routes. Owner-library operations require the owner's **browser session**. Shared reads follow ordinary file visibility/password rules and can be anonymous for an unprotected public file. Named tokens and legacy upload credentials do not grant access to either set of routes.

These routes are documented separately from the [named-token OpenAPI document](/openapi.json) and request builder. Ordinary file listing/upload scopes remain unchanged. Shared archives support browsing and entry downloads only; extraction and creation remain owner-only library operations.

## Routes and permissions

### Owner-library routes

These routes require a browser session, reject an `Authorization` header, and require ownership of every source. `content.read` does not substitute for ownership on these routes.

| Method and path                        | Permission                                                                     | Request                                                                                                    | Successful response                    |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `GET /api/files/{id}/archive`          | `files.read`                                                                   | No body                                                                                                    | JSON manifest                          |
| `GET /api/files/{id}/archive/entry`    | `files.read`                                                                   | Required `path` query parameter                                                                            | Entry bytes as an attachment           |
| `POST /api/files/{id}/archive/extract` | `files.read`, `files.upload`, `folders.manage`                                 | JSON `{ "folderId": null, "name": "Extracted project", "profileId": null }`                                | JSON describing the new wrapper folder |
| `POST /api/files/archive`              | `files.read`, `files.upload`; also `folders.manage` for a non-null destination | JSON `{ "fileIds": ["FILE_ID"], "name": "Project", "format": "zip", "folderId": null, "profileId": null }` | JSON describing the generated file     |

Every source file and non-null destination folder in an owner-library request must belong to the session account. `folderId: null` means the top level: extracted content receives a new top-level wrapper folder, while a generated archive remains unfiled. Archive creation accepts `format: "zip"` or `"tar.gz"`.

Owner-library POST requests require same-origin JSON with a maximum body of **16 KiB**, including streamed bodies. Unknown fields are rejected. `profileId` is optional: omitted or `null` explicitly uses private/no-expiration defaults and does not inherit the account's default profile. A non-null value selects an owned upload profile; additional tag and expiration permissions apply as described below. The folder destination stays independent of the profile.

For a selected profile, optional `profileRevision` carries its ISO `updatedAt` timestamp from `GET /api/upload-profiles`. Optional `profileEffectiveRevision` carries that profile's `effectiveRevision`, a 64-character lowercase hexadecimal digest of its effective settings, including inherited account and instance defaults. Either field requires a non-null `profileId`, otherwise the request returns `400`. The browser sends both values from the settings it displayed.

A stale supplied revision, or a selected profile deleted after either revision was captured, returns `409` before source staging or object writes. The effective-settings digest covers visibility, relative expiration, expiry action, URL naming, tags, and share style; it excludes the computed expiration deadline and unrelated account edits. Omitting the optional fields snapshots settings at request start. All requests recheck the selected profile and effective settings before publication, so a relevant default changed during processing also rejects the operation. Fixed **Private (no profile)** output remains independent of those defaults.

Creation requires 1–100 distinct `fileIds`. Its `name` is trimmed, 1–180 characters, and cannot be `.`, `..`, contain slashes, or contain control/format characters. The matching `.zip` or `.tar.gz` suffix is appended when absent. Extraction uses the normal folder-name rules: Unicode normalization, trimmed/collapsed whitespace, 1–80 characters, no slashes/control characters, and neither `.` nor `..`. A conflicting sibling folder is not overwritten.

Successful JSON responses use the usual `{ "success": true, "data": ... }` envelope. Entry downloads are binary responses rather than JSON. Sizes and `totalBytes` are **bytes**, unlike the existing file-list `size` field, which is MiB.

Responses use `Cache-Control: private, no-store`. Entry downloads use a detected PNG, JPEG, GIF, WebP, AVIF, or BMP MIME type for supported raster images and `application/octet-stream` otherwise. All use attachment disposition, `nosniff`, and a restrictive sandbox policy; the browser UI creates its own safe preview rather than navigating to an active archive document.

### Share-page routes

| Method and path                            | Body                                                                                                                              | Successful response             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `POST /api/files/{id}/archive/share`       | JSON `{ "password": "FILE_PASSWORD" }`, or `{}` for an unprotected file                                                           | The same JSON manifest envelope |
| `POST /api/files/{id}/archive/share/entry` | JSON or URL-encoded form `{ "path": "project/readme.txt", "password": "FILE_PASSWORD" }`; omit `password` for an unprotected file | Entry bytes as an attachment    |

Both shared routes reject any `Authorization` header, even alongside a valid cookie, and require a same-origin request. Passwords belong in the request body, never in a new archive URL or query string. Shared request bodies have the same **16 KiB** limit. `password` is an optional string of at most 1,024 characters; `null` and unknown fields return `400`. An empty string passes structural validation but cannot unlock a file requiring a password. `path` is required for an entry and must contain 1–1,024 characters matching a manifest file path. URL-encoded entry forms reject duplicate or unknown fields. The form variant allows a browser to download an attachment without first buffering the complete entry in JavaScript.

Shared requests pass the header/origin and IP-rate checks first. Body reading then has its own **five-second deadline** and a separate limit of **32 pending body reads per application process**, shared across both routes. A stalled body returns `408`; a full body-read pool returns `429` with `Retry-After: 5`. Every completion, failure, or cancellation releases that body-read slot. The body is parsed and validated, and file access authorized, **before** reserving an archive-processing slot or creating its temporary workspace. Incomplete, malformed, or unauthorized requests therefore do not occupy the two archive-processing slots or the per-file slot.

The file's current [sharing rules](/guide/sharing#choose-who-can-open-a-file) determine access: an unprotected public file is readable anonymously; a protected public file needs its password; a private file requires an eligible owner session with `files.read` or a session with `content.read`. Owners and content moderators bypass file-password prompts under those same rules. Signing in as an unrelated account or presenting a file password does not override private visibility.

Access, the source record, and its password are checked again after staging before returning the manifest or entry. A removed or newly private source can return `404`; a changed visitor password returns `401`; changed source identity, name, content path, MIME type, or recorded storage target returns `409`. If a session or role loses its bypass, ordinary visitor rules apply: an unprotected public file can still be read, but a private/protected one requires the corresponding current access. A previous successful manifest is not an access grant for later downloads. The normal expiry worker still controls scheduled expiration. A disabled folder share or moved folder member blocks that folder entrypoint, but does not revoke the independent canonical URL of a file that remains public.

These routes do not extract into an account, publish new files, or change the archive. They share a limit of **30 requests per IP per minute per application process**, and only one shared operation per source file can run in a process at once. The global two-operation process limit and all archive size/path/time limits still apply.

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

To download a member of an unprotected public archive, submit the exact manifest path in a POST form. Add a `password` field only when required. Use an existing in-memory value from the password form; do not put it in local storage or the URL:

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
      { "path": "project/readme.txt", "type": "file", "size": 42 }
    ],
    "fileCount": 1,
    "totalBytes": 42
  }
}
```

The manifest lists files and directories after validation. It does not create file records or make entries independently public. The entire archive must satisfy the supported-format and safety limits; an invalid member rejects the operation instead of producing a truncated listing.

## Download one entry

Use the exact file path returned by the manifest and encode it as a query value. Directory entries cannot be downloaded as individual files.

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

This downloads a copy without adding it to the account's library. Browser preview support is a separate concern: the dashboard renders supported images and bounded text, with HTML/SVG treated as text.

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

Inspection accepts ZIP with stored or deflated members, TAR, TAR.GZ/TGZ, and GZIP. RAR, 7z, encrypted or split archives, symlinks, special files, unsafe paths, and conflicting normalized paths are unsupported. Paths cannot escape the archive root; folder components follow the normal 80-character folder-name limit, and filenames are limited to 255 characters. Parent directories inferred from member paths count toward the entry limit. A normal Flare password on an owned archive is independent of archive encryption and does not prevent owner access through these routes.

The fixed limits are 256 MiB per source archive, generated archive, or individual member/source file; 512 MiB expanded or combined selected source bytes; 1,000 members including directories; 100 selected files; 20 path levels; and 1,024 characters per archive path. One MiB is 1,048,576 bytes. Archive processing has a **120-second deadline**. For shared routes it starts after body validation and file authorization; the five-second body deadline and authorization time precede it, so 120 seconds is not a total shared-request wall-clock limit. Owner-library operations retain their existing deadline, starting before their request body is read.

Each application process permits two concurrent archive operations, with at most one owner-library operation per account or one shared operation per source file. These limits are separate from the 32 pending shared body reads and are not distributed across replicas. A full body-read pool or busy archive processing returns `429` with `Retry-After: 5`; the shared-read limit of 30 requests per IP per minute returns `429` with `Retry-After: 60`.

Publication also applies the instance maximum file size and remaining account quota. Without an explicit profile, new outputs are private, have no password or expiration, and do not inherit the account's default profile. An explicit profile supplies visibility, tags, expiration, naming, and share style. The normal upload rules apply: lacking `files.share` forces private visibility; profile tags need `tags.manage`; `DELETE` expiration needs `files.delete`, and `SET_PRIVATE` needs `files.share`. The profile's ownership, existence, revision, and effective inherited settings are checked again before atomic publication; changes return `409` without publishing outputs.

The normal filename-tag, OCR, and `file.ready` processing applies to newly published files. Inspecting a manifest or downloading one entry does not publish files or emit new-file events. See [webhook semantics](./webhooks) and [operator resource requirements](/hosting/storage#archive-processing).

## Errors and retries

Errors use the usual API error response with an `error` message. No source files are removed on failure. Mutations recheck current permissions, session version, source records, destination ownership, and the selected profile before publishing their outputs.

| Status | Meaning and recovery                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid fields, unsafe/conflicting paths, malformed archives, or invalid entry requests. Correct the input.                                                                                                   |
| `401`  | Missing/revoked owner-library session, any `Authorization` header, or a missing/invalid file password on shared reads. Sign in when required, omit bearer credentials, or re-enter the current file password. |
| `403`  | Missing permission or cross-origin request. Check the account and normal upload/profile permissions.                                                                                                          |
| `404`  | Source file, selected entry, profile, or destination is unavailable. Shared private files also return not found to ineligible viewers.                                                                        |
| `408`  | Request cancelled, shared body reading exceeded five seconds, or archive processing exceeded 120 seconds. Retry a stalled submission on a stable connection; reduce oversized processing work.                |
| `409`  | Source/destination/profile or its effective inherited settings changed, a wrapper name conflicts, or the recorded storage target is unavailable. Refresh choices or ask the operator to reconcile storage.    |
| `413`  | Request body exceeds 16 KiB, an archive limit is exceeded, or output size/quota checks fail.                                                                                                                  |
| `415`  | Unsupported archive format/encryption/compression, or an unsupported request content type. Only shared entry downloads also accept URL-encoded forms.                                                         |
| `429`  | Shared body-read pool, archive concurrency, or shared-read IP rate limit. Honor `Retry-After`: 5 seconds for body/processing capacity, 60 seconds for the 30-per-minute IP limit.                             |
| `500`  | Storage or processing failure. Inspect instance logs before repeating the operation.                                                                                                                          |

Creation and extraction have no idempotency key. If the connection fails after the database commit, refresh the library before retrying so a successful operation is not repeated accidentally. A committed wrapper-name collision is rejected rather than merged into the existing folder.
