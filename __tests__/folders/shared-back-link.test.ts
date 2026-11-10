import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sharedFolderBackLink } from '@/lib/folders/shared'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findFirst: vi.fn() }))

vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    vaultFolder: { findUnique: mocks.findUnique, findFirst: mocks.findFirst },
  },
}))

const token = 'abcdefghijklmnopqrstuvwxyz012345'
const file = { folderId: 'folder-1', visibility: 'PUBLIC' }
const origin = 'http://localhost:3000'

const plain = {
  parentId: null,
  userId: 'owner',
  folderPublicKey: null,
  sealedFolderMetadata: null,
  parentFolderStanza: null,
  parentStanzaPublicKey: null,
  rekeyPending: false,
}
const root = { ...plain, id: 'folder-1', name: 'Travel journal' }
/** Folders below the shared one, by ID. */
let below: Record<string, object> = {}

beforeEach(() => {
  below = {}
  mocks.findUnique.mockReset()
  mocks.findUnique.mockImplementation(
    async ({ where }: { where: { shareToken: string } }) =>
      where.shareToken === token ? root : null
  )
  mocks.findFirst.mockReset()
  mocks.findFirst.mockImplementation(
    async ({ where }: { where: { id: string } }) => below[where.id] ?? null
  )
})

describe('sharedFolderBackLink', () => {
  it('links back to the shared folder page the visitor came from', async () => {
    await expect(
      sharedFolderBackLink(file, `${origin}/s/folders/${token}?page=3`)
    ).resolves.toEqual({
      href: `/s/folders/${token}?page=3`,
      label: 'Travel journal',
    })
    await expect(
      sharedFolderBackLink(file, `${origin}/s/folders/${token}`)
    ).resolves.toEqual({
      href: `/s/folders/${token}`,
      label: 'Travel journal',
    })
  })

  it('returns to the first page from a protected file page', async () => {
    await expect(
      sharedFolderBackLink(
        file,
        `${origin}/s/folders/${token}/files/file-1?page=4`
      )
    ).resolves.toEqual({
      href: `/s/folders/${token}`,
      label: 'Travel journal',
    })
  })

  it('ignores page numbers out of range', async () => {
    for (const page of ['0', '-2', '1.5', '100001', 'x']) {
      await expect(
        sharedFolderBackLink(file, `${origin}/s/folders/${token}?page=${page}`)
      ).resolves.toEqual({
        href: `/s/folders/${token}`,
        label: 'Travel journal',
      })
    }
  })

  it('shows nothing unless the file is a public member of that folder', async () => {
    const referer = `${origin}/s/folders/${token}`
    await expect(sharedFolderBackLink(file, null)).resolves.toBeNull()
    await expect(
      sharedFolderBackLink({ ...file, visibility: 'PRIVATE' }, referer)
    ).resolves.toBeNull()
    await expect(
      sharedFolderBackLink({ ...file, folderId: null }, referer)
    ).resolves.toBeNull()
    await expect(
      sharedFolderBackLink({ ...file, folderId: 'other-folder' }, referer)
    ).resolves.toBeNull()
    expect(mocks.findUnique).toHaveBeenCalledTimes(1)
  })

  it('links back to a folder below the shared one', async () => {
    below['folder-2'] = {
      ...plain,
      id: 'folder-2',
      name: 'Day one',
      parentId: 'folder-1',
    }
    await expect(
      sharedFolderBackLink(
        { ...file, folderId: 'folder-2' },
        `${origin}/s/folders/${token}?folder=folder-2&page=2`
      )
    ).resolves.toEqual({
      href: `/s/folders/${token}?folder=folder-2&page=2`,
      label: 'Day one',
    })
  })

  it('goes back in history to a folder that has keys, whose name the server cannot read', async () => {
    mocks.findUnique.mockResolvedValue({
      ...root,
      name: '',
      folderPublicKey: new Uint8Array(32),
      sealedFolderMetadata: new Uint8Array(60),
    })
    await expect(
      sharedFolderBackLink(file, `${origin}/s/folders/${token}`)
    ).resolves.toEqual({
      href: `/s/folders/${token}`,
      label: 'Shared folder',
      history: true,
    })
  })

  it('ignores other pages, malformed tokens and unknown folders', async () => {
    for (const referer of [
      'not a url',
      `${origin}/dashboard`,
      `${origin}/s/folders/short`,
      `${origin}/s/folders/${token}/files`,
      `${origin}/s/folders/${token}/elsewhere`,
      `${origin}/s/folders/${'z'.repeat(32)}`,
    ]) {
      await expect(sharedFolderBackLink(file, referer), referer).resolves.toBe(
        null
      )
    }
  })
})
