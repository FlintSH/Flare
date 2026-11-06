/** Rows per page when a request names no valid limit, and the most it may ask for. */
export interface PageSizes {
  defaultLimit: number
  maxLimit: number
}

const positiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value > 0

/**
 * The page of `total` rows a list request asked for. `page` and `limit` are
 * the query values as `Number()` reads them, so a missing value is 0. A value
 * that isn't a positive integer gets its default: page 1 and `defaultLimit`
 * rows. The limit is capped at `maxLimit` and the page at the last one; with
 * no rows that is page 1 of 0.
 */
export function pageWindow(
  total: number,
  requested: { page: number; limit: number },
  { defaultLimit, maxLimit }: PageSizes
) {
  const limit = positiveInteger(requested.limit)
    ? Math.min(requested.limit, maxLimit)
    : defaultLimit
  const pages = Math.ceil(total / limit)
  const page = Math.min(
    positiveInteger(requested.page) ? requested.page : 1,
    Math.max(1, pages)
  )
  return { page, pages, limit, skip: (page - 1) * limit }
}
