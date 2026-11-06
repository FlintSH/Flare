import { Prisma } from '@prisma/client'
import { readFileSync } from 'node:fs'

import {
  getConfig,
  readSavedConfigRow,
  readSavedConfigValue,
  replaceSavedConfigSection,
} from '@/lib/config'
import { lockRoleChanges, lockSettings } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { assertAccessibleAdministrator } from '@/lib/permissions/server'
import { publicOrigin } from '@/lib/security/public-origin'
import {
  assertEmailEncryptionKey,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '@/lib/security/secret-box'

import { emailCapabilities } from './eligibility'
import { EmailHttpError } from './errors'
import { effectiveVerificationMode, isEnforcedVerificationMode } from './policy'
import {
  EmailConfig,
  emailConfigSchema,
  redactEmailConfig,
  validateEnabledEmail,
} from './schema'

const SMTP_PURPOSE = 'smtp'

type Environment = Record<string, string | undefined>
type ObjectValue = Record<string, unknown>

// Every operator-facing setting can be overridden. Dates are controlled by the
// policy transition, not by a browser-supplied config snapshot.
export function emailEnvironmentName(path: string): string {
  return `FLARE_EMAIL_${path
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\./g, '_')
    .toUpperCase()}`
}

function leafEntries(value: ObjectValue, prefix = ''): [string, unknown][] {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return entry !== null && typeof entry === 'object'
      ? leafEntries(entry as ObjectValue, path)
      : [[path, entry] as [string, unknown]]
  })
}

function assignPath(object: ObjectValue, path: string, value: unknown) {
  const keys = path.split('.')
  let target = object
  for (const key of keys.slice(0, -1)) target = target[key] as ObjectValue
  target[keys[keys.length - 1]] = value
}

export function resolveEmailConfig(
  saved: unknown,
  env: Environment = process.env,
  options: { decryptPassword?: boolean; testDelivery?: boolean } = {}
): { config: EmailConfig; managedFields: string[] } {
  const config = emailConfigSchema.parse(saved ?? {})
  const managedFields: string[] = []
  for (const [path, fallback] of leafEntries(config)) {
    if (
      [
        'verification.requiredSince',
        'verification.graceEndsAt',
        'verification.appliedMode',
      ].includes(path)
    )
      continue
    const name = emailEnvironmentName(path)
    let value = env[name]
    if (env[`${name}_FILE`]) {
      if (value !== undefined)
        throw new Error(`Set only one of ${name} and ${name}_FILE`)
      try {
        value = readFileSync(env[`${name}_FILE`]!, 'utf8').trimEnd()
      } catch {
        throw new Error(`Could not read ${name}_FILE`)
      }
    }
    if (value === undefined) continue
    let parsed: unknown = value
    if (typeof fallback === 'boolean') {
      if (!['true', 'false'].includes(value))
        throw new Error(`${name} must be true or false`)
      parsed = value === 'true'
    } else if (typeof fallback === 'number') {
      if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`)
      parsed = Number(value)
    } else if (fallback === null && value === '') {
      parsed = null
    }
    assignPath(config, path, parsed)
    managedFields.push(path)
  }
  // Configuring a server never enables sending or account enforcement.
  const serverUrl = publicOrigin(env)
  if (!config.publicUrl && serverUrl)
    config.publicUrl = serverUrl.href.replace(/\/+$/, '')
  // An administrator can explicitly test delivery without changing automatic sending.
  if (options.testDelivery) config.enabled = true
  if (
    options.decryptPassword !== false &&
    config.enabled &&
    !managedFields.includes('smtp.password') &&
    config.smtp.password
  )
    config.smtp.password = decryptSecret(config.smtp.password, SMTP_PURPOSE)
  return { config: emailConfigSchema.parse(config), managedFields }
}

export async function getSavedEmailConfig(
  client: Pick<Prisma.TransactionClient, 'config'> = prisma
): Promise<EmailConfig> {
  // Outside a transaction, reuse the shared read of the saved row; it is
  // re-read whenever the row changes.
  const value =
    client === prisma
      ? (await readSavedConfigRow())?.value
      : await readSavedConfigValue(client)
  const settings = (value as { settings?: { email?: unknown } } | null)
    ?.settings
  // Database errors deliberately propagate instead of relaxing a saved policy.
  return emailConfigSchema.parse(settings?.email ?? {})
}

function validateEffectiveConfig(saved: EmailConfig): EmailConfig {
  const config = resolveEmailConfig(saved).config
  validateEnabledEmail(config)
  if (config.enabled) assertEmailEncryptionKey()
  return config
}

/**
 * The effective settings Flare runs with. Unusable ones, such as an
 * environment that enables email without an SMTP host, are the server's
 * fault, not a requester's: they throw a plain error, which routes log and
 * answer with a 500, instead of the 400 a submitted draft gets.
 */
function effectiveConfig(saved: EmailConfig): EmailConfig {
  try {
    return validateEffectiveConfig(saved)
  } catch (error) {
    if (error instanceof EmailHttpError)
      throw new Error(error.message, { cause: error })
    throw error
  }
}

/** Read policy under the same lock as settings writers, before taking user locks. */
export async function getEmailConfigForUpdate(
  tx: Prisma.TransactionClient
): Promise<EmailConfig> {
  await lockSettings(tx)
  const saved = await getSavedEmailConfig(tx)
  const config = effectiveConfig(saved)
  if (config.verification.appliedMode !== effectiveVerificationMode(config)) {
    const transition = transitionEmailPolicy(saved, config)
    // Persist only server-owned transition state, never environment overrides.
    saved.verification.requiredSince = transition.requiredSince
    saved.verification.graceEndsAt = transition.graceEndsAt
    saved.verification.appliedMode = transition.appliedMode
    if (await replaceSavedConfigSection(tx, 'email', saved))
      return effectiveConfig(saved)
  }
  return config
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const config = effectiveConfig(await getSavedEmailConfig())
  // A mutation uses getEmailConfigForUpdate directly, keeping policy stable until
  // commit. Ordinary reads take the lock only to record an environment transition.
  if (config.verification.appliedMode !== effectiveVerificationMode(config))
    return prisma.$transaction(getEmailConfigForUpdate)
  return config
}

export function transitionEmailPolicy(
  previous: EmailConfig,
  next: EmailConfig,
  now = new Date()
): EmailConfig['verification'] {
  const appliedMode = effectiveVerificationMode(next)
  const prior = previous.verification.appliedMode
  const verification = {
    ...next.verification,
    requiredSince: previous.verification.requiredSince,
    graceEndsAt: previous.verification.graceEndsAt,
    appliedMode,
  }
  if (
    isEnforcedVerificationMode(appliedMode) &&
    (!isEnforcedVerificationMode(prior) || !verification.requiredSince)
  )
    verification.requiredSince = now.toISOString()
  if (appliedMode === 'all_users' && prior !== 'all_users')
    verification.graceEndsAt = new Date(
      now.getTime() + next.verification.graceDays * 86400000
    ).toISOString()
  return verification
}

export async function getEmailSettingsView() {
  const { config, managedFields } = resolveEmailConfig(
    await getSavedEmailConfig()
  )
  return {
    config: redactEmailConfig(config),
    passwordConfigured: Boolean(config.smtp.password),
    managedFields,
  }
}

export async function prepareEmailConfig(
  input: unknown,
  clearPassword = false,
  client: Pick<Prisma.TransactionClient, 'config'> = prisma
) {
  const previous = await getSavedEmailConfig(client)
  const candidate = emailConfigSchema.parse(input)
  const managed = resolveEmailConfig(previous, process.env, {
    decryptPassword: false,
  }).managedFields
  // Ignore stale UI values for operator-managed fields; retain their saved fallback.
  const previousLeaves = new Map(leafEntries(previous))
  for (const path of managed)
    assignPath(candidate, path, previousLeaves.get(path))
  if (!managed.includes('smtp.password')) {
    if (clearPassword) candidate.smtp.password = ''
    else if (!candidate.smtp.password)
      candidate.smtp.password = previous.smtp.password
    else {
      if (isEncryptedSecret(candidate.smtp.password))
        throw new EmailHttpError(
          'Enter a new SMTP password, not an encrypted value'
        )
      candidate.smtp.password = encryptSecret(
        candidate.smtp.password,
        SMTP_PURPOSE
      )
    }
  }
  candidate.verification.requiredSince = previous.verification.requiredSince
  candidate.verification.graceEndsAt = previous.verification.graceEndsAt
  candidate.verification.appliedMode = previous.verification.appliedMode
  return {
    candidate,
    previous,
    effective: resolveEmailConfig(candidate).config,
  }
}

export async function saveEmailConfig(
  input: unknown,
  options: { clearPassword?: boolean; applyToExisting?: boolean } = {}
) {
  // Prepare against the latest saved settings while serializing policy changes
  // with account mutations and all other JSON settings writers.
  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const { candidate, previous, effective } = await prepareEmailConfig(
      input,
      options.clearPassword,
      tx
    )
    if (
      effective.enabled &&
      effective.verification.mode === 'all_users' &&
      previous.verification.appliedMode !== 'all_users'
    ) {
      if (!options.applyToExisting)
        throw new EmailHttpError(
          'Review affected existing users and confirm applying verification to them'
        )
    }
    const transition = transitionEmailPolicy(previous, effective)
    candidate.verification.requiredSince = transition.requiredSince
    candidate.verification.graceEndsAt = transition.graceEndsAt
    candidate.verification.appliedMode = transition.appliedMode
    validateEffectiveConfig(candidate)
    const finalConfig = resolveEmailConfig(candidate).config
    if (finalConfig.enabled && finalConfig.verification.mode === 'all_users') {
      await assertAccessibleAdministrator(tx, finalConfig)
    }
    if (!(await replaceSavedConfigSection(tx, 'email', candidate)))
      throw new EmailHttpError(
        'Complete instance setup before configuring email'
      )
    if (!finalConfig.enabled) {
      await tx.mailOutbox.updateMany({
        where: { status: { in: ['pending', 'processing'] } },
        data: {
          status: 'cancelled',
          payload: '',
          lastError: 'Email sending disabled',
          leaseUntil: null,
          leaseId: null,
        },
      })
    }
  })
  return getEmailSettingsView()
}

export async function getEmailCapabilities() {
  const config = await getEmailConfig()
  return emailCapabilities(config, (await getConfig()).settings.general.oidc)
}
