import { redirect } from 'next/navigation'

import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { UploadForm } from '@/components/upload/upload-form'

import { SIGN_IN_PATH } from '@/lib/auth/sign-in'
import { getConfig } from '@/lib/config'
import { maxUploadBytes } from '@/lib/config/limits'
import { folderDestination } from '@/lib/library/contract'
import { ownFolder, savedUploadSettings } from '@/lib/uploads/saved-settings'

import { requireDashboardPage } from '../page-access'

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string | string[] }>
}) {
  const session = await requireDashboardPage('/dashboard/upload')
  const requested = (await searchParams).folder
  const [saved, config, folder] = await Promise.all([
    savedUploadSettings(session.user.id),
    getConfig(),
    ownFolder(
      session.user.id,
      folderDestination(typeof requested === 'string' ? requested : null)
    ),
  ])
  if (!saved) redirect(SIGN_IN_PATH)

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
      />
    </section>
  )
}
