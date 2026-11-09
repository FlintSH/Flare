/**
 * What the list API says about search, shared with the dashboard. Browser-safe:
 * imports only types.
 */
import type { TextSegment } from './text'

/** Where indexed text came from. */
export type ContentSource = 'ocr' | 'text' | 'pdf' | 'document' | 'archive'

export const CONTENT_SOURCE_LABELS: Record<ContentSource, string> = {
  ocr: 'Text in image',
  text: 'File text',
  pdf: 'PDF text',
  document: 'Document text',
  archive: 'Inside archive',
}

/** What the search index knows about a file. */
export type SearchIndexState =
  'waiting' | 'indexed' | 'empty' | 'failed' | 'skipped' | 'unsupported'

/** A list row's `searchIndex`. */
export interface FileSearchIndexInfo {
  state: SearchIndexState
  source: ContentSource | null
  /** Why there is no text, for empty, failed, skipped and unsupported files. */
  reason: string | null
}

/** Why a search result matched, as a list row's `match`. */
export interface FileMatch {
  /** A word of the search is in the filename. */
  name: boolean
  tags: { id: string; name: string }[]
  folder: { id: string; path: string } | null
  /** Indexed text that matched, around the first match. */
  content: { source: ContentSource; snippet: TextSegment[] } | null
  /** Archive members whose paths matched, up to three. */
  entries: { paths: TextSegment[][]; more: number } | null
  /**
   * Words of the search this file doesn't have. Only when no file had every
   * word and the list shows files with some of them.
   */
  missing: string[]
}

/** `GET /api/files/search-index`. */
export interface SearchIndexSummary {
  total: number
  counts: Record<SearchIndexState, number>
  /** What this instance reads: image text follows the OCR setting. */
  reads: { imageText: boolean; documents: boolean }
}
