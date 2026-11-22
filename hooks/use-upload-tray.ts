'use client'

import { useSyncExternalStore } from 'react'

import { uploadTray } from '@/lib/uploads/tray'

const EMPTY = { files: [], batch: 0, pausedBy: null } as const

/** This tab's upload tray and what is in it. */
export function useUploadTray() {
  const tray = uploadTray()
  const state = useSyncExternalStore(tray.subscribe, tray.getState, () => EMPTY)
  return { tray, ...state }
}
