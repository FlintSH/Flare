/** Query/hash changes within an editor keep its existing local draft. */
export function leavesDraftPage(currentHref: string, destinationHref: string) {
  try {
    const current = new URL(currentHref)
    const destination = new URL(destinationHref, current)
    return (
      current.origin === destination.origin &&
      current.pathname !== destination.pathname
    )
  } catch {
    // An invalid destination still belongs to the original navigation handler.
    return false
  }
}

export interface DraftHistoryTraversal {
  readonly cancelable: boolean
  readonly defaultPrevented: boolean
  readonly navigationType?: string
  readonly destination?: {
    readonly sameDocument?: boolean
    readonly url?: string
  }
}

/** Never try to cancel a push, an already-committed popstate, or a document exit. */
export function canConfirmDraftTraversal(
  event: DraftHistoryTraversal,
  currentHref: string
) {
  return (
    event.cancelable &&
    !event.defaultPrevented &&
    event.navigationType === 'traverse' &&
    event.destination?.sameDocument === true &&
    typeof event.destination.url === 'string' &&
    leavesDraftPage(currentHref, event.destination.url)
  )
}
