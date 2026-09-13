import { notFound } from 'next/navigation'

import { RegisterForm } from '@/components/auth/register-form'
import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'

import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  const config = await getConfig()

  if (!config.settings.general.registrations.enabled) {
    notFound()
  }

  return (
    <main className="relative min-h-[calc(100vh-57px)] overflow-hidden">
      <DynamicBackground />

      <div className="relative z-10 flex min-h-[calc(100vh-57px)] flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-[400px] space-y-8">
          {}
          <div className="flex flex-col items-center justify-center">
            <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
              <div className="relative flex items-center justify-center space-x-3 px-6 py-4">
                <InstanceBrand
                  iconClassName="h-8 w-8 text-primary"
                  textClassName="text-2xl text-primary"
                />
              </div>
            </div>
          </div>

          {}
          <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
            <div className="relative p-8">
              <RegisterForm />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
