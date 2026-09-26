import type { S3Config } from './types'

/** Nonsecret identity captured from the provider which actually writes bytes. */
export type StorageTarget =
  | { provider: 'local' }
  | {
      provider: 's3'
      bucket: string
      region: string
      endpoint: string
      forcePathStyle: boolean
    }

export function s3StorageTarget(
  s3: Pick<S3Config, 'bucket' | 'region' | 'endpoint' | 'forcePathStyle'>
): Extract<StorageTarget, { provider: 's3' }> {
  return {
    provider: 's3',
    bucket: s3.bucket,
    region: s3.region,
    endpoint: s3.endpoint ?? '',
    forcePathStyle: s3.forcePathStyle ?? false,
  }
}

/** Null represents historical provenance that cannot safely be guessed. */
export function parseStorageTarget(value: unknown): StorageTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Record<string, unknown>
  if (target.provider === 'local') return { provider: 'local' }
  if (
    target.provider !== 's3' ||
    typeof target.bucket !== 'string' ||
    !target.bucket ||
    typeof target.region !== 'string' ||
    !target.region ||
    typeof target.endpoint !== 'string' ||
    typeof target.forcePathStyle !== 'boolean'
  )
    return null
  return {
    provider: 's3',
    bucket: target.bucket,
    region: target.region,
    endpoint: target.endpoint,
    forcePathStyle: target.forcePathStyle,
  }
}

export function sameStorageTarget(
  left: StorageTarget,
  right: StorageTarget
): boolean {
  if (left.provider !== right.provider) return false
  if (left.provider === 'local' || right.provider === 'local') return true
  return (
    left.bucket === right.bucket &&
    left.region === right.region &&
    left.endpoint === right.endpoint &&
    left.forcePathStyle === right.forcePathStyle
  )
}

export function captureStorageTarget(storage: {
  kind: 'local' | 's3'
  target: unknown
}): StorageTarget {
  const target = parseStorageTarget(storage.target)
  if (!target || target.provider !== storage.kind)
    throw new Error('Storage provider did not supply its actual target')
  return target
}
