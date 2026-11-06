'use client'

import { createContext, useContext } from 'react'

import {
  type AppearanceDocument,
  DEFAULT_APPEARANCE,
} from '@/lib/customization/schema'

/**
 * The published instance appearance. The root layout provides it through
 * `AppearanceProvider`; brand, background, footer and viewers read it here.
 */
export const AppearanceContext =
  createContext<AppearanceDocument>(DEFAULT_APPEARANCE)
export const useAppearance = () => useContext(AppearanceContext)
