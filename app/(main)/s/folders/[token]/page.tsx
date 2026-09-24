import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  ArrowLeft,
  ArrowRight,
  File,
  FolderOpen,
  Lock,
  Music,
  Video,
} from 'lucide-react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'

import { getConfig } from '@/lib/config'
import { getSharedFolder } from '@/lib/folders/shared'
import { formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shared folder',
  description: 'Files shared with you in one place.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function SharedFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { token } = await params
  const { page } = await searchParams
  const requestedPage = page ? Number(page) : 1
  if (
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    requestedPage > 100000
  )
    notFound()
  const folder = await getSharedFolder(token, requestedPage)
  if (!folder || (folder.page > 1 && folder.page > folder.pageCount)) notFound()
  const config = await getConfig()
  const { sharing } = config.settings.customization.published
  const showFooter =
    sharing.showFooter ?? config.settings.general.credits.showFooter

  return (
    <div className="relative isolate flex min-h-dvh min-w-0 flex-col">
      <DynamicBackground />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/dashboard"
          className="inline-flex max-w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open your dashboard"
        >
          <InstanceBrand />
        </Link>
      </header>
      <main className="relative z-10 mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-12 sm:px-6">
        <section
          className="overflow-hidden rounded-2xl border border-border/70 bg-card/85 shadow-sm backdrop-blur-xl"
          data-flare-surface
        >
          <div className="flex items-start gap-4 border-b border-border/60 p-5 sm:gap-5 sm:p-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary sm:h-14 sm:w-14">
              <FolderOpen
                className="h-6 w-6 sm:h-7 sm:w-7"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Shared folder
              </p>
              <h1 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
                {folder.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {folder.total} {folder.total === 1 ? 'file' : 'files'} · Open a
                file to preview or download
              </p>
            </div>
          </div>
          {folder.files.length ? (
            <ul className="grid grid-cols-1 gap-4 p-5 min-[480px]:grid-cols-2 md:grid-cols-3 sm:p-8 lg:grid-cols-4">
              {folder.files.map((file) => {
                const Icon = file.hasPassword
                  ? Lock
                  : file.mimeType?.startsWith('video/')
                    ? Video
                    : file.mimeType?.startsWith('audio/')
                      ? Music
                      : File
                const image =
                  !file.hasPassword && file.mimeType?.startsWith('image/')
                return (
                  <li key={file.id} className="min-w-0">
                    <Link
                      href={file.urlPath}
                      prefetch={false}
                      className="group block overflow-hidden rounded-xl border border-border/70 bg-background/45 outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-border/50 bg-muted/40">
                        {image ? (
                          // Raw routes apply file access checks again if visibility changes.
                          <img
                            src={`${file.urlPath}/raw`}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Icon
                            className="h-10 w-10 text-muted-foreground/70"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      <div className="space-y-1.5 p-3.5">
                        <h2
                          className="truncate text-sm font-medium"
                          title={sharing.showFilename ? file.name : undefined}
                        >
                          {sharing.showFilename || file.hasPassword
                            ? file.name
                            : 'Shared file'}
                        </h2>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {file.hasPassword ? (
                            <>
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              Password required
                            </>
                          ) : sharing.showSize && file.size !== null ? (
                            formatFileSize(file.size)
                          ) : (
                            'Open file'
                          )}
                          <ArrowRight
                            className="ml-auto h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="px-6 py-20 text-center">
              <FolderOpen
                className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60"
                aria-hidden="true"
              />
              <h2 className="font-medium">No shared files yet</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Files will appear here when they’re ready to share.
              </p>
            </div>
          )}
          {folder.pageCount > 1 && (
            <nav
              aria-label="Shared folder pages"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4 sm:px-8"
            >
              <p className="text-sm text-muted-foreground">
                Page {folder.page} of {folder.pageCount}
              </p>
              <div className="flex gap-2">
                {folder.page > 1 && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`?page=${folder.page - 1}`}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Previous
                    </Link>
                  </Button>
                )}
                {folder.page < folder.pageCount && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`?page=${folder.page + 1}`}>
                      Next
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
            </nav>
          )}
        </section>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
