import * as z from 'zod'

import { setAuditTarget } from '@/lib/audit'
import {
  type ShortLink,
  shortLinkInputSchema,
  shortLinkUrl,
} from '@/lib/links/schema'
import {
  createShortLink,
  deleteOwnShortLink,
  listOwnShortLinks,
} from '@/lib/links/service'

import { compact, decodeCursor, pageOf } from '../results'
import { ToolError, defineTool } from '../tool'

const linkRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  short_url: z.string().describe('The address that redirects to the target'),
  target_url: z.string(),
  clicks: z.number().describe('Times the short URL was followed'),
  created_at: z.string(),
})

function linkRow(link: ShortLink, origin: string) {
  return {
    id: link.id,
    code: link.shortCode,
    short_url: shortLinkUrl(link.shortCode, origin),
    target_url: link.targetUrl,
    clicks: link.clicks,
    created_at: link.createdAt,
  }
}

const listShortLinks = defineTool({
  name: 'list_short_links',
  description:
    'The short links of this account, newest first: each short URL, where it leads, how often it was followed and when it was made. `query` keeps only links whose code or target URL contains it. Returns one page; pass `next_cursor` back as `cursor`, with the same `query`, for the next.',
  input: z.object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Part of a short code or of a target URL'),
    limit: z.number().int().min(1).max(100).optional().describe('Default 20'),
    cursor: z.string().max(200).optional(),
  }),
  output: z.object({
    links: z.array(linkRowSchema),
    total: z.number().describe('Links matching, across all pages'),
    next_cursor: z.string().optional(),
  }),
  async run(args, { principal, origin }) {
    const offset = decodeCursor(args.cursor)
    const wanted = args.query?.trim().toLowerCase()
    const links = await listOwnShortLinks(principal.user.id)
    const { page, total, next_cursor } = pageOf(
      wanted
        ? links.filter(
            (link) =>
              link.shortCode.toLowerCase().includes(wanted) ||
              link.targetUrl.toLowerCase().includes(wanted)
          )
        : links,
      offset,
      args.limit ?? 20
    )
    return {
      structured: compact({
        links: page.map((link) => linkRow(link, origin)),
        total,
        next_cursor,
      }),
    }
  },
})

const createShortLinkTool = defineTool({
  name: 'create_short_link',
  description:
    'Shorten an http or https URL. Returns a short URL on this Flare instance that redirects anyone who opens it to the target and counts the visit. The code is random and cannot be chosen, and a link cannot be edited: to point somewhere else, delete it and create another.',
  input: z.object({
    url: z.string().max(2048).describe('The http or https URL to shorten'),
  }),
  output: z.object({ link: linkRowSchema }),
  async run(args, { principal, origin }) {
    const { url } = shortLinkInputSchema.parse({ url: args.url })
    const link = await createShortLink(principal.user.id, url)
    setAuditTarget({ type: 'link', id: link.id, name: link.shortCode })
    return { structured: { link: linkRow(link, origin) } }
  },
})

/** The code a short URL or `/u/` path names; anything else is taken as the code itself. */
function shortCodeOf(value: string) {
  let path = value
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname
    } catch {
      return value
    }
  }
  return /^\/u\/([^/]+)\/?$/.exec(path)?.[1] ?? value
}

const deleteShortLink = defineTool({
  name: 'delete_short_link',
  description:
    "Delete one of this account's short links, named by its ID, its code or its short URL. The short URL stops working at once and its click count is lost. This cannot be undone: a new link to the same target gets a different code.",
  input: z.object({
    link: z
      .string()
      .min(1)
      .max(2048)
      .describe('The link ID, its short code, or its short URL'),
  }),
  output: z.object({
    id: z.string(),
    code: z.string(),
    target_url: z.string().describe('Where the deleted link led'),
  }),
  async run(args, { principal }) {
    const userId = principal.user.id
    const value = args.link.trim()
    const code = shortCodeOf(value)
    // Only this account's links are searched, so a code or ID that belongs
    // to someone else answers like one that does not exist.
    const links = await listOwnShortLinks(userId)
    const link =
      links.find((candidate) => candidate.id === value) ??
      links.find((candidate) => candidate.shortCode === code)
    if (!link)
      throw new ToolError(
        `No short link of this account matches "${args.link}". Call list_short_links to see them.`
      )
    setAuditTarget({ type: 'link', id: link.id, name: link.shortCode })
    await deleteOwnShortLink(userId, link.id)
    return {
      structured: {
        id: link.id,
        code: link.shortCode,
        target_url: link.targetUrl,
      },
    }
  },
})

export const linksTools = [listShortLinks, createShortLinkTool, deleteShortLink]
