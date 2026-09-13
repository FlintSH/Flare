import net, { type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/email/schema'
import { renderAccountEmail } from '@/lib/email/templates'
import {
  describeMailError,
  isPermanentMailError,
  sendMail,
  verifySmtp,
} from '@/lib/email/transport'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

/** A real local SMTP peer exercises Nodemailer negotiation, envelope and DATA. */
async function smtpFixture(
  options: { rejectRecipient?: number; rejectAuth?: boolean } = {}
) {
  const messages: string[] = []
  const envelopes: string[] = []
  const sockets = new Set<Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.write('220 smtp.flare.test ESMTP\r\n')
    let buffered = ''
    let inData = false
    let message = ''
    socket.on('data', (chunk) => {
      buffered += chunk.toString()
      let end: number
      while ((end = buffered.indexOf('\r\n')) !== -1) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 2)
        if (inData) {
          if (line === '.') {
            messages.push(message)
            message = ''
            inData = false
            socket.write('250 2.0.0 Queued\r\n')
          } else message += line + '\r\n'
          continue
        }
        if (/^(EHLO|HELO)/.test(line))
          socket.write(
            options.rejectAuth
              ? '250-smtp.flare.test\r\n250 AUTH PLAIN\r\n'
              : '250 smtp.flare.test\r\n'
          )
        else if (line.startsWith('AUTH'))
          socket.write('535 5.7.8 Bad credentials\r\n')
        else if (line.startsWith('MAIL FROM')) {
          envelopes.push(line)
          socket.write('250 2.1.0 OK\r\n')
        } else if (line.startsWith('RCPT TO')) {
          envelopes.push(line)
          socket.write(
            options.rejectRecipient
              ? `${options.rejectRecipient} Rejected recipient secret@example.com\r\n`
              : '250 2.1.5 OK\r\n'
          )
        } else if (line === 'DATA') {
          inData = true
          socket.write('354 End with dot\r\n')
        } else if (line === 'QUIT') socket.end('221 Bye\r\n')
        else if (line === 'RSET' || line === 'NOOP') socket.write('250 OK\r\n')
        else socket.write('502 Command not supported\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address() as net.AddressInfo
  const config: EmailConfig = {
    ...structuredClone(DEFAULT_EMAIL_CONFIG),
    enabled: true,
    fromAddress: 'flare@example.com',
    publicUrl: 'https://flare.test',
    smtp: {
      ...DEFAULT_EMAIL_CONFIG.smtp,
      host: '127.0.0.1',
      port: address.port,
      security: 'none',
      authentication: false,
      timeoutSeconds: 3,
    },
  }
  return { config, messages, envelopes }
}

describe('SMTP transport', () => {
  it('verifies an unauthenticated relay and sends both plain text and HTML with the configured envelope', async () => {
    const { config, messages, envelopes } = await smtpFixture()
    await verifySmtp(config)
    expect(messages).toEqual([])
    const rendered = renderAccountEmail(config, {
      kind: 'verify',
      recipient: 'user@example.com',
      url: 'https://flare.test/auth/verify-email?token=one-use-token',
    })
    await sendMail(config, { recipient: 'user@example.com', ...rendered })
    expect(envelopes).toEqual([
      'MAIL FROM:<flare@example.com>',
      'RCPT TO:<user@example.com>',
    ])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Content-Type: multipart/alternative')
    expect(messages[0]).toContain('Content-Type: text/plain')
    expect(messages[0]).toContain('Content-Type: text/html')
    expect(messages[0]).toContain('one-use-token')
  })

  it('distinguishes connection verification from a rejected sender/recipient', async () => {
    const { config } = await smtpFixture({ rejectRecipient: 550 })
    await expect(verifySmtp(config)).resolves.toBeUndefined()
    const error = await sendMail(config, {
      recipient: 'user@example.com',
      subject: 'test',
      text: 'test',
      html: '<p>test</p>',
    }).catch((failure) => failure)
    expect(isPermanentMailError(error)).toBe(true)
    expect(describeMailError(error)).toContain('(550)')
    expect(describeMailError(error)).not.toContain('secret@example.com')
  })

  it('keeps temporary SMTP failures retryable', async () => {
    const { config } = await smtpFixture({ rejectRecipient: 450 })
    const error = await sendMail(config, {
      recipient: 'user@example.com',
      subject: 'test',
      text: 'test',
      html: '<p>test</p>',
    }).catch((failure) => failure)
    expect(isPermanentMailError(error)).toBe(false)
    expect(describeMailError(error)).toContain('temporarily')
  })

  it('fails closed when required STARTTLS is unsupported and reports rejected authentication safely', async () => {
    const relay = await smtpFixture()
    relay.config.smtp.security = 'starttls'
    await expect(verifySmtp(relay.config)).rejects.toThrow()
    expect(relay.messages).toEqual([])
    const authenticated = await smtpFixture({ rejectAuth: true })
    authenticated.config.smtp.authentication = true
    authenticated.config.smtp.username = 'test-user'
    authenticated.config.smtp.password = 'never-log-this-password'
    const error = await verifySmtp(authenticated.config).catch(
      (failure) => failure
    )
    expect(describeMailError(error)).toContain('authentication failed')
    expect(describeMailError(error)).not.toContain('never-log-this-password')
  })

  it('does not connect or send while disabled', async () => {
    const { config, messages, envelopes } = await smtpFixture()
    config.enabled = false
    await expect(
      sendMail(config, {
        recipient: 'user@example.com',
        subject: 'test',
        text: 'test',
        html: 'test',
      })
    ).rejects.toThrow('disabled')
    expect(envelopes).toEqual([])
    expect(messages).toEqual([])
  })
})

describe('account email templates', () => {
  it('escapes configurable text and rejects active link protocols', () => {
    const config = structuredClone(DEFAULT_EMAIL_CONFIG)
    config.branding.instanceName = '<script>alert(1)</script>'
    config.branding.introText = '<img src=x onerror=alert(1)>'
    config.branding.subjectPrefix = 'Example\r\nBcc: attacker@example.com'
    const rendered = renderAccountEmail(config, {
      kind: 'verify',
      recipient: 'user@example.com',
      username: '<b>name</b>',
      url: 'https://flare.test/verify?token=token&next=account',
    })
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).not.toContain('<img src=x')
    expect(rendered.html).toContain('&lt;b&gt;name&lt;/b&gt;')
    expect(rendered.html).toContain('token=token&amp;next=account')
    expect(rendered.subject).not.toMatch(/[\r\n]/)
    expect(() =>
      renderAccountEmail(config, {
        kind: 'verify',
        recipient: 'user@example.com',
        url: 'javascript:alert(1)',
      })
    ).toThrow('HTTP or HTTPS')
  })
})
