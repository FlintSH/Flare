import { cache } from 'react'

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import type { Prisma } from '@prisma/client'
import { Lock } from 'lucide-react'

import {
  FILE_PASSWORD_DESCRIPTION,
  FILE_PASSWORD_TITLE,
  FilePasswordForm,
  filePasswordProblem,
} from '@/components/auth/file-password-form'
import { PublicState } from '@/components/auth/public-state'
import { ShareLayout } from '@/components/customization/share-layout'
import { FileActions } from '@/components/file/file-actions'
import { ProtectedFile } from '@/components/file/protected-file'
import { isCompactKind } from '@/components/file/viewer/types'
import { Footer } from '@/components/layout/footer'

import { recordAudit } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import { resolveShareStyle } from '@/lib/customization/schema'
import { showsShareFooter } from '@/lib/customization/sharing'
import { embedMetadata } from '@/lib/embeds/document'
import { embedFileFields, fileEmbed } from '@/lib/embeds/file-embed'
import { requestOrigin } from '@/lib/embeds/origin'
import { ownerEmbed } from '@/lib/embeds/owner'
import { checkPageAccess, countView, findFile } from '@/lib/files/delivery'
import { recordedExpiry } from '@/lib/files/expiry-notice'
import {
  fileKind,
  fileTypeDescription,
  isTextKind,
} from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import { sharedFolderBackLink } from '@/lib/folders/shared'
import { getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface FilePageProps {
  params: Promise<{ userUrlId: string; filename: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

async function passwordParam(searchParams: FilePageProps['searchParams']) {
  const { password } = await searchParams
  return Array.isArray(password) ? password[0] : password
}

const sharedFileFields = {
  ...embedFileFields,
  path: true,
  uploadOptions: true,
  folderId: true,
  user: { select: { name: true, image: true, preferences: true } },
} satisfies Prisma.FileSelect

// The metadata and the page read the file once per request.
const findSharedFile = cache((userUrlId: string, filename: string) =>
  findFile({ userUrlId, filename }, sharedFileFields)
)

/**
 * The same preview a link-preview fetcher is sent, for browsers and for
 * fetchers Flare doesn't know by name.
 */
export async function generateMetadata({
  params,
  searchParams,
}: FilePageProps): Promise<Metadata> {
  const { userUrlId, filename } = await params
  const [config, requestHeaders, password, file, storage] = await Promise.all([
    getConfig(),
    headers(),
    passwordParam(searchParams),
    findSharedFile(userUrlId, filename),
    getStorageProvider(),
  ])
  if (!file) return {}

  const { access } = await checkPageAccess(file, password)
  const appearance = config.settings.customization.published
  const embed = fileEmbed({
    file,
    ownerId: userUrlId,
    personal: access.allowed
      ? await ownerEmbed(file, appearance.sharing)
      : null,
    access,
    password,
    origin: requestOrigin(requestHeaders),
    appearance,
    signedStorage: storage.kind === 's3',
    crawler: null,
  })
  return embed.kind === 'document' ? embedMetadata(embed.document) : {}
}

export default async function FilePage({
  params,
  searchParams,
}: FilePageProps) {
  const config = await getConfig()
  const appearance = config.settings.customization.published
  const showFooter = showsShareFooter(
    appearance,
    config.settings.general.credits.showFooter
  )
  const { userUrlId, filename } = await params
  const providedPassword = await passwordParam(searchParams)

  const file = await findSharedFile(userUrlId, filename)

  if (!file) {
    notFound()
  }

  const { session, access } = await checkPageAccess(file, providedPassword)

  await recordAudit({
    action: 'file.view',
    category: 'files',
    outcome: access.allowed ? 'success' : 'denied',
    actorId: session?.user?.id,
    actorName: session?.user?.name || 'Anonymous',
    targetType: 'file',
    targetId: file.id,
    targetName: file.name,
    route: '/[userUrlId]/[filename]',
    method: 'GET',
    details: access.allowed ? {} : { reason: access.reason },
  })

  if (!access.allowed) {
    if (access.reason === 'private') {
      notFound()
    }

    return (
      <PublicState
        icon={<Lock aria-hidden="true" />}
        title={FILE_PASSWORD_TITLE}
        description={FILE_PASSWORD_DESCRIPTION}
        footer={showFooter ? <Footer /> : undefined}
      >
        <FilePasswordForm
          action={fileUrls(file).page}
          problem={filePasswordProblem(access)}
        />
      </PublicState>
    )
  }

  // Only a visitor who may see the file adds a view; refusals never count.
  await countView(file.id)

  // From the real name, which the page may hide.
  const type = fileKind(file)
  const compact = isCompactKind(type.kind)

  // Send only viewer fields to the client. In particular, never serialize the
  // uploader profile or the stored password hash into a public page.
  const viewerFile = {
    id: file.id,
    name: appearance.sharing.showFilename ? file.name : 'Shared file',
    urlPath: file.urlPath,
    visibility: file.visibility,
    mimeType: file.mimeType,
    // Stored in megabytes. It only sizes a loading state, so a page that
    // hides the size doesn't send it either.
    ...(appearance.sharing.showSize && {
      size: Math.round(file.size * 1024 * 1024),
    }),
    ...type,
  }

  const backLink = await sharedFolderBackLink(
    file,
    (await headers()).get('referer')
  )

  return (
    <ShareLayout
      appearance={appearance}
      style={resolveShareStyle(
        file.uploadOptions,
        appearance.sharing.defaultStyle
      )}
      file={{ name: file.name, mimeType: file.mimeType }}
      filename={file.name}
      type={fileTypeDescription(file)}
      size={formatFileSize(file.size)}
      expiresAt={recordedExpiry(file.uploadOptions)}
      uploader={{
        name: file.user?.name || 'Anonymous',
        image: file.user?.image || undefined,
      }}
      compact={compact}
      showFooter={showFooter}
      backLink={backLink}
      actions={
        <FileActions
          file={viewerFile}
          verifiedPassword={providedPassword}
          showOcr={type.kind === 'image'}
          isTextBased={isTextKind(type.kind)}
          layout={compact ? 'stack' : 'toolbar'}
        />
      }
    >
      <ProtectedFile file={viewerFile} verifiedPassword={providedPassword} />
    </ShareLayout>
  )
}
