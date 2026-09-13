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
      {sharing.showFilename && (
        <h1 className="text-base font-medium text-foreground/90 truncate max-w-[600px] mx-auto">
          {filename}
        </h1>
      )}
      {sharing.showSize && (
        <p className="text-xs text-muted-foreground/60 font-medium">{size}</p>
      )}
    </>
  )
  const author = sharing.showUploader && (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Uploaded by</span>
      <Avatar className="h-8 w-8">
        <AvatarImage src={uploader.image} alt="" />
        <AvatarFallback>{uploader.name.charAt(0) || '?'}</AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium truncate max-w-40">
        {uploader.name}
      </span>
    </div>
  )

  if (style === 'minimal')
    return (
      <div
        className="relative min-h-screen flex flex-col"
        data-share-style="minimal"
      >
        <DynamicBackground />
        <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link href="/dashboard">
            <InstanceBrand />
          </Link>
          {author}
        </header>
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-8 flex flex-col justify-center gap-5">
          {(sharing.showFilename || sharing.showSize) && (
            <div className="text-center space-y-1">{details}</div>
          )}
          {children}
        </main>
        {showFooter && <Footer />}
      </div>
    )

  if (style === 'delivery')
    return (
      <div
        className="relative min-h-screen flex flex-col"
        data-share-style="delivery"
      >
        <DynamicBackground />
        <header className="max-w-6xl w-full mx-auto px-6 py-8">
          <Link href="/dashboard">
            <InstanceBrand />
          </Link>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pb-10">
          <Card
            className="overflow-hidden bg-background/70 backdrop-blur-xl"
            data-flare-surface
          >
            <div className="border-b p-6 sm:p-8 flex flex-wrap justify-between gap-5 items-center">
              <div className="min-w-0 space-y-2">
                <p className="text-xs uppercase tracking-[.2em] text-muted-foreground">
                  A file for you
                </p>
                {details}
              </div>
              {author}
            </div>
            <div className="py-8">{children}</div>
          </Card>
        </main>
        {showFooter && <Footer />}
      </div>
    )

  return (
    <div
      className="flex-1 relative min-h-screen overflow-hidden"
      data-share-style="framed"
    >
      <DynamicBackground />
      <div className="absolute top-6 left-6 z-20">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 rounded-xl" />
          <div className="relative bg-background/60 backdrop-blur-xl border border-border/50 rounded-xl px-4 py-2 shadow-lg shadow-black/5">
            <Link href="/dashboard" className="flex items-center space-x-2.5">
              <InstanceBrand />
            </Link>
          </div>
        </div>
      </div>
      {sharing.showUploader && (
        <div className="absolute top-24 sm:top-6 right-6 z-20">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 rounded-xl" />
            <div className="relative bg-background/60 backdrop-blur-xl border border-border/50 rounded-xl px-4 py-2 shadow-lg shadow-black/5">
              {author}
            </div>
          </div>
        </div>
      )}
      <main
        className={`flex items-center justify-center px-6 relative z-10 ${showFooter ? 'pb-24' : 'pb-6'} ${sharing.showUploader ? 'pt-40 sm:pt-28' : 'pt-28'}`}
        style={{ minHeight: 'calc(100vh - 7rem)' }}
      >
        <div className="relative max-w-full">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 rounded-2xl" />
          <Card
            className={`relative overflow-hidden bg-background/60 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5 ${isMedia ? 'max-w-[95vw]' : 'w-full sm:max-w-[50vw]'}`}
            data-flare-surface
          >
            {(sharing.showFilename || sharing.showSize) && (
              <div className="px-6 pt-4 pb-2">
                <div className="text-center space-y-1">{details}</div>
              </div>
            )}
            {children}
          </Card>
        </div>
        {showFooter && (
          <div className="fixed bottom-0 left-0 right-0 z-10">
            <Footer />
          </div>
        )}
      </main>
    </div>
  )
}
