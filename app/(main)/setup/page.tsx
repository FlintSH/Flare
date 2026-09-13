import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { SetupWizard } from '@/components/setup/setup-wizard'

import { getAuthOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { checkSetupCompletion } from '@/lib/database/setup'
import { getEmailConfig } from '@/lib/email/config'
import { getSetupSignInPath, getSetupStep } from '@/lib/setup/navigation'

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>
}) {
  if (!(await checkSetupCompletion())) return <SetupWizard />
  const { step } = await searchParams
  const session = await getServerSession(await getAuthOptions())
  if (!session?.user?.id) redirect(getSetupSignInPath(step))
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (user?.role !== 'ADMIN') redirect('/dashboard')
  const email = await getEmailConfig()
  return (
    <SetupWizard
      configured
      initialStep={getSetupStep(step)}
      initialEmailEnabled={email.enabled}
      initialEmailRecoveryEnabled={email.enabled && email.recovery.enabled}
    />
  )
}
