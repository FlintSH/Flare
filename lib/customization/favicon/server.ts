import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'

import { applyConfigUpdate, getConfig, readConfig } from '@/lib/config'
import { lockSettings } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'
import { isMissingObject } from '@/lib/storage/missing'

import {
  FAVICON_MAX_BYTES,
  FAVICON_TYPE,
  faviconAddress,
  faviconUrl,
  faviconVersion,
} from './index'

/** Where earlier versions kept every favicon, replacing it in place. */
const LEGACY_KEY = 'uploads/favicon.png'

/**
 * Each upload gets its own object, never written again, so a slow write or
 * delete for one upload can't change the image of another.
 */
function uploadKey(version: string) {
  return `uploads/favicons/${version}.png`
}

function contentVersion(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

/**
 * Saves `next` as the favicon address and returns the one it replaced. The
 * settings lock orders concurrent uploads and removals, so each replaced
 * address is returned to exactly one of them.
 */
async function replaceSavedFavicon(next: string | null) {
  return prisma.$transaction(async (tx) => {
    await lockSettings(tx)
    const previous = (await readConfig(tx)).settings.appearance.favicon
    await applyConfigUpdate(tx, { settings: { appearance: { favicon: next } } })
    return previous
  })
}

async function deleteQuietly(key: string) {
  try {
    await (await getStorageProvider()).deleteFile(key)
  } catch (error) {
    if (!isMissingObject(error))
      loggers.files.warn('Could not delete an unused favicon', { key, error })
  }
}

/** Deletes the image of a favicon address that is no longer saved. */
async function deleteReplaced(previous: string | null) {
  const version = faviconVersion(previous)
  // The shared object of earlier versions is unused once anything replaces it.
  await deleteQuietly(LEGACY_KEY)
  if (version) await deleteQuietly(uploadKey(version))
}

/** Returns the address pages now link to. */
export async function saveFavicon(png: Buffer): Promise<string> {
  const version = randomBytes(8).toString('hex')
  const key = uploadKey(version)
  const url = faviconAddress(version)
  await (await getStorageProvider()).uploadFile(png, key, FAVICON_TYPE)
  let previous: string | null
  try {
    previous = await replaceSavedFavicon(url)
  } catch (error) {
    await deleteQuietly(key)
    throw error
  }
  await deleteReplaced(previous)
  return url
}

/**
 * Stops linking the favicon, so pages fall back to Flare's own icon, then
 * deletes its image. Removing a favicon that isn't there is no error.
 */
export async function removeFavicon(): Promise<void> {
  await deleteReplaced(await replaceSavedFavicon(null))
}

async function readIcon(key: string): Promise<Buffer | Readable | null> {
  const storage = await getStorageProvider()
  try {
    // Earlier versions accepted any size; stream those instead of buffering.
    return (await storage.getFileSize(key)) > FAVICON_MAX_BYTES
      ? await storage.getFileStream(key)
      : await buffer(await storage.getFileStream(key))
  } catch (error) {
    if (isMissingObject(error)) return null
    throw error
  }
}

function iconResponse(icon: Buffer | Readable, current: boolean) {
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

/**
 * A response may be cached for a year only when the requested version names
 * the image it sends, so neither an address saved by an earlier version nor
 * a request racing an upload can keep an old icon cached. Flare sends the
 * bytes itself, whatever the storage, so the icon gets this caching and loads
 * even where the storage address isn't reachable.
 */
export async function faviconResponse(request: Request): Promise<Response> {
  const saved = (await getConfig()).settings.appearance.favicon
  if (!faviconUrl(saved)) return new Response(null, { status: 404 })
  const requested = new URL(request.url).searchParams.get('v')
  const version = faviconVersion(saved)
  const uploaded = version ? await readIcon(uploadKey(version)) : null
  if (uploaded) return iconResponse(uploaded, requested === version)
  // Saved by an earlier version: its address carries a hash of the shared
  // object's content, if anything.
  const legacy = await readIcon(LEGACY_KEY)
  if (!legacy) return new Response(null, { status: 404 })
  return iconResponse(
    legacy,
    Buffer.isBuffer(legacy) && requested === contentVersion(legacy)
  )
}
