'use client'

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useSession } from 'next-auth/react'

import {
  type DraftHistoryTraversal,
  canConfirmDraftTraversal,
} from '@/lib/navigation/draft-leave'

const leaveMessage =
  'Leave this page? Unsaved changes will be lost. A save already in progress may still finish.'

interface DraftLeaveContextValue {
  register: (id: string, dirty: boolean) => () => void
  confirmLeave: () => boolean
  allowDocumentExit: () => () => void
}

const noop = () => {}
const unguarded: DraftLeaveContextValue = {
  register: () => noop,
  confirmLeave: () => true,
  allowDocumentExit: () => noop,
}
const DraftLeaveContext = createContext(unguarded)

export function useDraftLeave() {
  return useContext(DraftLeaveContext)
}

function DraftLeaveScope({
  children,
  enabled,
}: {
  children: ReactNode
  enabled: boolean
}) {
  // Only editor IDs and dirty flags live here, never field or credential values.
  const flags = useRef(new Set<string>())
  const documentExit = useRef<symbol | null>(null)
  const [hasDirty, setHasDirty] = useState(false)
  const register = useCallback(
    (id: string, dirty: boolean) => {
      if (!enabled) return noop
      if (dirty) flags.current.add(id)
      else flags.current.delete(id)
      setHasDirty(flags.current.size > 0)
      return () => {
        flags.current.delete(id)
        setHasDirty(flags.current.size > 0)
      }
    },
    [enabled]
  )
  const confirmLeave = useCallback(
    () => !enabled || flags.current.size === 0 || window.confirm(leaveMessage),
    [enabled]
  )
  const allowDocumentExit = useCallback(() => {
    const token = Symbol()
    documentExit.current = token
    return () => {
      if (documentExit.current === token) documentExit.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled || !hasDirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (documentExit.current) {
        documentExit.current = null
        return
      }
      if (!flags.current.size) return
      event.preventDefault()
      // Browser-controlled text and user activation requirements still apply.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [enabled, hasDirty])

  useEffect(() => {
    if (!enabled || !hasDirty) return
    // Navigation API support/cancelability varies. Never rewrite browser history
    // or replay a traversal after it has already committed.
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation
    if (
      typeof navigation?.addEventListener !== 'function' ||
      typeof navigation.removeEventListener !== 'function'
    )
      return
    const onNavigate = (event: Event) => {
      if (
        canConfirmDraftTraversal(
          event as Event & DraftHistoryTraversal,
          window.location.href
        ) &&
        !confirmLeave()
      )
        event.preventDefault()
    }
    navigation.addEventListener('navigate', onNavigate)
    return () => navigation.removeEventListener('navigate', onNavigate)
  }, [enabled, hasDirty, confirmLeave])

  const value = useMemo(
    () => ({ register, confirmLeave, allowDocumentExit }),
    [register, confirmLeave, allowDocumentExit]
  )
  return (
    <DraftLeaveContext.Provider value={value}>
      {children}
    </DraftLeaveContext.Provider>
  )
}

/** The dashboard shell, navigation and editors share one account-local scope. */
export function DraftLeaveProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession()
  const account = session?.user?.id
  return (
    <DraftLeaveScope
      key={account ? `account:${account}` : 'signed-out'}
      enabled={Boolean(account)}
    >
      {children}
    </DraftLeaveScope>
  )
}
