import Link from 'next/link'

import { FileCheck2 } from 'lucide-react'

import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

import type { AppearanceDocument, ShareStyle } from '@/lib/customization/schema'
import { cn } from '@/lib/utils'

import { InstanceBrand } from './instance-brand'

export function ShareLayout({
  appearance,
  style,
  filename,
  size,
  uploader,
  isMedia,
  showFooter,
  children,
}: {
  appearance: AppearanceDocument
  style: ShareStyle
  filename: string
  size: string
  uploader: { name: string; image?: string }
  isMedia: boolean
  showFooter: boolean
  children: React.ReactNode
}) {
  const { sharing } = appearance
  const author = sharing.showUploader && (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-9 w-9 shrink-0 border border-border/70">
        <AvatarImage src={uploader.image} alt="" />
        <AvatarFallback className="text-xs">
          {uploader.name.charAt(0) || '?'}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">Shared by</p>
        <p className="max-w-44 truncate text-sm font-medium">{uploader.name}</p>
      </div>
    </div>
  )
  const details = (
    <div className="min-w-0 space-y-2">
      {sharing.showFilename ? (
        <h1 className="break-words text-xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
          {filename}
        </h1>
      ) : (
        <h1 className="sr-only">Shared file</h1>
      )}
      {sharing.showSize && (
        <p className="text-sm text-muted-foreground">{size}</p>
      )}
    </div>
  )

  return (
    <div
      className="relative isolate flex min-h-dvh min-w-0 flex-col"
      data-share-style={style}
    >
      <DynamicBackground />
      <header
        className={cn(
          'relative z-10 mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8',
          style === 'minimal' && 'border-b border-border/50'
        )}
      >
        <Link
          href="/dashboard"
          className="inline-flex min-w-0 max-w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open your dashboard"
        >
          <InstanceBrand />
        </Link>
        {style !== 'delivery' && author}
      </header>
      <main
        className={cn(
          'relative z-10 mx-auto flex w-full min-w-0 flex-1 flex-col justify-center px-4 py-6 sm:px-8 sm:py-10',
          isMedia ? 'max-w-6xl' : 'max-w-5xl',
          style === 'delivery' && 'justify-start'
        )}
      >
        {style === 'minimal' ? (
          <div className="min-w-0 space-y-6">
            {(sharing.showFilename || sharing.showSize) && (
              <div className="px-1">{details}</div>
            )}
            {!sharing.showFilename && !sharing.showSize && (
              <h1 className="sr-only">Shared file</h1>
            )}
            {children}
          </div>
        ) : (
          <section
            className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
            data-flare-surface
          >
            <div
              className={cn(
                'flex flex-col items-start justify-between gap-5 border-b border-border/60 p-5 sm:flex-row sm:items-center sm:p-7',
                style === 'delivery' && 'bg-muted/20',
                !sharing.showFilename &&
                  !sharing.showSize &&
                  style !== 'delivery' &&
                  'sr-only'
              )}
            >
              <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                {style === 'delivery' && (
                  <p className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
                    <FileCheck2 className="h-4 w-4" aria-hidden="true" />A file
                    for you
                  </p>
                )}
                {details}
              </div>
              {style === 'delivery' && author}
            </div>
            {children}
          </section>
        )}
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
