import type { ReactNode } from 'react'

import Link from 'next/link'

import { ArrowLeft, Clock } from 'lucide-react'

import { FileTypeIcon } from '@/components/file/file-type-icon'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'

import type { AppearanceDocument, ShareStyle } from '@/lib/customization/schema'
import { expiresSoon, expiryNotice } from '@/lib/files/expiry-notice'
import type { FileTypeInput } from '@/lib/files/file-kind'
import { cn } from '@/lib/utils'

import { InstanceBrand } from './instance-brand'

/**
 * The column shared by public pages: share pages, shared folders, password
 * prompts and the not-found page. It matches the dashboard's content column,
 * so headers, content and the footer share edges at every width.
 */
export const publicColumnClassName = 'mx-auto w-full min-w-0 max-w-7xl px-4'

/** A header chip: the instance brand, or the uploader on a share page. */
export const publicChipClassName =
  'inline-flex h-10 min-w-0 max-w-full items-center rounded-full border border-border/60 bg-panel px-3 shadow-sm sm:px-4'

/** The brand chip at the start of the row, with optional content at the end. */
export function PublicHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="relative z-20 pt-4 sm:pt-6">
      <div
        className={cn(
          publicColumnClassName,
          'flex items-center justify-between gap-2 sm:gap-4'
        )}
      >
        <Link
          href="/dashboard"
          className={cn(
            publicChipClassName,
            // The brand keeps its width; a long uploader name truncates first.
            // The flame carries a little space on its left, so the chip's
            // left padding is smaller to centre it optically.
            'max-w-[50%] shrink-0 pl-2.5 pr-3.5 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:pl-3.5 sm:pr-[1.125rem]'
          )}
        >
          <InstanceBrand />
        </Link>
        {children}
      </div>
    </header>
  )
}

export interface PublicBackLinkTarget {
  href: string
  label: string
}

/** Returns a visitor to the shared folder they opened a file from. */
export function PublicBackLink({ href, label }: PublicBackLinkTarget) {
  return (
    <div className="flex min-w-0">
      <Link
        href={href}
        prefetch={false}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Back to {label}</span>
      </Link>
    </div>
  )
}

/**
 * The tallest a preview grows, as `--stage-max`: what is left of the screen
 * after the page header, the file's own header and the footer, so the name,
 * the actions and the preview are in view together. Phones leave the footer
 * below the fold. Delivery's header is taller than the others'.
 */
function stageHeight(style: ShareStyle, showFooter: boolean) {
  if (style === 'delivery')
    return showFooter
      ? '[--stage-max:max(16rem,calc(100dvh-20rem))] sm:[--stage-max:max(18rem,calc(100dvh-21.5rem))]'
      : '[--stage-max:max(16rem,calc(100dvh-20rem))] sm:[--stage-max:max(18rem,calc(100dvh-15rem))]'
  return showFooter
    ? '[--stage-max:max(16rem,calc(100dvh-17rem))] sm:[--stage-max:max(18rem,calc(100dvh-18.5rem))]'
    : '[--stage-max:max(16rem,calc(100dvh-17rem))] sm:[--stage-max:max(18rem,calc(100dvh-12rem))]'
}

const eyebrowClassName =
  'text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground'

/**
 * A share page: the file's name, facts and actions, then its preview, as one
 * panel in the middle of the page.
 *
 * `compact` is for a file without a preview to give room to (audio and types
 * no viewer opens): a small card with everything centred. Every other file
 * gets a header row with the actions beside the name and the preview
 * (`children`) under it, at one width for every type.
 */
export function ShareLayout({
  appearance,
  style,
  file,
  filename,
  type,
  size,
  expiresAt,
  uploader,
  compact,
  showFooter,
  backLink,
  actions,
  children,
}: {
  appearance: AppearanceDocument
  style: ShareStyle
  /** The real name and type, which pick the icon even when the name is hidden. */
  file: FileTypeInput
  filename: string
  /** What the file is, such as "PNG image". */
  type: string
  size: string
  /** A scheduled expiry that is still ahead. */
  expiresAt?: Date | null
  uploader: { name: string; image?: string }
  compact: boolean
  showFooter: boolean
  backLink?: PublicBackLinkTarget | null
  actions: ReactNode
  children: ReactNode
}) {
  const { sharing } = appearance
  // A hidden filename leaves the file's type as its title.
  const title = sharing.showFilename ? filename : type
  const facts = [sharing.showFilename && type, sharing.showSize && size].filter(
    Boolean
  )
  const expiry = expiresAt && expiryNotice(expiresAt)

  const heading = (
    <h1
      className={cn(
        'break-words font-semibold leading-snug [overflow-wrap:anywhere]',
        compact
          ? 'text-balance text-lg'
          : 'line-clamp-2 text-[15px] sm:text-base'
      )}
      title={compact ? undefined : title}
    >
      {title}
    </h1>
  )
  const meta = (facts.length > 0 || expiry) && (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground',
        compact && 'justify-center'
      )}
    >
      {facts.map((fact, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          {fact}
        </span>
      ))}
      {expiry && expiresAt && (
        <span className="inline-flex items-center gap-1.5">
          {facts.length > 0 && <span aria-hidden="true">·</span>}
          <time
            dateTime={expiresAt.toISOString()}
            title={expiresAt.toUTCString()}
            className={cn(
              'inline-flex items-center gap-1 font-medium',
              expiresSoon(expiresAt) && 'text-warning'
            )}
          >
            <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {expiry}
          </time>
        </span>
      )}
    </p>
  )
  const icon = (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center border bg-muted/30 text-foreground',
        compact ? 'h-14 w-14 rounded-2xl' : 'h-10 w-10 rounded-lg'
      )}
    >
      <FileTypeIcon file={file} className={compact ? 'h-6 w-6' : 'h-5 w-5'} />
    </div>
  )
  const author = sharing.showUploader && (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-sm text-muted-foreground max-[359px]:sr-only">
        Uploaded by
      </span>
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={uploader.image} alt="" />
        <AvatarFallback className="text-xs">
          {uploader.name.charAt(0) || '?'}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 max-w-40 truncate text-sm font-medium">
        {uploader.name}
      </span>
    </div>
  )

  const delivery = style === 'delivery'
  const eyebrow = delivery && <p className={eyebrowClassName}>A file for you</p>

  // Minimal sets the file on the page itself; the others frame it in a card.
  const Panel = style === 'minimal' ? 'div' : Card

  const panel = compact ? (
    <Panel
      className={cn(
        'flex min-w-0 flex-col items-center gap-5 text-center',
        style === 'minimal' ? 'py-2' : 'p-6 sm:p-8'
      )}
      data-flare-surface={style === 'minimal' ? undefined : ''}
    >
      {eyebrow}
      {icon}
      <div className="min-w-0 max-w-full space-y-1.5">
        {heading}
        {meta}
      </div>
      {/* Delivery shows the uploader inside its card; the others use a
          header chip. */}
      {delivery && author}
      <div className="w-full min-w-0">{children}</div>
      {actions}
    </Panel>
  ) : (
    <Panel
      className={cn('min-w-0', style !== 'minimal' && 'overflow-hidden')}
      data-flare-surface={style === 'minimal' ? undefined : ''}
    >
      <div
        className={cn(
          'flex flex-col gap-3',
          style === 'minimal'
            ? 'pb-4'
            : 'border-b border-border/60 p-4 sm:px-5',
          delivery && 'sm:p-6'
        )}
      >
        {delivery && (
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
            {eyebrow}
            {author}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icon}
            <div className="min-w-0 flex-1 space-y-0.5">
              {heading}
              {meta}
            </div>
          </div>
          <div className="shrink-0">{actions}</div>
        </div>
      </div>
      <div
        className={cn(
          style === 'minimal' &&
            'overflow-hidden rounded-2xl border border-border/60 bg-panel shadow-sm'
        )}
        data-flare-surface={style === 'minimal' ? '' : undefined}
      >
        {children}
      </div>
    </Panel>
  )

  return (
    <div
      className="relative isolate flex min-h-dvh min-w-0 flex-col"
      data-share-style={style}
    >
      <DynamicBackground />
      <PublicHeader>
        {!delivery && author && (
          <div className={publicChipClassName}>{author}</div>
        )}
      </PublicHeader>
      {/* The footer brings its own space above it. */}
      <main
        className={cn(
          'relative z-10 flex min-w-0 flex-1 flex-col pt-5 sm:pt-6',
          !showFooter && 'pb-5 sm:pb-6'
        )}
      >
        {/* The panel sits in the middle of the space between the header and
            the footer; a taller one starts at the top and the page scrolls.
            A preview on a phone starts under the header instead, so its
            name and actions stay put while it loads and grows downward. */}
        <div
          className={cn(
            publicColumnClassName,
            'flex flex-1 flex-col',
            compact ? 'justify-center' : 'sm:justify-center'
          )}
        >
          <div
            className={cn(
              'mx-auto flex w-full min-w-0 flex-col gap-3',
              stageHeight(style, showFooter),
              compact ? 'max-w-md' : delivery ? 'max-w-7xl' : 'max-w-5xl'
            )}
          >
            {/* The way back to a shared folder sits right above the file it
                leads from. */}
            {backLink && <PublicBackLink {...backLink} />}
            {panel}
          </div>
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
