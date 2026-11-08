'use client'

import { useEffect, useId, useLayoutEffect, useRef } from 'react'

import { useDraftLeave } from '@/components/providers/draft-leave-provider'

import { useSignOut } from '@/hooks/use-sign-out'
import { useToast } from '@/hooks/use-toast'

/** Register only whether an editor has local edits or a save in flight. */
export function useUnsavedDraft(dirty: boolean) {
  const id = useId()
  const { register } = useDraftLeave()
  useLayoutEffect(() => register(id, dirty), [register, id, dirty])
}

/** Only explicit dashboard sign-out choices use this; security exits do not. */
export function useGuardedSignOut() {
  const { confirmLeave, allowDocumentExit } = useDraftLeave()
  const { toast } = useToast()
  const releaseExit = useRef<(() => void) | null>(null)
  const pending = useRef(false)
  const signOut = useSignOut({
    onError(error, message) {
      releaseExit.current?.()
      releaseExit.current = null
      pending.current = false
      // Keep the original diagnostic and the shared sign-out recovery message.
      console.error('Logout error:', error)
      toast({
        title: 'Sign-out not confirmed',
        description: message,
        variant: 'destructive',
      })
    },
  })
  useEffect(() => () => releaseExit.current?.(), [])
  return async () => {
    if (pending.current || !confirmLeave()) return
    pending.current = true
    releaseExit.current = allowDocumentExit()
    try {
      await signOut()
    } catch (error) {
      releaseExit.current?.()
      releaseExit.current = null
      pending.current = false
      throw error
    }
  }
}
