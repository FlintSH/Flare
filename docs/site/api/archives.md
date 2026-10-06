---
title: Archive session contracts
description: Browser-session requests for inspecting archive entries, extracting files, and creating ZIP or TAR.GZ archives.
---

# Archive session contracts

The [archive workspace](/guide/archives) operates on the signed-in account's own files. Every endpoint below requires a **browser session** and rejects an `Authorization` header. Named tokens and legacy upload credentials cannot authorize these operations, even when their owner is an administrator. `content.read` does not grant archive access to another user's files.

These routes are documented separately from the [named-token OpenAPI document](/openapi.json) and request builder. Ordinary file listing/upload scopes and public file-download rules remain unchanged. Downloading a public archive still returns its original bytes; these endpoints do not add public entry browsing or extraction.

## Routes and permissions

| Method and path                        | Permission                                                                     | Request                                                                                                    | Successful response                    |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `GET /api/files/{id}/archive`          | `files.read`                                                                   | No body                                                                                                    | JSON manifest                          |
| `GET /api/files/{id}/archive/entry`    | `files.read`                                                                   | Required `path` query parameter                                                                            | Entry bytes as an attachment           |
| `POST /api/files/{id}/archive/extract` | `files.read`, `files.upload`, `folders.manage`                                 | JSON `{ "folderId": null, "name": "Extracted project", "profileId": null }`                                | JSON describing the new wrapper folder |
| `POST /api/files/archive`              | `files.read`, `files.upload`; also `folders.manage` for a non-null destination | JSON `{ "fileIds": ["FILE_ID"], "name": "Project", "format": "zip", "folderId": null, "profileId": null }` | JSON describing the generated file     |

Every source file and non-null destination folder must belong to the session account. `folderId: null` means the top level: extracted content receives a new top-level wrapper folder, while a generated archive remains unfiled. Archive creation accepts `format: "zip"` or `"tar.gz"`.

POST requests require same-origin JSON with a maximum body of **16 KiB**, including streamed bodies. Unknown fields are rejected. `profileId` is optional: omitted or `null` explicitly uses private/no-expiration defaults and does not inherit the account's default profile. A non-null value selects an owned upload profile; additional tag and expiration permissions apply as described below. The folder destination stays independent of the profile.

For a selected profile, optional `profileRevision` carries its ISO `updatedAt` timestamp from `GET /api/upload-profiles`; supplying a revision without a non-null `profileId` returns `400`. The browser sends the revision whose settings it displayed. A profile changed or deleted before submission returns `409` before source staging or object writes; omitting the revision snapshots the profile at request start. Both forms also recheck the profile before publication, so a change during processing rejects the operation.

Creation requires 1–100 distinct `fileIds`. Its `name` is trimmed, 1–180 characters, and cannot be `.`, `..`, contain slashes, or contain control/format characters. The matching `.zip` or `.tar.gz` suffix is appended when absent. Extraction uses the normal folder-name rules: Unicode normalization, trimmed/collapsed whitespace, 1–80 characters, no slashes/control characters, and neither `.` nor `..`. A conflicting sibling folder is not overwritten.

Successful JSON responses use the usual `{ "success": true, "data": ... }` envelope. Entry downloads are binary responses rather than JSON. Sizes and `totalBytes` are **bytes**, unlike the existing file-list `size` field, which is MiB.

Responses use `Cache-Control: private, no-store`. Entry downloads use a detected PNG, JPEG, GIF, WebP, AVIF, or BMP MIME type for supported raster images and `application/octet-stream` otherwise. All use attachment disposition, `nosniff`, and a restrictive sandbox policy; the browser UI creates its own safe preview rather than navigating to an active archive document.

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

To use an owned profile, read its current settings and send the reviewed revision with either mutation. Listing saved profiles requires `uploadProfiles.manage`. Review `profile.options` before creating or extracting public content:

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

The fixed limits are 256 MiB per source archive, generated archive, or individual member/source file; 512 MiB expanded or combined selected source bytes; 1,000 members including directories; 100 selected files; 20 path levels; and 1,024 characters per archive path. One MiB is 1,048,576 bytes. Each request has a total 120-second deadline. Each application process permits two concurrent archive operations, with at most one per account in that process. These are not distributed limits across replicas. A busy request returns `429`.

Publication also applies the instance maximum file size and remaining account quota. Without an explicit profile, new outputs are private, have no password or expiration, and do not inherit the account's default profile. An explicit profile supplies visibility, tags, expiration, naming, and share style. The normal upload rules apply: lacking `files.share` forces private visibility; profile tags need `tags.manage`; `DELETE` expiration needs `files.delete`, and `SET_PRIVATE` needs `files.share`. The profile's ownership, existence, and revision are checked again before atomic publication; changed/deleted profiles return `409` without publishing outputs.

The normal filename-tag, OCR, and `file.ready` processing applies to newly published files. Inspecting a manifest or downloading one entry does not publish files or emit new-file events. See [webhook semantics](./webhooks) and [operator resource requirements](/hosting/storage#archive-processing).

## Errors and retries

Errors use the usual API error response with an `error` message. No source files are removed on failure. Mutations recheck current permissions, session version, source records, destination ownership, and the selected profile before publishing their outputs.

| Status | Meaning and recovery                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid fields, unsafe/conflicting paths, malformed archives, or invalid entry requests. Correct the input.                                                            |
| `401`  | Missing/revoked browser session or any `Authorization` header. Sign in and omit bearer credentials.                                                                    |
| `403`  | Missing permission or cross-origin mutation. Check the account and normal upload/profile permissions.                                                                  |
| `404`  | Source file, selected entry, profile, or destination is unavailable to this account.                                                                                   |
| `408`  | Request cancelled or the 120-second deadline expired. Reduce the work before retrying.                                                                                 |
| `409`  | Source/destination/profile changed, a wrapper name conflicts, or the recorded storage target is unavailable. Refresh choices or ask the operator to reconcile storage. |
| `413`  | JSON exceeds 16 KiB, an archive limit is exceeded, or output size/quota checks fail.                                                                                   |
| `415`  | Unsupported format, archive encryption/compression, or a POST body without JSON content type.                                                                          |
| `429`  | Another archive operation is active; honor `Retry-After: 5` before retrying.                                                                                           |
| `500`  | Storage or processing failure. Inspect instance logs before repeating the operation.                                                                                   |

Creation and extraction have no idempotency key. If the connection fails after the database commit, refresh the library before retrying so a successful operation is not repeated accidentally. A committed wrapper-name collision is rejected rather than merged into the existing folder.
