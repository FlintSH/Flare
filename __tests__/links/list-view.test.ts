import { describe, expect, it } from 'vitest'

import { shortLinkListView } from '@/components/dashboard/url-list-model'

import { type ShortLink, shortLinkUrl } from '@/lib/links/schema'

const links: ShortLink[] = [
  {
    id: 'new-a',
    userId: 'owner',
    shortCode: 'AbC123',
    targetUrl: 'https://example.test/Café?draft=1',
    clicks: 4,
    createdAt: '2026-11-01T12:00:00Z',
  },
  {
    id: 'new-b',
    userId: 'owner',
    shortCode: 'ZyX987',
    targetUrl: 'https://example.test/caf%C3%A9/final',
    clicks: 9,
    createdAt: '2026-11-01T12:00:00Z',
  },
  {
    id: 'old',
    userId: 'owner',
    shortCode: 'older1',
    targetUrl: 'https://example.test/old?value=100%',
    clicks: 9,
    createdAt: '2026-10-01T12:00:00Z',
  },
  {
    id: 'foreign',
    userId: 'another',
    shortCode: 'secret',
    targetUrl: 'https://private.test/Café',
    clicks: 500,
    createdAt: '2026-12-01T12:00:00Z',
  },
]

describe('short-link list retrieval', () => {
  it('preserves the complete server Newest order and ties without mutating the source', () => {
    const before = structuredClone(links)
    const view = shortLinkListView(links, 'owner', '', 'newest')
    expect(view.urls.map((link) => link.id)).toEqual(['new-a', 'new-b', 'old'])
    expect(view.total).toBe(3)
    expect(links).toEqual(before)
  })

  it('finds destinations without case or Unicode composition differences, including encoded paths', () => {
    const view = shortLinkListView(links, 'owner', '  CAFE\u0301  ', 'newest')
    expect(view.urls.map((link) => link.id)).toEqual(['new-a', 'new-b'])
    expect(view.total).toBe(3)
  })

  it('finds a short code or its visible /u/ path', () => {
    expect(
      shortLinkListView(links, 'owner', 'ＡＢＣ１２３', 'newest').urls[0]?.id
    ).toBe('new-a')
    expect(
      shortLinkListView(links, 'owner', '/u/zyx987', 'newest').urls[0]?.id
    ).toBe('new-b')
  })

  it('finds the exact copied short URL using the same origin, including a port', () => {
    const origin = 'https://files.example.test:8443'
    const copied = shortLinkUrl(links[1].shortCode, origin)
    const before = structuredClone(links)
    expect(
      shortLinkListView(links, 'owner', `  ${copied}  `, 'clicks', origin)
    ).toEqual({ urls: [links[1]], total: 3 })
    expect(
      shortLinkListView(links, 'owner', copied.toUpperCase(), 'oldest', origin)
        .urls
    ).toEqual([links[1]])
    expect(
      shortLinkListView(
        links,
        'owner',
        shortLinkUrl(links[1].shortCode, 'https://another.example.test:8443'),
        'newest',
        origin
      ).urls
    ).toEqual([])
    expect(links).toEqual(before)
  })

  it('keeps copied-URL matches scoped to the active account', () => {
    const origin = 'https://files.example.test'
    const copied = shortLinkUrl('secret', origin)
    expect(shortLinkListView(links, 'owner', copied, 'newest', origin)).toEqual(
      { urls: [], total: 3 }
    )
    expect(
      shortLinkListView(links, 'another', copied, 'newest', origin)
    ).toEqual({ urls: [links[3]], total: 1 })
    expect(
      shortLinkListView(links, 'missing', copied, 'newest', origin)
    ).toEqual({ urls: [], total: 0 })
  })

  it('keeps malformed percent escapes searchable and recovers from empty matches', () => {
    expect(
      shortLinkListView(links, 'owner', '100%', 'newest').urls[0]?.id
    ).toBe('old')
    expect(shortLinkListView(links, 'owner', 'no such link', 'newest')).toEqual(
      { urls: [], total: 3 }
    )
    expect(
      shortLinkListView(links, 'owner', '   ', 'newest').urls
    ).toHaveLength(3)
  })

  it('sorts oldest and most-clicked with stable ties', () => {
    expect(
      shortLinkListView(links, 'owner', '', 'oldest').urls.map(
        (link) => link.id
      )
    ).toEqual(['old', 'new-a', 'new-b'])
    expect(
      shortLinkListView(links, 'owner', '', 'clicks').urls.map(
        (link) => link.id
      )
    ).toEqual(['new-b', 'old', 'new-a'])
    expect(
      shortLinkListView(links, 'owner', 'Café', 'clicks').urls.map(
        (link) => link.id
      )
    ).toEqual(['new-b', 'new-a'])
  })

  it('keeps query matches and totals within the active account, including empty collections', () => {
    expect(shortLinkListView(links, 'owner', 'secret', 'clicks')).toEqual({
      urls: [],
      total: 3,
    })
    expect(
      shortLinkListView(links, 'another', '', 'clicks').urls.map(
        (link) => link.id
      )
    ).toEqual(['foreign'])
    expect(shortLinkListView(links, 'missing', '', 'newest')).toEqual({
      urls: [],
      total: 0,
    })
    expect(shortLinkListView([], 'owner', 'anything', 'oldest')).toEqual({
      urls: [],
      total: 0,
    })
  })
})
