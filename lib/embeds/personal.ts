import { getConfig } from '@/lib/config'
import { HttpError } from '@/lib/http/errors'
import { type SaveCheck, savePreference } from '@/lib/users/preferences'

import { type PersonalEmbed, readPersonalEmbed } from './schema'

/** Whether this instance lets each account choose how its own links preview. */
export async function personalEmbedsAllowed(): Promise<boolean> {
  const { sharing } = (await getConfig()).settings.customization.published
  return sharing.personalEmbeds
}

/**
 * Saves how an account's links preview, beside its other preferences. Refused
 * while the instance uses one embed for every account. `embed` replaces the
 * saved one, or, as a function, is handed the saved one as it stands with the
 * account row locked and answers what to save. A `check` can refuse the save
 * under that lock.
 */
export async function savePersonalEmbed(
  userId: string,
  embed: PersonalEmbed | ((current: PersonalEmbed) => PersonalEmbed),
  check?: SaveCheck
): Promise<PersonalEmbed> {
  if (!(await personalEmbedsAllowed()))
    throw new HttpError(403, 'This instance uses one embed for every account.')
  if (typeof embed !== 'function') {
    await savePreference(userId, 'embed', embed, check)
    return embed
  }
  return (await savePreference(
    userId,
    'embed',
    (current) => embed(readPersonalEmbed({ embed: current })),
    check
  )) as PersonalEmbed
}
