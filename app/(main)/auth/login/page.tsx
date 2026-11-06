import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { OidcAutoRedirect } from '@/components/auth/oidc-auto-redirect'

import { isLocalSignIn } from '@/lib/auth/sign-in'
import { getConfig } from '@/lib/config'
import { isOidcProviderConfigured } from '@/lib/config/oidc'
import { getEmailCapabilities } from '@/lib/email/config'
import { SETUP_PATH } from '@/lib/setup/navigation'
import { pageSetupStatus } from '@/lib/setup/status'

export const dynamic = 'force-dynamic'

interface LoginPageProps {
  searchParams: Promise<{ local?: string; error?: string }>
}

export default async function LoginPage({
  searchParams,
}: Readonly<LoginPageProps>) {
  const [config, params, recoveryEnabled, setupComplete] = await Promise.all([
    getConfig(),
    searchParams,
    // Unreadable email settings offer no recovery link rather than no sign-in.
    getEmailCapabilities().then(
      (email) => email.recoveryEnabled,
      () => false
    ),
    pageSetupStatus(),
  ])
  if (setupComplete === false) redirect(SETUP_PATH)
  const registrationsEnabled = config.settings.general.registrations.enabled
  const oidc = config.settings.general.oidc
  const oidcConfigured = isOidcProviderConfigured(oidc)
  const oidcAutoRedirect =
    oidcConfigured && oidc.enforceSso && !isLocalSignIn(params)

  return (
    <AuthShell
      title={
        oidcAutoRedirect
          ? params.error
            ? 'Sign-in failed'
            : 'Redirecting to sign-in'
          : 'Welcome back'
      }
      description={
        oidcAutoRedirect
          ? 'Use your organization’s sign-in to access your space.'
          : 'Sign in to your account.'
      }
    >
      {oidcAutoRedirect ? (
        <OidcAutoRedirect
          buttonText={oidc.buttonText}
          errorCode={params.error}
        />
      ) : (
        <LoginForm
          registrationsEnabled={registrationsEnabled}
          disabledMessage={
            config.settings.general.registrations.disabledMessage
          }
          oidcEnabled={oidcConfigured}
          oidcButtonText={oidc.buttonText}
          recoveryEnabled={recoveryEnabled}
        />
      )}
    </AuthShell>
  )
}
