import { redirect } from 'next/navigation'

import { InstanceSettings } from '@/components/settings/instance-settings'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { isAppearanceRecovery } from '@/lib/customization/recovery'
import { redactEmailConfig } from '@/lib/email/config'
import { hasPermission } from '@/lib/permissions/catalog'
import { redactSettings } from '@/lib/permissions/settings'
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_ALIASES,
  readPreferenceSection,
} from '@/lib/preferences/navigation'
import { getBuildInfo } from '@/lib/releases'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const session = await getPageSession()
  if (!session?.user?.id) redirect('/auth/login')
  if (!hasPermission(session.user, 'settings.read'))
    redirect('/dashboard/profile')
  const [config, recovery, params] = await Promise.all([
    getConfig(),
    isAppearanceRecovery(),
    searchParams,
  ])
  return (
    <InstanceSettings
      initialConfig={redactSettings({
        ...config,
        settings: {
          ...config.settings,
          email: redactEmailConfig(config.settings.email),
        },
      })}
      initialSection={readPreferenceSection(
        params.section,
        SETTINGS_SECTIONS,
        'general',
        SETTINGS_SECTION_ALIASES
      )}
      buildInfo={getBuildInfo()}
      recovery={recovery}
    />
  )
}
