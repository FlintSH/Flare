import { EmailAuthCard } from '@/components/email/auth-card'
import { ForgotPasswordForm } from '@/components/email/auth-forms'

export const metadata = {
  title: 'Reset your password · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default function ForgotPasswordPage() {
  return (
    <EmailAuthCard
      title="Forgot your password?"
      description="Enter your account email and we will send a reset link if recovery is available for it."
    >
      <ForgotPasswordForm />
    </EmailAuthCard>
  )
}
