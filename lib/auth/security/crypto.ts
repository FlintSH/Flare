import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { Secret, TOTP } from 'otpauth'

export function securityHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function encryptionKey() {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 32)
    throw new Error('Authentication secret unavailable.')
  return Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      'flare-account-security-v1',
      'totp-encryption',
      32
    )
  )
}

export function encryptTotp(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptTotp(value: string) {
  const [version, iv, tag, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext)
    throw new Error('Invalid encrypted authenticator.')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function createTotp(
  secret = new Secret({ size: 20 }).base32,
  label = 'Flare account'
) {
  return new TOTP({
    issuer: 'Flare',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  })
}

/** The counter, rather than the six-digit string, is the replay boundary. */
export function totpCounter(secret: string, token: string, now = Date.now()) {
  if (!/^\d{6}$/.test(token)) return null
  const delta = createTotp(secret).validate({
    token,
    timestamp: now,
    window: 1,
  })
  return delta === null ? null : Math.floor(now / 30000) + delta
}

export function newRecoveryCodes() {
  return Array.from({ length: 10 }, () =>
    randomBytes(10)
      .toString('hex')
      .match(/.{1,5}/g)!
      .join('-')
  )
}

export function recoveryHash(userId: string, code: string) {
  return securityHash(
    `flare-recovery-v1:${userId}:${code.replace(/[\s-]/g, '').toLowerCase()}`
  )
}

export function webauthnUserId(userId: string) {
  return new Uint8Array(
    createHash('sha256').update(`flare-webauthn-user-v1:${userId}`).digest()
  )
}
