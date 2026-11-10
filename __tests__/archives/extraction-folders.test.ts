import { describe, expect, it } from 'vitest'

import { extractionFolderMaker } from '@/lib/archives/client/extraction-folders'
import type { PlannedFolder } from '@/lib/archives/client/jobs'
import {
  openChildFolder,
  openFolderWithKey,
  openOwnedFolder,
} from '@/lib/e2ee/client/folders'
import { base64urlDecode } from '@/lib/e2ee/primitives'
import type { OwnedFolderView } from '@/lib/folders/owned'
import type { FolderView } from '@/lib/folders/schema'

import { clientKeys } from '../auth/e2ee-test-keys'
import { storedKeys } from '../library/support'

/**
 * The account folders of an extraction in the browser (docs/e2ee-spec.md,
 * sections 8.4.2 and 12.3.1): what the page sends for each folder, and what
 * a person who has the key of the new folder can open.
 */

const PLANNED: PlannedFolder[] = [
  { path: 'photos', name: 'photos', parentPath: '' },
  { path: 'Tax Papers', name: 'Tax Papers', parentPath: '' },
  { path: 'photos/2026', name: '2026', parentPath: 'photos' },
]

/** A server that stores what it is sent, as `POST /api/folders` answers. */
function server() {
  const bodies: Record<string, unknown>[] = []
  const views: FolderView[] = []
  return {
    bodies,
    views,
    async create(body: Record<string, unknown>): Promise<FolderView> {
      bodies.push(body)
      const view: FolderView = {
        id: `f${views.length + 1}`,
        name: '',
        parentId: (body.parentId as string | null) ?? null,
        fileCount: 0,
        shareToken: null,
        keys: {
          folderPublicKey: body.folderPublicKey as string,
          sealedFolderMetadata: body.sealedFolderMetadata as string,
          sealedFolderPrivateKey: body.sealedFolderPrivateKey as string,
          parentFolderStanza: (body.parentFolderStanza as string) ?? null,
          parentStanzaPublicKey: (body.parentFolderPublicKey as string) ?? null,
          rekeyPending: false,
        },
      }
      views.push(view)
      return view
    },
  }
}

describe('the folders of an extraction in the browser', () => {
  it('makes a new folder and the folders of the archive, with sealed names and parent stanzas', async () => {
    const keys = storedKeys('alex', clientKeys())
    const { bodies, views, create } = server()
    const order: string[] = []
    const made = await extractionFolderMaker({
      name: 'Holiday bundle',
      parentId: null,
      folders: [],
      keys,
      create,
      made: (folder) => order.push(folder.id),
    })(PLANNED)

    expect([...made.keys()]).toEqual([
      '',
      'photos',
      'Tax Papers',
      'photos/2026',
    ])
    expect(order).toEqual(['f1', 'f2', 'f3', 'f4'])
    // The new folder at the top, the folders of the archive below it.
    expect(views.map((view) => view.parentId)).toEqual([null, 'f1', 'f1', 'f2'])

    // No request names a folder: only keys and sealed records are sent.
    const sent = JSON.stringify(bodies)
    for (const name of ['Holiday', 'bundle', 'photos', 'Tax', 'Papers', '2026'])
      expect(sent).not.toContain(name)
    for (const body of bodies)
      expect(Object.keys(body).sort()).toEqual(
        body.parentFolderStanza
          ? [
              'folderPublicKey',
              'parentFolderPublicKey',
              'parentFolderStanza',
              'parentId',
              'sealedFolderMetadata',
              'sealedFolderPrivateKey',
            ]
          : [
              'folderPublicKey',
              'parentId',
              'sealedFolderMetadata',
              'sealedFolderPrivateKey',
            ]
      )
    expect(bodies.map((body) => Boolean(body.parentFolderStanza))).toEqual([
      false,
      true,
      true,
      true,
    ])

    // The owner opens each folder with the account key.
    const names = views.map(
      (view) => openOwnedFolder(keys.accountPrivateKey, view.keys!).name
    )
    expect(names).toEqual(['Holiday bundle', 'photos', 'Tax Papers', '2026'])

    // A visitor with the key of the new folder walks down to every folder.
    const root = openOwnedFolder(keys.accountPrivateKey, views[0].keys!)
    const visitor = openFolderWithKey(views[0].keys!, root.folderPrivateKey)
    const photos = openChildFolder(visitor, views[1].keys!)
    expect(photos.name).toBe('photos')
    expect(openChildFolder(photos, views[3].keys!).name).toBe('2026')
    expect(openChildFolder(visitor, views[2].keys!).name).toBe('Tax Papers')

    // The key a file gets its folder stanza for is the key of its folder.
    expect(made.get('photos/2026')).toEqual({
      id: 'f4',
      folderPublicKey: base64urlDecode(views[3].keys!.folderPublicKey),
    })
  })

  it('puts the new folder inside an existing folder and gives it a parent stanza', async () => {
    const keys = storedKeys('alex', clientKeys())
    const first = server()
    await extractionFolderMaker({
      name: 'Archive',
      parentId: null,
      folders: [],
      keys,
      create: first.create,
    })([])
    const parent: OwnedFolderView = { ...first.views[0], name: 'Archive' }

    const second = server()
    await extractionFolderMaker({
      name: 'Inside',
      parentId: parent.id,
      folders: [parent],
      keys,
      create: second.create,
    })([])
    expect(second.bodies[0].parentId).toBe(parent.id)
    const parentKeys = openOwnedFolder(keys.accountPrivateKey, parent.keys!)
    expect(openChildFolder(parentKeys, second.views[0].keys!).name).toBe(
      'Inside'
    )
  })

  it('refuses a name that a folder in the same place has, before it sends anything', async () => {
    const keys = storedKeys('alex', clientKeys())
    const { bodies, create } = server()
    const existing: OwnedFolderView = {
      id: 'old',
      name: 'holiday BUNDLE',
      parentId: null,
      fileCount: 0,
      shareToken: null,
      keys: null,
    }
    await expect(
      extractionFolderMaker({
        name: 'Holiday bundle',
        parentId: null,
        folders: [existing],
        keys,
        create,
      })(PLANNED)
    ).rejects.toThrow('A folder with that name already exists here.')
    expect(bodies).toEqual([])
  })

  it('stops at the folder the server refused and reports the ones it made', async () => {
    const keys = storedKeys('alex', clientKeys())
    const { create } = server()
    const order: string[] = []
    let calls = 0
    await expect(
      extractionFolderMaker({
        name: 'Holiday bundle',
        parentId: null,
        folders: [],
        keys,
        create: (body) => {
          if (++calls === 3) throw new Error('The server said no')
          return create(body)
        },
        made: (folder) => order.push(folder.id),
      })(PLANNED)
    ).rejects.toThrow('The server said no')
    expect(order).toEqual(['f1', 'f2'])
  })
})
