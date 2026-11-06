import Link from 'next/link'

import { ArrowRight } from 'lucide-react'

import { PublicState } from '@/components/auth/public-state'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'

import { getConfig } from '@/lib/config'

// Visitors land here from expired, private or mistyped share links, so the
// page follows the share pages' footer setting.
async function shareFooterVisible() {
  const config = await getConfig()
  return (
    config.settings.customization.published.sharing.showFooter ??
    config.settings.general.credits.showFooter
  )
}

export default async function NotFound() {
  return (
    <PublicState
      statusCode="404"
      title="Page not found"
      description="The link may have changed, the file may have expired, or you may not have access to it. Check the address or head back to your files."
      footer={(await shareFooterVisible()) ? <Footer /> : undefined}
    >
      <Button asChild className="h-11 w-full">
        <Link href="/dashboard">
          Go to your files
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Expecting a shared file? Ask its owner for a new link.
      </p>
    </PublicState>
  )
}
