import { describe, expect, it } from 'vitest'

import {
  fragmentCarriesShareSecret,
  parseShareFragment,
  shareFragment,
  shareLink,
} from '@/lib/e2ee/link'
import { base64urlEncode } from '@/lib/e2ee/primitives'
import type { FileKey, LinkSecret } from '@/lib/e2ee/types'

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
