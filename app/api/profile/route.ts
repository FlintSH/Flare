import { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import { Prisma } from '@prisma/client'
import { compare } from 'bcryptjs'

import { securitySession } from '@/lib/auth/security/http'
import { assertSecurityProof } from '@/lib/auth/security/service'
import { prisma } from '@/lib/database/prisma'
import { lockEmailUser } from '@/lib/email/account'
import { getEmailConfig, getEmailConfigForUpdate } from '@/lib/email/config'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { deleteAccountWithStorageCleanup } from '@/lib/storage/deletion'
import { changeCredentials, hashAccountPassword } from '@/lib/users/credentials'

const api = routes('/api/profile', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const PUT = api(async (request) => {
  const user = await requireAccount(request)

  const body = UpdateProfileSchema.parse(await readJson(request))
  const account = await prisma.user.findUnique({ where: { id: user.id } })
  if (!account) throw new HttpError(404, 'User not found')
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

  if (body.email) {
    const existingUser = await prisma.user.findUnique({
      where: {
        email: body.email,
        NOT: {
          id: user.id,
        },
      },
    })

    if (existingUser) {
      throw new HttpError(400, 'Email already taken')
    }
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

  const updateData: Prisma.UserUpdateInput = {}
  if (body.name) updateData.name = body.name
  const passwordHash = body.newPassword
    ? await hashAccountPassword(body.newPassword)
    : undefined
  if (typeof body.randomizeFileUrls === 'boolean')
    updateData.randomizeFileUrls = body.randomizeFileUrls
  if (body.defaultFileExpiration)
    updateData.defaultFileExpiration = body.defaultFileExpiration
  if (body.defaultFileExpirationAction)
    updateData.defaultFileExpirationAction = body.defaultFileExpirationAction

  if (body.vanityId !== undefined) {
    if (body.vanityId === null) {
      // Clear vanity ID
      updateData.vanityId = null
    } else {
      // Check vanityId doesn't collide with another user's vanityId
      const existingVanity = await prisma.user.findUnique({
        where: { vanityId: body.vanityId },
      })
      if (existingVanity && existingVanity.id !== user.id) {
        throw new HttpError(400, 'This vanity URL is already taken')
      }

      // Check vanityId doesn't collide with any user's urlId
      const existingUrlId = await prisma.user.findUnique({
        where: { urlId: body.vanityId },
      })
      if (existingUrlId) {
        throw new HttpError(
          400,
          'This vanity URL conflicts with an existing URL ID'
        )
      }

      updateData.vanityId = body.vanityId
    }
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    if (emailChanged || passwordHash) {
      // Serialize the effective policy with this account mutation. An admin
      // enabling email must commit either before this check or after our save.
      const currentEmailConfig = await getEmailConfigForUpdate(tx)
      if (currentEmailConfig.enabled && emailChanged)
        throw new HttpError(
          400,
          'Use the verified email change form to change your email address.'
        )
      const fresh = await lockEmailUser(tx, user.id)
      if (security)
        await assertSecurityProof(
          tx,
          fresh,
          { password: body.currentPassword, code: body.securityCode },
          security.session
        )
      if (fresh.password !== account.password || fresh.email !== account.email)
        throw new HttpError(
          400,
          'Account changed during update. Please try again.'
        )
      await changeCredentials(tx, user.id, {
        password: passwordHash,
        ...(emailChanged && {
          email: { address: body.email!, verified: false },
        }),
      })
    }
    return tx.user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        randomizeFileUrls: true,
        vanityId: true,
      },
    })
  })

  return apiResponse<ProfileResponse>(updatedUser)
})

export const DELETE = api(async (request) => {
  const user = await requireAccount(request)

  await deleteAccountWithStorageCleanup(
    user.id,
    user.id,
    'profile.update',
    true
  )

  return new Response(null, { status: 204 })
})
