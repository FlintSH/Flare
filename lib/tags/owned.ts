import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import { type TagFieldsPlain, openTagRecord } from '@/lib/e2ee/client/tags'
import { nameKey } from '@/lib/library/names'

import { type TagView, matchesTagRule } from './schema'

/**
 * The owner's view of the tags of the account: the browser opens the name
 * and the rule of each sealed tag (docs/e2ee-spec.md, section 9.5). What it
 * opens stays in memory, for as long as the account keys that opened it.
 */

/** What a tag is called while this browser cannot open its name. */
export const LOCKED_TAG_NAME = 'Encrypted tag'

type Opened = { sealed: string; fields: TagFieldsPlain | null }

const caches = new WeakMap<StoredAccountKeys, Map<string, Opened>>()

function opened(view: TagView, keys: StoredAccountKeys): TagFieldsPlain | null {
  if (!view.sealed) return null
  let cache = caches.get(keys)
  if (!cache) caches.set(keys, (cache = new Map()))
  const known = cache.get(view.id)
  if (known?.sealed === view.sealed) return known.fields
  let fields: TagFieldsPlain | null = null
  try {
    fields = openTagRecord(keys, view.sealed)
  } catch {
    fields = null
  }
  cache.set(view.id, { sealed: view.sealed, fields })
  return fields
}

export interface OwnedTagView extends TagView {
  /** The tag is sealed and this browser did not open it. */
  locked?: boolean
}

/**
 * The tags with their names and rules opened, in the order of their names.
 * The server cannot sort or compare sealed names, so the client does
 * (section 9.5.3).
 */
export function ownedTagViews(
  views: readonly TagView[],
  keys: StoredAccountKeys | null
): OwnedTagView[] {
  return views
    .map((view): OwnedTagView => {
      if (!view.sealed) return view
      const fields = keys ? opened(view, keys) : null
      return fields
        ? { ...view, ...fields }
        : {
            ...view,
            name: LOCKED_TAG_NAME,
            ruleSource: null,
            ruleText: null,
            locked: true,
          }
    })
    .sort(
      (a, b) =>
        nameKey(a.name).localeCompare(nameKey(b.name)) ||
        a.id.localeCompare(b.id)
    )
}

/** Whether another tag already has this name, ignoring case. */
export function tagNameTaken(
  tags: readonly TagView[],
  name: string,
  exceptId?: string
): boolean {
  const key = nameKey(name)
  return tags.some((tag) => tag.id !== exceptId && nameKey(tag.name) === key)
}

/**
 * The tags whose rule matches a file: today's test for a substring without
 * regard to case, over the name and over the text of an image (section
 * 9.8.3). It runs in a client, which is the only place that has both the
 * rules and the file's name and text (section 9.5).
 */
export function matchingRuleTagIds(
  tags: readonly Pick<TagView, 'id' | 'ruleSource' | 'ruleText'>[],
  file: { name?: string | null; ocrText?: string | null }
): string[] {
  return tags
    .filter(
      (tag) =>
        tag.ruleSource &&
        tag.ruleText &&
        matchesTagRule(
          tag.ruleSource === 'filename'
            ? (file.name ?? null)
            : (file.ocrText ?? null),
          tag.ruleText
        )
    )
    .map((tag) => tag.id)
}
