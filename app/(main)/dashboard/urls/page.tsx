import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { URLsClient } from '@/components/dashboard/urls-client'

import { authOptions } from '@/lib/auth'

export default async function URLsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/auth/login')
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Glassmorphic header */}
        <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
          <div className="relative p-8">
            <h1 className="text-3xl font-bold">URL Shortener</h1>
            <p className="text-muted-foreground mt-2">
              Shorten long URLs and manage your links with custom aliases
            </p>
          </div>
        </div>

        {/* Glassmorphic URLs client container */}
        <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
          <div className="relative p-8">
            <URLsClient />
          </div>
        </div>
      </div>
    </div>
  )
}
