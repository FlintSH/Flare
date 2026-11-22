import * as z from 'zod'

import { prisma } from '@/lib/database/prisma'
import { findUserSummary, userSummarySelect } from '@/lib/users/admin'

import { ToolError } from './tool'

/** The argument that puts a tool in moderator mode. */
export const ACCOUNT_ARGUMENT = 'account'

/** One account, as `resolveAccount` finds it. */
export type AccountSummary = NonNullable<
  Awaited<ReturnType<typeof findUserSummary>>
>

const accountArgument = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .describe(
    "Act on this account's content as a moderator: its user ID, name or email. Leave it out to act on your own."
  )

/**
 * `input` with the `account` argument, for a connection that may moderate
 * with the tool, and for every call (see `buildServer`). It is required
 * where the connection may not use the tool on its own content, so the
 * listed schema says so.
 */
export function withAccountArgument(input: z.ZodObject, required: boolean) {
  return input.extend({
    [ACCOUNT_ARGUMENT]: required ? accountArgument : accountArgument.optional(),
  })
}

const notFound = () =>
  new ToolError(
    'No account has that user ID, name or email. Check it, or use the user ID.'
  )
const ambiguous = () =>
  new ToolError(
    'More than one account matches. Name the account by its user ID instead.'
  )

/**
 * The one account `reference` names, for the `account` argument of moderator
 * mode and for the user tools. A user ID wins outright, then an email, then
 * a name, each compared without regard to letter case except the ID. An
 * email or name that more than one account has is refused rather than
 * guessed: anyone can choose their name, so a name that copies another
 * account's never stands for it. The refusals name no account, since names
 * and emails are other people's text.
 */
export async function resolveAccount(
  reference: string
): Promise<AccountSummary> {
  const value = reference.trim()
  if (!value) throw notFound()
  const byId = await findUserSummary({ id: value })
  if (byId) return byId
  for (const field of ['email', 'name'] as const) {
    const matches = await prisma.user.findMany({
      where: { [field]: { equals: value, mode: 'insensitive' } },
      select: userSummarySelect,
      take: 2,
    })
    if (matches.length > 1) throw ambiguous()
    if (matches[0]) return matches[0]
  }
  throw notFound()
}
