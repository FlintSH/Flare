import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { SetupWizard } from '@/components/setup/setup-wizard'

import { getAuthOptions } from '@/lib/auth'
import { checkSetupCompletion } from '@/lib/database/setup'
import { getDocumentationUrl } from '@/lib/documentation'
import { getEmailConfig } from '@/lib/email/config'
import { hasPermission } from '@/lib/permissions/catalog'
import { getBuildInfo } from '@/lib/releases'
import { getSetupSignInPath, getSetupStep } from '@/lib/setup/navigation'

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>
}) {
  const documentationUrl = getDocumentationUrl(getBuildInfo(), 'setup')
  if (!(await checkSetupCompletion()))
    return <SetupWizard documentationUrl={documentationUrl} />
  const { step } = await searchParams
  const session = await getServerSession(await getAuthOptions())
  if (!session?.user?.id) redirect(getSetupSignInPath(step))
  if (!hasPermission(session.user, 'administrator')) redirect('/dashboard')
  const email = await getEmailConfig()
  return (
    <SetupWizard
      documentationUrl={documentationUrl}
      configured
      initialStep={getSetupStep(step)}
      initialEmailEnabled={email.enabled}
      initialEmailRecoveryEnabled={email.enabled && email.recovery.enabled}
    />
  )
}
