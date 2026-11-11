import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  PublicHeader,
  publicColumnClassName,
} from '@/components/customization/share-layout'
import { SharedFolder } from '@/components/folders/shared-folder'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { pagePanelClassName } from '@/components/layout/page-header'

import { getConfig } from '@/lib/config'
import { showsShareFooter } from '@/lib/customization/sharing'
import { folderIdSchema } from '@/lib/folders/schema'
import { getSharedFolder } from '@/lib/folders/shared'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shared folder',
  description: 'Files shared with you in one place.',
  robots: { index: false, follow: false },
  // Only Flare itself receives this address (with the share token) as the
  // referrer. A file opened from here uses it to link back to the folder.
  referrer: 'same-origin',
}

/**
 * The folder a link shares, or with `folder` a folder below it. The key of a
 * folder that has keys is in the part of the address after `#`, which this
 * server never gets (docs/e2ee-spec.md, section 9.4.3): the page sends the
 * sealed records and the visitor's browser opens them.
 */
export default async function SharedFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ page?: string; folder?: string }>
}) {
  const { token } = await params
  const { page, folder } = await searchParams
  const requestedPage = page ? Number(page) : 1
  const below = folder === undefined ? null : folderIdSchema.safeParse(folder)
  if (
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    requestedPage > 100000 ||
    (below && !below.success)
  )
    notFound()
  const listing = await getSharedFolder(
    token,
    requestedPage,
    below?.success ? below.data : null
  )
  if (!listing || (listing.page > 1 && listing.page > listing.pageCount))
    notFound()
  const config = await getConfig()
  const appearance = config.settings.customization.published
  const { sharing } = appearance
  const showFooter = showsShareFooter(
    appearance,
    config.settings.general.credits.showFooter
  )

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
            <SharedFolder
              listing={listing}
              showFilename={sharing.showFilename}
              showSize={sharing.showSize}
            />
          </section>
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
