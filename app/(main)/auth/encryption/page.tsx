import { AuthShell } from '@/components/auth/auth-shell'
import { KeySetupForm } from '@/components/encryption/key-setup-form'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Set up encryption · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default function KeySetupPage() {
  return (
    <AuthShell
      title="Set up encryption"
      description="Choose the passphrase that protects your account. Flare never receives it."
    >
      <KeySetupForm />
    </AuthShell>
  )
}
