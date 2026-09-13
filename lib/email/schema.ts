import { z } from 'zod'

import defaults from './defaults.json'

const line = z
  .string()
  .trim()
  .max(255)
  .refine((v) => !/[\r\n\0]/.test(v), 'Use a single line')
const address = z.union([z.literal(''), z.string().trim().email().max(254)])
const webUrl = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const url = new URL(value)
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search
      )
    }, 'Use an HTTP(S) URL without credentials, query, or fragment'),
])
const date = z.string().datetime().nullable()

// Browser-safe schema and shared JSON defaults also consumed by startup migration.
export const emailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  smtp: z
    .object({
      host: line.default(''),
      port: z.number().int().min(1).max(65535).default(465),
      security: z.enum(['tls', 'starttls', 'none']).default('tls'),
      authentication: z.boolean().default(true),
      username: line.default(''),
      password: z.string().max(16384).default(''),
      ca: z.string().max(65536).default(''),
      timeoutSeconds: z.number().int().min(3).max(120).default(15),
    })
    .default({}),
  fromName: line.default('Flare'),
  fromAddress: address.default(''),
  replyTo: address.default(''),
  publicUrl: webUrl.default(''),
  recovery: z
    .object({
      enabled: z.boolean().default(false),
      tokenMinutes: z.number().int().min(5).max(120).default(30),
      rotateUploadToken: z.boolean().default(false),
    })
    .default({}),
  verification: z
    .object({
      mode: z
        .enum(['off', 'optional', 'new_users', 'all_users'])
        .default('off'),
      appliedMode: z
        .enum(['off', 'optional', 'new_users', 'all_users'])
        .default('off'),
      requiredSince: date.default(null),
      graceDays: z.number().int().min(0).max(90).default(7),
      graceEndsAt: date.default(null),
      adminCreated: z.enum(['inherit', 'exempt']).default('inherit'),
      trustOidc: z.boolean().default(false),
      tokenHours: z.number().int().min(1).max(168).default(24),
    })
    .default({}),
  changes: z
    .object({
      enabled: z.boolean().default(true),
      requireOldEmail: z.boolean().default(false),
    })
    .default({}),
  limits: z
    .object({
      resendSeconds: z.number().int().min(30).max(3600).default(60),
      addressPerHour: z.number().int().min(1).max(100).default(5),
      ipPerHour: z.number().int().min(1).max(1000).default(20),
      dailyLimit: z.number().int().min(1).max(100000).default(500),
    })
    .default({}),
  delivery: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(3),
      retrySeconds: z.number().int().min(10).max(3600).default(60),
      concurrency: z.number().int().min(1).max(10).default(2),
      retentionDays: z.number().int().min(1).max(90).default(14),
    })
    .default({}),
  branding: z
    .object({
      instanceName: line.default('Flare'),
      logoUrl: webUrl.default(''),
      accentColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default('#6366f1'),
      footer: z.string().max(2000).default(''),
      supportAddress: address.default(''),
      subjectPrefix: line.default(''),
      verificationSubject: line
        .refine((value) => value.length > 0, 'Subject is required')
        .default('Verify your email address'),
      resetSubject: line
        .refine((value) => value.length > 0, 'Subject is required')
        .default('Reset your password'),
      changeSubject: line
        .refine((value) => value.length > 0, 'Subject is required')
        .default('Confirm your new email address'),
      introText: z.string().max(2000).default(''),
    })
    .default({}),
})

export type EmailConfig = z.infer<typeof emailConfigSchema>
export const DEFAULT_EMAIL_CONFIG: EmailConfig =
  emailConfigSchema.parse(defaults)

export function validateEnabledEmail(config: EmailConfig): void {
  if (!config.enabled) return
  if (!config.smtp.host || !config.fromAddress || !config.publicUrl) {
    throw new Error(
      'SMTP host, sender address, and public instance URL are required to enable email'
    )
  }
  if (
    config.smtp.authentication &&
    (!config.smtp.username || !config.smtp.password)
  ) {
    throw new Error(
      'SMTP username and password are required when authentication is enabled'
    )
  }
  const url = new URL(config.publicUrl)
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'Use HTTPS for account email links (HTTP is allowed on localhost for testing)'
    )
  }
}
