'use client'

import { useState, useSyncExternalStore } from 'react'

import { Progress } from '@/components/ui/progress'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastTitle,
} from '@/components/ui/toast'

import { uploadActivity } from '@/lib/uploads/activity'
import { formatTransfer } from '@/lib/uploads/speed'

/**
 * The file being uploaded, from the drop zone or the upload form. The toaster
 * shows it beside the latest notification, so a notification such as "Copied
 * to clipboard" doesn't replace it and the upload's result appears where its
 * progress was.
 */
export function UploadProgress() {
  const { file, uploading } = useSyncExternalStore(
    uploadActivity.subscribe,
    uploadActivity.get,
    uploadActivity.get
  )
  const [closed, setClosed] = useState<number | null>(null)
  if (!file) return null
  return (
    <Toast
      // A toast per file: closing it hides only that file's progress, and
      // each file is announced when it starts.
      key={file.id}
      open={uploading && closed !== file.id}
      onOpenChange={(open) => {
        if (!open) setClosed(file.id)
      }}
      duration={Infinity}
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <ToastTitle>Uploading…</ToastTitle>
        <ToastDescription asChild>
          <div className="space-y-2">
            <p className="truncate text-sm" title={file.name}>
              {file.name}
            </p>
            <Progress
              value={file.progress}
              aria-label={`Upload progress for ${file.name}`}
              className="h-2"
            />
            <p className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
              <span>
                {formatTransfer(file.uploaded, file.size, file.speed)}
              </span>
              <span>{file.progress}%</span>
            </p>
          </div>
        </ToastDescription>
      </div>
      <ToastClose />
    </Toast>
  )
}
