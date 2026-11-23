'use client'

import { useEffect, useRef, useState } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { onDemand } from '@/components/shared/on-demand'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'

import {
  FILE_SHEET_PARAM,
  LINK_SHEET_PARAM,
  fileSheetHref,
  linkSheetHref,
  onOpenSheet,
  rememberOpener,
  retargetOpener,
  returnToOpener,
} from '@/lib/client/file-sheet'
import { HISTORY_POSITION } from '@/lib/library/position'

const FileSheet = onDemand(() =>
  import('./file-sheet').then((module) => module.FileSheet)
)
const LinkSheet = onDemand(() =>
  import('@/components/links/link-sheet').then((module) => module.LinkSheet)
)

// The sheet's address is written straight to the history (state of our own,
// which the App Router takes in): opening, stepping and closing a sheet then
// cost no round trip to the server for the page under it.
// The library's place under it is carried along (not Next's own markers, so
// the App Router still takes the change in), so Back to this entry later
// finds the library where it was.
const pushAddress = (href: string) => {
  const place = (window.history.state as Record<string, unknown> | null)?.[
    HISTORY_POSITION
  ]
  window.history.pushState(
    place ? { [HISTORY_POSITION]: place } : null,
    '',
    href
  )
}
const replaceAddress = (href: string) =>
  window.history.replaceState(null, '', href)

/**
 * The file or link sheet for whichever dashboard page is open, driven by its
 * `file` or `link` query, so Back closes it and its address opens it again.
 */
export function FileSheetHost() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const id = params.get(FILE_SHEET_PARAM)
  const linkId = params.get(LINK_SHEET_PARAM)
  // Set when this host pushes a sheet's address: only then is there a page
  // under it to go back to. One restored by Back or Forward is not.
  const pushed = useRef(false)
  useEffect(
    () =>
      onOpenSheet(({ kind, id }) => {
        // Still the card or row that was chosen, before the sheet takes focus.
        // From a sheet already open (a hand-off on top of it), this one
        // takes its place rather than stacking under Back.
        const params = new URLSearchParams(window.location.search)
        if (params.get(FILE_SHEET_PARAM) || params.get(LINK_SHEET_PARAM)) {
          // Closing it returns focus to this one's card, as stepping does.
          retargetOpener(id)
          return replaceAddress(
            kind === 'file'
              ? fileSheetHref(window.location, id)
              : linkSheetHref(window.location, id)
          )
        }
        rememberOpener(id)
        pushed.current = true
        pushAddress(
          kind === 'file'
            ? fileSheetHref(window.location, id)
            : linkSheetHref(window.location, id)
        )
      }),
    []
  )
  // The sheet's code comes on first use; if it can't, the sheet says so
  // and can try again, rather than leaving its address with nothing shown.
  const [codeFailed, setCodeFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!id && !linkId) return setCodeFailed(false)
    let live = true
    setCodeFailed(false)
    ;(id ? FileSheet : LinkSheet)
      .ready()
      .catch(() => live && setCodeFailed(true))
    return () => {
      live = false
    }
  }, [id, linkId, attempt])
  // A sheet opened here sits on top of the page it opened from, so closing
  // it goes back to that page: Back afterwards doesn't reopen it. One opened
  // from its address (a reload, a pasted link) has nothing under it to go
  // back to, so closing swaps it for the page.
  const open = Boolean(id || linkId)
  const openedHere = useRef(false)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) {
      openedHere.current = pushed.current
      pushed.current = false
    }
    // The sheet leaves with its address (and this host may be drawn anew
    // with the page), so focus goes back from here, once.
    if (!open) requestAnimationFrame(returnToOpener)
    if (!open) openedHere.current = false
    wasOpen.current = open
  }, [open])
  const closing = useRef<string | null>(null)
  // A sheet shown (again) can be closed again.
  useEffect(() => {
    closing.current = null
  }, [id, linkId])
  // Closes the sheet for `current` only while it's still the one shown: a
  // late close (a delete that finished after you moved on) does nothing.
  const close = (param: string, current: string) => {
    if (new URLSearchParams(window.location.search).get(param) !== current)
      return
    // Once per sheet: a second Esc or click while it leaves must not go
    // back a second step.
    if (closing.current === `${param}:${current}`) return
    closing.current = `${param}:${current}`
    if (openedHere.current) return router.back()
    replaceAddress(
      fileSheetHref({ pathname, search: `?${params.toString()}` }, null)
    )
  }
  if ((id || linkId) && codeFailed)
    return (
      <Sheet
        open
        onOpenChange={(open) =>
          !open &&
          (id ? close(FILE_SHEET_PARAM, id) : close(LINK_SHEET_PARAM, linkId!))
        }
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col items-center justify-center gap-2 p-8 text-center sm:max-w-[30rem]"
        >
          <SheetTitle className="text-base">Couldn’t open it</SheetTitle>
          <SheetDescription>
            Flare didn’t answer. Check your connection and try again.
          </SheetDescription>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
        </SheetContent>
      </Sheet>
    )
  if (id)
    return (
      <FileSheet
        id={id}
        onClose={() => close(FILE_SHEET_PARAM, id)}
        onStep={(next) => {
          retargetOpener(next)
          replaceAddress(fileSheetHref(window.location, next))
        }}
      />
    )
  if (linkId)
    return (
      <LinkSheet
        key={linkId}
        id={linkId}
        onClose={() => close(LINK_SHEET_PARAM, linkId)}
      />
    )
  return null
}
