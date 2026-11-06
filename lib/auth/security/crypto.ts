import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { Secret, TOTP } from 'otpauth'

import { SECURITY_CODE_MAX_LENGTH, TOTP_DIGITS, isTotpCode } from './policy'

const TOTP_PERIOD_SECONDS = 30
// Recovery codes are random bytes written in hex, in groups for reading.
const RECOVERY_CODE_BYTES = 10
const PASSKEY_RECOVERY_CODE_BYTES = 16

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
  const [version, iv, tag, ciphertext, extra] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined)
    throw new Error('Invalid encrypted authenticator.')
  const ivBytes = Buffer.from(iv, 'base64url')
  const tagBytes = Buffer.from(tag, 'base64url')
  if (ivBytes.length !== 12 || tagBytes.length !== 16)
    throw new Error('Invalid encrypted authenticator.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), ivBytes, {
    authTagLength: 16,
  })
  decipher.setAuthTag(tagBytes)
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
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret,
  })
}

/** The counter, rather than the code itself, is the replay boundary. */
export function totpCounter(secret: string, token: string, now = Date.now()) {
  if (!isTotpCode(token)) return null
  const delta = createTotp(secret).validate({
    token,
    timestamp: now,
    window: 1,
  })
  return delta === null
    ? null
    : Math.floor(now / (TOTP_PERIOD_SECONDS * 1000)) + delta
}

function newCodes(bytes: number, group: number) {
  return Array.from({ length: 10 }, () =>
    randomBytes(bytes)
      .toString('hex')
      .match(new RegExp(`.{1,${group}}`, 'g'))!
      .join('-')
  )
}

/** A recovery code as it is hashed: without spaces or hyphens, in lower case. */
export function normalizeRecoveryCode(code: string) {
  return code.replace(/[\s-]/g, '').toLowerCase()
}

export function newRecoveryCodes() {
  return newCodes(RECOVERY_CODE_BYTES, 5)
}

/** Whether a second-factor code is written as a recovery code, not an authenticator code. */
export function isRecoveryCodeInput(code: string) {
  return new RegExp(
    `^[a-f0-9\\s-]{${RECOVERY_CODE_BYTES * 2},${SECURITY_CODE_MAX_LENGTH}}$`,
    'i'
  ).test(code)
}

export function recoveryHash(userId: string, code: string) {
  return securityHash(
    `flare-recovery-v1:${userId}:${normalizeRecoveryCode(code)}`
  )
}

export function newPasskeyRecoveryCodes() {
  return newCodes(PASSKEY_RECOVERY_CODE_BYTES, 8)
}

/** Whether a normalized code has the passkey recovery format. */
export function isPasskeyRecoveryCode(normalized: string) {
  return new RegExp(`^[a-f0-9]{${PASSKEY_RECOVERY_CODE_BYTES * 2}}$`).test(
    normalized
  )
}

export function passkeyRecoveryHash(userId: string, code: string) {
  return securityHash(
    `flare-passkey-recovery-v1:${userId}:${normalizeRecoveryCode(code)}`
  )
}

export function webauthnUserId(userId: string) {
  return new Uint8Array(
    createHash('sha256').update(`flare-webauthn-user-v1:${userId}`).digest()
  )
}
