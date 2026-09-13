import { LoginForm } from '@/components/auth/login-form'
import { OidcAutoRedirect } from '@/components/auth/oidc-auto-redirect'
import { InstanceBrand } from '@/components/customization/instance-brand'
import { DynamicBackground } from '@/components/layout/dynamic-background'

import { isOidcProviderConfigured } from '@/lib/auth'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<{ local?: string; error?: string }>
}

export default async function LoginPage({
  searchParams,
}: Readonly<LoginPageProps>) {
  const config = await getConfig()
  const { local, error } = await searchParams
  const registrationsEnabled = config.settings.general.registrations.enabled
  const oidc = config.settings.general.oidc
  const oidcConfigured = isOidcProviderConfigured(oidc)
  const oidcAutoRedirect = oidcConfigured && oidc.enforceSso && local !== '1'

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
              {oidcAutoRedirect ? (
                <OidcAutoRedirect
                  buttonText={oidc.buttonText}
                  errorCode={error}
                />
              ) : (
                <LoginForm
                  registrationsEnabled={registrationsEnabled}
                  disabledMessage={
                    config.settings.general.registrations.disabledMessage
                  }
                  oidcEnabled={oidcConfigured}
                  oidcButtonText={oidc.buttonText}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
