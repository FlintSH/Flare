import { DashboardWrapper } from '@/components/dashboard/dashboard-wrapper'

import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'

import { requireDashboardPage } from './page-access'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Reject signed-out/email-gated requests before the workspace shell or
  // any known child page's loading boundary can stream.
  await requireDashboardPage('/dashboard/profile')
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
