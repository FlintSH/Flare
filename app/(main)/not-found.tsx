import Link from 'next/link'

import { Icons } from '@/components/shared/icons'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function NotFound() {
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
            <CardTitle className="text-7xl font-bold">404</CardTitle>
            <CardDescription className="text-xl mt-2">
              Page Not Found
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </div>
  )
}
