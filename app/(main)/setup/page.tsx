import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth'

import { SetupWizard } from '@/components/setup/setup-wizard'

import { getAuthOptions } from '@/lib/auth'
import { getDocumentationUrl } from '@/lib/documentation'
import { getEmailConfig } from '@/lib/email/config'
import { hasPermission } from '@/lib/permissions/catalog'
import { getBuildInfo } from '@/lib/releases'
import { getSetupSignInPath, getSetupStep } from '@/lib/setup/navigation'
import { isSetupComplete } from '@/lib/setup/status'

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>
}) {
  const documentationUrl = getDocumentationUrl(getBuildInfo(), 'setup')
  if (!(await isSetupComplete()))
    return <SetupWizard documentationUrl={documentationUrl} />
  const { step } = await searchParams
  const session = await getServerSession(await getAuthOptions())
  if (!session?.user?.id) redirect(getSetupSignInPath(step))
  if (!hasPermission(session.user, 'administrator')) redirect('/dashboard')
  const email = await getEmailConfig()
  return (
    <SetupWizard
      documentationUrl={documentationUrl}
      resumeStep={getSetupStep(step)}
      initialEmailEnabled={email.enabled}
      initialEmailRecoveryEnabled={email.enabled && email.recovery.enabled}
    />
  )
}
