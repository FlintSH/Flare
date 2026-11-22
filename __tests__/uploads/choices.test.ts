import { describe, expect, it } from 'vitest'

import {
  NO_CHOICES,
  effectiveUpload,
  expiryLabel,
  expiryProblem,
  permittedAction,
  profileSummary,
  uploadOptionsFor,
} from '@/lib/uploads/choices'
import { UPLOAD_DEFAULTS } from '@/lib/uploads/schema'

const saved = {
  ...UPLOAD_DEFAULTS,
  visibility: 'PUBLIC' as const,
  expiration: 'WEEK' as const,
  expiryAction: 'DELETE' as const,
  tagIds: ['tag-a'],
}

describe('what an upload comes to', () => {
  it('is the saved settings when nothing is picked', () => {
    const effective = effectiveUpload(saved, NO_CHOICES, true)
    expect(effective).toMatchObject({
      visibility: 'PUBLIC',
      expiry: { kind: 'after', after: 'WEEK' },
      expiryAction: 'DELETE',
      tagIds: ['tag-a'],
      picked: { visibility: false, expiry: false, tags: false },
    })
  })

  it('takes each pick over the saved value, and says so', () => {
    const effective = effectiveUpload(
      saved,
      {
        ...NO_CHOICES,
        visibility: 'PRIVATE',
        expiry: { kind: 'never' },
        tagIds: [],
      },
      true
    )
    expect(effective).toMatchObject({
      visibility: 'PRIVATE',
      expiry: { kind: 'never' },
      tagIds: [],
      picked: { visibility: true, expiry: true, tags: true },
    })
  })

  it('counts a changed action alone as a picked expiration', () => {
    const effective = effectiveUpload(
      saved,
      { ...NO_CHOICES, expiryAction: 'SET_PRIVATE' },
      true
    )
    expect(effective.expiry).toEqual({ kind: 'after', after: 'WEEK' })
    expect(effective.expiryAction).toBe('SET_PRIVATE')
    expect(effective.picked.expiry).toBe(true)
  })

  it('is private for a role that cannot share, whatever is picked', () => {
    const effective = effectiveUpload(
      saved,
      { ...NO_CHOICES, visibility: 'PUBLIC' },
      false
    )
    expect(effective.visibility).toBe('PRIVATE')
    expect(effective.picked.visibility).toBe(false)
  })
})

describe('what an upload sends', () => {
  it('sends only what was picked, so the rest stays saved', () => {
    expect(uploadOptionsFor(NO_CHOICES)).toEqual({
      profileId: undefined,
      folderId: null,
      visibility: undefined,
      password: undefined,
      expiryAction: undefined,
      tagIds: undefined,
    })
  })

  it('sends a time after the upload for a preset, for the server to count', () => {
    const options = uploadOptionsFor({
      ...NO_CHOICES,
      expiry: { kind: 'after', after: 'DAY' },
    })
    expect(options.expiration).toBe('DAY')
    expect(options).not.toHaveProperty('expiresAt')
  })

  it('sends an explicit null for Never and a date for a picked moment', () => {
    expect(
      uploadOptionsFor({ ...NO_CHOICES, expiry: { kind: 'never' } })
    ).toMatchObject({ expiresAt: null })
    const at = new Date('2026-12-01T12:00:00Z')
    expect(
      uploadOptionsFor({ ...NO_CHOICES, expiry: { kind: 'at', at } })
    ).toMatchObject({ expiresAt: at })
  })

  it('sends picked tags, including none', () => {
    expect(uploadOptionsFor({ ...NO_CHOICES, tagIds: [] }).tagIds).toEqual([])
  })
})

describe('expiration and profile wording', () => {
  it.each([
    [{ kind: 'never' } as const, 'DELETE' as const, 'Never expires'],
    [
      { kind: 'after', after: 'DAY' } as const,
      'DELETE' as const,
      'Deleted after 1 day',
    ],
    [
      { kind: 'after', after: 'MONTH' } as const,
      'SET_PRIVATE' as const,
      'Private after 1 month',
    ],
  ])('names %j then %s as %j', (expiry, action, label) => {
    expect(expiryLabel(expiry, action)).toBe(label)
  })

  it('names a picked moment with its date', () => {
    expect(
      expiryLabel({ kind: 'at', at: new Date(2026, 11, 1, 15, 0) }, 'DELETE')
    ).toBe('Deleted Dec 1, 3:00 PM')
  })

  it('sums up a profile, filename choice and share page included', () => {
    expect(profileSummary({ ...saved, randomizeFileUrls: true }, true)).toEqual(
      ['Public', 'deleted after 1 week', 'random names', '1 tag', 'Framed page']
    )
    expect(profileSummary(saved, false)[0]).toBe('Private')
  })
})

describe('an expiration the role can carry out', () => {
  const only =
    (...allowed: string[]) =>
    (action: string) =>
      allowed.includes(action)

  it('keeps a permitted action and swaps a forbidden one for the other', () => {
    expect(permittedAction('DELETE', only('DELETE', 'SET_PRIVATE'))).toBe(
      'DELETE'
    )
    expect(permittedAction('DELETE', only('SET_PRIVATE'))).toBe('SET_PRIVATE')
    expect(permittedAction('SET_PRIVATE', only('DELETE'))).toBe('DELETE')
    expect(permittedAction('DELETE', only())).toBeNull()
  })

  it('flags a saved expiration the role cannot carry out, before uploading', () => {
    const after = { kind: 'after', after: 'DAY' } as const
    expect(
      expiryProblem({ expiry: after, expiryAction: 'DELETE' }, only('DELETE'))
    ).toBeNull()
    expect(
      expiryProblem(
        { expiry: { kind: 'never' }, expiryAction: 'DELETE' },
        only()
      )
    ).toBeNull()
    expect(
      expiryProblem(
        { expiry: after, expiryAction: 'DELETE' },
        only('SET_PRIVATE')
      )
    ).toMatch(/can’t delete files.*Make it private or Never/)
    expect(
      expiryProblem({ expiry: after, expiryAction: 'SET_PRIVATE' }, only())
    ).toMatch(/can’t schedule expirations.*Never/)
  })
})
