import { join } from 'path'

import { prisma } from '@/lib/database/prisma'

export async function getUniqueFilename(
  basePath: string,
  originalName: string
): Promise<{ urlSafeName: string; displayName: string }> {
  const displayName = originalName
  const extension = originalName.includes('.')
    ? originalName.split('.').pop()
    : ''
  const baseNameWithoutExt = originalName.includes('.')
    ? originalName.slice(0, originalName.lastIndexOf('.'))
    : originalName

  // Convert to URL-safe name
  let urlSafeName = baseNameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (extension) {
    urlSafeName += '.' + extension.toLowerCase()
  }

  let counter = 0
  let finalUrlSafeName = urlSafeName
  let exists = true

  while (exists) {
    exists =
      (await prisma.file.findFirst({
        where: {
          path: join(basePath, finalUrlSafeName),
        },
      })) !== null

    if (!exists) break

    counter++
    finalUrlSafeName = extension
      ? `${baseNameWithoutExt}-${counter}.${extension}`
      : `${baseNameWithoutExt}-${counter}`
  }

  return {
    urlSafeName: finalUrlSafeName,
    displayName,
  }
}
