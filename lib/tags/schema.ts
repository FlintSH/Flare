import { z } from 'zod'

import { BATCH_LIMIT } from '@/lib/library/contract'
import { nameSchema } from '@/lib/library/names'
import { sealedTagMetadataField } from '@/lib/library/sealed-fields'

export const TAG_NAME_MAX_LENGTH = 40
export const TAG_RULE_MAX_LENGTH = 200

export const tagNameSchema = nameSchema('tag', TAG_NAME_MAX_LENGTH)

/** A tag as the API lists it. */
export interface TagView {
  id: string
  /** Empty for a tag whose name and rule are in `sealed`. */
  name: string
  ruleSource: RuleSource | null
  ruleText: string | null
  fileCount: number
  /**
   * `sealed_tag_metadata`, base64url with its `record_version` byte: the
   * name and the rule, which only the owner's browser opens
   * (docs/e2ee-spec.md, section 9.5.2). Null for a tag with a plain name.
   */
  sealed?: string | null
}

/** What the owner's browser reads from a tag: the same for a plain and a sealed one. */
export const tagFieldsSchema = z
  .object({
    name: tagNameSchema,
    ruleSource: z.enum(['filename', 'ocr']).nullable().default(null),
    ruleText: z
      .string()
      .trim()
      .max(TAG_RULE_MAX_LENGTH)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.ruleSource ? !input.ruleText : input.ruleText !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ruleText'],
        message: 'Choose a source and enter text for the automatic tag rule.',
      })
    }
  })

/** A tag whose name and rule the owner's browser sealed. The server reads neither. */
export const sealedTagInputSchema = z.strictObject({
  sealedTagMetadata: sealedTagMetadataField,
})

/** A tag with a plain name and rule, or a sealed one. */
export const tagInputSchema = z.union([sealedTagInputSchema, tagFieldsSchema])

/** The most tags one conversion request carries. */
export const TAG_SEAL_BATCH_LIMIT = 200

/** `PUT /api/tags/sealed`: sealed records for tags from before encryption. */
export const sealTagsInputSchema = z.strictObject({
  tags: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        sealedTagMetadata: sealedTagMetadataField,
      })
    )
    .min(1)
    .max(TAG_SEAL_BATCH_LIMIT),
})

/**
 * `POST /api/tags/{id}/apply` from a browser: the files that the rule of a
 * sealed tag matches, which the browser found (section 9.8.3).
 */
export const applyTagInputSchema = z.strictObject({
  fileIds: z.array(z.string().min(1).max(128)).min(1).max(500),
})

export const fileTagsInputSchema = z
  .object({
    fileIds: z.array(z.string().min(1).max(128)).min(1).max(BATCH_LIMIT),
    tagId: z.string().min(1).max(128),
    action: z.enum(['add', 'remove']),
  })
  .strict()

export type TagInput = z.infer<typeof tagInputSchema>
export type TagFields = z.infer<typeof tagFieldsSchema>
export type SealTagsInput = z.infer<typeof sealTagsInputSchema>
export type RuleSource = 'filename' | 'ocr'

/** Literal substring matching: punctuation, SQL wildcards and regex are text. */
export function matchesTagRule(text: string | null, phrase: string): boolean {
  return Boolean(phrase && text?.toLowerCase().includes(phrase.toLowerCase()))
}
