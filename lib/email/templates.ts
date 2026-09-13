import type { EmailConfig } from './schema'

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

export type AccountEmailKind =
  | 'verify'
  | 'reset'
  | 'change'
  | 'change_approval'
  | 'password_changed'
  | 'email_changed'
  | 'test'

export interface AccountEmailInput {
  kind: AccountEmailKind
  recipient: string
  url?: string
  username?: string
  oldEmail?: string
  newEmail?: string
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!
  )
}

function safeUrl(value: string): string {
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'Email links must use an HTTP or HTTPS URL without credentials.'
    )
  }
  return url.toString()
}

/** Editable text is escaped; administrators cannot inject active template content. */
export function renderAccountEmail(
  config: EmailConfig,
  input: AccountEmailInput
): RenderedEmail {
  const { branding } = config
  const instance = branding.instanceName || config.fromName || 'Flare'
  const messages: Record<
    AccountEmailKind,
    { subject: string; body: string; action?: string }
  > = {
    verify: {
      subject: branding.verificationSubject || 'Verify your email address',
      body: `Confirm this email address for your ${instance} account. This link can only be used once and will expire.`,
      action: 'Verify email address',
    },
    reset: {
      subject: branding.resetSubject || 'Reset your password',
      body: `A password reset was requested for your ${instance} account. If this was you, use the link below to choose a new password. If you did not request it, you can ignore this email.`,
      action: 'Reset password',
    },
    change: {
      subject: branding.changeSubject || 'Confirm your new email address',
      body: `Confirm this address to use it for your ${instance} account. Your current email address remains active until the change is complete.`,
      action: 'Confirm new email address',
    },
    change_approval: {
      subject: branding.changeSubject || 'Approve your email address change',
      body: `An email address change${input.newEmail ? ` to ${input.newEmail}` : ''} was requested for your ${instance} account. Approve the change only if you requested it and recognize the new address.`,
      action: 'Approve email change',
    },
    password_changed: {
      subject: 'Your password was changed',
      body: `The password for your ${instance} account was changed. Existing browser sessions were signed out. If you did not make this change, contact your instance administrator immediately.`,
    },
    email_changed: {
      subject: 'Your email address was changed',
      body: `The email address for your ${instance} account was changed${input.oldEmail ? ` from ${input.oldEmail}` : ''}. If you did not make this change, contact your instance administrator immediately.`,
    },
    test: {
      subject: 'Email delivery test',
      body: `This test message confirms that ${instance} successfully submitted an email using your configured mail server. Receiving it also confirms delivery to this inbox.`,
    },
  }
  const message = messages[input.kind]
  if (message.action && !input.url)
    throw new Error('An account action email requires a URL.')
  const url = input.url ? safeUrl(input.url) : undefined
  const subject = [branding.subjectPrefix, message.subject]
    .filter(Boolean)
    .join(' ')
    .replace(/[\r\n]/g, ' ')
  const greeting = input.username ? `Hello ${input.username},` : 'Hello,'
  const support = branding.supportAddress
    ? `Need help? Contact ${branding.supportAddress}.`
    : ''
  const text = [
    greeting,
    branding.introText,
    message.body,
    url,
    url ? 'Account links are single-use. Do not share them.' : '',
    support,
    branding.footer,
  ]
    .filter(Boolean)
    .join('\n\n')
  const accent = /^#[0-9a-fA-F]{6}$/.test(branding.accentColor)
    ? branding.accentColor
    : '#f97316'
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(safeUrl(branding.logoUrl))}" alt="${escapeHtml(instance)}" style="max-height:56px;max-width:240px">`
    : ''
  const action =
    url && message.action
      ? `<p style="margin:28px 0"><a href="${escapeHtml(url)}" style="background:${accent};color:#111827;padding:12px 20px;border-radius:8px;display:inline-block;text-decoration:none;font-weight:bold">${escapeHtml(message.action)}</a></p><p style="font-size:12px;word-break:break-all">Or open this link: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`
      : ''
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#171717"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:12px">${logo}<h1 style="font-size:24px">${escapeHtml(instance)}</h1><p>${escapeHtml(greeting)}</p>${branding.introText ? `<p>${escapeHtml(branding.introText)}</p>` : ''}<p style="line-height:1.6">${escapeHtml(message.body)}</p>${action}${url ? '<p style="font-size:12px;color:#666">Account links are single-use. Do not share them.</p>' : ''}${support ? `<p>${escapeHtml(support)}</p>` : ''}${branding.footer ? `<hr style="border:0;border-top:1px solid #e5e5e5"><p style="font-size:12px;color:#666">${escapeHtml(branding.footer)}</p>` : ''}</main></body></html>`
  return { subject, text, html }
}
