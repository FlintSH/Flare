import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { auditedModels } from '@/lib/audit/models'
import { sanitizeAuditDetails } from '@/lib/audit/sanitize'

const audited = Object.values(auditedModels).flatMap((model) =>
  model ? [model] : []
)

describe('the audited model map', () => {
  it('decides for every model in the schema whether its writes are audited', () => {
    expect(Object.keys(auditedModels).sort()).toEqual(
      Object.values(Prisma.ModelName).sort()
    )
    expect(auditedModels.AuditEvent).toBeNull()
  })

  it('keeps every snapshot field in recorded details', () => {
    for (const { fields } of audited) {
      const snapshot = Object.fromEntries(fields.map((field) => [field, 1]))
      expect(
        sanitizeAuditDetails({ before: snapshot, after: snapshot })
      ).toEqual({ before: snapshot, after: snapshot })
    }
  })

  it('names events after the column or relation each model is known by', () => {
    const name = (model: Prisma.ModelName, row: Record<string, unknown>) =>
      auditedModels[model]?.name?.(row) ?? row.name
    expect(name('File', { name: 'invoice.pdf' })).toBe('invoice.pdf')
    expect(name('Invite', { note: 'Team' })).toBe('Team')
    expect(name('Invite', { note: '' })).toBeUndefined()
    expect(name('Config', { key: 'flare_config' })).toBe('flare_config')
    expect(name('VaultFileTag', { file: { name: 'receipt.pdf' } })).toBe(
      'receipt.pdf'
    )
  })

  it.each(['WebhookDelivery', 'MailOutbox'] as const)(
    'treats a %s write that records a failure, but not a cancellation, as failed',
    (model) => {
      const failed = auditedModels[model]!.failed!
      expect(failed({ status: 'failed' })).toBe(true)
      expect(failed({ status: 'pending', lastError: 'Timed out' })).toBe(true)
      expect(failed({ status: 'cancelled', lastError: 'Disabled' })).toBe(false)
      expect(failed({ status: 'sent', lastError: '' })).toBe(false)
    }
  )
})
