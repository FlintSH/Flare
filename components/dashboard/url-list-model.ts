import { type ShortLink, shortLinkUrl } from '@/lib/links/schema'

export type LinkSort = 'newest' | 'oldest' | 'clicks'

export const linkSortLabels: Record<LinkSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  clicks: 'Most clicks',
}

function searchable(value: string) {
  return value.normalize('NFKC').toLowerCase()
}

function destinationText(value: string) {
  try {
    return `${value}\n${decodeURI(value)}`
  } catch {
    return value
  }
}

/** A local view of the current account's complete, newest-first API collection. */
export function shortLinkListView(
  links: readonly ShortLink[],
  userId: string,
  query: string,
  sort: LinkSort,
  origin = ''
) {
  const own = links.filter((link) => link.userId === userId)
  const needle = searchable(query.trim())
  const matches = needle
    ? own.filter((link) =>
        searchable(
          `${destinationText(link.targetUrl)}\n${shortLinkUrl(link.shortCode, origin)}`
        ).includes(needle)
      )
    : own
  // The API supplies Newest first. Keep its original ordering, including ties,
  // and use that ordering to break ties in the other two stable views.
  const urls =
    sort === 'newest'
      ? matches
      : matches
          .map((link, index) => ({ link, index }))
          .sort(
            (left, right) =>
              (sort === 'clicks'
                ? right.link.clicks - left.link.clicks
                : Date.parse(left.link.createdAt) -
                  Date.parse(right.link.createdAt)) || left.index - right.index
          )
          .map(({ link }) => link)
  return { urls, total: own.length }
}
