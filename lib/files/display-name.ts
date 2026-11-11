import { openedFile } from '@/lib/e2ee/client/opened-files'

import { safeFileName } from './safe-render'

/**
 * The name to show for a library row. A plain file has its name. An
 * encrypted file has the name this browser decrypted, cleaned for display,
 * or a fixed label while its key is not open. Client only.
 */
export function displayFileName(file: {
  id: string
  name: string
  encrypted?: boolean
}): string {
  if (!file.encrypted) return file.name
  const opened = openedFile(file.id)
  return opened ? safeFileName(opened.name) : 'Encrypted file'
}
