import type { PrismaClient } from '@prisma/client'

/** A Prisma query extension that sees every operation, such as Meticulous's recorder. */
type QueryRecorder = Parameters<PrismaClient['$extends']>[0]

// Instrumentation registers through its own copy of this module.
const stateKey = Symbol.for('flare.database.query-recorder')
const processState = globalThis as typeof globalThis & {
  [stateKey]?: { recorder?: QueryRecorder; built?: boolean }
}
const state = (processState[stateKey] ??= {})

/**
 * Records or replays every database query, for local visual tests. The
 * recorder is applied when the database client is built, so register it
 * before anything uses the database.
 */
export function recordDatabaseQueries(recorder: QueryRecorder): void {
  if (state.built)
    throw new Error(
      'The database client was built before its query recorder was registered.'
    )
  state.recorder = recorder
}

/**
 * Applies the registered recorder to a new client before any other extension,
 * so it sees each query first, including the queries other extensions make.
 */
export function withQueryRecorder(client: PrismaClient): PrismaClient {
  state.built = true
  return state.recorder
    ? (client.$extends(state.recorder) as unknown as PrismaClient)
    : client
}
