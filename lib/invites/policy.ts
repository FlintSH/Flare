/** Shared by the invite API, registration, and dashboard. No server imports. */
import { z } from 'zod'

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const INVITE_NOTE_MAX = 100
/** Bounds accidental scripts for accounts without member limits. */
export const MAX_ACTIVE_INVITES = 1000

export type InviteStatus = 'active' | 'paused' | 'used' | 'expired' | 'revoked'
/** `invalid` covers unknown, malformed, and deleted links. */
export type InviteLinkStatus = InviteStatus | 'invalid'

export interface InviteLimits {
  activeInvites: number
  usesPerInvite: number
  lifetimeDays: number
}

export const INVITE_LINK_MESSAGES: Record<
  Exclude<InviteLinkStatus, 'active'>,
  string
> = {
  invalid: 'This invite link isn’t valid.',
  expired: 'This invite link has expired.',
  used: 'This invite link has already been used.',
  revoked: 'This invite link was revoked.',
  paused: 'This invite link can’t be used right now.',
}

export interface InviteView {
  id: string
  note: string
  status: InviteStatus
  maxUses: number | null
  uses: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  creator: { id: string; name: string | null }
  roles: { id: string; name: string; color: string }[]
  members: { id: string; name: string | null }[]
  memberCount: number
  /** Present only for the creator's own active or paused invites. */
  token: string | null
  canRevoke: boolean
}

export interface InvitePolicyView {
  canCreate: boolean
  canManage: boolean
  canGrantRoles: boolean
  /** `null` means no member limits apply to this account. */
  limits: InviteLimits | null
  activeCount: number
}

export const DEFAULT_INVITE_LIMITS: InviteLimits = {
  activeInvites: 5,
  usesPerInvite: 1,
  lifetimeDays: 30,
}

export const INVITE_EXPIRY_OPTIONS: readonly {
  hours: number | null
  label: string
}[] = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '1 day' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
  { hours: 2160, label: '90 days' },
  { hours: null, label: 'Never' },
]

export const INVITE_USE_OPTIONS: readonly (number | null)[] = [
  1,
  5,
  10,
  25,
  50,
  100,
  null,
]

export const inviteCreateSchema = z
  .object({
    note: z.string().trim().max(INVITE_NOTE_MAX).default(''),
    maxUses: z.number().int().min(1).max(1000).nullable().default(1),
    expiresInHours: z.number().int().min(1).max(8760).nullable().default(168),
    roleIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  })
  .strict()
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>

/** Revoked and used-up links end permanently; paused links resume if access returns. */
export function inviteStatus(
  invite: {
    revokedAt: Date | string | null
    expiresAt: Date | string | null
    maxUses: number | null
    uses: number
  },
  now = new Date()
): Exclude<InviteStatus, 'paused'> {
  if (invite.revokedAt) return 'revoked'
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return 'used'
  if (invite.expiresAt && new Date(invite.expiresAt) <= now) return 'expired'
  return 'active'
}

export function expiryOptionsFor(limits: InviteLimits | null) {
  if (!limits) return [...INVITE_EXPIRY_OPTIONS]
  const maxHours = limits.lifetimeDays * 24
  const options = INVITE_EXPIRY_OPTIONS.filter(
    (option) => option.hours !== null && option.hours <= maxHours
  )
  if (!options.some((option) => option.hours === maxHours))
    options.push({
      hours: maxHours,
      label: `${limits.lifetimeDays} ${limits.lifetimeDays === 1 ? 'day' : 'days'}`,
    })
  return options
}

export function usesOptionsFor(limits: InviteLimits | null) {
  if (!limits) return [...INVITE_USE_OPTIONS]
  const options = INVITE_USE_OPTIONS.filter(
    (uses): uses is number => uses !== null && uses <= limits.usesPerInvite
  )
  if (!options.includes(limits.usesPerInvite))
    options.push(limits.usesPerInvite)
  return options
}

export function describeUses(uses: number | null) {
  return uses === null
    ? 'Unlimited uses'
    : uses === 1
      ? 'Single use'
      : `${uses} uses`
}

export function inviteUrl(origin: string, token: string) {
  const url = new URL('/auth/register', origin)
  url.searchParams.set('invite', token)
  return url.toString()
}
