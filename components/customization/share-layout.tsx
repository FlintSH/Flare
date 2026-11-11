import type { ReactNode } from 'react'

import Link from 'next/link'

import { ArrowLeft } from 'lucide-react'

import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'

import type { AppearanceDocument, ShareStyle } from '@/lib/customization/schema'
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

export function ShareLayout({
  appearance,
  style,
  filename,
  size,
  uploader,
  isMedia,
  showFooter,
  backLink,
  children,
}: {
  appearance: AppearanceDocument
  style: ShareStyle
  filename: string
  size: string
  uploader: { name: string; image?: string }
  isMedia: boolean
  showFooter: boolean
  backLink?: PublicBackLinkTarget | null
  children: React.ReactNode
}) {
  const { sharing } = appearance
  const details = (
    <>
      {sharing.showFilename ? (
        <h1 className="mx-auto max-w-[600px] text-balance break-words text-base font-medium leading-relaxed [overflow-wrap:anywhere]">
          {filename}
        </h1>
      ) : (
        <h1 className="sr-only">Shared file</h1>
      )}
      {sharing.showSize && (
        <p className="text-xs font-medium text-muted-foreground">{size}</p>
      )}
    </>
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
  const detailsClassName =
    sharing.showFilename || sharing.showSize ? 'space-y-1 text-center' : ''

  // The way back to a shared folder sits right above the content it leads
  // from, including when that content is centred on the page.
  const back = backLink && <PublicBackLink {...backLink} />

  // Delivery shows the uploader inside its card; the others use a header chip.
  const page = (content: ReactNode, headerAuthor: ReactNode) => (
    <div
      className="relative isolate flex min-h-dvh min-w-0 flex-col"
      data-share-style={style}
    >
      <DynamicBackground />
      <PublicHeader>
        {headerAuthor && (
          <div className={publicChipClassName}>{headerAuthor}</div>
        )}
      </PublicHeader>
      <main className="relative z-10 flex min-w-0 flex-1 flex-col pb-8 pt-5 sm:pt-6">
        <div
          className={cn(publicColumnClassName, 'flex flex-1 flex-col gap-4')}
        >
          {content}
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  )

  if (style === 'minimal')
    return page(
      <div className="flex min-w-0 flex-1 flex-col gap-5 sm:pt-[6vh]">
        {back}
        <div className={detailsClassName || 'sr-only'}>{details}</div>
        {children}
      </div>,
      author
    )

  if (style === 'delivery')
    return page(
      <>
        {back}
        <Card className="min-w-0 overflow-hidden" data-flare-surface>
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-border/60 p-6 sm:p-8">
            <div className="min-w-0 space-y-2">
              <p className="text-xs uppercase tracking-[.2em] text-muted-foreground">
                A file for you
              </p>
              {details}
            </div>
            {author}
          </div>
          <div className="py-6 sm:py-8">{children}</div>
        </Card>
      </>,
      null
    )

  return page(
    // Near the top, like the folder, password and 404 pages, so opening a
    // file from a shared folder doesn't move the content down the page.
    <div className="flex min-w-0 flex-1 items-start justify-center sm:pt-[6vh]">
      <div
        className={cn(
          'flex min-w-0 max-w-full flex-col gap-3',
          !isMedia && 'sm:max-w-3xl lg:max-w-4xl'
        )}
      >
        {back}
        <Card
          className="w-fit min-w-0 max-w-full overflow-hidden"
          data-flare-surface
        >
          <div
            className={
              detailsClassName
                ? `${detailsClassName} px-6 pb-4 pt-3.5`
                : 'sr-only'
            }
          >
            {details}
          </div>
          {children}
        </Card>
      </div>
    </div>,
    author
  )
}
