import { z } from 'zod'

import { BATCH_LIMIT } from '@/lib/library/contract'
import { nameSchema } from '@/lib/library/names'

export const TAG_NAME_MAX_LENGTH = 40
export const TAG_RULE_MAX_LENGTH = 200

export const tagNameSchema = nameSchema('tag', TAG_NAME_MAX_LENGTH)

/** A tag as the API lists it. */
export interface TagView {
  id: string
  name: string
  ruleSource: RuleSource | null
  ruleText: string | null
  fileCount: number
}

export const tagInputSchema = z
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

export const fileTagsInputSchema = z
  .object({
    fileIds: z.array(z.string().min(1).max(128)).min(1).max(BATCH_LIMIT),
    tagId: z.string().min(1).max(128),
    action: z.enum(['add', 'remove']),
  })
  .strict()

export type TagInput = z.infer<typeof tagInputSchema>
export type RuleSource = 'filename' | 'ocr'

/** Literal substring matching: punctuation, SQL wildcards and regex are text. */
export function matchesTagRule(text: string | null, phrase: string): boolean {
  return Boolean(phrase && text?.toLowerCase().includes(phrase.toLowerCase()))
}
