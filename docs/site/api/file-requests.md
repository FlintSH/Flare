---
title: File request contracts
description: Browser-session APIs for creating and managing file requests, and the public protocol senders use to send files to a request link.
---

# File request contracts

These routes serve [Requests](/guide/file-requests) and the **Let everyone request files** switch in [Settings → General](/admin/#file-requests). There are two groups:

- **Owner routes** under `/api/file-requests` require a current browser session. **Neither named API tokens nor the legacy upload credential authorize them**, and bearer requests without a session cookie receive `401`. Mutations reject cross-origin requests, and `POST`/`PATCH`/`PUT` bodies must be `application/json` (at most 32 KB).
- **Public routes** under `/api/r/{token}` take no account at all. The request link's token is the authorization. They mirror the link itself: a sender's page at `/r/{token}` talks to `/api/r/{token}`.

The [OpenAPI document](/openapi.json) continues to describe only named-token operations under `paths`; these routes are deliberately excluded. Existing token scopes are unchanged. Files that arrive through a request produce the usual [`file.ready` webhook](./webhooks) for their owner; there is no new event type or field.

| Method and path                                            | Authorization                                                      | Result                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `GET /api/file-requests`                                   | Session with `fileRequests.manage`                                 | `{ requests, pagination, policy }`     |
| `POST /api/file-requests`                                  | Session with `fileRequests.manage` and `files.upload`              | `201 { request }`                      |
| `GET /api/file-requests/{id}`                              | Session with `fileRequests.manage`; your own request               | `{ request, submissions, pagination }` |
| `PATCH /api/file-requests/{id}`                            | Session with `fileRequests.manage` and `files.upload`              | `{ request }`                          |
| `DELETE /api/file-requests/{id}`                           | Session with `fileRequests.manage`; your own request               | `{ "deleted": true }`                  |
| `GET /api/settings/file-requests`                          | Session with `settings.read`                                       | `{ everyoneCanRequestFiles }`          |
| `PUT /api/settings/file-requests`                          | Session with `settings.general` and your own `fileRequests.manage` | `{ everyoneCanRequestFiles }`          |
| `POST /api/r/{token}/submissions`                          | Public: an open request link                                       | `201 { submission, request }`          |
| `POST /api/r/{token}/uploads`                              | Public, with the submission key                                    | `201 { uploadId, partSize }`           |
| `PUT /api/r/{token}/uploads/{uploadId}/parts/{partNumber}` | Public, with the submission key                                    | `{ partNumber, size, etag }`           |
| `POST /api/r/{token}/uploads/{uploadId}/complete`          | Public, with the submission key                                    | `{ file, remaining }`                  |
| `DELETE /api/r/{token}/uploads/{uploadId}`                 | Public, with the submission key                                    | `{ "cancelled": true }`                |
| `POST /api/r/{token}/submissions/{id}/complete`            | Public, with the submission key                                    | `{ fileCount, bytes }`                 |

Every response sends `Cache-Control: private, no-store`. Do not cache these results in shared storage.

## Request objects

```json
{
  "id": "example_request_id",
  "title": "Brand assets for the Acme launch",
  "message": "Logos, fonts, and the latest brand guide.",
  "status": "open",
  "pausedReason": null,
  "token": "example-24-character-tok",
  "senderName": "optional",
  "profile": { "id": "example_profile_id", "name": "Client deliveries" },
  "folder": { "id": "example_folder_id", "name": "Acme rebrand" },
  "maxFiles": null,
  "maxBytes": 5368709120,
  "fileCount": 3,
  "bytesReceived": 12594688,
  "expiresAt": "2026-12-03T10:00:00.000Z",
  "closedAt": null,
  "notify": true,
  "lastReceivedAt": "2026-11-03T10:05:00.000Z",
  "unseen": true,
  "createdAt": "2026-11-03T10:00:00.000Z",
  "updatedAt": "2026-11-03T10:05:00.000Z"
}
```

| Field                        | Meaning                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                     | `open`, `paused`, `closed`, `expired`, or `full`. `paused` means the request is otherwise open but something on the owner's side stops deliveries; it becomes `open` again when that is fixed. Treat unknown values as unusable. |
| `pausedReason`               | A sentence for the owner when `status` is `paused`, such as `Your storage is full. Free up space to receive files.`; otherwise `null`.                                                                                           |
| `token`                      | The link's secret. Build the link as `https://files.example.com/r/<token>` with the instance's public origin. Tokens are 24 URL-safe Base64 characters. Never log them or send them to a third-party service.                    |
| `senderName`                 | `off`, `optional`, or `required`: whether senders are asked for a name.                                                                                                                                                          |
| `profile`, `folder`          | The upload profile and folder applied to received files, or `null` for the account default and Unfiled. Deleting either sets it to `null`.                                                                                       |
| `maxFiles`, `maxBytes`       | Limits on deliveries, or `null`. `maxBytes` is in bytes.                                                                                                                                                                         |
| `fileCount`, `bytesReceived` | Files and bytes delivered so far. Deleting a received file does not lower them.                                                                                                                                                  |
| `expiresAt`, `closedAt`      | ISO timestamps or `null`. `expiresAt: null` has no deadline.                                                                                                                                                                     |
| `unseen`                     | Files arrived after the owner last opened the request with `GET /api/file-requests/{id}`.                                                                                                                                        |

Status precedence is `closed`, then `expired`, then `full`, then `paused`.

## List and read requests

`GET /api/file-requests` accepts `status` (`all` by default, `open`, or `ended` for closed, expired, and full), `page` (1–100,000), and `limit` (1–50, default 20). Results are newest first. `policy` describes the caller:

```json
{ "canCreate": true, "openCount": 2, "maxOpen": 100, "canNotify": true }
```

`canNotify` is `true` when account email is enabled and the caller's address is verified; otherwise `notify` is stored but no email is sent.

`GET /api/file-requests/{id}` adds what arrived, 20 senders per page (`page` query parameter), newest first. It also marks the request's arrivals as seen. Visits that never delivered a file are not listed.

```json
{
  "id": "example_submission_id",
  "senderName": "Sam Lee",
  "note": "Everything from the agency.",
  "createdAt": "2026-11-03T10:04:00.000Z",
  "completedAt": "2026-11-03T10:05:00.000Z",
  "fileCount": 3,
  "bytes": 12594688,
  "files": [
    {
      "id": "example_file_id",
      "name": "acme-fonts.zip",
      "sizeBytes": 12582912,
      "mimeType": "application/zip",
      "urlPath": "/alexm/k3x9qa.zip",
      "uploadedAt": "2026-11-03T10:05:00.000Z"
    }
  ],
  "remainingFiles": 0
}
```

`files` lists up to 100 files that still exist; `remainingFiles` counts the others in the library. `fileCount` and `bytes` count deliveries, including files deleted since. `completedAt` is `null` until the sender's page finishes the batch.

## Create a request

`POST /api/file-requests` accepts a strict JSON object. Omitted fields use these defaults; unknown fields are rejected.

| Field            | Default      | Validation                                                          |
| ---------------- | ------------ | ------------------------------------------------------------------- |
| `title`          | Required     | Trimmed single line, 1–100 characters.                              |
| `message`        | `""`         | Trimmed text, at most 1,000 characters. Line breaks are kept.       |
| `senderName`     | `"optional"` | `off`, `optional`, or `required`.                                   |
| `profileId`      | `null`       | One of your upload profiles, or `null` for your account default.    |
| `folderId`       | `null`       | One of your folders, or `null` for Unfiled. Needs `folders.manage`. |
| `maxFiles`       | `null`       | Integer 1–10,000, or `null`.                                        |
| `maxBytes`       | `null`       | Integer from 1,048,576 (1 MB) to 10 TB, or `null`.                  |
| `expiresInHours` | `168`        | Integer 1–8,760 counted from now, or `null` for no deadline.        |
| `notify`         | `false`      | Email the owner when files arrive.                                  |

An unknown profile or folder, or one owned by someone else, returns `404`. A destination that would make every delivery fail returns `400` with the reason, for example a profile that adds tags when the caller lacks `tags.manage`, or deletes files when the caller lacks `files.delete`. You can have 100 open requests; another returns `409`.

## Change a request

`PATCH /api/file-requests/{id}` accepts any of the create fields, plus:

| Field         | Effect                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `closed`      | `true` closes the request; `false` reopens it.                                                               |
| `replaceLink` | `true` issues a new `token`. The old link and every upload session started from it stop working immediately. |

Omitted fields keep their values; an empty body returns `400`. `expiresInHours` counts from the time of the change, and `null` removes the deadline. Changes apply to files that start afterward; a file already uploading keeps the options it started with, but it is rejected at completion if the request closed, filled up, or got a new link in the meantime.

## Delete a request

`DELETE /api/file-requests/{id}` deletes the request and its sender names and notes. Received files stay in the owner's library, no longer linked to a request. An unknown ID or another account's request returns `404`.

## Change who can request files

`GET /api/settings/file-requests` returns `{ "everyoneCanRequestFiles": false }`. `PUT /api/settings/file-requests` accepts exactly `{ "everyoneCanRequestFiles": true }` or `false` and adds or removes `fileRequests.manage` on the Everyone role. Repeating the current value succeeds without another change.

## Send files to a request link

Senders, and scripts acting for them, use five steps. Every step after the first sends the submission key in the `X-Flare-Submission-Key` header. Each file is sent in parts, whatever its size.

1. **Start a batch.** `POST /api/r/{token}/submissions` with `{ "senderName": "Sam Lee", "note": "Here you go" }`. Both fields are optional and default to `""`; `senderName` is at most 80 characters and required when the request asks for it, and `note` is at most 500. The response holds `submission.id`, `submission.key`, and `request`, the details a sender sees: `title`, `message`, `ownerName`, `senderName`, `maxFileBytes`, `filesRemaining`, `bytesRemaining`, and `expiresAt`.
2. **Start a file.** `POST /api/r/{token}/uploads` with `{ "submissionId", "filename", "mimeType", "size" }`. `size` is in bytes and must be positive. `mimeType` must match the file's contents; send `application/octet-stream` only for content Flare cannot identify. The response holds `uploadId` and `partSize`.
3. **Send each part.** `PUT /api/r/{token}/uploads/{uploadId}/parts/{n}` with the raw bytes as the body, for `n` from 1 to `ceil(size / partSize)`. Every part except the last is exactly `partSize` bytes (5 MiB, larger only for files over about 50 GB); the last holds the rest. Parts can be sent in any order or several at once, and resending a part replaces it.
4. **Complete the file.** `POST /api/r/{token}/uploads/{uploadId}/complete` with no body. Flare assembles the parts it recorded, checks the file, and delivers it. The response is `{ "file": { "name", "sizeBytes" }, "remaining": { "files", "bytes" } }`, where `remaining` values are `null` without a limit. Repeating a completion that succeeded returns the same file again, so a lost response is safe to retry. To give up on a file instead, `DELETE /api/r/{token}/uploads/{uploadId}`: its parts are discarded and its room goes back to the request. Cancelling a file that already arrived returns `409` with `upload_complete` and keeps it.
5. **Finish the batch.** `POST /api/r/{token}/submissions/{id}/complete` with no body. This tells the owner's notifications the sender is done. Files already arrived even if you skip it.

This Node.js 20+ script sends files to a request link using only built-in modules. Save it as `send-to-request.mjs` and run `node send-to-request.mjs https://files.example.com/r/<token> report.pdf photo.png`:

```js
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const [link, ...paths] = process.argv.slice(2)
const api = link.replace('/r/', '/api/r/')
const types = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
}

async function call(path, init) {
  const response = await fetch(api + path, init)
  const body = await response.json()
  if (!response.ok) throw new Error(`${body.code}: ${body.error}`)
  return body
}

const { submission } = await call('/submissions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ senderName: 'Build server' }),
})
const key = { 'X-Flare-Submission-Key': submission.key }
for (const path of paths) {
  const bytes = await readFile(path)
  const { uploadId, partSize } = await call('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...key },
    body: JSON.stringify({
      submissionId: submission.id,
      filename: basename(path),
      mimeType:
        types[extname(path).toLowerCase()] ?? 'application/octet-stream',
      size: bytes.length,
    }),
  })
  for (let part = 1; (part - 1) * partSize < bytes.length; part++)
    await call(`/uploads/${uploadId}/parts/${part}`, {
      method: 'PUT',
      headers: key,
      body: bytes.subarray((part - 1) * partSize, part * partSize),
    })
  const { file } = await call(`/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: key,
  })
  console.log(`Sent ${file.name} (${file.sizeBytes} bytes)`)
}
await call(`/submissions/${submission.id}/complete`, {
  method: 'POST',
  headers: key,
})
```

Upload sessions are the same chunk sessions the dashboard uses: they expire after an hour without activity and live on the application's filesystem, so the [multi-replica notes for chunked uploads](./files#chunked-uploads) apply.

Starting a file reserves its declared size: until it completes, fails, is cancelled, or sends no part for 10 minutes, it counts against the request's file and size limits and the owner's quota, together with every other file on its way. A batch can have 3 files on their way and a request 20. Parts are accepted only while the request is open and the batch unfinished. A file that fails at completion, is cancelled, or lapses has its parts discarded and its reservation released. Flare's sender page cancels a file as soon as it fails.

Browsers can only call these routes from Flare's own pages: they send no CORS headers. Starting batches, starting files, and completing files and batches count toward a limit of 120 requests per minute from one client address, and parts toward a separate limit of 1,800 per minute. A `429` response includes `Retry-After`. Flare's sender page waits and retries.

## Sender errors

Public routes answer failures with a stable `code` and a message safe to show a sender:

```json
{
  "error": "This request is full. It has received all the files it can accept. Ask the person who sent it for more room.",
  "code": "full"
}
```

| `code`                | Status     | Meaning                                                                                                             |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `invalid`             | 404        | Malformed, unknown, deleted, or replaced link.                                                                      |
| `closed`, `expired`   | 410        | The owner closed the request, or its deadline passed.                                                               |
| `full`                | 409        | The file limit was reached, including by a file that finished first.                                                |
| `busy`                | 409        | 20 files are already on their way to this request. Try again in a few minutes.                                      |
| `too_many_uploads`    | 409        | This batch already has 3 files on their way. Finish one before starting another.                                    |
| `paused`              | 409        | Something on the owner's side stops deliveries. The reason is never disclosed to senders.                           |
| `name_required`       | 400        | The request requires a sender name.                                                                                 |
| `invalid_session`     | 403        | Missing or wrong submission key, a batch from a replaced link, or a file sent to another batch.                     |
| `submission_complete` | 409        | The batch already finished. Start a new one.                                                                        |
| `too_large`           | 413        | Larger than the instance's maximum file size.                                                                       |
| `request_limit`       | 409 or 413 | Larger than the space left in the request (413), or files already on their way take the remaining file slots (409). |
| `quota`               | 413        | The owner's storage quota has no room for the file.                                                                 |
| `part_size`           | 400 or 413 | A part number beyond the file, or a part that isn't the expected size.                                              |
| `incomplete_upload`   | 400        | Completing before every part arrived. Send the missing parts and complete again.                                    |
| `upload_not_found`    | 404        | Unknown upload, one belonging to another batch, or one cancelled or idle for 10 minutes and discarded.              |
| `upload_complete`     | 409        | A part sent after the file was already delivered.                                                                   |
| `size_mismatch`       | 400        | The assembled parts don't add up to the declared size. Send the file again.                                         |
| `storage_changed`     | 409        | The instance's storage changed during the upload. Send the file again.                                              |
| `upload_failed`       | varies     | Another upload failure, such as contents that don't match `mimeType`. The message explains it.                      |
| `server_error`        | 500        | An unexpected failure. Try again; the server log has the details.                                                   |
| `invalid_request`     | 400        | A body that doesn't match these contracts.                                                                          |

A sender can never reach the owner's library, other senders' files, or a link to a file they sent. Received files are always private when they arrive. Owners' browser sessions cannot use a sender's upload, and senders cannot use the owner's [chunked upload routes](./files).
