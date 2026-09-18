import { z } from 'zod'

export const tagNameSchema = z
  .string()
  .transform((name) => name.normalize('NFKC').trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Give your tag a name.')
      .max(40, 'Tag names can be up to 40 characters.')
      .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name), 'Use a plain-text name.')
  )

export const tagInputSchema = z
  .object({
    name: tagNameSchema,
    ruleSource: z.enum(['filename', 'ocr']).nullable().default(null),
    ruleText: z.string().trim().max(200).nullable().default(null),
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
    fileIds: z.array(z.string().min(1).max(128)).min(1).max(100),
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
