import { Prisma } from '@prisma/client'

import type { HttpError } from './errors'

type KnownCode = 'P2002' | 'P2003' | 'P2025'

/** Answers for the database errors a route family can explain: conflicts and vanished rows. */
export function prismaAnswers(answers: Partial<Record<KnownCode, HttpError>>) {
  return (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError
      ? answers[error.code as KnownCode]
      : undefined
}
