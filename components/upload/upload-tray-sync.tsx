'use client'

import { useEffect } from 'react'

import { usePathname, useRouter } from 'next/navigation'

import { useQueryClient } from '@tanstack/react-query'

import { ToastAction } from '@/components/ui/toast'

import { libraryChanged } from '@/lib/library/changes'
import { uploadTray } from '@/lib/uploads/tray'

import { usePermissions } from '@/hooks/use-permissions'
import { toast } from '@/hooks/use-toast'
import { notifyUploaded } from '@/hooks/use-upload-queue'

const UPLOAD_PATH = '/dashboard/upload'

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * Keeps every page in step with the tab's upload list, which goes on while
 * someone browses: the library refreshes as files arrive, someone away from
 * Upload hears how a batch went, and closing the tab mid-upload asks first.
 */
export function UploadTraySync() {
  const router = useRouter()
  const client = useQueryClient()
  const pathname = usePathname()
  const { user } = usePermissions()
  const away = pathname !== UPLOAD_PATH

  // The list belongs to whoever is signed in.
  const account = user?.id
  useEffect(() => {
    if (account) uploadTray().claim(account)
  }, [account])

  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (uploadTray().busy()) event.preventDefault()
    }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [])

  useEffect(
    () =>
      uploadTray().onSettled(({ uploaded, failure }) => {
        if (uploaded.length) {
          void libraryChanged(client)
          router.refresh()
        }
        if (!away) return
        if (failure)
          toast({
            variant: 'destructive',
            title: `Couldn’t upload ${failure.name}`,
            description: [
              sentence(failure.reason),
              // The links of the rest are on Upload.
              uploaded.length
                ? `${uploaded.length} other ${uploaded.length === 1 ? 'file' : 'files'} uploaded.`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
            action: (
              <ToastAction
                altText="Open Upload to retry"
                onClick={() => router.push(UPLOAD_PATH)}
              >
                Open Upload
              </ToastAction>
            ),
          })
        else notifyUploaded(uploaded)
      }),
    [client, router, away]
  )
  return null
}
