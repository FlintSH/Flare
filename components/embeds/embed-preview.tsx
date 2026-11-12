'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'

import type { AppearanceDocument } from '@/lib/customization/schema'
import { type EmbedCard, renderEmbedCard } from '@/lib/embeds/card'
import {
  type EmbedCardTemplates,
  type EmbedLayout,
  type EmbedMode,
  embedLayout,
} from '@/lib/embeds/schema'
import { cn } from '@/lib/utils'

import { SamplePicture, SampleVideo } from './sample-media'

type SampleMedia = 'image' | 'video' | null

const SAMPLES = {
  image: {
    label: 'Image',
    name: 'a-little-inspiration.png',
    size: '1.8 MB',
    mimeType: 'image/png',
    media: 'image',
  },
  video: {
    label: 'Video',
    name: 'launch-recap.mp4',
    size: '24 MB',
    mimeType: 'video/mp4',
    media: 'video',
  },
  file: {
    label: 'File',
    name: 'quarterly-report.pdf',
    size: '420 KB',
    mimeType: 'application/pdf',
    media: null,
  },
} as const satisfies Record<
  string,
  {
    label: string
    name: string
    size: string
    mimeType: string
    media: SampleMedia
  }
>
type SampleKind = keyof typeof SAMPLES
const SAMPLE_KINDS = Object.keys(SAMPLES) as SampleKind[]

const captionClassName = 'text-xs font-medium text-muted-foreground'

function Media({
  media,
  className,
}: {
  media: SampleMedia
  className?: string
}) {
  if (media === 'image') return <SamplePicture className={className} />
  if (media === 'video') return <SampleVideo className={className} />
  return null
}

/** What a chat app puts under the pasted link. */
function ChatEmbed({
  layout,
  card,
  media,
}: {
  layout: EmbedLayout
  card: EmbedCard
  media: SampleMedia
}) {
  if (layout === 'media')
    return <Media media={media} className="h-40 max-w-sm" />
  if (layout === 'player')
    return (
      <div className="max-w-sm space-y-1.5">
        <p className="break-words text-sm font-medium text-info">
          {card.title}
        </p>
        <Media media={media} className="h-40" />
      </div>
    )
  return (
    <div className="flex max-w-sm overflow-hidden rounded-md border bg-muted/30">
      <span
        aria-hidden="true"
        className={cn('w-1 shrink-0', !card.color && 'bg-border')}
        style={card.color ? { backgroundColor: card.color } : undefined}
      />
      <div className="min-w-0 flex-1 space-y-1 p-3">
        {card.siteName && (
          <p className="break-words text-xs text-muted-foreground">
            {card.siteName}
          </p>
        )}
        {card.author && (
          <p className="break-words text-xs font-semibold">{card.author}</p>
        )}
        <p className="break-words text-sm font-medium text-info">
          {card.title}
        </p>
        {card.description && (
          <p className="whitespace-pre-line break-words text-xs">
            {card.description}
          </p>
        )}
        {media && (
          <div className="pt-2">
            <Media media={media} className="h-36" />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * How a link previews where it is pasted, drawn from the card's templates
 * with the function that fills them in for crawlers. The two frames are
 * generic on purpose. Each stands for a kind of app, not for any one app.
 */
export function EmbedPreview({
  mode,
  card: templates,
  appearance,
  uploader = 'you',
}: {
  mode: EmbedMode
  card: EmbedCardTemplates
  appearance: Pick<AppearanceDocument, 'brand' | 'sharing'>
  uploader?: string
}) {
  const [kind, setKind] = useState<SampleKind>('image')
  // One upload date for as long as the preview is open.
  const [uploadedAt] = useState(() => new Date())
  const sample = SAMPLES[kind]
  const card = renderEmbedCard(
    templates,
    {
      name: sample.name,
      size: sample.size,
      mimeType: sample.mimeType,
      uploader,
      uploadedAt,
      views: 128,
    },
    appearance
  )
  const host = `${appearance.brand.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'your'}.example`

  return (
    <section className="space-y-4" aria-label="Embed preview">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-sm font-medium">Embed preview</h3>
        <div role="group" aria-label="Sample file" className="flex gap-1">
          {SAMPLE_KINDS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={kind === option ? 'secondary' : 'ghost'}
              className={cn(
                'h-7 px-2.5',
                kind !== option && 'text-muted-foreground'
              )}
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
            >
              {SAMPLES[option].label}
            </Button>
          ))}
        </div>
      </div>
      <figure className="space-y-2">
        <figcaption className={captionClassName}>In a chat app</figcaption>
        <div className="flex gap-2.5 rounded-xl border bg-card p-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium"
          >
            Y
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-baseline gap-2 text-sm">
              <span className="font-medium">You</span>
              <span className="text-[11px] text-muted-foreground">now</span>
            </p>
            <p className="break-all text-sm text-info">
              https://{host}/a1b2c/{sample.name}
            </p>
            <ChatEmbed
              layout={embedLayout(mode, sample.media, true)}
              card={card}
              media={sample.media}
            />
          </div>
        </div>
      </figure>
      <figure className="space-y-2">
        <figcaption className={captionClassName}>As a link card</figcaption>
        <div className="max-w-sm overflow-hidden rounded-xl border bg-card">
          <Media media={sample.media} className="h-36 rounded-none" />
          <div className="space-y-1 p-3">
            <p className="line-clamp-2 break-words text-sm font-medium">
              {card.title}
            </p>
            {card.description && (
              <p className="line-clamp-3 whitespace-pre-line break-words text-xs text-muted-foreground">
                {card.description}
              </p>
            )}
            <p className="truncate text-[11px] text-muted-foreground">
              {card.siteName || host}
            </p>
          </div>
        </div>
      </figure>
      <p className="text-pretty text-xs text-muted-foreground">
        An approximation. Each app draws link previews its own way and keeps its
        own copy for a while.
      </p>
    </section>
  )
}
