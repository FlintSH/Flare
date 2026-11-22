import * as z from 'zod'

import type { FlareConfig } from '@/lib/config'
import { redactSettings } from '@/lib/config/views'
import type {
  AppearanceDocument,
  CustomizationState,
} from '@/lib/customization/schema'
import { emailPolicyImpact } from '@/lib/email/admin'
import { getEmailSettingsView } from '@/lib/email/config'
import { type EmailConfig, redactEmailConfig } from '@/lib/email/schema'
import { EMBED_MODES } from '@/lib/embeds/schema'
import { everyoneCanInvite } from '@/lib/invites/service'

import { compact } from '../results'

/**
 * How the instance tools show the settings: one reader for
 * `get_instance_settings` and for every tool that answers what it changed,
 * so an agent sees a section the same way wherever it reads it. Secrets are
 * blanked by the app's own `redactSettings` and `redactEmailConfig` before a
 * section is built; a section says only whether one is saved.
 */

/** The sections, in the order answers list them. */
export const SECTIONS = [
  'registrations',
  'storage',
  'credits',
  'ocr',
  'theme',
  'appearance',
  'email',
  'sign_in',
  'custom_code',
  'setup',
  'mcp',
] as const
export type Section = (typeof SECTIONS)[number]

/** Sections no tool can change: they are shown so an agent can explain the instance. */
export const READ_ONLY_SECTIONS = [
  'sign_in',
  'custom_code',
  'setup',
  'mcp',
] as const satisfies readonly Section[]

const sizeSchema = z.object({ value: z.number(), unit: z.string() })

const registrationsSchema = z.object({
  enabled: z.boolean().describe('Anyone may create an account'),
  disabled_message: z
    .string()
    .describe('Shown on the sign-up page while registration is closed'),
  invite_limits: z
    .object({
      active_invites: z.number(),
      uses_per_invite: z.number(),
      lifetime_days: z.number(),
    })
    .describe(
      'Limits for accounts that may invite people but not create users'
    ),
  everyone_can_invite: z
    .boolean()
    .describe('The Everyone role holds Create invites'),
})

const storageSchema = z.object({
  provider: z.enum(['local', 's3']),
  s3: z.object({
    bucket: z.string(),
    region: z.string(),
    endpoint: z
      .string()
      .optional()
      .describe('An S3-compatible endpoint; absent means AWS'),
    force_path_style: z.boolean(),
    access_key_id_saved: z.boolean(),
    secret_access_key_saved: z.boolean(),
  }),
  quotas_enabled: z.boolean(),
  default_quota: sizeSchema.describe('Storage each account may use'),
  max_upload_size: sizeSchema,
})

const themeSchema = z.object({
  classic_theme: z.enum(['dark', 'light', 'system']),
  classic_colors: z
    .record(z.string(), z.string())
    .describe('HSL triplets by token; used while the studio theme is off'),
  favicon_set: z.boolean(),
})

const paletteView = z.record(z.string(), z.string())

/** A studio document without its logo data, which says only whether each logo is set. */
export const appearanceDocumentView = z.object({
  brand: z.object({
    name: z.string(),
    tagline: z.string(),
    footer_text: z.string(),
    logo_light_set: z.boolean(),
    logo_dark_set: z.boolean(),
  }),
  theme: z.object({
    enabled: z.boolean().describe('false: the classic theme applies'),
    default_mode: z.enum(['system', 'light', 'dark']),
    light: paletteView,
    dark: paletteView,
    radius: z.number(),
    background: z.enum(['glow', 'plain', 'grid']),
    font: z.enum(['inter', 'system', 'mono']),
  }),
  sharing: z.object({
    default_style: z.enum(['minimal', 'framed', 'delivery']),
    show_uploader: z.boolean(),
    show_filename: z.boolean(),
    show_size: z.boolean(),
    show_expiry: z.boolean(),
    show_footer: z
      .boolean()
      .nullable()
      .describe('null follows the credits footer setting'),
    image_fit: z.enum(['contain', 'cover']),
    embed_mode: z.enum(EMBED_MODES),
    personal_embeds: z.boolean(),
    site_name_template: z.string(),
    author_template: z.string(),
    title_template: z.string(),
    description_template: z.string(),
    embed_color: z.string(),
  }),
})
type DocumentView = z.infer<typeof appearanceDocumentView>

export const appearanceStateSchema = z.object({
  revision: z
    .number()
    .describe(
      'Changes with every studio save; pass it to update_instance_appearance to refuse a stale edit'
    ),
  published: appearanceDocumentView.describe('What visitors see'),
  draft: appearanceDocumentView
    .optional()
    .describe('A saved draft that is not live yet'),
  has_previous: z.boolean().describe('restore can bring back the last one'),
  published_at: z.string().optional(),
})

const yes = z.boolean()
export const emailSectionSchema = z.object({
  enabled: z.boolean(),
  sender: z.object({
    from_name: z.string(),
    from_address: z.string(),
    reply_to: z.string(),
  }),
  connection: z
    .object({
      host: z.string(),
      port: z.number(),
      security: z.enum(['tls', 'starttls', 'none']),
      authentication: z.boolean(),
      username: z.string(),
      password_saved: yes,
      ca_set: yes,
      timeout_seconds: z.number(),
    })
    .describe('Read only: the SMTP connection is changed in the browser'),
  public_url: z
    .string()
    .describe(
      'Read only: the address put in emailed links; it is changed in the browser'
    ),
  recovery: z.object({
    enabled: z.boolean(),
    token_minutes: z.number(),
    rotate_upload_token: z.boolean(),
  }),
  verification: z.object({
    mode: z.enum(['off', 'optional', 'new_users', 'all_users']),
    applied_mode: z.enum(['off', 'optional', 'new_users', 'all_users']),
    required_since: z.string().optional(),
    grace_days: z.number(),
    grace_ends_at: z.string().optional(),
    admin_created: z.enum(['inherit', 'exempt']),
    trust_oidc: z
      .boolean()
      .describe(
        'Read only: whether single sign-on addresses count as verified'
      ),
    token_hours: z.number(),
  }),
  changes: z.object({
    enabled: z.boolean(),
    require_old_email: z.boolean(),
  }),
  limits: z.object({
    resend_seconds: z.number(),
    address_per_hour: z.number(),
    ip_per_hour: z.number(),
    daily_limit: z.number(),
  }),
  delivery: z.object({
    max_attempts: z.number(),
    retry_seconds: z.number(),
    concurrency: z.number(),
    retention_days: z.number(),
  }),
  branding: z.object({
    instance_name: z.string(),
    logo_url: z.string(),
    accent_color: z.string(),
    footer: z.string(),
    support_address: z.string(),
    subject_prefix: z.string(),
    verification_subject: z.string(),
    reset_subject: z.string(),
    change_subject: z.string(),
    intro_text: z.string(),
  }),
  environment_managed: z
    .array(z.string())
    .optional()
    .describe(
      "Settings the server's environment sets, as paths such as limits.dailyLimit; they cannot be changed here"
    ),
  policy_impact: z
    .object({
      unverified_users: z.number(),
      affected_users: z
        .number()
        .describe(
          'Accounts that verification of every account would shut out once its grace period ends'
        ),
    })
    .optional(),
})

export const settingsSectionsSchema = z.object({
  registrations: registrationsSchema.optional(),
  storage: storageSchema.optional(),
  credits: z.object({ show_footer: z.boolean() }).optional(),
  ocr: z
    .object({ enabled: z.boolean().describe('Read text from images') })
    .optional(),
  theme: themeSchema.optional(),
  appearance: appearanceStateSchema.optional(),
  email: emailSectionSchema.optional(),
  sign_in: z
    .object({
      oidc_enabled: z.boolean(),
      issuer: z.string(),
      client_id: z.string(),
      client_secret_saved: z.boolean(),
      button_text: z.string(),
      auto_provision: z.boolean(),
      require_email_verified: z.boolean(),
      enforce_sso: z.boolean(),
    })
    .optional()
    .describe('Read only: single sign-on is set up in the browser'),
  custom_code: z
    .object({ custom_css_set: z.boolean(), custom_head_set: z.boolean() })
    .optional()
    .describe(
      'Read only: whether custom CSS and head HTML are set; their text is not shown'
    ),
  setup: z
    .object({ completed: z.boolean(), completed_at: z.string().optional() })
    .optional(),
  mcp: z
    .object({ enabled: z.boolean(), administration: z.boolean() })
    .optional()
    .describe('Read only: the MCP switches are changed in the browser'),
})
export type SettingsSections = z.infer<typeof settingsSectionsSchema>

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : undefined

export function documentView(document: AppearanceDocument): DocumentView {
  const { brand, theme, sharing } = document
  return {
    brand: {
      name: brand.name,
      tagline: brand.tagline,
      footer_text: brand.footerText,
      logo_light_set: Boolean(brand.logoLight),
      logo_dark_set: Boolean(brand.logoDark),
    },
    theme: {
      enabled: theme.enabled,
      default_mode: theme.defaultMode,
      light: { ...theme.light },
      dark: { ...theme.dark },
      radius: theme.radius,
      background: theme.background,
      font: theme.font,
    },
    sharing: {
      default_style: sharing.defaultStyle,
      show_uploader: sharing.showUploader,
      show_filename: sharing.showFilename,
      show_size: sharing.showSize,
      show_expiry: sharing.showExpiry,
      show_footer: sharing.showFooter,
      image_fit: sharing.imageFit,
      embed_mode: sharing.embedMode,
      personal_embeds: sharing.personalEmbeds,
      site_name_template: sharing.siteNameTemplate,
      author_template: sharing.authorTemplate,
      title_template: sharing.titleTemplate,
      description_template: sharing.descriptionTemplate,
      embed_color: sharing.embedColor,
    },
  }
}

/**
 * The studio's state. A draft is shown only to an account that may manage
 * appearance, as `GET /api/customization` does.
 */
export function appearanceState(
  state: CustomizationState,
  withDraft: boolean
): z.infer<typeof appearanceStateSchema> {
  return compact({
    revision: state.revision,
    published: documentView(state.published),
    draft: withDraft && state.draft ? documentView(state.draft) : undefined,
    has_previous: Boolean(state.previous),
    published_at: iso(state.publishedAt),
  })
}

type EmailView = Awaited<ReturnType<typeof getEmailSettingsView>>

/** The email settings as Flare runs with them, environment included, without the password. */
export async function emailSection(
  view: EmailView
): Promise<z.infer<typeof emailSectionSchema>> {
  const config: EmailConfig = redactEmailConfig(view.config)
  const { smtp, verification: v, limits, delivery, branding: b } = config
  return compact({
    enabled: config.enabled,
    sender: {
      from_name: config.fromName,
      from_address: config.fromAddress,
      reply_to: config.replyTo,
    },
    connection: {
      host: smtp.host,
      port: smtp.port,
      security: smtp.security,
      authentication: smtp.authentication,
      username: smtp.username,
      password_saved: view.passwordConfigured,
      ca_set: Boolean(smtp.ca),
      timeout_seconds: smtp.timeoutSeconds,
    },
    public_url: config.publicUrl,
    recovery: {
      enabled: config.recovery.enabled,
      token_minutes: config.recovery.tokenMinutes,
      rotate_upload_token: config.recovery.rotateUploadToken,
    },
    verification: compact({
      mode: v.mode,
      applied_mode: v.appliedMode,
      required_since: iso(v.requiredSince),
      grace_days: v.graceDays,
      grace_ends_at: iso(v.graceEndsAt),
      admin_created: v.adminCreated,
      trust_oidc: v.trustOidc,
      token_hours: v.tokenHours,
    }),
    changes: {
      enabled: config.changes.enabled,
      require_old_email: config.changes.requireOldEmail,
    },
    limits: {
      resend_seconds: limits.resendSeconds,
      address_per_hour: limits.addressPerHour,
      ip_per_hour: limits.ipPerHour,
      daily_limit: limits.dailyLimit,
    },
    delivery: {
      max_attempts: delivery.maxAttempts,
      retry_seconds: delivery.retrySeconds,
      concurrency: delivery.concurrency,
      retention_days: delivery.retentionDays,
    },
    branding: {
      instance_name: b.instanceName,
      logo_url: b.logoUrl,
      accent_color: b.accentColor,
      footer: b.footer,
      support_address: b.supportAddress,
      subject_prefix: b.subjectPrefix,
      verification_subject: b.verificationSubject,
      reset_subject: b.resetSubject,
      change_subject: b.changeSubject,
      intro_text: b.introText,
    },
    environment_managed: view.managedFields.length
      ? [...view.managedFields]
      : undefined,
    policy_impact: await emailPolicyImpact(view.config).then(
      ({ unverifiedUsers, affectedUsers }) => ({
        unverified_users: unverifiedUsers,
        affected_users: affectedUsers,
      })
    ),
  })
}

export type SectionReader = {
  config: FlareConfig
  /** The account may manage appearance, so it sees the studio's draft. */
  appearanceDraft: boolean
  /** The email view, when the email section is asked for. */
  email?: EmailView
}

/**
 * The asked-for sections of the settings. Everything is built from
 * `redactSettings(config)`; whether a secret is saved is read before that
 * and kept as a yes or no.
 */
export async function readSections(
  sections: readonly Section[],
  { config, appearanceDraft, email }: SectionReader
): Promise<SettingsSections> {
  const raw = config.settings
  const { settings } = redactSettings(config)
  const { registrations, storage, credits, ocr, oidc, setup, mcp } =
    settings.general
  const wanted = new Set(sections)
  const answer: SettingsSections = {}
  if (wanted.has('registrations'))
    answer.registrations = {
      enabled: registrations.enabled,
      disabled_message: registrations.disabledMessage,
      invite_limits: {
        active_invites: registrations.inviteLimits.activeInvites,
        uses_per_invite: registrations.inviteLimits.usesPerInvite,
        lifetime_days: registrations.inviteLimits.lifetimeDays,
      },
      everyone_can_invite: await everyoneCanInvite(),
    }
  if (wanted.has('storage'))
    answer.storage = {
      provider: storage.provider,
      s3: compact({
        bucket: storage.s3.bucket,
        region: storage.s3.region,
        endpoint: storage.s3.endpoint || undefined,
        force_path_style: storage.s3.forcePathStyle,
        access_key_id_saved: Boolean(raw.general.storage.s3.accessKeyId),
        secret_access_key_saved: Boolean(
          raw.general.storage.s3.secretAccessKey
        ),
      }),
      quotas_enabled: storage.quotas.enabled,
      default_quota: { ...storage.quotas.default },
      max_upload_size: { ...storage.maxUploadSize },
    }
  if (wanted.has('credits'))
    answer.credits = { show_footer: credits.showFooter }
  if (wanted.has('ocr')) answer.ocr = { enabled: ocr.enabled }
  if (wanted.has('theme'))
    answer.theme = {
      classic_theme: settings.appearance.theme,
      classic_colors: { ...settings.appearance.customColors },
      favicon_set: Boolean(settings.appearance.favicon),
    }
  if (wanted.has('appearance'))
    answer.appearance = appearanceState(settings.customization, appearanceDraft)
  if (wanted.has('email') && email) answer.email = await emailSection(email)
  if (wanted.has('sign_in'))
    answer.sign_in = {
      oidc_enabled: oidc.enabled,
      issuer: oidc.issuer,
      client_id: oidc.clientId,
      client_secret_saved: Boolean(raw.general.oidc.clientSecret),
      button_text: oidc.buttonText,
      auto_provision: oidc.autoProvision,
      require_email_verified: oidc.requireEmailVerified,
      enforce_sso: oidc.enforceSso,
    }
  // Head HTML can hold scripts other administrators wrote, and no tool may
  // change either field, so only their presence is shown.
  if (wanted.has('custom_code'))
    answer.custom_code = {
      custom_css_set: Boolean(settings.advanced.customCSS.trim()),
      custom_head_set: Boolean(settings.advanced.customHead.trim()),
    }
  if (wanted.has('setup'))
    answer.setup = compact({
      completed: setup.completed,
      completed_at: iso(setup.completedAt),
    })
  if (wanted.has('mcp'))
    answer.mcp = { enabled: mcp.enabled, administration: mcp.administration }
  return answer
}
