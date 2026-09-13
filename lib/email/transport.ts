import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'

import type { EmailConfig } from './schema'
import type { RenderedEmail } from './templates'

export interface OutgoingEmail extends RenderedEmail {
  recipient: string
  messageId?: string
}

export interface MailTransport {
  verify(): Promise<void>
  send(message: OutgoingEmail): Promise<void>
  close(): void
}

/** Only this error type may carry an already-sanitized message across API layers. */
export class MailDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailDeliveryError'
  }
}

/** Provider responses may echo credentials or message contents; expose categories only. */
export function describeMailError(error: unknown): string {
  if (error instanceof MailDeliveryError) return error.message
  const failure = error as { code?: string; responseCode?: number }
  if (failure?.code === 'EAUTH')
    return 'SMTP authentication failed. Check the username and password.'
  if (failure?.code === 'ETIMEDOUT') return 'The SMTP server timed out.'
  if (
    failure?.code === 'ECONNECTION' ||
    failure?.code === 'ESOCKET' ||
    failure?.code === 'ECONNREFUSED' ||
    failure?.code === 'EDNS'
  )
    return 'Could not connect securely to the SMTP server. Check the host, port, and connection security.'
  if (failure?.code === 'ETLS' || failure?.code?.includes('CERT'))
    return 'The SMTP TLS handshake failed. Check connection security and the trusted certificate.'
  if (
    typeof failure?.responseCode === 'number' &&
    failure.responseCode >= 500 &&
    failure.responseCode <= 599
  )
    return `The SMTP server rejected the message (${failure.responseCode}). Check sender and recipient settings.`
  if (
    typeof failure?.responseCode === 'number' &&
    failure.responseCode >= 400 &&
    failure.responseCode <= 499
  )
    return `The SMTP server temporarily refused the message (${failure.responseCode}).`
  return 'Email delivery failed. Check the SMTP settings and encryption key.'
}

export function isPermanentMailError(error: unknown): boolean {
  const failure = error as { code?: string; responseCode?: number }
  return (
    failure?.code === 'EAUTH' ||
    (typeof failure?.responseCode === 'number' &&
      failure.responseCode >= 500 &&
      failure.responseCode <= 599)
  )
}

export function createSmtpTransport(config: EmailConfig): MailTransport {
  const { smtp } = config
  const timeout = smtp.timeoutSeconds * 1000
  const options: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.authentication
      ? { user: smtp.username, pass: smtp.password }
      : undefined,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ...(smtp.ca ? { ca: smtp.ca } : {}),
    },
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    dnsTimeout: timeout,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  }
  const transport = nodemailer.createTransport(options)
  return {
    async verify() {
      await transport.verify()
    },
    async send(message) {
      const result = await transport.sendMail({
        from: {
          name: config.fromName || config.branding.instanceName || 'Flare',
          address: config.fromAddress,
        },
        to: { name: '', address: message.recipient },
        replyTo: config.replyTo
          ? { name: '', address: config.replyTo }
          : undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: message.messageId,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
      if (!result.accepted.length) {
        throw Object.assign(new Error('SMTP recipient rejected.'), {
          responseCode: 550,
        })
      }
    },
    close() {
      transport.close()
    },
  }
}

export async function verifySmtp(config: EmailConfig): Promise<void> {
  const transport = createSmtpTransport(config)
  try {
    await transport.verify()
  } finally {
    transport.close()
  }
}

export async function sendMail(
  config: EmailConfig,
  message: OutgoingEmail
): Promise<void> {
  if (!config.enabled) throw new Error('Email delivery is disabled.')
  const transport = createSmtpTransport(config)
  try {
    await transport.send(message)
  } finally {
    transport.close()
  }
}

export async function sendTestEmail(
  config: EmailConfig,
  recipient: string
): Promise<void> {
  const { deliverTestEmail } = await import('./outbox')
  await deliverTestEmail(config, recipient)
}
