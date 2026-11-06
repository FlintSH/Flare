import { NextResponse } from 'next/server'

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'

import { getConfig, updateConfig } from '@/lib/config'
import { getStorageProvider } from '@/lib/storage'
import { isMissingObject } from '@/lib/storage/missing'

import {
  FAVICON_MAX_BYTES,
  FAVICON_TYPE,
  faviconAddress,
  faviconUrl,
} from './index'

const KEY = 'uploads/favicon.png'

/** The first 16 hex digits of the icon's SHA-256, which its address carries. */
function contentVersion(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

/** Replace the favicon with this PNG and return the address pages now link to. */
export async function saveFavicon(png: Buffer): Promise<string> {
  const storage = await getStorageProvider()
  await storage.uploadFile(png, KEY, FAVICON_TYPE)
  const url = faviconAddress(contentVersion(png))
  await updateConfig({ settings: { appearance: { favicon: url } } })
  return url
}

/**
 * Answer a request for the favicon. A response may be cached for a year only
 * when the requested version is the hash of the bytes it sends, so neither an
 * address saved by an earlier version nor a request racing an upload can keep
 * an old icon cached.
 */
export async function faviconResponse(request: Request): Promise<Response> {
  if (!faviconUrl((await getConfig()).settings.appearance.favicon))
    return new Response(null, { status: 404 })
  const storage = await getStorageProvider()
  const publicUrl = await storage.getPublicUrl(KEY)
  if (publicUrl) return NextResponse.redirect(publicUrl)
  let icon: Buffer | Readable
  try {
    // Earlier versions accepted any size; stream those instead of buffering.
    icon =
      (await storage.getFileSize(KEY)) > FAVICON_MAX_BYTES
        ? await storage.getFileStream(KEY)
        : await buffer(await storage.getFileStream(KEY))
  } catch (error) {
    if (isMissingObject(error)) return new Response(null, { status: 404 })
    throw error
  }
  const current =
    Buffer.isBuffer(icon) &&
    new URL(request.url).searchParams.get('v') === contentVersion(icon)
  return new Response(
    Buffer.isBuffer(icon)
      ? new Uint8Array(icon)
      : (Readable.toWeb(icon) as ReadableStream<Uint8Array>),
    {
      headers: {
        'Content-Type': FAVICON_TYPE,
        'Cache-Control': current
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
    }
  )
}
