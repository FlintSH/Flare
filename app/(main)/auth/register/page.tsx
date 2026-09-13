import { notFound } from 'next/navigation'

import { AuthShell } from '@/components/auth/auth-shell'
import { RegisterForm } from '@/components/auth/register-form'

import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  const config = await getConfig()

  if (!config.settings.general.registrations.enabled) {
    notFound()
  }

  return (
    <AuthShell
      eyebrow="Make yourself at home"
      title="Create an account"
      description="A place for your files, pastes, and links. Start with a few details."
    >
      <RegisterForm />
    </AuthShell>
  )
}
