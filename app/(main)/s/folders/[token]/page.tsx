import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ArrowLeft, ArrowRight, FolderOpen, Lock } from 'lucide-react'

import {
  PublicHeader,
  publicColumnClassName,
} from '@/components/customization/share-layout'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { pagePanelClassName } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'

import { getConfig } from '@/lib/config'
import { getSharedFolder } from '@/lib/folders/shared'
import { cn, formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shared folder',
  description: 'Files shared with you in one place.',
  robots: { index: false, follow: false },
  // Only Flare itself receives this address (with the share token) as the
  // referrer. A file opened from here uses it to link back to the folder.
  referrer: 'same-origin',
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
      <PublicHeader />
      <main className="relative z-10 flex-1 pb-8 pt-5 sm:pt-[calc(1.5rem+6vh)]">
        <div className={publicColumnClassName}>
          <section
            className={cn(pagePanelClassName, 'overflow-hidden p-0 sm:p-0')}
            data-flare-surface
          >
            <div className="flex items-start gap-4 border-b border-border/60 p-6 sm:gap-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-muted/30 text-foreground sm:h-14 sm:w-14">
                <FolderOpen
                  className="h-6 w-6 sm:h-7 sm:w-7"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-[.2em] text-muted-foreground">
                  Shared folder
                </p>
                <h1 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                  {folder.name}
                </h1>
                <p className="text-balance text-sm text-muted-foreground">
                  {folder.total} {folder.total === 1 ? 'file' : 'files'} · Open
                  a file to preview or download it.
                </p>
              </div>
            </div>
            {folder.files.length ? (
              <ul className="grid grid-cols-1 gap-4 p-6 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {folder.files.map((file) => {
                  const image = file.mimeType?.startsWith('image/')
                    ? file.rawUrl
                    : null
                  const iconClassName =
                    'h-8 w-8 text-muted-foreground min-[480px]:h-10 min-[480px]:w-10'
                  return (
                    <li key={file.id} className="min-w-0">
                      <Link
                        href={file.href}
                        prefetch={false}
                        className="group flex h-full flex-col overflow-hidden rounded-xl border bg-muted/30 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {/* Previews keep one shape where tiles share a row; a
                            lone icon gets a short band on single-column phones. */}
                        <div
                          className={cn(
                            'relative flex items-center justify-center overflow-hidden border-b',
                            image
                              ? 'aspect-[4/3] bg-muted/50'
                              : 'h-24 bg-muted min-[480px]:aspect-[4/3] min-[480px]:h-auto dark:bg-muted/80'
                          )}
                        >
                          {image ? (
                            // Raw routes apply file access checks again if visibility changes.
                            <img
                              src={image}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : file.hasPassword ? (
                            <Lock
                              className={iconClassName}
                              aria-hidden="true"
                            />
                          ) : (
                            <FileTypeIcon
                              file={{
                                name: file.name,
                                mimeType: file.mimeType ?? '',
                              }}
                              className={iconClassName}
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
                              className="ml-auto h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
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
                  className="mx-auto mb-4 h-10 w-10 text-muted-foreground"
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
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4"
              >
                <p className="text-sm text-muted-foreground">
                  Page {folder.page} of {folder.pageCount}
                </p>
                <div className="flex gap-2">
                  {folder.page > 1 && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`?page=${folder.page - 1}`}>
                        <ArrowLeft aria-hidden="true" />
                        Previous
                      </Link>
                    </Button>
                  )}
                  {folder.page < folder.pageCount && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`?page=${folder.page + 1}`}>
                        Next
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                  )}
                </div>
              </nav>
            )}
          </section>
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
