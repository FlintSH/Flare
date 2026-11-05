import { redirect } from 'next/navigation'

import { InstanceSettings } from '@/components/settings/instance-settings'

import { getPageSession } from '@/lib/auth/page-session'
import { getConfig } from '@/lib/config'
import { redactSettings } from '@/lib/config/views'
import { isAppearanceRecovery } from '@/lib/customization/recovery'
import { everyoneCanInvite } from '@/lib/invites/service'
import { hasPermission } from '@/lib/permissions/catalog'
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
  const [config, recovery, params, inviteAccess] = await Promise.all([
    getConfig(),
    isAppearanceRecovery(),
    searchParams,
    everyoneCanInvite(),
  ])
  return (
    <InstanceSettings
      initialConfig={redactSettings(config)}
      initialSection={readPreferenceSection(
        params.section,
        SETTINGS_SECTIONS,
        'general',
        SETTINGS_SECTION_ALIASES
      )}
      buildInfo={getBuildInfo()}
      recovery={recovery}
      initialEveryoneCanInvite={inviteAccess}
    />
  )
}
