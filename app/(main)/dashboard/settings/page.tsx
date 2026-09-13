import { redirect } from 'next/navigation'

import { InstanceSettings } from '@/components/settings/instance-settings'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { isAppearanceRecovery } from '@/lib/customization/recovery'
import { prisma } from '@/lib/database/prisma'
import { redactEmailConfig } from '@/lib/email/config'
import {
  SETTINGS_SECTIONS,
  readPreferenceSection,
} from '@/lib/preferences/navigation'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>
}) {
  const session = await getPageSession()
  if (!session?.user?.id) redirect('/auth/login')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (user?.role !== 'ADMIN') redirect('/dashboard/profile')
  const [config, recovery, params] = await Promise.all([
    getConfig(),
    isAppearanceRecovery(),
    searchParams,
  ])
  return (
    <InstanceSettings
      initialConfig={{
        ...config,
        settings: {
          ...config.settings,
          email: redactEmailConfig(config.settings.email),
        },
      }}
      initialSection={readPreferenceSection(
        params.section,
        SETTINGS_SECTIONS,
        'general'
      )}
      recovery={recovery}
    />
  )
}
