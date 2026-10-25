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

type Bucket = {
  resetAt: number
  failures: Set<string>
  /** Checks admitted but still comparing, by attempt, with a count of copies. */
  pending: Map<string, number>
}
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

// A keyed digest of a non-secret value, such as a client address, so the
// value itself is never kept in the maps below.
function digest(label: string, value: string) {
  return createHmac('sha256', state.key)
    .update(`${label}\0${value}`)
    .digest('base64url')
}

// Submitted passwords and stored hashes go only through a memory-hard KDF,
// never a fast hash. These parameters take about 2 ms, far less than the
// bcrypt check they save; `salt` comes from non-secret context.
const PASSWORD_KDF: ScryptOptions = { N: 1024, r: 8, p: 1 }

function kdf(secret: string, salt: string) {
  return new Promise<string>((resolve, reject) =>
    scrypt(secret, Buffer.from(salt), 32, PASSWORD_KDF, (error, key) =>
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

function ensureBucket(key: string, now: number) {
  let bucket = liveBucket(key, now)
  if (!bucket) {
    makeRoom(now)
    bucket = {
      resetAt: now + FILE_PASSWORD_ATTEMPTS.windowMs,
      failures: new Set(),
      pending: new Map(),
    }
    state.buckets.set(key, bucket)
  }
  return bucket
}

function scopes(fileId: string, requester: string | null) {
  const list: { key: string; limit: number }[] = [
    { key: fileKey(fileId), limit: FILE_PASSWORD_ATTEMPTS.perFile },
  ]
  if (requester)
    list.push({
      key: requesterKey(fileId, requester),
      limit: FILE_PASSWORD_ATTEMPTS.perRequester,
    })
  return list
}

function retryAfter(resetAt: number, now: number) {
  return { retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) }
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
  for (const { key, limit } of scopes(fileId, requester)) {
    const bucket = liveBucket(key, now)
    if (bucket && bucket.failures.size >= limit)
      resetAt = Math.max(resetAt, bucket.resetAt)
  }
  return resetAt ? retryAfter(resetAt, now) : null
}

/** Identifies one submitted password for one file, without keeping it. */
export function filePasswordAttempt(fileId: string, password: string) {
  return kdf(password, digest('attempt', fileId))
}

export type FilePasswordAdmission =
  | { admitted: false; retryAfterSeconds: number }
  | { admitted: true; settle(correct: boolean): void }

/**
 * Admit one password comparison. A full window pauses every check, even the
 * right password. Checks still comparing count against the allowance, so a
 * burst of different guesses can't all start before any of them has failed;
 * concurrent copies of one password count once. Call `settle` exactly once.
 */
export function admitFilePasswordAttempt(
  fileId: string,
  requester: string | null,
  attempt: string,
  now = Date.now()
): FilePasswordAdmission {
  const limits = scopes(fileId, requester)
  let resetAt = 0
  for (const { key, limit } of limits) {
    const bucket = liveBucket(key, now)
    if (!bucket) continue
    let used = bucket.failures.size
    for (const pending of bucket.pending.keys())
      if (!bucket.failures.has(pending)) used++
    const known = bucket.failures.has(attempt) || bucket.pending.has(attempt)
    if (bucket.failures.size >= limit || (!known && used >= limit))
      resetAt = Math.max(resetAt, bucket.resetAt)
  }
  if (resetAt) return { admitted: false, ...retryAfter(resetAt, now) }

  for (const { key } of limits) {
    const bucket = ensureBucket(key, now)
    bucket.pending.set(attempt, (bucket.pending.get(attempt) ?? 0) + 1)
  }
  let settled = false
  return {
    admitted: true,
    settle(correct) {
      if (settled) return
      settled = true
      const at = Date.now()
      for (const { key, limit } of limits) {
        const bucket = state.buckets.get(key)
        if (bucket) {
          const remaining = (bucket.pending.get(attempt) ?? 1) - 1
          if (remaining > 0) bucket.pending.set(attempt, remaining)
          else bucket.pending.delete(attempt)
        }
        if (!correct) {
          const live = ensureBucket(key, at)
          if (live.failures.size < limit) live.failures.add(attempt)
        }
      }
      if (correct) clearFilePasswordFailures(fileId, requester)
    },
  }
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
  return kdf(
    `${password}\0${hash}`,
    digest('verified', `${fileId}\0${requester ?? ''}`)
  )
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
