import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import { tagRoutes } from '@/lib/tags/http'
import { createTag, deleteTag, listTags, updateTag } from '@/lib/tags/manage'
import {
  TAG_NAME_MAX_LENGTH,
  TAG_RULE_MAX_LENGTH,
  type TagView,
  tagInputSchema,
} from '@/lib/tags/schema'
import { applyTagToExistingFiles } from '@/lib/tags/service'

import { compact, decodeCursor, pageOf } from '../results'
import { ToolError, defineTool } from '../tool'
import { pickTag } from './shared'

const PAGE_SIZE = 200

const tagReference = z.string().min(1).max(200)

const ruleSource = z.enum(['filename', 'ocr'])

const tagRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  file_count: z.number(),
  rule_source: ruleSource
    .optional()
    .describe(
      "What the tag's rule reads: the file name, or the text Flare reads from an image (ocr). Absent without a rule"
    ),
  rule_text: z.string().optional().describe('The text the rule looks for'),
})

function tagRow(tag: TagView) {
  return compact({
    id: tag.id,
    name: tag.name,
    file_count: tag.fileCount,
    rule_source: tag.ruleSource ?? undefined,
    rule_text: tag.ruleText ?? undefined,
  })
}

/** Runs a tag change, wording a name conflict or a vanished row as the tag routes do. */
export async function tagChange<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change()
  } catch (error) {
    throw tagRoutes.translate?.(error) ?? error
  }
}

const listTagsTool = defineTool({
  name: 'list_tags',
  description:
    'The tags of this account, each with how many files carry it and the rule that adds it automatically, if it has one. Wherever a tool takes a tag, use a name or ID from here. Returns 200 tags a page, ordered by name; pass `next_cursor` back as `cursor` for more.',
  input: z.object({ cursor: z.string().max(200).optional() }),
  output: z.object({
    tags: z.array(tagRowSchema),
    total: z.number().describe('Tags in the account, across all pages'),
    next_cursor: z.string().optional(),
  }),
  async run(args, { principal }) {
    const offset = decodeCursor(args.cursor)
    const { page, total, next_cursor } = pageOf(
      await listTags(principal.user.id),
      offset,
      PAGE_SIZE
    )
    return {
      structured: compact({ tags: page.map(tagRow), total, next_cursor }),
    }
  },
})

const saveTag = defineTool({
  name: 'save_tag',
  description:
    'Create a tag, or change one. To create, give `name`. To change, give `tag` and what is new: a `name`, a rule, or both. A rule adds the tag to new uploads by itself: with `rule_source` "filename" when the file name contains `rule_text`, with "ocr" when the text Flare reads from an image contains it. The text is matched as written, ignoring letter case; it is not a pattern. A new or changed rule leaves files already uploaded alone unless `apply_rule_to_existing_files` is true, which adds the tag to every existing file that matches and never removes it. Tag files by hand with tag_files.',
  input: z.object({
    tag: tagReference
      .optional()
      .describe('The tag to change: its name or ID. Leave out to create a tag'),
    name: z
      .string()
      .max(500)
      .optional()
      .describe(
        `Up to ${TAG_NAME_MAX_LENGTH} characters. Required for a new tag; the new name when changing one`
      ),
    rule_source: ruleSource
      .nullable()
      .optional()
      .describe(
        'What the rule reads; give it with `rule_text`. null removes the rule'
      ),
    rule_text: z
      .string()
      .max(1000)
      .optional()
      .describe(
        `The text the rule looks for, up to ${TAG_RULE_MAX_LENGTH} characters`
      ),
    apply_rule_to_existing_files: z
      .boolean()
      .optional()
      .describe('Also add the tag to existing files the rule matches'),
  }),
  output: z.object({
    tag: tagRowSchema,
    files_tagged: z
      .number()
      .optional()
      .describe(
        'Existing files the rule added the tag to; present with `apply_rule_to_existing_files`'
      ),
  }),
  async run(args, { principal, requireEffect }) {
    const userId = principal.user.id
    const apply = args.apply_rule_to_existing_files === true
    // Refused before anything is saved, so a denied call changes nothing.
    if (apply) requireEffect('apply_rule_to_existing_files')

    const current =
      args.tag === undefined ? null : await pickTag(userId, args.tag)
    const changes =
      args.name !== undefined ||
      args.rule_source !== undefined ||
      args.rule_text !== undefined
    if (!current && args.name === undefined)
      throw new ToolError(
        'Give the new tag a `name`, or say which `tag` to change.'
      )
    if (current && !changes && !apply)
      throw new ToolError(
        'Nothing to change. Give a new `name`, a rule (`rule_source` and `rule_text`), or `apply_rule_to_existing_files`.'
      )
    if (current)
      setAuditTarget({ type: 'tag', id: current.id, name: current.name })

    // The tag routes replace the name and the rule together, so what the
    // call leaves out is sent as the tag has it now.
    const input = tagInputSchema.parse({
      name: args.name ?? current?.name,
      ruleSource:
        args.rule_source === undefined
          ? (current?.ruleSource ?? null)
          : args.rule_source,
      ruleText:
        args.rule_text ??
        (args.rule_source === null ? null : (current?.ruleText ?? null)),
    })
    if (apply && !input.ruleSource)
      throw new ToolError(
        'This tag has no rule to apply. Give `rule_source` and `rule_text`, or leave out `apply_rule_to_existing_files`.'
      )

    const tag = !current
      ? await tagChange(() => createTag(userId, input))
      : changes
        ? await tagChange(() => updateTag(userId, current.id, input))
        : current
    setAuditTarget({ type: 'tag', id: tag.id, name: tag.name })
    const tagged = apply
      ? await applyTagToExistingFiles(userId, tag.id)
      : undefined
    return {
      structured: compact({
        // The saved count predates the rule's run, which only adds files.
        tag: tagRow({ ...tag, fileCount: tag.fileCount + (tagged ?? 0) }),
        files_tagged: tagged,
      }),
    }
  },
})

const deleteTagTool = defineTool({
  name: 'delete_tag',
  description:
    'Delete a tag. Its files are kept and only lose the tag, and upload profiles that add it stop adding it. This cannot be undone: creating the tag again does not put it back on those files.',
  input: z.object({ tag: tagReference.describe('The tag name or ID') }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    files_untagged: z.number().describe('Files that carried the tag'),
  }),
  async run(args, { principal }) {
    const userId = principal.user.id
    const tag = await pickTag(userId, args.tag)
    setAuditTarget({ type: 'tag', id: tag.id, name: tag.name })
    await tagChange(() => deleteTag(userId, tag.id))
    return {
      structured: { id: tag.id, name: tag.name, files_untagged: tag.fileCount },
    }
  },
})

export const tagsTools = [listTagsTool, saveTag, deleteTagTool]
