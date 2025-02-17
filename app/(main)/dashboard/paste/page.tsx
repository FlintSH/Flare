import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { PasteForm } from '@/components/dashboard/paste-form'

import { authOptions } from '@/lib/auth'

export default async function PastePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Create New Paste</h1>
        <PasteForm />
      </div>
    </div>
  )
}
