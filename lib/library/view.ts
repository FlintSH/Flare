/** Device-local presentation only; never a server filter or share layout. */
export type LibraryView = 'gallery' | 'list'

export interface LibraryViewSnapshot {
  accountId: string
  view: LibraryView
}

export function parseLibraryView(value: unknown): LibraryView {
  return value === 'list' ? 'list' : 'gallery'
}

export function libraryViewStorageKey(accountId: string | null): string | null {
  return accountId
    ? `flare:library-view:${encodeURIComponent(accountId)}`
    : null
}

/** An old account's snapshot is never used during the next account's render. */
export function libraryViewForAccount(
  accountId: string | null,
  snapshot: LibraryViewSnapshot | null
): LibraryView {
  return accountId && snapshot?.accountId === accountId
    ? parseLibraryView(snapshot.view)
    : 'gallery'
}

export function libraryColumns(view: LibraryView, width: number): number {
  if (view === 'list') return 1
  return width >= 1280 ? 4 : width >= 1024 ? 3 : width >= 640 ? 2 : 1
}
