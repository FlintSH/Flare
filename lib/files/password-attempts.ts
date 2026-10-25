import {
  type ScryptOptions,
  createHmac,
  randomBytes,
  scrypt,
} from 'node:crypto'

/**
 * Incorrect file passwords per window. Only distinct wrong passwords count:
 * guessing needs new candidates, while a visitor retrying the same typo, a
 * page that checks a submitted password twice, or a media player repeating a
 * range request with it should not lock anyone out.
 */
export const FILE_PASSWORD_ATTEMPTS = {
  windowMs: 15 * 60_000,
  /** One client address guessing at one file. */
  perRequester: 10,
  /** Everyone guessing at one file, which bounds rotating addresses. */
  perFile: 100,
} as const

/** Correct passwords are remembered briefly so media ranges skip bcrypt. */
const VERIFIED_TTL_MS = 10 * 60_000
const MAX_VERIFIED = 1_000
const MAX_BUCKETS = 10_000

type Bucket = { resetAt: number; failures: Set<string> }
type State = {
  key: Buffer
  buckets: Map<string, Bucket>
  verified: Map<string, number>
}

// One process-wide state, whichever route bundle loads this module first.
const stateKey = Symbol.for('flare.files.password-attempts')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const state = (processState[stateKey] ??= {
  key: randomBytes(32),
  buckets: new Map(),
  verified: new Map(),
}) as State

// Keyed digests keep raw passwords and client addresses out of memory maps.
function digest(...parts: string[]) {
  return createHmac('sha256', state.key)
    .update(parts.join('\0'))
    .digest('base64url')
}

// Submitted passwords go through a memory-hard KDF rather than a fast hash.
// These parameters take about 2 ms, far less than the bcrypt check they save.
const PASSWORD_KDF: ScryptOptions = { N: 1024, r: 8, p: 1 }

function passwordDigest(password: string, ...context: string[]) {
  return new Promise<string>((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(digest('password', ...context)),
      32,
      PASSWORD_KDF,
      (error, key) =>
        error ? reject(error) : resolve(key.toString('base64url'))
    )
  )
}

const fileKey = (fileId: string) => `file:${fileId}`
const requesterKey = (fileId: string, requester: string) =>
  `requester:${fileId}:${digest('requester', requester)}`

function liveBucket(key: string, now: number) {
  const bucket = state.buckets.get(key)
  if (bucket && bucket.resetAt <= now) {
    state.buckets.delete(key)
    return undefined
  }
  return bucket
}

function makeRoom(now: number) {
  if (state.buckets.size < MAX_BUCKETS) return
  for (const [key, bucket] of state.buckets)
    if (bucket.resetAt <= now) state.buckets.delete(key)
  // Oldest windows go first; they are also the closest to expiring.
  for (const key of state.buckets.keys()) {
    if (state.buckets.size < MAX_BUCKETS) break
    state.buckets.delete(key)
  }
}

function addFailure(key: string, attempt: string, limit: number, now: number) {
  let bucket = liveBucket(key, now)
  if (!bucket) {
    makeRoom(now)
    bucket = {
      resetAt: now + FILE_PASSWORD_ATTEMPTS.windowMs,
      failures: new Set(),
    }
    state.buckets.set(key, bucket)
  }
  if (bucket.failures.size < limit) bucket.failures.add(attempt)
}

/**
 * Whether new password checks for this file are paused. `requester` is the
 * client address; without one, only the per-file budget applies.
 */
export function filePasswordBlock(
  fileId: string,
  requester: string | null,
  now = Date.now()
): { retryAfterSeconds: number } | null {
  let resetAt = 0
  const file = liveBucket(fileKey(fileId), now)
  if (file && file.failures.size >= FILE_PASSWORD_ATTEMPTS.perFile)
    resetAt = file.resetAt
  if (requester) {
    const own = liveBucket(requesterKey(fileId, requester), now)
    if (own && own.failures.size >= FILE_PASSWORD_ATTEMPTS.perRequester)
      resetAt = Math.max(resetAt, own.resetAt)
  }
  return resetAt
    ? { retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) }
    : null
}

export async function recordFilePasswordFailure(
  fileId: string,
  requester: string | null,
  password: string,
  now = Date.now()
) {
  const attempt = await passwordDigest(password, 'attempt', fileId)
  addFailure(fileKey(fileId), attempt, FILE_PASSWORD_ATTEMPTS.perFile, now)
  if (requester)
    addFailure(
      requesterKey(fileId, requester),
      attempt,
      FILE_PASSWORD_ATTEMPTS.perRequester,
      now
    )
}

/** A correct password clears that client's own failures, not the file's. */
export function clearFilePasswordFailures(
  fileId: string,
  requester: string | null
) {
  if (requester) state.buckets.delete(requesterKey(fileId, requester))
}

// The stored hash is part of the key, so changing or removing the file's
// password stops earlier verifications from matching. So is the client
// address: a remembered success must not answer guesses from anyone else.
export function verifiedFilePasswordKey(
  fileId: string,
  hash: string,
  password: string,
  requester: string | null
) {
  return passwordDigest(password, 'verified', fileId, hash, requester ?? '')
}

export function isVerifiedFilePassword(key: string, now = Date.now()) {
  const expiresAt = state.verified.get(key)
  if (expiresAt === undefined) return false
  if (expiresAt > now) return true
  state.verified.delete(key)
  return false
}

export function rememberVerifiedFilePassword(key: string, now = Date.now()) {
  state.verified.delete(key)
  state.verified.set(key, now + VERIFIED_TTL_MS)
  for (const oldest of state.verified.keys()) {
    if (state.verified.size <= MAX_VERIFIED) break
    state.verified.delete(oldest)
  }
}
