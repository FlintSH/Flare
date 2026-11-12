import type { AppearanceDocument } from '@/lib/customization/schema'
import { getUserAccess } from '@/lib/permissions/server'

import { type PersonalEmbed, readPersonalEmbed } from './schema'

/**
 * The embed a file's owner chose for themselves, or null while it doesn't
 * apply: the instance uses one embed for everyone, they chose nothing, or
 * their roles no longer let them choose how their links embed. Roles are
 * read as they are now, so taking the permission away stops a saved card at
 * once.
 */
export async function ownerEmbed(
  file: { userId: string; user: { preferences: unknown } },
  sharing: AppearanceDocument['sharing']
): Promise<PersonalEmbed | null> {
  if (!sharing.personalEmbeds) return null
  const personal = readPersonalEmbed(file.user.preferences)
  if (personal.mode === 'inherit' && personal.design === 'inherit') return null
  const { permissions } = await getUserAccess(file.userId)
  return permissions.includes('files.share') ? personal : null
}
