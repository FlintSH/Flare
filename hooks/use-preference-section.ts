'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  type PreferenceSectionAliases,
  resolvePreferenceUrl,
} from '@/lib/preferences/navigation'

export function usePreferenceSection<T extends string>(
  sections: readonly T[],
  initialSection: T,
  aliases?: PreferenceSectionAliases<T>
) {
  const [navigation, setNavigation] = useState({
    section: initialSection,
    hash: '',
  })

  useEffect(() => {
    const sync = (event?: Event) => {
      const { section, url } = resolvePreferenceUrl(
        new URL(window.location.href),
        sections,
        sections[0] ?? initialSection,
        aliases
      )
      // Native anchor links update the browser URL; also sync Next's router so
      // a later save/refresh keeps that anchor instead of restoring its old URL.
      if (url.href !== window.location.href || event?.type === 'hashchange') {
        window.history.replaceState(
          null,
          '',
          url.pathname + url.search + url.hash
        )
      }
      setNavigation({ section, hash: url.hash })
    }
    sync()
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [aliases, initialSection, sections])

  useEffect(() => {
    if (!navigation.hash) return
    let anchor: string
    try {
      anchor = decodeURIComponent(navigation.hash.slice(1))
    } catch {
      return
    }
    // Wait until the selected panel has mounted before revealing its target.
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(anchor)
      if (!target || target.closest('[hidden]')) return
      let ancestor: HTMLElement | null = target
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
        ancestor = ancestor.parentElement
      }
      target.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [navigation])

  const selectSection = useCallback(
    (
      section: T,
      { updateHistory = true }: { updateHistory?: boolean } = {}
    ) => {
      if (!sections.includes(section)) return
      const url = new URL(window.location.href)
      url.searchParams.set('section', section)
      // A card anchor belongs to its section, not to the next sidebar choice.
      url.hash = ''
      if (updateHistory && url.href !== window.location.href) {
        // Keep the page mounted so changing sections preserves unfinished edits.
        window.history.pushState(null, '', url.pathname + url.search)
      }
      setNavigation({ section, hash: '' })
    },
    [sections]
  )

  return [navigation.section, selectSection] as const
}
