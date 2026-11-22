import type { Prisma } from '@prisma/client'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import type { PermissionSubject } from '@/lib/permissions/catalog'
import {
  PermissionError,
  type UserAccess,
  assertAccessibleAdministrator,
  getUserAccess,
  requireActorPermission,
} from '@/lib/permissions/server'
import { settingsPatchAllowed } from '@/lib/permissions/settings'

import { type FlareConfig, applyConfigUpdate } from './index'
import { keepSavedCredentials } from './views'

type ConfigUpdate = Parameters<typeof applyConfigUpdate>[1]

type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T

/**
 * Some fields of some sections. It is merged onto the saved settings, and the
 * result is checked against the settings schema before it is saved.
 */
export type SettingsPatch = DeepPartial<FlareConfig['settings']>

export interface SettingsPatchOptions {
  /**
   * Decides which submitted credentials keep their saved values, changing the
   * patch in place. It runs under the role lock, so a rule can compare with
   * the settings as saved. Blank credentials keep the saved ones by default.
   */
  credentials?: (
    settings: SettingsPatch,
    tx: Prisma.TransactionClient
  ) => void | Promise<void>
  /**
   * A caller's own refusal, run under the role lock with the account's current
   * access, after the permission checks and before anything is saved.
   */
  check?: (
    tx: Prisma.TransactionClient,
    access: UserAccess
  ) => void | Promise<void>
}

/**
 * Changes some settings sections for an account, as `PATCH /api/settings`
 * does. The permissions the caller holds are checked first, then read again
 * under the role lock; each field needs what `settingsPatchAllowed` gives it.
 */
export async function patchSettings(
  actor: PermissionSubject & { id: string },
  settings: SettingsPatch,
  options: SettingsPatchOptions = {}
): Promise<FlareConfig> {
  if (!settingsPatchAllowed(actor, settings))
    throw new HttpError(
      403,
      'You do not have permission to change these settings.'
    )
  const credentials = options.credentials ?? keepSavedCredentials
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const access = await getUserAccess(actor.id, tx)
    if (!settingsPatchAllowed(access, settings))
      throw new PermissionError(
        'You no longer have permission to change these settings.'
      )
    // Validate current email access as well as authority before committing.
    const permission = access.permissions[0]
    if (!permission) throw new PermissionError('Permission denied')
    await requireActorPermission(tx, actor.id, permission)
    // Dropping a credential only removes leaves under a section, so it never
    // changes what the permission checks above saw.
    await credentials(settings, tx)
    await options.check?.(tx, access)
    const saved = await applyConfigUpdate(tx, {
      settings: settings as ConfigUpdate['settings'],
    })
    await assertAccessibleAdministrator(tx)
    return saved
  })
}
