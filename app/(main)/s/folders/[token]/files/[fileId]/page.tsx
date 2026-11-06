import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import {
  FILE_PASSWORD_DESCRIPTION,
  FILE_PASSWORD_TITLE,
  FilePasswordForm,
  filePasswordProblem,
} from '@/components/auth/file-password-form'
import { PublicState } from '@/components/auth/public-state'
import { Footer } from '@/components/layout/footer'

import { getConfig } from '@/lib/config'
import { checkPageAccess, findFile } from '@/lib/files/delivery'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Protected file',
  description: 'This file is protected.',
  robots: { index: false, follow: false },
  // Only Flare itself receives this address (with the share token) as the
  // referrer. The file page uses it to link back to the folder.
  referrer: 'same-origin',
}

export default async function SharedFolderFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; fileId: string }>
  searchParams: Promise<{ password?: string | string[] }>
}) {
  const { token, fileId } = await params
  const { password: providedPassword } = await searchParams
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(token) ||
    (providedPassword !== undefined && typeof providedPassword !== 'string')
  ) {
    notFound()
  }

  // Looked up again on every request, including password submissions, so an
  // old tile can't grant access after a move or revoke.
  const file = await findFile(
    { id: fileId, sharedFolder: token },
    {
      id: true,
      userId: true,
      visibility: true,
      password: true,
      urlPath: true,
      folder: { select: { name: true } },
    }
  )
  if (!file) notFound()

  const { access } = await checkPageAccess(file, providedPassword)
  if (access.allowed) {
    // Only reveal the canonical filename after access succeeds. The existing
    // viewer independently applies file access checks again at the destination.
    const urlPath = file.urlPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const query = providedPassword
      ? `?${new URLSearchParams({ password: providedPassword })}`
      : ''
    redirect(`${urlPath}${query}`)
  }
  if (access.reason === 'private') notFound()

  const config = await getConfig()
  const showFooter =
    config.settings.customization.published.sharing.showFooter ??
    config.settings.general.credits.showFooter
  const opaquePath = `/s/folders/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`

  return (
    <PublicState
      title={FILE_PASSWORD_TITLE}
      description={FILE_PASSWORD_DESCRIPTION}
      footer={showFooter ? <Footer /> : undefined}
      backLink={
        file.folder && {
          href: `/s/folders/${encodeURIComponent(token)}`,
          label: file.folder.name,
        }
      }
    >
      <FilePasswordForm
        action={opaquePath}
        problem={filePasswordProblem(access)}
      />
    </PublicState>
  )
}
