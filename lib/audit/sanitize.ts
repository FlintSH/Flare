// Metadata is an allowlist, including at each nested level. New integrations
// must deliberately choose a safe field; raw payloads and errors never pass.
const keys = new Set([
  'before',
  'after',
  'changedFields',
  'count',
  'operation',
  'model',
  'reason',
  'name',
  'id',
  'userId',
  'ownerId',
  'fileId',
  'tagId',
  'folderId',
  'parentId',
  'roleIds',
  'permissions',
  'position',
  'systemKey',
  'visibility',
  'mimeType',
  'size',
  'isPaste',
  'isOcrProcessed',
  'ocrConfidence',
  'views',
  'downloads',
  'excluded',
  'enabled',
  'scopes',
  'profileId',
  'expiresAt',
  'revokedAt',
  'attempts',
  'retryCount',
  'maxRetries',
  'maxAttempts',
  'status',
  'type',
  'purpose',
  'key',
  'provider',
  'durationMs',
  'tokenId',
  'sessionId',
  'method',
  'all',
  'current',
  'truncated',
  'settingsKeys',
  'eventId',
  'success',
  'authenticationMethod',
  'failureCode',
  'revokedCount',
  'confidence',
  'textLength',
  'clicks',
  'authMethod',
  'includesCurrent',
  'ipAddress',
  'userAgent',
  'tagName',
  'expiryAction',
  'eventType',
  'retry',
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
