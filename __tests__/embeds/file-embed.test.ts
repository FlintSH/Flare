import type { Metadata } from 'next'

import { describe, expect, it } from 'vitest'

import {
  type AppearanceDocument,
  DEFAULT_APPEARANCE,
} from '@/lib/customization/schema'
import { identifyCrawler } from '@/lib/embeds/crawlers'
import { embedHtml, embedMetadata } from '@/lib/embeds/document'
import {
  type EmbedFileRow,
  type FileEmbedRequest,
  fileEmbed,
} from '@/lib/embeds/file-embed'
import { personalEmbedSchema } from '@/lib/embeds/schema'

const DISCORD = identifyCrawler('Discordbot/2.0')
const TWITTER = identifyCrawler('Twitterbot/1.0')
const WHATSAPP = identifyCrawler('WhatsApp/2.23.20.0 A')

const image: EmbedFileRow = {
  id: 'file',
  name: 'photo.png',
  urlPath: '/owner/photo.png',
  mimeType: 'image/png',
  size: 1.8,
  visibility: 'PUBLIC',
  password: null,
  userId: 'owner-id',
  views: 128,
  uploadedAt: new Date('2026-11-12T10:00:00Z'),
  user: { name: 'Mira', preferences: {} },
}
const video = {
  ...image,
  name: 'clip.mp4',
  urlPath: '/owner/clip.mp4',
  mimeType: 'video/mp4',
}
const archive = {
  ...image,
  name: 'backup.zip',
  urlPath: '/owner/backup.zip',
  mimeType: 'application/zip',
}

function appearance(
  sharing: Partial<AppearanceDocument['sharing']> = {}
): AppearanceDocument {
  return {
    ...DEFAULT_APPEARANCE,
    sharing: { ...DEFAULT_APPEARANCE.sharing, ...sharing },
  }
}

function embed(request: Partial<FileEmbedRequest> = {}) {
  return fileEmbed({
    file: image,
    ownerId: 'owner',
    personal: null,
    access: { allowed: true, isOwner: false, canModerate: false },
    origin: 'https://flare.example',
    appearance: appearance(),
    signedStorage: false,
    crawler: DISCORD,
    ...request,
  })
}

function page(request: Partial<FileEmbedRequest> = {}) {
  const answer = embed(request)
  if (answer.kind !== 'document') throw new Error(`Got ${answer.kind}`)
  return answer.document
}

describe('direct media, the default', () => {
  it('sends an app that shows images on their own to the image', () => {
    expect(embed()).toEqual({
      kind: 'redirect',
      location: '/owner/photo.png/raw',
    })
  })

  it('gives an app that needs a page the card with the image in it', () => {
    const document = page({ crawler: TWITTER })
    expect(document.media).toEqual({
      kind: 'image',
      url: 'https://flare.example/owner/photo.png/raw',
      type: 'image/png',
      alt: 'photo.png',
    })
    expect(document.card).toMatchObject({
      siteName: 'Flare',
      title: 'photo.png (1.80 MB)',
      description: 'Uploaded by Mira',
    })
    const html = embedHtml(document)
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">'
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://flare.example/owner/photo.png">'
    )
  })

  it('shows a video as its player and title alone', () => {
    const document = page({ file: video })
    expect(document.card).toEqual({
      siteName: '',
      author: '',
      title: 'clip.mp4 (1.80 MB)',
      description: '',
      color: '',
    })
    expect(document.media).toEqual({
      kind: 'video',
      url: 'https://flare.example/owner/clip.mp4/raw',
      type: 'video/mp4',
      poster: 'https://flare.example/video-poster.png',
    })
    const html = embedHtml(document)
    expect(html).toContain('<meta property="og:type" content="video.other">')
    expect(html).toContain(
      '<meta property="og:image" content="https://flare.example/video-poster.png">'
    )
    expect(html).toContain(
      '<meta property="og:video:secure_url" content="https://flare.example/owner/clip.mp4/raw">'
    )
    expect(html).toContain(
      '<meta property="og:video:type" content="video/mp4">'
    )
    expect(html).not.toContain('twitter:card')
    expect(html).not.toContain('og:site_name')
  })

  it('gives a file with nothing to show the card instead of its bytes', () => {
    const document = page({ file: archive })
    expect(document.media).toBeNull()
    expect(document.card.title).toBe('backup.zip (1.80 MB)')
    expect(embedHtml(document)).toContain(
      '<meta name="twitter:card" content="summary">'
    )
  })

  it('treats an image no app previews, such as SVG, as a file', () => {
    const svg = { ...image, name: 'logo.svg', mimeType: 'image/svg+xml' }
    expect(page({ file: svg }).media).toBeNull()
  })

  it('gives a video in a format apps do not play the card without a player', () => {
    const mkv = { ...video, name: 'clip.mkv', mimeType: 'video/x-matroska' }
    expect(page({ file: mkv, crawler: TWITTER }).media).toBeNull()
  })
})

describe('rich embeds', () => {
  const rich = appearance({
    embedMode: 'rich',
    authorTemplate: '{{uploader}}',
    embedColor: '#5b8def',
  })

  it('keeps the image inside the card for every app', () => {
    const document = page({ appearance: rich })
    expect(document.media?.kind).toBe('image')
    expect(document.card).toEqual({
      siteName: 'Flare',
      author: 'Mira',
      title: 'photo.png (1.80 MB)',
      description: 'Uploaded by Mira',
      color: '#5b8def',
    })
    const html = embedHtml(document)
    expect(html).toContain('<meta name="theme-color" content="#5b8def">')
    expect(html).toContain('<meta property="og:site_name" content="Flare">')
    expect(html).toContain(
      '<link rel="alternate" type="application/json+oembed" href="https://flare.example/api/oembed?url=https%3A%2F%2Fflare.example%2Fowner%2Fphoto.png&amp;format=json" title="photo.png (1.80 MB)">'
    )
  })

  it('offers no author lookup when the card has no author', () => {
    expect(page({ appearance: appearance({ embedMode: 'rich' }) }).oembed).toBe(
      null
    )
  })

  it("uses the owner's own mode and card when the instance allows it", () => {
    const personal = personalEmbedSchema.parse({
      mode: 'rich',
      design: 'custom',
      title: '{{filename}}',
      description: '',
      siteName: 'mira.example',
      color: '#ff0066',
    })
    expect(page({ personal }).card).toEqual({
      siteName: 'mira.example',
      author: '',
      title: 'photo.png',
      description: '',
      color: '#ff0066',
    })
    // With personal embeds off, the instance's applies again.
    expect(
      embed({ personal, appearance: appearance({ personalEmbeds: false }) })
    ).toEqual({ kind: 'redirect', location: '/owner/photo.png/raw' })
  })

  it('never shows what the instance hides, whoever wrote the card', () => {
    const file = {
      ...image,
      user: { name: 'Private Person', preferences: {} },
    }
    const document = page({
      file,
      personal: personalEmbedSchema.parse({
        mode: 'rich',
        design: 'custom',
        title: '{{filename}} ({{size}})',
        description: 'By {{uploader}}',
        author: '{{uploader}}',
      }),
      appearance: appearance({
        showFilename: false,
        showSize: false,
        showUploader: false,
      }),
    })
    expect(document.card).toMatchObject({
      author: '',
      title: 'Shared file',
      description: '',
    })
    expect(JSON.stringify(document)).not.toMatch(/Private Person|1\.80 MB/)
    expect(document.media).toMatchObject({ alt: 'Shared file' })
  })
})

describe('names longer than a title may be', () => {
  // A single-request upload can keep a name of several thousand characters.
  const long = { ...image, name: `${'n'.repeat(5000)}.png` }

  it('are cut when the name stands in for an empty title', () => {
    const { title } = page({
      file: long,
      crawler: TWITTER,
      personal: personalEmbedSchema.parse({ design: 'custom' }),
    }).card
    expect(title).toHaveLength(500)
    expect(title.endsWith('…')).toBe(true)
  })

  it('are cut in the title and in the image description alike', () => {
    const document = page({ file: long, crawler: TWITTER })
    expect(document.card.title).toHaveLength(500)
    expect(document.media).toMatchObject({ kind: 'image' })
    const alt = document.media?.kind === 'image' ? document.media.alt : ''
    expect(alt).toHaveLength(500)
    expect(alt.endsWith('…')).toBe(true)
  })
})

describe('addresses in a preview', () => {
  it('points a video at the media address when storage signs its URLs', () => {
    const document = page({
      file: video,
      crawler: TWITTER,
      signedStorage: true,
    })
    expect(document.media).toMatchObject({
      url: 'https://flare.example/owner/clip.mp4/media',
    })
  })

  it('keeps the vanity ID the link was shared under', () => {
    expect(page({ crawler: TWITTER, ownerId: 'mira' }).url).toBe(
      'https://flare.example/mira/photo.png'
    )
  })

  it('carries a file password in media links only', () => {
    const password = 'open sesame&more'
    const query = new URLSearchParams({ password })
    expect(embed({ password })).toEqual({
      kind: 'redirect',
      location: `/owner/photo.png/raw?${query}`,
    })
    const document = page({
      file: { ...image, password: 'hash' },
      password,
      crawler: TWITTER,
      appearance: appearance({ authorTemplate: '{{uploader}}' }),
    })
    expect(document.url).toBe('https://flare.example/owner/photo.png')
    expect(document.media?.url).toBe(
      `https://flare.example/owner/photo.png/raw?${query}`
    )
    // The author lookup answers for public files without a password only.
    expect(document.oembed).toBeNull()
  })

  it('escapes every value it writes into the page', () => {
    const file = {
      ...image,
      name: '"><script>alert(1)</script>.png',
      urlPath: '/owner/x.png',
    }
    const html = embedHtml(page({ file, crawler: TWITTER }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })
})

describe('files not everyone may open', () => {
  it('tells nothing about a private file', () => {
    expect(
      embed({ access: { allowed: false, reason: 'private', status: 404 } })
    ).toEqual({ kind: 'missing' })
  })

  it('says only that a file behind a password is protected', () => {
    const document = page({
      file: { ...image, password: 'hash' },
      access: { allowed: false, reason: 'password_required', status: 401 },
    })
    expect(document).toEqual({
      url: 'https://flare.example/owner/photo.png',
      card: {
        siteName: '',
        author: '',
        title: 'Protected file - Flare',
        description: 'This file is protected.',
        color: '',
      },
      media: null,
      oembed: null,
      locked: true,
    })
    const html = embedHtml(document)
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).not.toMatch(/photo\.png\/raw|Mira/)
  })
})

describe('app quirks', () => {
  it('gives WhatsApp a description when the card has none', () => {
    const plain = appearance({ descriptionTemplate: '' })
    expect(page({ appearance: plain, crawler: TWITTER }).card.description).toBe(
      ''
    )
    expect(
      page({ appearance: plain, crawler: WHATSAPP }).card.description
    ).toBe(DEFAULT_APPEARANCE.brand.tagline)
  })
})

describe('the share page and the crawler page', () => {
  const flat = (metadata: Metadata) => JSON.stringify(metadata)

  it('say the same thing', () => {
    for (const file of [image, video, archive]) {
      const document = page({
        file,
        crawler: null,
        appearance: appearance({ authorTemplate: '{{uploader}}' }),
      })
      const html = embedHtml(document)
      const metadata = embedMetadata(document)
      expect(metadata.title).toBe(document.card.title)
      expect(html).toContain(`<title>${document.card.title}</title>`)
      for (const value of [
        document.url,
        document.card.title,
        document.card.description,
        document.card.siteName,
        document.media?.url,
        document.media?.type,
      ].filter((value): value is string => Boolean(value))) {
        expect(flat(metadata), value).toContain(value)
        expect(html, value).toContain(value.replace(/&/g, '&amp;'))
      }
    }
  })

  it('give a visitor every tag an unknown fetcher needs', () => {
    const metadata = embedMetadata(page({ crawler: null }))
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      url: 'https://flare.example/owner/photo.png',
      siteName: 'Flare',
      images: [
        {
          url: 'https://flare.example/owner/photo.png/raw',
          type: 'image/png',
          alt: 'photo.png',
        },
      ],
    })
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
  })
})
