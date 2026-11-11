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

function contentVersion(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

/** Returns the address pages now link to. */
export async function saveFavicon(png: Buffer): Promise<string> {
  const storage = await getStorageProvider()
  await storage.uploadFile(png, KEY, FAVICON_TYPE)
  const url = faviconAddress(contentVersion(png))
  await updateConfig({ settings: { appearance: { favicon: url } } })
  return url
}

/**
 * Stops linking the favicon, so pages fall back to Flare's own icon, then
 * removes the stored image. Removing a favicon that isn't there is no error.
 */
export async function removeFavicon(): Promise<void> {
  await updateConfig({ settings: { appearance: { favicon: null } } })
  const storage = await getStorageProvider()
  try {
    await storage.deleteFile(KEY)
  } catch (error) {
    if (!isMissingObject(error)) throw error
  }
}

/**
 * A response may be cached for a year only when the requested version is the
 * hash of the bytes it sends, so neither an address saved by an earlier
 * version nor a request racing an upload can keep an old icon cached.
 * Flare sends the bytes itself, whatever the storage, so the icon gets this
 * caching and loads even where the storage address isn't reachable.
 */
export async function faviconResponse(request: Request): Promise<Response> {
  if (!faviconUrl((await getConfig()).settings.appearance.favicon))
    return new Response(null, { status: 404 })
  const storage = await getStorageProvider()
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
