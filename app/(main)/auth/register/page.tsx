import { notFound } from 'next/navigation'

import { RegisterForm } from '@/components/auth/register-form'
import { Icons } from '@/components/shared/icons'

import { getConfig } from '@/lib/config'

// This needs to be dynamic because database isn't always available during build
// if you have a better solution, please make a PR
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  const config = await getConfig()

  if (!config.settings.general.registrations.enabled) {
    notFound()
  }

  return (
    <main className="flex min-h-[calc(100vh-57px)] flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background/10 to-background/50">
      <div className="w-full max-w-[350px] space-y-6">
        <div className="flex flex-col items-center justify-center">
          <div className="flex items-center justify-center space-x-3 bg-primary/10 px-4 py-2 rounded-2xl">
            <Icons.logo className="h-8 w-8 text-primary" />
            <span className="flare-text text-2xl text-primary">Flare</span>
          </div>
        </div>
        <RegisterForm />
      </div>
    </main>
  )
}
