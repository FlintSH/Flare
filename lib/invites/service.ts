import type { Prisma } from '@prisma/client'
import { z } from 'zod'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import {
  type Permission,
  type RoleSummary,
  hasPermission,
} from '@/lib/permissions/catalog'
import {
  PermissionError,
  type UserAccess,
  assertCanGrantPermissions,
  assertCanManageRole,
  ensureBuiltInRoles,
  getUserAccess,
  getUsersAccess,
  lockRoleChanges,
  requireActorPermission,
  roleSelect,
  validateRoleAssignment,
} from '@/lib/permissions/server'

import {
  INVITE_LINK_MESSAGES,
  type InviteCreateInput,
  type InviteLimits,
  type InviteLinkStatus,
  type InvitePolicyView,
  type InviteStatus,
  type InviteView,
  MAX_ACTIVE_INVITES,
  inviteStatus,
} from './policy'
import {
  createInviteToken,
  hashInviteToken,
  isInviteToken,
  readInviteToken,
} from './tokens'

type Client = Prisma.TransactionClient | typeof prisma

/** Registration maps these to a stable `code`, never to internal details. */
export class InviteError extends Error {
  constructor(public readonly reason: Exclude<InviteLinkStatus, 'active'>) {
    super(INVITE_LINK_MESSAGES[reason])
    this.name = 'InviteError'
  }
}

const inviteSelect = {
  id: true,
  note: true,
  maxUses: true,
  uses: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  creatorId: true,
  token: true,
  creator: { select: { id: true, name: true } },
  roles: { select: roleSelect, orderBy: { position: 'desc' } },
  members: {
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
    take: 10,
  },
  _count: { select: { members: true } },
} as const satisfies Prisma.InviteSelect
type InviteRecord = Prisma.InviteGetPayload<{ select: typeof inviteSelect }>

/** Ended links can never work again; this also includes paused links. */
function currentInviteWhere(now: Date): Prisma.InviteWhereInput {
  return {
    revokedAt: null,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        OR: [{ maxUses: null }, { uses: { lt: prisma.invite.fields.maxUses } }],
      },
    ],
  }
}

function endedInviteWhere(now: Date): Prisma.InviteWhereInput {
  return {
    OR: [
      { revokedAt: { not: null } },
      { expiresAt: { lte: now } },
      {
        maxUses: { not: null },
        uses: { gte: prisma.invite.fields.maxUses },
      },
    ],
  }
}

async function readInviteLimits(client: Client): Promise<InviteLimits> {
  const row = await client.config.findUnique({
    where: { key: 'flare_config' },
  })
  const config = row ? configSchema.parse(row.value) : DEFAULT_CONFIG
  return config.settings.general.registrations.inviteLimits
}

/** People who can create accounts directly gain nothing from invite limits. */
function limitsFor(access: UserAccess, limits: InviteLimits) {
  return hasPermission(access, 'users.create') ? null : limits
}

/**
 * Display-only mirror of the checks repeated under lock during registration.
 * Returns whether each creator could still use each invite's role grants.
 */
async function creatorEligibility(records: InviteRecord[]) {
  const creators = [
    ...new Set(
      records
        .filter((record) => inviteStatus(record) === 'active')
        .map((record) => record.creatorId)
    ),
  ]
  if (!creators.length) return new Map<string, UserAccess | null>()
  // A constant number of reads, however many creators appear on the page.
  const [users, accessById, email] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: creators } },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        emailVerifiedFor: true,
        emailVerificationSource: true,
        emailExempt: true,
        createdAt: true,
      },
    }),
    getUsersAccess(creators),
    getEmailConfig(),
  ])
  const eligible = new Map<string, UserAccess | null>()
  for (const id of creators) {
    const user = users.find((candidate) => candidate.id === id)
    const access = accessById.get(id)
    eligible.set(
      id,
      user &&
        access &&
        !requiresEmailVerification(user, email) &&
        hasPermission(access, 'invites.create')
        ? access
        : null
    )
  }
  return eligible
}

function canStillGrant(
  access: UserAccess,
  roles: Pick<RoleSummary, 'position' | 'permissions'>[]
) {
  if (!roles.length) return true
  if (!hasPermission(access, 'users.roles')) return false
  try {
    for (const role of roles) {
      assertCanManageRole(access, role)
      assertCanGrantPermissions(access, role.permissions)
    }
    return true
  } catch {
    return false
  }
}

function present(
  record: InviteRecord,
  viewerId: string,
  viewer: UserAccess,
  eligibility: Map<string, UserAccess | null>
): InviteView {
  let status: InviteStatus = inviteStatus(record)
  if (status === 'active') {
    const creator = eligibility.get(record.creatorId)
    if (!creator || !canStillGrant(creator, record.roles)) status = 'paused'
  }
  const own = record.creatorId === viewerId
  const current = status === 'active' || status === 'paused'
  return {
    id: record.id,
    note: record.note,
    status,
    maxUses: record.maxUses,
    uses: record.uses,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    creator: record.creator,
    roles: record.roles.map(({ id, name, color }) => ({ id, name, color })),
    members: record.members,
    memberCount: record._count.members,
    token: own && current ? readInviteToken(record.token) : null,
    canRevoke:
      current &&
      ((own && hasPermission(viewer, 'invites.create')) ||
        hasPermission(viewer, 'invites.manage')),
  }
}

export const inviteListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['active', 'ended', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type InviteListQuery = z.infer<typeof inviteListQuerySchema>

export async function getInvitePolicy(
  userId: string,
  access: UserAccess
): Promise<InvitePolicyView> {
  const [limits, activeCount] = await Promise.all([
    readInviteLimits(prisma),
    prisma.invite.count({
      where: { creatorId: userId, ...currentInviteWhere(new Date()) },
    }),
  ])
  return {
    canCreate: hasPermission(access, 'invites.create'),
    canManage: hasPermission(access, 'invites.manage'),
    canGrantRoles: hasPermission(access, 'users.roles'),
    limits: limitsFor(access, limits),
    activeCount,
  }
}

export async function listInvites(
  userId: string,
  access: UserAccess,
  query: InviteListQuery
) {
  const required: Permission =
    query.scope === 'all' ? 'invites.manage' : 'invites.create'
  if (
    !hasPermission(access, required) &&
    !(query.scope === 'mine' && hasPermission(access, 'invites.manage'))
  )
    throw new PermissionError('Permission denied')
  const now = new Date()
  const where: Prisma.InviteWhereInput = {
    ...(query.scope === 'mine' ? { creatorId: userId } : {}),
    ...(query.status === 'active'
      ? currentInviteWhere(now)
      : query.status === 'ended'
        ? endedInviteWhere(now)
        : {}),
  }
  const total = await prisma.invite.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, pageCount)
  const records = await prisma.invite.findMany({
    where,
    select: inviteSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * query.limit,
    take: query.limit,
  })
  const eligibility = await creatorEligibility(records)
  return {
    invites: records.map((record) =>
      present(record, userId, access, eligibility)
    ),
    pagination: { total, pageCount, page, limit: query.limit },
    policy: await getInvitePolicy(userId, access),
  }
}

export async function createInvite(actorId: string, input: InviteCreateInput) {
  const { invite, token } = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const access = await requireActorPermission(tx, actorId, 'invites.create')
    const roles = input.roleIds.length
      ? await validateRoleAssignment(tx, actorId, null, input.roleIds)
      : []
    const limits = limitsFor(access, await readInviteLimits(tx))
    if (limits) {
      if (input.maxUses === null || input.maxUses > limits.usesPerInvite)
        throw new PermissionError(
          limits.usesPerInvite === 1
            ? 'Invites you create can be used once.'
            : `Invites you create can be used at most ${limits.usesPerInvite} times.`,
          400
        )
      if (
        input.expiresInHours === null ||
        input.expiresInHours > limits.lifetimeDays * 24
      )
        throw new PermissionError(
          `Invites you create must expire within ${limits.lifetimeDays} ${limits.lifetimeDays === 1 ? 'day' : 'days'}.`,
          400
        )
    }
    // lockRoleChanges serializes creation, so concurrent requests cannot exceed a limit.
    const active = await tx.invite.count({
      where: { creatorId: actorId, ...currentInviteWhere(new Date()) },
    })
    const allowed = limits?.activeInvites ?? MAX_ACTIVE_INVITES
    if (active >= allowed)
      throw new PermissionError(
        `You can have ${allowed} active ${allowed === 1 ? 'invite' : 'invites'} at a time. Revoke one or wait for one to be used or expire.`,
        409
      )
    let generated: ReturnType<typeof createInviteToken>
    try {
      generated = createInviteToken()
    } catch {
      throw new PermissionError(
        'Invite links need an encryption key. Ask the operator to set NEXTAUTH_SECRET or FLARE_EMAIL_ENCRYPTION_KEY to at least 32 characters.',
        503
      )
    }
    const created = await tx.invite.create({
      data: {
        creatorId: actorId,
        tokenHash: generated.hash,
        token: generated.encrypted,
        note: input.note,
        maxUses: input.maxUses,
        expiresAt:
          input.expiresInHours === null
            ? null
            : new Date(Date.now() + input.expiresInHours * 3_600_000),
        roles: { connect: roles.map((role) => ({ id: role.id })) },
      },
      select: inviteSelect,
    })
    return { invite: created, token: generated.token }
  })
  const access = await getUserAccess(actorId)
  return {
    ...present(invite, actorId, access, new Map([[actorId, access]])),
    token,
  }
}

export async function revokeInvite(actorId: string, id: string) {
  const record = await prisma.$transaction(async (tx) => {
    // Same lock order as registration: global role lock first, then the row.
    await lockRoleChanges(tx)
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "Invite" WHERE "id" = ${id} FOR UPDATE`
    const invite = locked.length
      ? await tx.invite.findUnique({
          where: { id },
          select: { creatorId: true, revokedAt: true },
        })
      : null
    const access = await getUserAccess(actorId, tx)
    const own = invite?.creatorId === actorId
    if (
      !invite ||
      (!hasPermission(access, 'invites.manage') &&
        !(own && hasPermission(access, 'invites.create')))
    )
      throw new PermissionError('Invite not found', 404)
    await requireActorPermission(
      tx,
      actorId,
      own && hasPermission(access, 'invites.create')
        ? 'invites.create'
        : 'invites.manage'
    )
    return invite.revokedAt
      ? tx.invite.findUniqueOrThrow({ where: { id }, select: inviteSelect })
      : tx.invite.update({
          where: { id },
          data: { revokedAt: new Date() },
          select: inviteSelect,
        })
  })
  return present(record, actorId, await getUserAccess(actorId), new Map())
}

/** Read-only preview for the registration page; registration rechecks under lock. */
export async function inspectInvite(token: unknown): Promise<
  | {
      status: 'active'
      inviterName: string | null
      roles: { id: string; name: string; color: string }[]
    }
  | { status: Exclude<InviteLinkStatus, 'active'> }
> {
  if (!isInviteToken(token)) return { status: 'invalid' }
  const record = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: inviteSelect,
  })
  if (!record) return { status: 'invalid' }
  const status = inviteStatus(record)
  if (status !== 'active') return { status }
  const creator = (await creatorEligibility([record])).get(record.creatorId)
  if (!creator || !canStillGrant(creator, record.roles))
    return { status: 'paused' }
  return {
    status,
    inviterName: record.creator.name,
    roles: record.roles.map(({ id, name, color }) => ({ id, name, color })),
  }
}

/**
 * Consume one use inside the registration transaction. The caller must already
 * hold `lockRoleChanges`; authority is rechecked so invites never outlive it.
 */
export async function redeemInvite(
  tx: Prisma.TransactionClient,
  token: unknown
) {
  if (!isInviteToken(token)) throw new InviteError('invalid')
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "Invite" WHERE "tokenHash" = ${hashInviteToken(token)} FOR UPDATE`
  if (!locked.length) throw new InviteError('invalid')
  const invite = await tx.invite.findUniqueOrThrow({
    where: { id: locked[0].id },
    select: {
      id: true,
      note: true,
      creatorId: true,
      maxUses: true,
      uses: true,
      expiresAt: true,
      revokedAt: true,
      roles: { select: { id: true } },
    },
  })
  const status = inviteStatus(invite)
  if (status !== 'active') throw new InviteError(status)
  const roleIds = invite.roles.map((role) => role.id)
  try {
    await requireActorPermission(tx, invite.creatorId, 'invites.create')
    if (roleIds.length)
      await validateRoleAssignment(tx, invite.creatorId, null, roleIds)
  } catch (error) {
    if (error instanceof PermissionError) throw new InviteError('paused')
    throw error
  }
  await tx.invite.update({
    where: { id: invite.id },
    data: { uses: { increment: 1 } },
  })
  return { id: invite.id, note: invite.note, roleIds }
}

export async function everyoneCanInvite(client: Client = prisma) {
  const everyone = await client.role.findUnique({
    where: { systemKey: 'everyone' },
    select: { permissions: true },
  })
  return Boolean(everyone?.permissions.includes('invites.create'))
}

/** The Settings switch is a shortcut for Everyone's Create invites grant. */
export async function setEveryoneCanInvite(actorId: string, enabled: boolean) {
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const access = await requireActorPermission(
      tx,
      actorId,
      'settings.security'
    )
    if (!hasPermission(access, 'invites.create'))
      throw new PermissionError(
        'You can only change who may invite people when you can create invites yourself'
      )
    const { everyone } = await ensureBuiltInRoles(tx)
    if (everyone.permissions.includes('invites.create') !== enabled)
      await tx.role.update({
        where: { id: everyone.id },
        data: {
          permissions: enabled
            ? [...everyone.permissions, 'invites.create']
            : everyone.permissions.filter(
                (permission) => permission !== 'invites.create'
              ),
        },
      })
    return { everyoneCanInvite: enabled }
  })
}
