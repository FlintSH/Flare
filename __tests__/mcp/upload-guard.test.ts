import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG } from '@/lib/config'
import { ToolError } from '@/lib/mcp/tool'
import {
  type UploadState,
  inheritedChanges,
  uploadChanges,
  uploadCheck,
  uploadOutcomes,
} from '@/lib/mcp/upload-guard'

// The owner's role, as the check reads it in the transaction.
const owner = vi.hoisted(() => ({ shares: true }))
vi.mock('@/lib/permissions/server', () => ({
  getUserAccess: async () => ({
    roles: [],
    permissions: owner.shares ? ['files.share'] : [],
  }),
}))
beforeEach(() => {
  owner.shares = true
})

const config = structuredClone(DEFAULT_CONFIG)

const state = (
  account: Partial<UploadState['account']>,
  profiles: UploadState['profiles'] = [],
  defaultProfileId: string | null = null
): UploadState => ({
  account: {
    randomizeFileUrls: false,
    defaultFileExpiration: 'DISABLED',
    defaultFileExpirationAction: 'DELETE',
    ...account,
  },
  defaultProfileId,
  profiles,
  canShare: true,
})

/** Each way of uploading with what its expiry does, by path key. */
const outcomes = (of: UploadState) =>
  Object.fromEntries(
    [...uploadOutcomes(of, config)].map(([key, { outcome }]) => [key, outcome])
  )

describe('what each way of uploading does when its expiry runs', () => {
  it('follows the account alone without profiles', () => {
    expect(outcomes(state({}))).toEqual({ default: null, account: null })
    expect(
      outcomes(
        state({
          defaultFileExpiration: 'DAY',
          defaultFileExpirationAction: 'SET_PRIVATE',
        })
      )
    ).toEqual({ default: 'SET_PRIVATE', account: 'SET_PRIVATE' })
  })

  it('lays each profile over the account, as an upload does', () => {
    const profiles = [
      { id: 'own', name: 'Own', options: { expiration: 'HOUR' as const } },
      {
        id: 'action',
        name: 'Action',
        options: { expiryAction: 'SET_PRIVATE' as const },
      },
      { id: 'off', name: 'Off', options: { expiration: 'DISABLED' as const } },
      { id: 'none', name: 'None', options: { visibility: 'PRIVATE' as const } },
    ]
    expect(outcomes(state({}, profiles))).toEqual({
      default: null,
      account: null,
      // A length of its own, with the account's action.
      'profile:own': 'DELETE',
      // An action waits for a length.
      'profile:action': null,
      'profile:off': null,
      'profile:none': null,
    })
    expect(
      outcomes(state({ defaultFileExpiration: 'WEEK' }, profiles, 'off'))
    ).toEqual({
      // Uploads that name no profile use the default one.
      default: null,
      account: 'DELETE',
      'profile:own': 'DELETE',
      'profile:action': 'SET_PRIVATE',
      'profile:off': null,
      'profile:none': 'DELETE',
    })
  })

  it('takes a default that names a missing profile as uploads that are refused', () => {
    expect(
      outcomes(state({ defaultFileExpiration: 'WEEK' }, [], 'gone')).default
    ).toBeNull()
  })
})

describe('what a change turns into deleting or hiding', () => {
  const keep = {
    id: 'keep',
    name: 'Keep',
    options: { expiration: 'DISABLED' as const },
  }

  it('names every path that starts to delete or hide, and no other', () => {
    const before = state({ defaultFileExpirationAction: 'SET_PRIVATE' }, [
      { id: 'temp', name: 'Temp', options: { expiryAction: 'DELETE' } },
      keep,
    ])
    const after = {
      ...before,
      account: { ...before.account, defaultFileExpiration: 'HOUR' as const },
    }
    const changes = uploadChanges(before, after, config)
    expect(changes.DELETE).toEqual([
      { kind: 'profile', id: 'temp', name: 'Temp' },
    ])
    expect(changes.SET_PRIVATE).toEqual([
      { kind: 'default' },
      { kind: 'account' },
    ])
  })

  it('compares a new profile with what uploads did without it, the account alone', () => {
    const before = state({ defaultFileExpiration: 'WEEK' })
    const adding = (options: UploadState['profiles'][number]['options']) =>
      uploadChanges(
        before,
        { ...before, profiles: [{ id: '', name: 'New', options }] },
        config
      )
    // Only inheriting, or never expiring, changes nothing.
    for (const options of [
      {},
      { tagIds: ['t'] },
      { expiration: 'DISABLED' as const },
    ])
      expect(adding(options)).toEqual({
        DELETE: [],
        SET_PRIVATE: [],
        PUBLIC: [],
      })
    // Another length, or another action, does.
    expect(adding({ expiration: 'DAY' }).DELETE).toEqual([
      { kind: 'profile', id: '', name: 'New' },
    ])
    expect(adding({ expiryAction: 'SET_PRIVATE' }).SET_PRIVATE).toEqual([
      { kind: 'profile', id: '', name: 'New' },
    ])
    // Against an account that never expires, its own expiry is new.
    const off = state({})
    expect(
      uploadChanges(
        off,
        {
          ...off,
          profiles: [{ id: '', name: 'New', options: { expiration: 'DAY' } }],
        },
        config
      ).DELETE
    ).toEqual([{ kind: 'profile', id: '', name: 'New' }])
  })

  it('takes a profile still to be created as the default by its empty ID', () => {
    const before = state({ defaultFileExpiration: 'WEEK' })
    const after = {
      ...before,
      defaultProfileId: '',
      profiles: [
        { id: '', name: 'New', options: { expiration: 'DAY' as const } },
      ],
    }
    expect(uploadChanges(before, after, config).DELETE).toEqual([
      { kind: 'default' },
      { kind: 'profile', id: '', name: 'New' },
    ])
  })

  it('sees a default profile taken away as a change to uploads that name none', () => {
    const before = state({ defaultFileExpiration: 'HOUR' }, [keep], 'keep')
    const after = { ...before, defaultProfileId: null, profiles: [] }
    expect(uploadChanges(before, after, config)).toEqual({
      DELETE: [{ kind: 'default' }],
      SET_PRIVATE: [],
      PUBLIC: [],
    })
  })

  it('finds nothing in a change that leaves every outcome as it was', () => {
    const before = state({ defaultFileExpiration: 'WEEK' }, [keep], 'keep')
    for (const after of [
      { ...before, profiles: [{ ...keep, name: 'Renamed' }] },
      // Stopping is never a change that needs anything.
      {
        ...before,
        account: {
          ...before.account,
          defaultFileExpiration: 'DISABLED' as const,
        },
      },
    ])
      expect(uploadChanges(before, after, config)).toEqual({
        DELETE: [],
        SET_PRIVATE: [],
        PUBLIC: [],
      })
  })

  it('counts a new length on a path that already deletes or hides', () => {
    const before = state({ defaultFileExpiration: 'WEEK' })
    const sooner = {
      ...before,
      account: { ...before.account, defaultFileExpiration: 'DAY' as const },
    }
    expect(uploadChanges(before, sooner, config)).toEqual({
      DELETE: [{ kind: 'default' }, { kind: 'account' }],
      SET_PRIVATE: [],
      PUBLIC: [],
    })
    expect(uploadChanges(before, before, config)).toEqual({
      DELETE: [],
      SET_PRIVATE: [],
      PUBLIC: [],
    })
  })

  it('sees a path that switches from hiding to deleting', () => {
    const before = state({
      defaultFileExpiration: 'DAY',
      defaultFileExpirationAction: 'SET_PRIVATE',
    })
    const after = {
      ...before,
      account: {
        ...before.account,
        defaultFileExpirationAction: 'DELETE' as const,
      },
    }
    expect(uploadChanges(before, after, config).DELETE).toEqual([
      { kind: 'default' },
      { kind: 'account' },
    ])
  })
})

describe('the check a service runs', () => {
  /** A transaction that holds `of`, as `readUploadState` reads it. */
  const transaction = (of: UploadState) =>
    ({
      user: {
        findUnique: async () => ({
          ...of.account,
          defaultUploadProfileId: of.defaultProfileId,
        }),
      },
      uploadProfile: { findMany: async () => of.profiles },
    }) as never

  const context = (allowed: string[]) => ({
    principal: { user: { id: 'owner' } } as never,
    requireEffect(effect: string) {
      if (!allowed.includes(effect))
        throw new ToolError(`Not allowed: ${effect}.`, 'denied')
    },
  })
  const EFFECTS = { DELETE: 'delete', SET_PRIVATE: 'hide' }
  const on = (of: UploadState) => ({
    ...of,
    account: { ...of.account, defaultFileExpiration: 'HOUR' as const },
  })

  it('passes what needs nothing, and what the call may do', async () => {
    const off = state({})
    await uploadCheck(context([]), EFFECTS, config, (s) => s)(transaction(off))
    // A new length needs what either action needs: see below.
    await uploadCheck(
      context(['delete', 'hide']),
      EFFECTS,
      config,
      on
    )(transaction(off))
  })

  describe('for uploads that bring half of an expiry themselves', () => {
    // A profile that makes private and sets no length, on an account whose
    // own action deletes. Nothing expires by itself on any path.
    const temp = (options: UploadState['profiles'][number]['options']) =>
      state({}, [{ id: 't', name: 'Temp', options }])
    const held = temp({ expiration: 'DISABLED', expiryAction: 'SET_PRIVATE' })
    /** The profile leaves its action to the account. */
    const unheld = () => temp({ expiration: 'DISABLED' })
    const refusal = (
      allowed: string[],
      change: (s: UploadState) => UploadState,
      of = held
    ) =>
      uploadCheck(
        context(allowed),
        EFFECTS,
        config,
        change
      )(transaction(of)).then(
        () => 'passed',
        (thrown: ToolError) => thrown.message
      )

    it('refuses an action taken out of a profile so that the account action deletes, though no length is saved', async () => {
      // Neither state deletes anything by itself, so the outcomes are equal.
      expect(uploadChanges(held, unheld(), config)).toEqual({
        DELETE: [],
        SET_PRIVATE: [],
        PUBLIC: [],
      })
      // An upload with the profile that brings its own expiry is deleted
      // where it was made private.
      expect(await refusal(['hide'], unheld)).toBe(
        'Uploads with the profile "Temp" that set an expiry of their own would be deleted when it runs out. Not allowed: delete.'
      )
      expect(await refusal(['delete'], unheld)).toBe('passed')
    })

    it('asks for what making private needs when the action turns that way', async () => {
      const deleting = temp({ expiration: 'DISABLED', expiryAction: 'DELETE' })
      const hides = () =>
        temp({ expiration: 'DISABLED', expiryAction: 'SET_PRIVATE' })
      expect(await refusal(['delete'], hides, deleting)).toBe(
        'Uploads with the profile "Temp" that set an expiry of their own would be made private when it runs out. Not allowed: hide.'
      )
      expect(await refusal(['hide'], hides, deleting)).toBe('passed')
    })

    it('refuses a new length without what both actions need, for uploads that name an action themselves', async () => {
      const hiding = state({ defaultFileExpirationAction: 'SET_PRIVATE' })
      // The saved action makes private, so that is asked for first.
      expect(await refusal(['delete'], on, hiding)).toBe(
        'Uploads that name no profile or `none` would be made private when they expire. Not allowed: hide.'
      )
      // An upload that names `delete` and no expiry takes the new length.
      expect(await refusal(['hide'], on, hiding)).toBe(
        'Uploads that name no profile or `none` that ask to be deleted when they expire would be deleted after the new time. Not allowed: delete.'
      )
      expect(await refusal(['delete', 'hide'], on, hiding)).toBe('passed')
      // And the other way round, over a saved action that deletes.
      expect(await refusal(['delete'], on, state({}))).toBe(
        'Uploads that name no profile or `none` that ask to be made private when they expire would be made private after the new time. Not allowed: hide.'
      )
    })

    it('needs nothing to turn a length off, or to leave the action and the length as they are', async () => {
      const timed = state({ defaultFileExpiration: 'WEEK' })
      const never = (s: UploadState): UploadState => ({
        ...s,
        account: { ...s.account, defaultFileExpiration: 'DISABLED' },
      })
      expect(await refusal([], never, timed)).toBe('passed')
      const renamed = (s: UploadState): UploadState => ({
        ...s,
        profiles: s.profiles.map((profile) => ({ ...profile, name: 'Other' })),
      })
      expect(await refusal([], renamed)).toBe('passed')
    })
  })

  describe('inheritedChanges', () => {
    const TEMP = { kind: 'profile', id: 't', name: 'Temp' }
    const profile = (options: UploadState['profiles'][number]['options']) => [
      { id: 't', name: 'Temp', options },
    ]

    it('names the ways of uploading whose saved action becomes another, by the new action', () => {
      const before = state({}, profile({ expiryAction: 'SET_PRIVATE' }))
      expect(inheritedChanges(before, state({}, profile({})), config)).toEqual({
        action: { DELETE: [TEMP], SET_PRIVATE: [] },
        length: [],
      })
      // The account's action reaches every path that leaves it to the account.
      expect(
        inheritedChanges(
          state({}, profile({})),
          state({ defaultFileExpirationAction: 'SET_PRIVATE' }, profile({})),
          config
        ).action
      ).toEqual({
        DELETE: [],
        SET_PRIVATE: [{ kind: 'default' }, { kind: 'account' }, TEMP],
      })
    })

    it('names the ways whose saved length becomes another that is not never', () => {
      const before = state({}, profile({ expiration: 'DAY' }))
      const after = state(
        { defaultFileExpiration: 'WEEK' },
        profile({ expiration: 'DAY' })
      )
      // The profile keeps its own day; the other two take the week.
      expect(inheritedChanges(before, after, config).length).toEqual([
        { kind: 'default' },
        { kind: 'account' },
      ])
      // Back to never needs nothing, and neither does the same length.
      expect(inheritedChanges(after, before, config).length).toEqual([])
      expect(inheritedChanges(after, after, config)).toEqual({
        action: { DELETE: [], SET_PRIVATE: [] },
        length: [],
      })
    })

    it('compares a new profile with the account as it was, and follows the default profile', () => {
      const before = state({ defaultFileExpirationAction: 'SET_PRIVATE' })
      const created = state(
        { defaultFileExpirationAction: 'SET_PRIVATE' },
        profile({ expiryAction: 'DELETE', expiration: 'HOUR' })
      )
      expect(inheritedChanges(before, created, config)).toEqual({
        action: { DELETE: [TEMP], SET_PRIVATE: [] },
        length: [TEMP],
      })
      // One that only inherits changes nothing.
      expect(
        inheritedChanges(
          before,
          state({ defaultFileExpirationAction: 'SET_PRIVATE' }, profile({})),
          config
        )
      ).toEqual({ action: { DELETE: [], SET_PRIVATE: [] }, length: [] })
      // Made the default, its action and length reach uploads that name none.
      expect(
        inheritedChanges(created, { ...created, defaultProfileId: 't' }, config)
      ).toEqual({
        action: { DELETE: [{ kind: 'default' }], SET_PRIVATE: [] },
        length: [{ kind: 'default' }],
      })
    })
  })

  it('refuses in the words of the paths, with the missing effect after them', async () => {
    const check = uploadCheck(context(['hide']), EFFECTS, config, on)
    const error = await check(
      transaction(
        state({ defaultFileExpirationAction: 'SET_PRIVATE' }, [
          { id: 'a', name: 'A', options: { expiryAction: 'DELETE' } },
          { id: 'b', name: 'B', options: { expiryAction: 'DELETE' } },
        ])
      )
    ).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as ToolError).outcome).toBe('denied')
    expect((error as ToolError).message).toBe(
      'Uploads with the profile "A" and uploads with the profile "B" would be deleted when they expire. Not allowed: delete.'
    )
  })

  it('judges hiding as well as deleting', async () => {
    const check = uploadCheck(context(['delete']), EFFECTS, config, on)
    await expect(
      check(transaction(state({ defaultFileExpirationAction: 'SET_PRIVATE' })))
    ).rejects.toThrow(
      'Uploads that name no profile or `none` would be made private when they expire. Not allowed: hide.'
    )
  })

  it('passes on what is not a refusal', async () => {
    const failing = {
      principal: { user: { id: 'owner' } } as never,
      requireEffect() {
        throw new Error('broken')
      },
    }
    await expect(
      uploadCheck(failing, EFFECTS, config, on)(transaction(state({})))
    ).rejects.toThrow('broken')
  })
})

describe('whether later uploads are public', () => {
  const visibility = (of: UploadState) =>
    Object.fromEntries(
      [...uploadOutcomes(of, config)].map(([key, path]) => [
        key,
        path.visibility,
      ])
    )
  const hidden = {
    id: 'hidden',
    name: 'Hidden',
    options: { visibility: 'PRIVATE' as const },
  }
  const open = { id: 'open', name: 'Open', options: {} }

  it('takes public for what no setting makes private, as uploads do', () => {
    expect(visibility(state({}, [hidden, open], 'hidden'))).toEqual({
      default: 'PRIVATE',
      account: 'PUBLIC',
      'profile:hidden': 'PRIVATE',
      'profile:open': 'PUBLIC',
    })
  })

  it('makes every path private for a role that may not share', () => {
    expect(
      visibility({ ...state({}, [hidden, open]), canShare: false })
    ).toEqual({
      default: 'PRIVATE',
      account: 'PRIVATE',
      'profile:hidden': 'PRIVATE',
      'profile:open': 'PRIVATE',
    })
    const before = { ...state({}, [hidden], 'hidden'), canShare: false }
    expect(
      uploadChanges(before, { ...before, defaultProfileId: null }, config)
        .PUBLIC
    ).toEqual([])
  })

  it('finds paths that go from private to public, and no other', () => {
    const before = state({}, [hidden, open], 'hidden')
    // Handing the default back to the account publishes those uploads.
    expect(
      uploadChanges(before, { ...before, defaultProfileId: null }, config)
    ).toEqual({ DELETE: [], SET_PRIVATE: [], PUBLIC: [{ kind: 'default' }] })
    // Public to private, and private to private, are no such change.
    expect(
      uploadChanges(
        before,
        {
          ...before,
          defaultProfileId: 'open',
          profiles: [hidden, { ...open, options: { visibility: 'PRIVATE' } }],
        },
        config
      ).PUBLIC
    ).toEqual([])
  })

  it('compares a new profile with the account as it was', () => {
    const before = state({}, [hidden], 'hidden')
    const adding = { ...before, profiles: [hidden, { ...open, id: '' }] }
    // Uploads that name `none` were public already.
    expect(uploadChanges(before, adding, config).PUBLIC).toEqual([])
    // As the default, it publishes uploads that name no profile.
    expect(
      uploadChanges(before, { ...adding, defaultProfileId: '' }, config).PUBLIC
    ).toEqual([{ kind: 'default' }])
  })
})

describe('the check, for visibility', () => {
  const transaction = (of: UploadState) =>
    ({
      user: {
        findUnique: async () => ({
          ...of.account,
          defaultUploadProfileId: of.defaultProfileId,
        }),
      },
      uploadProfile: { findMany: async () => of.profiles },
    }) as never
  const context = (allowed: string[]) => ({
    principal: { user: { id: 'owner' } } as never,
    requireEffect(effect: string) {
      if (!allowed.includes(effect))
        throw new ToolError(`Not allowed: ${effect}.`, 'denied')
    },
  })
  const hidden = {
    id: 'hidden',
    name: 'Hidden',
    options: { visibility: 'PRIVATE' as const },
  }
  const unhide = (of: UploadState) => ({ ...of, defaultProfileId: null })
  const effects = { DELETE: 'delete', SET_PRIVATE: 'hide', PUBLIC: 'share' }

  it("refuses a path made public without the effect, in the paths' words", async () => {
    await expect(
      uploadCheck(
        context([]),
        effects,
        config,
        unhide
      )(transaction(state({}, [hidden], 'hidden')))
    ).rejects.toThrow(
      'Uploads that name no profile would be public. Not allowed: share.'
    )
    await uploadCheck(
      context(['share']),
      effects,
      config,
      unhide
    )(transaction(state({}, [hidden], 'hidden')))
  })

  it("reads the owner's role in the transaction", async () => {
    owner.shares = false
    await uploadCheck(
      context([]),
      effects,
      config,
      unhide
    )(transaction(state({}, [hidden], 'hidden')))
  })

  it('fails loudly for a tool that names no effect for publishing', async () => {
    await expect(
      uploadCheck(
        context([]),
        { DELETE: 'delete', SET_PRIVATE: 'hide' },
        config,
        unhide
      )(transaction(state({}, [hidden], 'hidden')))
    ).rejects.toThrow('This tool has no effect for a change to PUBLIC')
  })
})
