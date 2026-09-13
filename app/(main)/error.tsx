'use client'

import Link from 'next/link'

import { RefreshCcw, Unplug } from 'lucide-react'

import { PublicState } from '@/components/auth/public-state'
import { Button } from '@/components/ui/button'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PublicState
      icon={Unplug}
      eyebrow="Something went wrong"
      title="Let’s try that again"
      description="We couldn’t load this page. Try again in a moment, or return to your files to continue."
    >
      <div className="flex flex-col gap-3">
        <Button onClick={() => reset()}>
          <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Go to your files</Link>
        </Button>
      </div>
    </PublicState>
  )
}
