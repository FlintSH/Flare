import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { OidcAutoRedirect } from '@/components/auth/oidc-auto-redirect'

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
    <AuthShell
      eyebrow="Your account"
      title={
        oidcAutoRedirect
          ? error
            ? 'Let’s try that again'
            : 'Continue to sign in'
          : 'Welcome back'
      }
      description={
        oidcAutoRedirect
          ? 'Use your organization’s sign-in to access your space.'
          : 'Sign in to pick up where you left off.'
      }
    >
      {oidcAutoRedirect ? (
        <OidcAutoRedirect buttonText={oidc.buttonText} errorCode={error} />
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
    </AuthShell>
  )
}
