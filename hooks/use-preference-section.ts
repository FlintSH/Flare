'use client'

import { useCallback, useEffect, useState } from 'react'

import { readPreferenceSection } from '@/lib/preferences/navigation'

export function usePreferenceSection<T extends string>(
  sections: readonly T[],
  initialSection: T
) {
  const [activeSection, setActiveSection] = useState(initialSection)

  useEffect(() => {
    const sync = () => {
      setActiveSection(
        readPreferenceSection(
          new URL(window.location.href).searchParams.get('section'),
          sections,
          initialSection
        )
      )
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [initialSection, sections])

  const selectSection = useCallback(
    (section: T) => {
      if (!sections.includes(section)) return
      const url = new URL(window.location.href)
      if (url.searchParams.get('section') !== section) {
        url.searchParams.set('section', section)
        // Keep the page mounted so changing sections preserves unfinished edits.
        window.history.pushState(null, '', url.pathname + url.search + url.hash)
      }
      setActiveSection(section)
    },
    [sections]
  )

  return [activeSection, selectSection] as const
}
