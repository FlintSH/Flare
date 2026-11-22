/**
 * Something one of Flare's tools was given that belongs to another: a link
 * pasted on Paste goes to Links, text pasted on Upload goes to Paste, files
 * pasted on Paste go to Upload. It is kept in this tab's memory until the
 * other page takes it, never in the address bar or browser storage, since
 * pasted text and links can hold secrets.
 */
export type Handoff =
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'files'; files: readonly File[] }

let waiting: Handoff | null = null

export function handOff(handoff: Handoff) {
  waiting = handoff
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
