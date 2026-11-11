import { describe, expect, it } from 'vitest'

import {
  folderShareFragment,
  folderShareLink,
  fragmentCarriesShareSecret,
  ownOriginPath,
  parseFolderFragment,
  parseShareFragment,
  shareFragment,
  shareLink,
} from '@/lib/e2ee/link'
import { base64urlEncode } from '@/lib/e2ee/primitives'
import type { FileKey, FolderPrivateKey, LinkSecret } from '@/lib/e2ee/types'

const fileKey = Uint8Array.from({ length: 32 }, (_, i) => i + 1) as FileKey
const linkSecret = Uint8Array.from(
  { length: 32 },
  (_, i) => 255 - i
) as LinkSecret
const keyText = base64urlEncode(fileKey)
const secretText = base64urlEncode(linkSecret)

describe('share link fragment (section 10.3)', () => {
  it('writes a file_key with no prefix and a link_secret after p.', () => {
    expect(shareFragment({ kind: 'file_key', fileKey })).toBe(keyText)
    expect(shareFragment({ kind: 'link_secret', linkSecret })).toBe(
      `p.${secretText}`
    )
    expect(keyText).toHaveLength(43)
    expect(keyText).not.toContain('.')
  })

  it('reads back what it wrote, with or without the #', () => {
    expect(parseShareFragment(keyText)).toEqual({ kind: 'file_key', fileKey })
    expect(parseShareFragment(`#${keyText}`)).toEqual({
      kind: 'file_key',
      fileKey,
    })
    expect(parseShareFragment(`#p.${secretText}`)).toEqual({
      kind: 'link_secret',
      linkSecret,
    })
  })

  it('says a link has no key when nothing follows the #', () => {
    expect(parseShareFragment('')).toEqual({ kind: 'missing' })
    expect(parseShareFragment('#')).toEqual({ kind: 'missing' })
  })

  it('tells the user to update for a prefix it does not know, and tries nothing else', () => {
    // Section 1.5.2, rule 3: a secret behind an unknown prefix is never
    // read as a key of this version.
    expect(parseShareFragment(`#q.${keyText}`)).toEqual({
      kind: 'unknown_version',
    })
    expect(parseShareFragment(`#v2.${keyText}`)).toEqual({
      kind: 'unknown_version',
    })
    expect(parseShareFragment(`#P.${secretText}`)).toEqual({
      kind: 'unknown_version',
    })
    expect(parseShareFragment(`#.${keyText}`)).toEqual({
      kind: 'unknown_version',
    })
  })

  it('rejects a secret that is cut, padded or not base64url', () => {
    for (const text of [
      keyText.slice(0, 42),
      `${keyText}A`,
      `${keyText}=`,
      keyText.replace(/.$/, '+'),
      'section-two',
      `p.${secretText.slice(1)}`,
      'p.',
      `p.${secretText}.x`,
    ])
      expect(parseShareFragment(text), text).toEqual({ kind: 'malformed' })
  })

  it('builds the link from the page address and replaces a fragment it has', () => {
    expect(
      shareLink('https://flare.test/alexm/e_abc', { kind: 'file_key', fileKey })
    ).toBe(`https://flare.test/alexm/e_abc#${keyText}`)
    expect(
      shareLink('https://flare.test/alexm/e_abc#old', {
        kind: 'link_secret',
        linkSecret,
      })
    ).toBe(`https://flare.test/alexm/e_abc#p.${secretText}`)
  })

  it('never puts a secret in a path or a query', () => {
    const link = shareLink('https://flare.test/a/b?x=1', {
      kind: 'file_key',
      fileKey,
    })
    const url = new URL(link)
    expect(url.pathname + url.search).toBe('/a/b?x=1')
    expect(url.hash).toBe(`#${keyText}`)
  })

  it('finds a key in an address, for the short link form', () => {
    expect(fragmentCarriesShareSecret(`https://x.test/a/b#${keyText}`)).toBe(
      true
    )
    expect(
      fragmentCarriesShareSecret(`https://x.test/a/b#p.${secretText}`)
    ).toBe(true)
    // A later version's link is refused too: it holds a secret all the same.
    expect(fragmentCarriesShareSecret(`https://x.test/a/b#v2.${keyText}`)).toBe(
      true
    )
    expect(fragmentCarriesShareSecret('https://x.test/a/b')).toBe(false)
    expect(fragmentCarriesShareSecret('https://x.test/a/b#section-2')).toBe(
      false
    )
    expect(fragmentCarriesShareSecret('https://x.test/docs#v1.2-notes')).toBe(
      false
    )
  })
})

describe('shared folder link (section 9.4.3)', () => {
  const folderPrivateKey = Uint8Array.from(
    { length: 32 },
    (_, i) => 200 - i
  ) as FolderPrivateKey
  const text = base64urlEncode(folderPrivateKey)

  it('carries the folder private key after #, as it is', () => {
    expect(folderShareFragment(folderPrivateKey)).toBe(text)
    const link = folderShareLink(
      'https://flare.test/s/folders/token?folder=x#old',
      folderPrivateKey
    )
    const url = new URL(link)
    expect(url.pathname + url.search).toBe('/s/folders/token?folder=x')
    expect(url.hash).toBe(`#${text}`)
    expect(parseFolderFragment(url.hash)).toEqual({
      kind: 'folder_key',
      folderPrivateKey,
    })
    expect(() =>
      folderShareFragment(new Uint8Array(31) as FolderPrivateKey)
    ).toThrow()
  })

  it('tells a missing key, a cut key and a later version apart', () => {
    expect(parseFolderFragment('')).toEqual({ kind: 'missing' })
    expect(parseFolderFragment('#')).toEqual({ kind: 'missing' })
    expect(parseFolderFragment(text.slice(0, 42))).toEqual({
      kind: 'malformed',
    })
    expect(parseFolderFragment(`${text}=`)).toEqual({ kind: 'malformed' })
    expect(parseFolderFragment(`v2.${text}`)).toEqual({
      kind: 'unknown_version',
    })
  })

  it('is refused as the target of a short link, like a file link', () => {
    expect(
      fragmentCarriesShareSecret(`https://x.test/s/folders/token#${text}`)
    ).toBe(true)
  })
})

describe('ownOriginPath', () => {
  const origin = 'https://flare.example'
  it('keeps the path and the query of an address of this origin', () => {
    expect(ownOriginPath('https://flare.example/alex/e_abc', origin)).toBe(
      '/alex/e_abc'
    )
    expect(ownOriginPath('/alex/e_abc?page=2', origin)).toBe(
      '/alex/e_abc?page=2'
    )
  })
  it('drops another origin, so a key never goes into its address', () => {
    for (const address of [
      'https://other.example/alex/e_abc',
      'http://flare.example.other.example/alex/e_abc',
      '//other.example/alex/e_abc',
      'https://flare.example//other.example/alex/e_abc',
    ]) {
      const path = ownOriginPath(address, origin)
      expect(path.startsWith('/')).toBe(true)
      expect(path.startsWith('//')).toBe(false)
      expect(new URL(`${origin}${path}`).origin).toBe(origin)
      expect(new URL(path, origin).origin).toBe(origin)
    }
  })
  it('drops the fragment and survives an address that is no address', () => {
    expect(ownOriginPath('/alex/e_abc#secret', origin)).toBe('/alex/e_abc')
    expect(ownOriginPath('javascript:alert(1)', origin).startsWith('/')).toBe(
      true
    )
    expect(ownOriginPath('http://[', origin)).toBe('/')
  })
})
