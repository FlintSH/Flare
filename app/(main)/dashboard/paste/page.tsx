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
    <div className="container space-y-6">
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <h1 className="text-3xl font-bold">Create New Paste</h1>
          <p className="text-muted-foreground mt-2">
            Create text pastes with syntax highlighting
          </p>
        </div>
      </div>

      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative p-8">
          <PasteForm />
        </div>
      </div>
    </div>
  )
}
