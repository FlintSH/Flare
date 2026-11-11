import { DashboardWrapper } from '@/components/dashboard/dashboard-wrapper'

import { getPageSession, requireAccountKeys } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getPageSession()
  await requireAccountKeys(session?.user?.id)
  const config = await getConfig()
  const maxSizeBytes = maxUploadBytes(config)

  return (
    <DashboardWrapper
      showFooter={config.settings.general.credits.showFooter}
      maxUploadSize={maxSizeBytes}
    >
      {children}
    </DashboardWrapper>
  )
}
