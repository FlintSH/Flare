---
title: Integration recipes
description: Practical cURL and Node.js recipes for uploads, pagination, chunking, and webhook receivers.
---

# Integration recipes

These examples call your own Flare instance. Set `FLARE_URL` to its origin, such as `https://files.example.com`, and provide `FLARE_TOKEN` through your local environment or your automation platform's secret store. Pick a token with the scopes each recipe needs.

The Node.js examples use Node 20+ built-ins. Save each complete JavaScript example as a `.mjs` file and run it with `node`. There is no Flare SDK package to install.

## Upload from a shell

**Scope:** `files:upload` · **Tools:** cURL; jq if extracting a field

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -F 'file=@./screenshot.png' \
  "$FLARE_URL/api/files"
```

To capture the share link with jq while preserving an HTTP failure:

```bash
set -o pipefail
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $FLARE_TOKEN" \
  -F 'file=@./screenshot.png' \
  "$FLARE_URL/api/files" | jq -r '.data.pageUrl'
```

Use `X-Upload-Profile` to select a saved profile, or bind the token to that profile in the dashboard. A bound token keeps your script's policy on the Flare side; the script only needs to send the file.

## Upload from Node.js

**Scope:** `files:upload`

[Download the runnable upload/receiver example](/integrations.mjs), or read its [repository source](https://github.com/FlintSH/Flare/blob/main/examples/integrations.mjs).

```sh
# From a repository checkout:
node examples/integrations.mjs upload ./screenshot.png

# If you downloaded the example directly:
node integrations.mjs upload ./screenshot.png

# Supply the real MIME type when the extension is unknown or ambiguous:
node integrations.mjs upload ./report.data application/pdf
```

It builds a `FormData` body with the `file` field, infers a MIME type for common extensions, and prints the response JSON. The optional final argument overrides inference. Unknown extensions require an explicit MIME type; use the actual file format, since Flare checks detected bytes against the claimed type. Read the share URL from `data.pageUrl` (`data.url` and `data.copyText` are compatibility aliases).

The client reads the file into memory, making it convenient for screenshots and small artifacts. For larger files, use the chunked recipe below or cURL's file upload.

## Page through your library

**Scope:** `files:read`

This script emits one JSON record per file, with the list endpoint's MiB size converted into bytes. Save as `list-files.mjs`.

```js
const { FLARE_URL, FLARE_TOKEN } = process.env
if (!FLARE_URL || !FLARE_TOKEN) {
  throw new Error('Set FLARE_URL and FLARE_TOKEN')
}

const seen = new Set()
for (let page = 1; ; page++) {
  const url = new URL('/api/files', FLARE_URL)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', '100')
  url.searchParams.set('sortBy', 'oldest')
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${FLARE_TOKEN}` },
  })
  if (!response.ok) {
    throw new Error(
      `Listing failed (${response.status}): ${await response.text()}`
    )
  }
  const result = await response.json()
  for (const file of result.data) {
    if (seen.has(file.id)) continue
    seen.add(file.id)
    console.log(
      JSON.stringify({
        id: file.id,
        name: file.name,
        sizeBytes: Math.round(file.size * 1024 * 1024),
        uploadedAt: file.uploadedAt,
      })
    )
  }
  if (page >= result.pagination.pageCount) break
}
```

```sh
node list-files.mjs > flare-files.jsonl
```

This is a metadata export, not a backup of file bytes. The API uses offset pagination, so simultaneous additions/deletions can change the list during traversal. The small duplicate guard helps with repeated records, but cannot create a database snapshot. Run reconciliation when the library is quiet if you need a stable comparison.

## Upload a file in parts

**Scope:** `files:upload`

This complete example uses Flare's authenticated part endpoint, so the same client works with local and S3 storage. It keeps only a 5 MiB part in memory at a time and uses the unwrapped dedicated completion response. Save as `chunk-upload.mjs`.

```js
import { open } from 'node:fs/promises'
import { basename } from 'node:path'

const { FLARE_URL, FLARE_TOKEN } = process.env
const [filePath, mimeType] = process.argv.slice(2)
if (!FLARE_URL || !FLARE_TOKEN || !filePath || !mimeType) {
  throw new Error(
    'Set FLARE_URL and FLARE_TOKEN; usage: node chunk-upload.mjs FILE MIME_TYPE'
  )
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, FLARE_URL), {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${FLARE_TOKEN}`,
    },
  })
  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}): ${await response.text()}`
    )
  }
  return response.json()
}

const file = await open(filePath, 'r')
try {
  const { size } = await file.stat()
  if (size === 0) throw new Error('Use a nonempty file for chunked uploads')
  const chunkSize = 5 * 1024 * 1024
  if (Math.ceil(size / chunkSize) > 10000) {
    throw new Error('This example is limited to 10,000 parts')
  }
  const {
    data: { uploadId },
  } = await request('/api/files/chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: basename(filePath), mimeType, size }),
  })

  const parts = []
  for (let offset = 0, part = 1; offset < size; part++) {
    const buffer = Buffer.alloc(Math.min(chunkSize, size - offset))
    let filled = 0
    while (filled < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        filled,
        buffer.length - filled,
        offset + filled
      )
      if (bytesRead === 0)
        throw new Error('The source file changed while uploading')
      filled += bytesRead
    }
    const {
      data: { etag },
    } = await request(`/api/files/chunks/${uploadId}/part/${part}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    })
    parts.push({ PartNumber: part, ETag: etag })
    offset += buffer.length
  }

  const result = await request(`/api/files/chunks/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
  })
  console.log(result.pageUrl)
} finally {
  await file.close()
}
```

```sh
node chunk-upload.mjs ./archive.zip application/zip
```

Provide the file's real MIME type and keep the source file unchanged during upload. The example stops on an error. A production client can persist `uploadId`, part numbers, and ETags, then retry failed parts while the session remains valid. Do not restart a successful ordinary multipart upload automatically: unlike chunk completion, it has no duplicate-prevention key.

## Make a short link in an automation

**Scope:** `urls:write`

Save as `shorten.mjs`. This constructs JSON safely even when the destination contains quotes or query parameters.

```js
const { FLARE_URL, FLARE_TOKEN } = process.env
const destination = process.argv[2]
if (!FLARE_URL || !FLARE_TOKEN || !destination) {
  throw new Error('Set FLARE_URL and FLARE_TOKEN; usage: node shorten.mjs URL')
}
const response = await fetch(new URL('/api/urls', FLARE_URL), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${FLARE_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: destination }),
})
if (!response.ok)
  throw new Error(`HTTP ${response.status}: ${await response.text()}`)
const { data } = await response.json()
console.log(new URL(`/u/${data.shortCode}`, FLARE_URL).href)
```

```sh
node shorten.mjs 'https://example.com/a/long/path?source=release'
```

## Receive a signed webhook

**Credential:** the webhook's `whsec_…` signing secret, not an API token

Set `FLARE_WEBHOOK_SECRET` in the environment and run the downloaded [receiver example](/integrations.mjs):

```sh
node integrations.mjs receive
```

The receiver listens on port 8787 at `/webhook`. Configure your reverse proxy so Flare can reach the final HTTPS URL without a redirect, then send a test from **Profile → Integrations**. The example logs the filename after authenticating the payload and returns `204`.

The receiver's in-memory duplicate cache is intentionally simple. For durable actions, persist accepted event IDs and queue your work in a database transaction. Review [signature verification](./webhooks#verify-each-delivery), [retry behavior](./webhooks#retries-and-delivery-states), and the [event schema](/file-ready-event.schema.json) before deploying it.

## Pick a token for the job

| Connection                | Suggested permissions     | Optional profile                |
| ------------------------- | ------------------------- | ------------------------------- |
| Screenshot uploader       | `files:upload`            | Your screenshots sharing policy |
| CI artifact publisher     | `files:upload`            | Expiring private artifacts      |
| Library metadata reporter | `files:read`              | None                            |
| Link creation bot         | `urls:write`              | None                            |
| Link management tool      | `urls:read`, `urls:write` | None                            |

Bind a token when a tool should always follow one profile. Use separate tokens for unrelated jobs so revoking a retired machine does not interrupt active services.
