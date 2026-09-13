import Link from 'next/link'

import { ArrowRight } from 'lucide-react'

import { PublicState } from '@/components/auth/public-state'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <PublicState
      statusCode="404"
      title="Page not found"
      description="The link may have changed, the file may have expired, or you may not have access to it. Check the address or head back to your files."
    >
      <Button asChild className="w-full">
        <Link href="/dashboard">
          Go to your files
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Expecting a shared file? Ask its owner for a new link.
      </p>
    </PublicState>
  )
}
