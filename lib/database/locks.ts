import type { Prisma } from '@prisma/client'

type Tx = Pick<Prisma.TransactionClient, '$executeRaw'>
type RowTx = Pick<Prisma.TransactionClient, '$queryRaw'>

// Every PostgreSQL lock Flare takes to serialize work across processes. The
// advisory keys are shared with every process using the database, including
// older versions during a rolling deploy, so a key never changes or repeats.
// Take locks in the order they appear in this file.

/** One chunked upload session. */
export async function lockUploadSession(tx: Tx, uploadId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`flare-upload:${uploadId}`}, 0))`
}

/** Instance settings writers, and anything that must see settings unchanged. */
export async function lockSettings(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
}

/** Role, permission and account-authority changes. Takes the settings lock first. */
export async function lockRoleChanges(tx: Tx) {
  await lockSettings(tx)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347202)`
}

/** One account's row: its quota, files, folders, tags, profiles and credentials. */
export async function lockUserRow(tx: RowTx, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}

/**
 * One account's upload profiles: every profile write, and tag deletion before
 * it deletes the tag and takes it out of the profiles, so no profile keeps a
 * deleted tag. It is the account's row lock, which uploads hold while they
 * check their profile and tags.
 */
export async function lockUploadProfiles(tx: RowTx, userId: string) {
  await lockUserRow(tx, userId)
}

/** One mailbox address while an account claims it. */
export async function lockEmailAddress(tx: Tx, email: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(lower(${email.trim()}), 71041))`
}

/** One account's API token and webhook management changes. */
export async function lockIntegrationChanges(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347212, hashtext(${userId}))`
}

/** One account's webhook endpoints and their queued deliveries. */
export async function lockWebhookQueue(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347213, hashtext(${userId}))`
}

/** Claims on the mail outbox. */
export async function lockMailClaims(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347203)`
}

/** The daily mail budget, while a message is counted against it. */
export async function lockMailBudget(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347201)`
}

/** Claims on queued storage deletions. */
export async function lockStorageDeletionClaims(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347205)`
}

/** Claims on queued webhook deliveries. */
export async function lockWebhookDeliveryClaims(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347211)`
}

/** Audit retention, which one process runs at a time; false when another holds it. */
export async function tryLockAuditRetention(tx: RowTx): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(712347214) AS "locked"
  `
  return Boolean(row?.locked)
}
