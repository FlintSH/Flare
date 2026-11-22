import { type SaveCheck, savePreference } from '@/lib/users/preferences'

import type { PersonalAppearance } from './schema'

/**
 * Saves an account's own theme mode, beside its other preferences. A `check`
 * can refuse the save with the account row locked.
 */
export async function savePersonalAppearance(
  userId: string,
  preference: PersonalAppearance,
  check?: SaveCheck
): Promise<PersonalAppearance> {
  await savePreference(userId, 'customization', preference, check)
  return preference
}
