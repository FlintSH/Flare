import type { Prisma } from '@prisma/client'

import type { AppearanceDocument } from '@/lib/customization/schema'
import type { FileAccessResult } from '@/lib/files/access'
import { fileKind } from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import { formatFileSize } from '@/lib/utils'

import { type EmbedCard, embedFileLabel, renderEmbedCard } from './card'
import type { Crawler } from './crawlers'
import type { EmbedDocument, EmbedMedia } from './document'
import {
  type EmbedMode,
  type PersonalEmbed,
  embedLayout,
  resolveEmbedSettings,
} from './schema'

/** What a preview reads from the file and its owner. */
export const embedFileFields = {
  id: true,
  name: true,
  urlPath: true,
  mimeType: true,
  size: true,
  visibility: true,
  password: true,
  userId: true,
  views: true,
  uploadedAt: true,
  user: { select: { name: true, preferences: true } },
} satisfies Prisma.FileSelect

export type EmbedFileRow = Prisma.FileGetPayload<{
  select: typeof embedFileFields
}>

// The formats preview apps show. Anything else gets the card without media,
// rather than a tag an app may reject the whole preview over.
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/apng',
])
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

/** Shown until a video plays. Flare has no frame of the video itself. */
export const VIDEO_POSTER_PATH = '/video-poster.png'

export interface FileEmbedRequest {
  file: EmbedFileRow
  /** The link's first segment as requested: the owner's URL ID or vanity ID. */
  ownerId: string
  /** The owner's own embed while they may have one; see `ownerEmbed`. */
  personal: PersonalEmbed | null
  access: FileAccessResult
  /** The file password the request carried, which its media links keep. */
  password?: string | null
  /** Where the request reached Flare, for absolute URLs. */
  origin: string
  appearance: AppearanceDocument
  /** Whether storage hands out its own, expiring, URLs. */
  signedStorage: boolean
  /** The preview fetcher asking, or null for the share page itself. */
  crawler: Crawler | null
}

export type FileEmbed =
  | { kind: 'missing' }
  /** Send the crawler to the bytes, so the app shows them on their own. */
  | { kind: 'redirect'; location: string }
  | { kind: 'document'; document: EmbedDocument }

function media(
  { file, appearance, signedStorage }: FileEmbedRequest,
  urls: ReturnType<typeof fileUrls>,
  origin: string
): EmbedMedia | null {
  const { kind } = fileKind(file)
  if (kind === 'image' && IMAGE_TYPES.has(file.mimeType))
    return {
      kind: 'image',
      url: urls.raw,
      type: file.mimeType,
      alt: embedFileLabel(file, appearance.sharing),
    }
  // A signed storage URL would expire inside a preview an app keeps; the
  // media address signs a new one each time it is asked.
  const stream = signedStorage ? urls.media : urls.raw
  if (kind === 'video' && VIDEO_TYPES.has(file.mimeType))
    return {
      kind: 'video',
      url: stream,
      type: file.mimeType,
      poster: `${origin}${VIDEO_POSTER_PATH}`,
    }
  if (kind === 'audio')
    return { kind: 'audio', url: stream, type: file.mimeType }
  return null
}

// Discord shows no preview at all for a page with a longer URL in it.
const URL_LIMIT = 2048

function oembedUrl(origin: string, page: string) {
  const url = `${origin}/api/oembed?${new URLSearchParams({ url: page, format: 'json' })}`
  return url.length <= URL_LIMIT ? url : null
}

/** The card for one file, as its owner or the instance wrote it. */
export function fileEmbedCard(
  file: EmbedFileRow,
  appearance: AppearanceDocument,
  personal: PersonalEmbed | null
): { mode: EmbedMode; card: EmbedCard } {
  const { mode, card } = resolveEmbedSettings(appearance.sharing, personal)
  return {
    mode,
    card: renderEmbedCard(
      card,
      {
        name: file.name,
        size: formatFileSize(file.size),
        mimeType: file.mimeType,
        uploader: file.user.name || 'Anonymous',
        uploadedAt: file.uploadedAt,
        views: file.views,
      },
      appearance
    ),
  }
}

/**
 * How one file previews for whoever asked. Nothing about a private file is
 * told, and a file behind a password says only that it is protected.
 */
export function fileEmbed(request: FileEmbedRequest): FileEmbed {
  const { file, ownerId, personal, access, password, origin, crawler } = request
  const { appearance } = request
  const { brand } = appearance
  const storedId = file.urlPath.split('/')[1] ?? ''
  const owner = {
    urlId: storedId,
    vanityId: ownerId !== storedId ? ownerId : null,
  }
  const url = fileUrls(file, { origin, owner }).page

  if (!access.allowed) {
    if (access.reason === 'private') return { kind: 'missing' }
    return {
      kind: 'document',
      document: {
        url,
        card: {
          siteName: '',
          author: '',
          title: `Protected file - ${brand.name}`,
          description: 'This file is protected.',
          color: '',
        },
        media: null,
        oembed: null,
        locked: true,
      },
    }
  }

  const { mode, card } = fileEmbedCard(file, appearance, personal)
  const shown = media(request, fileUrls(file, { origin, password }), origin)
  const layout = embedLayout(
    mode,
    shown?.kind ?? null,
    crawler?.bareImages === true
  )
  if (layout === 'media')
    // Relative, so it holds whatever address the crawler came in by.
    return { kind: 'redirect', location: fileUrls(file, { password }).raw }

  if (layout === 'player' && shown)
    // As close to the video alone as a page allows: its player and a title.
    return {
      kind: 'document',
      document: {
        url,
        card: { ...card, siteName: '', author: '', description: '', color: '' },
        media: shown,
        oembed: null,
      },
    }

  return {
    kind: 'document',
    document: {
      url,
      card: {
        ...card,
        description:
          card.description ||
          (crawler?.needsDescription ? brand.tagline || brand.name : ''),
      },
      media: shown,
      // The author line is all an app reads from it that tags can't say, and
      // it only answers for files anyone may open.
      oembed: card.author && !file.password ? oembedUrl(origin, url) : null,
    },
  }
}
