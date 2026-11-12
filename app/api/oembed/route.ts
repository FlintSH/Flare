import { getConfig } from '@/lib/config'
import { embedFileFields, fileEmbedCard } from '@/lib/embeds/file-embed'
import { requestOrigin } from '@/lib/embeds/origin'
import { ownerEmbed } from '@/lib/embeds/owner'
import { findFile } from '@/lib/files/delivery'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'

const api = routes('/api/oembed', {
  failure: { message: 'Internal server error' },
})

/** The owner ID and name in a share link, or null when it isn't one. */
function shareLink(url: string | null, origin: string) {
  if (!url) return null
  try {
    const segments = new URL(url, origin).pathname.split('/')
    if (segments.length !== 3 || !segments[1] || !segments[2]) return null
    return {
      userUrlId: decodeURIComponent(segments[1]),
      filename: decodeURIComponent(segments[2]),
    }
  } catch {
    return null
  }
}

/**
 * The oEmbed description of a share link, which preview apps follow from the
 * page to read the author line. It answers only for a public file without a
 * password, as an anonymous visitor would see it, and says nothing the
 * file's preview doesn't.
 */
export const GET = api(async (request) => {
  const query = new URL(request.url).searchParams
  const format = query.get('format')
  if (format && format !== 'json')
    throw new HttpError(501, 'Only the json format is available.')
  const origin = requestOrigin(request.headers)
  const link = shareLink(query.get('url'), origin)
  const file = link && (await findFile(link, embedFileFields))
  if (!file || file.visibility !== 'PUBLIC' || file.password)
    throw new HttpError(404, 'Not found')
  const appearance = (await getConfig()).settings.customization.published
  const { card } = fileEmbedCard(
    file,
    appearance,
    await ownerEmbed(file, appearance.sharing)
  )
  return {
    version: '1.0',
    type: 'link',
    title: card.title,
    ...(card.author ? { author_name: card.author } : {}),
    ...(card.siteName
      ? { provider_name: card.siteName, provider_url: origin }
      : {}),
  }
})
