import { describe, expect, it } from 'vitest'

import { base64urlEncode } from '@/lib/e2ee/primitives'
import {
  SHORT_LINK_KEY_MESSAGE,
  shortLinkInputSchema,
} from '@/lib/links/schema'

const key = base64urlEncode(Uint8Array.from({ length: 32 }, (_, i) => i * 3))

describe('short links and encrypted file links (section 12.6)', () => {
  it('refuses a target that carries a key after #, with the reason', () => {
    for (const url of [
      `https://flare.test/alexm/e_0123456789abcdefghijkl#${key}`,
      `https://flare.test/alexm/e_0123456789abcdefghijkl#p.${key}`,
      `https://other.example/vanity/e_0123456789abcdefghijkl#v2.${key}`,
    ]) {
      const result = shortLinkInputSchema.safeParse({ url })
      expect(result.success, url).toBe(false)
      if (!result.success)
        expect(result.error.issues[0].message).toBe(SHORT_LINK_KEY_MESSAGE)
    }
  })

  it('still accepts ordinary addresses, with ordinary fragments', () => {
    for (const url of [
      'https://example.com/docs',
      'https://example.com/docs#installation',
      'https://flare.test/alexm/e_0123456789abcdefghijkl',
      'https://flare.test/alexm/photo.png#t=10',
    ])
      expect(shortLinkInputSchema.safeParse({ url }).success, url).toBe(true)
  })
})
