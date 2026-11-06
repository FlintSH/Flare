import { HttpError } from '@/lib/http/errors'
import { prismaAnswers } from '@/lib/http/prisma'
import type { RouteContract } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const gone = new HttpError(404, 'The folder or file is no longer available.')

export const folderRoutes: RouteContract = {
  envelope: 'api',
  translate: prismaAnswers({
    P2002: new HttpError(409, 'A folder with that name already exists here.'),
    P2025: gone,
    P2003: gone,
  }),
  invalid: (error) =>
    new HttpError(400, error.issues[0]?.message ?? 'Invalid folder.'),
  failure: { message: 'Unable to update folders. Please try again.' },
  logger: loggers.files,
}
