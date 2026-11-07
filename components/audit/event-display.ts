import type { AuditEventView } from '@/lib/audit/types'

const TARGET_LABELS: Record<string, string> = {
  file: 'File',
  folder: 'Folder',
  tag: 'Tag',
  file_tag: 'File tag assignment',
  user: 'Account',
  role: 'Role',
  setting: 'Instance settings',
  invite: 'Invite',
  token: 'API token',
  upload_profile: 'Upload profile',
  webhook: 'Webhook',
  delivery: 'Webhook delivery',
  mail: 'Email',
  link: 'Short link',
  passkey: 'Passkey',
  session: 'Session',
}
const OPERATIONS: Record<string, string> = {
  create: 'creation',
  createMany: 'bulk creation',
  createManyAndReturn: 'bulk creation',
  update: 'update',
  updateMany: 'bulk update',
  updateManyAndReturn: 'bulk update',
  upsert: 'creation or update',
  delete: 'deletion',
  deleteMany: 'bulk deletion',
}
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Sign-in',
  'auth.logout': 'Sign-out',
  'auth.session.revoked': 'Session revocation',
  'auth.sessions.revoked': 'All-session revocation',
  'invite.redeem': 'Invite redemption',
  'ocr.started': 'OCR start',
  'ocr.completed': 'OCR result',
  'ocr.failed': 'OCR failure',
  'storage.deleted': 'Stored file deletion',
  'storage.delete_failed': 'Stored file deletion failure',
  'audit.retention.applied': 'Audit retention',
  'file.expiration.scheduled': 'Expiration scheduling',
  'file.expiration.cancelled': 'Expiration cancellation',
  'file.expiration.applied': 'Expiration processing',
}
const ACRONYMS = new Set([
  'api',
  'csv',
  'http',
  'id',
  'oidc',
  'ocr',
  'sso',
  'url',
])

function words(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[._\s]+/)
    .filter(Boolean)
    .map((word, index, all) => {
      const lower = word.toLowerCase()
      if (ACRONYMS.has(lower) || all[index - 1]?.toLowerCase() === 'http')
        return word.toUpperCase()
      return index === 0
        ? word[0].toUpperCase() + word.slice(1).toLowerCase()
        : lower
    })
    .join(' ')
}

/** Noun labels name the recorded step without claiming a failed write completed. */
export function describeAuditAction(action: string) {
  if (Object.hasOwn(ACTION_LABELS, action)) return ACTION_LABELS[action]
  const [target, operation, ...rest] = action.split('.')
  if (
    !rest.length &&
    Object.hasOwn(TARGET_LABELS, target) &&
    Object.hasOwn(OPERATIONS, operation)
  )
    return `${TARGET_LABELS[target]} ${OPERATIONS[operation]}`
  return words(action)
}

function shortId(value: string) {
  return value.length > 12 ? `…${value.slice(-8)}` : value
}

export function auditActorLabel(
  event: Pick<AuditEventView, 'actorId' | 'actorName' | 'action' | 'category'>
) {
  if (event.actorName?.trim()) return event.actorName
  if (event.actorId) return `Account ${shortId(event.actorId)}`
  if (event.action === 'auth.login') return 'Unauthenticated'
  if (event.category === 'requests') return 'Unauthenticated request'
  return event.category === 'system' ? 'System' : 'Actor not recorded'
}

/** Only already-recorded names, record IDs, route templates and counts are used.
 * Never inspect snapshots for URLs, credentials, submitted addresses or contents.
 */
export function auditTargetSummary(
  event: Pick<
    AuditEventView,
    'targetId' | 'targetName' | 'targetType' | 'route' | 'details'
  >
) {
  const kind = event.targetType
    ? Object.hasOwn(TARGET_LABELS, event.targetType)
      ? TARGET_LABELS[event.targetType]
      : words(event.targetType)
    : 'Target'
  const identifier = event.targetId ? shortId(event.targetId) : ''
  if (event.targetName?.trim())
    return {
      label: event.targetName,
      context: identifier ? `${kind} · ${identifier}` : kind,
    }
  if (identifier) return { label: `${kind} ${identifier}`, context: null }
  const count = event.details.count
  if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
    return {
      label: kind,
      context: `${count} ${count === 1 ? 'record' : 'records'}`,
    }
  if (event.targetType === 'user')
    return { label: 'Account not identified', context: null }
  if (event.route)
    return { label: event.route, context: event.targetType ? kind : null }
  return {
    label: event.targetType ? `${kind} not identified` : 'Instance activity',
    context: null,
  }
}
