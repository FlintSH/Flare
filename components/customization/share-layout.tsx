import Link from 'next/link'

import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'

import type { AppearanceDocument, ShareStyle } from '@/lib/customization/schema'

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
  const details = (
    <>
      {sharing.showFilename ? (
        <h1 className="mx-auto max-w-[600px] break-words text-base font-medium leading-relaxed [overflow-wrap:anywhere]">
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
      <span className="shrink-0 text-sm text-muted-foreground">
        Uploaded by
      </span>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={uploader.image} alt="" />
        <AvatarFallback className="text-xs">
          {uploader.name.charAt(0) || '?'}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-40 truncate text-sm font-medium">
        {uploader.name}
      </span>
    </div>
  )
  const brand = (
    <Link
      href="/dashboard"
      className="inline-flex min-w-0 max-w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Open your dashboard"
    >
      <InstanceBrand />
    </Link>
  )

  if (style === 'minimal')
    return (
      <div
        className="relative isolate flex min-h-dvh min-w-0 flex-col"
        data-share-style="minimal"
      >
        <DynamicBackground />
        <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          {brand}
          {author}
        </header>
        <main className="relative z-10 mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col justify-center gap-5 p-4 sm:p-8">
          <div
            className={
              sharing.showFilename || sharing.showSize
                ? 'space-y-1 text-center'
                : 'sr-only'
            }
          >
            {details}
          </div>
          {children}
        </main>
        {showFooter && <Footer />}
      </div>
    )

  if (style === 'delivery')
    return (
      <div
        className="relative isolate flex min-h-dvh min-w-0 flex-col"
        data-share-style="delivery"
      >
        <DynamicBackground />
        <header className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          {brand}
        </header>
        <main className="relative z-10 mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-10 sm:px-6">
          <Card
            className="overflow-hidden border-border/70 bg-card/80 shadow-sm backdrop-blur-xl"
            data-flare-surface
          >
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
        </main>
        {showFooter && <Footer />}
      </div>
    )

  return (
    <div
      className="relative isolate flex min-h-dvh min-w-0 flex-col"
      data-share-style="framed"
    >
      <DynamicBackground />
      <header className="relative z-20 flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6">
        <div className="max-w-full rounded-xl border border-border/60 bg-card/70 px-4 py-2 shadow-sm backdrop-blur-xl">
          {brand}
        </div>
        {author && (
          <div className="ml-auto max-w-full rounded-xl border border-border/60 bg-card/70 px-4 py-2 shadow-sm backdrop-blur-xl">
            {author}
          </div>
        )}
      </header>
      <main className="relative z-10 flex min-w-0 flex-1 items-center justify-center px-4 py-6 sm:px-6">
        <Card
          className={`min-w-0 overflow-hidden border-border/60 bg-card/80 shadow-sm backdrop-blur-xl ${isMedia ? 'w-fit max-w-full' : 'w-fit max-w-full sm:max-w-3xl'}`}
          data-flare-surface
        >
          <div
            className={
              sharing.showFilename || sharing.showSize
                ? 'space-y-1 px-6 pb-3 pt-4 text-center'
                : 'sr-only'
            }
          >
            {details}
          </div>
          {children}
        </Card>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
