import {
  type AccountUnwrapper,
  type EncryptedRecordsWire,
  openSealedOcrText,
} from '@/lib/e2ee/client/files'
import type { StoredAccountKeys } from '@/lib/e2ee/client/key-store'
import { sealedTagRecord } from '@/lib/e2ee/client/tags'

import {
  type OwnedTagView,
  matchingRuleTagIds,
  ownedTagViews,
  tagNameTaken,
} from './owned'
import { type TagFields, type TagView, tagFieldsSchema } from './schema'

/**
 * What the owner's browser does for tags (docs/e2ee-spec.md, section 9.5):
 * it seals names and rules, converts tags from before encryption, and runs
 * rules, because the server can read neither a sealed rule nor the name and
 * text of an encrypted file.
 */

/**
 * The request body of a new or changed tag. For an account that has keys
 * the name and the rule are sealed here. The checks that the server did on
 * a plain tag happen here too: the form of the fields, and that no other
 * tag has the name (section 9.5.3).
 */
export function tagRequestBody(input: {
  fields: { name: string; ruleSource: string | null; ruleText: string | null }
  existing?: TagView | null
  tags: readonly TagView[]
  keys: StoredAccountKeys | null
}): Record<string, unknown> {
  const parsed = tagFieldsSchema.safeParse(input.fields)
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid tag.')
  const fields: TagFields = parsed.data
  if (tagNameTaken(input.tags, fields.name, input.existing?.id))
    throw new Error('You already have a tag with that name.')
  if (!input.keys) {
    if (input.existing?.sealed || input.tags.some((tag) => tag.sealed))
      throw new Error('Unlock your encryption keys to change tags.')
    return fields
  }
  return { sealedTagMetadata: sealedTagRecord(input.keys, fields) }
}

/** The requests of the tag procedures, so a test can run them against a store in memory. */
export interface TagsApi {
  tags(): Promise<TagView[]>
  seal(tags: { id: string; sealedTagMetadata: string }[]): Promise<unknown>
  /** Plain files with their names and image text, after an ID. */
  plainText(after?: string): Promise<{
    files: { id: string; name: string; ocrText: string | null }[]
    more: boolean
  }>
  /** Encrypted records that changed after a sequence number. */
  encrypted(since: number): Promise<{
    records: (EncryptedSyncRecord & { seq: number })[]
    more: boolean
  }>
  apply(tagId: string, fileIds: string[]): Promise<{ count: number }>
}

export interface EncryptedSyncRecord {
  readonly id: string
  readonly encryption?: EncryptedRecordsWire | null
  readonly sealedOcrText?: string | null
}

const SEAL_BATCH = 100
const APPLY_BATCH = 200

/**
 * Seals the names and rules of tags from before encryption, after which the
 * server deletes the plain ones. Runs when the account keys are first
 * unlocked in a browser, and is safe to run again.
 */
export async function sealPlainTags(
  api: TagsApi,
  keys: StoredAccountKeys,
  { signal }: { signal?: AbortSignal } = {}
): Promise<number> {
  const plain = (await api.tags()).filter((tag) => !tag.sealed)
  let sealed = 0
  for (let start = 0; start < plain.length; start += SEAL_BATCH) {
    signal?.throwIfAborted()
    const batch = plain.slice(start, start + SEAL_BATCH).map((tag) => ({
      id: tag.id,
      sealedTagMetadata: sealedTagRecord(keys, {
        name: tag.name,
        ruleSource: tag.ruleSource,
        ruleText: tag.ruleText,
      }),
    }))
    await api.seal(batch)
    sealed += batch.length
  }
  return sealed
}

/** The name and the image text of an encrypted record, for a rule. Null when no key opens it. */
export async function ruleInputOf(
  record: EncryptedSyncRecord,
  unwrapper: AccountUnwrapper
): Promise<{ name: string; ocrText: string | null } | null> {
  if (!record.encryption) return null
  try {
    const opened = await unwrapper.unwrap(record.encryption)
    let ocrText: string | null = null
    if (record.sealedOcrText)
      try {
        ocrText = openSealedOcrText(opened, record.sealedOcrText)
      } catch {
        ocrText = null
      }
    return { name: opened.name, ocrText }
  } catch {
    return null
  }
}

/**
 * "Apply to existing files" for one tag: this browser reads the names and
 * the image text of every file, the encrypted ones through their records
 * and the plain ones from the server, and names the files that the rule
 * matches. A tag that the owner removed from a file by hand stays removed.
 * The rule text never leaves the browser.
 */
export async function applyRuleToExistingFiles(
  api: TagsApi,
  tag: Pick<OwnedTagView, 'id' | 'ruleSource' | 'ruleText'>,
  unwrapper: AccountUnwrapper,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (checked: number) => void } = {}
): Promise<number> {
  if (!tag.ruleSource || !tag.ruleText)
    throw new Error(
      'Add an automatic rule before applying it to existing files.'
    )
  let tagged = 0
  let checked = 0
  let pending: string[] = []
  const flush = async (all = false) => {
    while (pending.length >= (all ? 1 : APPLY_BATCH)) {
      const batch = pending.slice(0, APPLY_BATCH)
      pending = pending.slice(APPLY_BATCH)
      tagged += (await api.apply(tag.id, batch)).count
    }
  }
  const consider = async (
    id: string,
    file: { name: string; ocrText: string | null }
  ) => {
    checked++
    if (matchingRuleTagIds([tag], file).length) pending.push(id)
    await flush()
  }

  let after: string | undefined
  for (;;) {
    signal?.throwIfAborted()
    const page = await api.plainText(after)
    for (const file of page.files) await consider(file.id, file)
    onProgress?.(checked)
    if (!page.more || !page.files.length) break
    after = page.files[page.files.length - 1].id
  }

  let since = 0
  for (;;) {
    signal?.throwIfAborted()
    const page = await api.encrypted(since)
    for (const record of page.records) {
      const input = await ruleInputOf(record, unwrapper)
      if (input) await consider(record.id, input)
      since = Math.max(since, record.seq)
    }
    onProgress?.(checked)
    if (!page.more || !page.records.length) break
  }
  await flush(true)
  return tagged
}

/** The tags of the account as this browser opened them, read now. */
export async function currentOwnedTags(api: TagsApi, keys: StoredAccountKeys) {
  return ownedTagViews(await api.tags(), keys)
}
