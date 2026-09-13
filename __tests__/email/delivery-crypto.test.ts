import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertEmailEncryptionKey,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '@/lib/email/crypto'

afterEach(() => vi.unstubAllEnvs())

describe('email secret storage', () => {
  it('needs no encryption key until encryption is used', () => {
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    vi.stubEnv('NEXTAUTH_SECRET', '')
    expect(isEncryptedSecret('')).toBe(false)
    expect(() => assertEmailEncryptionKey()).toThrow('at least 32 characters')
  })

  it('uses random authenticated ciphertext and rejects changed or cross-purpose payloads', () => {
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'test-key-that-is-stable-and-at-least-32-chars'
    )
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    const value = 'https://flare.test/auth/verify-email?token=secret-token'
    const encrypted = encryptSecret(value, 'outbox')
    expect(encrypted).not.toContain(value)
    expect(encryptSecret(value, 'outbox')).not.toBe(encrypted)
    expect(decryptSecret(encrypted, 'outbox')).toBe(value)
    expect(() => decryptSecret(encrypted, 'smtp')).toThrow('Unable to decrypt')
    const tampered = encrypted.slice(0, -8) + 'AAAAAAAA'
    expect(() => decryptSecret(tampered, 'outbox')).toThrow('Unable to decrypt')
  })

  it('uses the dedicated key when set and rejects key rotation without silently treating data as plaintext', () => {
    vi.stubEnv(
      'FLARE_EMAIL_ENCRYPTION_KEY',
      'dedicated-email-key-stable-at-least-32-chars'
    )
    vi.stubEnv('NEXTAUTH_SECRET', 'original-session-secret-at-least-32-chars')
    const encrypted = encryptSecret('smtp-password')
    vi.stubEnv('NEXTAUTH_SECRET', 'rotated-session-secret-at-least-32-chars')
    expect(decryptSecret(encrypted)).toBe('smtp-password')
    vi.stubEnv(
      'FLARE_EMAIL_ENCRYPTION_KEY',
      'rotated-email-key-stable-at-least-32-chars'
    )
    expect(() => decryptSecret(encrypted)).toThrow('Unable to decrypt')
    expect(() => decryptSecret('smtp-password')).toThrow('Unrecognized')
  })

  it('supports a mounted encryption secret without exposing the file path on read errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'flare-email-key-'))
    const path = join(directory, 'key')
    try {
      writeFileSync(path, 'mounted-secret-key-with-at-least-32-characters\n')
      vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', undefined)
      vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY_FILE', path)
      const encrypted = encryptSecret('password')
      expect(decryptSecret(encrypted)).toBe('password')
      vi.stubEnv(
        'FLARE_EMAIL_ENCRYPTION_KEY',
        'duplicate-key-with-at-least-32-characters'
      )
      expect(() => assertEmailEncryptionKey()).toThrow('Set only one')
      vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', undefined)
      vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY_FILE', join(directory, 'missing'))
      expect(() => assertEmailEncryptionKey()).toThrow(
        'Could not read FLARE_EMAIL_ENCRYPTION_KEY_FILE.'
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
