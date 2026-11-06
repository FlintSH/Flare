import { auditedModels } from './models'

// Metadata is an allowlist, including at each nested level. New integrations
// must deliberately choose a safe field; raw payloads and errors never pass.
const keys = new Set([
  ...Object.values(auditedModels).flatMap((model) => model?.fields ?? []),
  // Details of database change events.
  'before',
  'beforeObserved',
  'after',
  'changedFields',
  'count',
  'operation',
  'reason',
  'roleIds',
  'settingsKeys',
  'tagName',
  // Details of other events.
  'model',
  'name',
  'fileId',
  'folderId',
  'ownerId',
  'profileId',
  'size',
  'bytes',
  'expiresAt',
  'attempts',
  'retryCount',
  'maxRetries',
  'maxAttempts',
  'type',
  'provider',
  'durationMs',
  'tokenId',
  'sessionId',
  'method',
  'all',
  'current',
  'truncated',
  'eventId',
  'success',
  'authenticationMethod',
  'failureCode',
  'revokedCount',
  'confidence',
  'textLength',
  'authMethod',
  'includesCurrent',
  'ipAddress',
  'userAgent',
  'expiryAction',
  'eventType',
  'retry',
  // Invite redemptions; token values and digests are never recorded.
  'accountId',
  'accountName',
  // Audit retention summaries.
  'retentionDays',
  'cutoff',
  'complete',
])
const safeField = /^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/

export function auditText(value: unknown, limit = 300): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit)
}

export function sanitizeAuditDetails(
  value: unknown,
  depth = 0
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4)
    return {}
  const output: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value).slice(0, 100)) {
    if (!keys.has(key)) continue
    if (field === null || typeof field === 'boolean') output[key] = field
    else if (typeof field === 'number' && Number.isFinite(field))
      output[key] = field
    else if (field instanceof Date) output[key] = field.toISOString()
    else if (typeof field === 'string') output[key] = auditText(field)
    else if (Array.isArray(field)) {
      output[key] = field
        .slice(0, 100)
        .flatMap<string | number | boolean>((item) => {
          if (typeof item === 'string') {
            if (
              (key === 'changedFields' || key === 'settingsKeys') &&
              !safeField.test(item)
            )
              return []
            return [auditText(item)!]
          }
          if (typeof item === 'number' || typeof item === 'boolean')
            return [item]
          return []
        })
    } else if (typeof field === 'object')
      output[key] = sanitizeAuditDetails(field, depth + 1)
  }
  return output
}
