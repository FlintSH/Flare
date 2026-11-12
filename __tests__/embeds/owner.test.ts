import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { ownerEmbed } from '@/lib/embeds/owner'
import { DEFAULT_PERSONAL_EMBED } from '@/lib/embeds/schema'

const mocks = vi.hoisted(() => ({ access: vi.fn() }))
vi.mock('@/lib/permissions/server', () => ({ getUserAccess: mocks.access }))

const { sharing } = DEFAULT_APPEARANCE
const file = (embed?: object) => ({
  userId: 'owner-id',
  user: { preferences: embed ? { embed } : {} },
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockResolvedValue({ roles: [], permissions: ['files.share'] })
})

describe("an owner's own embed", () => {
  it('applies while their roles let them choose one', async () => {
    expect(await ownerEmbed(file({ mode: 'rich' }), sharing)).toEqual({
      ...DEFAULT_PERSONAL_EMBED,
      mode: 'rich',
    })
    expect(mocks.access).toHaveBeenCalledWith('owner-id')
  })

  it('stops applying the moment the permission is taken away', async () => {
    mocks.access.mockResolvedValue({ roles: [], permissions: ['files.read'] })
    expect(
      await ownerEmbed(file({ mode: 'rich', design: 'custom' }), sharing)
    ).toBeNull()
  })

  it('is not looked up for an account that follows the instance', async () => {
    expect(await ownerEmbed(file(), sharing)).toBeNull()
    // Lines saved and then switched off again choose nothing.
    expect(await ownerEmbed(file({ title: 'Mine' }), sharing)).toBeNull()
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('never applies while the instance uses one embed for everyone', async () => {
    expect(
      await ownerEmbed(file({ mode: 'rich' }), {
        ...sharing,
        personalEmbeds: false,
      })
    ).toBeNull()
    expect(mocks.access).not.toHaveBeenCalled()
  })
})
