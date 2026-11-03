import { createHash, randomBytes } from 'node:crypto'

import { FILE_REQUEST_TOKEN_PATTERN, SUBMISSION_KEY_PATTERN } from './policy'

/**
 * 144 random bits keep request links short enough to read aloud while staying
 * far beyond online guessing. Like folder share tokens, the owner can copy the
 * link again at any time, so it is stored as issued; replacing it revokes it.
 */
export function createFileRequestToken() {
  return randomBytes(18).toString('base64url')
}

export function isFileRequestToken(value: unknown): value is string {
  return typeof value === 'string' && FILE_REQUEST_TOKEN_PATTERN.test(value)
}

// Submission keys contain 256 random bits, so SHA-256 is a lookup digest for a
// high-entropy secret rather than a password hash.
export function hashSubmissionKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

export function createSubmissionKey() {
  const key = randomBytes(32).toString('base64url')
  return { key, hash: hashSubmissionKey(key) }
}

export function isSubmissionKey(value: unknown): value is string {
  return typeof value === 'string' && SUBMISSION_KEY_PATTERN.test(value)
}
