import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'

import { applyConfigUpdate, getConfig, readConfig } from '@/lib/config'
import { lockSettings } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'
import { queueStorageDeletion } from '@/lib/storage/deletion'
import { isMissingObject } from '@/lib/storage/missing'
import { captureStorageTarget } from '@/lib/storage/targets'

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

/** Cleanup jobs for the favicon belong to the instance, not an account. */
const OWNER = 'instance'

/**
 * Both places a saved address may name: its own object, and the shared one
 * of earlier versions.
 */
function possibleObjects(saved: string) {
  const version = faviconVersion(saved)
  return version ? [uploadKey(version), LEGACY_KEY] : [LEGACY_KEY]
}

/**
 * The objects to delete once `saved` is replaced. An address saved by an
 * earlier version names the shared object instead of its own; when storage
 * can't say which, both are queued, since deleting a missing object succeeds.
 */
async function objectsOf(
  storage: Awaited<ReturnType<typeof getStorageProvider>>,
  saved: string | null
): Promise<string[]> {
  if (!saved) return []
  const [own] = possibleObjects(saved)
  if (own === LEGACY_KEY) return [LEGACY_KEY]
  try {
    await storage.getFileSize(own)
    return [own]
  } catch (error) {
    return isMissingObject(error) ? [LEGACY_KEY] : possibleObjects(saved)
  }
}

/**
 * Saves `next` as the favicon address and queues the replaced image for
 * deletion in the same transaction. The settings lock orders concurrent
 * uploads and removals, so each replaced address is queued exactly once, and
 * the storage cleanup worker retries the deletion until storage accepts it.
 * Storage is read before the transaction, never while it holds the lock.
 */
async function replaceSavedFavicon(next: string | null) {
  const storage = await getStorageProvider()
  const target = captureStorageTarget(storage)
  const expected = (await getConfig()).settings.appearance.favicon
  const expectedObjects = await objectsOf(storage, expected)
  await prisma.$transaction(async (tx) => {
    await lockSettings(tx)
    const previous = (await readConfig(tx)).settings.appearance.favicon
    await applyConfigUpdate(tx, { settings: { appearance: { favicon: next } } })
    if (!previous) return
    // Changed since the check: queue every place it may name. Neither holds
    // the favicon saved now.
    const keys =
      previous === expected ? expectedObjects : possibleObjects(previous)
    for (const key of keys) await queueStorageDeletion(tx, OWNER, key, target)
  })
}

/** Returns the address pages now link to. */
export async function saveFavicon(png: Buffer): Promise<string> {
  const version = randomBytes(8).toString('hex')
  const key = uploadKey(version)
  const url = faviconAddress(version)
  await (await getStorageProvider()).uploadFile(png, key, FAVICON_TYPE)
  try {
    await replaceSavedFavicon(url)
  } catch (error) {
    // Never saved, so nothing links to it.
    await (await getStorageProvider()).deleteFile(key).catch((cleanup) => {
      if (!isMissingObject(cleanup))
        loggers.files.warn('Could not delete an unsaved favicon', {
          key,
          error: cleanup,
        })
    })
    throw error
  }
  return url
}

/**
 * Stops linking the favicon, so pages fall back to Flare's own icon, and
 * queues its image for deletion. Removing a favicon that isn't there is no
 * error.
 */
export async function removeFavicon(): Promise<void> {
  await replaceSavedFavicon(null)
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
