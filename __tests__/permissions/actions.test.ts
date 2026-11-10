import { ExpiryAction } from '@/types/events'
import { describe, expect, it } from 'vitest'

import {
  BATCH_ACTIONS,
  fileActionAllowed,
} from '@/components/dashboard/file-card/actions'

import { requestPermissions } from '@/lib/integrations/bearer-routes'
import {
  ACTION_PERMISSIONS,
  EXPIRY_EFFECTS,
  actionPermissions,
  allows,
} from '@/lib/permissions/actions'
import { UPLOADER_DOWNLOAD_PERMISSION } from '@/lib/uploads/uploader-clients'

const role = (...permissions: string[]) => ({ permissions })

describe('action permissions', () => {
  it.each([
    ['viewFiles', 'GET', '/api/files'],
    ['uploadFiles', 'POST', '/api/files'],
    ['manageExpiration', 'POST', '/api/files/a/expiry'],
    ['manageExpiration', 'DELETE', '/api/files/a/expiry'],
    ['moveFiles', 'POST', '/api/files/folders'],
    ['tagFiles', 'PATCH', '/api/files/tags'],
    ['manageFolders', 'POST', '/api/folders'],
    ['manageFolders', 'PATCH', '/api/folders/a'],
    ['manageFolders', 'DELETE', '/api/folders/a'],
    ['applyTagRule', 'POST', '/api/tags/a/apply'],
    ['viewLinks', 'GET', '/api/urls'],
    ['exportAccount', 'GET', '/api/profile/export'],
  ] as const)('%s needs what %s %s needs', (action, method, path) => {
    expect(ACTION_PERMISSIONS[action]).toEqual(requestPermissions(method, path))
  })

  it('shares a folder only with what its route and its sharing check need', () => {
    expect(actionPermissions('shareFolders')).toEqual([
      ...requestPermissions('PATCH', '/api/folders/a')!,
      'folders.share',
    ])
    expect(allows(role('folders.share'), 'shareFolders')).toBe(false)
    expect(
      allows(role('folders.share', 'folders.manage'), 'shareFolders')
    ).toBe(true)
  })

  it('adds what a paste and a screenshot tool need on top of uploading', () => {
    const upload = requestPermissions('POST', '/api/files')!
    expect(actionPermissions('createPaste')).toEqual([
      ...upload,
      'pastes.create',
    ])
    expect(actionPermissions('uploaderTools')).toEqual([
      ...upload,
      UPLOADER_DOWNLOAD_PERMISSION,
    ])
    expect(allows(role('pastes.create'), 'createPaste')).toBe(false)
    expect(allows(role('tokens.manage'), 'uploaderTools')).toBe(false)
    expect(allows(role('files.upload', 'tokens.manage'), 'uploaderTools')).toBe(
      true
    )
  })

  it('makes scheduling an expiration need what it does when it runs', () => {
    expect(
      Object.values(ExpiryAction).map((action) =>
        actionPermissions(EXPIRY_EFFECTS[action])
      )
    ).toEqual([['files.delete'], ['files.share']])
  })

  it('lists what archive work needs in the order the archive routes check it', () => {
    expect(actionPermissions('createArchive')).toEqual([
      'files.read',
      'files.upload',
    ])
    expect(actionPermissions(['createArchive', 'fileIntoFolder'])).toEqual([
      'files.read',
      'files.upload',
      'folders.manage',
    ])
    expect(actionPermissions('extractArchive')).toEqual(
      actionPermissions(['createArchive', 'fileIntoFolder'])
    )
  })

  it('needs every permission of every action given', () => {
    expect(allows(role('files.upload'), 'uploadFiles')).toBe(true)
    expect(
      allows(role('files.upload'), ['uploadFiles', 'fileIntoFolder'])
    ).toBe(false)
    expect(
      allows(role('files.upload', 'folders.manage'), [
        'uploadFiles',
        'fileIntoFolder',
      ])
    ).toBe(true)
    expect(allows(role('administrator'), 'extractArchive')).toBe(true)
    expect(allows(null, 'viewFiles')).toBe(false)
  })

  it('offers Select only to roles with a bulk action', () => {
    const canSelect = (...permissions: string[]) =>
      BATCH_ACTIONS.some((action) =>
        fileActionAllowed(role(...permissions), action)
      )
    // Whoever sees their files can ask the server to encrypt the plain ones.
    expect(canSelect('files.read', 'files.update', 'files.share')).toBe(true)
    expect(canSelect('files.update', 'files.share')).toBe(false)
    expect(canSelect('files.read', 'files.upload')).toBe(true)
    expect(canSelect('files.update', 'folders.manage')).toBe(true)
    expect(canSelect('files.update', 'tags.manage')).toBe(true)
    expect(canSelect('folders.manage', 'tags.manage')).toBe(false)
  })
})
