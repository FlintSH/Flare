import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { generatorProfile } from '@/lib/uploads/profiles'

import {
  SHARE_LINK_PATH,
  UPLOADER_DOWNLOAD_PERMISSION,
  type UploaderClientId,
  type UploaderOptions,
  uploaderClients,
} from '.'
import { bashScript, flameshotScript, spectacleScript } from './scripts'

/** The account a client's file uploads to. */
interface UploaderTarget {
  /** The public `/api/files` URL, selecting the profile when there is one. */
  uploadUrl: URL
  token: string
  profile: { id: string; name: string } | null
  /** The download's name starts with the account name, made header-safe. */
  filenameStem: string
}

/**
 * Installed tools upload to the public server URL: an http(s) URL without
 * credentials, query or fragment. A base path is kept.
 */
function publicUploadUrl() {
  const base =
    process.env.NEXTAUTH_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '')
  if (!base) throw new HttpError(500, 'Server configuration error')
  const invalid = new HttpError(500, 'Invalid server URL configuration')
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw invalid
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw invalid
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/files`
  return url
}

async function resolveUploaderTarget(
  userId: string,
  selectedProfileId: string | null | undefined
): Promise<UploaderTarget> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { uploadToken: true, name: true },
  })
  if (!user) throw new HttpError(404, 'User not found')
  const profile = await generatorProfile(userId, selectedProfileId)
  const uploadUrl = publicUploadUrl()
  if (profile) uploadUrl.searchParams.set('profileId', profile.id)
  return {
    uploadUrl,
    token: user.uploadToken,
    profile,
    filenameStem: (user.name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-'),
  }
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

const renderers: {
  [Id in UploaderClientId]: (
    target: UploaderTarget,
    options: UploaderOptions<Id>
  ) => string
} = {
  sharex: ({ uploadUrl, token }) =>
    json({
      Version: '15.0.0',
      Name: 'Flare',
      DestinationType: 'ImageUploader, TextUploader, FileUploader',
      RequestMethod: 'POST',
      RequestURL: uploadUrl.toString(),
      Headers: { Authorization: `Bearer ${token}` },
      Body: 'MultipartFormData',
      FileFormName: 'file',
      URL: `{json:${SHARE_LINK_PATH}}`,
      ThumbnailURL: `{json:${SHARE_LINK_PATH}}`,
      DeletionURL: '',
      ErrorMessage: '{json:error}',
    }),
  // iTake's .itup format reads the share link with a JSON dot path.
  itake: ({ uploadUrl, token, profile }) =>
    json({
      name: `Flare — ${profile?.name ?? 'Account defaults'}`,
      request: {
        url: uploadUrl.toString(),
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
      body: { type: 'multipart', fileField: 'file', fields: {} },
      response: { linkPath: SHARE_LINK_PATH },
    }),
  flameshot: flameshotScript,
  spectacle: spectacleScript,
  bash: bashScript,
}

/** Every client file is a credential: saved as a file and never cached. */
function uploaderDownload(
  body: string,
  { filename, contentType }: { filename: string; contentType: string }
) {
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

/**
 * POST bodies may also name the profile, as earlier dashboards did; it wins
 * over the query.
 */
const postedProfile = z.object({ profileId: z.string().max(100).optional() })

/**
 * A client's file for the signed-in account: its upload token, and the
 * profile in `?profileId=` instead of account defaults.
 */
export async function uploaderClientResponse<Id extends UploaderClientId>(
  id: Id,
  request: Request
): Promise<Response> {
  const { user } = await requireSession(UPLOADER_DOWNLOAD_PERMISSION)
  const client = uploaderClients[id]
  const body = client.method === 'POST' ? await readJson(request) : {}
  const { profileId } = postedProfile.parse(body)
  const options = client.options.parse(body)
  const target = await resolveUploaderTarget(
    user.id,
    profileId ?? new URL(request.url).searchParams.get('profileId')
  )
  return uploaderDownload(renderers[id](target, options), {
    filename: `${target.filenameStem}-${client.fileName(options)}`,
    contentType: client.contentType,
  })
}
