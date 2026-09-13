import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { readFileSync } from 'node:fs'

const PREFIX = 'flare-email:v1:'

function encryptionKey(purpose: string): Buffer {
  let dedicated = process.env.FLARE_EMAIL_ENCRYPTION_KEY
  if (process.env.FLARE_EMAIL_ENCRYPTION_KEY_FILE) {
    if (dedicated !== undefined)
      throw new Error(
        'Set only one of FLARE_EMAIL_ENCRYPTION_KEY and FLARE_EMAIL_ENCRYPTION_KEY_FILE.'
      )
    try {
      dedicated = readFileSync(
        process.env.FLARE_EMAIL_ENCRYPTION_KEY_FILE,
        'utf8'
      ).trimEnd()
    } catch {
      throw new Error('Could not read FLARE_EMAIL_ENCRYPTION_KEY_FILE.')
    }
  }
  const secret = dedicated || process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'Email encryption requires FLARE_EMAIL_ENCRYPTION_KEY or NEXTAUTH_SECRET with at least 32 characters.'
    )
  }
  return Buffer.from(
    hkdfSync('sha256', secret, 'flare-email-encryption-v1', purpose, 32)
  )
}

export function assertEmailEncryptionKey(): void {
  encryptionKey('smtp')
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX)
}

/** Random nonces and purpose-specific keys prevent swapping SMTP and outbox data. */
export function encryptSecret(value: string, purpose = 'smtp'): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(purpose), nonce)
  cipher.setAAD(Buffer.from(PREFIX + purpose))
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return (
    PREFIX +
    Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      'base64url'
    )
  )
}

export function decryptSecret(value: string, purpose = 'smtp'): string {
  if (!isEncryptedSecret(value))
    throw new Error('Unrecognized encrypted email value.')
  const payload = Buffer.from(value.slice(PREFIX.length), 'base64url')
  if (payload.length < 28) throw new Error('Invalid encrypted email value.')
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(purpose),
      payload.subarray(0, 12)
    )
    decipher.setAAD(Buffer.from(PREFIX + purpose))
    decipher.setAuthTag(payload.subarray(12, 28))
    return Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error(
      'Unable to decrypt email data. Check the configured email encryption key.'
    )
  }
}
