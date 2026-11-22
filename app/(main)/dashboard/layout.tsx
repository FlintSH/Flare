import { DashboardWrapper } from '@/components/dashboard/dashboard-wrapper'
import { ResumeAgentSignIn } from '@/components/integrations/resume-agent-sign-in'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await getPageSession()
  const config = await getConfig()
  const maxSizeBytes = maxUploadBytes(config)

  return (
    <>
      <ResumeAgentSignIn />
      <DashboardWrapper
        showFooter={config.settings.general.credits.showFooter}
        maxUploadSize={maxSizeBytes}
      >
        {children}
      </DashboardWrapper>
    </>
  )
}
