import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { emailPolicyImpact, testSavedEmailSettings } from '@/lib/email/admin'
import {
  type EmailConfigBuilder,
  getSavedEmailConfig,
  prepareEmailConfig,
  resolveEmailConfig,
  saveEmailConfig,
} from '@/lib/email/config'
import { emailEnvironmentName } from '@/lib/email/environment'
import { type EmailConfig, emailConfigSchema } from '@/lib/email/schema'
import { HttpError } from '@/lib/http/errors'
import { requireActorPermission } from '@/lib/permissions/server'

import { compact } from '../results'
import { ToolError, defineTool } from '../tool'
import { emailSection, emailSectionSchema } from './instance-views'
import { sentence } from './shared'

/**
 * The email settings an agent may change, and the test of the saved ones.
 * Where account mail goes stays in the browser (design 3.16 item 4): no
 * argument here reaches the SMTP connection, the address put in emailed
 * links (`publicUrl`) or whether single sign-on addresses count as verified
 * (`verification.trustOidc`). A change is merged onto the saved document
 * under the saving transaction's locks, so those fields are saved exactly
 * as they were.
 */

// The bounds are the settings schema's own, without its defaults.
const shape = emailConfigSchema.shape
const sections = {
  recovery: shape.recovery.unwrap().shape,
  verification: shape.verification.unwrap().shape,
  changes: shape.changes.unwrap().shape,
  limits: shape.limits.unwrap().shape,
  delivery: shape.delivery.unwrap().shape,
  branding: shape.branding.unwrap().shape,
}

export const emailInput = z.strictObject({
  enabled: z
    .boolean()
    .optional()
    .describe(
      'Send account email. Turning it off cancels mail waiting to be sent. Turning it on needs the SMTP connection, a sender address and the public address, set in the browser'
    ),
  from_name: shape.fromName.unwrap().optional(),
  from_address: shape.fromAddress
    .unwrap()
    .optional()
    .describe('The sender address; an empty string clears it'),
  reply_to: shape.replyTo.unwrap().optional(),
  recovery: z
    .strictObject({
      enabled: sections.recovery.enabled
        .unwrap()
        .optional()
        .describe('Let people reset a forgotten password by email'),
      token_minutes: sections.recovery.tokenMinutes.unwrap().optional(),
      rotate_upload_token: sections.recovery.rotateUploadToken
        .unwrap()
        .optional()
        .describe("Replace the account's upload token after a reset"),
    })
    .optional(),
  verification: z
    .strictObject({
      mode: sections.verification.mode
        .unwrap()
        .optional()
        .describe(
          'off; optional; new_users: new accounts must verify; all_users: every account must, after the grace period. Moving to all_users needs `apply_to_existing`'
        ),
      grace_days: sections.verification.graceDays.unwrap().optional(),
      admin_created: sections.verification.adminCreated
        .unwrap()
        .optional()
        .describe('Whether accounts an administrator creates must verify'),
      token_hours: sections.verification.tokenHours.unwrap().optional(),
    })
    .optional(),
  apply_to_existing: z
    .boolean()
    .optional()
    .describe(
      'Confirms requiring verification of every existing account, as the Email tab asks before it does. A call without it is refused with how many accounts that would shut out'
    ),
  changes: z
    .strictObject({
      enabled: sections.changes.enabled
        .unwrap()
        .optional()
        .describe('Let people change their own email address'),
      require_old_email: sections.changes.requireOldEmail.unwrap().optional(),
    })
    .optional(),
  limits: z
    .strictObject({
      resend_seconds: sections.limits.resendSeconds.unwrap().optional(),
      address_per_hour: sections.limits.addressPerHour.unwrap().optional(),
      ip_per_hour: sections.limits.ipPerHour.unwrap().optional(),
      daily_limit: sections.limits.dailyLimit.unwrap().optional(),
    })
    .optional(),
  delivery: z
    .strictObject({
      max_attempts: sections.delivery.maxAttempts.unwrap().optional(),
      retry_seconds: sections.delivery.retrySeconds.unwrap().optional(),
      concurrency: sections.delivery.concurrency.unwrap().optional(),
      retention_days: sections.delivery.retentionDays.unwrap().optional(),
    })
    .optional(),
  branding: z
    .strictObject({
      instance_name: sections.branding.instanceName.unwrap().optional(),
      logo_url: sections.branding.logoUrl
        .unwrap()
        .optional()
        .describe(
          'An http(s) image address. Mail clients load it from wherever it points, which tells that server when mail is opened'
        ),
      accent_color: sections.branding.accentColor.unwrap().optional(),
      footer: sections.branding.footer.unwrap().optional(),
      support_address: sections.branding.supportAddress.unwrap().optional(),
      subject_prefix: sections.branding.subjectPrefix.unwrap().optional(),
      verification_subject: sections.branding.verificationSubject
        .unwrap()
        .optional(),
      reset_subject: sections.branding.resetSubject.unwrap().optional(),
      change_subject: sections.branding.changeSubject.unwrap().optional(),
      intro_text: sections.branding.introText.unwrap().optional(),
    })
    .optional(),
})
type EmailInput = z.infer<typeof emailInput>

/** Each argument, as the path of the email setting it changes. */
function emailChanges(args: EmailInput): [string, unknown][] {
  const changes: [string, unknown][] = []
  const put = (path: string, value: unknown) => {
    if (value !== undefined) changes.push([path, value])
  }
  put('enabled', args.enabled)
  put('fromName', args.from_name)
  put('fromAddress', args.from_address)
  put('replyTo', args.reply_to)
  const r = args.recovery
  put('recovery.enabled', r?.enabled)
  put('recovery.tokenMinutes', r?.token_minutes)
  put('recovery.rotateUploadToken', r?.rotate_upload_token)
  const v = args.verification
  put('verification.mode', v?.mode)
  put('verification.graceDays', v?.grace_days)
  put('verification.adminCreated', v?.admin_created)
  put('verification.tokenHours', v?.token_hours)
  put('changes.enabled', args.changes?.enabled)
  put('changes.requireOldEmail', args.changes?.require_old_email)
  const l = args.limits
  put('limits.resendSeconds', l?.resend_seconds)
  put('limits.addressPerHour', l?.address_per_hour)
  put('limits.ipPerHour', l?.ip_per_hour)
  put('limits.dailyLimit', l?.daily_limit)
  const d = args.delivery
  put('delivery.maxAttempts', d?.max_attempts)
  put('delivery.retrySeconds', d?.retry_seconds)
  put('delivery.concurrency', d?.concurrency)
  put('delivery.retentionDays', d?.retention_days)
  const b = args.branding
  put('branding.instanceName', b?.instance_name)
  put('branding.logoUrl', b?.logo_url)
  put('branding.accentColor', b?.accent_color)
  put('branding.footer', b?.footer)
  put('branding.supportAddress', b?.support_address)
  put('branding.subjectPrefix', b?.subject_prefix)
  put('branding.verificationSubject', b?.verification_subject)
  put('branding.resetSubject', b?.reset_subject)
  put('branding.changeSubject', b?.change_subject)
  put('branding.introText', b?.intro_text)
  return changes
}

/**
 * Every email setting a call can write. The change is held to this list
 * after it is built, so no mistake can reach `smtp`, `publicUrl`,
 * `verification.trustOidc` or the server-owned verification fields.
 */
export const EMAIL_PATHS = [
  'enabled',
  'fromName',
  'fromAddress',
  'replyTo',
  'recovery.enabled',
  'recovery.tokenMinutes',
  'recovery.rotateUploadToken',
  'verification.mode',
  'verification.graceDays',
  'verification.adminCreated',
  'verification.tokenHours',
  'changes.enabled',
  'changes.requireOldEmail',
  'limits.resendSeconds',
  'limits.addressPerHour',
  'limits.ipPerHour',
  'limits.dailyLimit',
  'delivery.maxAttempts',
  'delivery.retrySeconds',
  'delivery.concurrency',
  'delivery.retentionDays',
  'branding.instanceName',
  'branding.logoUrl',
  'branding.accentColor',
  'branding.footer',
  'branding.supportAddress',
  'branding.subjectPrefix',
  'branding.verificationSubject',
  'branding.resetSubject',
  'branding.changeSubject',
  'branding.introText',
] as const

/**
 * The saved document with the call's changes on top. The password is sent
 * blank, which `prepareEmailConfig` reads as "keep the saved one"; every
 * other field the call does not name, the SMTP connection, `publicUrl` and
 * `trustOidc` among them, is the saved value as it is.
 */
export function mergeEmailChanges(
  saved: EmailConfig,
  changes: readonly [string, unknown][]
): EmailConfig {
  const merged = structuredClone(saved)
  for (const [path, value] of changes) {
    if (!(EMAIL_PATHS as readonly string[]).includes(path))
      throw new Error(`update_email_settings built ${path}`)
    const keys = path.split('.')
    let target = merged as unknown as Record<string, unknown>
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>
    target[keys[keys.length - 1]] = value
  }
  merged.smtp.password = ''
  return merged
}

/** Refuses a change to a setting the server's environment sets: it would be ignored. */
function refuseManaged(
  saved: EmailConfig,
  changes: readonly [string, unknown][]
) {
  const { managedFields } = resolveEmailConfig(saved, process.env, {
    decryptPassword: false,
  })
  const managed = changes
    .map(([path]) => path)
    .filter((path) => managedFields.includes(path))
  if (managed.length)
    throw new ToolError(
      `Nothing was saved: ${managed
        .map((path) => `${path} is set by ${emailEnvironmentName(path)}`)
        .join(
          ', '
        )} in the server's environment, so it cannot be changed here. Leave it out, or ask whoever runs the server.`
    )
}

const CONFIRM =
  'Review affected existing users and confirm applying verification to them'

const updateEmailSettingsTool = defineTool({
  name: 'update_email_settings',
  description:
    "Change some email settings: whether email is on, the sender name and address, reply-to, password recovery, email verification, email address changes, sending limits, delivery retries, and branding (text, subjects, support address, accent color and a logo URL, which mail clients load from wherever it points). Fields left out stay as they are. The SMTP connection, the public address put in emailed links, and whether single sign-on addresses count as verified are not changeable here: they stay in the browser, so mail cannot be sent somewhere new. Requiring verification of every existing account needs `apply_to_existing: true`; without it the call is refused with how many accounts it would shut out once the grace period ends. Settings the server's environment sets are refused. Answers the email settings as get_instance_settings shows them.",
  input: emailInput,
  output: z.object({ email: emailSectionSchema }),
  async run(args, context) {
    const changes = emailChanges(args)
    if (!changes.length)
      throw new ToolError(
        args.apply_to_existing !== undefined
          ? '`apply_to_existing` confirms a change to `verification.mode`; give the change with it.'
          : 'Nothing to change. Give at least one setting; get_instance_settings shows them with `sections: ["email"]`.'
      )
    setAuditTarget({ type: 'settings', name: 'email' })
    const userId = context.principal.user.id
    const applyToExisting = args.apply_to_existing === true

    // Say what a switch to verifying everyone does before it is confirmed,
    // as the Email tab does. The save checks it again under its locks.
    if (!applyToExisting && args.verification?.mode === 'all_users') {
      const saved = await getSavedEmailConfig()
      refuseManaged(saved, changes)
      const { previous, effective } = await prepareEmailConfig(
        mergeEmailChanges(saved, changes)
      )
      if (
        effective.enabled &&
        previous.verification.appliedMode !== 'all_users'
      ) {
        const impact = await emailPolicyImpact(effective)
        throw new ToolError(
          `Nothing was saved: requiring every account to verify its email shuts out ${impact.affectedUsers} account${impact.affectedUsers === 1 ? '' : 's'} without a verified address once the ${effective.verification.graceDays}-day grace period ends (${impact.unverifiedUsers} unverified now). Call again with \`apply_to_existing: true\` to confirm.`
        )
      }
    }

    let view: Awaited<ReturnType<typeof saveEmailConfig>>
    try {
      view = await saveEmailConfig(
        (async (saved, tx) => {
          // The route checks this only on entry; it is a key permission, so
          // it is read again under the lock before the save.
          await requireActorPermission(tx, userId, 'settings.email')
          refuseManaged(saved, changes)
          return mergeEmailChanges(saved, changes)
        }) satisfies EmailConfigBuilder,
        { applyToExisting }
      )
    } catch (error) {
      if (error instanceof ToolError) throw error
      if (error instanceof HttpError)
        throw new ToolError(
          error.message === CONFIRM
            ? 'Nothing was saved: this requires every existing account to verify its email. Call again with `apply_to_existing: true` to confirm.'
            : `Nothing was saved: ${sentence(error.message)}`,
          error.status === 403 ? 'denied' : 'failure'
        )
      if (error instanceof z.ZodError)
        throw new ToolError(
          `Nothing was saved: ${error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        )
      throw error
    }
    return { structured: { email: await emailSection(view) } }
  },
})

const sendTestEmailTool = defineTool({
  name: 'send_test_email',
  description:
    'Test the saved email settings: `connection` connects and signs in to the SMTP server; `send` also sends one test message to `recipient`. It uses only the settings as saved, never anything else, and works while email sending is off. `send` delivers real mail and counts toward the daily sending limit. To change the SMTP connection, an administrator uses the Email tab in the browser.',
  input: z.strictObject({
    action: z
      .enum(['connection', 'send'])
      .describe(
        'connection: connect and sign in only; send: also send one message'
      ),
    recipient: z
      .email()
      .max(254)
      .optional()
      .describe('Where `send` delivers the test message'),
  }),
  output: z.object({
    action: z.enum(['connection', 'send']),
    message: z.string(),
  }),
  async run(args) {
    if (args.action === 'send' && !args.recipient)
      throw new ToolError('Give a `recipient` for the test message.')
    if (args.action === 'connection' && args.recipient)
      throw new ToolError(
        '`recipient` is for `send`. Leave it out to test the connection only.'
      )
    setAuditTarget({ type: 'settings', name: 'email' })
    try {
      const message = await testSavedEmailSettings(
        compact({ action: args.action, recipient: args.recipient })
      )
      return { structured: { action: args.action, message } }
    } catch (error) {
      if (error instanceof HttpError)
        throw new ToolError(
          `The test failed: ${sentence(error.message)} The saved settings are unchanged; the SMTP connection is fixed in the browser, in Settings, Email.`
        )
      throw error
    }
  },
})

export const emailTools = [updateEmailSettingsTool, sendTestEmailTool]
