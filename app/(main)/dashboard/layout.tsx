import { DashboardWrapper } from '@/components/dashboard/dashboard-wrapper'
import { ResumeAgentSignIn } from '@/components/integrations/resume-agent-sign-in'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'
import { hasPermission } from '@/lib/permissions/catalog'
import { savedUploadSettings } from '@/lib/uploads/saved-settings'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getPageSession()
  const config = await getConfig()
  const maxSizeBytes = maxUploadBytes(config)
  // Drop and paste say what an upload will get before it starts.
  const saved =
    session?.user && hasPermission(session.user, 'files.upload')
      ? await savedUploadSettings(session.user.id)
      : null

  return (
    <>
      <ResumeAgentSignIn />
      <DashboardWrapper
        showFooter={config.settings.general.credits.showFooter}
        maxUploadSize={maxSizeBytes}
        saved={saved}
        features={{ agents: config.settings.general.mcp.enabled }}
      >
        {children}
      </DashboardWrapper>
    </>
  )
}
