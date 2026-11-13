'use client'

import { createContext, useContext } from 'react'

// From the defaults alone: the schema module brings its validator, which
// every page would then download.
import { DEFAULT_APPEARANCE } from '@/lib/customization/defaults'
import type { AppearanceDocument } from '@/lib/customization/schema'

/**
 * The published instance appearance. The root layout provides it through
 * `AppearanceProvider`; brand, background, footer and viewers read it here.
 */
export const AppearanceContext =
  createContext<AppearanceDocument>(DEFAULT_APPEARANCE)
export const useAppearance = () => useContext(AppearanceContext)
