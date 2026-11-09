/** How much of each file the search index reads, and how it retries. */

const MiB = 1024 * 1024

/** Extracted text kept per file. Longer contents are searchable up to here. */
export const MAX_INDEXED_CHARACTERS = 100_000
/** Archive member paths kept per archive. */
export const MAX_INDEXED_ENTRIES = 5_000
/** The start of a text file that is read. */
export const TEXT_READ_BYTES = 1 * MiB
/** Larger files of these kinds are skipped; names, tags and folders still match. */
export const OCR_MAX_BYTES = 25 * MiB
export const PDF_MAX_BYTES = 50 * MiB
export const PDF_MAX_PAGES = 200
export const DOCUMENT_MAX_BYTES = 50 * MiB
/** Uncompressed XML read from one Office or OpenDocument file. */
export const DOCUMENT_XML_MAX_BYTES = 40 * MiB
/** One file's extraction is abandoned after this. */
export const EXTRACTION_TIMEOUT_MS = 120_000

/** Files read at once per process. Image recognition also queues for OCR's single slot. */
export const SEARCH_INDEX_CONCURRENCY = 2
/** A claimed file returns to the queue if its worker hasn't finished by then. */
export const SEARCH_INDEX_LEASE_MS = 5 * 60_000
/** Attempts before a file is marked as failed; each waits longer. */
export const SEARCH_INDEX_ATTEMPTS = 3
export const SEARCH_INDEX_RETRY_MS = [60_000, 10 * 60_000] as const

/**
 * Raise when extraction changes what it would find in already indexed files,
 * so they are read again in the background. Rows written by an older version
 * are requeued when a worker starts.
 */
export const SEARCH_EXTRACTOR_VERSION = 1
