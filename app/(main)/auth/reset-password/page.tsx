import { EmailAuthCard } from '@/components/email/auth-card'
import { ResetPasswordForm } from '@/components/email/auth-forms'

export const metadata = {
  title: 'Choose a new password · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return (
    <EmailAuthCard
      title="Choose a new password"
      description="Your reset link can be used once. After resetting, sign in again with your new password."
    >
      <ResetPasswordForm token={typeof token === 'string' ? token : ''} />
    </EmailAuthCard>
  )
}
