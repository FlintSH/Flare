import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { SetupEmail } from '@/components/email/setup-email'

import { getAuthOptions } from '@/lib/auth'

export default async function SetupEmailPage() {
  const session = await getServerSession(await getAuthOptions())
  if (!session?.user) redirect('/auth/login?local=1')
  if (session.user.role !== 'ADMIN') redirect('/dashboard')
  return <SetupEmail />
}
