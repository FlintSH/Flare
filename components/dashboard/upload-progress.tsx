'use client'

import { useState, useSyncExternalStore } from 'react'

import { Progress } from '@/components/ui/progress'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'

import { uploadActivity } from '@/lib/uploads/queue'

/**
 * The file being uploaded, from the drop zone or the upload form. It has its
 * own region because notifications show one at a time and would replace it:
 * at the bottom on phones, where notifications show at the top, and at the top
 * left below the navigation bar on wider screens.
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
    <ToastProvider>
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
        <div className="grid flex-1 gap-1">
          <ToastTitle>Uploading…</ToastTitle>
          <ToastDescription>
            <div className="space-y-2">
              <p className="text-sm">{file.name}</p>
              <Progress value={file.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">{file.progress}%</p>
            </div>
          </ToastDescription>
        </div>
        <ToastClose />
      </Toast>
      <ToastViewport
        hotkey={[]}
        label="Upload progress"
        className="bottom-0 top-auto z-50 sm:bottom-auto sm:left-0 sm:right-auto sm:top-20 sm:max-w-[420px]"
      />
    </ToastProvider>
  )
}
