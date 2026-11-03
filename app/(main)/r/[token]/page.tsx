import { cache } from 'react'

import type { Metadata } from 'next'

import { Inbox } from 'lucide-react'

import {
  PublicHeader,
  publicColumnClassName,
} from '@/components/customization/share-layout'
import { RequestDrop } from '@/components/file-requests/request-drop'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { pagePanelClassName } from '@/components/layout/page-header'

import { getConfig } from '@/lib/config'
import { FILE_REQUEST_LINK_MESSAGES } from '@/lib/file-requests/policy'
import { inspectFileRequest } from '@/lib/file-requests/service'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Metadata and the page share one lookup per request.
const inspect = cache(inspectFileRequest)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const inspection = await inspect(token)
  return {
    title:
      inspection.status === 'open' ? inspection.request.title : 'File request',
    description:
      inspection.status === 'open' && inspection.request.ownerName
        ? `Send files to ${inspection.request.ownerName}.`
        : 'Send files with this link.',
    robots: { index: false, follow: false },
    // The link is the only key to this page; never pass it on as a referrer.
    referrer: 'no-referrer',
  }
}

export default async function FileRequestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const inspection = await inspect(token)
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
          <div className="mx-auto w-full max-w-2xl">
            {inspection.status === 'open' ? (
              <RequestDrop token={token} request={inspection.request} />
            ) : (
              <section
                className={cn(pagePanelClassName, 'px-6 py-14 text-center')}
                data-flare-surface
              >
                <Inbox
                  className="mx-auto mb-4 h-10 w-10 text-muted-foreground"
                  aria-hidden="true"
                />
                <h1 className="text-xl font-semibold tracking-tight">
                  {FILE_REQUEST_LINK_MESSAGES[inspection.status].title}
                </h1>
                <p className="mx-auto mt-2 max-w-sm text-pretty text-sm text-muted-foreground">
                  {FILE_REQUEST_LINK_MESSAGES[inspection.status].description}
                </p>
              </section>
            )}
          </div>
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
