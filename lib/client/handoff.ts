/**
 * Something one of Flare's tools was given that belongs to another: a link
 * pasted on Paste goes to Links, text pasted on Upload goes to Paste, files
 * pasted on Paste go to Upload. It is kept in this tab's memory until the
 * other page takes it, never in the address bar or browser storage, since
 * pasted text and links can hold secrets.
 */
export type Handoff =
  | { kind: 'link'; url: string }
  | {
      kind: 'text'
      text: string
      /** Opened as a private paste (it carries a credential). */
      private?: boolean
    }
  | { kind: 'files'; files: readonly File[] }

let waiting: Handoff | null = null

const HANDOFF_EVENT = 'flare:handoff'

export function handOff(handoff: Handoff) {
  waiting = handoff
  // A page that's already open (Find used on Links itself) takes it now.
  window.dispatchEvent(new Event(HANDOFF_EVENT))
}

/** Calls `take` whenever something is handed over while a page is open. */
export function onHandoff(take: () => void) {
  window.addEventListener(HANDOFF_EVENT, take)
  return () => window.removeEventListener(HANDOFF_EVENT, take)
}

/** What was handed to a page of this kind, once. */
export function takeHandoff<Kind extends Handoff['kind']>(
  kind: Kind
): Extract<Handoff, { kind: Kind }> | null {
  if (waiting?.kind !== kind) return null
  const taken = waiting as Extract<Handoff, { kind: Kind }>
  waiting = null
  return taken
}
