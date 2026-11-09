import type { Prisma } from '@prisma/client'

type Row = Record<string, unknown>

/** How writes to one model become audit events. */
export interface AuditedModel {
  category: string
  /** The events' `targetType`, and the start of their action, such as `file.update`. */
  target: string
  /** Columns copied into `before` and `after` snapshots. */
  fields: readonly string[]
  /**
   * Request counters. Each view, download, or click already records its
   * request outcome, so an update that only increments these is not a
   * separate change event.
   */
  counters?: readonly string[]
  /** Columns identifying a row, when it has no `id`. The first is the event's target ID. */
  keys?: readonly string[]
  /** Read for the event itself; never copied into snapshots. */
  select?: Row
  /**
   * Role assignments are part of the record: single-row writes read its role
   * IDs into the snapshots, and requested assignments are recorded as `roleIds`.
   */
  roles?: true
  /** The event's target name, when it isn't the `name` column. */
  name?: (row: Row) => unknown
  /** Details for an event about `row`, the record a write returned or deleted. */
  details?: (row: Row, before: Row | undefined, operation: string) => Row
  /** Whether a write's data records a failed attempt, which makes its event a failure. */
  failed?: (data: Row) => boolean
}

/** Values are compared only in memory; configuration values never enter the log. */
function changedSettings(
  before: unknown,
  after: unknown,
  prefix = '',
  depth = 0
): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (!after || typeof after !== 'object' || Array.isArray(after) || depth >= 5)
    return prefix ? [prefix] : []
  const previous = before && typeof before === 'object' ? (before as Row) : {}
  return Array.from(
    new Set([...Object.keys(previous), ...Object.keys(after)])
  ).flatMap((key) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,70}$/.test(key)) return []
    return changedSettings(
      previous[key],
      (after as Row)[key],
      prefix ? `${prefix}.${key}` : key,
      depth + 1
    )
  })
}

function deliveryFailed(data: Row) {
  return (
    data.status === 'failed' ||
    (data.status !== 'cancelled' &&
      typeof data.lastError === 'string' &&
      data.lastError.length > 0)
  )
}

/**
 * Every model, and whether and how its writes are audited. A model added to
 * the schema doesn't compile until it has an entry here.
 */
export const auditedModels: Record<Prisma.ModelName, AuditedModel | null> = {
  File: {
    category: 'files',
    target: 'file',
    fields: [
      'id',
      'name',
      'userId',
      'mimeType',
      'size',
      'visibility',
      'folderId',
      'isPaste',
      'isOcrProcessed',
      'ocrConfidence',
      'views',
      'downloads',
    ],
    counters: ['views', 'downloads'],
  },
  VaultFolder: {
    category: 'folders',
    target: 'folder',
    fields: ['id', 'name', 'userId', 'parentId'],
  },
  VaultTag: {
    category: 'tags',
    target: 'tag',
    fields: ['id', 'name', 'userId'],
  },
  VaultFileTag: {
    category: 'tags',
    target: 'file_tag',
    fields: ['fileId', 'tagId', 'excluded'],
    keys: ['fileId', 'tagId'],
    select: {
      file: { select: { name: true } },
      tag: { select: { name: true } },
    },
    name: (row) => (row.file as Row | undefined)?.name,
    details: (row) =>
      typeof (row.tag as Row | undefined)?.name === 'string'
        ? { tagName: (row.tag as Row).name }
        : {},
  },
  User: {
    category: 'accounts',
    target: 'user',
    fields: ['id', 'name'],
    roles: true,
  },
  Role: {
    category: 'roles',
    target: 'role',
    fields: ['id', 'name', 'permissions', 'position', 'systemKey'],
  },
  Config: {
    category: 'settings',
    target: 'setting',
    fields: ['id', 'key'],
    // Used only to find the changed key paths, never copied into details.
    select: { value: true },
    name: (row) => row.key,
    details: (row, before, operation) =>
      operation.startsWith('delete')
        ? {}
        : { settingsKeys: changedSettings(before?.value, row.value) },
  },
  // Token values and their digests never enter audit details.
  Invite: {
    category: 'invites',
    target: 'invite',
    fields: [
      'id',
      'note',
      'creatorId',
      'maxUses',
      'uses',
      'expiresAt',
      'revokedAt',
    ],
    name: (row) => row.note || undefined,
  },
  ApiToken: {
    category: 'tokens',
    target: 'token',
    fields: ['id', 'name', 'userId', 'scopes', 'expiresAt', 'revokedAt'],
  },
  UploadProfile: {
    category: 'profiles',
    target: 'upload_profile',
    fields: ['id', 'name', 'userId'],
  },
  Webhook: {
    category: 'webhooks',
    target: 'webhook',
    fields: ['id', 'name', 'userId', 'enabled'],
  },
  WebhookDelivery: {
    category: 'webhooks',
    target: 'delivery',
    fields: ['id', 'eventId', 'status', 'attempts'],
    failed: deliveryFailed,
  },
  MailOutbox: {
    category: 'email',
    target: 'mail',
    fields: ['id', 'userId', 'purpose', 'status', 'attempts'],
    failed: deliveryFailed,
  },
  ShortenedUrl: {
    category: 'links',
    target: 'link',
    fields: ['id', 'userId', 'clicks'],
    counters: ['clicks'],
  },
  Passkey: {
    category: 'authentication',
    target: 'passkey',
    fields: ['id', 'name', 'userId'],
  },
  // Not audited. Credentials and sign-in challenges stay out of the log, and
  // rate limits are counters. Sign-ins, sessions, storage cleanup and file
  // expiry jobs record their own events. The search index is derived from
  // files and rewritten by its worker; OCR records its own events. Nothing
  // writes event handlers any more, and the log doesn't record writes to itself.
  RecoveryCode: null,
  PasskeyRecoveryCode: null,
  EmailToken: null,
  AuthChallenge: null,
  AuthRateLimit: null,
  EmailRateLimit: null,
  LoginAttempt: null,
  BrowserSession: null,
  StorageDeletion: null,
  FileSearchIndex: null,
  Event: null,
  EventHandler: null,
  AuditEvent: null,
}
