import { Prisma } from '@prisma/client'
import { readFileSync } from 'node:fs'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

import {
  assertEmailEncryptionKey,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from './crypto'
import { hasVerifiedEmail } from './policy'
import { EmailConfig, emailConfigSchema, validateEnabledEmail } from './schema'

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
  if (!config.publicUrl && env.NEXTAUTH_URL)
    config.publicUrl = env.NEXTAUTH_URL.replace(/\/+$/, '')
  // An administrator can explicitly test delivery without changing automatic sending.
  if (options.testDelivery) config.enabled = true
  if (
    options.decryptPassword !== false &&
    config.enabled &&
    !managedFields.includes('smtp.password') &&
    config.smtp.password
  )
    config.smtp.password = decryptSecret(config.smtp.password)
  return { config: emailConfigSchema.parse(config), managedFields }
}

export async function getSavedEmailConfig(
  client: Pick<Prisma.TransactionClient, 'config'> = prisma
): Promise<EmailConfig> {
  const row = await client.config.findUnique({ where: { key: 'flare_config' } })
  const settings = (row?.value as { settings?: { email?: unknown } } | null)
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

/** Read policy under the same lock as settings writers, before taking user locks. */
export async function getEmailConfigForUpdate(
  tx: Prisma.TransactionClient
): Promise<EmailConfig> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
  const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
  const value = row?.value as ObjectValue | undefined
  const settings = value?.settings as ObjectValue | undefined
  const saved = emailConfigSchema.parse(settings?.email ?? {})
  const config = validateEffectiveConfig(saved)
  if (
    row &&
    config.verification.appliedMode !==
      (config.enabled ? config.verification.mode : 'off')
  ) {
    const transition = transitionEmailPolicy(saved, config)
    // Persist only server-owned transition state, never environment overrides.
    saved.verification.requiredSince = transition.requiredSince
    saved.verification.graceEndsAt = transition.graceEndsAt
    saved.verification.appliedMode = transition.appliedMode
    await tx.config.update({
      where: { key: 'flare_config' },
      data: {
        value: {
          ...value,
          settings: { ...settings, email: saved },
        } as Prisma.InputJsonValue,
      },
    })
    return validateEffectiveConfig(saved)
  }
  return config
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const config = validateEffectiveConfig(await getSavedEmailConfig())
  // A mutation uses getEmailConfigForUpdate directly, keeping policy stable until
  // commit. Ordinary reads take the lock only to record an environment transition.
  if (
    config.verification.appliedMode !==
    (config.enabled ? config.verification.mode : 'off')
  )
    return prisma.$transaction(getEmailConfigForUpdate)
  return config
}

export function transitionEmailPolicy(
  previous: EmailConfig,
  next: EmailConfig,
  now = new Date()
): EmailConfig['verification'] {
  const appliedMode = next.enabled ? next.verification.mode : 'off'
  const prior = previous.verification.appliedMode
  const verification = {
    ...next.verification,
    requiredSince: previous.verification.requiredSince,
    graceEndsAt: previous.verification.graceEndsAt,
    appliedMode,
  }
  if (
    ['new_users', 'all_users'].includes(appliedMode) &&
    (!['new_users', 'all_users'].includes(prior) || !verification.requiredSince)
  )
    verification.requiredSince = now.toISOString()
  if (appliedMode === 'all_users' && prior !== 'all_users')
    verification.graceEndsAt = new Date(
      now.getTime() + next.verification.graceDays * 86400000
    ).toISOString()
  return verification
}

export function redactEmailConfig(config: EmailConfig): EmailConfig {
  return { ...config, smtp: { ...config.smtp, password: '' } }
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
        throw new Error('Enter a new SMTP password, not an encrypted value')
      candidate.smtp.password = encryptSecret(candidate.smtp.password)
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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
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
        throw new Error(
          'Review affected existing users and confirm applying verification to them'
        )
    }
    const transition = transitionEmailPolicy(previous, effective)
    candidate.verification.requiredSince = transition.requiredSince
    candidate.verification.graceEndsAt = transition.graceEndsAt
    candidate.verification.appliedMode = transition.appliedMode
    validateEffectiveConfig(candidate)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347202)`
    const finalConfig = resolveEmailConfig(candidate).config
    if (finalConfig.enabled && finalConfig.verification.mode === 'all_users') {
      const admins = await tx.user.findMany({ where: { role: 'ADMIN' } })
      if (
        !admins.some(
          (admin) => admin.emailExempt || hasVerifiedEmail(admin, finalConfig)
        )
      ) {
        throw new Error(
          'Verify an administrator recovery address or explicitly exempt an administrator before requiring verification for everyone'
        )
      }
    }
    const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
    if (!row)
      throw new Error('Complete instance setup before configuring email')
    const value = row.value as ObjectValue
    const settings = value.settings as ObjectValue
    await tx.config.update({
      where: { key: 'flare_config' },
      data: {
        value: {
          ...value,
          settings: { ...settings, email: candidate },
        } as Prisma.InputJsonValue,
      },
    })
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
  const oidc = (await getConfig()).settings.general.oidc
  return {
    enabled: config.enabled,
    recoveryEnabled:
      config.enabled &&
      config.recovery.enabled &&
      !(oidc.enabled && oidc.enforceSso),
    verificationMode: config.enabled ? config.verification.mode : 'off',
    changesEnabled: config.enabled && config.changes.enabled,
  }
}
