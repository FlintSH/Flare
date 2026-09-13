import { EmailAuthCard } from '@/components/email/auth-card'
import { VerifyEmailForm } from '@/components/email/auth-forms'

export const metadata = {
  title: 'Confirm your email · Flare',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return (
    <EmailAuthCard
      title="Confirm your email"
      description="Keep your account reachable and enable secure email recovery."
    >
      <VerifyEmailForm token={typeof token === 'string' ? token : ''} />
    </EmailAuthCard>
  )
}
