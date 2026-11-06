import { describe, expect, it, vi } from 'vitest'

import {
  PUBLIC_ID_PATTERN,
  isReservedPublicId,
  isUrlIdDraft,
  urlIdSchema,
  vanityIdDraft,
  vanityIdSchema,
} from '@/lib/users/public-id'

// IDs queued here are drawn first; the rest come from the real generator.
const draws = vi.hoisted(() => [] as string[])
vi.mock('nanoid', async (importOriginal) => {
  const nanoid = await importOriginal<typeof import('nanoid')>()
  return {
    ...nanoid,
    customAlphabet: (alphabet: string, size: number) => {
      const draw = nanoid.customAlphabet(alphabet, size)
      return () => draws.shift() ?? draw()
    },
  }
})

const { assertPublicIdsFree, newUrlId } =
  await import('@/lib/users/public-id-claim')

type Holder = { id: string; urlId: string; vanityId: string | null }

/** A transaction in which `accounts` exist. */
function holding(...accounts: Holder[]) {
  const findMany = vi.fn(
    async ({ where }: { where: { OR: [{ urlId: { in: string[] } }] } }) => {
      const ids = where.OR[0].urlId.in
      return accounts.filter(
        (account) =>
          ids.includes(account.urlId) ||
          (account.vanityId !== null && ids.includes(account.vanityId))
      )
    }
  )
  return { tx: { user: { findMany } } as never, findMany }
}

const account = { id: 'editor', urlId: 'aB3x9', vanityId: null }

describe('vanity IDs', () => {
  it('keep letter case and refuse Flare’s routes in any case', () => {
    expect(vanityIdSchema.parse('My-Name')).toBe('My-Name')
    for (const id of ['api', 'API', 'Setup', '_next'])
      expect(vanityIdSchema.safeParse(id).error?.issues[0].message).toBe(
        id === '_next'
          ? 'Vanity URL must start and end with alphanumeric characters and can contain hyphens'
          : 'This URL path is reserved and cannot be used'
      )
    expect(vanityIdSchema.safeParse('ab').error?.issues[0].message).toBe(
      'Vanity URL must be at least 3 characters'
    )
    expect(
      vanityIdSchema.safeParse('a'.repeat(33)).error?.issues[0].message
    ).toBe('Vanity URL must be at most 32 characters')
  })

  it('keep what the field can hold while it is typed, case included', () => {
    expect(vanityIdDraft('My Name!')).toBe('MyName')
    expect(vanityIdDraft('my_name-2')).toBe('myname-2')
    expect(vanityIdDraft('A'.repeat(40))).toBe('A'.repeat(32))
  })

  it('share one path segment rule with URL IDs', () => {
    const segment = new RegExp(`^${PUBLIC_ID_PATTERN}$`)
    for (const id of ['abc', 'aB3x9', 'my-name', 'a'.repeat(32)])
      expect(segment.test(id), id).toBe(true)
    for (const id of ['ab', 'a'.repeat(33), '-abc', 'abc-', 'a_b'])
      expect(segment.test(id), id).toBe(false)
    expect(isReservedPublicId('Dashboard')).toBe(true)
    expect(isReservedPublicId('dashboards')).toBe(false)
  })
})

describe('URL IDs', () => {
  it('keep letter case and refuse Flare’s routes in any case', () => {
    expect(urlIdSchema.parse('aB3x9')).toBe('aB3x9')
    for (const id of ['admin', 'Admin', 'SETUP'])
      expect(urlIdSchema.safeParse(id).error?.issues[0].message).toBe(
        'This URL path is reserved and cannot be used'
      )
    expect(urlIdSchema.safeParse('abc').error?.issues[0].message).toBe(
      'URL ID must be 5 alphanumeric characters'
    )
  })

  it('let the field hold what can still become an ID, leaving reserved ones to the save', () => {
    for (const draft of ['u', 'api', 'auth1', 'admin', 'aB3x9'])
      expect(isUrlIdDraft(draft), draft).toBe(true)
    for (const draft of ['ab-c', 'abcdef'])
      expect(isUrlIdDraft(draft), draft).toBe(false)
  })
})

describe('public ID claims', () => {
  it('refuse a URL ID another account uses as either kind of ID', async () => {
    const asUrlId = holding({ id: 'other', urlId: 'SPECC', vanityId: null })
    await expect(
      assertPublicIdsFree(
        asUrlId.tx,
        { ...account, urlId: 'SPECC' },
        { urlId: true, vanityId: false }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: 'URL ID is already in use',
    })
    const asVanity = holding({ id: 'other', urlId: 'other', vanityId: 'SPECC' })
    await expect(
      assertPublicIdsFree(
        asVanity.tx,
        { ...account, urlId: 'SPECC' },
        { urlId: true, vanityId: false }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: 'This URL ID conflicts with an existing vanity URL',
    })
  })

  it('refuse a vanity ID another account uses as either kind of ID', async () => {
    const asVanity = holding({ id: 'other', urlId: 'other', vanityId: 'mine' })
    await expect(
      assertPublicIdsFree(
        asVanity.tx,
        { ...account, vanityId: 'mine' },
        { urlId: false, vanityId: true }
      )
    ).rejects.toMatchObject({ message: 'This vanity URL is already taken' })
    const asUrlId = holding({ id: 'other', urlId: 'mine', vanityId: null })
    await expect(
      assertPublicIdsFree(
        asUrlId.tx,
        { ...account, vanityId: 'mine' },
        { urlId: false, vanityId: true }
      )
    ).rejects.toMatchObject({
      message: 'This vanity URL conflicts with an existing URL ID',
    })
  })

  it('keep an account’s own URL ID and vanity ID apart', async () => {
    const { tx } = holding({ ...account, vanityId: 'aB3x9' })
    await expect(
      assertPublicIdsFree(
        tx,
        { ...account, vanityId: 'aB3x9' },
        { urlId: false, vanityId: true }
      )
    ).rejects.toMatchObject({
      message: 'This vanity URL conflicts with an existing URL ID',
    })
    await expect(
      assertPublicIdsFree(
        tx,
        { ...account, urlId: 'vanit', vanityId: 'vanit' },
        { urlId: true, vanityId: false }
      )
    ).rejects.toMatchObject({
      message: 'This URL ID conflicts with an existing vanity URL',
    })
  })

  it('allow IDs the account itself holds and query nothing without a claim', async () => {
    const { tx, findMany } = holding({ ...account, vanityId: 'mine' })
    await expect(
      assertPublicIdsFree(
        tx,
        { ...account, vanityId: 'mine' },
        { urlId: false, vanityId: true }
      )
    ).resolves.toBeUndefined()
    findMany.mockClear()
    await assertPublicIdsFree(tx, account, { urlId: false, vanityId: false })
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('new URL IDs', () => {
  it('use letters of both cases and digits without look-alikes', async () => {
    const { tx } = holding()
    const ids = await Promise.all(
      Array.from({ length: 50 }, () => newUrlId(tx))
    )
    for (const id of ids) expect(id).toMatch(/^[2-9A-HJ-NP-Za-km-z]{5}$/)
    const characters = ids.join('')
    expect(characters).toMatch(/[a-z]/)
    expect(characters).toMatch(/[A-Z]/)
    expect(characters).toMatch(/[2-9]/)
  })

  it('skip Flare’s routes and IDs either column holds', async () => {
    draws.push('admin', 'SETUP', 'taken', 'vanit', 'fr33x')
    const { tx, findMany } = holding(
      { id: 'one', urlId: 'taken', vanityId: null },
      { id: 'two', urlId: 'zzzzz', vanityId: 'vanit' }
    )
    expect(await newUrlId(tx)).toBe('fr33x')
    expect(findMany).toHaveBeenCalledTimes(1)
    const queried = findMany.mock.calls[0][0].where.OR[0].urlId.in
    expect(queried).not.toContain('admin')
    expect(queried).not.toContain('SETUP')
    expect(queried.slice(0, 3)).toEqual(['taken', 'vanit', 'fr33x'])
  })

  it('give up after ten taken IDs instead of looping', async () => {
    const taken = Array.from({ length: 10 }, (_, index) => `tkn${index}x`)
    draws.push(...taken)
    const { tx, findMany } = holding(
      ...taken.map((urlId) => ({ id: urlId, urlId, vanityId: null }))
    )
    await expect(newUrlId(tx)).rejects.toThrow(
      'None of 10 new URL IDs was free'
    )
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})
