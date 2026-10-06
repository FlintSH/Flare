import { type Prisma } from '@prisma/client'
import { fileTypeFromBuffer } from 'file-type'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { z } from 'zod'

import { recordAudit, setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { folderNameSchema } from '@/lib/folders/schema'
import { validateOwnedFolderId } from '@/lib/folders/service'
import { loggers } from '@/lib/logger'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import {
  lockRoleChanges,
  requireActorPermission,
} from '@/lib/permissions/server'
import { type StorageProvider, getStorageProvider } from '@/lib/storage'
import { queueStorageDeletion } from '@/lib/storage/deletion'
import { getStorageProviderForTarget } from '@/lib/storage/target-provider'
import { captureStorageTarget, parseStorageTarget } from '@/lib/storage/targets'
import {
  accountUploadOptions,
  effectiveUploadRevision,
} from '@/lib/uploads/effective-settings'
import {
  enqueueUploadProcessing,
  prepareUpload,
  prepareUploadDestination,
  publishPreparedUpload,
} from '@/lib/uploads/finalize'
import { UploadError, resolveUploadOptions } from '@/lib/uploads/options'
import {
  type ResolvedUploadOptions,
  mergeUploadOptions,
  uploadProfileOptionsSchema,
} from '@/lib/uploads/schema'

import { createArchive, readArchive } from './codec'
import { ArchiveError } from './errors'
import type {
  ArchiveActor,
  createArchiveSchema,
  extractArchiveSchema,
} from './http'
import type { ArchiveOperation } from './operation'
import {
  ARCHIVE_LIMITS,
  type ArchiveManifest,
  getArchiveFormat,
} from './shared'
import { type SharedArchiveAccess, recheckSharedArchive } from './sharing'

const sourceSelect = {
  id: true,
  userId: true,
  name: true,
  path: true,
  mimeType: true,
  storageTarget: true,
} satisfies Prisma.FileSelect
type SourceFile = Prisma.FileGetPayload<{ select: typeof sourceSelect }>
type Prepared = Awaited<ReturnType<typeof prepareUpload>>

async function ownedFiles(actor: ArchiveActor, ids: string[]) {
  const files = await prisma.file.findMany({
    where: { id: { in: ids }, userId: actor.user.id },
    select: sourceSelect,
  })
  if (files.length !== ids.length) {
    setAuditOutcome('denied')
    throw new ArchiveError(
      'One or more source files are unavailable.',
      404,
      true
    )
  }
  return ids.map((id) => files.find((file) => file.id === id)!)
}

async function sourceStorage(file: SourceFile) {
  const target = parseStorageTarget(file.storageTarget)
  if (file.storageTarget !== null && !target)
    throw new ArchiveError(
      'The file has invalid storage provenance. Ask the operator to reconcile it.',
      409
    )
  // Historical files use the active provider, matching existing file downloads.
  // A recorded target never silently falls back to a different backend.
  return target ? getStorageProviderForTarget(target) : getStorageProvider()
}

/** Keep source read evidence separate from the output archive being created. */
async function stageArchiveSource(
  file: SourceFile,
  operation: ArchiveOperation,
  maxBytes: number
) {
  const event = {
    action: 'archive.source.read',
    category: 'archives',
    targetType: 'file',
    targetId: file.id,
    targetName: file.name,
  }
  try {
    const source = await operation.stage(
      await sourceStorage(file),
      file.path,
      maxBytes
    )
    await recordAudit({ ...event, details: { size: source.size } })
    return source
  } catch (error) {
    await recordAudit({
      ...event,
      outcome: 'failure',
      details: { reason: 'Archive source could not be read' },
    })
    throw error
  }
}

async function inspect(
  actor: ArchiveActor,
  id: string,
  operation: ArchiveOperation,
  extract: boolean
) {
  const [file] = await ownedFiles(actor, [id])
  setAuditTarget({ type: 'file', id: file.id, name: file.name })
  return { file, manifest: await inspectSource(file, operation, extract) }
}

async function inspectSource(
  file: SourceFile,
  operation: ArchiveOperation,
  extract: boolean
) {
  const format = getArchiveFormat(file.name, file.mimeType)
  if (!format)
    throw new ArchiveError('This archive format is not supported.', 415)
  const source = await stageArchiveSource(
    file,
    operation,
    ARCHIVE_LIMITS.archiveBytes
  )
  const codecName = getArchiveFormat(file.name)
    ? file.name
    : `${file.name}.${format === 'gzip' ? 'gz' : format}`
  return readArchive(source.diskPath, codecName, {
    signal: operation.signal,
    ...(extract ? { directory: operation.directory } : {}),
  })
}

function publicManifest(manifest: ArchiveManifest) {
  return {
    ...manifest,
    entries: manifest.entries.map(({ path, type, size }) => ({
      path,
      type,
      size,
    })),
  }
}

export async function listArchive(
  actor: ArchiveActor,
  id: string,
  operation: ArchiveOperation
) {
  const { file, manifest } = await inspect(actor, id, operation, false)
  await recheckRead(actor, file, operation)
  return publicManifest(manifest)
}

export async function downloadArchiveEntry(
  actor: ArchiveActor,
  id: string,
  path: string,
  operation: ArchiveOperation
) {
  if (!path || path.length > ARCHIVE_LIMITS.pathLength)
    throw new ArchiveError('Choose a valid archive entry.', 400)
  const { file, manifest } = await inspect(actor, id, operation, true)
  return entryDownload(
    manifest,
    path,
    operation,
    () => recheckRead(actor, file, operation),
    file
  )
}

export async function listSharedArchive(
  access: SharedArchiveAccess,
  operation: ArchiveOperation
) {
  const manifest = await inspectSource(access.file, operation, false)
  await recheckSharedArchive(access, operation)
  return publicManifest(manifest)
}

export async function downloadSharedArchiveEntry(
  access: SharedArchiveAccess,
  path: string,
  operation: ArchiveOperation
) {
  const manifest = await inspectSource(access.file, operation, true)
  return entryDownload(
    manifest,
    path,
    operation,
    () => recheckSharedArchive(access, operation),
    access.file
  )
}

async function entryDownload(
  manifest: ArchiveManifest,
  path: string,
  operation: ArchiveOperation,
  recheck: () => Promise<void>,
  source: SourceFile
) {
  const entry = manifest.entries.find(
    (entry) => entry.path === path && entry.type === 'file'
  )
  if (!entry?.diskPath) throw new ArchiveError('Archive entry not found.', 404)
  const detected = await sniffType(entry.diskPath)
  const mimeType = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
  ].includes(detected)
    ? detected
    : 'application/octet-stream'
  await recheck()
  const response = operation.download(
    entry.diskPath,
    basename(entry.path),
    entry.size,
    mimeType
  )
  await recordAudit({
    action: 'archive.member.read',
    category: 'archives',
    targetType: 'file',
    targetId: source.id,
    targetName: source.name,
    details: { name: entry.path, size: entry.size },
  })
  return response
}

async function lockPublication(
  tx: Prisma.TransactionClient,
  actor: ArchiveActor,
  sources: SourceFile[],
  permissions: Permission[],
  options: ResolvedUploadOptions
) {
  await lockRoleChanges(tx)
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.user.id} FOR UPDATE`
  const access = await requireActorPermission(tx, actor.user.id, permissions[0])
  if (permissions.some((permission) => !hasPermission(access, permission)))
    throw new ArchiveError(
      'Your role no longer allows this archive operation.',
      403
    )
  const user = await tx.user.findUnique({
    where: { id: actor.user.id },
    select: {
      sessionVersion: true,
      randomizeFileUrls: true,
      defaultFileExpiration: true,
      defaultFileExpirationAction: true,
    },
  })
  if (!user || user.sessionVersion !== actor.sessionVersion)
    throw new ArchiveError('Sign in again before creating files.', 401)
  if (options.profileId) {
    const profile = await tx.uploadProfile.findFirst({
      where: { id: options.profileId, userId: actor.user.id },
      select: { updatedAt: true, options: true },
    })
    if (!profile || profile.updatedAt.toISOString() !== options.profileRevision)
      throw new ArchiveError(
        'The selected upload profile changed or was removed. Refresh and try again.',
        409
      )
    const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
    const config = configSchema.parse(row?.value ?? DEFAULT_CONFIG)
    const revision = effectiveUploadRevision(
      actor.user.id,
      options.profileId,
      accountUploadOptions(user, config),
      uploadProfileOptionsSchema.parse(profile.options),
      hasPermission(access, 'files.share')
    )
    if (revision !== options.profileEffectiveRevision)
      throw new ArchiveError(
        'The selected profile’s effective settings changed. Review the refreshed settings and try again.',
        409
      )
  }
  const current = await tx.file.findMany({
    where: {
      userId: actor.user.id,
      id: { in: sources.map((file) => file.id) },
    },
    select: sourceSelect,
  })
  if (
    current.length !== sources.length ||
    sources.some(
      (file) =>
        !current.some(
          (fresh) =>
            fresh.id === file.id &&
            fresh.path === file.path &&
            JSON.stringify(fresh.storageTarget) ===
              JSON.stringify(file.storageTarget)
        )
    )
  )
    throw new ArchiveError(
      'A source file changed or was removed. Refresh and try again.',
      409
    )
}

function privateOptions(folderId: string | null = null) {
  return mergeUploadOptions(
    {},
    {},
    {
      profileId: null,
      folderId,
      visibility: 'PRIVATE',
      password: null,
      expiration: 'DISABLED',
      expiresAt: null,
      tagIds: [],
    }
  )
}

async function recheckRead(
  actor: ArchiveActor,
  file: SourceFile,
  operation: ArchiveOperation
) {
  operation.signal.throwIfAborted()
  await prisma.$transaction(
    async (tx) => {
      await lockPublication(tx, actor, [file], ['files.read'], privateOptions())
      operation.signal.throwIfAborted()
    },
    {
      timeout: operation.transactionTimeout(),
      maxWait: Math.min(10_000, operation.transactionTimeout()),
    }
  )
}

/** Early resource check; locked finalization still enforces current limits atomically. */
async function preflightCapacity(actor: ArchiveActor, sizes: number[]) {
  const [row, user] = await Promise.all([
    prisma.config.findUnique({ where: { key: 'flare_config' } }),
    prisma.user.findUnique({
      where: { id: actor.user.id },
      select: { storageUsed: true },
    }),
  ])
  if (!user) throw new ArchiveError('Account no longer exists.', 401)
  const storage = configSchema.parse(row?.value ?? DEFAULT_CONFIG).settings
    .general.storage
  const max =
    storage.maxUploadSize.value *
    (storage.maxUploadSize.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
  if (sizes.some((size) => size > max))
    throw new ArchiveError(
      'An output file exceeds the current upload size limit.',
      413
    )
  const quota =
    storage.quotas.default.value *
    (storage.quotas.default.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
  if (
    storage.quotas.enabled &&
    !hasPermission(actor.user, 'quotas.bypass') &&
    user.storageUsed * 1024 ** 2 + sizes.reduce((sum, size) => sum + size, 0) >
      quota
  )
    throw new ArchiveError(
      'The output files would exceed your storage quota.',
      413
    )
}

async function archiveOptions(
  actor: ArchiveActor,
  input: {
    folderId: string | null
    profileId?: string | null
    profileRevision?: string
    profileEffectiveRevision?: string
  }
) {
  let options: ResolvedUploadOptions
  try {
    options = input.profileId
      ? await resolveUploadOptions(actor.user, {
          profileId: input.profileId,
          folderId: input.folderId,
        })
      : privateOptions(input.folderId)
  } catch (error) {
    if (
      (input.profileRevision || input.profileEffectiveRevision) &&
      error instanceof UploadError &&
      error.status === 404 &&
      error.message === 'Upload profile not found.'
    )
      throw new ArchiveError(
        'The selected upload profile changed or was removed. Refresh and try again.',
        409
      )
    throw error
  }
  if (
    input.profileRevision &&
    options.profileRevision !== new Date(input.profileRevision).toISOString()
  )
    throw new ArchiveError(
      'The selected upload profile changed or was removed. Refresh and try again.',
      409
    )
  if (
    input.profileEffectiveRevision &&
    options.profileEffectiveRevision !== input.profileEffectiveRevision
  )
    throw new ArchiveError(
      'The selected profile’s effective settings changed. Review the refreshed settings and try again.',
      409
    )
  return options
}

async function sniffType(diskPath: string, name = '') {
  const file = await open(diskPath, 'r')
  try {
    const buffer = Buffer.alloc(4100)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const detected = await fileTypeFromBuffer(buffer.subarray(0, bytesRead))
    if (detected) return detected.mime
    const textTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.markdown': 'text/markdown',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.ts': 'text/plain',
      '.tsx': 'text/plain',
      '.jsx': 'text/plain',
      '.py': 'text/plain',
      '.sh': 'text/plain',
      '.yml': 'text/plain',
      '.yaml': 'text/plain',
      '.toml': 'text/plain',
      '.ini': 'text/plain',
      '.log': 'text/plain',
      '.sql': 'text/plain',
      '.c': 'text/plain',
      '.cpp': 'text/plain',
      '.h': 'text/plain',
      '.rs': 'text/plain',
      '.go': 'text/plain',
    }
    return textTypes[extname(name).toLowerCase()] ?? 'application/octet-stream'
  } finally {
    await file.close()
  }
}

async function stageOutput(
  actor: ArchiveActor,
  storage: StorageProvider,
  diskPath: string,
  name: string,
  expectedSize: number,
  operation: ArchiveOperation,
  written: string[],
  options: ResolvedUploadOptions,
  mimeType?: string
) {
  operation.signal.throwIfAborted()
  let destination
  try {
    destination = await prepareUploadDestination(actor.user, name, options)
  } catch (error) {
    if (
      !(error instanceof UploadError) ||
      error.message !== 'Invalid filename.'
    )
      throw error
    destination = await prepareUploadDestination(actor.user, name, {
      ...options,
      randomizeFileUrls: true,
    })
  }
  const type = mimeType ?? (await sniffType(diskPath, name))
  written.push(destination.filePath)
  const { size } = await storage.uploadStream(
    createReadStream(diskPath, { signal: operation.signal }),
    destination.filePath,
    type,
    operation.signal
  )
  if (size !== expectedSize)
    throw new ArchiveError(
      'The generated file size changed during upload.',
      409
    )
  return prepareUpload({
    user: actor.user,
    storage,
    ...destination,
    mimeType: type,
    size,
    options,
    passwordHash: null,
    signal: operation.signal,
  })
}

async function cleanupWritten(
  actor: ArchiveActor,
  storage: StorageProvider,
  paths: string[]
) {
  if (!paths.length) return
  try {
    await prisma.$transaction(
      async (tx) => {
        const committed = new Set(
          (
            await tx.file.findMany({
              where: { path: { in: paths } },
              select: { path: true },
            })
          ).map((file) => file.path)
        )
        for (const path of paths)
          if (!committed.has(path))
            await queueStorageDeletion(
              tx,
              actor.user.id,
              path,
              captureStorageTarget(storage)
            )
      },
      { timeout: 60_000 }
    )
  } catch (error) {
    loggers.files.error(
      'Could not queue uncommitted archive objects for cleanup',
      error as Error,
      { paths }
    )
  }
}

function plannedDirectories(manifest: ArchiveManifest) {
  const directories = new Map<string, { name: string; parentPath: string }>()
  for (const entry of manifest.entries) {
    const parts = entry.path.split('/')
    const count = entry.type === 'directory' ? parts.length : parts.length - 1
    for (let index = 0; index < count; index++) {
      const path = parts.slice(0, index + 1).join('/')
      const name = folderNameSchema.parse(parts[index])
      if (name !== parts[index])
        throw new ArchiveError(
          'Archive folder names cannot be represented without changing their paths.',
          400
        )
      directories.set(path, {
        name,
        parentPath: parts.slice(0, index).join('/'),
      })
    }
  }
  return [...directories.entries()].sort(
    ([left], [right]) =>
      left.split('/').length - right.split('/').length ||
      left.localeCompare(right)
  )
}

export async function extractArchive(
  actor: ArchiveActor,
  id: string,
  input: z.infer<typeof extractArchiveSchema>,
  operation: ArchiveOperation
) {
  await validateOwnedFolderId(actor.user.id, input.folderId)
  const options = await archiveOptions(actor, input)
  const { file: source, manifest } = await inspect(actor, id, operation, true)
  const directories = plannedDirectories(manifest)
  await preflightCapacity(
    actor,
    manifest.entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.size)
  )
  const storage = await getStorageProvider()
  const written: string[] = []
  const prepared = new Map<string, Prepared>()
  try {
    for (const entry of manifest.entries)
      if (entry.type === 'file') {
        if (!entry.diskPath)
          throw new ArchiveError('Archive entry was not staged.', 500)
        prepared.set(
          entry.path,
          await stageOutput(
            actor,
            storage,
            entry.diskPath,
            basename(entry.path),
            entry.size,
            operation,
            written,
            options
          )
        )
      }
    operation.signal.throwIfAborted()
    const result = await prisma.$transaction(
      async (tx) => {
        await lockPublication(
          tx,
          actor,
          [source],
          ['files.read', 'files.upload', 'folders.manage'],
          options
        )
        await validateOwnedFolderId(actor.user.id, input.folderId, tx)
        const wrapper = await tx.vaultFolder.create({
          data: {
            userId: actor.user.id,
            name: input.name,
            normalizedName: input.name.toLowerCase(),
            parentId: input.folderId,
          },
        })
        const folderIds = new Map([['', wrapper.id]])
        for (const [path, directory] of directories) {
          operation.signal.throwIfAborted()
          const folder = await tx.vaultFolder.create({
            data: {
              userId: actor.user.id,
              name: directory.name,
              normalizedName: directory.name.toLowerCase(),
              parentId: folderIds.get(directory.parentPath)!,
            },
          })
          folderIds.set(path, folder.id)
        }
        const files = []
        for (const [path, upload] of prepared) {
          operation.signal.throwIfAborted()
          const parentPath = path.split('/').slice(0, -1).join('/')
          const file = await publishPreparedUpload({
            ...upload,
            options: {
              ...upload.options,
              folderId: folderIds.get(parentPath)!,
            },
            transaction: tx,
          })
          files.push(file)
          await recordAudit({
            action: 'archive.member.extract',
            category: 'archives',
            targetType: 'file',
            targetId: file.id,
            targetName: file.name,
            details: { fileId: source.id, name: path, folderId: file.folderId },
          })
        }
        operation.signal.throwIfAborted()
        return { wrapper, files }
      },
      {
        timeout: operation.transactionTimeout(),
        maxWait: Math.min(10_000, operation.transactionTimeout()),
      }
    )
    for (const file of result.files) enqueueUploadProcessing(file)
    return {
      folderId: result.wrapper.id,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
    }
  } catch (error) {
    await cleanupWritten(actor, storage, written)
    throw error
  } finally {
    setAuditTarget({ type: 'file', id: source.id, name: source.name })
  }
}

function memberNames(files: SourceFile[]) {
  const used = new Set<string>()
  return files.map((file) => {
    let name = basename(file.name.normalize('NFKC').replace(/\\/g, '/'))
      .replace(/[\p{Cc}\p{Cf}\uFFFD]/gu, '')
      .replace(/:/g, '-')
      .trim()
    if (!name || name === '.' || name === '..') name = 'file'
    name = Array.from(name).slice(0, 180).join('')
    while (name.length > 180) name = Array.from(name).slice(0, -1).join('')
    const extension = extname(name)
    const stem = name.slice(0, name.length - extension.length)
    let candidate = name
    for (let index = 2; used.has(candidate.toLowerCase()); index++)
      candidate = `${stem} (${index})${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export async function createAccountArchive(
  actor: ArchiveActor,
  input: z.infer<typeof createArchiveSchema>,
  operation: ArchiveOperation
) {
  const suffix = input.format === 'zip' ? '.zip' : '.tar.gz'
  const name = input.name.toLowerCase().endsWith(suffix)
    ? input.name
    : input.name + suffix
  setAuditTarget({ type: 'file', name })
  if (input.folderId && !hasPermission(actor.user, 'folders.manage'))
    throw new ArchiveError('Your role cannot save archives into folders.', 403)
  await validateOwnedFolderId(actor.user.id, input.folderId)
  const options = await archiveOptions(actor, input)
  const sources = await ownedFiles(actor, input.fileIds)
  const names = memberNames(sources)
  const entries = []
  let totalBytes = 0
  for (const [index, file] of sources.entries()) {
    const staged = await stageArchiveSource(
      file,
      operation,
      Math.min(
        ARCHIVE_LIMITS.fileBytes,
        ARCHIVE_LIMITS.expandedBytes - totalBytes
      )
    )
    totalBytes += staged.size
    entries.push({
      path: names[index],
      localPath: staged.diskPath,
      size: staged.size,
    })
  }
  const outputPath = operation.path()
  await createArchive(outputPath, input.format, entries, operation.signal)
  const outputSize = (await stat(outputPath)).size
  await preflightCapacity(actor, [outputSize])
  const storage = await getStorageProvider()
  const written: string[] = []
  try {
    const prepared = await stageOutput(
      actor,
      storage,
      outputPath,
      name,
      outputSize,
      operation,
      written,
      options,
      input.format === 'zip' ? 'application/zip' : 'application/gzip'
    )
    operation.signal.throwIfAborted()
    const file = await prisma.$transaction(
      async (tx) => {
        await lockPublication(
          tx,
          actor,
          sources,
          [
            'files.read',
            'files.upload',
            ...(input.folderId ? ['folders.manage' as const] : []),
          ],
          options
        )
        operation.signal.throwIfAborted()
        const result = await publishPreparedUpload({
          ...prepared,
          options: { ...prepared.options, folderId: input.folderId },
          transaction: tx,
        })
        operation.signal.throwIfAborted()
        return result
      },
      {
        timeout: operation.transactionTimeout(),
        maxWait: Math.min(10_000, operation.transactionTimeout()),
      }
    )
    enqueueUploadProcessing(file)
    setAuditTarget({ type: 'file', id: file.id, name: file.name })
    return {
      file: {
        id: file.id,
        name: file.name,
        urlPath: file.urlPath,
        folderId: file.folderId,
      },
      totalBytes: outputSize,
    }
  } catch (error) {
    await cleanupWritten(actor, storage, written)
    throw error
  }
}
