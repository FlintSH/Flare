import { nanoid } from 'nanoid'
import { join } from 'path'

import { prisma } from '@/lib/database/prisma'

// Utility function to validate and normalize file paths
function validateAndNormalizePath(basePath: string, filename: string): string {
  // Remove any directory traversal attempts and normalize the path
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+/g, '/')
  const normalizedFilename = filename.replace(/\\/g, '/').replace(/\/+/g, '/')

  // Ensure the path doesn't contain any directory traversal
  if (normalizedBase.includes('..') || normalizedFilename.includes('..')) {
    throw new Error('Invalid path: Directory traversal not allowed')
  }

  // Remove any leading/trailing slashes
  const cleanBase = normalizedBase.replace(/^\/+|\/+$/g, '')
  const cleanFilename = normalizedFilename.replace(/^\/+|\/+$/g, '')

  // Join the paths and ensure the result is within the intended directory
  const fullPath = join(cleanBase, cleanFilename)
  if (!fullPath.startsWith(cleanBase)) {
    throw new Error('Invalid path: Path traversal detected')
  }

  return fullPath
}

// Generate a random file name with 6 characters
export function generateRandomFileName(originalName: string): string {
  const extension = originalName.includes('.')
    ? originalName.split('.').pop()
    : ''

  // Generate a random ID
  const randomId = nanoid()

  return extension ? `${randomId}.${extension.toLowerCase()}` : randomId
}

export async function getUniqueFilename(
  basePath: string,
  originalName: string,
  randomize: boolean = false
): Promise<{ urlSafeName: string; displayName: string }> {
  // Validate inputs
  if (!basePath || !originalName) {
    throw new Error('Base path and original name are required')
  }

  const displayName = originalName

  // If randomization is enabled, generate a random name instead
  if (randomize) {
    const randomName = generateRandomFileName(originalName)

    // Check if the random name already exists
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

      // Generate a new random name if conflict exists
      finalRandomName = generateRandomFileName(originalName)
      attempts++
    }

    return {
      urlSafeName: finalRandomName,
      displayName,
    }
  }

  // Original non-randomized logic
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
    // Validate and normalize the path before checking existence
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
