import type { Language } from '@/lib/files/file-kind'

/**
 * The paste being written, kept while someone moves between Flare's pages so
 * a trip to Files doesn't lose it. It lives in this tab's memory only and is
 * never written to browser storage: pastes often hold logs, keys and other
 * secrets. A reload or a closed tab ends it, so while a draft has text the
 * browser asks first, on whichever Flare page is open.
 */
export type PasteDraft = {
  content: string
  name: string
  /** A language chosen without a name; unset, Flare detects it. */
  language?: Language
}

const EMPTY: PasteDraft = { content: '', name: '' }

let kept: { owner: string; draft: PasteDraft } | null = null

const warn = (event: BeforeUnloadEvent) => event.preventDefault()

/** Asks before the tab goes away exactly while a draft holds text. */
function guard() {
  if (typeof window === 'undefined') return
  if (kept?.draft.content.trim()) window.addEventListener('beforeunload', warn)
  else window.removeEventListener('beforeunload', warn)
}

/** The draft of the signed-in account, or an empty one. */
export function readDraft(owner: string): PasteDraft {
  return kept?.owner === owner ? kept.draft : EMPTY
}

/** Keeps the draft. */
export function writeDraft(owner: string, draft: PasteDraft) {
  kept = draft.content || draft.name ? { owner, draft } : null
  guard()
}

/**
 * Drops the draft once it is saved, unless it changed since: a page that
 * was left and opened again while the paste was being created may hold
 * newer text by then.
 */
export function clearDraft(saved: PasteDraft) {
  if (kept?.draft !== saved) return
  kept = null
  guard()
}
