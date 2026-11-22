import { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import { compare } from 'bcryptjs'

import { securitySession } from '@/lib/auth/security/http'
import { assertFreshIdentity } from '@/lib/auth/security/service'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig, getEmailConfigForUpdate } from '@/lib/email/config'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { hashAccountPassword } from '@/lib/users/credentials'
import { deleteAccount } from '@/lib/users/delete-account'
import { accountToEdit, saveProfile } from '@/lib/users/profile'

const api = routes('/api/profile', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const PUT = api(async (request) => {
  const user = await requireAccount(request)

  const body = await readJson(request, UpdateProfileSchema)
  const account = await accountToEdit(user.id)
  const emailConfig = await getEmailConfig()
  const emailChanged = Boolean(body.email && body.email !== account.email)
  const security =
    emailChanged || body.newPassword ? await securitySession(request) : null
  if (emailConfig.enabled && emailChanged) {
    throw new HttpError(
      400,
      'Use the verified email change form to change your email address.'
    )
  }

  if (body.newPassword) {
    if (!body.currentPassword) {
      throw new HttpError(400, 'Current password is required')
    }

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    })

    if (!userData?.password) {
      throw new HttpError(400, 'Invalid credentials')
    }

    const isPasswordValid = await compare(
      body.currentPassword,
      userData.password
    )

    if (!isPasswordValid) {
      throw new HttpError(400, 'Invalid credentials')
    }
  }

  const passwordHash = body.newPassword
    ? await hashAccountPassword(body.newPassword)
    : undefined

  const updatedUser = await prisma.$transaction(async (tx) => {
    let emailEnabled = emailConfig.enabled
    if (emailChanged || passwordHash) {
      // Serialize the effective policy with this account mutation. An admin
      // enabling email must commit either before this check or after our save.
      emailEnabled = (await getEmailConfigForUpdate(tx)).enabled
      if (emailEnabled && emailChanged)
        throw new HttpError(
          400,
          'Use the verified email change form to change your email address.'
        )
    }
    return saveProfile(tx, account, body, {
      email: emailChanged ? body.email : undefined,
      password: passwordHash,
      emailEnabled,
      prove: security
        ? (fresh) =>
            assertFreshIdentity(
              fresh,
              { password: body.currentPassword, code: body.securityCode },
              security.session,
              { secondFactor: true, tx }
            )
        : undefined,
    })
  })

  return apiResponse<ProfileResponse>(updatedUser)
})

export const DELETE = api(async (request) => {
  const user = await requireAccount(request)

  await deleteAccount(user.id, user.id, 'profile.update', true)

  return new Response(null, { status: 204 })
})
