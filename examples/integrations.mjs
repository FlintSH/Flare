#!/usr/bin/env node
// Node.js 20+; no package installation required.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, extname } from 'node:path'

// Blob defaults to application/octet-stream, which does not match detected
// image/archive/document bytes. Preserve the real type for common uploads and
// accept an explicit MIME type for other formats.
const mimeTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
}

const mode = process.argv[2]
if (mode === 'upload') {
  const { FLARE_URL, FLARE_TOKEN } = process.env
  const path = process.argv[3]
  if (!FLARE_URL || !FLARE_TOKEN || !path)
    throw new Error(
      'Set FLARE_URL and FLARE_TOKEN, then run: node examples/integrations.mjs upload /path/to/file.png [mime-type]'
    )
  const mimeType = process.argv[4] || mimeTypes[extname(path).toLowerCase()]
  if (!mimeType)
    throw new Error(
      'Unknown file extension. Supply its real MIME type as the next argument (for example application/pdf).'
    )
  const form = new FormData()
  form.set(
    'file',
    new Blob([await readFile(path)], { type: mimeType }),
    basename(path)
  )
  const response = await fetch(new URL('/api/files', FLARE_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${FLARE_TOKEN}` },
    body: form,
  })
  const body = await response.text()
  if (!response.ok)
    throw new Error(`Upload failed (${response.status}): ${body}`)
  process.stdout.write(body + '\n')
} else if (mode === 'receive') {
  const secret = process.env.FLARE_WEBHOOK_SECRET
  if (!secret)
    throw new Error(
      'Set FLARE_WEBHOOK_SECRET to the signing secret shown when creating your webhook.'
    )
  const seen = new Map()
  const port = Number(process.env.PORT || 8787)
  createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/webhook') {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    let size = 0
    try {
      for await (const chunk of request) {
        size += chunk.length
        if (size > 64 * 1024) {
          response.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      const timestamp = request.headers['x-flare-timestamp']
      const supplied = request.headers['x-flare-signature']
      if (
        typeof timestamp !== 'string' ||
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        typeof supplied !== 'string'
      ) {
        response.writeHead(401).end()
        return
      }
      const expected = Buffer.from(
        'v1=' +
          createHmac('sha256', secret)
            .update(timestamp + '.')
            .update(body)
            .digest('hex')
      )
      const signature = Buffer.from(supplied)
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected)
      ) {
        response.writeHead(401).end()
        return
      }
      const event = JSON.parse(body.toString())
      if (
        event.version !== 1 ||
        event.type !== 'file.ready' ||
        event.id !== request.headers['x-flare-event-id']
      ) {
        response.writeHead(400).end()
        return
      }
      // For production side effects, persist event.id in a database transaction.
      // This in-memory deduplication deliberately remains a small example.
      if (!seen.has(event.id)) {
        console.log(
          event.test ? 'Test received:' : 'File ready:',
          event.data.name
        )
        seen.set(event.id, Date.now())
      }
      for (const [id, time] of seen)
        if (time < Date.now() - 86_400_000 || seen.size > 10_000)
          seen.delete(id)
      response.writeHead(204).end()
    } catch {
      response.writeHead(400).end()
    }
  }).listen(port, '0.0.0.0', () =>
    console.log(`Listening on port ${port}, path /webhook`)
  )
} else {
  console.log(
    'Usage: node examples/integrations.mjs upload <file> [mime-type] | receive'
  )
  process.exitCode = 1
}
