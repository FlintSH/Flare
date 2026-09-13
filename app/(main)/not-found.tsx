import Link from 'next/link'

import { InstanceBrand } from '@/components/customization/instance-brand'
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
          <InstanceBrand />
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
