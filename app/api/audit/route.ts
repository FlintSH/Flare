import type { AuditEvent } from '@prisma/client'

import { AUDIT_UNAVAILABLE, auditPage } from '@/lib/audit/page'
import { auditQuerySchema } from '@/lib/audit/query'
import type { AuditPage } from '@/lib/audit/types'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'

const api = routes('/api/audit', { failure: { message: AUDIT_UNAVAILABLE } })

export const GET = api(
  async (request): Promise<AuditPage<AuditEvent>> => {
    await requireSession(request, ADMIN_PERMISSIONS.readAuditLog)
    const parameters = new URL(request.url).searchParams
    const parsed = auditQuerySchema.safeParse(Object.fromEntries(parameters))
    if (
      !parsed.success ||
      [...parameters.keys()].some((key) => parameters.getAll(key).length > 1)
    )
      throw new HttpError(
        400,
        'Invalid audit filters. Use bounded page/limit values and ISO timestamps with a timezone.'
      )
    return auditPage(parsed.data)
  },
  { audit: { action: 'audit.read', category: 'audit', skipSuccess: true } }
)
