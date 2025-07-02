import { LoginForm } from '@/components/auth/login-form'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Icons } from '@/components/shared/icons'

import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const config = await getConfig()
  const registrationsEnabled = config.settings.general.registrations.enabled

  return (
    <main className="relative min-h-[calc(100vh-57px)] overflow-hidden">
      <DynamicBackground />

      <div className="relative z-10 flex min-h-[calc(100vh-57px)] flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-[400px] space-y-8">
          {/* logo container */}
          <div className="flex flex-col items-center justify-center">
            <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
              <div className="relative flex items-center justify-center space-x-3 px-6 py-4">
                <Icons.logo className="h-8 w-8 text-primary" />
                <span className="flare-text text-2xl text-primary">Flare</span>
              </div>
            </div>
          </div>

          {/* form container */}
          <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
            <div className="relative p-8">
              <LoginForm
                registrationsEnabled={registrationsEnabled}
                disabledMessage={
                  config.settings.general.registrations.disabledMessage
                }
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
