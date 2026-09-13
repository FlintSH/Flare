import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ArrowLeft } from 'lucide-react'

import { WorkspacePage } from '@/components/dashboard/page-shell'
import { PasteForm } from '@/components/dashboard/paste-form'
import { Button } from '@/components/ui/button'

import { getPageSession } from '@/lib/auth/page-session'

export default async function PastePage() {
  const session = await getPageSession()

  if (!session?.user) {
    redirect('/auth/login')
  }

  return (
    <WorkspacePage
      title="Create a paste"
      description="Give your code, notes, or plain text a home and a link to share."
      actions={
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            File library
          </Link>
        </Button>
      }
    >
      <PasteForm />
    </WorkspacePage>
  )
}
