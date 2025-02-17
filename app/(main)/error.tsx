'use client'

import Link from 'next/link'

import { RefreshCcw } from 'lucide-react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex-1 relative min-h-screen flex flex-col">
      <div className="absolute top-6 left-6">
        <Link href="/dashboard" className="flex items-center space-x-2.5">
          <Icons.logo className="h-6 w-6" />
          <span className="flare-text text-lg">Flare</span>
        </Link>
      </div>

      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader className="text-center">
            <CardTitle className="text-7xl font-bold">500</CardTitle>
            <CardDescription className="text-xl mt-2">
              Something went wrong
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <Button onClick={() => reset()} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
