'use client'

import { Loader2, ScanText } from 'lucide-react'

import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'

import type { DecryptedContent } from '@/lib/e2ee/client/file-worker'
import type { OpenedFile } from '@/lib/e2ee/client/files'
import { fileUrls } from '@/lib/files/urls'

import { useOcr } from '@/hooks/use-ocr'

/**
 * "Extract text" on the page of an encrypted image (docs/e2ee-spec.md,
 * section 9.6.2). This browser opens the owner's stored text, or reads the
 * image itself. A visitor's result stays in the visitor's browser. The
 * owner's result is sealed and stored.
 */
export function EncryptedOcrButton({
  file,
  opened,
  store,
  content,
  className,
}: {
  file: { id: string; urlPath: string }
  opened: OpenedFile
  store: boolean
  /** The plaintext that the page already decrypted for its preview. */
  content: () => DecryptedContent | null
  className?: string
}) {
  const ocr = useOcr(fileUrls(file).ocr, { file, opened, store, content })
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void ocr.extract()}
        disabled={ocr.loading}
        className={className}
        data-encrypted-ocr=""
      >
        {ocr.loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ScanText className="h-4 w-4" aria-hidden="true" />
        )}
        {ocr.loading ? 'Reading image…' : 'Extract text'}
      </Button>
      <OcrDialog {...ocr.dialog} />
    </>
  )
}
