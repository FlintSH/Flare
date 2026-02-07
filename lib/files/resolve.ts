import { prisma } from '@/lib/database/prisma'

/**
 * Resolves the canonical urlPath for a file, supporting both urlId and vanityId lookups.
 *
 * Resolution order:
 * 1. Direct urlPath lookup: /{userUrlId}/{filename}
 * 2. Space-to-dash fallback: /{userUrlId}/{filename-with-dashes}
 * 3. VanityId lookup: find user by vanityId, then lookup /{user.urlId}/{filename}
 * 4. VanityId + space-to-dash fallback
 *
 * Returns the resolved urlPath if a file exists, or null if not found.
 */
export async function resolveFileUrlPath(
  userUrlId: string,
  filename: string
): Promise<string | null> {
  // 1. Direct urlPath lookup
  const urlPath = `/${userUrlId}/${filename}`
  const directFile = await prisma.file.findUnique({
    where: { urlPath },
    select: { urlPath: true },
  })

  if (directFile) {
    return directFile.urlPath
  }

  // 2. Space-to-dash fallback
  if (filename.includes(' ')) {
    const urlSafeFilename = filename.replace(/ /g, '-')
    const urlSafePath = `/${userUrlId}/${urlSafeFilename}`
    const spaceFallback = await prisma.file.findUnique({
      where: { urlPath: urlSafePath },
      select: { urlPath: true },
    })

    if (spaceFallback) {
      return spaceFallback.urlPath
    }
  }

  // 3. VanityId lookup
  const user = await prisma.user.findUnique({
    where: { vanityId: userUrlId },
    select: { urlId: true },
  })

  if (!user) {
    return null
  }

  const vanityUrlPath = `/${user.urlId}/${filename}`
  const vanityFile = await prisma.file.findUnique({
    where: { urlPath: vanityUrlPath },
    select: { urlPath: true },
  })

  if (vanityFile) {
    return vanityFile.urlPath
  }

  // 4. VanityId + space-to-dash fallback
  if (filename.includes(' ')) {
    const urlSafeFilename = filename.replace(/ /g, '-')
    const vanityUrlSafePath = `/${user.urlId}/${urlSafeFilename}`
    const vanitySpaceFallback = await prisma.file.findUnique({
      where: { urlPath: vanityUrlSafePath },
      select: { urlPath: true },
    })

    if (vanitySpaceFallback) {
      return vanitySpaceFallback.urlPath
    }
  }

  return null
}
