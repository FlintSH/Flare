import Link from 'next/link'

import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Icons } from '@/components/shared/icons'

export function EmailAuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="relative min-h-[calc(100vh-57px)] overflow-hidden">
      <DynamicBackground />
      <div className="relative z-10 flex min-h-[calc(100vh-57px)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <Link
            href="/auth/login"
            className="flex items-center justify-center gap-3 text-primary"
          >
            <Icons.logo className="h-8 w-8" />
            <span className="flare-text text-2xl">Flare</span>
          </Link>
          <div className="space-y-6 rounded-2xl border border-white/20 bg-white/10 p-6 shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-black/10 sm:p-8">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
