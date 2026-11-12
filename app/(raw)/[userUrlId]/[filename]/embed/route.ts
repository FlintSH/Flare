import { setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { identifyCrawler } from '@/lib/embeds/crawlers'
import { embedHtml } from '@/lib/embeds/document'
import { embedFileFields, fileEmbed } from '@/lib/embeds/file-embed'
import { requestOrigin } from '@/lib/embeds/origin'
import { ownerEmbed } from '@/lib/embeds/owner'
import { checkFileAccess } from '@/lib/files/access'
import { findFile } from '@/lib/files/delivery'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { clientIp } from '@/lib/security/client-ip'
import { getStorageProvider } from '@/lib/storage'

type Context = { params: Promise<{ userUrlId: string; filename: string }> }

const api = routes('/[userUrlId]/[filename]/embed', {
  failure: { message: 'Internal server error' },
  logger: loggers.files,
})

// The answer depends on who asks and on settings that change, and an app
// keeps its own copy of the preview anyway.
const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'User-Agent',
}

// The page is tags and one link. Nothing in it may load or run, even if a
// value ever got past the escaping.
const pageHeaders = {
  ...headers,
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; sandbox",
}

/**
 * What a link-preview fetcher gets for a share link, which the proxy sends
 * here: the file itself where the app shows that on its own, and otherwise a
 * small page of preview tags. Opened directly, it shows the card any app gets.
 */
export const GET = api(
  async (request, { params }: Context) => {
    const { userUrlId, filename } = await params
    const password = new URL(request.url).searchParams.get('password')
    const [session, file, config, storage] = await Promise.all([
      getAccessSession(),
      findFile({ userUrlId, filename }, embedFileFields),
      getConfig(),
      getStorageProvider(),
    ])
    if (!file) return new Response(null, { status: 404, headers })
    setAuditTarget({ type: 'file', id: file.id, name: file.name })
    const access = await checkFileAccess(file, session, password, {
      requester: clientIp(request.headers),
    })
    if (!access.allowed) setAuditOutcome('denied')
    const appearance = config.settings.customization.published
    const embed = fileEmbed({
      file,
      ownerId: userUrlId,
      personal: access.allowed
        ? await ownerEmbed(file, appearance.sharing)
        : null,
      access,
      password,
      origin: requestOrigin(request.headers),
      appearance,
      signedStorage: storage.kind === 's3',
      crawler: identifyCrawler(request.headers.get('user-agent')),
    })
    if (embed.kind === 'missing')
      return new Response(null, { status: 404, headers })
    if (embed.kind === 'redirect')
      return new Response(null, {
        status: 307,
        headers: { ...headers, Location: embed.location },
      })
    return new Response(embedHtml(embed.document), { headers: pageHeaders })
  },
  { audit: { action: 'file.embed', category: 'files' } }
)
