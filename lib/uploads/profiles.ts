import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'

import { uploadProfileOptionsSchema } from './schema'

export function profileView(profile: {
  id: string
  name: string
  options: unknown
  updatedAt: Date
}) {
  return {
    id: profile.id,
    name: profile.name,
    options: uploadProfileOptionsSchema.parse(profile.options),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

/** Generator selection is always checked against the session owner. */
export async function generatorProfile(
  userId: string,
  selected?: string | null
) {
  if (!selected) return null
  const profile = await prisma.uploadProfile.findFirst({
    where: { id: selected, userId },
    select: { id: true, name: true },
  })
  if (!profile) throw new HttpError(404, 'Upload profile not found.')
  return profile
}
