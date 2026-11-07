import { describe, expect, it } from 'vitest'

import {
  auditActorLabel,
  auditTargetSummary,
  describeAuditAction,
} from '@/components/audit/event-display'

import type { AuditEventView } from '@/lib/audit/types'

type Target = Parameters<typeof auditTargetSummary>[0]
const target = (changes: Partial<Target> = {}): Target => ({
  targetType: 'link',
  targetId: 'record-unique-12345678',
  targetName: null,
  route: null,
  details: {},
  ...changes,
})
const actor = (changes: Partial<AuditEventView> = {}) => ({
  actorName: null,
  actorId: null,
  category: 'authentication',
  action: 'auth.login',
  ...changes,
})

describe('audit display context', () => {
  it('distinguishes unnamed short links by safe record-ID suffix without inventing a destination', () => {
    expect(auditTargetSummary(target())).toEqual({
      label: 'Short link …12345678',
      context: null,
    })
    expect(
      auditTargetSummary(target({ targetId: 'record-unique-87654321' })).label
    ).toBe('Short link …87654321')
  })

  it('retains recorded names and distinguishes their type and identifier', () => {
    expect(
      auditTargetSummary(
        target({ targetName: 'quarterly-report.txt', targetType: 'file' })
      )
    ).toEqual({ label: 'quarterly-report.txt', context: 'File · …12345678' })
    expect(auditTargetSummary(target({ targetName: 'AbC123' })).label).toBe(
      'AbC123'
    )
  })

  it('does not pretend an unresolved sign-in is a system actor or a known account', () => {
    expect(auditActorLabel(actor())).toBe('Unauthenticated')
    expect(
      auditTargetSummary(target({ targetType: 'user', targetId: null }))
    ).toEqual({ label: 'Account not identified', context: null })
    expect(
      auditActorLabel(
        actor({ actorId: 'account-12345678', action: 'user.update' })
      )
    ).toBe('Account …12345678')
    expect(
      auditActorLabel(actor({ category: 'accounts', action: 'user.update' }))
    ).toBe('Actor not recorded')
    expect(
      auditActorLabel(
        actor({ category: 'system', action: 'audit.retention.applied' })
      )
    ).toBe('System')
  })

  it('uses only recorded target context and counts, never snapshot URLs or credential-like fields', () => {
    const event = target({
      targetId: null,
      details: {
        after: {
          targetUrl: 'https://private.example.test',
          password: 'do-not-display',
          token: 'do-not-display',
        },
        count: 2,
      },
    })
    const before = structuredClone(event)
    expect(auditTargetSummary(event)).toEqual({
      label: 'Short link',
      context: '2 records',
    })
    expect(JSON.stringify(auditTargetSummary(event))).not.toMatch(
      /private|password|token|do-not-display/
    )
    expect(event).toEqual(before)
    expect(
      auditTargetSummary(
        target({ targetId: null, details: { count: -1 }, route: '/api/urls' })
      )
    ).toEqual({ label: '/api/urls', context: 'Short link' })
  })

  it('names the operation without describing a failed attempt as completed', () => {
    expect(describeAuditAction('auth.login')).toBe('Sign-in')
    expect(describeAuditAction('user.update')).toBe('Account update')
    expect(describeAuditAction('link.create')).toBe('Short link creation')
    expect(describeAuditAction('link.delete')).toBe('Short link deletion')
    expect(describeAuditAction('file_tag.deleteMany')).toBe(
      'File tag assignment bulk deletion'
    )
    expect(describeAuditAction('ocr.completed')).toBe('OCR result')
  })

  it('keeps unknown actions readable without treating prototype names as labels', () => {
    expect(describeAuditAction('http.get')).toBe('HTTP GET')
    expect(describeAuditAction('custom.verifyThing')).toBe(
      'Custom verify thing'
    )
    expect(describeAuditAction('toString')).toBe('To string')
    expect(
      auditTargetSummary(target({ targetType: 'constructor' })).label
    ).toBe('Constructor …12345678')
  })
})
