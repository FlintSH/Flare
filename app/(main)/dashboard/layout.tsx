import { DashboardWrapper } from '@/components/dashboard/dashboard-wrapper'

import { getConfig } from '@/lib/config'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const config = await getConfig()
  const { value, unit } = config.settings.general.storage.maxUploadSize
  const maxSizeBytes =
    value * (unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)

  return (
    <DashboardWrapper
      showFooter={config.settings.general.credits.showFooter}
      maxUploadSize={maxSizeBytes}
    >
      {children}
    </DashboardWrapper>
  )
}
