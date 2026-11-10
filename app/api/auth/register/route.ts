import { NextResponse } from 'next/server'

import { z } from 'zod'

import { recordAudit } from '@/lib/audit'
import { accountRecordSchema } from '@/lib/auth/e2ee/records'
import { getConfig } from '@/lib/config'
import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { HttpError } from '@/lib/http/errors'
import { parseInput, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { InviteError, redeemInvite } from '@/lib/invites/service'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'
import {
  accountEmailSchema,
  accountNameSchema,
} from '@/lib/users/account-policy'
import { createAccount, verifiesNewAccounts } from '@/lib/users/create-account'

// A new account is created with its account record (docs/e2ee-spec.md,
// section 5.4, step 7). The passphrase stays in the browser. Strict: a
// request that still carries a password is refused, not stored without it.
const registerSchema = z.strictObject({
  email: accountEmailSchema,
  name: accountNameSchema,
  account: accountRecordSchema,
  invite: z.string().max(200).optional(),
})

const api = routes('/api/auth/register', {
  translate: (error) =>
    error instanceof InviteError
      ? new HttpError(400, error.message, {
          body: { code: `invite_${error.reason}` },
        })
      : undefined,
  failure: { message: 'Internal server error' },
})

export const POST = api(async (request) => {
  const limited = await rateLimit(request, authLimiter)
  if (limited) return limited

  const config = await getConfig()
  const json = await readJson(request).catch((error: unknown) => {
    // Unreadable JSON is answered after the registration check below.
    if (error instanceof HttpError && error.status === 413) throw error
    return null
  })
  const invite =
    json && typeof json === 'object' && 'invite' in json
      ? json.invite
      : undefined
  // An invite is the only way to create an account while registration is closed.
  if (!config.settings.general.registrations.enabled && invite === undefined) {
    return new NextResponse(null, { status: 404 })
  }
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')
  const body = parseInput(registerSchema, json)
  const emailConfig = await getEmailConfig()
  if (verifiesNewAccounts(emailConfig))
    await limitEmailRequest(request, emailConfig, body.email)

  const { user, redeemed } = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    // Redeemed in the same transaction: a rejected sign-up never spends a use.
    const redeemed =
      body.invite === undefined ? null : await redeemInvite(tx, body.invite)
    const created = await createAccount(
      tx,
      {
        email: body.email,
        name: body.name,
        keys: body.account,
        roleIds: redeemed?.roleIds,
        inviteId: redeemed?.id,
      },
      { verifyWith: emailConfig }
    )
    if (!created) throw new HttpError(400, 'User already exists')
    return { user: created, redeemed }
  })
  if (redeemed)
    await recordAudit({
      action: 'invite.redeem',
      category: 'invites',
      targetType: 'invite',
      targetId: redeemed.id,
      targetName: redeemed.note || null,
      details: {
        accountId: user.id,
        accountName: user.name,
        roleIds: redeemed.roleIds,
      },
    })

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    nextAction: requiresEmailVerification(user, emailConfig)
      ? 'verify_email'
      : 'sign_in',
  }
})
