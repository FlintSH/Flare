import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import {
  MAX_SAVED_VIEWS,
  storedSavedViewSchema,
} from '@/lib/saved-views/schema'
import type {
  SavedView,
  SavedViewFilters,
  SavedViewInput,
  SavedViewUpdate,
  StoredSavedView,
} from '@/lib/saved-views/schema'

export class SavedViewError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: 'SAVED_VIEW_STALE'
  ) {
    super(message)
    this.name = 'SavedViewError'
  }
}

function preferencesObject(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {}
}

function readViews(preferences: unknown): StoredSavedView[] {
  const value = preferencesObject(preferences).savedViews
  if (value === undefined) return []
  const parsed = z
    .array(storedSavedViewSchema)
    .max(MAX_SAVED_VIEWS)
    .safeParse(value)
  // Never silently discard or overwrite a malformed stored view on a later edit.
  if (!parsed.success)
    throw new SavedViewError(
      'Saved views could not be read. Please contact your administrator.',
      500
    )
  return parsed.data
}

async function withAvailability(
  userId: string,
  views: StoredSavedView[],
  database: Prisma.TransactionClient = prisma
): Promise<SavedView[]> {
  const folderIds = [
    ...new Set(
      views
        .map((view) => view.filters.folder)
        .filter((id): id is string => Boolean(id) && id !== 'unfiled')
    ),
  ]
  const tagIds = [
    ...new Set(
      views
        .map((view) => view.filters.tag)
        .filter((id): id is string => Boolean(id) && id !== 'untagged')
    ),
  ]
  const [folders, tags] = await Promise.all([
    folderIds.length
      ? database.vaultFolder.findMany({
          where: { userId, id: { in: folderIds } },
          select: { id: true },
        })
      : [],
    tagIds.length
      ? database.vaultTag.findMany({
          where: { userId, id: { in: tagIds } },
          select: { id: true },
        })
      : [],
  ])
  const availableFolders = new Set(folders.map((folder) => folder.id))
  const availableTags = new Set(tags.map((tag) => tag.id))
  return views.map((view) => {
    const missingFolder =
      view.filters.folder &&
      view.filters.folder !== 'unfiled' &&
      !availableFolders.has(view.filters.folder)
    const missingTag =
      view.filters.tag &&
      view.filters.tag !== 'untagged' &&
      !availableTags.has(view.filters.tag)
    return {
      ...view,
      unavailableReason:
        missingFolder && missingTag
          ? 'The saved folder and tag are no longer available. Choose new filters and update this view.'
          : missingFolder
            ? 'The saved folder is no longer available. Choose new filters and update this view.'
            : missingTag
              ? 'The saved tag is no longer available. Choose new filters and update this view.'
              : null,
    }
  })
}

async function validateReferences(
  userId: string,
  filters: SavedViewFilters,
  transaction: Prisma.TransactionClient
) {
  if (filters.folder && filters.folder !== 'unfiled') {
    const folder = await transaction.vaultFolder.findFirst({
      where: { id: filters.folder, userId },
      select: { id: true },
    })
    if (!folder)
      throw new SavedViewError(
        'The selected folder is no longer available.',
        404
      )
  }
  if (filters.tag && filters.tag !== 'untagged') {
    const tag = await transaction.vaultTag.findFirst({
      where: { id: filters.tag, userId },
      select: { id: true },
    })
    if (!tag)
      throw new SavedViewError('The selected tag is no longer available.', 404)
  }
}

function validateName(
  views: StoredSavedView[],
  name: string,
  exceptId?: string
) {
  if (
    views.some(
      (view) =>
        view.id !== exceptId && view.name.toLowerCase() === name.toLowerCase()
    )
  )
    throw new SavedViewError(
      'You already have a saved view with that name.',
      409
    )
}

function findView(
  views: StoredSavedView[],
  id: string,
  revision: number
): StoredSavedView {
  const view = views.find((view) => view.id === id)
  if (!view) throw new SavedViewError('Saved view not found.', 404)
  if (view.revision !== revision)
    throw new SavedViewError(
      'This saved view changed in another tab or device. Refresh saved views and try again.',
      409,
      'SAVED_VIEW_STALE'
    )
  return view
}

async function mutateViews<T>(
  userId: string,
  change: (views: StoredSavedView[], tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Appearance preferences and folder/tag deletion use the same owner lock.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferences: true },
    })
    const views = readViews(user.preferences)
    const result = await change(views, tx)
    await tx.user.update({
      where: { id: userId },
      data: {
        preferences: {
          ...preferencesObject(user.preferences),
          savedViews: views,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    return result
  })
}

export async function listSavedViews(userId: string): Promise<SavedView[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { preferences: true },
  })
  return withAvailability(userId, readViews(user.preferences))
}

export async function createSavedView(
  userId: string,
  input: SavedViewInput
): Promise<SavedView> {
  return mutateViews(userId, async (views, tx) => {
    if (views.length >= MAX_SAVED_VIEWS)
      throw new SavedViewError(
        'You can save up to 20 views. Delete a view before adding another.',
        409
      )
    validateName(views, input.name)
    await validateReferences(userId, input.filters, tx)
    const view: StoredSavedView = { id: randomUUID(), ...input, revision: 1 }
    views.push(view)
    return { ...view, unavailableReason: null }
  })
}

export async function updateSavedView(
  userId: string,
  id: string,
  input: SavedViewUpdate
): Promise<SavedView> {
  return mutateViews(userId, async (views, tx) => {
    const view = findView(views, id, input.revision)
    if (input.name !== undefined) validateName(views, input.name, id)
    if (input.filters !== undefined)
      await validateReferences(userId, input.filters, tx)
    if (input.name !== undefined) view.name = input.name
    if (input.pinned !== undefined) view.pinned = input.pinned
    if (input.filters !== undefined) view.filters = input.filters
    view.revision += 1
    return (await withAvailability(userId, [view], tx))[0]
  })
}

export async function deleteSavedView(
  userId: string,
  id: string,
  revision: number
): Promise<void> {
  return mutateViews(userId, async (views) => {
    const view = findView(views, id, revision)
    views.splice(views.indexOf(view), 1)
  })
}
