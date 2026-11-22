/**
 * The paste being written, kept while someone moves between Flare's pages so
 * a trip to Files doesn't lose it. It lives in this tab's memory only and is
 * never written to browser storage: pastes often hold logs, keys and other
 * secrets. A reload or a closed tab ends it, which the form warns about.
 */
export type PasteDraft = { content: string; name: string }

const EMPTY: PasteDraft = { content: '', name: '' }

let kept: { owner: string; draft: PasteDraft } | null = null

/** The draft of the signed-in account, or an empty one. */
export function readDraft(owner: string): PasteDraft {
  return kept?.owner === owner ? kept.draft : EMPTY
}

/** Keeps the draft, or drops it when given null. */
export function writeDraft(owner: string, draft: PasteDraft | null) {
  kept = draft && (draft.content || draft.name) ? { owner, draft } : null
}
