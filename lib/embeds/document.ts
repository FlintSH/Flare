import type { Metadata } from 'next'

import type { EmbedCard } from './card'

export type EmbedMedia =
  | { kind: 'image'; url: string; type: string; alt: string }
  /** Apps show the poster until the video plays; some need one to play it. */
  | { kind: 'video'; url: string; type: string; poster: string }
  | { kind: 'audio'; url: string; type: string }

/**
 * Everything a link preview says about one file. The share page's metadata
 * and the document crawlers are sent are both written from it, so they agree.
 */
export interface EmbedDocument {
  /** The share page, never carrying a file password. */
  url: string
  card: EmbedCard
  media: EmbedMedia | null
  /** Where apps read the author line from, when the card has one to give. */
  oembed: string | null
  /** A locked file: nothing about it may be indexed. */
  locked?: boolean
}

// Apps that can't measure a video drop it unless a size is declared. Flare
// doesn't read a video's real size, so this is the frame they get.
const VIDEO_SIZE = { width: 1920, height: 1080 }

type Tag =
  | { tag: 'title'; text: string }
  | { tag: 'meta'; name: string; content: string }
  | { tag: 'property'; property: string; content: string }
  | { tag: 'link'; rel: string; href: string; type?: string; title?: string }

function tags({ url, card, media, oembed, locked }: EmbedDocument): Tag[] {
  const property = (name: string, content: string | number): Tag => ({
    tag: 'property',
    property: name,
    content: String(content),
  })
  const meta = (name: string, content: string): Tag => ({
    tag: 'meta',
    name,
    content,
  })
  const list: Tag[] = [{ tag: 'title', text: card.title }]
  if (card.description) list.push(meta('description', card.description))
  if (locked) list.push(meta('robots', 'noindex, nofollow'))
  list.push(
    { tag: 'link', rel: 'canonical', href: url },
    property('og:type', media?.kind === 'video' ? 'video.other' : 'website'),
    property('og:url', url),
    property('og:title', card.title)
  )
  if (card.description) list.push(property('og:description', card.description))
  if (card.siteName) list.push(property('og:site_name', card.siteName))
  if (media?.kind === 'image')
    list.push(
      property('og:image', media.url),
      property('og:image:type', media.type),
      property('og:image:alt', media.alt)
    )
  if (media?.kind === 'video')
    list.push(
      property('og:image', media.poster),
      property('og:video', media.url),
      property('og:video:url', media.url),
      ...(media.url.startsWith('https:')
        ? [property('og:video:secure_url', media.url)]
        : []),
      property('og:video:type', media.type),
      property('og:video:width', VIDEO_SIZE.width),
      property('og:video:height', VIDEO_SIZE.height)
    )
  if (media?.kind === 'audio')
    list.push(
      property('og:audio', media.url),
      property('og:audio:type', media.type)
    )
  // A video is described by its Open Graph tags alone: a card type here
  // would compete with the player in the apps known to play it.
  if (media?.kind !== 'video') {
    list.push(
      meta(
        'twitter:card',
        media?.kind === 'image' ? 'summary_large_image' : 'summary'
      ),
      meta('twitter:title', card.title)
    )
    if (card.description)
      list.push(meta('twitter:description', card.description))
    if (media?.kind === 'image')
      list.push(
        meta('twitter:image', media.url),
        meta('twitter:image:alt', media.alt)
      )
  }
  if (card.color) list.push(meta('theme-color', card.color))
  if (oembed)
    list.push({
      tag: 'link',
      rel: 'alternate',
      type: 'application/json+oembed',
      href: oembed,
      title: card.title,
    })
  return list
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ESCAPES[character])

function element(tag: Tag): string {
  if (tag.tag === 'title') return `<title>${escape(tag.text)}</title>`
  if (tag.tag === 'meta')
    return `<meta name="${escape(tag.name)}" content="${escape(tag.content)}">`
  if (tag.tag === 'property')
    return `<meta property="${escape(tag.property)}" content="${escape(tag.content)}">`
  const attributes = [
    `rel="${escape(tag.rel)}"`,
    ...(tag.type ? [`type="${escape(tag.type)}"`] : []),
    `href="${escape(tag.href)}"`,
    ...(tag.title ? [`title="${escape(tag.title)}"`] : []),
  ]
  return `<link ${attributes.join(' ')}>`
}

/**
 * The page a crawler is sent: the preview's tags and a link, nothing to run
 * or style, so every tag sits at the top of a small document.
 */
export function embedHtml(document: EmbedDocument): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${tags(document).map(element).join('\n')}
</head>
<body>
<p><a href="${escape(document.url)}">${escape(document.card.title)}</a></p>
</body>
</html>
`
}

/**
 * The same preview as the share page's metadata. It leaves out the accent
 * color, which would also tint a visitor's browser. For a video, Next.js adds
 * a Twitter card of the poster on its own, which a fetcher Flare doesn't know
 * can fall back on.
 */
export function embedMetadata({
  url,
  card,
  media,
  oembed,
  locked,
}: EmbedDocument): Metadata {
  const description = card.description || undefined
  return {
    title: card.title,
    // Null stops the page inheriting the instance's tagline.
    description: description ?? null,
    metadataBase: new URL(url),
    ...(locked ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical: url,
      ...(oembed
        ? {
            types: {
              'application/json+oembed': [{ url: oembed, title: card.title }],
            },
          }
        : {}),
    },
    openGraph: {
      type: media?.kind === 'video' ? 'video.other' : 'website',
      url,
      title: card.title,
      description,
      siteName: card.siteName || undefined,
      ...(media?.kind === 'image'
        ? { images: [{ url: media.url, type: media.type, alt: media.alt }] }
        : {}),
      ...(media?.kind === 'video'
        ? {
            images: [{ url: media.poster }],
            videos: [
              {
                url: media.url,
                ...(media.url.startsWith('https:')
                  ? { secureUrl: media.url }
                  : {}),
                type: media.type,
                ...VIDEO_SIZE,
              },
            ],
          }
        : {}),
      ...(media?.kind === 'audio'
        ? { audio: [{ url: media.url, type: media.type }] }
        : {}),
    } as Metadata['openGraph'],
    ...(media?.kind === 'video'
      ? {}
      : {
          twitter: {
            card: media?.kind === 'image' ? 'summary_large_image' : 'summary',
            title: card.title,
            description,
            ...(media?.kind === 'image'
              ? { images: [{ url: media.url, alt: media.alt }] }
              : {}),
          },
        }),
  }
}
