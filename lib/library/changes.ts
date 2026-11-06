import type { QueryClient } from '@tanstack/react-query'

/** The account queries that hold lists drawn from the library's files. */
export const LIBRARY_LISTS = {
  tags: 'vault-tags',
  folders: 'vault-folders',
  fileTypes: 'library-file-types',
} as const

export type LibraryList = (typeof LIBRARY_LISTS)[keyof typeof LIBRARY_LISTS]

const lists: readonly unknown[] = Object.values(LIBRARY_LISTS)
const openLibraries = new Set<() => void>()

/**
 * Shows a change to the library everywhere, once each: every open library
 * reloads its files, and the tag, folder and file type lists load again.
 * Resolves once the lists have loaded.
 */
export async function libraryChanged(client: QueryClient) {
  openLibraries.forEach((reload) => reload())
  await client.invalidateQueries({
    predicate: ({ queryKey }) => lists.includes(queryKey[0]),
  })
}

/** Calls `reload` after every library change until the returned function runs. */
export function onLibraryChange(reload: () => void) {
  openLibraries.add(reload)
  return () => {
    openLibraries.delete(reload)
  }
}
