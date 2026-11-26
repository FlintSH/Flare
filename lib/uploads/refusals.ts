/**
 * How Flare words the refusals that sending a file again can't change. The
 * browser reads them to leave out Retry, so other replies with the same
 * status (a proxy's 413, say) keep it.
 */
export const TYPE_MISMATCH = 'File type mismatch'
export const OVER_SIZE_LIMIT = 'A file exceeds the upload size limit.'
