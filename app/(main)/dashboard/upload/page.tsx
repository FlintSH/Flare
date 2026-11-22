import { redirect } from 'next/navigation'

import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { UploadForm } from '@/components/upload/upload-form'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'
import { folderDestination } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import { hasPermission } from '@/lib/permissions/catalog'
import { ownFolder, savedUploadSettings } from '@/lib/uploads/saved-settings'
import { hiddenTips } from '@/lib/users/tips'

import { requireDashboardPage } from '../page-access'

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string | string[] }>
}) {
  const session = await requireDashboardPage('/dashboard/upload')
  const requested = (await searchParams).folder
  const [saved, config, folder, hidden] = await Promise.all([
    savedUploadSettings(session.user.id),
    getConfig(),
    ownFolder(
      session.user.id,
      folderDestination(typeof requested === 'string' ? requested : null)
    ),
    hiddenTips(session.user.id),
  ])
  if (!saved) redirect(SIGN_IN_PATH)
  // Until hidden, the empty page points at what makes uploads automatic: a
  // profile, unless the account has one, and the screenshot tools.
  const profiles = hasPermission(session.user, 'uploadProfiles.manage')
  const tips = {
    profiles,
    createProfile: profiles && !saved.has.profiles,
    tools: allows(session.user, 'uploaderTools'),
  }

  return (
    <section aria-labelledby="upload-heading" className={pagePanelClassName}>
      <PageHeader
        className="mb-5 border-0 pb-0"
        actionsBesideTitle
        title={<span id="upload-heading">Upload</span>}
      />
      <UploadForm
        maxSize={maxUploadBytes(config)}
        saved={saved}
        folder={folder}
        tips={
          !hidden.includes('upload') && (tips.createProfile || tips.tools)
            ? tips
            : null
        }
      />
    </section>
  )
}
