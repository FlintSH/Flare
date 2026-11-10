import { clientKeys } from '@/__tests__/auth/e2ee-test-keys'
import { cheapArgon2id } from '@/__tests__/library/support'
import { describe, expect, it } from 'vitest'

import { newEncryptedFile, newPasswordStanza } from '@/lib/e2ee/client/files'
import {
  folderSecretOf,
  folderStanzaFor,
  newFolderKeys,
  openChildFolder,
  openFolderFile,
  openFolderWithKey,
  openOwnedFolder,
  parentStanzaFor,
  sealedFolderKey,
  sealedFolderName,
} from '@/lib/e2ee/client/folders'
import { isE2eeError } from '@/lib/e2ee/errors'
import { parseShareFragment } from '@/lib/e2ee/link'
import { base64urlEncode } from '@/lib/e2ee/primitives'

const owner = clientKeys().accountKeys
const stranger = clientKeys().accountKeys

function reason(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return isE2eeError(error) ? error.reason : 'other'
  }
  return 'none'
}

describe('folder keys in the browser (sections 8.4 and 9.4)', () => {
  it('lets the owner open a folder, and no other account', () => {
    const { opened, records } = newFolderKeys(
      owner.accountPrivateKey,
      'Invoices'
    )
    expect(JSON.stringify(records)).not.toContain('Invoices')
    const again = openOwnedFolder(owner.accountPrivateKey, records)
    expect(again.name).toBe('Invoices')
    expect(again.folderPrivateKey).toEqual(opened.folderPrivateKey)
    expect(
      reason(() => openOwnedFolder(stranger.accountPrivateKey, records))
    ).toBe('tag_mismatch')
  })

  it('never trusts the public key that the server lists (section 8.4.2)', () => {
    const { records } = newFolderKeys(owner.accountPrivateKey, 'A')
    const other = newFolderKeys(owner.accountPrivateKey, 'B')
    // A server that swaps in its own public key: the sealed copy does not open.
    expect(
      reason(() =>
        openOwnedFolder(owner.accountPrivateKey, {
          ...records,
          folderPublicKey: other.records.folderPublicKey,
        })
      )
    ).toBe('tag_mismatch')
    // A link key that is not the key of the listed folder is rejected.
    expect(
      reason(() => openFolderWithKey(records, other.opened.folderPrivateKey))
    ).toBe('key_mismatch')
  })

  it('renames with a new sealed name and keeps the keys', () => {
    const { opened, records } = newFolderKeys(owner.accountPrivateKey, 'Old')
    const renamed = {
      ...records,
      sealedFolderMetadata: sealedFolderName(opened, 'New'),
    }
    expect(openOwnedFolder(owner.accountPrivateKey, renamed).name).toBe('New')
    expect(openFolderWithKey(renamed, opened.folderPrivateKey).name).toBe('New')
  })

  it('opens a folder below with the key of its parent, and not the other way', () => {
    const parent = newFolderKeys(owner.accountPrivateKey, 'Parent')
    const child = newFolderKeys(owner.accountPrivateKey, 'Child')
    const stanza = parentStanzaFor(child.opened, parent.opened)
    expect(stanza.parentFolderPublicKey).toBe(
      base64urlEncode(parent.opened.folderPublicKey)
    )
    const wire = {
      ...child.records,
      parentFolderStanza: stanza.parentFolderStanza,
    }
    const visitor = openFolderWithKey(
      parent.records,
      parent.opened.folderPrivateKey
    )
    expect(openChildFolder(visitor, wire)).toMatchObject({ name: 'Child' })
    expect(reason(() => openChildFolder(child.opened, wire))).toBe(
      'tag_mismatch'
    )
    // The stanza of a different folder under the listed public key fails.
    const third = newFolderKeys(owner.accountPrivateKey, 'Third')
    expect(
      reason(() =>
        openChildFolder(visitor, {
          ...third.records,
          parentFolderStanza: stanza.parentFolderStanza,
        })
      )
    ).toBe('tag_mismatch')
  })

  it('gives a visitor the file key of a public file, and only the link secret of a password file', async () => {
    const folder = newFolderKeys(owner.accountPrivateKey, 'Shared')
    const file = newEncryptedFile({
      name: 'plan.pdf',
      type: 'application/pdf',
      accountPublicKey: owner.accountPublicKey,
    })
    const stanza = folderStanzaFor(
      folder.opened,
      file,
      folderSecretOf(file, null)
    )
    const opened = openFolderFile(folder.opened, {
      ...file.records,
      folderStanza: stanza.folderStanza,
      hasPassword: false,
    })
    if (opened.kind !== 'file') throw new Error('expected a file key')
    expect(opened.opened.name).toBe('plan.pdf')
    // The fragment is the share link of the file itself (section 9.4.5).
    expect(parseShareFragment(opened.fragment)).toEqual({
      kind: 'file_key',
      fileKey: file.fileKey,
    })

    const { passwordStanza, secret } = await newPasswordStanza({
      opened: file,
      password: 'a long enough password',
      ownerPublicKey: owner.accountPublicKey,
      argon2id: cheapArgon2id,
    })
    const locked = folderStanzaFor(
      folder.opened,
      file,
      folderSecretOf(file, passwordStanza)
    )
    const viaFolder = openFolderFile(folder.opened, {
      ...file.records,
      folderStanza: locked.folderStanza,
      hasPassword: true,
    })
    expect(viaFolder.kind).toBe('password')
    expect(parseShareFragment(viaFolder.fragment)).toEqual(secret)
    // A link secret stanza does not open as a file key stanza, and a
    // different folder key opens neither.
    expect(
      reason(() =>
        openFolderFile(folder.opened, {
          ...file.records,
          folderStanza: locked.folderStanza,
          hasPassword: false,
        })
      )
    ).toBe('tag_mismatch')
    const other = newFolderKeys(owner.accountPrivateKey, 'Other')
    expect(
      reason(() =>
        openFolderFile(other.opened, {
          ...file.records,
          folderStanza: stanza.folderStanza,
          hasPassword: false,
        })
      )
    ).toBe('tag_mismatch')
  })

  it('seals the folder key again for a new account key (section 8.3.3)', () => {
    const { opened, records } = newFolderKeys(owner.accountPrivateKey, 'Kept')
    const rotated = {
      ...records,
      sealedFolderPrivateKey: sealedFolderKey(
        stranger.accountPrivateKey,
        opened
      ),
    }
    expect(openOwnedFolder(stranger.accountPrivateKey, rotated)).toMatchObject({
      name: 'Kept',
      folderPublicKey: opened.folderPublicKey,
    })
    expect(
      reason(() => openOwnedFolder(owner.accountPrivateKey, rotated))
    ).toBe('tag_mismatch')
  })
})
