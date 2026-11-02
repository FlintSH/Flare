'use client'

import Link from 'next/link'

import { RefreshCcw } from 'lucide-react'

import { PublicState } from '@/components/auth/public-state'
import { Button } from '@/components/ui/button'

// No footer: this boundary renders when loading the page failed, so it does
// not depend on instance settings that may be what failed.
export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PublicState
      statusCode="500"
      title="Something went wrong"
      description="We couldn’t load this page. Try again or return to your files."
    >
      <div className="flex flex-col gap-3">
        <Button className="h-11 w-full" onClick={() => reset()}>
          <RefreshCcw aria-hidden="true" />
          Try again
        </Button>
        <Button variant="outline" className="h-11 w-full" asChild>
          <Link href="/dashboard">Go to your files</Link>
        </Button>
      </div>
    </PublicState>
  )
}
