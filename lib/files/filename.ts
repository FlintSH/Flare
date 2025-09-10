import { nanoid } from 'nanoid'
import { join } from 'path'

import { prisma } from '@/lib/database/prisma'

function validateAndNormalizePath(basePath: string, filename: string): string {
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+/g, '/')
  const normalizedFilename = filename.replace(/\\/g, '/').replace(/\/+/g, '/')

  if (normalizedBase.includes('..') || normalizedFilename.includes('..')) {
    throw new Error('Invalid path: Directory traversal not allowed')
  }

  let cleanBase = normalizedBase
  while (cleanBase.startsWith('/')) {
    cleanBase = cleanBase.slice(1)
  }
  while (cleanBase.endsWith('/')) {
    cleanBase = cleanBase.slice(0, -1)
  }

  let cleanFilename = normalizedFilename
  while (cleanFilename.startsWith('/')) {
    cleanFilename = cleanFilename.slice(1)
  }
  while (cleanFilename.endsWith('/')) {
    cleanFilename = cleanFilename.slice(0, -1)
  }

  const fullPath = join(cleanBase, cleanFilename)
  if (!fullPath.startsWith(cleanBase)) {
    throw new Error('Invalid path: Path traversal detected')
  }

  return fullPath
}

export function generateRandomFileName(originalName: string): string {
  const extension = originalName.includes('.')
    ? originalName.split('.').pop()
    : ''

  const randomId = nanoid(6)

  return extension ? `${randomId}.${extension.toLowerCase()}` : randomId
}

export async function getUniqueFilename(
  basePath: string,
  originalName: string,
  randomize: boolean = false
): Promise<{ urlSafeName: string; displayName: string }> {
  if (!basePath || !originalName) {
    throw new Error('Base path and original name are required')
  }

  const displayName = originalName

  if (randomize) {
    const randomName = generateRandomFileName(originalName)

    let exists = true
    let finalRandomName = randomName
    let attempts = 0

    while (exists && attempts < 5) {
      const normalizedPath = validateAndNormalizePath(basePath, finalRandomName)

      exists =
        (await prisma.file.findFirst({
          where: {
            path: normalizedPath,
          },
        })) !== null

      if (!exists) break

      finalRandomName = generateRandomFileName(originalName)
      attempts++
    }

    return {
      urlSafeName: finalRandomName,
      displayName,
    }
  }

  const extension = originalName.includes('.')
    ? originalName.split('.').pop()
    : ''
  const baseNameWithoutExt = originalName.includes('.')
    ? originalName.slice(0, originalName.lastIndexOf('.'))
    : originalName

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
    const normalizedPath = validateAndNormalizePath(basePath, finalUrlSafeName)

    exists =
      (await prisma.file.findFirst({
        where: {
          path: normalizedPath,
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
