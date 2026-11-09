import type { ZodError } from 'zod'

import { filePasswordIssue } from '@/lib/files/password-policy'
import { HttpError } from '@/lib/http/errors'
import { prismaAnswers } from '@/lib/http/prisma'
import type { RouteContract } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

/** The message for a rejected name pattern, if that is what failed. */
function namePatternIssue(error: ZodError): string | null {
  const issue = error.issues.find(
    (entry) => entry.path.at(-1) === 'nameTemplate'
  )
  return issue?.message ?? null
}

export const uploadRoutes: RouteContract = {
  invalid: (error) =>
    new HttpError(
      400,
      filePasswordIssue(error) ??
        namePatternIssue(error) ??
        'Invalid upload options.'
    ),
  failure: { message: 'Upload could not be completed.' },
  logger: loggers.files,
}

export const uploadProfileRoutes: RouteContract = {
  translate: prismaAnswers({
    P2002: new HttpError(409, 'A profile with this name already exists.'),
  }),
  invalid: (error) =>
    new HttpError(400, error.issues[0]?.message || 'Invalid profile.'),
  failure: { message: 'Could not save upload profile.' },
  logger: loggers.files,
}
